#include <rclcpp/rclcpp.hpp>
#include <tf2_ros/buffer.h>
#include <tf2_ros/transform_listener.h>
#include <geometry_msgs/msg/pose_stamped.hpp>
#include <tf2_geometry_msgs/tf2_geometry_msgs.hpp>

class TfToPoseNode : public rclcpp::Node
{
public:
  TfToPoseNode() : Node("tf_to_pose_node")
  {
    // 声明参数
    this->declare_parameter<std::string>("target_frame", "map");
    this->declare_parameter<std::string>("source_frame", "base_link");
    this->declare_parameter<double>("publish_rate", 10.0);
    
    // 获取参数
    target_frame_ = this->get_parameter("target_frame").as_string();
    source_frame_ = this->get_parameter("source_frame").as_string();
    double publish_rate = this->get_parameter("publish_rate").as_double();
    
    // 初始化TF缓冲区和监听器
    tf_buffer_ = std::make_unique<tf2_ros::Buffer>(this->get_clock());
    tf_listener_ = std::make_unique<tf2_ros::TransformListener>(*tf_buffer_);
    
    // 创建发布器
    pose_publisher_ = this->create_publisher<geometry_msgs::msg::PoseStamped>(
      "tf_pose", 10);
    
    // 创建定时器，定期发布TF转换结果
    timer_ = this->create_wall_timer(
      std::chrono::milliseconds(static_cast<int>(1000.0 / publish_rate)),
      std::bind(&TfToPoseNode::timerCallback, this));
    
    RCLCPP_INFO(this->get_logger(), 
                "TF转Pose节点已启动，监听变换: %s -> %s", 
                target_frame_.c_str(), source_frame_.c_str());
  }

private:
  void timerCallback()
  {
    try {
      // 查找最新的坐标变换
      geometry_msgs::msg::TransformStamped transform_stamped = 
        tf_buffer_->lookupTransform(target_frame_, source_frame_, tf2::TimePointZero);
      
      // 将TransformStamped转换为PoseStamped
      geometry_msgs::msg::PoseStamped pose_msg;
      pose_msg.header = transform_stamped.header;
      
      // 位置信息
      pose_msg.pose.position.x = transform_stamped.transform.translation.x;
      pose_msg.pose.position.y = transform_stamped.transform.translation.y;
      pose_msg.pose.position.z = transform_stamped.transform.translation.z;
      
      // 姿态信息（四元数）
      pose_msg.pose.orientation = transform_stamped.transform.rotation;
      
      // 发布PoseStamped消息
      pose_publisher_->publish(pose_msg);
      
      RCLCPP_DEBUG(this->get_logger(), 
                   "发布位姿: 位置(%.3f, %.3f, %.3f)", 
                   pose_msg.pose.position.x,
                   pose_msg.pose.position.y, 
                   pose_msg.pose.position.z);
                   
    } catch (tf2::TransformException &ex) {
      RCLCPP_WARN(this->get_logger(), 
                  "无法获取变换 %s 到 %s: %s",
                  target_frame_.c_str(), source_frame_.c_str(), ex.what());
    }
  }
  
  std::unique_ptr<tf2_ros::Buffer> tf_buffer_;
  std::unique_ptr<tf2_ros::TransformListener> tf_listener_;
  rclcpp::Publisher<geometry_msgs::msg::PoseStamped>::SharedPtr pose_publisher_;
  rclcpp::TimerBase::SharedPtr timer_;
  std::string target_frame_;
  std::string source_frame_;
};

int main(int argc, char** argv)
{
  rclcpp::init(argc, argv);
  auto node = std::make_shared<TfToPoseNode>();
  rclcpp::spin(node);
  rclcpp::shutdown();
  return 0;
}
