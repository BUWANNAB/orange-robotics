import socket
import struct
import unittest
import zlib
from unittest.mock import Mock, patch

from app.services.lidar_discovery import (
    DETECTION_PORT,
    _bind_discovery_socket,
    build_search_packet,
    parse_search_response,
)


def make_detection_response(ip: str, model_type: int = 9, sequence: int = 73) -> bytes:
    payload = struct.pack("<BB16s4sH", 0, model_type, b"LIVOX-TEST\0\0\0\0\0\0",
                          socket.inet_aton(ip), 56100)
    header = struct.pack("<BBHIHBB6s", 0xAA, 0, 24 + len(payload), sequence,
                         0, 1, 1, b"\0" * 6)
    return header + struct.pack("<HI", _crc16(header), zlib.crc32(payload)) + payload


def _crc16(data: bytes) -> int:
    crc = 0xFFFF
    for value in data:
        crc ^= value << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


class LidarDiscoveryProtocolTests(unittest.TestCase):
    def test_discovery_socket_receives_limited_broadcast_on_selected_interface(self):
        sock = Mock()
        with patch.object(socket, "SO_BINDTODEVICE", 25, create=True):
            _bind_discovery_socket(sock, "enp2s0")

        sock.setsockopt.assert_called_once_with(socket.SOL_SOCKET, 25, b"enp2s0\0")
        sock.bind.assert_called_once_with(("0.0.0.0", DETECTION_PORT))

    def test_search_packet_matches_sdk2_empty_search_frame(self):
        self.assertEqual(_crc16(b"123456789"), 0x29B1)
        packet = build_search_packet(73)
        self.assertEqual(len(packet), 24)
        self.assertEqual(struct.unpack_from("<BBHIHBB", packet), (0xAA, 0, 24, 73, 0, 0, 0))
        self.assertEqual(struct.unpack_from("<HI", packet, 18)[1], 0)
        self.assertEqual(struct.unpack_from("<H", packet, 18)[0], _crc16(packet[:18]))

    def test_detects_mid360_and_mid360s_by_device_type(self):
        classic = parse_search_response(make_detection_response("192.168.2.181"), "192.168.2.181", 73)
        newer = parse_search_response(make_detection_response("192.168.2.182", 35), "192.168.2.182", 73)
        self.assertEqual((classic["model"], classic["ip"], classic["supported"]),
                         ("MID-360", "192.168.2.181", True))
        self.assertEqual((newer["model"], newer["ip"], newer["supported"]),
                         ("MID-360S", "192.168.2.182", True))

    def test_rejects_corrupt_wrong_sequence_and_mismatched_source(self):
        valid = make_detection_response("192.168.2.181")
        corrupt = bytearray(valid)
        corrupt[-1] ^= 0x01
        self.assertIsNone(parse_search_response(bytes(corrupt), "192.168.2.181", 73))
        self.assertIsNone(parse_search_response(valid, "192.168.2.181", 74))
        self.assertIsNone(parse_search_response(valid, "192.168.2.182", 73))

    def test_unsupported_livox_device_is_reported_without_claiming_support(self):
        other = parse_search_response(make_detection_response("192.168.2.181", 7),
                                      "192.168.2.181", 73)
        self.assertFalse(other["supported"])
        self.assertEqual(other["device_type"], 7)


if __name__ == "__main__":
    unittest.main()
