import ipaddress
import os

from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    if os.environ.get('ROBOT_PLC_PROTOCOL', '') != 'legacy_8_register':
        raise RuntimeError(
            'ROBOT_PLC_PROTOCOL is not verified; refusing to start PLC writes')

    raw_host = os.environ.get('ROBOT_PLC_HOST', '').strip()
    if not raw_host or raw_host.startswith('CHANGE_'):
        raise RuntimeError('ROBOT_PLC_HOST must be set to the verified PLC address')
    try:
        server_ip = str(ipaddress.IPv4Address(raw_host))
        server_port = int(os.environ.get('ROBOT_PLC_PORT', '502'))
    except (ipaddress.AddressValueError, ValueError) as exc:
        raise RuntimeError('ROBOT_PLC_HOST and ROBOT_PLC_PORT must be valid') from exc
    if not 1 <= server_port <= 65535:
        raise RuntimeError('ROBOT_PLC_PORT must be between 1 and 65535')

    return LaunchDescription([
        Node(
            package='ros2plc',
            executable='ros2plc',
            name='ros2plc',
            output='screen',
            parameters=[{'server_ip': server_ip, 'server_port': server_port}],
        )
    ])
