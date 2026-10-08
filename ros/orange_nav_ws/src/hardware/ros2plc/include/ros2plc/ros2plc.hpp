#ifndef ROS_2_PLC_HPP
#define ROS_2_PLC_HPP

#include <rclcpp/rclcpp.hpp>
#include <geometry_msgs/msg/twist.hpp>
#include <iostream>
#include <memory>
#include <modbus/modbus.h>
#include <chrono>
#include <thread>
#include <atomic>
#include <cstdint>
#include <stdexcept>
#include <mutex>

#include "nav_msgs/msg/odometry.hpp"
#include "sensor_msgs/msg/imu.hpp"
#include "std_msgs/msg/float32.hpp"
#include "std_msgs/msg/bool.hpp"
#include "std_msgs/msg/u_int8.hpp"
#include "geometry_msgs/msg/twist.hpp"
#include "std_msgs/msg/float32_multi_array.hpp"

#include <geometry_msgs/msg/transform_stamped.hpp>  // ROS 2 中 TransformStamped
//#include <tf2_ros/transform_broadcaster.hpp>        // ROS 2 中 TransformBroadcaster
#include "tf2_ros/transform_broadcaster.h"
#include "tf2/LinearMath/Quaternion.h" // 四元数类
#include "tf2_ros/static_transform_broadcaster.h" // 发布静态转换

#define PI 3.1415926

//IMU加速度计量程±2g，对应数据范围±32768
//加速度计原始数据转换位m/s^2单位，32768/2g=32768/19.6=1671.84
#define ACC_RATIO 	  (2*9.8/32768)

//IMU陀螺仪量程±500°，对应数据范围±32768
//陀螺仪原始数据转换位弧度(rad)单位
#define GYRO_RATIO   ((500*PI/180)/32768)

//机器人数据处理周期,单位S
#define DATA_PERIOD   0.02f

//遥控数据结构体
struct remote_ctrl
{
    float right_x;
    float right_y;
    float left_x;    
    float left_y;

};

//IMU数据结构体
struct imu_data
{
    float acc_x;
    float acc_y;
    float acc_z;    

    float gyro_x;
    float gyro_y;
    float gyro_z;
};

//IMU四元数结构体
struct imu_orientation_data
{
    float w;
    float x;
    float y;
    float z;    
};

//机器人速度数据结构体
struct velocity_data
{
    float linear_x;
    float linear_y;
    float angular_z;    
};

//机器人位置数据结构体
struct pose_data
{
    float pos_x;
    float pos_y;
    float angular_z;    
};

class ModbusMasterNode : public rclcpp::Node {
public:
    ModbusMasterNode();
    ~ModbusMasterNode();

private:

    void cmdVelCallback(const geometry_msgs::msg::Twist::SharedPtr cmd_vel_msg);
    void WebRemoteCtrlDataCallback(const geometry_msgs::msg::Twist::SharedPtr remote_ctrl_msg);
    void RemoteCtrlAutomaticSwitchCallback(const std_msgs::msg::UInt8::SharedPtr msg);
    void SpeedControlCallback(const std_msgs::msg::UInt8::SharedPtr msg);
    void PlcStartCallback(const std_msgs::msg::UInt8::SharedPtr msg);
    void timerCallback();
    void writeModbusRegisters();
    void readModbusRegisters();
    void workerLoop();
    void calculateImuQuaternion(struct imu_data imu_cel);
    void publishImu();
    void publishOdom();
    void publishBatVol();
    void publishOdomTF();
    void tryConnect();
    void resetDataTimeoutTimer();
    void dataTimeoutCallback();
    
    rclcpp::Publisher<nav_msgs::msg::Odometry>::SharedPtr odom_pub_;
    rclcpp::Publisher<sensor_msgs::msg::Imu>::SharedPtr imu_topic_;
    rclcpp::Publisher<std_msgs::msg::Float32>::SharedPtr bat_topic_;
    rclcpp::Publisher<std_msgs::msg::Bool>::SharedPtr plc_link_pub_;
    
    rclcpp::Subscription<geometry_msgs::msg::Twist>::SharedPtr cmd_vel_sub_;
    rclcpp::Subscription<geometry_msgs::msg::Twist>::SharedPtr remote_ctrl_sub_;
    rclcpp::Subscription<std_msgs::msg::UInt8>::SharedPtr remotectrl_automatic_switch_sub_;
    rclcpp::Subscription<std_msgs::msg::UInt8>::SharedPtr speed_control_sub_;
    rclcpp::Subscription<std_msgs::msg::UInt8>::SharedPtr plc_start_sub_;
    
    rclcpp::TimerBase::SharedPtr timer_;

    modbus_t* ctx_ = nullptr;
    std::string server_ip_;
    int server_port_;
    const int LINEAR_X_REGISTER = 0;
    const int LINEAR_Y_REGISTER = 2;
    const int ANGULAR_Z_REGISTER = 4;

    int counter_; // 用于交替执行读和写任务
    int RemoteCtrlAutomaticSwitch = 1;//是否为遥控状态
    struct imu_data imu_data_;    //IMU数据
    struct velocity_data vel_data_rev_;    //接收机器人的速度
    // Never write indeterminate velocity values to PLC registers on startup.
    struct velocity_data vel_data_send_{};  //发送机器人的速度
    struct imu_orientation_data orient_data_;  //IMU四元数姿态数据
    struct pose_data pos_data_;    //机器人的位置
    struct remote_ctrl remote_ctrl_;//遥控数据
    float  bat_vol_data_;    //机器人电池电压数据
    float LeftWheelSpeed;	//左轮转速
    float RightWheelSpeed;	//右轮转速
    float WheelBase = 0.62;		//轮距
    int speed_control = 10;
    std::atomic<int> plc_start_status{0};
    rclcpp::TimerBase::SharedPtr reconnect_timer_; // 重连定时器 [1](@ref)
    std::atomic<bool> is_connected_{false}; // 连接状态标志
    std::atomic<int64_t> last_plc_read_ms_{0}; // 最近一次成功读取寄存器的稳态时钟时间
    rclcpp::TimerBase::SharedPtr data_timeout_timer_; // 数据超时定时器
    bool timer_active_{false}; // 定时器激活状态标志
    
    // 异步 Modbus I/O 线程与线程安全保护
    std::thread worker_thread_;
    std::atomic<bool> worker_running_{false};
    std::mutex send_mutex_;
    std::mutex rev_mutex_;
    std::atomic<bool> has_new_rev_data_{false};
    
    //机器人车型参数
    std::string robot_type_send_ = "r20_mec";  
    
    std::string imu_frame_= "imu_link";
    std::string odom_frame_= "odom"; 
    std::string base_frame_= "base_footprint";
    //std::string odom_frame_= "odom"; 
    //std::string base_frame_= "base_footprint";

    //消息定义
    nav_msgs::msg::Odometry odom_msgs_;  //里程计发布消息
    sensor_msgs::msg::Imu imu_msgs_;  //IMU发布消息
    std_msgs::msg::Float32 bat_msgs_;  //电池电压发布消息
    
    bool pub_odom_tf_ = true;  // 是否发布 TF
    geometry_msgs::msg::TransformStamped transform_stamped_;  // 存储变换
    tf2_ros::TransformBroadcaster transform_broadcaster_;  // TF广播器
    
};

#endif
