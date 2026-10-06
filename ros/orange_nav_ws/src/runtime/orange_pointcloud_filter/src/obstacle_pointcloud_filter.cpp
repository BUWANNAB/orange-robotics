#include <memory>
#include <functional>
#include <cstdint>
#include <cmath>
#include <stdexcept>
#include <string>
#include <utility>

#include <Eigen/Geometry>
#include <pcl/filters/crop_box.h>
#include <pcl/filters/voxel_grid.h>
#include <pcl/common/transforms.h>
#include <pcl/point_cloud.h>
#include <pcl/point_types.h>
#include <pcl_conversions/pcl_conversions.h>
#include <rclcpp/rclcpp.hpp>
#include <sensor_msgs/msg/point_cloud2.hpp>
#include <tf2/exceptions.hpp>
#include <tf2/time.hpp>
#include <tf2_eigen/tf2_eigen.hpp>
#include <tf2_ros/buffer.h>
#include <tf2_ros/transform_listener.h>

class ObstaclePointCloudFilter final : public rclcpp::Node
{
public:
  using Point = pcl::PointXYZ;
  using Cloud = pcl::PointCloud<Point>;

  ObstaclePointCloudFilter()
  : Node("obstacle_pointcloud_filter")
  {
    const auto input_topic = declare_parameter<std::string>("input_topic", "/livox/lidar");
    const auto output_topic = declare_parameter<std::string>(
      "output_topic", "/cloud/obstacles_filtered");
    base_frame_ = declare_parameter<std::string>("base_frame", "base_link");
    const auto min_x = declare_parameter<double>("min_x", -12.0);
    const auto max_x = declare_parameter<double>("max_x", 12.0);
    const auto min_y = declare_parameter<double>("min_y", -12.0);
    const auto max_y = declare_parameter<double>("max_y", 12.0);
    const auto min_z = declare_parameter<double>("min_z", 0.08);
    const auto max_z = declare_parameter<double>("max_z", 1.60);
    const auto min_range = declare_parameter<double>("min_range", 0.20);
    const auto max_range = declare_parameter<double>("max_range", 12.0);
    const auto voxel_leaf = declare_parameter<double>("voxel_leaf", 0.12);
    const auto voxel_min_points = declare_parameter<int64_t>("voxel_min_points", 1);
    transform_timeout_ = declare_parameter<double>("transform_timeout", 0.05);

    if (base_frame_.empty() || input_topic.empty() || output_topic.empty() ||
      min_x >= max_x || min_y >= max_y || min_z >= max_z ||
      min_range < 0.0 || min_range >= max_range ||
      voxel_leaf <= 0.0 || voxel_min_points < 1 || transform_timeout_ <= 0.0)
    {
      throw std::invalid_argument("invalid point-cloud filter parameters");
    }

    min_bound_ = Eigen::Vector4f(
      static_cast<float>(min_x), static_cast<float>(min_y), static_cast<float>(min_z), 1.0F);
    max_bound_ = Eigen::Vector4f(
      static_cast<float>(max_x), static_cast<float>(max_y), static_cast<float>(max_z), 1.0F);
    voxel_leaf_ = static_cast<float>(voxel_leaf);
    voxel_min_points_ = static_cast<unsigned int>(voxel_min_points);
    min_range_squared_ = static_cast<float>(min_range * min_range);
    max_range_squared_ = static_cast<float>(max_range * max_range);

    tf_buffer_ = std::make_unique<tf2_ros::Buffer>(get_clock());
    tf_listener_ = std::make_unique<tf2_ros::TransformListener>(*tf_buffer_);
    publisher_ = create_publisher<sensor_msgs::msg::PointCloud2>(
      output_topic, rclcpp::SensorDataQoS());
    subscription_ = create_subscription<sensor_msgs::msg::PointCloud2>(
      input_topic, rclcpp::SensorDataQoS(),
      std::bind(&ObstaclePointCloudFilter::on_cloud, this, std::placeholders::_1));

    RCLCPP_INFO(
      get_logger(), "PCL 点云预处理已就绪: %s -> %s, base_frame=%s, voxel=%.3fm",
      input_topic.c_str(), output_topic.c_str(), base_frame_.c_str(), voxel_leaf);
  }

private:
  void on_cloud(const sensor_msgs::msg::PointCloud2::ConstSharedPtr message)
  {
    if (!message || message->header.frame_id.empty()) {
      RCLCPP_WARN_THROTTLE(
        get_logger(), *get_clock(), 3000, "丢弃没有 frame_id 的点云");
      return;
    }

    try {
      Cloud::Ptr sensor_cloud(new Cloud());
      pcl::fromROSMsg(*message, *sensor_cloud);

      Cloud::Ptr base_cloud(new Cloud());
      if (message->header.frame_id == base_frame_) {
        *base_cloud = std::move(*sensor_cloud);
      } else {
        const auto transform = tf_buffer_->lookupTransform(
          base_frame_, message->header.frame_id, tf2::TimePointZero,
          tf2::durationFromSec(transform_timeout_));
        const Eigen::Affine3d transform_eigen = tf2::transformToEigen(transform);
        pcl::transformPointCloud(
          *sensor_cloud, *base_cloud, transform_eigen.matrix().cast<float>());
      }

      pcl::CropBox<Point> crop;
      crop.setMin(min_bound_);
      crop.setMax(max_bound_);
      crop.setInputCloud(base_cloud);
      Cloud::Ptr cropped_cloud(new Cloud());
      crop.filter(*cropped_cloud);

      Cloud::Ptr range_filtered_cloud(new Cloud());
      range_filtered_cloud->reserve(cropped_cloud->size());
      for (const auto & point : *cropped_cloud) {
        const float range_squared = point.x * point.x + point.y * point.y;
        if (range_squared >= min_range_squared_ && range_squared <= max_range_squared_) {
          range_filtered_cloud->push_back(point);
        }
      }

      pcl::VoxelGrid<Point> voxel;
      voxel.setLeafSize(voxel_leaf_, voxel_leaf_, voxel_leaf_);
      voxel.setMinimumPointsNumberPerVoxel(voxel_min_points_);
      voxel.setInputCloud(range_filtered_cloud);
      Cloud filtered_cloud;
      voxel.filter(filtered_cloud);

      sensor_msgs::msg::PointCloud2 output;
      pcl::toROSMsg(filtered_cloud, output);
      output.header = message->header;
      output.header.frame_id = base_frame_;
      publisher_->publish(std::move(output));
    } catch (const tf2::TransformException & error) {
      RCLCPP_WARN_THROTTLE(
        get_logger(), *get_clock(), 3000,
        "等待点云到 %s 的坐标变换: %s", base_frame_.c_str(), error.what());
    } catch (const std::exception & error) {
      RCLCPP_ERROR_THROTTLE(
        get_logger(), *get_clock(), 3000, "点云预处理失败: %s", error.what());
    }
  }

  std::string base_frame_;
  double transform_timeout_{0.05};
  float voxel_leaf_{0.12F};
  unsigned int voxel_min_points_{1};
  float min_range_squared_{0.04F};
  float max_range_squared_{144.0F};
  Eigen::Vector4f min_bound_{-12.0F, -12.0F, 0.08F, 1.0F};
  Eigen::Vector4f max_bound_{12.0F, 12.0F, 1.60F, 1.0F};
  std::unique_ptr<tf2_ros::Buffer> tf_buffer_;
  std::unique_ptr<tf2_ros::TransformListener> tf_listener_;
  rclcpp::Subscription<sensor_msgs::msg::PointCloud2>::SharedPtr subscription_;
  rclcpp::Publisher<sensor_msgs::msg::PointCloud2>::SharedPtr publisher_;
};

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  try {
    rclcpp::spin(std::make_shared<ObstaclePointCloudFilter>());
  } catch (const std::exception & error) {
    RCLCPP_FATAL(rclcpp::get_logger("obstacle_pointcloud_filter"), "%s", error.what());
    rclcpp::shutdown();
    return 1;
  }
  rclcpp::shutdown();
  return 0;
}
