"""Durable pause/resume requests for one existing task execution, without replanning."""
from fastapi import HTTPException
from sqlalchemy import select
from app.models.operations import Command, MissionRun, Robot, TaskRun
from app.services.operations_common import audit, get_or_404, now, task_motion_state


def motion_event(task, state, note, command_id=None):
    task.timeline = (task.timeline or []) + [{"at": now().isoformat() + "Z", "status": state,
        "motion_state": state, "note": note, "command_id": command_id}]


async def sync_mission_motion(db, task):
    run = await db.scalar(select(MissionRun).where(MissionRun.active_task_id == task.id).with_for_update())
    if run and run.status in {"running", "pausing", "paused", "resuming"}:
        motion = task_motion_state(task)
        if motion in {"running", "pausing", "paused", "resuming"}:
            run.status = motion
        elif motion == "unknown":
            run.status, run.failure = "paused", "暂停/继续结果未确认，请停止并核实设备"


async def request_task_motion(db, task, action, actor):
    from app.services.fleet_service import queue_command
    if action not in {"pause", "resume"} or task.status not in {"dispatched", "running"} or not task.robot_id:
        raise HTTPException(409, "任务当前没有可暂停/继续的设备路线")
    robot = await get_or_404(db, Robot, task.robot_id)
    name = action + "-task"
    if name not in (robot.telemetry.get("capabilities") or []):
        raise HTTPException(409, "设备尚未支持即时暂停/继续，请更新导航及设备适配器")
    commands = (await db.scalars(select(Command).where(Command.robot_id == robot.id,
        Command.status.in_(["queued", "accepted", "running"])).with_for_update())).all()
    execution = next((c for c in commands if c.command == "execute-task" and c.params.get("task_id") == task.id), None)
    if not execution or execution.status == "queued":
        raise HTTPException(409, "设备尚未确认当前路线；请稍后重试，或使用停止撤销")
    if any(c.command in {"emergency-stop", "lock"} for c in commands) or robot.locked or robot.emergency:
        raise HTTPException(409, "设备正在停止或已锁定，禁止继续路线")
    pending = next((c for c in commands if c.command in {"pause-task", "resume-task"}
                    and c.params.get("execute_command_id") == execution.id), None)
    if pending:
        if pending.command != name:
            raise HTTPException(409, "暂停/继续仍在等待设备回执")
        return pending
    motion = task_motion_state(task)
    if motion == ("paused" if action == "pause" else "running"):
        return None
    if motion != ("running" if action == "pause" else "paused"):
        raise HTTPException(409, "当前暂停状态未确认，请核实设备或停止并锁定")
    command = await queue_command(db, robot, name, {"task_id": task.id,
        "execute_command_id": execution.id, "navigation_id": execution.params.get("navigation_id")}, actor)
    motion_event(task, "pausing" if action == "pause" else "resuming", "等待设备确认" + action, command.id)
    await sync_mission_motion(db, task)
    audit(db, actor, "task", "请求即时" + ("暂停" if action == "pause" else "继续"), robot.id, task.id)
    return command
