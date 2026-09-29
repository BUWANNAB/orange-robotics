"""Fleet state and durable command outbox; only a device receipt completes a command."""
import uuid
from datetime import timedelta
from fastapi import HTTPException
from sqlalchemy import select, update
from app.models.operations import Robot, Alarm, Command, BatterySample, TaskRun
from app.services.operations_common import now, online, audit, public

TERMINAL = {"success", "failed", "cancelled", "timeout"}
COMMANDS = {"lock", "unlock", "goto-charge", "emergency-stop", "release-stop", "set-mode", "goto-point", "reboot", "clear-alarm"}


def robot_view(robot):
    data = public(robot)
    data["online"] = online(robot)
    data["status"] = ("disabled" if not robot.enabled else "offline" if not data["online"] else
                      "maintenance" if robot.maintenance else "emergency" if robot.emergency else
                      "locked" if robot.locked else "charging" if robot.telemetry.get("charging") else
                      "busy" if robot.telemetry.get("busy") else "idle")
    battery = robot.telemetry.get("battery")
    data["is_low"] = battery is not None and battery < robot.policy["low"]
    data["is_critical"] = battery is not None and battery < robot.policy["critical"]
    return data


async def raise_alarm(db, robot_id, code, title, level="warning"):
    existing = await db.scalar(select(Alarm).where(Alarm.robot_id == robot_id, Alarm.code == code,
                               Alarm.created_at > now() - timedelta(minutes=10)).order_by(Alarm.id.desc()).limit(1))
    if existing:
        return existing
    alarm = Alarm(robot_id=robot_id, code=code, title=title, level=level)
    db.add(alarm)
    return alarm


async def ingest(db, robot, data):
    previous = robot.telemetry.get("battery")
    # CAS protects sequence ordering even if multiple device requests arrive concurrently.
    changed = await db.execute(update(Robot).where(Robot.id == robot.id, Robot.seq < data.seq)
        .values(seq=data.seq, heartbeat=now(), telemetry=data.model_dump(exclude={"seq"}),
                revision=Robot.revision + 1))
    if changed.rowcount != 1:
        return {"accepted": False, "reason": "旧序号已丢弃"}
    db.add(BatterySample(robot_id=robot.id, percent=data.battery, voltage=data.voltage,
                         temperature=data.temperature, charging=data.charging))
    anomalous = previous is not None and abs(previous - data.battery) > 30
    if anomalous:
        await raise_alarm(db, robot.id, "BATTERY_JUMP", "电量突变，请人工核实")
    elif data.battery < robot.policy["critical"]:
        await raise_alarm(db, robot.id, "BATTERY_CRITICAL", "电量低于紧急阈值", "critical")
    elif data.battery < robot.policy["low"]:
        await raise_alarm(db, robot.id, "BATTERY_LOW", "电量低于告警阈值")
    for alarm in data.alarms:
        await raise_alarm(db, robot.id, alarm.code, alarm.title, alarm.level)
    await db.refresh(robot)
    if (robot.policy.get("auto_charge") and data.battery < robot.policy["critical"] and not anomalous
            and not data.charging and not data.busy and not robot.locked and not robot.maintenance and not robot.emergency):
        try:
            await queue_command(db, robot, "goto-charge", {}, "system", "auto-charge-" + str(int(now().timestamp()) // 30))
        except HTTPException as exc:
            audit(db, "system", "battery", exc.detail, robot.id, level="WARN")
    return {"accepted": True}


async def queue_command(db, robot, command, params, actor, key=None):
    if command not in COMMANDS | {"execute-task", "upgrade", "rollback", "load-map"}:
        raise HTTPException(400, "不支持的指令")
    capabilities = robot.telemetry.get("capabilities")
    if capabilities is not None and command not in capabilities:
        raise HTTPException(409, "设备未声明指令能力: " + command)
    key = key or uuid.uuid4().hex
    existing = await db.scalar(select(Command).where(Command.robot_id == robot.id, Command.key == key))
    if existing:
        return existing
    if not online(robot) or not robot.enabled:
        raise HTTPException(409, "机器人离线或已停用")
    if (robot.maintenance or robot.upgrade_reservation) and command not in {"upgrade", "rollback", "emergency-stop"}:
        raise HTTPException(409, "机器人维护中")
    if (robot.emergency or robot.locked) and command in {"goto-charge", "goto-point", "execute-task", "reboot", "set-mode"}:
        raise HTTPException(409, "机器人急停或锁定中，请先显式解除")
    task = await db.scalar(select(TaskRun.id).where(TaskRun.robot_id == robot.id, TaskRun.status.in_(["dispatched", "running"])).limit(1))
    if command in {"goto-charge", "goto-point", "reboot", "upgrade", "load-map"} and (task or robot.telemetry.get("busy")):
        raise HTTPException(409, "机器人任务占用中")
    if command == "goto-charge" and robot.telemetry.get("charging"):
        raise HTTPException(409, "机器人已经在充电")
    if command in {"goto-charge", "goto-point", "execute-task", "reboot", "set-mode", "upgrade", "rollback", "load-map"}:
        pending = await db.scalar(select(Command.id).where(Command.robot_id == robot.id,
            Command.status.in_(["queued", "accepted", "running"]), Command.expires_at > now()).limit(1))
        if pending: raise HTTPException(409, "机器人尚有未完成指令，请等待设备回执")
    if command == "lock" and not str(params.get("reason", "")).strip():
        raise HTTPException(400, "锁定必须填写原因")
    if command == "set-mode" and params.get("mode") not in {"auto", "manual", "remote"}:
        raise HTTPException(400, "模式必须为 auto/manual/remote")
    if command == "goto-point":
        from app.services.map_editor import published_map
        document = await published_map(db, robot.map_id)
        if params.get("point") not in {p["code"] for p in document["points"]}:
            raise HTTPException(400, "目标点不在机器人当前发布地图中")
    recent = await db.scalar(select(Command.id).where(Command.robot_id == robot.id, Command.command == command,
                            Command.created_at > now() - timedelta(seconds=30)).limit(1))
    if recent and command in COMMANDS and command != "emergency-stop":
        raise HTTPException(429, "相同指令请间隔 30 秒")
    revision = robot.revision
    claimed = await db.execute(update(Robot).where(Robot.id == robot.id, Robot.revision == revision)
                               .values(revision=revision + 1))
    if claimed.rowcount != 1:
        raise HTTPException(409, "机器人状态已变化，请刷新后重试")
    # Locking is immediate locally; unlocking waits for device acknowledgment.
    if command == "lock":
        robot.locked, robot.lock_reason = True, str(params["reason"])[:255]
    if command == "emergency-stop":
        robot.emergency = True
    row = Command(robot_id=robot.id, command=command, params=params, operator=actor, key=key,
                  expires_at=now() + timedelta(minutes=30 if command in {"upgrade", "rollback"} else 2))
    db.add(row)
    audit(db, actor, "command", f"排队下发 {command}", robot.id)
    await db.flush()
    return row


async def finish_command(db, robot, command, status, result):
    if command.robot_id != robot.id:
        raise HTTPException(404, "指令不存在")
    if command.status in TERMINAL:
        if command.status != status:
            raise HTTPException(409, "指令已结束，不能覆盖结果")
        return
    if command.expires_at < now():
        raise HTTPException(409, "指令已过期")
    if command.status == "running" and status == "accepted":
        raise HTTPException(409, "不能回退指令状态")
    previous_command_status = command.status
    command.status, command.result = status, result
    if command.command in {"execute-task", "goto-point", "goto-charge"} and status in {"accepted", "running"}:
        command.expires_at = now() + timedelta(minutes=2)
    if status == "success":
        if command.command == "unlock":
            robot.locked, robot.lock_reason = False, ""
        elif command.command == "release-stop":
            robot.emergency = False
        elif command.command == "emergency-stop" and command.params.get("task_id"):
            run = await db.get(TaskRun, command.params["task_id"])
            execution = await db.get(Command, command.params.get("execute_command_id"))
            if (run and execution and run.robot_id == robot.id and execution.robot_id == robot.id
                    and execution.command == "execute-task" and execution.params.get("task_id") == run.id):
                if run.status in {"dispatched", "running"}:
                    run.status, run.finished_at, run.failure = "cancelled", now(), ""
                    run.timeline = run.timeline + [{"at": now().isoformat() + "Z", "status": "cancelled",
                        "note": f"设备确认停止并锁定，指令 {command.id}"}]
                if execution.status in {"queued", "accepted", "running"}:
                    execution.status, execution.result = "cancelled", "设备确认停止并锁定"
    if command.command == "execute-task":
        run = await db.get(TaskRun, command.params["task_id"])
        if run and run.status not in TERMINAL:
            previous_status = run.status
            run.status = "running" if status in {"accepted", "running"} else status
            if not run.started_at:
                run.started_at = now()
            if status in TERMINAL:
                run.finished_at = now()
                run.failure = result if status != "success" else ""
            if run.status != previous_status:
                run.timeline = run.timeline + [{"at": now().isoformat() + "Z", "status": run.status, "note": result}]
    if previous_command_status != status:
        audit(db, "device:" + robot.code, "command", f"{command.command}: {status} {result}", robot.id)
