import os
from launch import LaunchDescription
from launch.actions import IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
from ament_index_python.packages import get_package_share_directory
from launch_ros.actions import Node

def generate_launch_description():
    return LaunchDescription([Node(package='orange_runtime',executable='global_relocalization',output='screen',
        parameters=[os.path.join(get_package_share_directory('orange_runtime'),'config','relocalization.yaml')],
        additional_env={'OMP_NUM_THREADS':'2'}),
        *[IncludeLaunchDescription(PythonLaunchDescriptionSource(os.path.join(
        get_package_share_directory(package),'launch',filename))) for package,filename in [
        ('lidar_localization_ros2','lidar_localization.launch.py'),('tf_to_pose','tf_to_pose.launch.py'),
        ('vehicle_navigation','vehicle_navigation.launch.py')]]])
