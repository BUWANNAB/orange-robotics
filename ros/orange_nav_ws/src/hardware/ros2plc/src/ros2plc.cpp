#include <ros2plc/ros2plc.hpp>


using namespace std::chrono_literals;

ModbusMasterNode::ModbusMasterNode() : 
   Node("ros2plc"), 
   counter_(0),
   is_connected_(false), // 初始化连接状态为 false
   transform_broadcaster_(this){
    server_ip_ = this->declare_parameter<std::string>("server_ip", "");
    server_port_ = this->declare_parameter<int>("server_port", 502);
    if (server_ip_.empty() || server_port_ < 1 || server_port_ > 65535) {
        throw std::invalid_argument("ros2plc requires a verified server_ip and valid server_port");
    }
    RCLCPP_INFO(this->get_logger(), "Modbus endpoint: %s:%d", server_ip_.c_str(), server_port_);

    // 初始化 Modbus TCP 上下文
     // 初始化 Modbus TCP 上下文
    ctx_ = modbus_new_tcp(server_ip_.c_str(), server_port_);
    if (ctx_ == nullptr) {
        RCLCPP_FATAL(this->get_logger(), "无法创建 Modbus 上下文");
        // 不再抛出异常，而是设置定时器尝试后续连接
    } else {
        // 设置响应超时（1秒，0微秒）
        modbus_set_response_timeout(ctx_, 1, 0);
        
        // 尝试初始连接，但不中断程序
        tryConnect();
    }
    
        // 创建一个定时器，每50ms触发一次，频率为20Hz
    timer_ = create_wall_timer(
        50ms, 
        [this]() {
            this->timerCallback();
    });
    
    // 新增：创建一个专门用于重连的定时器，每5秒尝试一次重连
    reconnect_timer_ = create_wall_timer(
        5s,  // 5秒重试一次
        [this]() {
            if (!is_connected_) {
                RCLCPP_INFO(this->get_logger(), "尝试重新连接到Modbus从站...");
                this->tryConnect();
            }
        });
        
   // 创建数据超时定时器（初始为关闭状态）
   data_timeout_timer_ = create_wall_timer(
        1s,
        [this]() {
            this->dataTimeoutCallback();
        });
   data_timeout_timer_->cancel(); // 初始时关闭定时器


    odom_pub_ = this->create_publisher<nav_msgs::msg::Odometry>( "odom_topic", 10 );
    imu_topic_ = this->create_publisher<sensor_msgs::msg::Imu>( "imu_topic", 10 );
    bat_topic_ = this->create_publisher<std_msgs::msg::Float32>( "bat_topic", 10 );
    plc_link_pub_ = this->create_publisher<std_msgs::msg::Bool>("/plc_link_status", 10);

    // 创建 cmd_vel 订阅器
    cmd_vel_sub_ = create_subscription<geometry_msgs::msg::Twist>(
        "/cmd_vel", 10,
        [this](const geometry_msgs::msg::Twist::SharedPtr msg) {
        this->cmdVelCallback(msg);  // 调用带参数的版本
        }
    );
    
    speed_control_sub_ = create_subscription<std_msgs::msg::UInt8>(
        "/speed_control", 10,
        [this](const std_msgs::msg::UInt8::SharedPtr msg) {
        this->SpeedControlCallback(msg);  // 调用带参数的版本
        }
    );
    
    plc_start_sub_ = create_subscription<std_msgs::msg::UInt8>(
        "/plc_start", 10,
        [this](const std_msgs::msg::UInt8::SharedPtr msg) {
        this->PlcStartCallback(msg);  // 调用带参数的版本
        }
    );
    
    remote_ctrl_sub_ = create_subscription<geometry_msgs::msg::Twist>(
        "/WebRemoteCtrlData", 10,
        [this](const geometry_msgs::msg::Twist::SharedPtr msg) {
        this->WebRemoteCtrlDataCallback(msg); 
        }
    );
    
    remotectrl_automatic_switch_sub_ = create_subscription<std_msgs::msg::UInt8>(
        "/RemoteCtrlAutomaticSwitch", 10,
        [this](const std_msgs::msg::UInt8::SharedPtr msg) {
        this->RemoteCtrlAutomaticSwitchCallback(msg);  // 调用带参数的版本
        }
    );
    
    // 启动 Modbus 异步网络工作线程 (杜绝网络抖动阻塞 ROS 2 主循环)
    worker_running_ = true;
    worker_thread_ = std::thread(&ModbusMasterNode::workerLoop, this);
    RCLCPP_INFO(this->get_logger(), "Modbus 异步非阻塞通信工作线程已启动");
}

ModbusMasterNode::~ModbusMasterNode() {
    worker_running_ = false;
    if (worker_thread_.joinable()) {
        worker_thread_.join();
    }
    if (ctx_ != nullptr) {
        modbus_close(ctx_);
        modbus_free(ctx_);
    }
}

void ModbusMasterNode::dataTimeoutCallback() {
    RCLCPP_WARN(this->get_logger(), "速度数据超时，清零速度指令");
    
    // 清零速度指令 (互斥保护)
    {
        std::lock_guard<std::mutex> lock(send_mutex_);
        vel_data_send_.linear_x = 0;
        vel_data_send_.linear_y = 0;
        vel_data_send_.angular_z = 0;
    }
    
    // 关闭定时器
    data_timeout_timer_->cancel();
    timer_active_ = false;
}


void ModbusMasterNode::cmdVelCallback(const geometry_msgs::msg::Twist::SharedPtr cmd_vel_msg) {
    if (RemoteCtrlAutomaticSwitch == 1){
        {
            std::lock_guard<std::mutex> lock(send_mutex_);
            vel_data_send_.linear_x = (static_cast<float>(cmd_vel_msg->linear.x) * speed_control / 10.0);
            vel_data_send_.linear_y = (static_cast<float>(cmd_vel_msg->linear.y) * speed_control / 10.0);
            vel_data_send_.angular_z = (static_cast<float>(cmd_vel_msg->angular.z) * speed_control / 10.0);
        }
        
        // 重置定时器
        resetDataTimeoutTimer();
    }
}

void ModbusMasterNode::WebRemoteCtrlDataCallback(const geometry_msgs::msg::Twist::SharedPtr remote_ctrl_msg) {
    // 更新远程控制数据
    if (RemoteCtrlAutomaticSwitch == 0) {
        {
            std::lock_guard<std::mutex> lock(send_mutex_);
            vel_data_send_.linear_x = (static_cast<float>(remote_ctrl_msg->linear.x) * speed_control / 10.0);
            vel_data_send_.linear_y = (static_cast<float>(remote_ctrl_msg->linear.y) * speed_control / 10.0);
            vel_data_send_.angular_z = (static_cast<float>(remote_ctrl_msg->angular.z) * speed_control / 10.0);
        }
        
        // 重置定时器
        resetDataTimeoutTimer();
    }
}

void ModbusMasterNode::resetDataTimeoutTimer() {
    // 重置定时器（取消当前定时并重新开始）
    if (data_timeout_timer_) {
        data_timeout_timer_->cancel();
        data_timeout_timer_->reset();
    }
    
    // 如果定时器未激活，则启动
    if (!timer_active_) {
        data_timeout_timer_->reset();
        timer_active_ = true;
    }
}

void ModbusMasterNode::SpeedControlCallback(const std_msgs::msg::UInt8::SharedPtr msg) {
     speed_control = msg->data;
}

void ModbusMasterNode::PlcStartCallback(const std_msgs::msg::UInt8::SharedPtr msg) {
     if (msg->data > 1) {
         RCLCPP_WARN(this->get_logger(), "忽略未定义的 PLC 启动命令值: %u", static_cast<unsigned int>(msg->data));
         return;
     }
     plc_start_status.store(msg->data);
}


void ModbusMasterNode::RemoteCtrlAutomaticSwitchCallback(const std_msgs::msg::UInt8::SharedPtr msg) {
     RemoteCtrlAutomaticSwitch = msg->data;
}

void ModbusMasterNode::timerCallback() {
    // 主控制循环严格 20Hz (50ms)，由独立工作线程提供数据，杜绝网络阻塞卡顿
    if (has_new_rev_data_) {
        std::lock_guard<std::mutex> lock(rev_mutex_);
        has_new_rev_data_ = false;

        // 计算里程计数据 (纯航位推算)
        pos_data_.pos_x += (vel_data_rev_.linear_x * cos(pos_data_.angular_z) - vel_data_rev_.linear_y * sin(pos_data_.angular_z)) * DATA_PERIOD; 
        pos_data_.pos_y += (vel_data_rev_.linear_x * sin(pos_data_.angular_z) + vel_data_rev_.linear_y * cos(pos_data_.angular_z)) * DATA_PERIOD; 
        pos_data_.angular_z += vel_data_rev_.angular_z * DATA_PERIOD;

        // 计算 IMU 四元数姿态
        calculateImuQuaternion(imu_data_);
    }

    // 里程计可能来自上次成功读取，另行公布真实 Modbus 连接新鲜度。
    const auto now_ms = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
    std_msgs::msg::Bool link;
    const auto last_read_ms = last_plc_read_ms_.load();
    link.data = is_connected_.load() && last_read_ms > 0 && now_ms - last_read_ms < 500;
    plc_link_pub_->publish(link);

    // 稳定周期发布话题与 TF 变换
    publishOdom();
    publishImu();
    publishBatVol();
    publishOdomTF();

    counter_++;
}

// 异步工作线程核心循环 (负责全部 Modbus TCP 网络收发与重连)
void ModbusMasterNode::workerLoop() {
    while (worker_running_) {
        if (!is_connected_) {
            tryConnect();
            if (!is_connected_) {
                std::this_thread::sleep_for(std::chrono::seconds(2));
                continue;
            }
        }

        // 交替执行写入与读取
        writeModbusRegisters();
        std::this_thread::sleep_for(std::chrono::milliseconds(25));

        if (!worker_running_) break;

        readModbusRegisters();
        std::this_thread::sleep_for(std::chrono::milliseconds(25));
    }
}

// 新增连接尝试方法
void ModbusMasterNode::tryConnect() {
    if (ctx_ == nullptr) {
        return;
    }
    
    if (modbus_connect(ctx_) == -1) {
        RCLCPP_WARN_THROTTLE(this->get_logger(), *this->get_clock(), 5000,
                             "Modbus 连接等待中: %s (%s:%d)", modbus_strerror(errno), server_ip_.c_str(), server_port_);
        is_connected_ = false;
    } else {
        RCLCPP_INFO(this->get_logger(), "成功连接到 Modbus 从站 %s:%d", server_ip_.c_str(), server_port_);
        is_connected_ = true;
    }
}

// 写入方法 (后台线程执行，加锁保护发送缓冲区)
void ModbusMasterNode::writeModbusRegisters() {
    if (!is_connected_ || ctx_ == nullptr) return;

    uint16_t data[14];
    
    // 安全拷贝待发送的速度指令
    velocity_data send_copy;
    {
        std::lock_guard<std::mutex> lock(send_mutex_);
        send_copy = vel_data_send_;
    }

    memcpy(&data[0], &send_copy.linear_x, sizeof(float));
    memcpy(&data[2], &send_copy.linear_y, sizeof(float));
    memcpy(&data[4], &send_copy.angular_z, sizeof(float));
    
    static uint16_t sequence_number = 0;
    if (sequence_number > 500) {
        sequence_number = 0;
    }
    data[6] = sequence_number++;
    const int start_status = plc_start_status.load();
    data[7] = static_cast<uint16_t>(start_status);

    if (modbus_write_registers(ctx_, LINEAR_X_REGISTER, 8, data) != 8) {
        RCLCPP_WARN_THROTTLE(this->get_logger(), *this->get_clock(), 3000,
                             "写入 Modbus 失败: %s，标记断线重连", modbus_strerror(errno));
        is_connected_ = false;
    } else if (start_status == 1) {
        int expected = 1;
        plc_start_status.compare_exchange_strong(expected, 2);
    } else if (start_status == 2) {
        int expected = 2;
        plc_start_status.compare_exchange_strong(expected, 0);
    }
}

// 读取方法 (后台线程执行，读取并安全更新给节点)
void ModbusMasterNode::readModbusRegisters() {
    if (!is_connected_ || ctx_ == nullptr) return;
    
    uint16_t registers[20];
    if (modbus_read_input_registers(ctx_, 0, 20, registers) == -1) {
        RCLCPP_WARN_THROTTLE(this->get_logger(), *this->get_clock(), 3000,
                             "读取 Modbus 失败: %s，标记断线重连", modbus_strerror(errno));
        is_connected_ = false;
    } else {
        // 在互斥锁保护下更新共享数据
        std::lock_guard<std::mutex> lock(rev_mutex_);

        // 解析 IMU 加速度
        imu_data_.acc_x = ((double)((int16_t)(registers[0]*256+registers[1]))*ACC_RATIO);
        imu_data_.acc_y = ((double)((int16_t)(registers[2]*256+registers[3]))*ACC_RATIO);
        imu_data_.acc_z = ((double)((int16_t)(registers[4]*256+registers[5]))*ACC_RATIO);

        // 解析 IMU 陀螺仪
        imu_data_.gyro_x = ((double)((int16_t)(registers[6]*256+registers[7]))*GYRO_RATIO);
        imu_data_.gyro_y = ((double)((int16_t)(registers[8]*256+registers[9]))*GYRO_RATIO);
        imu_data_.gyro_z = ((double)((int16_t)(registers[10]*256+registers[11]))*GYRO_RATIO);

        // 解析底盘反馈速度
        vel_data_rev_.linear_x = (double)((int16_t)(registers[12]*256+registers[13]));
        vel_data_rev_.linear_y = (double)((int16_t)(registers[14]*256+registers[15]));
        vel_data_rev_.angular_z = (double)((int16_t)(registers[16]*256+registers[17]));

        // 解析电压
        bat_vol_data_ = (double)((registers[18]<<8)+registers[19]);

        has_new_rev_data_ = true;
        last_plc_read_ms_.store(std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now().time_since_epoch()).count());
    }
}

/*
 * @功  能  发布IMU话题消息
 */
void ModbusMasterNode::publishImu()
{
    //获取数据
    //imu_msgs_.header.stamp = ros::Time::now();
    imu_msgs_.header.stamp = rclcpp::Clock().now();
    imu_msgs_.header.frame_id = imu_frame_;
    imu_msgs_.angular_velocity.x = imu_data_.gyro_x;
    imu_msgs_.angular_velocity.y = imu_data_.gyro_y;
    imu_msgs_.angular_velocity.z = imu_data_.gyro_z;
    imu_msgs_.linear_acceleration.x = imu_data_.acc_x;
    imu_msgs_.linear_acceleration.y = imu_data_.acc_y;
    imu_msgs_.linear_acceleration.z = imu_data_.acc_z;
    imu_msgs_.orientation.x = orient_data_.x; 
    imu_msgs_.orientation.y = orient_data_.y; 
    imu_msgs_.orientation.z = orient_data_.z;
    imu_msgs_.orientation.w = orient_data_.w;

    //不使用姿态角度
    imu_msgs_.orientation.x = 0; 
    imu_msgs_.orientation.y = 0; 

    //协防差矩阵
    imu_msgs_.orientation_covariance = {  1e6,    0,    0,
                                            0,  1e6,    0,
                                            0,    0, 1e-6};
    imu_msgs_.angular_velocity_covariance = { 1e6,    0,    0,
                                                0,  1e6,    0,
                                                0,    0, 1e-6};
    imu_msgs_.linear_acceleration_covariance = {    0,    0,    0,
                                                    0,    0,    0,
                                                    0,    0,    0};

    //发布
    //imu_topic_.publish(imu_msgs_);
    imu_topic_->publish(imu_msgs_);
}

/*
 * @功  能  发布odom里程计话题消息
 */
void ModbusMasterNode::publishOdom()
{
    //计算里程计四元数
    tf2::Quaternion odom_quat;
    odom_quat.setRPY(0,0,pos_data_.angular_z);       

    //获取数据
    //odom_msgs_.header.stamp    = ros::Time::now();
    odom_msgs_.header.stamp = rclcpp::Clock().now();
    odom_msgs_.header.frame_id = odom_frame_;
    odom_msgs_.child_frame_id  = base_frame_;
    odom_msgs_.pose.pose.position.x = pos_data_.pos_x;
    odom_msgs_.pose.pose.position.y = pos_data_.pos_y;
    odom_msgs_.pose.pose.position.z = 0;  //高度为0
    odom_msgs_.pose.pose.orientation.x = odom_quat.getX();
    odom_msgs_.pose.pose.orientation.y = odom_quat.getY();
    odom_msgs_.pose.pose.orientation.z = odom_quat.getZ();
    odom_msgs_.pose.pose.orientation.w = odom_quat.getW();
    odom_msgs_.twist.twist.linear.x = vel_data_rev_.linear_x;
    odom_msgs_.twist.twist.linear.y = vel_data_rev_.linear_y;
    odom_msgs_.twist.twist.angular.z = vel_data_rev_.angular_z;

    //里程计协防差矩阵，用于robt_pose_ekf功能包，静止和运动使用不同的参数
    if(vel_data_rev_.linear_x==0 && vel_data_rev_.linear_y==0 && vel_data_rev_.angular_z==0)
    {
        //机器人静止时，IMU水平陀螺仪会存在零飘，编码器没有误差，编码器数据权重增加
        odom_msgs_.pose.covariance = {   1e-9,    0,    0,    0,    0,    0, 
                                            0, 1e-3, 1e-9,    0,    0,    0,
                                            0,    0,  1e6,    0,    0,    0,
                                            0,    0,    0,  1e6,    0,    0,
                                            0,    0,    0,    0,  1e6,    0,
                                            0,    0,    0,    0,    0, 1e-9 };

        odom_msgs_.twist.covariance = {  1e-9,    0,    0,    0,    0,    0, 
                                            0, 1e-3, 1e-9,    0,    0,    0,
                                            0,    0,  1e6,    0,    0,    0,
                                            0,    0,    0,  1e6,    0,    0,
                                            0,    0,    0,    0,  1e6,    0,
                                            0,    0,    0,    0,    0, 1e-9 };
    }
    else
    {
        //机器人运动时，轮子滑动编码器误差增加，IMU陀螺仪数据更加准确，IMU数据权重增加
        odom_msgs_.pose.covariance = {   1e-3,    0,    0,    0,    0,    0, 
                                            0, 1e-3,    0,    0,    0,    0,
                                            0,    0,  1e6,    0,    0,    0,
                                            0,    0,    0,  1e6,    0,    0,
                                            0,    0,    0,    0,  1e6,    0,
                                            0,    0,    0,    0,    0,  1e3 };

        odom_msgs_.twist.covariance = {  1e-3,    0,    0,    0,    0,    0, 
                                            0, 1e-3,    0,    0,    0,    0,
                                            0,    0,  1e6,    0,    0,    0,
                                            0,    0,    0,  1e6,    0,    0,
                                            0,    0,    0,    0,  1e6,    0,
                                            0,    0,    0,    0,    0,  1e3 };
    }

    //发布
    odom_pub_->publish(odom_msgs_);
}

/*
 * @功  能  发布电池电压话题消息
 */
void ModbusMasterNode::publishBatVol()
{
    //获取数据
    bat_msgs_.data = bat_vol_data_;

    //发布
    bat_topic_->publish(bat_msgs_);
}

/*
 * @功  能  发布里程计到base_footprint的TF坐标变换
 */
void ModbusMasterNode::publishOdomTF()
{
    //发布里程计到footprint坐标变换
    if(pub_odom_tf_ == true)
    {
        //计算里程计TF四元数
        tf2::Quaternion q;
        q.setRPY(0,0,pos_data_.angular_z);

        //填充数据
        transform_stamped_.header.stamp    = rclcpp::Clock().now();;
        transform_stamped_.header.frame_id = odom_frame_;
        transform_stamped_.child_frame_id  = base_frame_;

        transform_stamped_.transform.translation.x = pos_data_.pos_x;
        transform_stamped_.transform.translation.y = pos_data_.pos_y;
        transform_stamped_.transform.translation.z = 0.0;

        transform_stamped_.transform.rotation.x = q.x();
        transform_stamped_.transform.rotation.y = q.y();
        transform_stamped_.transform.rotation.z = q.z();
        transform_stamped_.transform.rotation.w = q.w();

        //发布TF坐标变换
        //transform_broadcaster_->sendTransform(transform_stamped);
        transform_broadcaster_.sendTransform(transform_stamped_);
    }
}

/***************四元数计算**************************************************/
volatile float twoKp = 1.0f;     // 2 * proportional gain (Kp)
volatile float twoKi = 0.0f;     // 2 * integral gain (Ki)
 // quaternion of sensor frame relative to auxiliary frame
volatile float q0 = 1.0f, q1 = 0.0f, q2 = 0.0f, q3 = 0.0f;         
 // integral error terms scaled by Ki
volatile float integralFBx = 0.0f,  integralFBy = 0.0f, integralFBz = 0.0f;
volatile const float sampling_period  = DATA_PERIOD;
/**************************************************************************
 * @功  能  平方根倒数 求四元数
 **************************************************************************/
float invSqrt(float x)
{
    volatile long i;
    volatile float halfx, y;
    volatile const float f = 1.5F;

    halfx = x * 0.5F;
    y = x;
    i = * (( long * ) &y);
    
    i = 0x5f375a86 - ( i >> 1 );
    y = * (( float * ) &i);
    y = y * ( f - ( halfx * y * y ) );

    return y;
}
/*************************************************************************
 * @功  能  计算IMU四元数
 *************************************************************************/
void ModbusMasterNode::calculateImuQuaternion(struct imu_data imu_cel)
{
    float recipNorm;
    float halfvx, halfvy, halfvz;
    float halfex, halfey, halfez;
    float qa, qb, qc;
    //float roll,pitch,yaw ;

    //首先把加速度计采集到的值(三维向量)转化为单位向量，即向量除以模
    recipNorm = invSqrt(imu_cel.acc_x * imu_cel.acc_x + imu_cel.acc_y * imu_cel.acc_y + imu_cel.acc_z * imu_cel.acc_z);

    imu_cel.acc_x *= recipNorm;
    imu_cel.acc_y *= recipNorm;
    imu_cel.acc_z *= recipNorm;      

    // 把四元数换算成方向余弦中的第三行的三个元素
    halfvx = q1 * q3 - q0 * q2;
    halfvy = q0 * q1 + q2 * q3;
    halfvz = q0 * q0 - 0.5f + q3 * q3;

    //误差是估计的重力方向和测量的重力方向的交叉乘积之和
    halfex = (imu_cel.acc_y * halfvz - imu_cel.acc_z * halfvy);
    halfey = (imu_cel.acc_z * halfvx - imu_cel.acc_x * halfvz);
    halfez = (imu_cel.acc_x * halfvy - imu_cel.acc_y * halfvx);

    // 计算并应用积分反馈（如果启用）
    if(twoKi > 0.0f) 
    {
        integralFBx += twoKi * halfex * sampling_period;  // integral error scaled by Ki
        integralFBy += twoKi * halfey * sampling_period;
        integralFBz += twoKi * halfez * sampling_period;
        imu_cel.gyro_x += integralFBx;        // apply integral feedback
        imu_cel.gyro_y += integralFBy;
        imu_cel.gyro_z += integralFBz;
    }
    else 
    {
        integralFBx = 0.0f;       // prevent integral windup
        integralFBy = 0.0f;
        integralFBz = 0.0f;
    }
    // Apply proportional feedback
    imu_cel.gyro_x += twoKp * halfex;
    imu_cel.gyro_y += twoKp * halfey;
    imu_cel.gyro_z += twoKp * halfez;        

    // Integrate rate of change of quaternion
    imu_cel.gyro_x *= (0.5f * sampling_period);   // pre-multiply common factors
    imu_cel.gyro_y *= (0.5f * sampling_period);
    imu_cel.gyro_z *= (0.5f * sampling_period);

    qa = q0;
    qb = q1;
    qc = q2;

    q0 += (-qb * imu_cel.gyro_x - qc * imu_cel.gyro_y - q3 * imu_cel.gyro_z);
    q1 += (qa * imu_cel.gyro_x + qc * imu_cel.gyro_z - q3 * imu_cel.gyro_y);
    q2 += (qa * imu_cel.gyro_y - qb * imu_cel.gyro_z + q3 * imu_cel.gyro_x);
    q3 += (qa * imu_cel.gyro_z + qb * imu_cel.gyro_y - qc * imu_cel.gyro_x); 

    // Normalise quaternion
    recipNorm = invSqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);

    q0 *= recipNorm;
    q1 *= recipNorm;
    q2 *= recipNorm;
    q3 *= recipNorm;

    //计算结果赋值到
    orient_data_.w = q0;
    orient_data_.x = q1;
    orient_data_.y = q2;
    orient_data_.z = q3;

}


int main(int argc, char** argv) {
    rclcpp::init(argc, argv);
    auto node = std::make_shared<ModbusMasterNode>();
    rclcpp::spin(node);
    rclcpp::shutdown();
    return 0;
}

