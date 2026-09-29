from typing import Dict, Any, Optional
from pydantic import BaseModel, Field

class LidarExtrinsics(BaseModel):
    """雷达物理安装外参 (相对于小车基准中心 base_link)"""
    x: float = Field(default=-0.50, description="前后偏移 (米, 前正后负)")
    y: float = Field(default=0.0, description="左右偏移 (米, 左正右负)")
    z: float = Field(default=0.65, description="安装高度 (米)")
    roll: float = Field(default=0.0, description="翻滚角 (度)")
    pitch: float = Field(default=0.0, description="俯仰角 (度)")
    yaw: float = Field(default=90.0, description="偏航安装角 (度)")

class LidarFilterParams(BaseModel):
    """点云感知与避障安全过滤阈值"""
    blind_spot_min: float = Field(default=0.15, description="盲区半径 (米, 过滤自车外壳噪点)")
    max_range: float = Field(default=25.0, description="有效探测半径 (米)")
    z_min: float = Field(default=0.05, description="离地裁剪下限 (米, 过滤地面杂波)")
    z_max: float = Field(default=2.00, description="离地上限 (米, 过滤天花板)")

class LidarNetConfig(BaseModel):
    """网络与通信参数 (针对 Livox MID-360)"""
    lidar_ip: str = Field(default="192.168.2.190", description="雷达设备IP")
    host_ip: str = Field(default="192.168.2.5", description="工控机网口IP (4处联动)")
    point_port: int = Field(default=56300, description="点云数据端口")
    cmd_port: int = Field(default=56100, description="控制命令端口")

class LidarFullConfig(BaseModel):
    """雷达完整配置对象"""
    lidar_model: str = Field(default="MID-360", description="雷达硬件型号: Mid-360S 或 Mid-360；S 是型号后缀")
    net: LidarNetConfig = Field(default_factory=LidarNetConfig)
    extrinsics: LidarExtrinsics = Field(default_factory=LidarExtrinsics)
    filter: LidarFilterParams = Field(default_factory=LidarFilterParams)
    status: Dict[str, Any] = Field(default_factory=lambda: {
        "online": None,
        "model": "Livox MID-360",
        "temperature": None,
        "ptp_sync": None,
        "fps": None,
        "points_per_sec": None
    })
