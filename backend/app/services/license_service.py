import os
import hashlib
import platform
import uuid
import logging
from typing import Dict, Any

logger = logging.getLogger("orange_agv.license_service")

class LicenseService:
    """硬件绑定解耦与授权状态诊断服务"""

    @classmethod
    def get_hardware_info(cls) -> Dict[str, Any]:
        """获取机器硬件特征与当前授权状态"""
        # 获取网卡 MAC
        mac_num = uuid.getnode()
        mac_str = ':'.join(f'{(mac_num >> elements) & 0xff:02x}' for elements in range(0, 2 * 6, 2)[::-1])
        
        # 计算硬件指纹 ID
        raw_fingerprint = f"{platform.node()}-{platform.machine()}-{mac_str}"
        hw_id = hashlib.sha256(raw_fingerprint.encode("utf-8")).hexdigest()[:32].upper()

        # 检查是否处于脱机解耦/仿真绕过模式
        disable_bind = os.getenv("DISABLE_HARDWARE_BIND", "true").lower() in ("1", "true")
        
        # 模拟授权状态 (当环境变量放行时直接就绪)
        is_licensed = disable_bind or os.path.exists("license.key")

        return {
            "hardware_id": hw_id,
            "mac_address": mac_str,
            "hostname": platform.node(),
            "cpu_arch": platform.machine(),
            "os": platform.system(),
            "license_mode": "Development / Bypass" if disable_bind else "Production (Hardware Locked)",
            "is_authorized": is_licensed,
            "bypass_enabled": disable_bind,
            "expiration_date": "Permanent / 无限制" if disable_bind else "2028-12-31"
        }

    @classmethod
    def activate_license(cls, license_key: str) -> bool:
        """激活/更新机器授权码"""
        if not license_key or len(license_key.strip()) < 8:
            return False
        try:
            with open("license.key", "w", encoding="utf-8") as f:
                f.write(license_key.strip())
            logger.info("授权码已成功写入 license.key")
            return True
        except Exception as e:
            logger.error("写入授权码失败: %s", str(e))
            return False
