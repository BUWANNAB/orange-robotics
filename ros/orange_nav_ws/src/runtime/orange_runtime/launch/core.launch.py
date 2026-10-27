import os
import json
import logging
from pathlib import Path
from launch import LaunchDescription
from launch_ros.actions import Node
from orange_runtime.robot_model import DEFAULT_MODEL, mount_from_sensor, load_model, build_urdf

def generate_launch_description():
    config=os.environ.get('MID360_CONFIG_FILE','')
    if not config or not Path(config).is_file():raise RuntimeError('MID360_CONFIG_FILE must point to the verified sensor configuration')
    sensor=json.loads(Path(config).read_text(encoding='utf-8'))
    if ('MID360' in sensor)==('Mid360s' in sensor):
        raise RuntimeError('sensor configuration must select exactly one supported model')
    try:
        mount=mount_from_sensor(sensor)
    except ValueError as exc:
        raise RuntimeError(str(exc)) from exc
    if len(sensor.get('lidar_configs',[]))!=1 or any(
            float(v)!=0 for v in sensor['lidar_configs'][0].get('extrinsic_parameter',{}).values()):
        raise RuntimeError('Livox driver extrinsics must be zero; robot_mount supplies the single static TF')
    try:
        model = load_model()
    except (ValueError, OSError) as exc:
        logging.getLogger('orange_runtime').warning('Visual body model invalid; using UNMEASURED default: %s', exc)
        model = DEFAULT_MODEL
    return LaunchDescription([
        Node(package='robot_state_publisher',executable='robot_state_publisher',name='orange_robot_state_publisher',
             parameters=[{'robot_description':build_urdf(model,mount)}],output='screen'),
        Node(package='livox_ros_driver2',executable='livox_ros_driver2_node',name='livox_lidar_publisher',output='screen',
             parameters=[{'xfer_format':1,'multi_topic':0,'data_src':0,'publish_freq':10.0,'output_data_type':0,
                          'frame_id':'livox_frame','user_config_path':config,'cmdline_input_bd_code':'livox0000000001'}],
             remappings=[('/livox/lidar','/livox/lidar_custom')]),
        Node(package='orange_runtime',executable='livox_cloud_converter',name='livox_cloud_converter',output='screen'),
    ])
