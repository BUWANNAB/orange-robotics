#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>
#include <sensor_msgs/msg/point_cloud2.hpp>
#include <lio_sam/srv/save_map.hpp>

#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <future>
#include <mutex>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <cstdlib>


using namespace std::chrono_literals;

class BuildMapManager : public rclcpp::Node
{
public:
  BuildMapManager()
  : Node("build_map_manager")
  {
    const char * nav_ws_env = std::getenv("ROBOT_NAV_WS");
    const std::string nav_ws = nav_ws_env != nullptr ? nav_ws_env : "";
    const char * pcd_dir_env = std::getenv("ROBOT_PCD_DIR");
    const std::string pcd_dir = pcd_dir_env != nullptr ? pcd_dir_env : "";

    buildmap_topic_ = this->declare_parameter<std::string>("buildmap_topic", "/buildmap");
    status_topic_ = this->declare_parameter<std::string>("status_topic", "/buildmap_status");
    cloud_topic_ = this->declare_parameter<std::string>("cloud_topic", "/lio_sam/mapping/cloud_registered");
    save_map_service_ = this->declare_parameter<std::string>("save_map_service", "/lio_sam/save_map");

    workspace_setup_ = this->declare_parameter<std::string>(
      "workspace_setup", nav_ws.empty() ? "" : nav_ws + "/install/setup.bash");
    map_base_dir_ = this->declare_parameter<std::string>(
      "map_base_dir", pcd_dir);
    if (workspace_setup_.empty() || map_base_dir_.empty()) {
      throw std::runtime_error("ROBOT_NAV_WS and ROBOT_PCD_DIR must define the shared workspace and PCD save path");
    }

    livox_launch_cmd_ = this->declare_parameter<std::string>(
      "livox_launch_cmd", "ros2 launch livox_ros_driver2 msg_MID360_launch.py");
    lio_sam_launch_cmd_ = this->declare_parameter<std::string>(
      "lio_sam_launch_cmd", "ros2 launch lio_sam run.launch.py");
      
    rviz_livox_launch_cmd_ = this->declare_parameter<std::string>(
  "rviz_livox_launch_cmd", "ros2 launch livox_ros_driver2 rviz_MID360_launch.py");

    map_resolution_ = this->declare_parameter<double>("map_resolution", 0.1);
    start_delay_sec_ = this->declare_parameter<double>("start_delay_sec", 3.0);
    save_timeout_sec_ = this->declare_parameter<double>("save_timeout_sec", 300.0);
    stop_after_save_ = this->declare_parameter<bool>("stop_after_save", true);
    manage_livox_ = this->declare_parameter<bool>("manage_livox", true);

    status_pub_ = this->create_publisher<std_msgs::msg::String>(status_topic_, 10);

    buildmap_sub_ = this->create_subscription<std_msgs::msg::String>(
      buildmap_topic_, 10,
      std::bind(&BuildMapManager::buildMapCallback, this, std::placeholders::_1));

    cloud_sub_ = this->create_subscription<sensor_msgs::msg::PointCloud2>(
      cloud_topic_, rclcpp::SensorDataQoS(),
      std::bind(&BuildMapManager::cloudCallback, this, std::placeholders::_1));

    save_client_ = this->create_client<lio_sam::srv::SaveMap>(save_map_service_);

    publishStatus("idle");

    RCLCPP_INFO(this->get_logger(), "build_map_manager started.");
    RCLCPP_INFO(this->get_logger(), "listen topic: %s", buildmap_topic_.c_str());
    RCLCPP_INFO(this->get_logger(), "map base dir: %s", map_base_dir_.c_str());
  }

  ~BuildMapManager()
  {
    stopProcessGroup(lio_sam_pid_);
    stopProcessGroup(livox_pid_);
    
  }

private:
    enum class MapState
  {
    IDLE,
    STARTING,
    MAPPING,
    SAVING,
    STOPPING
  };

  void buildMapCallback(const std_msgs::msg::String::SharedPtr msg)
{
  const std::string data = trim(msg->data);

  if (data == "start") {
    startMapping();
    return;
  }

  if (data == "stop") {
    stopMappingAndStartRvizLivox();
    return;
  }

  saveMap(data);
}

  void startMapping()
  {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (state_ != MapState::IDLE) {
        RCLCPP_WARN(this->get_logger(), "mapping is already running, ignore start command.");
        if (state_ == MapState::MAPPING && map_has_data_ &&
            std::chrono::steady_clock::now() - last_cloud_time_ < std::chrono::seconds(2)) {
          publishStatus("map_data_ready");
        } else if (state_ == MapState::STARTING ||
                   (state_ == MapState::MAPPING && !map_has_data_)) {
          publishStatus("starting");
        } else {
          publishStatus("already_mapping");
        }
        return;
      }

      state_ = MapState::STARTING;
      map_has_data_ = false;
    }

    publishStatus("starting");

       std::thread([this]() {
  if (manage_livox_) killLivoxLidarPublisherOnce();

  const std::string livox_cmd = makeSourcedCommand(livox_launch_cmd_);
  const std::string lio_sam_cmd = makeSourcedCommand(lio_sam_launch_cmd_);

  pid_t livox_pid = manage_livox_ ? startShellCommand(livox_cmd) : -1;
  if (manage_livox_ && livox_pid <= 0) {
    RCLCPP_ERROR(this->get_logger(), "failed to start Livox driver.");
    setIdle();
    publishStatus("start_livox_failed");
    return;
  }

  {
    std::lock_guard<std::mutex> lock(mutex_);
    livox_pid_ = livox_pid;
  }

  if (manage_livox_) RCLCPP_INFO(this->get_logger(), "Livox driver started, pid=%d", livox_pid);
  else RCLCPP_INFO(this->get_logger(), "Reusing resident Livox driver; only starting SLAM");

    std::this_thread::sleep_for(std::chrono::milliseconds(
      static_cast<int>(start_delay_sec_ * 1000.0)));
  
    pid_t lio_pid = startShellCommand(lio_sam_cmd);
    if (lio_pid <= 0) {
      RCLCPP_ERROR(this->get_logger(), "failed to start LIO-SAM.");
      stopProcessGroup(livox_pid_);
      setIdle();
      publishStatus("start_lio_sam_failed");
      return;
    }
  
    {
      std::lock_guard<std::mutex> lock(mutex_);
      lio_sam_pid_ = lio_pid;
      state_ = MapState::MAPPING;
    }
  
    RCLCPP_INFO(this->get_logger(), "LIO-SAM started, pid=%d", lio_pid);
    publishStatus("mapping");
  }).detach();

  }

void stopMappingAndStartRvizLivox()
{
  {
    std::lock_guard<std::mutex> lock(mutex_);

    if (state_ == MapState::SAVING) {
      RCLCPP_WARN(this->get_logger(), "map is saving, ignore stop command.");
      publishStatus("saving_ignore_stop");
      return;
    }

    map_has_data_ = false;
  }

  publishStatus("stopping_mapping");

  std::thread([this]() {
    RCLCPP_WARN(this->get_logger(), "stop command received.");

    stopProcessGroup(lio_sam_pid_);
    stopProcessGroup(livox_pid_);
    if (!manage_livox_) {
      setIdle();
      publishStatus("mapping_stopped");
      return;
    }


    // �ٲ�ɱһ�Σ���ֹ msg �״������в�����
    killLivoxLidarPublisherOnce();

    const std::string rviz_livox_cmd = makeSourcedCommand(rviz_livox_launch_cmd_);
    const pid_t rviz_pid = startShellCommand(rviz_livox_cmd);

    if (rviz_pid <= 0) {
      RCLCPP_ERROR(this->get_logger(), "failed to start rviz Livox driver.");
      publishStatus("start_rviz_livox_failed");

      std::lock_guard<std::mutex> lock(mutex_);
      state_ = MapState::IDLE;
      return;
    }

    RCLCPP_WARN(this->get_logger(), "rviz Livox driver started, pid=%d", rviz_pid);

    {
      std::lock_guard<std::mutex> lock(mutex_);
      state_ = MapState::IDLE;
      map_has_data_ = false;
    }

    publishStatus("rviz_livox_started");
  }).detach();
}

  void saveMap(const std::string & map_name)
  {
    if (!isValidMapName(map_name)) {
      RCLCPP_ERROR(this->get_logger(), "invalid map name: [%s]", map_name.c_str());
      publishStatus("invalid_map_name");
      return;
    }

    {
      std::lock_guard<std::mutex> lock(mutex_);

      if (state_ != MapState::MAPPING) {
        RCLCPP_WARN(this->get_logger(), "not in mapping state, cannot save map.");
        publishStatus("not_mapping");
        return;
      }

      if (!map_has_data_) {
        RCLCPP_WARN(this->get_logger(), "no map data yet, refuse to save empty map.");
        publishStatus("no_map_data");
        return;
      }

      state_ = MapState::SAVING;
    }

  std::thread([this, map_name]() {
  const std::string real_destination = map_base_dir_ + "/" + map_name;
  const std::string service_destination = toLioSamSaveDestination(real_destination);

  std::filesystem::create_directories(real_destination);

  RCLCPP_WARN(
    this->get_logger(),
    "saving map, real path: %s, service destination: %s",
    real_destination.c_str(),
    service_destination.c_str());

  publishStatus("saving");

  const bool success = callSaveMapService(service_destination);

  if (success) {
    RCLCPP_WARN(this->get_logger(), "map saved successfully: %s", real_destination.c_str());
    publishStatus("saved:" + real_destination);

        if (stop_after_save_) {
          stopProcessGroup(lio_sam_pid_);
          stopProcessGroup(livox_pid_);
          setIdle();
          publishStatus("idle");
        } else {
          std::lock_guard<std::mutex> lock(mutex_);
          state_ = MapState::MAPPING;
        }
      } else {
        RCLCPP_ERROR(this->get_logger(), "save map failed.");
        publishStatus("save_failed");

        std::lock_guard<std::mutex> lock(mutex_);
        state_ = MapState::MAPPING;
      }
    }).detach();
  }

  void cloudCallback(const sensor_msgs::msg::PointCloud2::SharedPtr msg)
  {
    const uint64_t point_count =
      static_cast<uint64_t>(msg->width) * static_cast<uint64_t>(msg->height);

    if (point_count == 0) {
      return;
    }

    std::lock_guard<std::mutex> lock(mutex_);
    last_cloud_time_ = std::chrono::steady_clock::now();
    if (state_ == MapState::MAPPING && !map_has_data_) {
      map_has_data_ = true;
      RCLCPP_WARN(this->get_logger(), "LIO-SAM map data is ready.");
      publishStatus("map_data_ready");
    }
  }

  bool callSaveMapService(const std::string & destination)
  {
    if (!save_client_->wait_for_service(10s)) {
      RCLCPP_ERROR(this->get_logger(), "%s service is not available.", save_map_service_.c_str());
      return false;
    }

    auto request = std::make_shared<lio_sam::srv::SaveMap::Request>();
    request->resolution = static_cast<float>(map_resolution_);
    request->destination = destination;

    auto promise = std::make_shared<std::promise<bool>>();
    auto result_future = promise->get_future();
    const auto logger = this->get_logger();

    save_client_->async_send_request(
      request,
      [promise, logger](rclcpp::Client<lio_sam::srv::SaveMap>::SharedFuture future) {
        try {
          promise->set_value(future.get()->success);
        } catch (const std::exception & e) {
          RCLCPP_ERROR(logger, "save map service response error: %s", e.what());
          promise->set_value(false);
        }
      });

    const auto timeout = std::chrono::milliseconds(static_cast<int>(save_timeout_sec_ * 1000.0));
    if (result_future.wait_for(timeout) != std::future_status::ready) {
      RCLCPP_ERROR(this->get_logger(), "save map service timeout.");
      return false;
    }

    return result_future.get();
  }

  pid_t startShellCommand(const std::string & command)
  {
    pid_t pid = fork();

    if (pid < 0) {
      return -1;
    }

    if (pid == 0) {
      setpgid(0, 0);
      execl("/bin/bash", "bash", "-lc", command.c_str(), nullptr);
      _exit(127);
    }

    return pid;
  }

  void stopProcessGroup(pid_t & pid)
  {
    if (pid <= 0) {
      return;
    }

    RCLCPP_WARN(this->get_logger(), "stopping process group pid=%d", pid);

    kill(-pid, SIGINT);

    for (int i = 0; i < 30; ++i) {
      int status = 0;
      const pid_t result = waitpid(pid, &status, WNOHANG);
      if (result == pid) {
        pid = -1;
        return;
      }
      std::this_thread::sleep_for(100ms);
    }

    kill(-pid, SIGTERM);
    std::this_thread::sleep_for(1s);

    kill(-pid, SIGKILL);
    waitpid(pid, nullptr, WNOHANG);
    pid = -1;
  }
  
  

  
  int shellCommandExitCode(const std::string & command) const
{
  const int ret = std::system(command.c_str());

  if (ret == -1) {
    return -1;
  }

  if (WIFEXITED(ret)) {
    return WEXITSTATUS(ret);
  }

  return -1;
}

void killLivoxLidarPublisherOnce()
{
  RCLCPP_WARN(this->get_logger(), "kill livox_lidar_publisher once before start mapping.");
  publishStatus("killing_livox_lidar_publisher");

  const std::string kill_cmd =
    "ps aux | grep livox_lidar_publisher | grep -v grep | awk '{print $2}' | xargs -r kill -9";

  const int ret = shellCommandExitCode(kill_cmd);

  if (ret == 0) {
    RCLCPP_WARN(this->get_logger(), "livox_lidar_publisher kill command executed.");
    publishStatus("livox_lidar_publisher_killed");
  } else {
    RCLCPP_WARN(this->get_logger(), "livox_lidar_publisher kill command returned: %d", ret);
    publishStatus("livox_lidar_publisher_kill_checked");
  }

  std::this_thread::sleep_for(1s);
}

std::string toLioSamSaveDestination(const std::string & real_destination) const
{
  // 统一使用绝对路径：部署根可不在 $HOME 下，不再做 HOME 相对化
  return real_destination;
}


  std::string makeSourcedCommand(const std::string & command) const
  {
    std::string quoted = "'";
    for (char c : workspace_setup_) quoted += c == '\'' ? "'\\''" : std::string(1, c);
    quoted += "'";
    return "source /opt/ros/humble/setup.bash && source " + quoted + " && " + command;
  }

  bool isValidMapName(const std::string & name) const
  {
    if (name.empty() || name.size() > 64) {
      return false;
    }

    static const std::regex pattern("^[A-Za-z0-9_-]+$");
    return std::regex_match(name, pattern);
  }

  std::string trim(const std::string & input) const
  {
    const auto start = input.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) {
      return "";
    }

    const auto end = input.find_last_not_of(" \t\r\n");
    return input.substr(start, end - start + 1);
  }

  void setIdle()
  {
    std::lock_guard<std::mutex> lock(mutex_);
    state_ = MapState::IDLE;
    map_has_data_ = false;
    livox_pid_ = -1;
    lio_sam_pid_ = -1;
  }

  void publishStatus(const std::string & status)
  {
    std_msgs::msg::String msg;
    msg.data = status;
    status_pub_->publish(msg);
  }

private:
  rclcpp::Subscription<std_msgs::msg::String>::SharedPtr buildmap_sub_;
  rclcpp::Subscription<sensor_msgs::msg::PointCloud2>::SharedPtr cloud_sub_;
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr status_pub_;
  rclcpp::Client<lio_sam::srv::SaveMap>::SharedPtr save_client_;

  std::mutex mutex_;
  MapState state_ = MapState::IDLE;
  bool map_has_data_ = false;
  std::chrono::steady_clock::time_point last_cloud_time_{};

  pid_t livox_pid_ = -1;
  pid_t lio_sam_pid_ = -1;

  std::string buildmap_topic_;
  std::string status_topic_;
  std::string cloud_topic_;
  std::string save_map_service_;
  std::string workspace_setup_;
  std::string map_base_dir_;
  std::string livox_launch_cmd_;
  std::string lio_sam_launch_cmd_;
  std::string rviz_livox_launch_cmd_;

  double map_resolution_ = 0.1;
  double start_delay_sec_ = 3.0;
  double save_timeout_sec_ = 300.0;
  bool stop_after_save_ = true;
  bool manage_livox_ = true;
};

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<BuildMapManager>());
  rclcpp::shutdown();
  return 0;
}
