import math
import time
from typing import Dict, Any, Optional

def quaternion_to_heading(x: float, y: float, z: float, w: float) -> float:
    """四元数计算平面航向角 Yaw (度, -180 ~ 180)"""
    siny_cosp = 2.0 * (w * z + x * y)
    cosy_cosp = 1.0 - 2.0 * (y * y + z * z)
    rad = math.atan2(siny_cosp, cosy_cosp)
    deg = math.degrees(rad)
    return deg

def local_to_wgs84(local_x: float, local_y: float, origin_lat: float, origin_lon: float) -> tuple[float, float]:
    """高精度切平面局部平面笛卡尔坐标 (x=东向, y=北向) 转换至 WGS84 经纬度"""
    if abs(origin_lat) < 1e-4 and abs(origin_lon) < 1e-4:
        return 0.0, 0.0
    r_earth = 6378137.0  # 地球赤道半径(米)
    d_lat = (local_y / r_earth) * (180.0 / math.pi)
    d_lon = (local_x / (r_earth * math.cos(math.radians(origin_lat)))) * (180.0 / math.pi)
    return origin_lat + d_lat, origin_lon + d_lon

class VehicleState:
    """车辆状态内存单例：零数据库IO，高频读写"""
    def __init__(self):
        # 局部与全局位姿
        self.x: float = 0.0
        self.y: float = 0.0
        self.z: float = 0.0
        self.qx: float = 0.0
        self.qy: float = 0.0
        self.qz: float = 0.0
        self.qw: float = 1.0
        self.heading: float = 0.0  # 度
        
        # 经纬度
        self.lat: float = 0.0
        self.lon: float = 0.0
        self.origin_lat: float = 0.0
        self.origin_lon: float = 0.0
        
        # 运动学状态
        self.linear_velocity: float = 0.0
        self.angular_velocity: float = 0.0
        
        # 导航与硬件状态
        self.current_station_id: int = 0
        self.run_status: int = 1  # 0准备 1就绪 2巡航 3自转 4暂停 5完成
        self.location_mode: int = 0
        self.charging = None
        self.voltage = None
        self.battery_soc = None
        self.plc_connected = None
        self.source = "disconnected"
        self.pose_received = 0.0
        self.pose_stamp = None
        self.frame_id = "map"
        self.localization_good = False
        self.localization_received = 0.0
        self.fitness = None
        
        self.last_update_time: float = time.time()

    def set_origin(self, lat: float, lon: float):
        """配置经纬度原点 (服务启动时一次性载入内存，拒绝高频查库)"""
        self.origin_lat = lat
        self.origin_lon = lon

    def set_linear_velocity(self, v: float):
        self.linear_velocity = v

    def set_angular_velocity(self, w: float):
        self.angular_velocity = w

    def update_pose(self, x: float, y: float, z: float, qx: float, qy: float, qz: float, qw: float):
        """更新位姿 (供 ROS 话题或模拟器纳秒级写入)"""
        self.x = x
        self.y = y
        self.z = z
        self.qx = qx
        self.qy = qy
        self.qz = qz
        self.qw = qw
        self.heading = quaternion_to_heading(qx, qy, qz, qw)
        
        if self.origin_lat != 0.0 and self.origin_lon != 0.0:
            self.lat, self.lon = local_to_wgs84(x, y, self.origin_lat, self.origin_lon)
            
        self.last_update_time = time.time()
        self.pose_received = time.monotonic()

    def localization(self):
        age = time.monotonic() - self.pose_received if self.pose_received else None
        fresh = age is not None and age < 2.0
        quality = self.localization_good and time.monotonic() - self.localization_received < 2.0
        return {"source": self.source, "fresh": fresh, "age_seconds": age,
                "valid": fresh and quality, "frame_id": self.frame_id,
                "fitness": self.fitness, "stamp": self.pose_stamp}

    def to_car_position_dict(self) -> Dict[str, Any]:
        """严格按现有前端 index.html 期望的 carCurrentPosition 数据协议序列化"""
        return {
            "action": "carCurrentPosition",
            "position": {
                "Lat": round(self.lat, 8),
                "Lon": round(self.lon, 8),
                "High": round(self.z, 3),
                "X": round(self.qx, 6),
                "Y": round(self.qy, 6),
                "Z": round(self.qz, 6),
                "W": round(self.qw, 4),
                "Heading": round(self.heading, 2),
                "LocalX": round(self.x, 3),
                "LocalY": round(self.y, 3)
            },
            "status": {
                "runStatus": self.run_status,
                "stationId": self.current_station_id,
                "battery": round(self.battery_soc, 1) if self.battery_soc is not None else None,
                "plcConnected": self.plc_connected,
                "voltage": self.voltage,
                "timestamp": round(self.last_update_time, 3)
            },
            "localization": self.localization()
        }

# 全局单例
vehicle_state = VehicleState()
