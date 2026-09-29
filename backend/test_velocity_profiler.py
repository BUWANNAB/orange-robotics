import math
from dataclasses import dataclass
from typing import List, Tuple

@dataclass
class Waypoint:
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
    源自工业级开源自动驾驶/AGV系统 (Nav2 / Autoware) 的双向加减速速度规划器。
    具备：
    1. 拐弯/曲率自适应限速 (Curvature constraint)
    2. 反向减速前向传播 (Backward pass - 提前制动，入弯/入低速区/进站无感减速)
    3. 正向加速平滑传播 (Forward pass - 起步平稳提速)
    4. 密集等间距重采样 (Dense Resampling - 将离散跳变折线变为连续光滑曲线)
    """
    def __init__(
        self,
        max_accel: float = 0.5,      # m/s^2
        max_decel: float = 0.8,      # m/s^2
        max_lateral_accel: float = 0.4, # m/s^2 决定过弯最大允许向心加速度
        resample_step: float = 0.2,  # 米，路径密集重采样步长
        min_speed: float = 0.05      # m/s 最低蠕行速度
    ):
        self.max_accel = max_accel
        self.max_decel = max_decel
        self.max_lateral_accel = max_lateral_accel
        self.resample_step = resample_step
        self.min_speed = min_speed

    @staticmethod
    def dist(p1: Waypoint, p2: Waypoint) -> float:
        return math.hypot(p2.x - p1.x, p2.y - p1.y)

    def resample_path(self, raw_points: List[Waypoint]) -> List[Waypoint]:
        """对稀疏打点折线进行等间距重采样插值，保证速度曲线连续"""
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
                interp_pt = Waypoint(
                    x=p1.x + dx * step,
                    y=p1.y + dy * step,
                    yaw=p1.yaw + (p2.yaw - p1.yaw) * ratio,
                    id=p1.id,
                    speed=p1.speed, # 继承该段速度设定
                    run_mode=p1.run_mode,
                    location_mode=p1.location_mode,
                    reserved=0.0,
                    stop_time=0.0
                )
                resampled.append(interp_pt)
            resampled.append(p2)

        return resampled

    def profile(self, points: List[Waypoint], initial_speed: float = 0.0) -> List[Waypoint]:
        if len(points) < 2:
            return points

        # 1. 密集重采样
        pts = self.resample_path(points)
        n = len(pts)

        # 2. 曲率与转向角限速 (Curvature Constraint)
        for i in range(1, n - 1):
            p_prev = pts[i - 1]
            p_curr = pts[i]
            p_next = pts[i + 1]

            # 三点估算曲率半径
            d1 = self.dist(p_prev, p_curr)
            d2 = self.dist(p_curr, p_next)
            d3 = self.dist(p_prev, p_next)

            # 海伦公式求外接圆半径 R = a*b*c / (4*Area)
            s = (d1 + d2 + d3) / 2.0
            area_sq = s * (s - d1) * (s - d2) * (s - d3)
            if area_sq > 1e-6 and d1 > 1e-3 and d2 > 1e-3:
                area = math.sqrt(area_sq)
                radius = (d1 * d2 * d3) / (4.0 * area)
                if radius > 0.05:
                    curvature = 1.0 / radius
                    max_curve_speed = math.sqrt(self.max_lateral_accel / curvature)
                    pts[i].speed = max(self.min_speed, min(pts[i].speed, max_curve_speed))

        # 终点速度强制置为 0
        pts[-1].speed = 0.0

        # 3. 反向扫描 (Backward Pass - 提前制动，确保任何低速点或终点前有足够刹车距离)
        for i in range(n - 2, -1, -1):
            d = self.dist(pts[i], pts[i + 1])
            # v_i <= sqrt(v_{i+1}^2 + 2 * a_decel * d)
            v_allowed = math.sqrt(pts[i + 1].speed ** 2 + 2.0 * self.max_decel * d)
            if pts[i].speed > v_allowed:
                pts[i].speed = max(self.min_speed, v_allowed)

        # 4. 正向扫描 (Forward Pass - 平顺起步，加速度约束)
        pts[0].speed = min(pts[0].speed, max(self.min_speed, initial_speed))
        for i in range(n - 1):
            d = self.dist(pts[i], pts[i + 1])
            # v_{i+1} <= sqrt(v_i^2 + 2 * a_accel * d)
            v_allowed = math.sqrt(pts[i].speed ** 2 + 2.0 * self.max_accel * d)
            if pts[i + 1].speed > v_allowed:
                pts[i + 1].speed = v_allowed

        return pts

def test():
    # 测试场景：
    # 点 0 到 点 1: 5米直线，用户设速度 1.0 m/s
    # 点 1 到 点 2: 5米直线，用户设速度 0.2 m/s (低速区)
    # 点 2 到 点 3: 5米直线，用户设速度 0.8 m/s，终点停车
    raw = [
        Waypoint(x=0.0, y=0.0, speed=1.0),
        Waypoint(x=5.0, y=0.0, speed=1.0),
        Waypoint(x=10.0, y=0.0, speed=0.2), # 低速拐点
        Waypoint(x=15.0, y=0.0, speed=0.8),
    ]

    profiler = BidirectionalVelocityProfiler(max_accel=0.5, max_decel=0.8, resample_step=0.25)
    smooth_path = profiler.profile(raw, initial_speed=0.0)

    print(f"原始点数: {len(raw)} -> 平滑后密集点数: {len(smooth_path)}")
    print("\n关键位置速度对比采样:")
    for pt in smooth_path[::4]: # 每 1 米打印一次
        print(f"位置 x={pt.x:5.2f}m, y={pt.y:5.2f}m -> 规划速度: {pt.speed:.3f} m/s")

    # 验证断言：
    # 1. 起点速度应当从低速起步 (0.05 附近)
    assert smooth_path[0].speed < 0.2, "起点应平稳起步"
    
    # 2. 在接近 x=10m 的低速区前（x=9.5m~9.75m），速度必须已经提前下降！
    pts_at_braking = [p for p in smooth_path if 9.4 <= p.x <= 9.8]
    assert len(pts_at_braking) > 0
    for p in pts_at_braking:
        assert p.speed < 1.0, f"在进入低速区前必须已提前制动，但 x={p.x} 时 speed={p.speed}"
        print(f"[验证通过] 提前制动点: x={p.x:.2f}m, speed={p.speed:.3f}m/s (已从 1.0 提前平滑下降)")

    # 3. 终点速度应当平稳减速到 0
    assert smooth_path[-1].speed == 0.0, "终点速度应为0"
    print("\n--> 算法核心双向规划测试完全 PASS！")


if __name__ == "__main__":
    test()
