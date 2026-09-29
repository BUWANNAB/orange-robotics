"""Keep one Livox driver: custom packets for SLAM, XYZI clouds for localization."""
import math
import struct

def pack_points(points):
    data=bytearray()
    for point in points:
        if all(math.isfinite(v) for v in (point.x,point.y,point.z)):
            data.extend(struct.pack('<ffff',point.x,point.y,point.z,float(point.reflectivity)))
    return bytes(data)

def main(args=None):
    import rclpy
    from rclpy.node import Node
    from rclpy.qos import qos_profile_sensor_data
    from sensor_msgs.msg import PointCloud2,PointField
    from livox_ros_driver2.msg import CustomMsg
    rclpy.init(args=args)
    node=Node('livox_cloud_converter')
    publisher=node.create_publisher(PointCloud2,'/livox/lidar',qos_profile_sensor_data)
    def convert(msg):
        data=pack_points(msg.points)
        if not data:return
        cloud=PointCloud2();cloud.header=msg.header;cloud.height=1;cloud.width=len(data)//16
        cloud.fields=[PointField(name=name,offset=index*4,datatype=PointField.FLOAT32,count=1)
                      for index,name in enumerate(('x','y','z','intensity'))]
        cloud.is_bigendian=False;cloud.point_step=16;cloud.row_step=len(data);cloud.is_dense=True;cloud.data=data
        publisher.publish(cloud)
    node.create_subscription(CustomMsg,'/livox/lidar_custom',convert,qos_profile_sensor_data)
    try:rclpy.spin(node)
    finally:node.destroy_node();rclpy.shutdown()
