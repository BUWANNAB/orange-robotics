import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch_ros.actions import Node


def generate_launch_description():
    runtime_share = get_package_share_directory("orange_runtime")
    return LaunchDescription([
        Node(package="orange_runtime", executable="global_relocalization", output="screen",
             parameters=[os.path.join(runtime_share, "config", "relocalization.yaml")],
             additional_env={"OMP_NUM_THREADS": "2"}),
        IncludeLaunchDescription(PythonLaunchDescriptionSource(os.path.join(
            get_package_share_directory("lidar_localization_ros2"), "launch", "lidar_localization.launch.py"))),
        IncludeLaunchDescription(PythonLaunchDescriptionSource(os.path.join(
            get_package_share_directory("tf_to_pose"), "launch", "tf_to_pose.launch.py"))),
    ])
