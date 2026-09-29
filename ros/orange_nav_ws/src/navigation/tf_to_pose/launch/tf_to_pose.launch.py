from launch import LaunchDescription
from launch_ros.actions import Node

def generate_launch_description():
    return LaunchDescription([
        Node(
            package='tf_to_pose',
            executable='tf_to_pose_node',
            name='tf_to_pose_node',
            parameters=[{
                'target_frame': 'map',
                'source_frame': 'base_link', 
                'publish_rate': 10.0
            }],
            output='screen'
        ),
    ])
