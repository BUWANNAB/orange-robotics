#ifndef VEHICLE_NAVIGATION__VELOCITY_PROFILER_HPP_
#define VEHICLE_NAVIGATION__VELOCITY_PROFILER_HPP_

#include <vector>
#include <cmath>
#include <algorithm>
#include <cstddef>

namespace orange_nav {

/**
 * @brief 双向速度规划器（本项目实现，需要现场验证）
 * 特性：
 * 1. 曲率向心加速度硬性约束 (Curvature Constraint)
 * 2. 反向搜索 (Backward Pass) 提前制动，确保任何低速区、入弯前以及终点平滑降速，无闯入与顿挫
 * 3. 正向搜索 (Forward Pass) 线性平稳提速，起步无抖动
 * 4. 密集等间距重采样 (Dense Resampling) 消除打点跨度带来的离散突变
 */
class BidirectionalVelocityProfiler {
public:
    static constexpr std::size_t FIELDS = 9;

    struct ProfilerParams {
        float max_accel = 0.5F;         // 最大纵向加速度 (m/s^2)
        float max_decel = 0.8F;         // 最大纵向减速度 (m/s^2)
        float max_lateral_accel = 0.4F; // 最大横向向心加速度 (m/s^2)，限制过弯速度
        float resample_step = 0.25F;    // 重采样细分步长 (米)
        float min_speed = 0.05F;        // 最低蠕行速度 (m/s)
    };

    /**
     * @brief 对输入路径点数组就地或扩展执行双向速度平滑
     * @param path 输入输出的路径二维数组 (每点 9 字段)
     * @param point_count 路径点数量 (若重采样则会更新为密集点数)
     * @param max_capacity path 数组的最大允许容量 (如 1000)
     * @param params 动力学与约束参数
     * @param initial_speed 当前车辆起始速度 (m/s)
     */
    static void profile(
        double path[][FIELDS],
        std::size_t& point_count,
        std::size_t max_capacity,
        const ProfilerParams& params,
        float initial_speed = 0.0F,
        std::vector<std::size_t>* original_targets = nullptr)
    {
        if (point_count < 2) {
            return;
        }

        // 1. 密集重采样 (若容量允许且原始点距较大)
        std::vector<std::vector<double>> dense;
        dense.reserve(max_capacity);
        std::vector<std::size_t> targets;
        const double direction = path[0][4] < 0 ? -1.0 : 1.0;

        for (std::size_t i = 0; i < point_count - 1; ++i) {
            std::vector<double> p1(path[i], path[i] + FIELDS);
            std::vector<double> p2(path[i + 1], path[i + 1] + FIELDS);

            p1[4] = std::abs(p1[4]);
            dense.push_back(p1);
            targets.push_back(i+1);

            double dx = p2[0] - p1[0];
            double dy = p2[1] - p1[1];
            double seg_len = std::hypot(dx, dy);

            if (seg_len > params.resample_step && dense.size() < max_capacity - 1) {
                std::size_t steps = static_cast<std::size_t>(std::ceil(seg_len / params.resample_step));
                steps = std::min(steps, max_capacity - dense.size() - (point_count - 1 - i));
                
                for (std::size_t s = 1; s < steps; ++s) {
                    double ratio = static_cast<double>(s) / static_cast<double>(steps);
                    std::vector<double> interp = p1;
                    interp[0] = p1[0] + dx * ratio; // x
                    interp[1] = p1[1] + dy * ratio; // y
                    interp[2] = p1[2] + (p2[2] - p1[2]) * ratio; // yaw
                    // speed, runmode, locationmode 继承前序段设置
                    dense.push_back(interp);
                    targets.push_back(i+1);
                    if (dense.size() >= max_capacity - 1) break;
                }
            }
        }
        dense.push_back(std::vector<double>(path[point_count - 1], path[point_count - 1] + FIELDS));

        targets.push_back(point_count-1);
        std::size_t n = dense.size();

        // 2. 弯道曲率限速 (三点外接圆向心加速度限速)
        for (std::size_t i = 1; i < n - 1; ++i) {
            double d1 = std::hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
            double d2 = std::hypot(dense[i + 1][0] - dense[i][0], dense[i + 1][1] - dense[i][1]);
            double d3 = std::hypot(dense[i + 1][0] - dense[i - 1][0], dense[i + 1][1] - dense[i - 1][1]);

            double s = (d1 + d2 + d3) * 0.5;
            double area_sq = s * (s - d1) * (s - d2) * (s - d3);

            if (area_sq > 1e-6 && d1 > 1e-3 && d2 > 1e-3) {
                double radius = (d1 * d2 * d3) / (4.0 * std::sqrt(area_sq));
                if (radius > 0.05) {
                    double curvature = 1.0 / radius;
                    double max_curve_v = std::sqrt(params.max_lateral_accel / curvature);
                    dense[i][4] = std::min(dense[i][4], max_curve_v);
                }
            }
        }

        // 终点速度强制为 0
        dense[n - 1][4] = 0.0;

        // 3. 反向扫描 (Backward Pass - 提前制动推导)
        for (std::size_t i = n - 2; i > 0; --i) {
            double d = std::hypot(dense[i + 1][0] - dense[i][0], dense[i + 1][1] - dense[i][1]);
            double v_next = dense[i + 1][4];
            double v_allowed = std::sqrt(v_next * v_next + 2.0 * params.max_decel * d);
            if (dense[i][4] > v_allowed) {
                dense[i][4] = v_allowed;
            }
        }

        // 4. 正向扫描 (Forward Pass - 平顺提速推导)
        dense[0][4] = std::min(dense[0][4], std::max(static_cast<double>(params.min_speed), std::abs(static_cast<double>(initial_speed))));
        for (std::size_t i = 0; i < n - 1; ++i) {
            double d = std::hypot(dense[i + 1][0] - dense[i][0], dense[i + 1][1] - dense[i][1]);
            double v_curr = dense[i][4];
            double v_allowed = std::sqrt(v_curr * v_curr + 2.0 * params.max_accel * d);
            if (dense[i + 1][4] > v_allowed) {
                dense[i + 1][4] = v_allowed;
            }
        }

        // 5. 写回主数组
        point_count = std::min(n, max_capacity);
        if (original_targets) original_targets->assign(targets.begin(), targets.begin()+point_count);
        for (std::size_t i = 0; i < point_count; ++i) {
            dense[i][4] *= direction;
            for (std::size_t j = 0; j < FIELDS; ++j) {
                path[i][j] = dense[i][j];
            }
        }
    }
};

} // namespace orange_nav

#endif // VEHICLE_NAVIGATION__VELOCITY_PROFILER_HPP_
