"""Mission-chain validation and durable step-by-step execution."""
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import select

from app.models.operations import MapDocument, MissionRun, TaskRun
from app.services.map_editor import published_map
from app.services.operations_common import now


TERMINAL = {"success", "failed", "cancelled", "timeout"}


def validate_chain(document, start_point, steps, repeat_count):
    points = {point["code"] for point in document.get("points", [])}
    if start_point not in points:
        raise HTTPException(400, "任务链起点不在已发布地图中")
    if not steps:
        raise HTTPException(400, "任务链至少需要一个移动站点")
    edges = {point: set() for point in points}
    for path in document.get("paths", []):
        edges.setdefault(path["start"], set()).add(path["end"])
        if path.get("bidirectional"):
            edges.setdefault(path["end"], set()).add(path["start"])
    previous = start_point
    for index, step in enumerate(steps, start=1):
        target = step.get("point")
        if step.get("action", "navigate") != "navigate":
            raise HTTPException(400, "当前仅支持真实导航动作；叉取、升降动作待设备协议接入")
        if target not in points:
            raise HTTPException(400, f"第 {index} 步目标站点不在已发布地图中")
        if target == previous:
            raise HTTPException(400, f"第 {index} 步起点和目标相同")
        reachable, pending = set(), [previous]
        while pending:
            point = pending.pop()
            if point in reachable:
                continue
            reachable.add(point)
            pending.extend(edges.get(point, set()) - reachable)
        if target not in reachable:
            raise HTTPException(400, f"地图没有可行驶路线：{previous} → {target}")
        previous = target
    if (repeat_count == -1 or repeat_count > 1) and previous != start_point:
        raise HTTPException(400, "重复执行必须形成闭环：最后一个站点要回到起点")


async def create_current_step(db, run):
    if run.step_index < 0 or run.step_index >= len(run.steps):
        raise HTTPException(409, "任务链执行位置无效")
    map_row = await db.get(MapDocument, run.map_id)
    if map_row is None or map_row.deleted or map_row.published_version != run.map_version:
        run.status, run.finished_at = "failed", now()
        run.failure = "任务链绑定的地图发布版本已变化，请用最新版本重新创建任务链"
        run.timeline = (run.timeline or [])[-499:] + [{"at": now().isoformat() + "Z", "status": "failed", "note": run.failure}]
        return None
    document = await published_map(db, run.map_id)
    validate_chain(document, run.start_point, run.steps, run.repeat_count)
    target = run.steps[run.step_index]["point"]
    start = run.start_point if run.step_index == 0 else run.steps[run.step_index - 1]["point"]
    if run.robot_id:
        from app.models.operations import Robot
        robot = await db.get(Robot, run.robot_id)
        if not robot or robot.map_id != run.map_id:
            raise HTTPException(409, "指定机器人未绑定任务链地图")
    cycle = run.cycles_completed + 1
    external_id = f"mission-{run.id}-c{cycle}-s{run.step_index + 1}"
    row = TaskRun(
        name=f"{run.name} · 第 {cycle} 轮 {start} → {target}"[:128],
        map_id=run.map_id,
        robot_id=run.robot_id,
        source="mission",
        external_id=external_id,
        priority=run.priority,
        from_point=start,
        to_point=target,
        operator=run.operator,
        timeline=[{"at": now().isoformat() + "Z", "status": "queued", "note": f"任务链 #{run.id} 第 {cycle} 轮第 {run.step_index + 1} 步"}],
    )
    db.add(row)
    await db.flush()
    run.active_task_id = row.id
    run.status = "running"
    run.timeline = (run.timeline or [])[-499:] + [{"at": now().isoformat() + "Z", "status": "running", "note": f"已创建第 {cycle} 轮第 {run.step_index + 1} 步：{start} → {target}"}]
    return row


async def consume_current_step(db, run):
    pause_requested = run.status == "pausing"
    task = await db.get(TaskRun, run.active_task_id) if run.active_task_id else None
    if task is None:
        run.status, run.finished_at = "failed", now()
        run.failure = "任务链子任务记录丢失，需要核实设备状态"
        run.timeline = (run.timeline or [])[-499:] + [{"at": now().isoformat() + "Z", "status": "failed", "note": run.failure}]
        return
    if task.robot_id and run.robot_id is None:
        run.robot_id = task.robot_id
    if task.status not in TERMINAL:
        return
    run.active_task_id = None
    if task.status != "success":
        run.status, run.finished_at, run.failure = task.status, now(), task.failure or task.status
        run.timeline = (run.timeline or [])[-499:] + [{"at": now().isoformat() + "Z", "status": run.status, "note": run.failure}]
        return

    delay = float(run.steps[run.step_index].get("delay_seconds", 0))
    run.step_index += 1
    if run.step_index >= len(run.steps):
        run.cycles_completed += 1
        if run.repeat_count != -1 and run.cycles_completed >= run.repeat_count:
            run.failure = ""
            run.next_at = now() + timedelta(seconds=delay)
            run.status = "finishing" if delay else "success"
            run.finished_at = None if delay else now()
            note = f"末站等待 {delay:g} 秒后结束" if delay else f"完成 {run.cycles_completed} 轮"
            run.timeline = (run.timeline or [])[-499:] + [{"at": now().isoformat() + "Z", "status": run.status, "note": note}]
            return
        run.step_index = 0
    run.next_at = now() + timedelta(seconds=delay)
    run.status = "paused" if pause_requested else "waiting_manual" if run.task_mode == "manual" else "running"
    next_point = run.steps[run.step_index]["point"]
    note = "当前步骤已到站，后续步骤已暂停" if pause_requested else f"步骤完成，等待人工下发：{next_point}" if run.status == "waiting_manual" else f"步骤完成，{delay:g} 秒后继续"
    run.timeline = (run.timeline or [])[-499:] + [{"at": now().isoformat() + "Z", "status": run.status, "note": note}]


async def mission_tick(db):
    """Advance automatic and scheduled chains; never replays an in-flight step."""
    runs = (await db.scalars(select(MissionRun).where(MissionRun.status.in_(["queued", "running", "pausing", "finishing"]))
        .order_by(MissionRun.id).limit(200).with_for_update(skip_locked=True))).all()
    for run in runs:
        if run.status == "finishing":
            if not run.next_at or run.next_at <= now():
                run.status, run.finished_at = "success", now()
                run.timeline = (run.timeline or [])[-499:] + [{"at": now().isoformat() + "Z", "status": "success", "note": f"完成 {run.cycles_completed} 轮及末站等待"}]
            continue
        if run.status == "queued":
            if run.task_mode == "schedule" and run.scheduled_at and run.scheduled_at > now():
                continue
            run.status = "running"
            run.timeline = (run.timeline or [])[-499:] + [{"at": now().isoformat() + "Z", "status": "running", "note": "定时已到，任务链开始" if run.task_mode == "schedule" else "任务链开始"}]
        if run.active_task_id:
            await consume_current_step(db, run)
            if run.active_task_id or run.status != "running":
                continue
        if run.status != "running" or run.task_mode == "manual" or (run.next_at and run.next_at > now()):
            continue
        try:
            await create_current_step(db, run)
        except HTTPException as exc:
            run.status, run.finished_at, run.failure = "failed", now(), str(exc.detail)
            run.timeline = (run.timeline or [])[-499:] + [{"at": now().isoformat() + "Z", "status": "failed", "note": run.failure}]
