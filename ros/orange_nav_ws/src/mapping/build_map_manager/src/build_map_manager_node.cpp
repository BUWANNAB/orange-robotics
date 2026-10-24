#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>
#include <sensor_msgs/msg/point_cloud2.hpp>
#include <lio_sam/srv/save_map.hpp>

#include <cerrno>
#include <chrono>
#include <cmath>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <functional>
#include <future>
#include <mutex>
#include <regex>
#include <stdexcept>
#include <string>
#include <thread>
#include <atomic>
#include <utility>

#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

using namespace std::chrono_literals;

class BuildMapManager : public rclcpp::Node
{
public:
  BuildMapManager()
  : Node("build_map_manager")
  {
    const char * nav_ws_env = std::getenv("ROBOT_NAV_WS");
    const char * pcd_dir_env = std::getenv("ROBOT_PCD_DIR");
    const std::string nav_ws = nav_ws_env ? nav_ws_env : "";
    const std::string pcd_dir = pcd_dir_env ? pcd_dir_env : "";

    buildmap_topic_ = declare_parameter<std::string>("buildmap_topic", "/buildmap");
    status_topic_ = declare_parameter<std::string>("status_topic", "/buildmap_status");
    cloud_topic_ = declare_parameter<std::string>(
      "cloud_topic", "/lio_sam/mapping/cloud_registered");
    save_map_service_ = declare_parameter<std::string>(
      "save_map_service", "/lio_sam/save_map");
    workspace_setup_ = declare_parameter<std::string>(
      "workspace_setup", nav_ws.empty() ? "" : nav_ws + "/install/setup.bash");
    map_base_dir_ = declare_parameter<std::string>("map_base_dir", pcd_dir);

    if (workspace_setup_.empty() || map_base_dir_.empty() ||
      !std::filesystem::path(workspace_setup_).is_absolute() ||
      !std::filesystem::path(map_base_dir_).is_absolute() ||
      !std::filesystem::is_regular_file(workspace_setup_))
    {
      throw std::runtime_error(
              "ROBOT_NAV_WS and ROBOT_PCD_DIR must define an absolute workspace setup file "
              "and absolute PCD save path");
    }

    livox_launch_cmd_ = declare_parameter<std::string>(
      "livox_launch_cmd", "ros2 launch livox_ros_driver2 msg_MID360_launch.py");
    lio_sam_launch_cmd_ = declare_parameter<std::string>(
      "lio_sam_launch_cmd", "ros2 launch lio_sam run.launch.py");
    rviz_livox_launch_cmd_ = declare_parameter<std::string>(
      "rviz_livox_launch_cmd", "ros2 launch livox_ros_driver2 rviz_MID360_launch.py");
    map_resolution_ = declare_parameter<double>("map_resolution", 0.1);
    start_delay_sec_ = declare_parameter<double>("start_delay_sec", 3.0);
    save_timeout_sec_ = declare_parameter<double>("save_timeout_sec", 300.0);
    stop_after_save_ = declare_parameter<bool>("stop_after_save", true);
    manage_livox_ = declare_parameter<bool>("manage_livox", true);

    if (!std::isfinite(map_resolution_) || map_resolution_ <= 0.0 || map_resolution_ > 10.0 ||
      !std::isfinite(start_delay_sec_) || start_delay_sec_ < 0.0 || start_delay_sec_ > 120.0 ||
      !std::isfinite(save_timeout_sec_) || save_timeout_sec_ <= 0.0 || save_timeout_sec_ > 3600.0)
    {
      throw std::runtime_error(
              "Map resolution must be in (0, 10] m; start delay must be 0-120 s "
              "and save timeout must be 0-3600 s");
    }

    status_pub_ = create_publisher<std_msgs::msg::String>(status_topic_, 10);
    buildmap_sub_ = create_subscription<std_msgs::msg::String>(
      buildmap_topic_, 10,
      std::bind(&BuildMapManager::buildMapCallback, this, std::placeholders::_1));
    cloud_sub_ = create_subscription<sensor_msgs::msg::PointCloud2>(
      cloud_topic_, rclcpp::SensorDataQoS(),
      std::bind(&BuildMapManager::cloudCallback, this, std::placeholders::_1));
    save_client_ = create_client<lio_sam::srv::SaveMap>(save_map_service_);

    publishStatus("idle");
    RCLCPP_INFO(get_logger(), "build_map_manager started.");
    RCLCPP_INFO(get_logger(), "listen topic: %s", buildmap_topic_.c_str());
    RCLCPP_INFO(get_logger(), "cloud topic: %s", cloud_topic_.c_str());
    RCLCPP_INFO(get_logger(), "map base dir: %s", map_base_dir_.c_str());
  }

  ~BuildMapManager() override
  {
    shutting_down_.store(true);
    if (worker_.joinable()) {
      worker_.join();
    }
    stopProcessGroup(lio_sam_pid_);
    stopProcessGroup(livox_pid_);
    stopProcessGroup(rviz_pid_);
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
    } else if (data == "stop") {
      stopMapping();
    } else {
      saveMap(data);
    }
  }

  void startMapping()
  {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (state_ != MapState::IDLE) {
        RCLCPP_WARN(get_logger(), "mapping start ignored because a map operation is active.");
        publishStatus(state_ == MapState::SAVING ? "saving" : "already_mapping");
        return;
      }
      state_ = MapState::STARTING;
      map_has_data_ = false;
      last_cloud_time_ = {};
    }

    publishStatus("starting");
    launchWorker([this]() { startMappingWorker(); });
  }

  void startMappingWorker()
  {
    try {
      stopProcessGroup(rviz_pid_);

      if (manage_livox_) {
        const pid_t pid = startShellCommand(makeSourcedCommand(livox_launch_cmd_));
        if (pid <= 0) {
          setIdle();
          publishStatus("start_livox_failed");
          return;
        }
        livox_pid_ = pid;
        RCLCPP_INFO(get_logger(), "managed Livox driver started, process group=%d", pid);
      } else {
        RCLCPP_INFO(get_logger(), "reusing the resident Livox driver.");
      }

      if (!sleepInterruptibly(
          std::chrono::milliseconds(static_cast<int>(start_delay_sec_ * 1000.0)))) {
        stopProcessGroup(livox_pid_);
        setIdle();
        return;
      }

      const pid_t pid = startShellCommand(makeSourcedCommand(lio_sam_launch_cmd_));
      if (pid <= 0) {
        stopProcessGroup(livox_pid_);
        setIdle();
        publishStatus("start_lio_sam_failed");
        return;
      }

      lio_sam_pid_ = pid;
      {
        std::lock_guard<std::mutex> lock(mutex_);
        if (shutting_down_.load()) {
          return;
        }
        state_ = MapState::MAPPING;
      }
      RCLCPP_INFO(get_logger(), "LIO-SAM started, process group=%d", pid);
      publishStatus("mapping");
    } catch (const std::exception & e) {
      RCLCPP_ERROR(get_logger(), "mapping start failed: %s", e.what());
      stopProcessGroup(lio_sam_pid_);
      stopProcessGroup(livox_pid_);
      setIdle();
      publishStatus("start_failed");
    }
  }

  void stopMapping()
  {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (state_ == MapState::SAVING) {
        publishStatus("saving_ignore_stop");
        return;
      }
      if (state_ != MapState::MAPPING) {
        publishStatus(state_ == MapState::IDLE ? "mapping_stopped" : "stop_ignored_busy");
        return;
      }
      state_ = MapState::STOPPING;
    }

    publishStatus("stopping_mapping");
    launchWorker([this]() { stopMappingWorker(); });
  }

  void stopMappingWorker()
  {
    stopProcessGroup(lio_sam_pid_);
    if (manage_livox_) {
      stopProcessGroup(livox_pid_);
      const pid_t pid = startShellCommand(makeSourcedCommand(rviz_livox_launch_cmd_));
      if (pid <= 0) {
        setIdle();
        publishStatus("start_rviz_livox_failed");
        return;
      }
      rviz_pid_ = pid;
      RCLCPP_INFO(get_logger(), "managed Livox preview started, process group=%d", pid);
      setIdle();
      publishStatus("rviz_livox_started");
      return;
    }

    setIdle();
    publishStatus("mapping_stopped");
  }

  void saveMap(const std::string & map_name)
  {
    if (!isValidMapName(map_name)) {
      publishStatus("invalid_map_name");
      return;
    }

    {
      std::lock_guard<std::mutex> lock(mutex_);
      if (state_ != MapState::MAPPING) {
        publishStatus("not_mapping");
        return;
      }
      const bool cloud_fresh = map_has_data_ &&
        std::chrono::steady_clock::now() - last_cloud_time_ < 2s;
      if (!cloud_fresh) {
        publishStatus("no_map_data");
        return;
      }
      state_ = MapState::SAVING;
    }

    publishStatus("saving");
    launchWorker([this, map_name]() { saveMapWorker(map_name); });
  }

  void saveMapWorker(const std::string & map_name)
  {
    const std::filesystem::path base(map_base_dir_);
    const std::filesystem::path destination = base / map_name;
    const std::filesystem::path staging =
      base / ("." + map_name + ".saving-" + std::to_string(::getpid()));
    bool committed = false;
    bool save_request_pending = false;
    bool lio_stopped_for_pending_save = false;

    try {
      std::error_code error;
      std::filesystem::create_directories(base, error);
      if (error) {
        throw std::runtime_error("Cannot create PCD base directory: " + error.message());
      }
      if (std::filesystem::exists(destination)) {
        setMappingAfterSaveFailure();
        publishStatus("map_exists");
        return;
      }
      std::filesystem::remove_all(staging, error);
      if (error) {
        throw std::runtime_error("Cannot clear stale temporary map directory: " + error.message());
      }
      if (!std::filesystem::create_directory(staging, error) || error) {
        throw std::runtime_error("Cannot create temporary map directory: " + error.message());
      }

      const std::string service_destination = staging.string();
      RCLCPP_INFO(
        get_logger(), "saving map to staging directory %s",
        service_destination.c_str());
      if (!callSaveMapService(service_destination, save_request_pending)) {
        throw std::runtime_error("LIO-SAM save service failed or timed out");
      }
      if (!waitForPcd(staging / "GlobalMap.pcd")) {
        throw std::runtime_error("LIO-SAM reported success but GlobalMap.pcd is missing or empty");
      }

      std::filesystem::rename(staging, destination, error);
      if (error) {
        throw std::runtime_error("Cannot publish the saved map directory: " + error.message());
      }
      committed = true;
      publishStatus("saved:" + destination.string());

      if (stop_after_save_) {
        stopProcessGroup(lio_sam_pid_);
        if (manage_livox_) {
          stopProcessGroup(livox_pid_);
        }
        setIdle();
        publishStatus("idle");
      } else {
        std::lock_guard<std::mutex> lock(mutex_);
        state_ = MapState::MAPPING;
      }
    } catch (const std::exception & e) {
      RCLCPP_ERROR(get_logger(), "map save failed: %s", e.what());
      if (save_request_pending) {
        RCLCPP_ERROR(
          get_logger(), "stopping the owned LIO-SAM process group before cleaning an "
          "unresolved save request");
        stopProcessGroup(lio_sam_pid_);
        lio_stopped_for_pending_save = true;
      }
      if (!committed) {
        std::error_code ignored;
        std::filesystem::remove_all(staging, ignored);
      }
      if (lio_stopped_for_pending_save) {
        setIdle();
        publishStatus("save_failed_lio_stopped");
      } else {
        setMappingAfterSaveFailure();
        publishStatus("save_failed");
      }
    }
  }

  bool callSaveMapService(const std::string & destination, bool & request_pending)
  {
    request_pending = false;
    const auto service_deadline =
      std::chrono::steady_clock::now() + std::chrono::seconds(10);
    while (!shutting_down_.load() &&
      !save_client_->wait_for_service(100ms) &&
      std::chrono::steady_clock::now() < service_deadline)
    {
    }
    if (shutting_down_.load() || !save_client_->service_is_ready()) {
      RCLCPP_ERROR(get_logger(), "%s service is not available.", save_map_service_.c_str());
      return false;
    }

    auto request = std::make_shared<lio_sam::srv::SaveMap::Request>();
    request->resolution = static_cast<float>(map_resolution_);
    request->destination = destination;
    auto promise = std::make_shared<std::promise<bool>>();
    auto result_future = promise->get_future();
    const auto logger = get_logger();
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
    request_pending = true;

    const auto deadline = std::chrono::steady_clock::now() +
      std::chrono::milliseconds(static_cast<int>(save_timeout_sec_ * 1000.0));
    while (!shutting_down_.load() && std::chrono::steady_clock::now() < deadline) {
      if (result_future.wait_for(100ms) == std::future_status::ready) {
        request_pending = false;
        return result_future.get();
      }
    }
    RCLCPP_ERROR(get_logger(), "save map service timed out or node is shutting down.");
    return false;
  }

  bool waitForPcd(const std::filesystem::path & path) const
  {
    const auto deadline = std::chrono::steady_clock::now() + 10s;
    while (!shutting_down_.load() && std::chrono::steady_clock::now() < deadline) {
      std::error_code error;
      if (std::filesystem::is_regular_file(path, error) &&
        std::filesystem::file_size(path, error) > 0 && !error)
      {
        return true;
      }
      std::this_thread::sleep_for(100ms);
    }
    return false;
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
      RCLCPP_INFO(get_logger(), "LIO-SAM registered point cloud is ready.");
      publishStatus("map_data_ready");
    }
  }

  pid_t startShellCommand(const std::string & command)
  {
    const pid_t pid = fork();
    if (pid < 0) {
      RCLCPP_ERROR(get_logger(), "fork failed: %s", std::strerror(errno));
      return -1;
    }
    if (pid == 0) {
      setpgid(0, 0);
      execl("/bin/bash", "bash", "-lc", command.c_str(), nullptr);
      _exit(127);
    }
    setpgid(pid, pid);
    return pid;
  }

  void stopProcessGroup(pid_t & pid)
  {
    if (pid <= 0) {
      return;
    }
    const pid_t process_group = pid;
    RCLCPP_INFO(get_logger(), "stopping owned process group=%d", process_group);

    kill(-process_group, SIGINT);
    if (!waitForProcessGroupExit(process_group, 3s)) {
      kill(-process_group, SIGTERM);
      if (!waitForProcessGroupExit(process_group, 1s)) {
        kill(-process_group, SIGKILL);
        waitForProcessGroupExit(process_group, 500ms);
      }
    }
    int status = 0;
    while (waitpid(process_group, &status, WNOHANG) > 0) {
    }
    pid = -1;
  }

  bool waitForProcessGroupExit(pid_t process_group, std::chrono::milliseconds timeout)
  {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    bool leader_reaped = false;
    while (std::chrono::steady_clock::now() < deadline) {
      if (!leader_reaped) {
        int status = 0;
        const pid_t result = waitpid(process_group, &status, WNOHANG);
        if (result == process_group || (result < 0 && errno == ECHILD)) {
          leader_reaped = true;
        }
      }
      if (kill(-process_group, 0) < 0 && errno == ESRCH) {
        return true;
      }
      std::this_thread::sleep_for(50ms);
    }
    return kill(-process_group, 0) < 0 && errno == ESRCH;
  }

  bool sleepInterruptibly(std::chrono::milliseconds duration) const
  {
    const auto deadline = std::chrono::steady_clock::now() + duration;
    while (!shutting_down_.load() && std::chrono::steady_clock::now() < deadline) {
      std::this_thread::sleep_for(50ms);
    }
    return !shutting_down_.load();
  }

  void launchWorker(std::function<void()> operation)
  {
    if (worker_.joinable()) {
      worker_.join();
    }
    worker_ = std::thread([this, operation = std::move(operation)]() {
      try {
        operation();
      } catch (const std::exception & e) {
        RCLCPP_ERROR(get_logger(), "map operation failed: %s", e.what());
        stopProcessGroup(lio_sam_pid_);
        if (manage_livox_) {
          stopProcessGroup(livox_pid_);
        }
        setIdle();
        publishStatus("operation_failed");
      } catch (...) {
        RCLCPP_ERROR(get_logger(), "map operation failed with an unknown error.");
        stopProcessGroup(lio_sam_pid_);
        if (manage_livox_) {
          stopProcessGroup(livox_pid_);
        }
        setIdle();
        publishStatus("operation_failed");
      }
    });
  }

  std::string makeSourcedCommand(const std::string & command) const
  {
    std::string quoted = "'";
    for (char c : workspace_setup_) {
      quoted += c == '\'' ? "'\\''" : std::string(1, c);
    }
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
    last_cloud_time_ = {};
  }

  void setMappingAfterSaveFailure()
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!shutting_down_.load()) {
      state_ = MapState::MAPPING;
    }
  }

  void publishStatus(const std::string & status)
  {
    if (shutting_down_.load() || !status_pub_) {
      return;
    }
    std_msgs::msg::String msg;
    msg.data = status;
    status_pub_->publish(msg);
  }

  rclcpp::Subscription<std_msgs::msg::String>::SharedPtr buildmap_sub_;
  rclcpp::Subscription<sensor_msgs::msg::PointCloud2>::SharedPtr cloud_sub_;
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr status_pub_;
  rclcpp::Client<lio_sam::srv::SaveMap>::SharedPtr save_client_;

  std::mutex mutex_;
  std::thread worker_;
  std::atomic<bool> shutting_down_{false};
  MapState state_ = MapState::IDLE;
  bool map_has_data_ = false;
  std::chrono::steady_clock::time_point last_cloud_time_{};

  pid_t livox_pid_ = -1;
  pid_t lio_sam_pid_ = -1;
  pid_t rviz_pid_ = -1;

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
