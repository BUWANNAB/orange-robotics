import math
from dataclasses import dataclass
from typing import List

@dataclass
class TrajectoryPoint:
    x: float
    y: float
    yaw: float = 0.0
    id: float = 0.0
    speed: float = 0.5
    run_mode: float = 0.0
    location_mode: float = 0.0
    reserved: float = 0.0
    stop_time: float = 0.0

class BidirectionalVelocityProfiler:
    """
    工业级开源双向速度规整器 (Nav2 / Autoware 模型)
    - 拐弯曲率限速 (Curvature constraint)
    - 反向提前制动 (Backward pass)
    - 正向平稳提速 (Forward pass)
    - 细密重采样 (Dense resampling)
    """
    def __init__(
        self,
        max_accel: float = 0.5,
        max_decel: float = 0.8,
        max_lateral_accel: float = 0.4,
        resample_step: float = 0.2,
        min_speed: float = 0.05
    ):
        self.max_accel = max_accel
        self.max_decel = max_decel
        self.max_lateral_accel = max_lateral_accel
        self.resample_step = resample_step
        self.min_speed = min_speed

    @staticmethod
    def dist(p1: TrajectoryPoint, p2: TrajectoryPoint) -> float:
        return math.hypot(p2.x - p1.x, p2.y - p1.y)

    def resample_path(self, raw_points: List[TrajectoryPoint]) -> List[TrajectoryPoint]:
        if len(raw_points) < 2:
            return list(raw_points)

        resampled = [raw_points[0]]
        for i in range(len(raw_points) - 1):
            p1 = raw_points[i]
            p2 = raw_points[i + 1]
            seg_len = self.dist(p1, p2)
            if seg_len < 1e-4:
                continue

            num_steps = max(1, int(math.ceil(seg_len / self.resample_step)))
            dx = (p2.x - p1.x) / num_steps
            dy = (p2.y - p1.y) / num_steps

            for step in range(1, num_steps):
                ratio = step / num_steps
                interp_pt = TrajectoryPoint(
                    x=p1.x + dx * step,
                    y=p1.y + dy * step,
                    yaw=p1.yaw + (p2.yaw - p1.yaw) * ratio,
                    id=p1.id,
                    speed=p1.speed,
                    run_mode=p1.run_mode,
                    location_mode=p1.location_mode,
                    reserved=0.0,
                    stop_time=0.0
                )
                resampled.append(interp_pt)
            resampled.append(p2)

        return resampled

    def profile(self, points: List[TrajectoryPoint], initial_speed: float = 0.0, dense: bool = True) -> List[TrajectoryPoint]:
        if len(points) < 2:
            return points

        pts = self.resample_path(points) if dense else [TrajectoryPoint(**p.__dict__) for p in points]
        n = len(pts)

        # 1. 曲率向心加速度限速
        for i in range(1, n - 1):
            p_prev = pts[i - 1]
            p_curr = pts[i]
            p_next = pts[i + 1]

            d1 = self.dist(p_prev, p_curr)
            d2 = self.dist(p_curr, p_next)
            d3 = self.dist(p_prev, p_next)

            s = (d1 + d2 + d3) / 2.0
            area_sq = s * (s - d1) * (s - d2) * (s - d3)
            if area_sq > 1e-6 and d1 > 1e-3 and d2 > 1e-3:
                radius = (d1 * d2 * d3) / (4.0 * math.sqrt(area_sq))
                if radius > 0.05:
                    curvature = 1.0 / radius
                    max_curve_speed = math.sqrt(self.max_lateral_accel / curvature)
                    pts[i].speed = max(self.min_speed, min(pts[i].speed, max_curve_speed))

        pts[-1].speed = 0.0

        # 2. 反向扫描 (提前刹车推导)
        for i in range(n - 2, -1, -1):
            d = self.dist(pts[i], pts[i + 1])
            v_allowed = math.sqrt(pts[i + 1].speed ** 2 + 2.0 * self.max_decel * d)
            if pts[i].speed > v_allowed:
                pts[i].speed = max(self.min_speed, v_allowed)

        # 3. 正向扫描 (平顺提速推导)
        pts[0].speed = min(pts[0].speed, max(self.min_speed, initial_speed))
        for i in range(n - 1):
            d = self.dist(pts[i], pts[i + 1])
            v_allowed = math.sqrt(pts[i].speed ** 2 + 2.0 * self.max_accel * d)
            if pts[i + 1].speed > v_allowed:
                pts[i + 1].speed = v_allowed

        return pts
