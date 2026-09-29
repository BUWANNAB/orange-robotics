#include "pcd2pgm.hpp"
#include "pcl/common/transforms.h"
#include "pcl/filters/radius_outlier_removal.h"
#include "pcl/io/pcd_io.h"
#include "pcl_conversions/pcl_conversions.h"
#include "tf2_geometry_msgs/tf2_geometry_msgs.hpp"
#include <iostream>
#include <algorithm>
#include <std_msgs/msg/int32.hpp>
#include <fstream>
#include <string>
#include <chrono>
#include <iomanip>
#include <random>
#include <cmath>
#include <cctype>
#include <cstddef>
#include <cstdlib>
#include <filesystem>
#include <stdexcept>

namespace pcd2pgm
{
// 展开共享运行目录；未配置时拒绝回退到源码目录或用户主目录。
std::string expandHome(const std::string& path)
{
  const char* home = std::getenv("HOME");
  std::string result = path;
  const char* runtime_prefixes[] = {"$ROBOT_PCD_DIR", "$ROBOT_MAP_DIR"};
  const char* runtime_values[] = {
    std::getenv("ROBOT_PCD_DIR"), std::getenv("ROBOT_MAP_DIR")};
  bool replaced_runtime_root = false;
  for (std::size_t index = 0; index < 2; ++index) {
    const char* prefix = runtime_prefixes[index];
    const char* value = runtime_values[index];
    if (result.rfind(prefix, 0) == 0) {
      if (value == nullptr || value[0] == '\0') {
        throw std::runtime_error(std::string(prefix) + " must be configured");
      }
      result.replace(0, std::string(prefix).size(), value);
      replaced_runtime_root = true;
      break;
    }
  }
  if (!replaced_runtime_root && result.rfind("$ROBOT_", 0) == 0) {
    throw std::runtime_error("Use ROBOT_PCD_DIR or ROBOT_MAP_DIR for map paths");
  }
  if (!replaced_runtime_root && home != nullptr && result.rfind("$HOME", 0) == 0) {
    result.replace(0, 5, home);
  } else if (!replaced_runtime_root && home != nullptr && result.rfind("~/", 0) == 0) {
    result.replace(0, 2, std::string(home) + "/");
  }
  return result;
}

Pcd2PgmNode::Pcd2PgmNode(const rclcpp::NodeOptions & options) : Node("pcd2pgm", options),
  true_callback_pub_(this->create_publisher<std_msgs::msg::Int32>("/true_callback", 10)),
  false_callback_pub_(this->create_publisher<std_msgs::msg::String>("/false_callback", 10)),
  pcd_cloud_(std::make_shared<pcl::PointCloud<pcl::PointXYZ>>()),
  cloud_after_pass_through_(std::make_shared<pcl::PointCloud<pcl::PointXYZ>>()),
  cloud_after_radius_(std::make_shared<pcl::PointCloud<pcl::PointXYZ>>()),
  original_pcd_cloud_(std::make_shared<pcl::PointCloud<pcl::PointXYZ>>())
{
    // 首先加载默认参数作为后备
  loadDefaultParameters();
  
  // 从节点自身的 ROS 2 参数覆盖默认值。
  declareParameters();
  getParameters();

  // 记录实际使用的参数
  RCLCPP_INFO(this->get_logger(), "使用的参数配置:");
  RCLCPP_INFO(this->get_logger(), "pcd_file: %s", pcd_file_.c_str());
  RCLCPP_INFO(this->get_logger(), "thre_z_min: %f", thre_z_min_);
  RCLCPP_INFO(this->get_logger(), "thre_z_max: %f", thre_z_max_);
  RCLCPP_INFO(this->get_logger(), "flag_pass_through: %d", flag_pass_through_);
  RCLCPP_INFO(this->get_logger(), "thre_radius: %f", thre_radius_);
  RCLCPP_INFO(this->get_logger(), "map_resolution: %f", map_resolution_);
  RCLCPP_INFO(this->get_logger(), "thres_point_count: %d", thres_point_count_);
  RCLCPP_INFO(this->get_logger(), "map_topic_name: %s", map_topic_name_.c_str());

  if (odom_to_lidar_odom_.size() >= 3) {
    RCLCPP_INFO(this->get_logger(), "odom_to_lidar_odom: [%f, %f, %f]", 
                odom_to_lidar_odom_[0], odom_to_lidar_odom_[1], odom_to_lidar_odom_[2]);
  } else {
    RCLCPP_WARN(this->get_logger(), "odom_to_lidar_odom_ 长度不足3，使用默认值");
    odom_to_lidar_odom_ = {0.0, 0.0, 0.0, 0.0, 0.0, 0.0};
  }
  
  RCLCPP_INFO(this->get_logger(), "map_save_path: %s", map_save_path_.c_str());
  RCLCPP_INFO(this->get_logger(), "map_save_name: %s", map_save_name_.c_str());
  RCLCPP_INFO(this->get_logger(), "rotated_pcd_save_path: %s", rotated_pcd_save_path_.c_str());

  rclcpp::QoS map_qos(10);
  map_qos.transient_local();
  map_qos.reliable();
  map_qos.keep_last(1);

map_publisher_ = create_publisher<nav_msgs::msg::OccupancyGrid>(map_topic_name_, map_qos);
  pcd_publisher_ = create_publisher<sensor_msgs::msg::PointCloud2>("pcd_cloud", 10);

  // 初始化订阅器
  initializeSubscribers();
    
RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "节点已初始化，等待/plan_start信号加载PCD文件");
}

void Pcd2PgmNode::initializeSubscribers()
{
    plan_start_sub_ = create_subscription<std_msgs::msg::Int32>(
        "/plan_start", 10, std::bind(&Pcd2PgmNode::planStartCallback, this, std::placeholders::_1));
    RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "已初始化/plan_start订阅器");

    terminate_sub_ = create_subscription<std_msgs::msg::Int32>(
        "/terminate", 10, std::bind(&Pcd2PgmNode::terminateCallback, this, std::placeholders::_1));
    RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "已初始化/terminate订阅器");
    
    pgm_home_tf_sub_ = create_subscription<geometry_msgs::msg::PoseStamped>(
        "/pgm_home_tf", 10, std::bind(&Pcd2PgmNode::pgm_home_tf_callback, this, std::placeholders::_1));
    
    initial_pose_sub_ = create_subscription<geometry_msgs::msg::PoseWithCovarianceStamped>(
        "/initialpose", 10, std::bind(&Pcd2PgmNode::initial_pose_callback, this, std::placeholders::_1));
    
    map_save_sub_ = create_subscription<nav_msgs::msg::OccupancyGrid>(
        "map", 1, std::bind(&Pcd2PgmNode::handle_map_save, this, std::placeholders::_1));
        
    z_threshold_sub_ = create_subscription<std_msgs::msg::Float64MultiArray>(
        "/z_threshold", 10, std::bind(&Pcd2PgmNode::zThresholdCallback, this, std::placeholders::_1));
    RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "已初始化/z_threshold订阅器");

    map_path_sub_ = create_subscription<std_msgs::msg::String>(
        "/pcd_path_name", 10, std::bind(&Pcd2PgmNode::mapPathCallback, this, std::placeholders::_1));
    RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "已初始化/map_path订阅器");

    map_folder_sub_ = create_subscription<std_msgs::msg::String>(
        "/map_folder", 10, std::bind(&Pcd2PgmNode::mapFolderCallback, this, std::placeholders::_1));
    RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "已初始化/map_folder订阅器");
}

void Pcd2PgmNode::loadDefaultParameters()
{
  if (parameters_loaded_) {
    return;
  }
  
  RCLCPP_WARN(this->get_logger(), "使用默认参数初始化");
  
  // 设置默认参数值
  pcd_file_ = DefaultParameters::DEFAULT_PCD_FILE;
  thre_z_min_ = DefaultParameters::DEFAULT_THRE_Z_MIN;
  thre_z_max_ = DefaultParameters::DEFAULT_THRE_Z_MAX;
  flag_pass_through_ = DefaultParameters::DEFAULT_FLAG_PASS_THROUGH;
  thre_radius_ = DefaultParameters::DEFAULT_THRE_RADIUS;
  map_resolution_ = DefaultParameters::DEFAULT_MAP_RESOLUTION;
  thres_point_count_ = DefaultParameters::DEFAULT_THRES_POINT_COUNT;
  map_topic_name_ = DefaultParameters::DEFAULT_MAP_TOPIC_NAME;
  
  // 设置默认变换参数
  odom_to_lidar_odom_.assign(
    DefaultParameters::DEFAULT_ODOM_TO_LIDAR_ODOM.begin(),
    DefaultParameters::DEFAULT_ODOM_TO_LIDAR_ODOM.end()
  );
  
  map_save_path_ = DefaultParameters::DEFAULT_MAP_SAVE_PATH;
  map_base_dir_ = DefaultParameters::DEFAULT_MAP_BASE_DIR;
  map_save_name_ = DefaultParameters::DEFAULT_MAP_SAVE_NAME;
  rotated_pcd_save_path_ = DefaultParameters::DEFAULT_ROTATED_PCD_SAVE_PATH;

  // 展开同一份 runtime.env 中的点云与二维地图路径。
  pcd_file_ = expandHome(pcd_file_);
  map_save_path_ = expandHome(map_save_path_);
  map_base_dir_ = expandHome(map_base_dir_);
  rotated_pcd_save_path_ = expandHome(rotated_pcd_save_path_);

  parameters_loaded_ = true;
  
  RCLCPP_INFO(this->get_logger(), "默认参数加载完成");
}

void Pcd2PgmNode::zThresholdCallback(const std_msgs::msg::Float64MultiArray::SharedPtr msg)
{
    // 检查数组长度是否足够
    if (msg->data.size() < 2) {
        RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"), 
                    "接收到的Float64MultiArray数据长度不足2，当前长度: %zu", msg->data.size());
        publishFalseCallback("接收到的Float64MultiArray数据长度不足2");
        return;
    }
    
    // 提取新的zmin和zmax值
    double new_zmin = msg->data[0];  // 数组第0位为zmin
    double new_zmax = msg->data[1];  // 数组第1位为zmax
    
    // 验证参数合理性
    if (new_zmin >= new_zmax) {
        RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"), 
                    "接收到的z轴阈值无效: zmin(%.3f) >= zmax(%.3f)", new_zmin, new_zmax);
        publishFalseCallback("接收到的z轴阈值无效: zmin >= zmax");
        return;
    }
    
    // 更新参数
    thre_z_min_ = new_zmin;
    thre_z_max_ = new_zmax;
    
    RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), 
                "成功更新z轴阈值: zmin=%.3f, zmax=%.3f", thre_z_min_, thre_z_max_);
    
    // 如果已经加载了点云数据，则重新应用过滤器
    if (pcd_cloud_ && !pcd_cloud_->empty()) {
        RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "重新应用直通滤波器...");
        
        // 重新应用直通滤波器
        passThroughFilter(thre_z_min_, thre_z_max_, false);
        
        // 重新应用半径离群值滤波器
        radiusOutlierFilter(cloud_after_pass_through_, thre_radius_, thres_point_count_);
        
        // 更新地图消息
        setMapTopicMsg(cloud_after_radius_, map_topic_msg_);
        
        // 标记地图需要更新
        map_needs_update_ = true;
        
        RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "z轴阈值更新完成，地图将在下次发布时更新");
        
        // 发布成功回调
        publishTrueCallback(6);  // 使用6表示z轴阈值更新成功
    } else {
        RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "z轴阈值已更新，等待点云数据加载后应用");
        publishTrueCallback(6);
    }
}

void Pcd2PgmNode::mapPathCallback(const std_msgs::msg::String::SharedPtr msg)
{
    // 检查路径是否为空
    if (msg->data.empty()) {
        RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"),
                    "接收到的map_path为空，无法更新");
        publishFalseCallback("接收到的map_path为空");
        return;
    }

    // 更新路径参数
    pcd_file_ = msg->data;
    rotated_pcd_save_path_ = msg->data;

    RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"),
                "已更新点云地图路径: %s", pcd_file_.c_str());

    // 路径由 Web 端每次随操作注入（/pcd_path_name），节点不做持久化：
    // 避免运行时改写 share/源码下的配置文件（--symlink-install 时会弄脏仓库）。
    // 持久化由 Java 侧负责（数据库 nav_map_pcd_name；启动注入 BLUEANT_MAP_PCD）。

    // 发布成功回调
    publishTrueCallback(7);  // 7表示路径更新成功
}

void Pcd2PgmNode::mapFolderCallback(const std_msgs::msg::String::SharedPtr msg)
{
    // 前端只允许发送文件夹名称，例如: shuobao-pgm
    const bool valid_name = !msg->data.empty() &&
      std::all_of(msg->data.begin(), msg->data.end(), [](unsigned char character) {
        return std::isalnum(character) || character == '_' || character == '-';
      });
    if (!valid_name) {
        RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"),
                    "/map_folder只允许发送文件夹名称，当前收到: %s",
                    msg->data.c_str());
        publishFalseCallback("/map_folder只允许发送文件夹名称: " + msg->data);
        return;
    }

    // 根据文件夹名称自动拼接 map.pgm / map.yaml 的保存目录
    // 与 Web 端 ROBOT_MAP_DIR 契约保持一致
    map_save_path_ =
      (std::filesystem::path(map_base_dir_) / msg->data / "setting").string();
    map_save_name_ = "map";

    std::error_code directory_error;
    std::filesystem::create_directories(map_save_path_, directory_error);
    if (directory_error) {
        RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"),
                    "创建地图保存目录失败: %s",
                    map_save_path_.c_str());
        publishFalseCallback("创建地图保存目录失败: " + map_save_path_);
        return;
    }

    RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"),
                "收到/map_folder=%s，地图保存目录切换为: %s",
                msg->data.c_str(), map_save_path_.c_str());

    publishTrueCallback(8);  // 8表示地图保存目录更新成功
}

void Pcd2PgmNode::planStartCallback(const std_msgs::msg::Int32::SharedPtr msg)
{
    if (msg->data == 5) {
        RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "收到/plan_start启动信号，开始点云地图转栅格地图");
        
        // 确保参数已加载
if (!parameters_loaded_) {
            loadDefaultParameters();
        }
        
        // 保存初始地图状态
        save_initial_map_state();

        // 加载点云地图
        try {
            if (pcl::io::loadPCDFile<pcl::PointXYZ>(pcd_file_, *pcd_cloud_) == -1) {
                RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"), "无法读取点云文件: %s", pcd_file_.c_str());
                publishFalseCallback("无法读取点云文件: " + pcd_file_);
                return;
            }
        } catch (const std::exception& e) {
            RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"), "加载点云文件时发生异常: %s", e.what());
            publishFalseCallback("加载点云文件异常: " + std::string(e.what()));
            return;
        }
        
        RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "成功加载点云地图，点数: %lu", pcd_cloud_->points.size());
        
        // 应用变换和过滤器
        applyTransform();
        passThroughFilter(thre_z_min_, thre_z_max_, false);
        radiusOutlierFilter(cloud_after_pass_through_, thre_radius_, thres_point_count_);
        
        // 生成栅格地图
        setMapTopicMsg(cloud_after_radius_, map_topic_msg_);

        timer_ = create_wall_timer(std::chrono::seconds(5), 
                                 std::bind(&Pcd2PgmNode::publishCallback, this));
        
        // 发布成功回调
        publishTrueCallback(5);
        RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "地图转换完成，已发布成功回调");
    }
}

// 终止信号回调函数
void Pcd2PgmNode::terminateCallback(const std_msgs::msg::Int32::SharedPtr msg)
{
    if (msg->data == 1) {
        RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "收到/terminate终止信号，开始重置程序");
        
        // 使用try-catch包装重置操作
        try {
            softResetSelection();
        } catch (const std::exception& e) {
            RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"), "终止回调中发生异常: %s", e.what());
            
            // 发布错误消息
            std_msgs::msg::String error_msg;
            error_msg.data = "重置过程中发生异常: " + std::string(e.what());
            false_callback_pub_->publish(error_msg);
        }
    }
}

// 软重置方法，重置所有点云地图和二维栅格地图变量
void Pcd2PgmNode::softResetSelection()
{
    RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "开始软重置...");
    
    try {
        // 停止定时器
        if (timer_) {
            timer_->cancel();
            timer_.reset();
        }
        
        // 重置状态变量
        map_needs_update_ = false;
        processing_pgm_home_tf_ = false;
        has_custom_origin_ = false;
        initial_map_published_ = false;
        // 注意：不要重置 has_initial_state_，因为我们需要保留初始状态

        // 安全地重置点云数据
        if (pcd_cloud_) {
            pcd_cloud_->clear();
        } else {
            pcd_cloud_ = std::make_shared<pcl::PointCloud<pcl::PointXYZ>>();
        }
        
        if (cloud_after_pass_through_) {
            cloud_after_pass_through_->clear();
        } else {
            cloud_after_pass_through_ = std::make_shared<pcl::PointCloud<pcl::PointXYZ>>();
        }
        
        if (cloud_after_radius_) {
            cloud_after_radius_->clear();
        } else {
            cloud_after_radius_ = std::make_shared<pcl::PointCloud<pcl::PointXYZ>>();
        }

        // 重置二维栅格地图变量（创建新的对象而不是重用）
        map_topic_msg_ = nav_msgs::msg::OccupancyGrid();
        map_origin_x_ = 0.0;
        map_origin_y_ = 0.0;
        map_orientation_yaw_ = 0.0;

        // 修复：不要重新创建发布器，使用现有的发布器
        // 直接发布终止消息到现有的发布器
        std_msgs::msg::Int32 terminate_msg;
        terminate_msg.data = 3;
        true_callback_pub_->publish(terminate_msg);
        
        RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "软重置完成，已在/true_callback话题上发布3");
        
    } catch (const std::exception& e) {
        RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"), "软重置过程中发生异常: %s", e.what());
        
        // 即使发生异常，也尝试发布终止消息
        try {
            std_msgs::msg::Int32 terminate_msg;
            terminate_msg.data = 3;
            true_callback_pub_->publish(terminate_msg);
        } catch (...) {
            RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"), "发布终止消息失败");
        }
    }
}

void Pcd2PgmNode::publishTrueCallback(int data)
{
    std_msgs::msg::Int32 msg;
    msg.data = data;
    true_callback_pub_->publish(msg);
}

void Pcd2PgmNode::publishFalseCallback(const std::string& error_msg)
{
    std_msgs::msg::String msg;
    msg.data = error_msg;
    false_callback_pub_->publish(msg);
}

void pcd2pgm::Pcd2PgmNode::publishCallback()
{
  // 安全检查
  if (!checkPointCloudValid(cloud_after_radius_)) {
      RCLCPP_WARN(rclcpp::get_logger("pcd2pgm"), "点云数据无效，跳过发布");
      return;
  }

  // 发布点云数据
  sensor_msgs::msg::PointCloud2 output;
  pcl::toROSMsg(*cloud_after_radius_, output);
  output.header.frame_id = "map";
  pcd_publisher_->publish(output);
  
  // 仅在以下情况发布地图：
  // 1. 初始化时（第一次发布）
  // 2. 用户设置了2D Goal Pose后需要更新地图时
  if (!initial_map_published_ || map_needs_update_) {
    RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "发布地图 (原因: %s)", 
                !initial_map_published_ ? "初始化" : "用户设置了2D Goal Pose");
    map_publisher_->publish(map_topic_msg_);
    
    // 更新标志位
    initial_map_published_ = true;
    map_needs_update_ = false;
  }
}

void pcd2pgm::Pcd2PgmNode::declareParameters()
{
  declare_parameter("pcd_file", "$ROBOT_PCD_DIR/point_cloud.pcd");
  declare_parameter("thre_z_min", 0.01);
  declare_parameter("thre_z_max", 0.5);
  declare_parameter("flag_pass_through", true);
  declare_parameter("thre_radius", 0.5);
  declare_parameter("map_resolution", 0.05);
  declare_parameter("thres_point_count", 1);
  declare_parameter("map_topic_name", "preview_pgmmap");
  declare_parameter(
    "odom_to_lidar_odom", std::vector<double>{0.0, 0.0, 0.0, 0.0, 0.0, 0.0});
  declare_parameter("map_save_path", "$ROBOT_MAP_DIR/");  // 栅格地图保存路径
  declare_parameter("map_base_dir", "$ROBOT_MAP_DIR/");  // Web 与转换节点共用的地图根目录
  declare_parameter("map_save_name", "map");  // 栅格地图保存名称
  declare_parameter("rotated_pcd_save_path", "$ROBOT_PCD_DIR/pcdmap.pcd");  // 旋转后的PCD文件保存路径
}

void Pcd2PgmNode::getParameters()
{
  get_parameter("pcd_file", pcd_file_);
  get_parameter("thre_z_min", thre_z_min_);
  get_parameter("thre_z_max", thre_z_max_);
  get_parameter("flag_pass_through", flag_pass_through_);
  get_parameter("thre_radius", thre_radius_);
  get_parameter("map_resolution", map_resolution_);
  get_parameter("thres_point_count", thres_point_count_);
  get_parameter("map_topic_name", map_topic_name_);
  get_parameter("odom_to_lidar_odom", odom_to_lidar_odom_);
  if (odom_to_lidar_odom_.size() < 6) {
    RCLCPP_ERROR(this->get_logger(), "odom_to_lidar_odom_ 长度不足6，当前长度: %zu", odom_to_lidar_odom_.size());
    odom_to_lidar_odom_ = {0.0, 0.0, 0.0, 0.0, 0.0, 0.0}; // 设置默认值
  }
  get_parameter("map_save_path", map_save_path_);
  get_parameter("map_base_dir", map_base_dir_);
  get_parameter("map_save_name", map_save_name_);
  get_parameter("rotated_pcd_save_path", rotated_pcd_save_path_);

  // 展开 runtime.env 中的共享地图目录；不回退到用户目录。
  pcd_file_ = expandHome(pcd_file_);
  map_save_path_ = expandHome(map_save_path_);
  map_base_dir_ = expandHome(map_base_dir_);
  rotated_pcd_save_path_ = expandHome(rotated_pcd_save_path_);
}

void pcd2pgm::Pcd2PgmNode::passThroughFilter(double thre_low, double thre_high, bool flag_in)
{
  // 安全检查
  if (!checkPointCloudValid(pcd_cloud_)) {
      RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"), "点云数据无效，无法应用直通滤波器");
      return;
  }

  auto filtered_cloud = std::make_shared<pcl::PointCloud<pcl::PointXYZ>>();
  pcl::PassThrough<pcl::PointXYZ> passthrough;
  passthrough.setInputCloud(pcd_cloud_);
  passthrough.setFilterFieldName("z");
  passthrough.setFilterLimits(thre_low, thre_high);
  passthrough.setNegative(flag_in);
  passthrough.filter(*filtered_cloud);

  cloud_after_pass_through_ = filtered_cloud;
  RCLCPP_INFO(
    rclcpp::get_logger("pcd2pgm"), "通过直通滤波器后：%lu 个点",
    cloud_after_pass_through_->points.size());
}

void pcd2pgm::Pcd2PgmNode::radiusOutlierFilter(
  const pcl::PointCloud<pcl::PointXYZ>::Ptr & input_cloud, double radius, int thre_count)
{
  // 安全检查
  if (!checkPointCloudValid(input_cloud)) {
      RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"), "输入点云数据无效，无法应用半径离群值滤波器");
      return;
  }

  auto filtered_cloud = std::make_shared<pcl::PointCloud<pcl::PointXYZ>>();
  pcl::RadiusOutlierRemoval<pcl::PointXYZ> radius_outlier;
  radius_outlier.setInputCloud(input_cloud);
  radius_outlier.setRadiusSearch(radius);
  radius_outlier.setMinNeighborsInRadius(thre_count);
  radius_outlier.filter(*filtered_cloud);

  cloud_after_radius_ = filtered_cloud;
  RCLCPP_INFO(
    rclcpp::get_logger("pcd2pgm"), "通过半径离群值滤波器后：%lu 个点", cloud_after_radius_->points.size());
}

void pcd2pgm::Pcd2PgmNode::setMapTopicMsg(
  const pcl::PointCloud<pcl::PointXYZ>::Ptr cloud, nav_msgs::msg::OccupancyGrid & msg)
{
  // 安全检查
  if (!checkPointCloudValid(cloud)) {
      RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"), "点云数据无效，无法生成地图");
      return;
  }

  msg.header.stamp = now();
  msg.header.frame_id = "map";

  msg.info.map_load_time = now();
  msg.info.resolution = map_resolution_;

  double x_min = std::numeric_limits<double>::max();
  double x_max = std::numeric_limits<double>::lowest();
  double y_min = std::numeric_limits<double>::max();
  double y_max = std::numeric_limits<double>::lowest();

  if (cloud->points.empty()) {
    RCLCPP_WARN(rclcpp::get_logger("pcd2pgm"), "点云为空！");
    return;
  }

  for (const auto & point : cloud->points) {
    x_min = std::min(x_min, static_cast<double>(point.x));
    x_max = std::max(x_max, static_cast<double>(point.x));
    y_min = std::min(y_min, static_cast<double>(point.y));
    y_max = std::max(y_max, static_cast<double>(point.y));
  }

  // 设置地图原点位置
  // 使用点云的最小值作为栅格地图的原点，确保坐标系一致
  msg.info.origin.position.x = x_min;
  msg.info.origin.position.y = y_min;
  msg.info.origin.position.z = 0.0;
  
  RCLCPP_INFO(
    rclcpp::get_logger("pcd2pgm"),
    "地图坐标变换: 使用点云最小值作为原点 [%.3f, %.3f]",
    x_min, y_min);

  // 设置地图原点方向
  // 使用默认方向（无旋转），确保栅格地图与点云地图的坐标系一致
  msg.info.origin.orientation.x = 0.0;
  msg.info.origin.orientation.y = 0.0;
  msg.info.origin.orientation.z = 0.0;
  msg.info.origin.orientation.w = 1.0;
  
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "地图方向设置: 使用默认方向 (无旋转)，确保与点云地图坐标系一致");

  // 计算地图尺寸
  // 首先确定地图的边界
  double map_min_x = x_min;
  double map_min_y = y_min;
  double map_max_x = x_max;
  double map_max_y = y_max;
  
  // 使用设置的原点
  double origin_x = msg.info.origin.position.x;
  double origin_y = msg.info.origin.position.y;
  
  // 计算地图宽度和高度
  msg.info.width = std::ceil((map_max_x - origin_x) / map_resolution_);
  msg.info.height = std::ceil((map_max_y - origin_y) / map_resolution_);
  
  RCLCPP_INFO(
    rclcpp::get_logger("pcd2pgm"),
    "地图尺寸: 宽度 %d 像素, 高度 %d 像素, 分辨率 %.3f m/pixel",
    msg.info.width, msg.info.height, map_resolution_);
  
  RCLCPP_INFO(
    rclcpp::get_logger("pcd2pgm"),
    "地图边界: X [%.3f, %.3f], Y [%.3f, %.3f]",
    map_min_x, map_max_x, map_min_y, map_max_y);
    
  msg.data.assign(msg.info.width * msg.info.height, 0);

  // 获取地图方向
  tf2::Quaternion map_orientation;
  tf2::fromMsg(msg.info.origin.orientation, map_orientation);
  
  // 将点云点转换为栅格地图
  int points_in_map = 0;
  int points_outside_map = 0;
  
  for (const auto & point : cloud->points) {
    // 计算点相对于地图原点的坐标
    double dx = point.x - origin_x;
    double dy = point.y - origin_y;
    
    // 计算栅格坐标
    int i = std::floor(dx / map_resolution_);
    int j = std::floor(dy / map_resolution_);
    
    if (i >= 0 && i < msg.info.width && j >= 0 && j < msg.info.height) {
      msg.data[i + j * msg.info.width] = 100;
      points_in_map++;
    } else {
      points_outside_map++;
    }
  }
  
  RCLCPP_INFO(
    rclcpp::get_logger("pcd2pgm"),
    "点云映射: %d 个点在地图内, %d 个点在地图外",
    points_in_map, points_outside_map);

  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "地图数据大小：%lu", msg.data.size());
}

void pcd2pgm::Pcd2PgmNode::applyTransform()
{
  // 安全检查
  if (!checkPointCloudValid(pcd_cloud_)) {
      RCLCPP_ERROR(this->get_logger(), "点云数据无效，无法应用变换");
      return;
  }

  Eigen::Affine3f transform = Eigen::Affine3f::Identity();

  // 设置平移部分
  if (odom_to_lidar_odom_.size() >= 6) {
    transform.translation() << odom_to_lidar_odom_[0], odom_to_lidar_odom_[1], odom_to_lidar_odom_[2];
    transform.rotate(Eigen::AngleAxisf(odom_to_lidar_odom_[3], Eigen::Vector3f::UnitX()));
    transform.rotate(Eigen::AngleAxisf(odom_to_lidar_odom_[4], Eigen::Vector3f::UnitY()));
    transform.rotate(Eigen::AngleAxisf(odom_to_lidar_odom_[5], Eigen::Vector3f::UnitZ()));
  } else {
    RCLCPP_ERROR(this->get_logger(), "odom_to_lidar_odom_ 长度不足6，无法应用变换");
    publishFalseCallback("odom_to_lidar_odom_ 长度不足6，无法应用变换");
    return;
  }

  // 打印参数和变换矩阵
  RCLCPP_INFO(
    rclcpp::get_logger("pcd2pgm"),
    "应用坐标变换参数: 平移 [%.3f, %.3f, %.3f], 旋转 [%.3f, %.3f, %.3f] rad",
    odom_to_lidar_odom_[0], odom_to_lidar_odom_[1], odom_to_lidar_odom_[2],
    odom_to_lidar_odom_[3], odom_to_lidar_odom_[4], odom_to_lidar_odom_[5]);

  // 打印完整的变换矩阵
  RCLCPP_INFO(
    rclcpp::get_logger("pcd2pgm"),
    "变换矩阵:\n"
    "[%.6f, %.6f, %.6f, %.6f]\n"
    "[%.6f, %.6f, %.6f, %.6f]\n" 
    "[%.6f, %.6f, %.6f, %.6f]\n"
    "[%.6f, %.6f, %.6f, %.6f]",
    transform(0,0), transform(0,1), transform(0,2), transform(0,3),
    transform(1,0), transform(1,1), transform(1,2), transform(1,3),
    transform(2,0), transform(2,1), transform(2,2), transform(2,3),
    transform(3,0), transform(3,1), transform(3,2), transform(3,3));

  // 打印逆变换矩阵（实际应用的变换）
  Eigen::Affine3f inverse_transform = transform.inverse();
  RCLCPP_INFO(
    rclcpp::get_logger("pcd2pgm"),
    "逆变换矩阵（实际应用）:\n"
    "[%.6f, %.6f, %.6f, %.6f]\n"
    "[%.6f, %.6f, %.6f, %.6f]\n"
    "[%.6f, %.6f, %.6f, %.6f]\n"
    "[%.6f, %.6f, %.6f, %.6f]",
    inverse_transform(0,0), inverse_transform(0,1), inverse_transform(0,2), inverse_transform(0,3),
    inverse_transform(1,0), inverse_transform(1,1), inverse_transform(1,2), inverse_transform(1,3),
    inverse_transform(2,0), inverse_transform(2,1), inverse_transform(2,2), inverse_transform(2,3),
    inverse_transform(3,0), inverse_transform(3,1), inverse_transform(3,2), inverse_transform(3,3));

  // 应用变换到点云
  pcl::transformPointCloud(*pcd_cloud_, *pcd_cloud_, inverse_transform);
  
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "点云坐标变换完成");
}

void pcd2pgm::Pcd2PgmNode::pgm_home_tf_callback(const geometry_msgs::msg::PoseStamped::SharedPtr msg)
{
  // 如果正在处理Goal Pose，则忽略新的请求
  if (processing_pgm_home_tf_) {
    RCLCPP_WARN(rclcpp::get_logger("pcd2pgm"), "正在处理上一个Goal Pose，忽略新请求");
    return;
  }

  processing_pgm_home_tf_ = true;
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "收到新的2D Goal Pose - 将更新地图坐标系");

  // 提取2D Goal Pose的位置信息
  double new_origin_x = msg->pose.position.x;
  double new_origin_y = msg->pose.position.y;
  
  // 从四元数中提取yaw角
  tf2::Quaternion q;
  tf2::fromMsg(msg->pose.orientation, q);
  double roll, pitch, yaw;
  tf2::Matrix3x3(q).getRPY(roll, pitch, yaw);

  // 将用户指定的方向顺时针旋转90度（减去π/2）
  double rotated_yaw = yaw - M_PI_2;  // 顺时针旋转90度
  
  // 确保角度在-π到π的范围内
  while (rotated_yaw > M_PI) rotated_yaw -= 2 * M_PI;
  while (rotated_yaw < -M_PI) rotated_yaw += 2 * M_PI;
  
  // 更新地图方向
  map_orientation_yaw_ = rotated_yaw;
  
  // 更新地图原点
  map_origin_x_ = new_origin_x;
  map_origin_y_ = new_origin_y;
  
  // 更新odom_to_lidar_odom_参数，包括位置和方向
  odom_to_lidar_odom_[0] = map_origin_x_;  // 更新x坐标
  odom_to_lidar_odom_[1] = map_origin_y_;  // 更新y坐标
  odom_to_lidar_odom_[5] = rotated_yaw;    // 更新yaw角（已顺时针旋转90度）
  
  // 标记已有自定义原点和地图需要更新
  has_custom_origin_ = true;
  map_needs_update_ = true;  // 明确标记地图需要更新

  // 在终端显示当前的变换参数和地图原点信息
  RCLCPP_INFO(
    rclcpp::get_logger("pcd2pgm"),
    "收到新的2D Goal Pose:");
  
  RCLCPP_INFO(
    rclcpp::get_logger("pcd2pgm"),
    "- 设置地图原点位置为: [x: %.3f, y: %.3f]",
    map_origin_x_, map_origin_y_);
    
  RCLCPP_INFO(
    rclcpp::get_logger("pcd2pgm"),
    "- 设置地图方向为: %.3f rad (%.1f度)",
    map_orientation_yaw_, map_orientation_yaw_ * 180.0 / M_PI);
    
  RCLCPP_INFO(
    rclcpp::get_logger("pcd2pgm"),
    "- 更新坐标变换参数: [%.3f, %.3f, %.3f, %.3f, %.3f, %.3f]",
    odom_to_lidar_odom_[0],
    odom_to_lidar_odom_[1],
    odom_to_lidar_odom_[2],
    odom_to_lidar_odom_[3],
    odom_to_lidar_odom_[4],
    odom_to_lidar_odom_[5]);

  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "开始重新处理点云数据...");
  // 重新处理点云数据并更新地图
  reprocess_pointcloud();
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "点云数据处理完成");
  
  // 自动保存栅格地图文件
  try {
    save_grid_map();
    RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "自动保存栅格地图文件成功: %s", map_save_path_.c_str());
  } catch (const std::exception& e) {
    RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"), "自动保存栅格地图文件失败: %s", e.what());
    publishFalseCallback("自动保存栅格地图文件失败: " + std::string(e.what()));
  }
  
  // 重置处理标志位
  processing_pgm_home_tf_ = false;
}

void pcd2pgm::Pcd2PgmNode::reprocess_pointcloud()
{
  // 只有在需要更新地图时才进行处理
  if (!map_needs_update_ && initial_map_published_) {
    RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "地图不需要更新，跳过点云重新处理");
    return;
  }

  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "重新处理点云数据...");
  
  // 重新加载原始点云数据
  try {
    if (pcl::io::loadPCDFile<pcl::PointXYZ>(pcd_file_, *pcd_cloud_) == -1) {
      RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"), "无法读取文件: %s", pcd_file_.c_str());
      publishFalseCallback("无法读取文件: " + pcd_file_);
      processing_pgm_home_tf_ = false;
      return;
    }
  } catch (const std::exception& e) {
    RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"), "加载点云文件时发生异常: %s", e.what());
    publishFalseCallback("加载点云文件异常: " + std::string(e.what()));
    processing_pgm_home_tf_ = false;
    return;
  }
  
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "已重新加载原始点云数据，点数: %lu", pcd_cloud_->points.size());

  // 应用新的变换
  RCLCPP_INFO(
    rclcpp::get_logger("pcd2pgm"),
    "应用新的坐标变换: [%.3f, %.3f, %.3f, %.3f, %.3f, %.3f]",
    odom_to_lidar_odom_[0], odom_to_lidar_odom_[1], odom_to_lidar_odom_[2],
    odom_to_lidar_odom_[3], odom_to_lidar_odom_[4], odom_to_lidar_odom_[5]);
  applyTransform();

  // 保存旋转后的点云文件
  try {
    // 确保目录存在
    std::string dir_path = rotated_pcd_save_path_.substr(0, rotated_pcd_save_path_.find_last_of('/'));
    std::string mkdir_cmd = "mkdir -p " + dir_path;
    int mkdir_result = std::system(mkdir_cmd.c_str());
    if (mkdir_result != 0) {
      RCLCPP_WARN(rclcpp::get_logger("pcd2pgm"), "创建目录可能失败: %s, 错误码: %d", dir_path.c_str(), mkdir_result);
    }
    
    // 保存旋转后的点云文件（ASCII格式）
    if (pcl::io::savePCDFile(rotated_pcd_save_path_, *pcd_cloud_, true) == -1) {  // true表示使用ASCII格式
      RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"), "保存旋转后的点云文件失败: %s", rotated_pcd_save_path_.c_str());
    } else {
      RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "已保存旋转后的点云文件到: %s（ASCII格式）", rotated_pcd_save_path_.c_str());
    }
  } catch (const std::exception& e) {
    RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"), "保存旋转后的点云文件时发生异常: %s", e.what());
  }

  // 重新应用过滤器
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "应用高度过滤器: [%.3f, %.3f]", thre_z_min_, thre_z_max_);
  passThroughFilter(thre_z_min_, thre_z_max_, false);
  
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "应用半径离群值过滤器: 半径 %.3f, 最小点数 %d", thre_radius_, thres_point_count_);
  radiusOutlierFilter(cloud_after_pass_through_, thre_radius_, thres_point_count_);

  // 更新地图消息
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "更新地图消息...");
  setMapTopicMsg(cloud_after_radius_, map_topic_msg_);

  // 设置地图需要更新标志，将在下一次publishCallback中发布
  map_needs_update_ = true;
  
  // 立即发布更新后的地图
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "发布更新后的地图...");
  publishCallback();
  
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "点云数据重新处理完成");
}

void pcd2pgm::Pcd2PgmNode::save_grid_map()
{
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "开始保存栅格地图...");
  
  // 构造完整的保存路径
  std::string save_path = map_save_path_ + "/" + map_save_name_;
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "保存路径: %s", save_path.c_str());
  
  // 确保目录存在
  std::string mkdir_cmd = "mkdir -p " + map_save_path_;
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "创建目录: %s", map_save_path_.c_str());
  
  int mkdir_result = std::system(mkdir_cmd.c_str());
  if (mkdir_result != 0) {
    RCLCPP_WARN(rclcpp::get_logger("pcd2pgm"), "创建目录可能失败: %s, 错误码: %d", map_save_path_.c_str(), mkdir_result);
  } else {
    RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "目录创建成功或已存在");
  }
  
  // 修复：使用正确的话题重映射
  std::string cmd = "ros2 run nav2_map_server map_saver_cli -f " + save_path + 
                   " --ros-args -r map:=" + map_topic_name_;
  
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "执行保存命令: %s", cmd.c_str());
  
  // 执行命令
  int result = std::system(cmd.c_str());
  if (result != 0) {
    RCLCPP_ERROR(rclcpp::get_logger("pcd2pgm"), "保存地图失败，命令返回错误码: %d", result);
    
    // 尝试备用方案：先发布到 /map 话题，再保存
    RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "尝试备用保存方案...");
    //try_backup_save_method(save_path);
    return;
  }
  
  // 检查文件是否存在
  std::string pgm_file = save_path + ".pgm";
  std::string yaml_file = save_path + ".yaml";
  
  std::ifstream pgm_check(pgm_file);
  std::ifstream yaml_check(yaml_file);
  
  if (pgm_check.good() && yaml_check.good()) {
    RCLCPP_INFO(
      rclcpp::get_logger("pcd2pgm"), 
      "栅格地图保存成功! 文件位置:\n- PGM: %s\n- YAML: %s", 
      pgm_file.c_str(), yaml_file.c_str());
  } else {
    RCLCPP_WARN(
      rclcpp::get_logger("pcd2pgm"), 
      "命令执行成功，但文件可能未正确保存。请检查:\n- PGM: %s (%s)\n- YAML: %s (%s)", 
      pgm_file.c_str(), pgm_check.good() ? "存在" : "不存在",
      yaml_file.c_str(), yaml_check.good() ? "存在" : "不存在");
  }
  
  pgm_check.close();
  yaml_check.close();
}

void Pcd2PgmNode::save_initial_map_state()
{
  // 如果已经保存了初始状态，则不再重复保存
  if (has_initial_state_) {
    RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "已存在初始地图状态，跳过保存");
    return;
  }

  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "保存初始地图状态");
  
  // 保存原始点云数据
  *original_pcd_cloud_ = *pcd_cloud_;
  
  // 保存初始变换参数
  original_odom_to_lidar_odom_ = odom_to_lidar_odom_;
  
  // 标记已保存初始状态
  has_initial_state_ = true;
  
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "初始地图状态已保存，原始点云大小：%lu", original_pcd_cloud_->points.size());
}

void pcd2pgm::Pcd2PgmNode::initial_pose_callback(const geometry_msgs::msg::PoseWithCovarianceStamped::SharedPtr msg)
{
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "收到2D Pose Estimate - 重置地图到初始状态");
  
  // 调用重置地图函数
  reset_map();
}

void Pcd2PgmNode::handle_map_save(const nav_msgs::msg::OccupancyGrid::SharedPtr msg)
{
  // 空实现，不再保存点云文件
}

void pcd2pgm::Pcd2PgmNode::reset_map()
{
  // 检查是否有初始状态可以恢复
  if (!has_initial_state_) {
    RCLCPP_WARN(rclcpp::get_logger("pcd2pgm"), "没有保存的初始地图状态，无法重置");
    return;
  }
  
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "重置地图到初始状态");
  
  // 恢复原始点云数据
  *pcd_cloud_ = *original_pcd_cloud_;
  
  // 恢复初始变换参数
  odom_to_lidar_odom_ = original_odom_to_lidar_odom_;
  
  // 重置地图原点和方向
  map_origin_x_ = 0.0;
  map_origin_y_ = 0.0;
  map_orientation_yaw_ = 0.0;
  has_custom_origin_ = false;
  
  // 重新处理点云数据
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "重新处理点云数据...");
  
  // 应用变换
  applyTransform();
  
  // 应用过滤器
  passThroughFilter(thre_z_min_, thre_z_max_, false);
  radiusOutlierFilter(cloud_after_pass_through_, thre_radius_, thres_point_count_);
  
  // 更新地图消息
  setMapTopicMsg(cloud_after_radius_, map_topic_msg_);
  
  // 标记地图需要更新
  map_needs_update_ = true;
  
  RCLCPP_INFO(rclcpp::get_logger("pcd2pgm"), "地图已重置到初始状态，将在下一次发布");
}

// 安全检查方法
bool Pcd2PgmNode::checkPointCloudValid(const pcl::PointCloud<pcl::PointXYZ>::Ptr& cloud) {
    return cloud != nullptr;
}

/*bool Pcd2PgmNode::checkPointCloudValid(const std::shared_ptr<pcl::PointCloud<pcl::PointXYZ>>& cloud) {
    return cloud != nullptr;
}*/

}  // namespace pcd2pgm

#include "rclcpp_components/register_node_macro.hpp"
RCLCPP_COMPONENTS_REGISTER_NODE(pcd2pgm::Pcd2PgmNode)
