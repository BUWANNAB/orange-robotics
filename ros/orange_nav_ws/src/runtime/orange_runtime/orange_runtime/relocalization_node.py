"""ROS transport and stationary/freshness gates for global registration."""
import json
import math
import multiprocessing as mp
import os
import time
from pathlib import Path
import numpy as np
from .relocalization_engine import worker


def main(args=None):
    import rclpy
    from rclpy.node import Node
    from rclpy.qos import qos_profile_sensor_data
    from rclpy.time import Time
    from std_msgs.msg import String
    from nav_msgs.msg import Odometry
    from sensor_msgs.msg import PointCloud2
    from sensor_msgs_py import point_cloud2
    from tf2_ros import Buffer,TransformListener

    class Relocalizer(Node):
        def __init__(self):
            super().__init__('global_relocalization')
            self.config={k:self.declare_parameter(k,v).value for k,v in {
                'voxel':.3,'minimum_overlap':.65,'maximum_rmse':.15,'ambiguity_margin':.08,
                'max_tilt':.15,'max_height':.30,'max_points':200000,'attempts':4,'iterations':50000}.items()}
            self.timeout=float(self.declare_parameter('timeout_seconds',90.).value)
            if not all(isinstance(v,(float,int)) and math.isfinite(v) and v>0 for v in self.config.values()):
                raise ValueError('自动重定位参数必须是有限正数')
            if not .05<=self.config['voxel']<=1 or self.config['minimum_overlap']>1 or self.config['attempts']>8 or not 1<=self.timeout<=95:
                raise ValueError('自动重定位参数超出支持范围')
            self.base=self.declare_parameter('base_frame','base_link').value
            self.tf=Buffer();self.listener=TransformListener(self.tf,self)
            self.publisher=self.create_publisher(String,'/localization/auto_result',10)
            self.create_subscription(String,'/localization/auto_request',self.request,10)
            self.create_subscription(String,'/localization/auto_cancel',self.cancel,10)
            self.create_subscription(PointCloud2,'/livox/lidar',self.cloud,qos_profile_sensor_data)
            self.create_subscription(Odometry,'/odom_topic',self.odom,qos_profile_sensor_data)
            self.job=None;self.process=None;self.pipe=None;self.odom_at=0.;self.still=False;self.stamp=None;self.cloud_at=0.;self.odom_stamp=None
            self.timer=self.create_timer(.1,self.tick)

        def send(self,status,**values):
            msg=String();msg.data=json.dumps({'id':self.job['id'],'status':status,**values},allow_nan=False);self.publisher.publish(msg)

        def cleanup(self):
            if self.process:
                if self.process.is_alive():self.process.terminate()
                self.process.join(timeout=1)
                if self.process.is_alive():self.process.kill();self.process.join(timeout=1)
                self.process.close()
            if self.pipe:self.pipe.close()
            self.process=self.pipe=self.job=None

        def fail(self,message):
            if self.job:self.send('failed',message=message);self.cleanup()

        def odom(self,msg):
            stamp=(msg.header.stamp.sec,msg.header.stamp.nanosec)
            age=(self.get_clock().now().nanoseconds-(stamp[0]*1000000000+stamp[1]))/1e9
            if stamp==self.odom_stamp or not -.1<=age<=1.:return
            self.odom_stamp=stamp
            velocities=[msg.twist.twist.linear.x,msg.twist.twist.linear.y,msg.twist.twist.angular.z]
            self.still=all(math.isfinite(v) and abs(v)<=.02 for v in velocities)
            self.odom_at=time.monotonic()

        def request(self,msg):
            if self.job:return
            try:
                body=json.loads(msg.data)
                if not isinstance(body['id'],str) or len(body['id'])>64:raise ValueError('请求 ID 无效')
                self.job={'id':body['id'],'start':time.monotonic(),'frames':[],'stage':'collecting'}
                root=Path(os.environ['ROBOT_PCD_DIR']).resolve();path=Path(body['path']).resolve()
                if not path.is_relative_to(root) or path.suffix.lower()!='.pcd' or not path.is_file():raise ValueError('地图路径不在点云目录')
                if path.stat().st_size>512*1024*1024:raise ValueError('地图超过 512 MiB，请先裁剪')
                if not self.still or time.monotonic()-self.odom_at>1:raise ValueError('底盘未确认停车或里程计过期')
                self.job['path']=str(path);self.cloud_at=0.;self.stamp=None
                self.send('collecting',message='正在采集三帧新鲜点云')
            except Exception as exc:self.fail(str(exc))

        def cancel(self,msg):
            if self.job and msg.data==self.job['id']:
                self.send('cancelled',message='自动重定位已取消');self.cleanup()

        def cloud(self,msg):
            if not self.job:return
            stamp=(msg.header.stamp.sec,msg.header.stamp.nanosec)
            age=(self.get_clock().now().nanoseconds-(stamp[0]*1000000000+stamp[1]))/1e9
            if stamp==self.stamp or not -.1<=age<=1.:return
            self.stamp=stamp;self.cloud_at=time.monotonic()
            if self.job['stage']!='collecting':return
            try:
                if msg.width*msg.height>500000:raise ValueError('单帧点云过大')
                points=np.array(list(point_cloud2.read_points(msg,field_names=('x','y','z'),skip_nans=True)))
                if points.dtype.names:points=np.column_stack([points[n] for n in ('x','y','z')])
                points=np.asarray(points,dtype=float).reshape(-1,3)
                tf=self.tf.lookup_transform(self.base,msg.header.frame_id,Time.from_msg(msg.header.stamp)).transform
                q=tf.rotation;x,y,z,w=q.x,q.y,q.z,q.w
                if not .99<=x*x+y*y+z*z+w*w<=1.01:raise ValueError('雷达到车体 TF 四元数无效')
                rotation=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
                    [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
                    [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])
                points=points@rotation.T+np.array([tf.translation.x,tf.translation.y,tf.translation.z])
                radius=np.linalg.norm(points[:,:2],axis=1)
                points=points[np.isfinite(points).all(axis=1)&(radius>1)&(radius<30)]
                if len(points)<100:raise ValueError('有效雷达点不足')
                self.job['frames'].append(points[::max(1,len(points)//30000)])
                if len(self.job['frames'])==3:
                    self.job['stage']='searching';self.send('searching',message='正在全局搜索和多帧配准验证')
                    context=mp.get_context('spawn');self.pipe,child=context.Pipe(duplex=False)
                    self.process=context.Process(target=worker,args=(child,self.job['path'],self.job['frames'],self.config),daemon=True)
                    self.process.start();child.close()
            except Exception as exc:self.fail('点云/TF 处理失败: '+str(exc))

        def tick(self):
            if not self.job:return
            now=time.monotonic()
            if not self.still or now-self.odom_at>1:return self.fail('车辆移动或里程计断流，已取消搜索')
            if now-self.job['start']>self.timeout:return self.fail('自动重定位超时，请手动定位')
            if now-self.job['start']>2 and now-self.cloud_at>2:return self.fail('雷达点云断流')
            if self.pipe and self.pipe.poll():
                try:
                    result=self.pipe.recv();self.send(**result)
                except Exception as exc:self.fail('配准进程异常: '+str(exc));return
                self.cleanup()
            elif self.process and not self.process.is_alive():self.fail('配准进程退出，未返回有效结果')

    rclpy.init(args=args);node=Relocalizer()
    try:rclpy.spin(node)
    finally:node.cleanup();node.destroy_node();rclpy.shutdown()
