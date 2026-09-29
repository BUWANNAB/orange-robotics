#ifndef PCD2PGM__PCD2PGM_HPP_
#define PCD2PGM__PCD2PGM_HPP_

#include <memory>
#include <string>
#include <vector>
#include <random>

#include "nav_msgs/msg/occupancy_grid.hpp"
#include "pcl/filters/passthrough.h"
#include "rclcpp/rclcpp.hpp"
#include "sensor_msgs/msg/point_cloud2.hpp"
#include "geometry_msgs/msg/pose_stamped.hpp"
#include "geometry_msgs/msg/pose_with_covariance_stamped.hpp"
#include "tf2_geometry_msgs/tf2_geometry_msgs.hpp"
#include "std_srvs/srv/trigger.hpp"
#include "std_msgs/msg/int32.hpp"
#include <std_msgs/msg/float64_multi_array.hpp>
#include "std_msgs/msg/string.hpp"
#include "geometry_msgs/msg/transform_stamped.hpp"

namespace pcd2pgm
{
class Pcd2PgmNode : public rclcpp::Node
{
public:
  explicit Pcd2PgmNode(const rclcpp::NodeOptions & options);
  void planStartCallback(const std_msgs::msg::Int32::SharedPtr msg);
  void softResetSelection();

  // 终止信号回调函数
  void terminateCallback(const std_msgs::msg::Int32::SharedPtr msg);

protected:
  // 随机数生成器
  std::random_device rd_;
  std::mt19937 gen_;  // 使用 Mersenne Twister 生成器

  // 启动信号发布器
  rclcpp::Publisher<std_msgs::msg::Int32>::SharedPtr true_callback_pub_;

  // 错误反馈发布器
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr false_callback_pub_;

  // 调用信号订阅器
  rclcpp::Subscription<std_msgs::msg::Int32>::SharedPtr plan_start_sub_; 
  bool plan_start_received_ = false;

  // 终止信号订阅器
  rclcpp::Subscription<std_msgs::msg::Int32>::SharedPtr terminate_sub_;
  
  rclcpp::Subscription<std_msgs::msg::Float64MultiArray>::SharedPtr z_threshold_sub_;

private:
  // 默认路径使用与 Web 一致的点云和栅格地图运行目录。
  struct DefaultParameters {
    static constexpr const char* DEFAULT_PCD_FILE = "$ROBOT_PCD_DIR/point_cloud.pcd";
    static constexpr double DEFAULT_THRE_Z_MIN = -1.8;
    static constexpr double DEFAULT_THRE_Z_MAX = 0.4;
    static constexpr bool DEFAULT_FLAG_PASS_THROUGH = true;
    static constexpr double DEFAULT_THRE_RADIUS = 0.05;
    static constexpr double DEFAULT_MAP_RESOLUTION = 0.05;
    static constexpr int DEFAULT_THRES_POINT_COUNT = 1;
    static constexpr const char* DEFAULT_MAP_TOPIC_NAME = "preview_pgmmap";
    static constexpr std::array<double, 6> DEFAULT_ODOM_TO_LIDAR_ODOM = {0.0, 0.0, 0.0, 0.0, 0.0, 0.0};
    static constexpr const char* DEFAULT_MAP_SAVE_PATH = "$ROBOT_MAP_DIR/";
    static constexpr const char* DEFAULT_MAP_BASE_DIR = "$ROBOT_MAP_DIR/";
    static constexpr const char* DEFAULT_MAP_SAVE_NAME = "temp_pgmmap";
    static constexpr const char* DEFAULT_ROTATED_PCD_SAVE_PATH = "$ROBOT_PCD_DIR/pcdmap.pcd";
  };
  
  // 参数加载状态
  bool parameters_loaded_ = false;
  void loadDefaultParameters();
  
  void declareParameters();
  void getParameters();

  // 初始化方法
  void initializeSubscribers();

  // 辅助方法
  void publishTrueCallback(int data);
  void publishFalseCallback(const std::string& error_msg);
  
  // 安全检查方法
  bool checkPointCloudValid(const pcl::PointCloud<pcl::PointXYZ>::Ptr& cloud);

  void passThroughFilter(double thre_low, double thre_high, bool flag_in);
  void radiusOutlierFilter(const pcl::PointCloud<pcl::PointXYZ>::Ptr & pcd_cloud0, double radius, int thre_count);
  void setMapTopicMsg(const pcl::PointCloud<pcl::PointXYZ>::Ptr cloud, nav_msgs::msg::OccupancyGrid & msg);
  void publishCallback();
  void applyTransform();

  float thre_z_min_;
  float thre_z_max_;
  float thre_radius_;
  bool flag_pass_through_;
  float map_resolution_;
  int thres_point_count_;
  std::string pcd_file_;
  std::string map_topic_name_;
  std::vector<double> odom_to_lidar_odom_;
  std::vector<double> original_odom_to_lidar_odom_; // 存储初始变换参数
  std::string output_dir_;  // 输出目录参数
  std::string map_save_path_;  // 栅格地图文件保存路径
  std::string map_base_dir_;  // Web 与转换节点共用的2D地图根目录
  std::string map_save_name_;  // 栅格地图文件保存名称
  std::string rotated_pcd_save_path_;  // 旋转后的PCD文件保存路径

  // 存储地图原点位置和坐标系方向
  double map_origin_x_;  // 地图原点X坐标
  double map_origin_y_;  // 地图原点Y坐标
  double map_orientation_yaw_;  // 地图坐标系方向(yaw角)
  bool has_custom_origin_;  // 是否有用户自定义的原点
  bool map_needs_update_;   // 控制是否需要更新地图
  bool processing_pgm_home_tf_; // 标记是否正在处理Goal Pose
  bool initial_map_published_; // 标记是否已发布初始地图
  bool has_initial_state_; // 标记是否已保存初始地图状态

  // 点云数据存储
  std::shared_ptr<pcl::PointCloud<pcl::PointXYZ>> pcd_cloud_;
  std::shared_ptr<pcl::PointCloud<pcl::PointXYZ>> original_pcd_cloud_; // 存储原始点云数据
  pcl::PointCloud<pcl::PointXYZ>::Ptr cloud_after_pass_through_;
  pcl::PointCloud<pcl::PointXYZ>::Ptr cloud_after_radius_;
  nav_msgs::msg::OccupancyGrid map_topic_msg_;

  // 发布器和订阅器
  rclcpp::Publisher<nav_msgs::msg::OccupancyGrid>::SharedPtr map_publisher_;
  rclcpp::Publisher<sensor_msgs::msg::PointCloud2>::SharedPtr pcd_publisher_;
  rclcpp::Subscription<geometry_msgs::msg::PoseStamped>::SharedPtr pgm_home_tf_sub_;
  rclcpp::Subscription<geometry_msgs::msg::PoseWithCovarianceStamped>::SharedPtr initial_pose_sub_; // 2D Pose Estimate订阅器
  rclcpp::Subscription<nav_msgs::msg::OccupancyGrid>::SharedPtr map_save_sub_;
  rclcpp::Subscription<std_msgs::msg::String>::SharedPtr map_path_sub_;
  rclcpp::Subscription<std_msgs::msg::String>::SharedPtr map_folder_sub_;
  rclcpp::Service<std_srvs::srv::Trigger>::SharedPtr save_map_service_;
  rclcpp::TimerBase::SharedPtr timer_;

  // 回调函数
  void pgm_home_tf_callback(const geometry_msgs::msg::PoseStamped::SharedPtr msg);
  void initial_pose_callback(const geometry_msgs::msg::PoseWithCovarianceStamped::SharedPtr msg);
  void handle_map_save(const nav_msgs::msg::OccupancyGrid::SharedPtr msg);
  void zThresholdCallback(const std_msgs::msg::Float64MultiArray::SharedPtr msg);
  void mapPathCallback(const std_msgs::msg::String::SharedPtr msg);
  void mapFolderCallback(const std_msgs::msg::String::SharedPtr msg);

  // 地图操作函数
  void reset_map();
  void save_grid_map();
  void reprocess_pointcloud();
  void save_initial_map_state();
};
}  // namespace pcd2pgm

#endif  // PCD2PGM__PCD2PGM_HPP_
