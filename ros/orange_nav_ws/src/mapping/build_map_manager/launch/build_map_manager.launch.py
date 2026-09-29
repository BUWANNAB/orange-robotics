import os

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    nav_workspace = os.environ.get('ROBOT_NAV_WS', '').strip()
    pcd_dir = os.environ.get('ROBOT_PCD_DIR', '').strip()
    if not nav_workspace or not pcd_dir or not os.path.isabs(nav_workspace) or not os.path.isabs(pcd_dir):
        raise RuntimeError('ROBOT_NAV_WS and ROBOT_PCD_DIR must be set to the shared runtime paths')
    workspace_setup = os.environ.get(
        'LIO_SAM_SETUP', os.path.join(nav_workspace, 'install', 'setup.bash'))
    map_base_dir = pcd_dir

    return LaunchDescription([
        DeclareLaunchArgument(
            'workspace_setup',
            default_value=workspace_setup,
            description='Path to the LIO-SAM workspace setup.bash'),
        DeclareLaunchArgument(
            'map_base_dir',
            default_value=map_base_dir,
            description='Directory where named PCD maps are stored'),
        Node(
            package='build_map_manager',
            executable='build_map_manager_node',
            name='build_map_manager',
            output='screen',
            parameters=[{
                'buildmap_topic': '/buildmap',
                'status_topic': '/buildmap_status',
                'cloud_topic': '/lio_sam/mapping/cloud_registered',
                'save_map_service': '/lio_sam/save_map',
                'workspace_setup': LaunchConfiguration('workspace_setup'),
                'map_base_dir': LaunchConfiguration('map_base_dir'),
                'livox_launch_cmd': 'ros2 launch livox_ros_driver2 msg_MID360_launch.py',
                'lio_sam_launch_cmd': 'ros2 launch lio_sam run.launch.py',
                'map_resolution': 0.1,
                'start_delay_sec': 3.0,
                'save_timeout_sec': 300.0,
                'stop_after_save': True,
            }]
        )
    ])
