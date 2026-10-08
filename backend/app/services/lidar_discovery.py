"""Read-only Livox MID-360/MID-360S discovery on one local Ethernet interface."""

import ipaddress
import json
import platform
import select
import shutil
import socket
import struct
import subprocess
import time
import zlib
from typing import Any, Dict, Optional


DETECTION_PORT = 56000
_SDK_SOF = 0xAA
_SDK_VERSION = 0
_SEARCH_COMMAND = 0x0000
_SDK_HEADER_SIZE = 24
_DETECTION_DATA = struct.Struct("<BB16s4sH")
_DEVICE_MODELS = {9: "MID-360", 35: "MID-360S"}


class LidarDiscoveryError(RuntimeError):
    def __init__(self, message: str, status_code: int = 409):
        super().__init__(message)
        self.status_code = status_code


def _crc16_ccitt_false(data: bytes) -> int:
    """Livox SDK2's 0x1021/0xffff header CRC, returned as an integer."""
    crc = 0xFFFF
    for value in data:
        crc ^= value << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def build_search_packet(sequence: int) -> bytes:
    """Build SDK2's empty LidarSearch request; it does not write device settings."""
    sequence &= 0xFFFF
    header = struct.pack("<BBHIHBB6s", _SDK_SOF, _SDK_VERSION, _SDK_HEADER_SIZE,
                         sequence, _SEARCH_COMMAND, 0, 0, b"\0" * 6)
    return header + struct.pack("<HI", _crc16_ccitt_false(header), 0)


def parse_search_response(packet: bytes, source_ip: str,
                          expected_sequence: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """Validate a Livox SDK2 LidarSearch response and return a supported/other device."""
    if len(packet) < _SDK_HEADER_SIZE + _DETECTION_DATA.size:
        return None

    sof, version, length, sequence, command, command_type, sender_type = struct.unpack_from(
        "<BBHIHBB", packet, 0)
    if (sof != _SDK_SOF or version != _SDK_VERSION or length != len(packet)
            or length < _SDK_HEADER_SIZE or command != _SEARCH_COMMAND
            or command_type != 1 or sender_type != 1):
        return None
    if expected_sequence is not None and sequence != (expected_sequence & 0xFFFF):
        return None

    header_crc, data_crc = struct.unpack_from("<HI", packet, 18)
    payload = packet[_SDK_HEADER_SIZE:]
    if header_crc != _crc16_ccitt_false(packet[:18]):
        return None
    if data_crc != (zlib.crc32(payload) & 0xFFFFFFFF):
        return None

    ret_code, device_type, serial_bytes, reported_ip, _command_port = _DETECTION_DATA.unpack_from(payload)
    if ret_code != 0:
        return None
    try:
        address = str(ipaddress.IPv4Address(source_ip))
        reported_address = str(ipaddress.IPv4Address(reported_ip))
    except ipaddress.AddressValueError:
        return None
    # The SDK uses the UDP source address as the lidar handle. Refuse inconsistent payloads.
    if address != reported_address:
        return None

    return {
        "ip": address,
        "model": _DEVICE_MODELS.get(device_type, f"其他 Livox（type {device_type}）"),
        "device_type": device_type,
        "supported": device_type in _DEVICE_MODELS,
        "serial_number": serial_bytes.split(b"\0", 1)[0].decode("ascii", errors="replace"),
    }


def _local_global_ipv4_interfaces() -> Dict[str, str]:
    ip_tool = shutil.which("ip")
    if not ip_tool:
        raise LidarDiscoveryError("本机缺少 iproute2 的 ip 命令，无法核实雷达网口地址")
    try:
        result = subprocess.run([ip_tool, "-j", "-4", "addr", "show", "up", "scope", "global"],
                                check=True, capture_output=True, text=True, timeout=2)
        interfaces = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as exc:
        raise LidarDiscoveryError(f"读取本机网络接口失败：{exc}") from exc
    addresses: Dict[str, str] = {}
    for interface in interfaces if isinstance(interfaces, list) else []:
        interface_name = interface.get("ifname")
        if not isinstance(interface_name, str) or not interface_name:
            continue
        for info in interface.get("addr_info", []):
            address = info.get("local")
            if info.get("family") == "inet" and address:
                addresses[address] = interface_name
    return addresses


def _bind_discovery_socket(sock: socket.socket, interface_name: str) -> None:
    """Receive Livox's limited-broadcast replies only on the selected NIC."""
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE,
                        interface_name.encode("utf-8") + b"\0")
    except OSError as exc:
        raise LidarDiscoveryError(f"无法绑定雷达网卡 {interface_name}：{exc}") from exc
    try:
        # MID-360(S) sends LidarSearch responses to 255.255.255.255:56000.
        # A socket bound to the host's unicast address does not receive them.
        sock.bind(("0.0.0.0", DETECTION_PORT))
    except OSError as exc:
        if getattr(exc, "errno", None) in {98, 10048}:
            raise LidarDiscoveryError(
                "Livox 检测端口 56000 正被占用，可能雷达驱动仍在运行；请先停止雷达驱动后再扫描"
            ) from exc
        raise LidarDiscoveryError(f"无法绑定雷达网卡 {interface_name} 的 UDP 56000 接收端口：{exc}") from exc


def scan_livox_devices(host_ip: str, timeout_seconds: float = 3.0) -> Dict[str, Any]:
    """Send only SDK2 search broadcasts over the selected local NIC and collect replies."""
    if platform.system() != "Linux":
        raise LidarDiscoveryError("雷达扫描需在连接雷达网口的 Linux 工控机后端执行；当前环境不支持实机扫描")
    try:
        address = ipaddress.IPv4Address(host_ip)
    except ipaddress.AddressValueError as exc:
        raise LidarDiscoveryError("工控机雷达网口 IP 必须是有效 IPv4 地址", 400) from exc
    if address.is_loopback or address.is_unspecified or address.is_multicast or not address.is_private:
        raise LidarDiscoveryError("请选择工控机连接雷达网线的局域网 IPv4 地址", 400)
    if not 1.0 <= float(timeout_seconds) <= 6.0:
        raise LidarDiscoveryError("扫描时长必须在 1 到 6 秒之间", 400)
    interface_name = _local_global_ipv4_interfaces().get(str(address))
    if not interface_name:
        raise LidarDiscoveryError("该 IP 不是本机已启用网卡地址；请从工控机雷达网口配置中选择", 400)

    sequence = int(time.monotonic() * 1000) & 0xFFFF
    request = build_search_packet(sequence)
    devices: Dict[str, Dict[str, Any]] = {}
    started = time.monotonic()
    deadline = started + float(timeout_seconds)
    next_send = started

    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        # Deliberately do not enable SO_REUSEADDR/SO_REUSEPORT: scanning must not
        # compete with a running Livox driver bound to the same SDK discovery port.
        _bind_discovery_socket(sock, interface_name)

        while time.monotonic() < deadline:
            now = time.monotonic()
            if now >= next_send:
                try:
                    sock.sendto(request, ("255.255.255.255", DETECTION_PORT))
                except OSError as exc:
                    raise LidarDiscoveryError(f"向 {address} 发送雷达发现广播失败：{exc}") from exc
                next_send = now + 1.0

            wait_for = max(0.0, min(deadline - time.monotonic(), next_send - time.monotonic()))
            readable, _, _ = select.select([sock], [], [], wait_for)
            if not readable:
                continue
            try:
                response, peer = sock.recvfrom(4096)
            except OSError as exc:
                raise LidarDiscoveryError(f"读取雷达发现响应失败：{exc}") from exc
            device = parse_search_response(response, peer[0], sequence)
            if device:
                devices[device["ip"]] = device

    return {
        "host_ip": str(address),
        "devices": sorted(devices.values(), key=lambda item: item["ip"]),
        "duration_ms": round((time.monotonic() - started) * 1000),
        "read_only": True,
    }
