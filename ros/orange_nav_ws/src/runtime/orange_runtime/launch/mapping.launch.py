import os
from pathlib import Path
from launch import LaunchDescription
from launch_ros.actions import Node

def generate_launch_description():
    workspace=os.environ.get('ROBOT_NAV_WS','')
    maps=os.environ.get('ROBOT_PCD_DIR','')
    raster_maps=os.environ.get('ROBOT_MAP_DIR','')
    if (not workspace or not Path(workspace).is_absolute()
            or not (Path(workspace)/'install/setup.bash').is_file()
            or not maps or not Path(maps).is_absolute()
            or not raster_maps or not Path(raster_maps).is_absolute()):
        raise RuntimeError('ROBOT_NAV_WS, ROBOT_PCD_DIR and ROBOT_MAP_DIR must use the shared runtime configuration')
    return LaunchDescription([Node(package='build_map_manager',executable='build_map_manager_node',name='build_map_manager',
        output='screen',parameters=[{'workspace_setup':workspace+'/install/setup.bash','map_base_dir':maps,
                                    'manage_livox':False,'stop_after_save':True,
                                    'lio_sam_launch_cmd':'ros2 launch lio_sam run.launch.py pointcloud_topic:=/livox/lidar_custom use_rviz:=false publish_robot_description:=false'}])])
