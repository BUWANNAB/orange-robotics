"""ROS integration on localhost with synthetic pose/odom; never a chassis acceptance test."""
import math
import os
import subprocess
import sys
import time
import unittest

os.environ['ROS_LOCALHOST_ONLY'] = '1'
os.environ['ROS_DOMAIN_ID'] = str(180 + os.getpid() % 40)
import rclpy
from geometry_msgs.msg import PoseStamped, Twist
from nav_msgs.msg import Odometry
from rclpy.qos import qos_profile_sensor_data
from std_msgs.msg import Float64MultiArray, MultiArrayDimension, String, UInt8

EXECUTABLE = sys.argv.pop(1)


class RetainedRouteTests(unittest.TestCase):
    def setUp(self):
        rclpy.init()
        self.node = rclpy.create_node('pause_test_fixture')
        self.child = subprocess.Popen([EXECUTABLE], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(self.cleanup)
        self.x, self.yaw, self.speed = 5.5, 0., .1
        self.feed_odom = True
        self.controls, self.results, self.twists, self.progress = [], [], [], []
        self.odom = self.node.create_publisher(Odometry, '/odom_topic', qos_profile_sensor_data)
        self.pose = self.node.create_publisher(PoseStamped, '/tf_pose', 10)
        self.path = self.node.create_publisher(Float64MultiArray, '/path_point', 10)
        self.run = self.node.create_publisher(UInt8, '/vehicle_run_star', 10)
        self.close = self.node.create_publisher(UInt8, '/close_route', 10)
        self.control = self.node.create_publisher(String, '/navigation/control', 10)
        self.node.create_subscription(String, '/navigation/control_result', lambda m: self.controls.append(m.data.split('\n')), 10)
        self.node.create_subscription(String, '/navigation/result', self.on_result, 10)
        self.node.create_subscription(Twist, '/cmd_vel', lambda m: self.twists.append((m.linear.x, m.angular.z)), 10)
        self.timer = self.node.create_timer(.025, self.feedback)
        self.wait(lambda: self.control.get_subscription_count() > 0, 6)
        self.pump(.3)
        points = []
        for i, x in enumerate([0., 5., 10.]):
            points += [x, 0., 0., float(i+1), .2, 0., 0., 0., 0.]
        if 'final_spin' in self._testMethodName:
            points[-7] = 1.0
            points[-4] = 1.0
        msg = Float64MultiArray(data=points)
        msg.layout.dim = [MultiArrayDimension(label='retained-route', size=3, stride=27)]
        self.path.publish(msg)
        self.wait(lambda: ['retained-route', 'accepted'] in self.results)
        self.run.publish(UInt8(data=1))
        self.wait(lambda: len(self.progress) > 1)
        self.assertGreater(self.progress[-1], 0, 'fixture must advance beyond the first segment')

    def cleanup(self):
        self.child.terminate()
        self.child.wait(timeout=5)
        self.node.destroy_node()
        rclpy.shutdown()

    def on_result(self, msg):
        parts = msg.data.split('\n')
        self.results.append(parts)
        if len(parts) == 3 and parts[1] == 'progress':
            self.progress.append(int(parts[2]))

    def feedback(self):
        stamp = self.node.get_clock().now().to_msg()
        p = PoseStamped()
        p.header.stamp, p.header.frame_id = stamp, 'map'
        p.pose.position.x = self.x
        p.pose.orientation.w = math.cos(self.yaw/2)
        p.pose.orientation.z = math.sin(self.yaw/2)
        self.pose.publish(p)
        if self.feed_odom:
            o = Odometry()
            o.header.stamp = stamp
            o.twist.twist.linear.x = self.speed
            self.odom.publish(o)

    def pump(self, seconds):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            rclpy.spin_once(self.node, timeout_sec=.01)
        self.assertIsNone(self.child.poll(), 'navigation node crashed')

    def wait(self, condition, timeout=3):
        until = time.monotonic() + timeout
        while time.monotonic() < until and not condition():
            self.pump(.02)
        self.assertTrue(condition(), 'timed out; results=' + str(self.results[-5:]) + ' controls=' + str(self.controls))

    def send(self, seq, action):
        self.control.publish(String(data=f'retained-route\n{seq}\n{action}'))

    def paused(self):
        self.send(1, 'pause')
        self.pump(.25)
        self.assertFalse(self.controls, 'moving odometry cannot confirm a pause')
        self.assertEqual(self.twists[-1], (0., 0.))
        self.speed = 0.
        self.wait(lambda: any(c[1:3] == ['1', 'paused'] for c in self.controls))

    def test_retains_progress_and_legacy_start_cannot_bypass_pause(self):
        self.paused()
        before = self.progress[-1]
        self.run.publish(UInt8(data=1))
        self.pump(.2)
        self.assertEqual(self.twists[-1], (0., 0.))
        self.send(2, 'resume')
        self.wait(lambda: any(c[1:3] == ['2', 'running'] for c in self.controls))
        self.wait(lambda: abs(self.twists[-1][0]) > .001)
        self.send(2, 'resume')
        self.pump(.1)
        self.assertEqual(self.controls[-1][2], 'running')
        self.assertGreaterEqual(self.progress[-1], before)
        self.assertEqual(self.results.count(['retained-route','accepted']), 1)
        self.send(3, 'pause'); self.pump(.3)
        self.send(2, 'resume')  # Old control sequence cannot undo a newer pause.
        self.pump(.2)
        self.assertEqual(self.twists[-1], (0., 0.))

    def test_final_spin_is_retained_across_pause_and_resume(self):
        self.x, self.speed = 10., 0.
        self.wait(lambda: abs(self.twists[-1][1]) > .01)
        self.send(1, 'pause')
        self.wait(lambda: any(c[1:3] == ['1', 'paused'] for c in self.controls))
        self.assertEqual(self.twists[-1], (0., 0.))
        self.send(2, 'resume')
        self.wait(lambda: any(c[1:3] == ['2', 'running'] for c in self.controls))
        self.wait(lambda: abs(self.twists[-1][1]) > .01)
        self.yaw = 1.0
        self.wait(lambda: ['retained-route', 'success'] in self.results)

    def test_cancellation_invalidates_a_paused_route(self):
        self.paused()
        self.close.publish(UInt8(data=1))
        self.wait(lambda: ['retained-route', 'cancelled'] in self.results)
        self.send(2, 'resume'); self.pump(.2)
        self.assertEqual(self.controls[-1][2], 'rejected')
        self.assertEqual(self.twists[-1], (0., 0.))

    def test_pushed_vehicle_and_stale_odometry_cannot_resume(self):
        self.paused()
        self.x += 1.
        self.pump(.1)
        self.send(2, 'resume')
        self.wait(lambda: any(c[1:3] == ['2', 'rejected'] for c in self.controls))
        self.x -= 1.
        self.feed_odom = False
        self.pump(1.1)
        self.send(3, 'resume')
        self.wait(lambda: any(c[1:3] == ['3', 'rejected'] for c in self.controls))
        self.assertEqual(self.twists[-1], (0., 0.))


if __name__ == '__main__':
    unittest.main()
