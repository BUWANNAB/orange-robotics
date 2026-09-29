import logging
from enum import Enum
from typing import Dict, Any, Tuple
from app.services.vehicle_state import vehicle_state

logger = logging.getLogger("orange_agv.mode_manager")

class SystemMode(str, Enum):
    STANDBY = "STANDBY"                  # 待命就绪
    MAPPING = "MAPPING"                  # 激光三维建图 (LIO-SAM)
    RELOCALIZING = "RELOCALIZING"        # 地图重定位配准 (NDT)
    NAVIGATION = "NAVIGATION"            # 自主路径导航 (RPP 纯追踪)
    EMERGENCY_STOP = "EMERGENCY_STOP"    # 急停抱闸保护

class ModeManager:
    """AGV 全系统运行模式状态机管理器 (支持建图 ⇄ 定位 ⇄ 巡航无缝热切换)"""

    _current_mode: SystemMode = SystemMode.STANDBY
    _active_map_name: str = "202609171123"

    # 合法状态转移矩阵 (State Transition Matrix)
    _VALID_TRANSITIONS = {
        SystemMode.STANDBY: [SystemMode.MAPPING, SystemMode.RELOCALIZING, SystemMode.NAVIGATION, SystemMode.EMERGENCY_STOP],
        SystemMode.MAPPING: [SystemMode.STANDBY, SystemMode.EMERGENCY_STOP],
        SystemMode.RELOCALIZING: [SystemMode.STANDBY, SystemMode.NAVIGATION, SystemMode.EMERGENCY_STOP],
        SystemMode.NAVIGATION: [SystemMode.STANDBY, SystemMode.RELOCALIZING, SystemMode.EMERGENCY_STOP],
        SystemMode.EMERGENCY_STOP: [SystemMode.STANDBY]  # 急停解除后必须先回到待命就绪
    }

    @classmethod
    def get_current_mode(cls) -> Dict[str, Any]:
        """获取当前运行模式与状态详情"""
        return {
            "mode": cls._current_mode.value,
            "active_map": cls._active_map_name,
            "is_emergency": cls._current_mode == SystemMode.EMERGENCY_STOP,
            "can_navigate": cls._current_mode in (SystemMode.STANDBY, SystemMode.NAVIGATION),
            "can_map": cls._current_mode in (SystemMode.STANDBY, SystemMode.MAPPING)
        }

    @classmethod
    def switch_mode(cls, target_mode_str: str, map_name: str = "") -> Tuple[bool, str]:
        """优雅热切换运行模式 (淘汰暴力 pkill，保证 TF 树与定位时序无缝流转)"""
        try:
            target_mode = SystemMode(target_mode_str.upper())
        except ValueError:
            return False, f"未知的目标运行模式: {target_mode_str}"

        current = cls._current_mode
        if target_mode == current:
            return True, f"系统已处于 {target_mode.value} 模式"

        # 检查状态机转移合法性
        valid_targets = cls._VALID_TRANSITIONS.get(current, [])
        if target_mode not in valid_targets:
            return False, f"非法模式流转: 无法从 {current.value} 直接切换至 {target_mode.value}"

        logger.info("=== 触发模式热切换: %s ➔ %s ===", current.value, target_mode.value)

        # 执行切换动作
        if target_mode == SystemMode.EMERGENCY_STOP:
            # 立即底盘安全抱闸
            vehicle_state.set_linear_velocity(0.0)
            vehicle_state.set_angular_velocity(0.0)
            logger.warning("[SAFETY] 车辆已触发急停抱闸！")

        elif target_mode == SystemMode.MAPPING:
            # 进入激光建图：通知底盘停止当前巡航，广播建图启动
            vehicle_state.set_linear_velocity(0.0)
            logger.info("[MAPPING] 激光三维建图环境就绪 (LIO-SAM)")

        elif target_mode == SystemMode.RELOCALIZING:
            if map_name:
                cls._active_map_name = map_name
            logger.info("[RELOCALIZING] 启动 NDT 配准定位，当前目标地图: %s", cls._active_map_name)

        elif target_mode == SystemMode.NAVIGATION:
            if current == SystemMode.MAPPING:
                return False, "请先保存建图并切换至待命/重定位模式，再启动路径导航"
            logger.info("[NAVIGATION] 进入自主巡航导航模式 (RPP)")

        cls._current_mode = target_mode
        return True, f"模式成功切换至 {target_mode.value}"
