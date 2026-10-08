import os
import json
import math
from pathlib import Path
from launch import LaunchDescription
from launch_ros.actions import Node

def generate_launch_description():
    config=os.environ.get('MID360_CONFIG_FILE','')
    if not config or not Path(config).is_file():raise RuntimeError('MID360_CONFIG_FILE must point to the verified sensor configuration')
    sensor=json.loads(Path(config).read_text(encoding='utf-8'))
    if ('MID360' in sensor)==('Mid360s' in sensor):
        raise RuntimeError('sensor configuration must select exactly one supported model')
    mount=sensor.get('robot_mount')
    if not isinstance(mount,dict) or any(k not in mount for k in ('x','y','z','roll','pitch','yaw')):
        raise RuntimeError('robot_mount must contain measured base_link to livox_frame extrinsics')
    if len(sensor.get('lidar_configs',[]))!=1 or any(
            float(v)!=0 for v in sensor['lidar_configs'][0].get('extrinsic_parameter',{}).values()):
        raise RuntimeError('Livox driver extrinsics must be zero; robot_mount supplies the single static TF')
    x,y,z=(float(mount[k])/1000.0 for k in ('x','y','z'))
    roll,pitch,yaw=(math.radians(float(mount[k])) for k in ('roll','pitch','yaw'))
    if not all(math.isfinite(v) for v in (x,y,z,roll,pitch,yaw)):
        raise RuntimeError('robot_mount contains non-finite values')
    cr,sr=math.cos(roll/2),math.sin(roll/2)
    cp,sp=math.cos(pitch/2),math.sin(pitch/2)
    cy,sy=math.cos(yaw/2),math.sin(yaw/2)
    quaternion=(sr*cp*cy-cr*sp*sy,cr*sp*cy+sr*cp*sy,
                cr*cp*sy-sr*sp*cy,cr*cp*cy+sr*sp*sy)
    return LaunchDescription([
        Node(package='tf2_ros',executable='static_transform_publisher',name='livox_mount_tf',
             arguments=[*(str(v) for v in (x,y,z,*quaternion)),'base_link','livox_frame']),
        Node(package='livox_ros_driver2',executable='livox_ros_driver2_node',name='livox_lidar_publisher',output='screen',
             parameters=[{'xfer_format':1,'multi_topic':0,'data_src':0,'publish_freq':10.0,'output_data_type':0,
                          'frame_id':'livox_frame','user_config_path':config,'cmdline_input_bd_code':'livox0000000001'}],
             remappings=[('/livox/lidar','/livox/lidar_custom')]),
        Node(package='orange_runtime',executable='livox_cloud_converter',name='livox_cloud_converter',output='screen'),
    ])
