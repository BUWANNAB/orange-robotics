import json
from datetime import datetime
from typing import List, Optional
from sqlalchemy import Column, BigInteger, Integer, String, SmallInteger, DateTime, func
from app.database import Base

def safe_float(val: Optional[str], default: float = 0.0) -> float:
    if val is None or val == "":
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default

def safe_int(val: Optional[str], default: int = 0) -> int:
    if val is None or val == "":
        return default
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return default

# 跨数据库主键类型 (MySQL 下 BIGINT，SQLite 下 INTEGER 以支持 AUTOINCREMENT)
PK_BIGINT = BigInteger().with_variant(Integer, "sqlite")

class Route(Base):
    __tablename__ = "t_route"

    id = Column(PK_BIGINT, primary_key=True, autoincrement=True, comment="主键")

    routeName = Column(String(50), default="", comment="路线名称")
    mapCoverage = Column(String(50), default="", comment="路线编码/地图覆盖")
    stationIds = Column(String(1024), default="", comment="站点id集合(JSON数组或逗号隔开)")
    routesource = Column(String(45), default="")
    routeDetail = Column(String(45), default="")
    mapName = Column(String(45), default="")
    routeGroup = Column(String(45), default="")
    speed = Column(String(45), default="")
    isDelete = Column(SmallInteger, default=0, comment="是否删除(0正常 1删除)")
    createTime = Column(DateTime, default=func.now())
    updateTime = Column(DateTime, default=func.now(), onupdate=func.now())

    @property
    def station_id_list(self) -> List[int]:
        if not self.stationIds:
            return []
        raw = self.stationIds.strip()
        if raw.startswith("[") and raw.endswith("]"):
            try:
                return [int(x) for x in json.loads(raw)]
            except Exception:
                pass
        # 兼容逗号隔开格式
        ids = []
        for part in raw.split(","):
            part = part.strip()
            if part.isdigit():
                ids.append(int(part))
        return ids

    @property
    def speed_value(self) -> float:
        return safe_float(self.speed, 0.0)


class Station(Base):
    __tablename__ = "t_station"

    id = Column(PK_BIGINT, primary_key=True, autoincrement=True, comment="主键")
    stationName = Column(String(500), default="", comment="站点名称")
    stationCode = Column(String(50), default="", comment="站点编码")
    longitude = Column(String(450), default="")
    latitude = Column(String(45), default="")
    positionX = Column(String(50), default="", comment="站点x坐标")
    positionY = Column(String(50), default="", comment="站点y坐标")
    positionZ = Column(String(50), default="", comment="站点z坐标")
    orientationX = Column(String(50), default="", comment="四元数X")
    orientationY = Column(String(50), default="", comment="四元数Y")
    orientationZ = Column(String(50), default="", comment="四元数Z")
    orientationW = Column(String(50), default="", comment="四元数W")
    map_name = Column(String(255), nullable=True)
    isDelete = Column(SmallInteger, default=0, comment="是否删除")
    createTime = Column(DateTime, default=func.now())
    updateTime = Column(DateTime, default=func.now(), onupdate=func.now())

    @property
    def x(self) -> float:
        return safe_float(self.positionX, 0.0)

    @property
    def y(self) -> float:
        return safe_float(self.positionY, 0.0)

    @property
    def z(self) -> float:
        return safe_float(self.positionZ, 0.0)


class RouteDetail(Base):
    __tablename__ = "t_route_detail"

    id = Column(PK_BIGINT, primary_key=True, autoincrement=True, comment="主键")

    routeId = Column(BigInteger, default=0, comment="路线id")
    stationId = Column(BigInteger, default=0, comment="站点id")
    speed = Column(String(50), default="", comment="速度")
    area = Column(String(45), default="")
    direction = Column(String(50), default="", comment="方向角")
    stopTime = Column(String(50), default="", comment="停留时间/作业时长")
    action = Column(String(45), default="")
    position = Column(String(45), default="", comment="定位模式 (在Java中被作为locationMode)")
    stop = Column(String(45), default="")
    runmode = Column(String(45), default="", comment="运行模式 (0追踪 1自转)")
    lanechange = Column(String(45), default="")
    direction_option = Column(String(32), default="useAngle", comment="方向选项")
    isDelete = Column(SmallInteger, default=0, comment="是否删除")
    createTime = Column(DateTime, default=func.now())
    updateTime = Column(DateTime, default=func.now(), onupdate=func.now())

    @property
    def speed_value(self) -> float:
        return safe_float(self.speed, 0.0)

    @property
    def yaw_value(self) -> float:
        return safe_float(self.direction, 0.0)

    @property
    def stop_time_value(self) -> float:
        return safe_float(self.stopTime, 0.0)

    @property
    def run_mode_int(self) -> int:
        return safe_int(self.runmode, 0)

    @property
    def location_mode_int(self) -> int:
        return safe_int(self.position, 0)


class Param(Base):
    __tablename__ = "t_param"

    id = Column(Integer, primary_key=True, autoincrement=True)
    vehicle_mode = Column(String(50), default="agv")
    navigation_mode = Column(String(50), default="ndt")
    local_origin_longitude = Column(String(50), default="117.283042")
    local_origin_latitude = Column(String(50), default="31.86119")
    samplInte = Column(String(50), default="0.1")
    speed_run = Column(String(50), default="0.4", comment="默认巡航运行速度")
    speed_max = Column(String(50), default="1.0")
    speed_min = Column(String(50), default="0.1")
    speed_down = Column(String(50), default="0.2")
    rotation = Column(String(50), default="0.5")
    stop_set = Column(String(50), default="0.3")
    remote_mode = Column(String(50), default="0")
    relative_x = Column(String(50), default="0")
    relative_y = Column(String(50), default="0")
    forwordDis = Column(String(50), default="1.2")
    wheelBase = Column(String(50), default="0.8")
    lpropellerl = Column(String(50), default="1.0")
    rpropellerl = Column(String(50), default="1.0")
    upward = Column(String(50), default="0.65")
    reduced = Column(String(50), default="0.0")
    scandis_max = Column(String(50), default="25.0")
    scandis_min = Column(String(50), default="0.15")
    lidarinstallpara_x = Column(String(50), default="-0.5")
    lidarinstallpara_y = Column(String(50), default="0.0")
    lidarinstallpara_z = Column(String(50), default="0.65")
    lidarinstallpara_yaw = Column(String(50), default="90.0")
    lidarinstallpara_pitch = Column(String(50), default="0.0")
    lidarinstallpara_roll = Column(String(50), default="0.0")
    isDelete = Column(SmallInteger, default=0)

    def to_dict(self):
        return {
            "id": self.id,
            "vehicle_mode": self.vehicle_mode or "",
            "navigation_mode": self.navigation_mode or "",
            "local_origin_longitude": self.local_origin_longitude or "",
            "local_origin_latitude": self.local_origin_latitude or "",
            "samplInte": self.samplInte or "0.1",
            "speed_run": self.speed_run or "0.4",
            "speed_max": self.speed_max or "1.0",
            "speed_min": self.speed_min or "0.1",
            "speed_down": self.speed_down or "0.2",
            "rotation": self.rotation or "0.5",
            "stop_set": self.stop_set or "0.3",
            "remote_mode": self.remote_mode or "0",
            "relative_x": self.relative_x or "0",
            "relative_y": self.relative_y or "0",
            "forwordDis": self.forwordDis or "1.2",
            "wheelBase": self.wheelBase or "0.8",
            "lpropellerl": self.lpropellerl or "1.0",
            "rpropellerl": self.rpropellerl or "1.0",
            "upward": self.upward or "0.65",
            "reduced": self.reduced or "0.0",
            "scandis_max": self.scandis_max or "25.0",
            "scandis_min": self.scandis_min or "0.15",
            "lidarinstallpara_x": self.lidarinstallpara_x or "-0.5",
            "lidarinstallpara_y": self.lidarinstallpara_y or "0.0",
            "lidarinstallpara_z": self.lidarinstallpara_z or "0.65",
            "lidarinstallpara_yaw": self.lidarinstallpara_yaw or "90.0",
            "lidarinstallpara_pitch": self.lidarinstallpara_pitch or "0.0",
            "lidarinstallpara_roll": self.lidarinstallpara_roll or "0.0",
            "isDelete": self.isDelete
        }
