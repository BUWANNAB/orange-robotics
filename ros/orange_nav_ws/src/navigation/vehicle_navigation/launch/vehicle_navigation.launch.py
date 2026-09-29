from launch import LaunchDescription
from launch_ros.actions import Node
from ament_index_python.packages import get_package_share_directory
import os

def generate_launch_description():
    # 获取功能包路径
    pkg_dir = get_package_share_directory('vehicle_navigation')
    
    # 构建参数文件绝对路径
    param_file = os.path.join(pkg_dir, 'param', 'purepursuit_params.yaml')
    node_parameters = [param_file]
    
    return LaunchDescription([
        Node(
            package='vehicle_navigation',
            executable='vehicle_navigation_node',
            name='vehicle_navigation_node',
            parameters=node_parameters,
            #arguments=['2'],  # 阿克曼车型
            output='screen',  # 可选：将输出打印到屏幕
            respawn=True,  # 关键配置：启用节点崩溃后自动重启 
            respawn_delay=10  # 可选：重启延迟时间（秒），避免频繁重启            
        )
    ])
