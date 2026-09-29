#include "vehicle_navigation/vehicle_navigation.hpp"
#include "vehicle_navigation/velocity_profiler.hpp"
#include <algorithm>
#include "vehicle_navigation/jerk_limiter.hpp"
#include <cmath>
#include <stdexcept>


namespace {
bool validRouteSpeeds(const std::vector<double>& data) {
    if (data.size() < 18 || data.size() % 9) return false;
    const bool reverse = data[4] < 0;
    for (std::size_t i=0; i+9<data.size(); i+=9) {
        if (std::abs(data[i+4]) < 0.001 || (data[i+4] < 0) != reverse) return false;
        if (std::hypot(data[i+9]-data[i], data[i+10]-data[i+1]) < 0.001) return false;
    }
    return true;
}
}

TrackedVehicleNavigation::TrackedVehicleNavigation() : Node("tracked_vehicle_navigation") {
    // 1. 声明并获取参数（直接从参数系统加载，无冗余调用）
    declare_parameters();

    // 2. 初始化发布者与订阅者
    initialize_publishers();
    initialize_subscribers();

    // 4. 定时器
    timer_ = create_wall_timer(
        1000ms, std::bind(&TrackedVehicleNavigation::timer_callback, this));

    vehicle_ctrl_timer_ = create_wall_timer(
        50ms, std::bind(&TrackedVehicleNavigation::vehicle_ctrl_callback, this));

    _vehicle_run_status.data = RunStatus::Ready;
    RCLCPP_INFO(this->get_logger(), "=== Regulated Pure Pursuit (RPP) 导航控制节点已成功启动 ===");
}

void TrackedVehicleNavigation::declare_parameters() {
    _lookahead_dist         = static_cast<float>(this->declare_parameter("lookahead_dist", 1.2));
    _min_lookahead_dist     = static_cast<float>(this->declare_parameter("min_lookahead_dist", 0.6));
    _max_lookahead_dist     = static_cast<float>(this->declare_parameter("max_lookahead_dist", 2.0));
    _lookahead_time         = static_cast<float>(this->declare_parameter("lookahead_time", 1.2));
    _wheel_base             = static_cast<float>(this->declare_parameter("wheel_base", 0.8));

    _max_velocity           = static_cast<float>(this->declare_parameter("max_velocity", 1.0));
    _min_velocity           = static_cast<float>(this->declare_parameter("min_velocity", 0.15));
    _angular_velocity_limit = static_cast<float>(this->declare_parameter("angular_velocity_limit", 0.6));
    _min_angular_velocity   = static_cast<float>(this->declare_parameter("min_angular_velocity", 0.08));

    _max_linear_jerk = static_cast<float>(this->declare_parameter("max_linear_jerk", 0.8));
    _max_angular_jerk = static_cast<float>(this->declare_parameter("max_angular_jerk", 1.6));
    _max_linear_accel       = static_cast<float>(this->declare_parameter("max_linear_accel", 0.6));
    _max_linear_decel       = static_cast<float>(this->declare_parameter("max_linear_decel", 0.8));
    _max_angular_accel      = static_cast<float>(this->declare_parameter("max_angular_accel", 1.2));
    _max_lateral_accel      = static_cast<float>(this->declare_parameter("max_lateral_accel", 0.5));

    _xy_goal_tolerance      = static_cast<float>(this->declare_parameter("xy_goal_tolerance", 0.05));
    _xy_middle_tolerance    = static_cast<float>(this->declare_parameter("xy_middle_tolerance", 0.25));
    _yaw_goal_tolerance     = static_cast<float>(this->declare_parameter("yaw_goal_tolerance", 2.0));
    _proportion             = static_cast<float>(this->declare_parameter("proportion", 1.2));
    _spin_angle_threshold   = static_cast<float>(this->declare_parameter("spin_angle_threshold", 60.0));

    _pose_offset_x_         = static_cast<float>(this->declare_parameter("pose_offset_x_", 0.0));
    _pose_offset_y_         = static_cast<float>(this->declare_parameter("pose_offset_y_", 0.0));
    for (float limit : {_max_velocity, _angular_velocity_limit, _max_linear_accel, _max_linear_decel,
                        _max_angular_accel, _max_lateral_accel, _max_linear_jerk, _max_angular_jerk}) {
        if (!std::isfinite(limit) || limit <= 0) throw std::invalid_argument("Motion limits must be finite and positive");
    }
}

void TrackedVehicleNavigation::publishNavResult(const std::string &status) {
    if (nav_request_id_.empty()) return;
    std_msgs::msg::String msg;
    msg.data = nav_request_id_ + "\n" + status;
    pubNavResult->publish(msg);
}

void TrackedVehicleNavigation::initialize_publishers() {
    pubNavResult = this->create_publisher<std_msgs::msg::String>("/navigation/result", 10);
    pubPathTrackingStatus = this->create_publisher<std_msgs::msg::UInt32>("/path_point_id", 10);
    pubGoalFinish         = this->create_publisher<std_msgs::msg::UInt8>("/goal_finish", 10);
    pubCmdVel             = this->create_publisher<geometry_msgs::msg::Twist>("/cmd_vel", 10);
    pubLocationMode       = this->create_publisher<std_msgs::msg::UInt8>("/location_mode", 10);
    pubPathReceivedFinish = this->create_publisher<std_msgs::msg::UInt8>("/path_received_finish", 10);
    pubCloseRouteFinish   = this->create_publisher<std_msgs::msg::UInt8>("/close_route_finish", 10);
    pubWarning            = this->create_publisher<std_msgs::msg::UInt8>("/vehicle_warning", 10);
    pubRunStatus          = this->create_publisher<std_msgs::msg::UInt8>("/vehicle_run_status", 10);
}

void TrackedVehicleNavigation::initialize_subscribers() {
    subOdom = create_subscription<nav_msgs::msg::Odometry>("/odom_topic", rclcpp::SensorDataQoS(),
        [this](nav_msgs::msg::Odometry::SharedPtr msg){ odometry_ = msg; });
    subPoseStamped = this->create_subscription<geometry_msgs::msg::PoseStamped>(
        "tf_pose", 5, std::bind(&TrackedVehicleNavigation::PoseStampedCallback, this, _1));

    subPathPoint = this->create_subscription<std_msgs::msg::Float64MultiArray>(
        "path_point", 1, std::bind(&TrackedVehicleNavigation::PathPointCallback, this, _1));
    subPathPointLeft = this->create_subscription<std_msgs::msg::Float64MultiArray>(
        "path_point_left", 1, std::bind(&TrackedVehicleNavigation::PathPointLeftCallback, this, _1));
    subPathPointRight = this->create_subscription<std_msgs::msg::Float64MultiArray>(
        "path_point_right", 1, std::bind(&TrackedVehicleNavigation::PathPointRightCallback, this, _1));

    subCloseRoute = this->create_subscription<std_msgs::msg::UInt8>(
        "close_route", 5, std::bind(&TrackedVehicleNavigation::CloseRouteCallback, this, _1));
    subObstacleAvoidance = this->create_subscription<std_msgs::msg::UInt8>(
        "obstacle_avoidance", 1, std::bind(&TrackedVehicleNavigation::ObstacleAvoidanceCallback, this, _1));

    subVehicleRunStar = this->create_subscription<std_msgs::msg::UInt8>(
        "vehicle_run_star", 1, std::bind(&TrackedVehicleNavigation::VchicleRunStarCallback, this, _1));
    subVehicleSpin = this->create_subscription<std_msgs::msg::Float32>(
        "spin_action", 1, std::bind(&TrackedVehicleNavigation::VchicleSpinCallback, this, _1));
}

void TrackedVehicleNavigation::timer_callback() {
    pubRunStatus->publish(_vehicle_run_status);
}

// -------------------------------------------------------------
// 几何与数学辅助计算
// -------------------------------------------------------------
float TrackedVehicleNavigation::LIMIT(float min_data, float actual_data, float max_data) {
    if (actual_data < min_data) return min_data;
    if (actual_data > max_data) return max_data;
    return actual_data;
}

double TrackedVehicleNavigation::distance(const Point& p1, const Point& p2) {
    return std::hypot(p2.x - p1.x, p2.y - p1.y);
}

double TrackedVehicleNavigation::dotProduct(Point v1, Point v2) {
    return v1.x * v2.x + v1.y * v2.y;
}

double TrackedVehicleNavigation::crossProduct(Point v1, Point v2) {
    return v1.x * v2.y - v2.x * v1.y;
}

double TrackedVehicleNavigation::vectorLength(Point v) {
    return std::hypot(v.x, v.y);
}

float TrackedVehicleNavigation::VectorAngle(Point v1, Point v2) {
    return static_cast<float>(std::atan2(crossProduct(v1, v2), dotProduct(v1, v2)));
}

// 计算点 C 投影在线段 AB 上的垂足（线段内截断，避免外溢）
TrackedVehicleNavigation::Point TrackedVehicleNavigation::calculateP(Point A, Point B, Point C) {
    Point AB{B.x - A.x, B.y - A.y};
    Point AC{C.x - A.x, C.y - A.y};
    double ab_len_sq = AB.x * AB.x + AB.y * AB.y;
    if (ab_len_sq < 1e-6) {
        return A;
    }
    double t = dotProduct(AB, AC) / ab_len_sq;
    t = std::clamp(t, 0.0, 1.0);
    return Point{A.x + AB.x * t, A.y + AB.y * t};
}

TrackedVehicleNavigation::Point TrackedVehicleNavigation::calculateQ(Point P, Point B, double L) {
    Point PB{B.x - P.x, B.y - P.y};
    double len = vectorLength(PB);
    if (len < 1e-6) {
        return B;
    }
    double factor = L / len;
    return Point{P.x + PB.x * factor, P.y + PB.y * factor};
}

// -------------------------------------------------------------
// 核心：自适应前瞻与曲率调速 (Regulated Pure Pursuit)
// -------------------------------------------------------------
float TrackedVehicleNavigation::calculateAdaptiveLookahead(float current_velocity) {
    float dyn_dist = std::abs(current_velocity) * _lookahead_time;
    return std::clamp(dyn_dist, _min_lookahead_dist, _max_lookahead_dist);
}

// 根据转弯曲率自适应减速：向心加速度 a_lat = v^2 * kappa <= a_lat_max
float TrackedVehicleNavigation::regulateCurvatureSpeed(float target_speed, float curvature, float min_speed) {
    float abs_k = std::abs(curvature);
    if (abs_k < 1e-4F) {
        return target_speed;
    }
    // 理论最高过弯速度: v = sqrt(a_lat_max / curvature)
    float max_curve_speed = std::sqrt(_max_lateral_accel / abs_k);
    float regulated = std::min(target_speed, max_curve_speed);
    return regulated;
}

// Normal tracking: bounded acceleration and jerk; protective stops bypass smoothing.
void TrackedVehicleNavigation::applyVelocityLimits(float& target_linear, float& target_angular, double dt) {
    if (dt <= 0.0 || dt > 0.2) {
        dt = 0.05;
    }

    target_linear = orange_nav::limitJerk(target_linear, prev_linear_velocity_, linear_acceleration_,
        _max_linear_accel, _max_linear_decel, _max_linear_jerk, static_cast<float>(dt));
    target_angular = orange_nav::limitJerk(target_angular, prev_angular_velocity_, angular_acceleration_,
        _max_angular_accel, _max_angular_accel, _max_angular_jerk, static_cast<float>(dt));
    target_linear = std::clamp(target_linear, -_max_velocity, _max_velocity);
    target_angular = std::clamp(target_angular, -_angular_velocity_limit, _angular_velocity_limit);

    prev_linear_velocity_ = target_linear;
    prev_angular_velocity_ = target_angular;
}

// 梯形终点逼近减速
float TrackedVehicleNavigation::speedctrl(float deceleration, float speed, float path_distance, float min_speed) {
    if (path_distance <= 0.0F) {
        return min_speed;
    }
    float decel_dist = (speed * speed) / (2.0F * deceleration);
    if (path_distance >= decel_dist) {
        return speed;
    }
    float target = std::sqrt(2.0F * deceleration * path_distance);
    return std::max(target, min_speed);
}

// -------------------------------------------------------------
// RPP 主控制器：连续折线前瞻、遇弯降速不停顿
// -------------------------------------------------------------
TrackedVehicleNavigation::VehicleControl TrackedVehicleNavigation::RegulatedPurePursuitController(
    const Posture& curPose,
    double active_path[][PATH_POINT_FIELDS],
    std::size_t path_len,
    std::size_t& current_seg_index)
{
    VehicleControl ctrl;
    if (path_len < 2 || current_seg_index >= path_len-1) {
        ctrl.run_finish = true;
        return ctrl;
    }

    // 1. 在当前段及前方搜索当前位置在路径上的最近投影点，确定行进进度
    std::size_t search_end = std::min(current_seg_index + 3, path_len - 1);
    double min_dist = std::numeric_limits<double>::max();
    std::size_t best_seg = current_seg_index;
    Point best_proj{active_path[current_seg_index][0], active_path[current_seg_index][1]};

    for (std::size_t i = current_seg_index; i < search_end; ++i) {
        Point A{active_path[i][0], active_path[i][1]};
        Point B{active_path[i + 1][0], active_path[i + 1][1]};
        Point P = calculateP(A, B, curPose.pos);
        double d = distance(curPose.pos, P);
        if (d < min_dist) {
            min_dist = d;
            best_seg = i;
            best_proj = P;
        }
    }
    current_seg_index = best_seg;

    // 2. 计算自适应前瞻距离并在整条连续路径上向前截取前瞻点 QQ
    float L = calculateAdaptiveLookahead(prev_linear_velocity_);
    Point lookahead_pt = best_proj;
    double accumulated = 0.0;
    std::size_t walk_idx = current_seg_index;

    // 当前段剩余距离
    Point seg_end{active_path[walk_idx + 1][0], active_path[walk_idx + 1][1]};
    double first_seg_rem = distance(best_proj, seg_end);

    if (L <= first_seg_rem) {
        lookahead_pt = calculateQ(best_proj, seg_end, L);
    } else {
        accumulated += first_seg_rem;
        walk_idx++;
        bool found = false;
        while (walk_idx < path_len - 1) {
            Point p_start{active_path[walk_idx][0], active_path[walk_idx][1]};
            Point p_finish{active_path[walk_idx + 1][0], active_path[walk_idx + 1][1]};
            double seg_len = distance(p_start, p_finish);
            if (accumulated + seg_len >= L) {
                double seg_need = L - accumulated;
                lookahead_pt = calculateQ(p_start, p_finish, seg_need);
                found = true;
                break;
            }
            accumulated += seg_len;
            walk_idx++;
        }
        if (!found) {
            // 超出整条路径末端，取终点
            lookahead_pt = Point{active_path[path_len - 1][0], active_path[path_len - 1][1]};
        }
    }

    // 3. 计算预瞄向量与航向角误差
    Point to_lookahead{lookahead_pt.x - curPose.pos.x, lookahead_pt.y - curPose.pos.y};
    double lookahead_dist_actual = std::max(vectorLength(to_lookahead), 0.1);
    float target_yaw = static_cast<float>(std::atan2(to_lookahead.y, to_lookahead.x));

    // Path bearing determines curvature; reverse travel keeps the body facing backward.
    float path_alpha = orange_nav::wrapAngle(target_yaw - static_cast<float>(curPose.yaw));

    // 4. 纯跟踪曲率: kappa = 2 * sin(alpha) / L
    float curvature = static_cast<float>(2.0 * std::sin(path_alpha) / lookahead_dist_actual);

    // 5. 目标速度获取（读取分段速度）
    float seg_speed = static_cast<float>(active_path[current_seg_index][4]);
    seg_speed = std::clamp(seg_speed, -_max_velocity, _max_velocity);
    bool is_reverse = (seg_speed < 0.0F);
    float heading_alpha = orange_nav::bodyHeadingError(target_yaw, static_cast<float>(curPose.yaw), is_reverse);
    float desired_speed = std::abs(seg_speed);

    // 6. 曲率自适应控速（直道全速，弯道平滑降速不停车）
    float target_v = regulateCurvatureSpeed(desired_speed, curvature, _min_velocity);

    // 7. 计算整条路径剩余总距离，用于平滑终点进站
    double remaining_dist = distance(curPose.pos, Point{active_path[current_seg_index + 1][0], active_path[current_seg_index + 1][1]});
    for (std::size_t i = current_seg_index + 1; i < path_len - 1; ++i) {
        remaining_dist += distance(Point{active_path[i][0], active_path[i][1]}, Point{active_path[i + 1][0], active_path[i + 1][1]});
    }

    // Reserve braking distance for acceleration ramp-down; no cruise-speed floor at the goal.
    const float ramp_distance = std::abs(prev_linear_velocity_) * _max_linear_decel / std::max(_max_linear_jerk, 0.01F);
    const float brake_distance = std::max(0.0F, static_cast<float>(remaining_dist) - ramp_distance);
    target_v = std::min(target_v, std::sqrt(_max_linear_decel * brake_distance));

    if (is_reverse) {
        target_v = -target_v;
    }

    // 8. 智能自转与转弯切换
    float seg_run_mode = static_cast<float>(active_path[current_seg_index][5]);
    const auto spin_action = spin_mode_gate_.step(
        seg_run_mode > 0.5F, heading_alpha,
        _yaw_goal_tolerance * orange_nav::pi / 180.0F,
        _spin_angle_threshold * orange_nav::pi / 180.0F,
        stoppedFeedback() && std::abs(prev_linear_velocity_) < 0.01F &&
            std::abs(prev_angular_velocity_) < 0.01F);

    // A contiguous explicit-spin section aligns once, then resumes tracking.
    if (spin_action != orange_nav::SpinAction::Track) {
        ctrl.linear_velocity = 0.0F;
        if (spin_action == orange_nav::SpinAction::WaitForStop) return ctrl;
        float rot_w = LIMIT(-_angular_velocity_limit, heading_alpha * _proportion, _angular_velocity_limit);
        if (rot_w > 0 && rot_w < _min_angular_velocity)  rot_w = _min_angular_velocity;
        if (rot_w < 0 && rot_w > -_min_angular_velocity) rot_w = -_min_angular_velocity;
        ctrl.angular_velocity = rot_w;

        return ctrl;
    }

    // 连续动态跟踪角速度
    float target_w = target_v * curvature;
    target_w = LIMIT(-_angular_velocity_limit, target_w, _angular_velocity_limit);

    ctrl.linear_velocity  = target_v;
    ctrl.angular_velocity = target_w;

    // 9. 到达终点判定
    Point final_goal{active_path[path_len - 1][0], active_path[path_len - 1][1]};
    double dist_to_final = distance(curPose.pos, final_goal);

    if (current_seg_index >= path_len - 2 && dist_to_final <= _xy_goal_tolerance) goal_braking_ = true;
    if (goal_braking_) {
        ctrl.run_finish = stoppedFeedback() && std::abs(prev_linear_velocity_) < 0.01F && std::abs(prev_angular_velocity_) < 0.01F;
        if (ctrl.run_finish && dist_to_final > _xy_goal_tolerance) {
            ctrl.run_finish = false;
            _run_vehicle = 0;
            publishNavResult("failed");
            RCLCPP_ERROR(get_logger(), "Stopped outside goal tolerance; inspect braking parameters before retry");
        }
        ctrl.linear_velocity = 0.0F;
        ctrl.angular_velocity = 0.0F;
    }

    return ctrl;
}

bool TrackedVehicleNavigation::stoppedFeedback() const {
    if (!odometry_) return false;
    const auto age = (get_clock()->now() - rclcpp::Time(odometry_->header.stamp)).seconds();
    const auto &v = odometry_->twist.twist;
    return age >= -0.1 && age < 1.0 && std::isfinite(v.linear.x) && std::isfinite(v.linear.y) && std::isfinite(v.angular.z) &&
        std::abs(v.linear.x) < 0.02 && std::abs(v.linear.y) < 0.02 && std::abs(v.angular.z) < 0.02;
}

// 独立原地自转控制器
TrackedVehicleNavigation::VehicleControl TrackedVehicleNavigation::SpinController(
    const Point& yaw_goal_vector,
    const Point& actual_angle_vector,
    float proportion,
    float yaw_goal_tolerance,
    float angular_velocity_limit)
{
    VehicleControl ctrl;
    float rad_diff = VectorAngle(actual_angle_vector, yaw_goal_vector);
    float deg_diff = rad_diff * 180.0F / static_cast<float>(M_PI);

    float w = LIMIT(-angular_velocity_limit, rad_diff * proportion, angular_velocity_limit);
    if (w > 0 && w < _min_angular_velocity)  w = _min_angular_velocity;
    if (w < 0 && w > -_min_angular_velocity) w = -_min_angular_velocity;

    ctrl.linear_velocity = 0.0F;
    ctrl.angular_velocity = w;
    ctrl.spin_finish = (std::abs(deg_diff) < yaw_goal_tolerance);
    return ctrl;
}

// -------------------------------------------------------------
// 控制循环（每 50ms 触发一次，20Hz）
// -------------------------------------------------------------
void TrackedVehicleNavigation::vehicle_ctrl_callback() {
    rclcpp::Time now = this->get_clock()->now();
    double dt = 0.05;
    if (!is_first_ctrl_cycle_) {
        dt = (now - last_control_time_).seconds();
    }
    is_first_ctrl_cycle_ = false;
    last_control_time_ = now;
    if (_run_vehicle == 1 && (!odometry_ ||
        (now-rclcpp::Time(odometry_->header.stamp)).seconds() > 1.0 ||
        (now-rclcpp::Time(odometry_->header.stamp)).seconds() < -0.1 ||
        !std::isfinite(odometry_->twist.twist.linear.x) || !std::isfinite(odometry_->twist.twist.angular.z))) {
        publishNavResult("failed");_run_vehicle = 0;
        prev_linear_velocity_ = prev_angular_velocity_ = linear_acceleration_ = angular_acceleration_ = 0;
        cmdVelOutput(0,0);return;
    }

    // Compare source stamps, not shared_ptr identity: TF may replay an old pose.
    if (!vehicle_pose_ || (now - rclcpp::Time(vehicle_pose_->header.stamp)).seconds() > 1.0 ||
        (now - rclcpp::Time(vehicle_pose_->header.stamp)).seconds() < -0.1) {
        if (_run_vehicle == 1) publishNavResult("failed");
        _run_vehicle = 0;
        prev_linear_velocity_ = prev_angular_velocity_ = linear_acceleration_ = angular_acceleration_ = 0;
        cmdVelOutput(0.0F, 0.0F);
        return;
    }

    // 获取小车姿态 (x, y, yaw) 并应用偏置
    double roll, pitch, yaw;
    tf2::Quaternion quat;
    tf2::fromMsg(vehicle_pose_->pose.orientation, quat);
    tf2::Matrix3x3(quat).getRPY(roll, pitch, yaw);

    _curC.pos.x = vehicle_pose_->pose.position.x - (_pose_offset_x_ * std::cos(yaw) - _pose_offset_y_ * std::sin(yaw));
    _curC.pos.y = vehicle_pose_->pose.position.y - (_pose_offset_x_ * std::sin(yaw) + _pose_offset_y_ * std::cos(yaw));
    _curC.yaw   = yaw;

    // 1. 正常路径跟踪模式
    if (_run_vehicle == 1 && _Received_path && !_spin_vehicle_flag) {
        bool path_ok = ObstacleAvoidancePathSelect();
        if (!path_ok) {
            prev_linear_velocity_ = prev_angular_velocity_ = linear_acceleration_ = angular_acceleration_ = 0;
            cmdVelOutput(0.0F, 0.0F);
            return;
        }

        // 确定活跃路径指针与长度
        double (*active_path)[PATH_POINT_FIELDS] = _path_point;
        std::size_t active_len = _path_point_number;
        if (_obstacle_avoidance == obstacle_avoidance_mode::left_path) {
            active_path = _path_point_left;
            active_len  = _path_point_number_left;
        } else if (_obstacle_avoidance == obstacle_avoidance_mode::right_path) {
            active_path = _path_point_right;
            active_len  = _path_point_number_right;
        }

        // 调用 RPP 控制器
        Ctrldata = RegulatedPurePursuitController(_curC, active_path, active_len, _path_point_count);

        // 发布当前路段信息
        if (_path_point_count < active_len) {
            std_msgs::msg::UInt32 point_id_msg;
            point_id_msg.data = static_cast<uint32_t>(active_path[_path_point_count][3]);
            pubPathTrackingStatus->publish(point_id_msg);
            // Correlated zero-based target index; alternate avoidance paths are not the submitted route.
            publishNavResult("progress\n" + (_obstacle_avoidance == 0 && _path_point_count < original_targets_.size() ? std::to_string(original_targets_.at(_path_point_count)) : std::string("-1")));

            _location_mode.data = static_cast<uint8_t>(active_path[_path_point_count][6]);
            pubLocationMode->publish(_location_mode);
        }

        // 任务完成判定
        if (Ctrldata.run_finish) {
            _Received_path = false;
            _Received_path_right = false;
            _Received_path_left = false;
            _run_vehicle = 0;
            _obstacle_avoidance = 0;

            std_msgs::msg::UInt8 finish_msg;
            finish_msg.data = 1;

            // 终点自转检查
            float final_run_mode = static_cast<float>(active_path[active_len - 1][5]);
            if (final_run_mode > 0.5F) {
                _goal_spin_yaw = static_cast<float>(active_path[active_len - 1][2]);
                _spin_vehicle_flag = true;
                _run_vehicle = 1;
            } else {
                pubGoalFinish->publish(finish_msg);
                publishNavResult("success");
            }
            _path_point_count = 0;
            RCLCPP_INFO(this->get_logger(), "=== 路径任务执行完毕，顺利到达终点！===");
        }

        // 动力学平滑并输出
        applyVelocityLimits(Ctrldata.linear_velocity, Ctrldata.angular_velocity, dt);
        cmdVelOutput(Ctrldata.linear_velocity, Ctrldata.angular_velocity);
        _vehicle_run_status.data = RunStatus::LinearRunning;

        RCLCPP_INFO_THROTTLE(this->get_logger(), *this->get_clock(), 1000,
            "[RPP巡航] 坐标:(%.2f, %.2f) 航向:%.1f° 线速:%.2fm/s 角速:%.2frad/s 路段:%zu/%zu",
            _curC.pos.x, _curC.pos.y, _curC.yaw * 180.0 / M_PI,
            Ctrldata.linear_velocity, Ctrldata.angular_velocity,
            _path_point_count + 1, active_len);
    }
    // 2. 独立/终点自转模式
    else if (_run_vehicle == 1 && !_Received_path && _spin_vehicle_flag) {
        Point goal_vec{std::cos(_goal_spin_yaw), std::sin(_goal_spin_yaw)};
        Point cur_vec{std::cos(_curC.yaw), std::sin(_curC.yaw)};

        Ctrldata = SpinController(goal_vec, cur_vec, _proportion, _yaw_goal_tolerance, _angular_velocity_limit);

        if (Ctrldata.spin_finish) Ctrldata.angular_velocity = 0;
        if (Ctrldata.spin_finish && stoppedFeedback() && std::abs(prev_angular_velocity_) < 0.01F) {
            _spin_vehicle_flag = false;
            _run_vehicle = 0;
            Ctrldata.angular_velocity = 0;
            std_msgs::msg::UInt8 finish_msg;
            finish_msg.data = 2; // 自转完成
            pubGoalFinish->publish(finish_msg);
            publishNavResult("success");
            RCLCPP_INFO(this->get_logger(), "=== 原地自转对齐完成 ===");
        }

        applyVelocityLimits(Ctrldata.linear_velocity, Ctrldata.angular_velocity, dt);
        cmdVelOutput(Ctrldata.linear_velocity, Ctrldata.angular_velocity);
        _vehicle_run_status.data = RunStatus::SpinRunning;
    }
    // 3. 停车/待机模式
    else {
        float stop_v = 0.0F;
        float stop_w = 0.0F;
        applyVelocityLimits(stop_v, stop_w, dt);
        cmdVelOutput(stop_v, stop_w);

        if (!_Received_path && _run_vehicle == 0) {
            _vehicle_run_status.data = RunStatus::Finished;
        } else if (!_Received_path && _run_vehicle == 1) {
            _vehicle_run_status.data = RunStatus::Warning;
        } else if (_Received_path && _run_vehicle == 0) {
            _vehicle_run_status.data = RunStatus::Paused;
        }
    }
}

// -------------------------------------------------------------
// 输出底层控制指令
// -------------------------------------------------------------
void TrackedVehicleNavigation::cmdVelOutput(float linear_velocity, float angular_velocity) {
    auto twist_msg = geometry_msgs::msg::Twist();
    twist_msg.linear.x  = linear_velocity;
    twist_msg.angular.z = angular_velocity;
    pubCmdVel->publish(twist_msg);
}

// -------------------------------------------------------------
// 回调处理
// -------------------------------------------------------------
void TrackedVehicleNavigation::PoseStampedCallback(const geometry_msgs::msg::PoseStamped::SharedPtr vehiclePose) {
    if (vehiclePose != nullptr) {
        vehicle_pose_ = vehiclePose;
    }
}

void TrackedVehicleNavigation::PathPointCallback(const std_msgs::msg::Float64MultiArray::SharedPtr paraMsg) {
    if (!validRouteSpeeds(paraMsg->data) || paraMsg->data.size() % PATH_POINT_FIELDS != 0 ||
        paraMsg->data.size() / PATH_POINT_FIELDS > MAX_PATH_POINTS ||
        !std::all_of(paraMsg->data.begin(), paraMsg->data.end(), [](double v) { return std::isfinite(v); })) {
        RCLCPP_ERROR(get_logger(), "Invalid path array; expected finite 9*N, at most 1000 points");
        if (!paraMsg->layout.dim.empty()) {
            std_msgs::msg::String result; result.data = paraMsg->layout.dim.front().label + "\nfailed";
            pubNavResult->publish(result);
        }
        return;
    }
    nav_request_id_ = paraMsg->layout.dim.empty() ? "" : paraMsg->layout.dim.front().label;
    _path_point_number = paraMsg->data.size() / PATH_POINT_FIELDS;
    _Received_path     = true;
    _path_point_count  = 0;
    goal_braking_ = false;
    spin_mode_gate_.reset();
    is_first_ctrl_cycle_ = true;

    for (std::size_t i = 0; i < _path_point_number && i < MAX_PATH_POINTS; ++i) {
        for (std::size_t j = 0; j < PATH_POINT_FIELDS; ++j) {
            _path_point[i][j] = paraMsg->data[i * PATH_POINT_FIELDS + j];
        }
    }

    // Project-local speed planning and resampling; preserve original progress indices.
    orange_nav::BidirectionalVelocityProfiler::ProfilerParams profiler_params;
    profiler_params.max_accel = _max_linear_accel;
    profiler_params.max_decel = _max_linear_decel;
    profiler_params.max_lateral_accel = _max_lateral_accel;
    profiler_params.resample_step = 0.20F; // 20cm 密集插值，消除跳变
    profiler_params.min_speed = _min_velocity;

    orange_nav::BidirectionalVelocityProfiler::profile(
        _path_point, _path_point_number, MAX_PATH_POINTS, profiler_params, prev_linear_velocity_, &original_targets_);

    _location_mode.data = static_cast<uint8_t>(_path_point[0][6]);
    pubLocationMode->publish(_location_mode);

    std_msgs::msg::UInt8 received_finish;
    received_finish.data = obstacle_avoidance_mode::default_path;
    pubPathReceivedFinish->publish(received_finish);
    publishNavResult("accepted");

    RCLCPP_INFO(this->get_logger(), "收到主路径指令，经双向平滑规整后共 %zu 个稠密航点", _path_point_number);
}

void TrackedVehicleNavigation::PathPointLeftCallback(const std_msgs::msg::Float64MultiArray::SharedPtr paraMsg) {
    if (!validRouteSpeeds(paraMsg->data) || paraMsg->data.size() % PATH_POINT_FIELDS != 0 ||
        paraMsg->data.size() / PATH_POINT_FIELDS > MAX_PATH_POINTS ||
        !std::all_of(paraMsg->data.begin(), paraMsg->data.end(), [](double v) { return std::isfinite(v); })) {
        RCLCPP_ERROR(get_logger(), "Invalid path array; expected finite 9*N, at most 1000 points");
        if (!paraMsg->layout.dim.empty()) {
            std_msgs::msg::String result; result.data = paraMsg->layout.dim.front().label + "\nfailed";
            pubNavResult->publish(result);
        }
        return;
    }
    _path_point_number_left = paraMsg->data.size() / PATH_POINT_FIELDS;
    _Received_path_left     = true;

    for (std::size_t i = 0; i < _path_point_number_left && i < MAX_PATH_POINTS; ++i) {
        for (std::size_t j = 0; j < PATH_POINT_FIELDS; ++j) {
            _path_point_left[i][j] = paraMsg->data[i * PATH_POINT_FIELDS + j];
        }
    }

    orange_nav::BidirectionalVelocityProfiler::ProfilerParams profiler_params;
    profiler_params.max_accel = _max_linear_accel;
    profiler_params.max_decel = _max_linear_decel;
    profiler_params.max_lateral_accel = _max_lateral_accel;
    profiler_params.resample_step = 0.20F;
    profiler_params.min_speed = _min_velocity;

    orange_nav::BidirectionalVelocityProfiler::profile(
        _path_point_left, _path_point_number_left, MAX_PATH_POINTS, profiler_params, prev_linear_velocity_);

    std_msgs::msg::UInt8 received_finish;
    received_finish.data = obstacle_avoidance_mode::left_path;
    pubPathReceivedFinish->publish(received_finish);
    RCLCPP_INFO(this->get_logger(), "收到左避障路径，规整后共 %zu 个航点", _path_point_number_left);
}

void TrackedVehicleNavigation::PathPointRightCallback(const std_msgs::msg::Float64MultiArray::SharedPtr paraMsg) {
    if (!validRouteSpeeds(paraMsg->data) || paraMsg->data.size() % PATH_POINT_FIELDS != 0 ||
        paraMsg->data.size() / PATH_POINT_FIELDS > MAX_PATH_POINTS ||
        !std::all_of(paraMsg->data.begin(), paraMsg->data.end(), [](double v) { return std::isfinite(v); })) {
        RCLCPP_ERROR(get_logger(), "Invalid path array; expected finite 9*N, at most 1000 points");
        if (!paraMsg->layout.dim.empty()) {
            std_msgs::msg::String result; result.data = paraMsg->layout.dim.front().label + "\nfailed";
            pubNavResult->publish(result);
        }
        return;
    }
    _path_point_number_right = paraMsg->data.size() / PATH_POINT_FIELDS;
    _Received_path_right     = true;

    for (std::size_t i = 0; i < _path_point_number_right && i < MAX_PATH_POINTS; ++i) {
        for (std::size_t j = 0; j < PATH_POINT_FIELDS; ++j) {
            _path_point_right[i][j] = paraMsg->data[i * PATH_POINT_FIELDS + j];
        }
    }

    orange_nav::BidirectionalVelocityProfiler::ProfilerParams profiler_params;
    profiler_params.max_accel = _max_linear_accel;
    profiler_params.max_decel = _max_linear_decel;
    profiler_params.max_lateral_accel = _max_lateral_accel;
    profiler_params.resample_step = 0.20F;
    profiler_params.min_speed = _min_velocity;

    orange_nav::BidirectionalVelocityProfiler::profile(
        _path_point_right, _path_point_number_right, MAX_PATH_POINTS, profiler_params, prev_linear_velocity_);

    std_msgs::msg::UInt8 received_finish;
    received_finish.data = obstacle_avoidance_mode::right_path;
    pubPathReceivedFinish->publish(received_finish);
    RCLCPP_INFO(this->get_logger(), "收到右避障路径，规整后共 %zu 个航点", _path_point_number_right);
}


void TrackedVehicleNavigation::VchicleRunStarCallback(const std_msgs::msg::UInt8::SharedPtr paraMsg) {
    _run_vehicle = paraMsg->data;
    if (_run_vehicle == 0) {
        prev_linear_velocity_ = prev_angular_velocity_ = linear_acceleration_ = angular_acceleration_ = 0;
        cmdVelOutput(0, 0);
    }
    if (_run_vehicle == 1 && _Received_path) publishNavResult("running");
    RCLCPP_INFO(this->get_logger(), "收到车辆启停命令: %d", _run_vehicle);
}

void TrackedVehicleNavigation::ObstacleAvoidanceCallback(const std_msgs::msg::UInt8::SharedPtr paraMsg) {
    if (_obstacle_avoidance != paraMsg->data) {
        _path_point_count = 0;
        spin_mode_gate_.reset();
    }
    _obstacle_avoidance = paraMsg->data;
    RCLCPP_INFO(this->get_logger(), "避障模式切换: %d", _obstacle_avoidance);
}

void TrackedVehicleNavigation::CloseRouteCallback(const std_msgs::msg::UInt8::SharedPtr paraMsg) {
    _close_route = paraMsg->data;
    _path_point_count = 0;
    _run_mode_switch = false;
    _Received_path = false;
    _Received_path_right = false;
    _Received_path_left = false;
    _run_vehicle = 0;
    _obstacle_avoidance = 0;
    _spin_vehicle_flag = false;
    spin_mode_gate_.reset();
    prev_linear_velocity_ = 0.0F;
    prev_angular_velocity_ = 0.0F;
    linear_acceleration_ = angular_acceleration_ = 0;

    std_msgs::msg::UInt8 close_route_finish;
    close_route_finish.data = RunStatus::Canceled;
    pubCloseRouteFinish->publish(close_route_finish);
    publishNavResult("cancelled");

    _vehicle_run_status.data = RunStatus::Ready;
    cmdVelOutput(0.0F, 0.0F);
    RCLCPP_INFO(this->get_logger(), "路线已取消");
}

void TrackedVehicleNavigation::VchicleSpinCallback(const std_msgs::msg::Float32::SharedPtr paraMsg) {
    _goal_spin_yaw = paraMsg->data;
    _spin_vehicle_flag = true;
    _run_vehicle = 1;
    RCLCPP_INFO(this->get_logger(), "触发独立自转动作，目标航向: %.2f rad", _goal_spin_yaw);
}

bool TrackedVehicleNavigation::ObstacleAvoidancePathSelect() {
    auto mode = static_cast<obstacle_avoidance_mode>(_obstacle_avoidance);
    if (mode == default_path) {
        return _Received_path;
    } else if (mode == left_path) {
        return _Received_path_left;
    } else if (mode == right_path) {
        return _Received_path_right;
    } else if (mode == parking) {
        return false;
    }
    return false;
}

void TrackedVehicleNavigation::update_parameters() {
    // 保留空实现以维持接口兼容
}
