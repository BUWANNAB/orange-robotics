#ifndef VEHICLE_NAVIGATION__VEHICLE_NAVIGATION_HPP_
#define VEHICLE_NAVIGATION__VEHICLE_NAVIGATION_HPP_

#include <rclcpp/rclcpp.hpp>
#include "vehicle_navigation/tracking_logic.hpp"

#include <geometry_msgs/msg/pose_stamped.hpp>
#include <geometry_msgs/msg/twist.hpp>
#include <nav_msgs/msg/odometry.hpp>
#include <std_msgs/msg/float32.hpp>
#include <std_msgs/msg/float32_multi_array.hpp>
#include <std_msgs/msg/float64_multi_array.hpp>
#include <std_msgs/msg/string.hpp>
#include <std_msgs/msg/u_int8.hpp>
#include <std_msgs/msg/u_int8_multi_array.hpp>
#include <std_msgs/msg/u_int32.hpp>

#include <tf2/LinearMath/Matrix3x3.h>
#include <tf2/LinearMath/Quaternion.h>
#include <tf2_geometry_msgs/tf2_geometry_msgs.hpp>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <functional>
#include <memory>
#include <string>
#include <vector>

using namespace std::chrono_literals;
using std::placeholders::_1;

class TrackedVehicleNavigation : public rclcpp::Node {
public:
    TrackedVehicleNavigation();

private:
    void publishNavResult(const std::string &status);
    std::string nav_request_id_;
    rclcpp::Publisher<std_msgs::msg::String>::SharedPtr pubNavResult;
    rclcpp::Subscription<nav_msgs::msg::Odometry>::SharedPtr subOdom;
    nav_msgs::msg::Odometry::SharedPtr odometry_;
    bool goal_braking_ = false;
    orange_nav::SpinModeGate spin_mode_gate_;
    bool stoppedFeedback() const;
    static constexpr std::size_t MAX_PATH_POINTS = 1000;
    static constexpr std::size_t PATH_POINT_FIELDS = 9;

    // 编号与系统保持一致，上位机按此解析 /vehicle_run_status
    enum RunStatus : uint8_t {
        Preparing = 0,      // 正在准备
        Ready = 1,          // 就绪
        LinearRunning = 2,  // 正在直线运行
        SpinRunning = 3,    // 正在自转运行
        Paused = 4,         // 暂停中
        Finished = 5,       // 运行完成
        PathReceived = 6,   // 收到路径
        Canceled = 7,       // 取消完成
        Warning = 8         // 警报
    };

    enum obstacle_avoidance_mode : uint8_t {
        default_path = 0,
        left_path = 1,
        right_path = 2,
        parking = 3
    };

    struct Point {
        double x = 0.0;
        double y = 0.0;
    };

    struct Posture {
        Point pos;
        double yaw = 0.0;
    };

    struct VehicleControl {
        float linear_velocity = 0.0F;
        float angular_velocity = 0.0F;
        float Turning_angle = 0.0F;
        bool run_finish = false;
        bool spin_finish = false;
    };

    // 初始化与定时器
    void declare_parameters();
    void initialize_publishers();
    void initialize_subscribers();
    void timer_callback();
    void vehicle_ctrl_callback();
    void update_parameters();

    // 基础控制与几何函数
    void cmdVelOutput(float linear_velocity, float angular_velocity);
    float LIMIT(float min_data, float actual_data, float max_data);
    float VectorAngle(Point v1, Point v2);
    double distance(const Point& p1, const Point& p2);
    double dotProduct(Point v1, Point v2);
    double crossProduct(Point v1, Point v2);
    double vectorLength(Point v);
    Point calculateP(Point A, Point B, Point C);
    Point calculateQ(Point P, Point B, double L);
    float speedctrl(float deceleration, float speed, float path_distance, float min_speed);
    bool ObstacleAvoidancePathSelect();

    // --- Regulated Pure Pursuit (RPP) 工业级调速纯跟踪算法 ---
    VehicleControl RegulatedPurePursuitController(
        const Posture& curPose,
        double active_path[][PATH_POINT_FIELDS],
        std::size_t path_len,
        std::size_t& current_seg_index);

    VehicleControl SpinController(const Point& yaw_goal_vector, const Point& actual_angle_vector,
                                  float proportion, float yaw_goal_tolerance, float angular_velocity_limit);

    float calculateAdaptiveLookahead(float current_velocity);
    float regulateCurvatureSpeed(float target_speed, float curvature, float min_speed);
    void applyVelocityLimits(float& target_linear, float& target_angular, double dt);

    // ROS 回调
    void PoseStampedCallback(const geometry_msgs::msg::PoseStamped::SharedPtr vehiclePose);
    void PathPointCallback(const std_msgs::msg::Float64MultiArray::SharedPtr paraMsg);
    void PathPointLeftCallback(const std_msgs::msg::Float64MultiArray::SharedPtr paraMsg);
    void PathPointRightCallback(const std_msgs::msg::Float64MultiArray::SharedPtr paraMsg);
    void VchicleRunStarCallback(const std_msgs::msg::UInt8::SharedPtr paraMsg);
    void ObstacleAvoidanceCallback(const std_msgs::msg::UInt8::SharedPtr paraMsg);
    void CloseRouteCallback(const std_msgs::msg::UInt8::SharedPtr paraMsg);
    void VchicleSpinCallback(const std_msgs::msg::Float32::SharedPtr paraMsg);

    // 发布器
    rclcpp::Publisher<std_msgs::msg::UInt32>::SharedPtr pubPathTrackingStatus;
    rclcpp::Publisher<std_msgs::msg::UInt8>::SharedPtr pubGoalFinish;
    rclcpp::Publisher<geometry_msgs::msg::Twist>::SharedPtr pubCmdVel;
    rclcpp::Publisher<std_msgs::msg::UInt8>::SharedPtr pubLocationMode;
    rclcpp::Publisher<std_msgs::msg::UInt8>::SharedPtr pubPathReceivedFinish;
    rclcpp::Publisher<std_msgs::msg::UInt8>::SharedPtr pubCloseRouteFinish;
    rclcpp::Publisher<std_msgs::msg::UInt8>::SharedPtr pubWarning;
    rclcpp::Publisher<std_msgs::msg::UInt8>::SharedPtr pubRunStatus;

    // 订阅器
    rclcpp::Subscription<geometry_msgs::msg::PoseStamped>::SharedPtr subPoseStamped;
    rclcpp::Subscription<std_msgs::msg::Float64MultiArray>::SharedPtr subPathPoint;
    rclcpp::Subscription<std_msgs::msg::Float64MultiArray>::SharedPtr subPathPointLeft;
    rclcpp::Subscription<std_msgs::msg::Float64MultiArray>::SharedPtr subPathPointRight;
    rclcpp::Subscription<std_msgs::msg::UInt8>::SharedPtr subCloseRoute;
    rclcpp::Subscription<std_msgs::msg::UInt8>::SharedPtr subObstacleAvoidance;
    rclcpp::Subscription<std_msgs::msg::UInt8>::SharedPtr subVehicleRunStar;
    rclcpp::Subscription<std_msgs::msg::Float32>::SharedPtr subVehicleSpin;

    // 定时器
    rclcpp::TimerBase::SharedPtr timer_;
    rclcpp::TimerBase::SharedPtr vehicle_ctrl_timer_;

    // 位姿缓存
    geometry_msgs::msg::PoseStamped::SharedPtr vehicle_pose_ = nullptr;
    geometry_msgs::msg::PoseStamped::SharedPtr last_vehicle_pose_ = nullptr;

    // 控制参数
    float _lookahead_dist = 1.2F;
    float _min_lookahead_dist = 0.6F;
    float _max_lookahead_dist = 2.0F;
    float _lookahead_time = 1.2F;
    float _max_velocity = 1.0F;
    float _min_velocity = 0.15F;
    float _xy_goal_tolerance = 0.05F;
    float _xy_middle_tolerance = 0.25F;
    float _yaw_goal_tolerance = 2.0F;
    float _wheel_base = 0.8F;
    float _angular_velocity_limit = 0.6F;
    float _min_angular_velocity = 0.08F;
    float _proportion = 1.2F;
    float _pose_offset_x_ = 0.0F;
    float _pose_offset_y_ = 0.0F;

    // 平滑与动力学约束参数
    std::vector<std::size_t> original_targets_;
    float linear_acceleration_ = 0, angular_acceleration_ = 0;
    float _max_linear_jerk = 0.8F, _max_angular_jerk = 1.6F;
    float _max_linear_accel = 0.6F;
    float _max_linear_decel = 0.8F;
    float _max_angular_accel = 1.2F;
    float _max_lateral_accel = 0.5F;
    float _spin_angle_threshold = 60.0F;

    // 动力学平滑状态
    float prev_linear_velocity_ = 0.0F;
    float prev_angular_velocity_ = 0.0F;
    rclcpp::Time last_control_time_{0, 0, RCL_ROS_TIME};
    bool is_first_ctrl_cycle_ = true;

    // 路径与控制状态
    Posture _curC;
    VehicleControl Ctrldata;
    Point _starA;
    Point _endB;

    std_msgs::msg::Float64MultiArray _rev_path_point;
    std_msgs::msg::Float64MultiArray _rev_path_point_left;
    std_msgs::msg::Float64MultiArray _rev_path_point_right;
    std_msgs::msg::UInt8 _location_mode;
    std_msgs::msg::UInt8 _vehicle_run_status;

    double _path_point[MAX_PATH_POINTS][PATH_POINT_FIELDS] = {};
    double _path_point_left[MAX_PATH_POINTS][PATH_POINT_FIELDS] = {};
    double _path_point_right[MAX_PATH_POINTS][PATH_POINT_FIELDS] = {};

    std::size_t _path_point_number = 0;
    std::size_t _path_point_number_left = 0;
    std::size_t _path_point_number_right = 0;
    std::size_t _path_point_count = 0;

    bool _Received_path = false;
    bool _Received_path_left = false;
    bool _Received_path_right = false;
    bool _spin_vehicle_flag = false;
    bool _run_mode_switch = false;

    int _run_vehicle = 0;
    int _obstacle_avoidance = obstacle_avoidance_mode::default_path;
    int _close_route = 0;
    int _pose_up_count = 0;

    float _init_point_speed = 0.0F;
    float _run_mode = 0.0F;
    float _goal_spin_yaw = 0.0F;
};

#endif  // VEHICLE_NAVIGATION__VEHICLE_NAVIGATION_HPP_
