"""Publish a lightweight live 2D occupancy preview from registered LIO-SAM clouds."""
from array import array
import math
import time
import numpy as np


def main(args=None):
    import rclpy
    from nav_msgs.msg import OccupancyGrid
    from rclpy.node import Node
    from rclpy.qos import DurabilityPolicy, HistoryPolicy, QoSProfile, ReliabilityPolicy
    from sensor_msgs.msg import PointCloud2
    from sensor_msgs_py import point_cloud2
    from std_msgs.msg import String

    class LiveGridPreview(Node):
        TILE_SIZE = 256

        def __init__(self):
            super().__init__("orange_live_grid_preview")
            self.cloud_topic = self.declare_parameter(
                "cloud_topic", "/lio_sam/mapping/cloud_registered"
            ).value
            self.status_topic = self.declare_parameter(
                "mapping_status_topic", "/buildmap_status"
            ).value
            self.grid_topic = self.declare_parameter(
                "grid_topic", "/orange/mapping/live_grid"
            ).value
            self.grid_status_topic = self.declare_parameter(
                "grid_status_topic", "/orange/mapping/live_grid_status"
            ).value
            self.resolution = float(self.declare_parameter("resolution", 0.05).value)
            self.z_min = float(self.declare_parameter("z_min", 0.10).value)
            self.z_max = float(self.declare_parameter("z_max", 2.00).value)
            self.max_grid_cells = int(
                self.declare_parameter("max_grid_cells", 4_000_000).value
            )
            self.publish_period = float(
                self.declare_parameter("publish_period", 1.0).value
            )
            if (
                not math.isfinite(self.resolution)
                or self.resolution <= 0
                or not math.isfinite(self.z_min)
                or not math.isfinite(self.z_max)
                or self.z_min >= self.z_max
                or self.max_grid_cells <= 0
                or self.publish_period <= 0
            ):
                raise ValueError("Invalid live occupancy grid parameters")

            map_qos = QoSProfile(
                history=HistoryPolicy.KEEP_LAST,
                depth=1,
                reliability=ReliabilityPolicy.RELIABLE,
                durability=DurabilityPolicy.TRANSIENT_LOCAL,
            )
            self.grid_pub = self.create_publisher(OccupancyGrid, self.grid_topic, map_qos)
            self.status_pub = self.create_publisher(String, self.grid_status_topic, 10)
            self.point_cloud2 = point_cloud2
            self.create_subscription(
                String, self.status_topic, self.on_mapping_status, 10
            )
            self.create_subscription(
                PointCloud2, self.cloud_topic, self.on_cloud, 1
            )
            self.tiles = {}
            self.bounds = None
            self.frame_id = ""
            self.mapping_active = False
            self.last_cloud_at = 0.0
            self.last_publish_at = 0.0
            self.dirty = False
            self.status = None
            self.last_status_publish_at = 0.0
            self.timer = self.create_timer(0.25, self.publish_if_ready)
            self.publish_status("等待建图")
            self.get_logger().info(
                f"Live grid preview listening to {self.cloud_topic} at "
                f"{self.resolution:.3f} m/cell"
            )

        def clear_grid(self):
            self.tiles.clear()
            self.bounds = None
            self.frame_id = ""
            self.dirty = False
            self.last_cloud_at = 0.0
            self.last_publish_at = 0.0

        def publish_status(self, text, heartbeat=False):
            now = time.monotonic()
            if text == self.status and (
                not heartbeat or now - self.last_status_publish_at < 1.0
            ):
                return
            self.status = text
            self.last_status_publish_at = now
            message = String()
            message.data = text
            self.status_pub.publish(message)

        def on_mapping_status(self, message):
            state = message.data.strip()
            if state == "starting":
                self.clear_grid()
                self.mapping_active = True
                self.publish_status("建图已启动，等待有效点云")
            elif state in {"mapping", "map_data_ready"}:
                self.mapping_active = True
                if self.bounds:
                    self.publish_status("实时地图更新中")
            elif state in {
                "saving", "stopping_mapping", "mapping_stopped",
                "rviz_livox_started", "idle", "start_livox_failed",
                "start_lio_sam_failed", "start_failed", "start_rviz_livox_failed",
                "operation_failed", "save_failed_lio_stopped",
            } or state.startswith("saved:"):
                self.mapping_active = False
                self.publish_status("建图结束，保留最后一帧预览" if self.bounds else "建图已停止")

        def read_xyz(self, message):
            points = self.point_cloud2.read_points(
                message, field_names=("x", "y", "z"), skip_nans=True
            )
            if isinstance(points, np.ndarray):
                if points.dtype.names:
                    return (
                        np.asarray(points["x"], dtype=np.float32),
                        np.asarray(points["y"], dtype=np.float32),
                        np.asarray(points["z"], dtype=np.float32),
                    )
                values = np.asarray(points, dtype=np.float32).reshape(-1, 3)
            else:
                values = np.asarray(list(points), dtype=np.float32).reshape(-1, 3)
            if not values.size:
                empty = np.empty(0, dtype=np.float32)
                return empty, empty, empty
            return values[:, 0], values[:, 1], values[:, 2]

        def on_cloud(self, message):
            if not self.mapping_active:
                return
            try:
                self.last_cloud_at = time.monotonic()
                x, y, z = self.read_xyz(message)
                valid = (
                    np.isfinite(x) & np.isfinite(y) & np.isfinite(z)
                    & (z >= self.z_min) & (z <= self.z_max)
                )
                if not np.any(valid):
                    self.publish_status(
                        "实时地图更新中" if self.bounds else "等待有效建图点云",
                        heartbeat=True,
                    )
                    return
                cell_x = np.floor(x[valid] / self.resolution).astype(np.int64)
                cell_y = np.floor(y[valid] / self.resolution).astype(np.int64)
                safe = (
                    (cell_x >= np.iinfo(np.int32).min)
                    & (cell_x <= np.iinfo(np.int32).max)
                    & (cell_y >= np.iinfo(np.int32).min)
                    & (cell_y <= np.iinfo(np.int32).max)
                )
                cell_x, cell_y = cell_x[safe], cell_y[safe]
                if not cell_x.size:
                    return
                cells = np.unique(np.column_stack((cell_x, cell_y)), axis=0)
                frame_id = message.header.frame_id or "odom"
                if self.frame_id and frame_id != self.frame_id:
                    previous_frame = self.frame_id
                    self.clear_grid()
                    self.publish_status(f"点云坐标系变化：{previous_frame} → {frame_id}")
                self.frame_id = frame_id
                candidate = [
                    int(min(self.bounds[0], int(cells[:, 0].min()))) if self.bounds else int(cells[:, 0].min()),
                    int(min(self.bounds[1], int(cells[:, 1].min()))) if self.bounds else int(cells[:, 1].min()),
                    int(max(self.bounds[2], int(cells[:, 0].max()))) if self.bounds else int(cells[:, 0].max()),
                    int(max(self.bounds[3], int(cells[:, 1].max()))) if self.bounds else int(cells[:, 1].max()),
                ]
                if (candidate[2] - candidate[0] + 1) * (candidate[3] - candidate[1] + 1) > self.max_grid_cells:
                    self.publish_status("实时地图范围超过上限；请缩短建图范围或降低分辨率")
                    return
                for ix, iy in cells:
                    ix, iy = int(ix), int(iy)
                    tile_x, local_x = divmod(ix, self.TILE_SIZE)
                    tile_y, local_y = divmod(iy, self.TILE_SIZE)
                    key = (tile_x, tile_y)
                    tile = self.tiles.get(key)
                    if tile is None:
                        tile = bytearray(self.TILE_SIZE * self.TILE_SIZE)
                        self.tiles[key] = tile
                    offset = local_y * self.TILE_SIZE + local_x
                    if tile[offset] != 100:
                        tile[offset] = 100
                        if self.bounds is None:
                            self.bounds = [ix, iy, ix, iy]
                        else:
                            self.bounds[0] = min(self.bounds[0], ix)
                            self.bounds[1] = min(self.bounds[1], iy)
                            self.bounds[2] = max(self.bounds[2], ix)
                            self.bounds[3] = max(self.bounds[3], iy)
                        self.dirty = True
                if self.bounds:
                    self.publish_status("实时地图更新中", heartbeat=True)
                else:
                    self.publish_status("等待有效建图点云", heartbeat=True)
            except Exception as exc:
                self.get_logger().warning(f"Could not add points to live grid: {exc}")
                self.publish_status("点云预览失败，请检查点云坐标和格式")

        def publish_if_ready(self):
            if not self.bounds or not self.dirty:
                if self.mapping_active and self.last_cloud_at and time.monotonic() - self.last_cloud_at > 3:
                    self.publish_status("雷达点云已断流")
                return
            if time.monotonic() - self.last_publish_at < self.publish_period:
                return
            min_x, min_y, max_x, max_y = self.bounds
            width, height = max_x - min_x + 1, max_y - min_y + 1
            if width * height > self.max_grid_cells:
                self.publish_status("实时地图过大；请降低分辨率或分段建图")
                self.dirty = False
                return

            grid = np.full((height, width), -1, dtype=np.int8)
            for (tile_x, tile_y), tile in self.tiles.items():
                tile_min_x, tile_min_y = tile_x * self.TILE_SIZE, tile_y * self.TILE_SIZE
                left, bottom = max(min_x, tile_min_x), max(min_y, tile_min_y)
                right = min(max_x + 1, tile_min_x + self.TILE_SIZE)
                top = min(max_y + 1, tile_min_y + self.TILE_SIZE)
                if left >= right or bottom >= top:
                    continue
                tile_grid = np.frombuffer(tile, dtype=np.uint8).reshape(
                    self.TILE_SIZE, self.TILE_SIZE
                )
                tile_region = tile_grid[
                    bottom - tile_min_y:top - tile_min_y,
                    left - tile_min_x:right - tile_min_x,
                ]
                grid[
                    bottom - min_y:top - min_y,
                    left - min_x:right - min_x,
                ] = np.where(tile_region == 100, 100, -1).astype(np.int8)

            message = OccupancyGrid()
            message.header.stamp = self.get_clock().now().to_msg()
            message.header.frame_id = self.frame_id or "odom"
            message.info.map_load_time = message.header.stamp
            message.info.resolution = self.resolution
            message.info.width = width
            message.info.height = height
            message.info.origin.position.x = min_x * self.resolution
            message.info.origin.position.y = min_y * self.resolution
            message.info.origin.orientation.w = 1.0
            message.data = array("b", grid.tobytes(order="C"))
            self.grid_pub.publish(message)
            self.last_publish_at = time.monotonic()
            self.dirty = False

    rclpy.init(args=args)
    node = LiveGridPreview()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()
