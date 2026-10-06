"""Gate the autonomous command on fresh filtered point-cloud data (ROS 2 Humble)."""

import time
from typing import Optional


def command_is_fresh(cloud_age: Optional[float], command_age: Optional[float],
                     cloud_timeout: float, command_timeout: float) -> bool:
    """Return whether both inputs are fresh enough to permit motion."""
    return (cloud_age is not None and command_age is not None and
            0.0 <= cloud_age <= cloud_timeout and
            0.0 <= command_age <= command_timeout)


def main(args=None):
    import rclpy
    from geometry_msgs.msg import Twist
    from rclpy.node import Node
    from rclpy.qos import qos_profile_sensor_data
    from sensor_msgs.msg import PointCloud2

    class ObstacleCommandWatchdog(Node):
        def __init__(self):
            super().__init__("obstacle_command_watchdog")
            self.declare_parameter("cloud_timeout", 0.5)
            self.declare_parameter("command_timeout", 0.3)
            self.cloud_timeout = float(self.get_parameter("cloud_timeout").value)
            self.command_timeout = float(self.get_parameter("command_timeout").value)
            if self.cloud_timeout <= 0.0 or self.command_timeout <= 0.0:
                raise ValueError("watchdog timeouts must be positive")
            self.last_cloud_at = None
            self.last_command_at = None
            self.latest_command = Twist()
            self.last_warning_at = 0.0
            self.output = self.create_publisher(Twist, "/cmd_vel", 10)
            self.create_subscription(PointCloud2, "/cloud/obstacles_filtered",
                                     self.on_cloud, qos_profile_sensor_data)
            self.create_subscription(Twist, "/cmd_vel_monitored", self.on_command, 10)
            self.create_timer(0.05, self.publish_safe_command)
            self.get_logger().info(
                "自动速度看门狗已就绪；点云/Collision Monitor 指令任一过期均发布零速度")

        def on_cloud(self, _message):
            self.last_cloud_at = time.monotonic()

        def on_command(self, message):
            self.latest_command = message
            self.last_command_at = time.monotonic()

        def publish_safe_command(self):
            now = time.monotonic()
            cloud_age = None if self.last_cloud_at is None else now - self.last_cloud_at
            command_age = None if self.last_command_at is None else now - self.last_command_at
            if command_is_fresh(cloud_age, command_age, self.cloud_timeout, self.command_timeout):
                self.output.publish(self.latest_command)
                return
            self.output.publish(Twist())
            if now - self.last_warning_at >= 3.0:
                self.get_logger().warning(
                    "自动速度已置零：过滤点云或 Collision Monitor 速度指令未及时更新")
                self.last_warning_at = now

    rclpy.init(args=args)
    node = ObstacleCommandWatchdog()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()
