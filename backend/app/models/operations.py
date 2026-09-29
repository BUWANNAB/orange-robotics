"""Additive RCS/RDS tables. Existing route/task/map tables are left intact."""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, JSON, Text, UniqueConstraint, Index
from app.database import Base


class Record:
    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    operator = Column(String(128), nullable=False, default="system")


class RevokedToken(Base):
    __tablename__ = "rcs_revoked_token"
    token_hash = Column(String(64), primary_key=True)
    expires_at = Column(DateTime, nullable=False, index=True)


class Robot(Record, Base):
    __tablename__ = "rcs_robot"
    code = Column(String(80), unique=True, nullable=False)
    name = Column(String(128), nullable=False)
    model = Column(String(80), nullable=False)
    area = Column(String(128), default="")
    ip = Column(String(45), default="")
    firmware = Column(String(80), default="")
    hardware = Column(String(80), default="")
    map_id = Column(Integer, nullable=True, index=True)
    enabled = Column(Boolean, default=True, nullable=False)
    deleted = Column(Boolean, default=False, nullable=False)
    locked = Column(Boolean, default=False, nullable=False)
    emergency = Column(Boolean, default=False, nullable=False)
    maintenance = Column(Boolean, default=False, nullable=False)
    upgrade_reservation = Column(Integer, nullable=True, index=True)
    lock_reason = Column(String(255), default="")
    device_key_hash = Column(String(64), nullable=False)
    heartbeat = Column(DateTime, nullable=True, index=True)
    seq = Column(Integer, default=-1, nullable=False)
    telemetry = Column(JSON, default=dict, nullable=False)
    policy = Column(JSON, default=lambda: {"critical": 10, "low": 20, "full": 95, "auto_charge": False})
    revision = Column(Integer, default=0, nullable=False)


class BatterySample(Record, Base):
    __tablename__ = "rcs_battery_sample"
    robot_id = Column(Integer, nullable=False)
    percent = Column(Float, nullable=False)
    voltage = Column(Float)
    temperature = Column(Float)
    charging = Column(Boolean, nullable=False, default=False)
    __table_args__ = (Index("ix_battery_robot_time", "robot_id", "created_at"),)


class Alarm(Record, Base):
    __tablename__ = "rcs_alarm"
    robot_id = Column(Integer, nullable=True, index=True)
    code = Column(String(80), nullable=False)
    level = Column(String(20), nullable=False)
    title = Column(String(255), nullable=False)
    status = Column(String(20), default="open", nullable=False, index=True)
    note = Column(Text, default="")
    acknowledged_by = Column(String(128))
    acknowledged_at = Column(DateTime)
    closed_at = Column(DateTime)
    count = Column(Integer, default=1, nullable=False)
    __table_args__ = (Index("ix_alarm_robot_code_time", "robot_id", "code", "created_at"),)


class Command(Record, Base):
    __tablename__ = "rcs_command"
    robot_id = Column(Integer, nullable=False, index=True)
    command = Column(String(40), nullable=False)
    params = Column(JSON, default=dict, nullable=False)
    status = Column(String(24), default="queued", nullable=False, index=True)
    result = Column(Text, default="")
    key = Column(String(128), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    __table_args__ = (UniqueConstraint("robot_id", "key", name="uq_command_robot_key"),)


class TaskRun(Record, Base):
    __tablename__ = "rds_task_run"
    name = Column(String(128), nullable=False)
    legacy_task_id = Column(Integer, nullable=True)
    robot_id = Column(Integer, nullable=True, index=True)
    map_id = Column(Integer, nullable=False)
    source = Column(String(80), default="manual", nullable=False)
    external_id = Column(String(128), nullable=True)
    priority = Column(Integer, default=5, nullable=False)
    from_point = Column(String(80), nullable=False)
    to_point = Column(String(80), nullable=False)
    status = Column(String(24), default="queued", nullable=False, index=True)
    started_at = Column(DateTime)
    finished_at = Column(DateTime)
    deadline = Column(DateTime)
    failure = Column(Text, default="")
    timeline = Column(JSON, default=list, nullable=False)
    payload_hash = Column(String(64))
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_task_source_external"),)


class AuditLog(Record, Base):
    __tablename__ = "rcs_audit_log"
    level = Column(String(16), default="INFO", nullable=False, index=True)
    module = Column(String(40), nullable=False)
    robot_id = Column(Integer, nullable=True)
    task_id = Column(Integer, nullable=True)
    trace_id = Column(String(80), nullable=False, index=True)
    message = Column(Text, nullable=False)


class MapDocument(Record, Base):
    __tablename__ = "rds_map"
    name = Column(String(128), nullable=False, unique=True)
    revision = Column(Integer, default=0, nullable=False)
    published_version = Column(Integer, default=0, nullable=False)
    draft = Column(JSON, default=dict, nullable=False)
    lock_owner = Column(String(128))
    lock_until = Column(DateTime)
    deleted = Column(Boolean, default=False, nullable=False)


class MapVersion(Record, Base):
    __tablename__ = "rds_map_version"
    map_id = Column(Integer, nullable=False)
    version = Column(Integer, nullable=False)
    document = Column(JSON, nullable=False)
    __table_args__ = (UniqueConstraint("map_id", "version", name="uq_map_version"),)


class IntegrationApp(Record, Base):
    __tablename__ = "rds_integration_app"
    code = Column(String(80), unique=True, nullable=False)
    name = Column(String(128), nullable=False)
    secret = Column(Text, nullable=False)
    enabled = Column(Boolean, default=True, nullable=False)
    ips = Column(JSON, default=list, nullable=False)
    callback_url = Column(String(1000), default="")
    qps = Column(Integer, default=50, nullable=False)


class Nonce(Base):
    __tablename__ = "rds_integration_nonce"
    key = Column(String(180), primary_key=True)
    expires_at = Column(DateTime, nullable=False, index=True)


class Callback(Record, Base):
    __tablename__ = "rds_callback"
    task_id = Column(Integer, nullable=False, unique=True)
    app_id = Column(Integer, nullable=False)
    status = Column(String(24), default="pending", nullable=False, index=True)
    attempts = Column(Integer, default=0, nullable=False)
    next_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    result = Column(String(500), default="")


class Firmware(Record, Base):
    __tablename__ = "rcs_firmware"
    name = Column(String(128), nullable=False)
    version = Column(String(80), nullable=False)
    model = Column(String(80), nullable=False)
    min_hardware = Column(String(80), default="")
    sha256 = Column(String(64), nullable=False)
    size = Column(Integer, nullable=False)
    received = Column(Integer, default=0, nullable=False)
    status = Column(String(24), default="uploading", nullable=False)
    changelog = Column(Text, default="")
    auditor = Column(String(128))
    __table_args__ = (UniqueConstraint("model", "version", name="uq_firmware_model_version"),)


class Upgrade(Record, Base):
    __tablename__ = "rcs_upgrade"
    name = Column(String(128), nullable=False)
    package_id = Column(Integer, nullable=False)
    status = Column(String(24), default="pending", nullable=False, index=True)
    batch_size = Column(Integer, default=5, nullable=False)
    interval_seconds = Column(Integer, default=120, nullable=False)
    next_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class UpgradeDetail(Record, Base):
    __tablename__ = "rcs_upgrade_detail"
    task_id = Column(Integer, nullable=False, index=True)
    robot_id = Column(Integer, nullable=False, index=True)
    version_from = Column(String(80), default="")
    status = Column(String(24), default="waiting", nullable=False)
    progress = Column(Integer, default=0, nullable=False)
    error = Column(String(500), default="")
    attempts = Column(Integer, default=0, nullable=False)
    command_id = Column(Integer)
    __table_args__ = (UniqueConstraint("task_id", "robot_id", name="uq_upgrade_robot"),)


TABLES = [Robot.__table__, BatterySample.__table__, Alarm.__table__, Command.__table__,
          TaskRun.__table__, AuditLog.__table__, MapDocument.__table__, MapVersion.__table__,
          IntegrationApp.__table__, Nonce.__table__, Callback.__table__, Firmware.__table__,
          Upgrade.__table__, UpgradeDetail.__table__]
