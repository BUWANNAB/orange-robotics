"""Map-bound task-chain editing and execution APIs."""
from datetime import datetime, timedelta, timezone
from typing import Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select, update

from app.common.response import ok
from app.database import get_db
from app.models.operations import ACTIVE_MISSION_STATES, MapDocument, MissionRun, MissionSettings, Robot, TaskPlan, TaskRun
from app.services.mission_service import create_current_step, validate_chain
from app.services.map_editor import published_map
from app.services.resource_identity import bind_steps, identity_error
from app.services.operations_common import audit, confirm, get_or_404, now, public, require

router = APIRouter(prefix="/api")


class MissionStep(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    node_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12], min_length=1, max_length=40)
    action: Literal["navigate"] = "navigate"
    point: str = Field(min_length=1, max_length=80)
    delay_seconds: float = Field(default=0, ge=0, le=3600)
    point_uid: str = Field(default="", max_length=80)
    start_point_uid: str = Field(default="", max_length=80)


class TaskPlanInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=128)
    map_id: int = Field(gt=0)
    start_point: str = Field(min_length=1, max_length=80)
    steps: list[MissionStep] = Field(min_length=1, max_length=100)
    repeat_count: int = Field(default=1, ge=-1, le=1000)
    priority: int = Field(default=5, ge=1, le=9)
    robot_id: int | None = None

    @field_validator("repeat_count")
    @classmethod
    def valid_repeat_count(cls, value):
        if value == 0:
            raise ValueError("重复次数填写 1—1000；无限循环请选择 -1")
        return value


class TaskModeInput(BaseModel):
    mode: Literal["manual", "auto", "schedule"]
    confirmation: str = Field(min_length=1, max_length=128)


class MissionStartInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmation: str = Field(min_length=1, max_length=128)
    task_mode: Literal["manual", "auto", "schedule"] | None = None
    scheduled_at: datetime | None = None
    repeat_count: int | None = Field(default=None, ge=-1, le=1000)
    robot_id: int | None = None

    @field_validator("repeat_count")
    @classmethod
    def valid_repeat_count(cls, value):
        if value == 0:
            raise ValueError("重复次数填写 1—1000；无限循环请选择 -1")
        return value


class MissionConfirm(BaseModel):
    confirmation: str = Field(min_length=1, max_length=128)


def mode_view(row):
    return {"mode": row.task_mode if row else "manual", "updated_at": row.updated_at if row else None,
            "operator": row.operator if row else "system",
            "meaning": "任务链执行策略，不会代替设备的实体手动/自动驾驶模式"}


async def validate_plan_data(db, body):
    document = await published_map(db, body.map_id)
    steps = [step.model_dump() for step in body.steps]
    validate_chain(document, body.start_point, steps, body.repeat_count)
    map_row = await get_or_404(db, MapDocument, body.map_id)
    if not map_row.published_version:
        raise HTTPException(409, "请先发布地图，再设置任务链")
    if body.robot_id:
        robot = await get_or_404(db, Robot, body.robot_id)
        if robot.map_id != body.map_id:
            raise HTTPException(409, "指定机器人未绑定任务链地图")
    return bind_steps(document, body.start_point, steps), map_row


async def read_mode(db):
    return await db.get(MissionSettings, 1)


@router.get("/task-mode")
async def get_task_mode(actor=Depends(require("task:view")), db=Depends(get_db)):
    return ok(mode_view(await read_mode(db)))


@router.post("/task-mode")
async def set_task_mode(body: TaskModeInput, actor=Depends(require("robot:control")), db=Depends(get_db)):
    names = {"manual": "手动", "auto": "自动", "schedule": "调度"}
    confirm(body.confirmation, "切换到" + names[body.mode])
    row = await read_mode(db)
    if row is None:
        row = MissionSettings(id=1, task_mode=body.mode, operator=actor)
        db.add(row)
    else:
        row.task_mode, row.operator, row.updated_at = body.mode, actor, now()
    audit(db, actor, "mission", "任务模式切换为" + names[body.mode])
    await db.commit()
    return ok(mode_view(row))


@router.get("/task-plans")
async def task_plans(map_id: int = Query(gt=0), actor=Depends(require("task:view")), db=Depends(get_db)):
    rows = (await db.scalars(select(TaskPlan).where(TaskPlan.map_id == map_id).order_by(TaskPlan.updated_at.desc(), TaskPlan.id.desc()).limit(100))).all()
    return ok([public(row) for row in rows])


@router.post("/task-plans")
async def create_task_plan(body: TaskPlanInput, actor=Depends(require("task:edit")), db=Depends(get_db)):
    steps, _ = await validate_plan_data(db, body)
    row = TaskPlan(**body.model_dump(exclude={"steps"}), steps=steps, operator=actor)
    db.add(row)
    audit(db, actor, "mission", "保存任务链 " + body.name, task_id=None)
    await db.commit()
    await db.refresh(row)
    return ok(public(row))


@router.put("/task-plans/{plan_id}")
async def update_task_plan(plan_id: int, body: TaskPlanInput, actor=Depends(require("task:edit")), db=Depends(get_db)):
    row = await get_or_404(db, TaskPlan, plan_id)
    active = await db.scalar(select(MissionRun.id).where(MissionRun.plan_id == row.id,
        MissionRun.status.in_(ACTIVE_MISSION_STATES)).limit(1))
    if active:
        raise HTTPException(409, "任务链正在等待或执行，暂不能修改")
    steps, _ = await validate_plan_data(db, body)
    for key, value in body.model_dump(exclude={"steps"}).items():
        setattr(row, key, value)
    row.steps, row.operator = steps, actor
    audit(db, actor, "mission", "更新任务链 " + body.name)
    await db.commit()
    await db.refresh(row)
    return ok(public(row))


@router.post("/task-plans/{plan_id}/delete")
async def delete_task_plan(plan_id: int, body: MissionConfirm,
                           actor=Depends(require("task:edit")), db=Depends(get_db)):
    row = await get_or_404(db, TaskPlan, plan_id)
    confirm(body.confirmation, row.name)
    active = await db.scalar(select(MissionRun.id).where(MissionRun.plan_id == row.id,
        MissionRun.status.in_(ACTIVE_MISSION_STATES)).limit(1))
    if active:
        raise HTTPException(409, "任务链正在等待或执行，不能删除")
    await db.delete(row)
    audit(db, actor, "mission", "删除任务链 " + row.name)
    await db.commit()
    return ok(True)


@router.post("/task-plans/{plan_id}/runs")
async def start_task_plan(plan_id: int, body: MissionStartInput,
                          actor=Depends(require("robot:control")), db=Depends(get_db)):
    plan = await get_or_404(db, TaskPlan, plan_id)
    confirm(body.confirmation, plan.name)
    setting = await read_mode(db)
    mode = setting.task_mode if setting else "manual"
    if body.task_mode is not None and body.task_mode != mode:
        raise HTTPException(409, "任务模式已改变，请重新打开执行确认窗口")
    repeat_count = body.repeat_count if body.repeat_count is not None else plan.repeat_count
    if repeat_count == 0:
        raise HTTPException(400, "重复次数不能为 0；无限循环请选择 -1")
    scheduled_at = body.scheduled_at
    if mode == "schedule":
        if scheduled_at is None:
            raise HTTPException(400, "调度模式需要设置执行时间")
        if scheduled_at.tzinfo:
            scheduled_at = scheduled_at.astimezone(timezone.utc).replace(tzinfo=None)
        if scheduled_at <= now() or scheduled_at > now() + timedelta(days=30):
            raise HTTPException(400, "执行时间须在未来 30 天内")
    elif scheduled_at is not None:
        raise HTTPException(400, "只有调度模式接受执行时间")

    map_row = await get_or_404(db, MapDocument, plan.map_id)
    if not map_row.published_version or map_row.deleted:
        raise HTTPException(409, "任务链地图未发布或已删除")
    document = await published_map(db, plan.map_id)
    validate_chain(document, plan.start_point, plan.steps, repeat_count)
    problem = identity_error(document, plan.start_point, plan.steps)
    if problem:
        raise HTTPException(409, problem)
    robot_id = body.robot_id if body.robot_id is not None else plan.robot_id
    if robot_id:
        robot = await get_or_404(db, Robot, robot_id)
        if robot.map_id != plan.map_id:
            raise HTTPException(409, "指定机器人未绑定任务链地图")

    status = "waiting_manual" if mode == "manual" else "queued"
    run = MissionRun(plan_id=plan.id, name=plan.name, map_id=plan.map_id,
        map_version=map_row.published_version, start_point=plan.start_point,
        steps=plan.steps, repeat_count=repeat_count, priority=plan.priority,
        robot_id=robot_id, task_mode=mode, scheduled_at=scheduled_at,
        next_at=now(), status=status, operator=actor,
        timeline=[{"at": now().isoformat() + "Z", "status": status,
                   "note": "等待人工逐步下发" if mode == "manual" else "已创建，等待调度" if mode == "schedule" else "已加入自动任务队列"}])
    db.add(run)
    await db.flush()
    audit(db, actor, "mission", f"启动任务链 {plan.name}（{mode}，重复 {repeat_count}）", task_id=None)
    await db.commit()
    await db.refresh(run)
    return ok(public(run))


@router.get("/mission-runs")
async def mission_runs(map_id: int = Query(gt=0), page_size: int = Query(20, ge=1, le=100),
                       actor=Depends(require("task:view")), db=Depends(get_db)):
    rows = (await db.scalars(select(MissionRun).where(MissionRun.map_id == map_id)
        .order_by(MissionRun.id.desc()).limit(page_size))).all()
    result = []
    for row in rows:
        item = public(row)
        child = await db.get(TaskRun, row.active_task_id) if row.active_task_id else None
        item["active_task"] = public(child) if child else None
        result.append(item)
    return ok(result)


@router.post("/mission-runs/{run_id}/advance")
async def advance_manual_run(run_id: int, body: MissionConfirm,
                             actor=Depends(require("robot:control")), db=Depends(get_db)):
    run = await locked_run(db, run_id)
    confirm(body.confirmation, run.name)
    if run.task_mode != "manual" or run.status != "waiting_manual":
        raise HTTPException(409, "只有手动模式下等待操作的任务链可以下发下一步")
    if run.active_task_id:
        raise HTTPException(409, "上一步尚未收到完成回执")
    if run.next_at and run.next_at > now():
        raise HTTPException(409, "当前步骤的站点等待时间尚未结束")
    claimed = await db.execute(update(MissionRun).where(MissionRun.id == run.id,
        MissionRun.status == "waiting_manual", MissionRun.active_task_id.is_(None))
        .values(status="running"))
    if claimed.rowcount != 1:
        raise HTTPException(409, "任务链状态已变化，请刷新后重试")
    await db.refresh(run)
    try:
        task = await create_current_step(db, run)
    except HTTPException as exc:
        run.status, run.finished_at, run.failure = "failed", now(), str(exc.detail)
        run.timeline = (run.timeline or [])[-499:] + [{"at": now().isoformat() + "Z", "status": "failed", "note": run.failure}]
        audit(db, actor, "mission", f"手动任务链 #{run.id} 无法继续：{run.failure}")
        await db.commit()
        await db.refresh(run)
        return ok(public(run))
    if task is None:
        await db.commit()
        await db.refresh(run)
        return ok(public(run))
    audit(db, actor, "mission", f"手动下发任务链 #{run.id} 第 {run.cycles_completed + 1} 轮第 {run.step_index + 1} 步")
    await db.commit()
    await db.refresh(run)
    return ok(public(run))


@router.post("/mission-runs/{run_id}/cancel")
async def cancel_mission_run(run_id: int, body: MissionConfirm,
                             actor=Depends(require("robot:control")), db=Depends(get_db)):
    run = await locked_run(db, run_id)
    confirm(body.confirmation, run.name)
    if run.status not in ACTIVE_MISSION_STATES:
        raise HTTPException(409, "任务链已经结束")
    if run.active_task_id:
        task = await db.get(TaskRun, run.active_task_id)
        if task and task.status not in {"success", "failed", "cancelled", "timeout"}:
            raise HTTPException(409, "当前步骤正在设备上执行，请在任务执行栏停止并锁定设备")
    run.status, run.finished_at = "cancelled", now()
    run.failure = ""
    run.timeline = (run.timeline or [])[-499:] + [{"at": now().isoformat() + "Z", "status": "cancelled", "note": "操作员取消任务链"}]
    audit(db, actor, "mission", f"取消任务链 #{run.id}")
    await db.commit()
    await db.refresh(run)
    return ok(public(run))


async def locked_run(db, run_id):
    run = await db.scalar(select(MissionRun).where(MissionRun.id == run_id).with_for_update())
    if run is None:
        raise HTTPException(404, "任务链执行记录不存在")
    return run


@router.post("/mission-runs/{run_id}/pause")
async def pause_mission_run(run_id: int, body: MissionConfirm,
                            actor=Depends(require("robot:control")), db=Depends(get_db)):
    run = await locked_run(db, run_id)
    confirm(body.confirmation, run.name)
    if run.status not in {"queued", "running", "waiting_manual", "pausing", "paused"}:
        raise HTTPException(409, "当前任务链不能暂停，请刷新执行状态")
    task = await db.get(TaskRun, run.active_task_id) if run.active_task_id else None
    if task and task.status in {"dispatched", "running"}:
        from app.services.task_motion import request_task_motion
        await request_task_motion(db, task, "pause", actor)
    else:
        run.status = "paused"
    note = "已请求当前路线即时停车，等待设备确认" if run.status == "pausing" else "任务链已暂停"
    run.timeline = (run.timeline or [])[-499:] + [{"at": now().isoformat() + "Z", "status": run.status, "note": note}]
    audit(db, actor, "mission", f"任务链 #{run.id}：{note}")
    await db.commit()
    return ok(public(run))


@router.post("/mission-runs/{run_id}/resume")
async def resume_mission_run(run_id: int, body: MissionConfirm,
                             actor=Depends(require("robot:control")), db=Depends(get_db)):
    run = await locked_run(db, run_id)
    confirm(body.confirmation, run.name)
    if run.status not in {"paused", "resuming"}:
        raise HTTPException(409, "只有设备确认已暂停的任务链可以继续")
    task = await db.get(TaskRun, run.active_task_id) if run.active_task_id else None
    if task and task.status in {"dispatched", "running"}:
        from app.services.task_motion import request_task_motion
        await request_task_motion(db, task, "resume", actor)
    else:
        run.status = "running" if task else "waiting_manual" if run.task_mode == "manual" else "queued" if not run.started_at else "running"
    run.timeline = (run.timeline or [])[-499:] + [{"at": now().isoformat() + "Z", "status": run.status, "note": "操作员确认继续任务链"}]
    audit(db, actor, "mission", f"继续任务链 #{run.id}")
    await db.commit()
    return ok(public(run))
