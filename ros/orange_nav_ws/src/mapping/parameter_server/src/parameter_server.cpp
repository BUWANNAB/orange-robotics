#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/u_int8.hpp>
#include <memory>
#include <string>
#include <cmath>
#include <mutex>
#include <cstdlib>

/* #include <mysql-cppconn/jdbc/mysql_driver.h>
#include <mysql-cppconn/jdbc/mysql_connection.h>
#include <mysql-cppconn/jdbc/cppconn/driver.h>
#include <mysql-cppconn/jdbc/cppconn/exception.h>
#include <mysql-cppconn/jdbc/cppconn/resultset.h>
#include <mysql-cppconn/jdbc/cppconn/statement.h>
#include "/home/qizheng/coverage_ws/build/parameter_server/rosidl_generator_cpp/parameter_server/srv/get_parameters.hpp" */

#include <mysql_driver.h>
#include <mysql_connection.h>
#include <cppconn/driver.h>
#include <cppconn/exception.h>
#include <cppconn/resultset.h>
#include <cppconn/statement.h>
#include <parameter_server/srv/get_parameters.hpp>

using namespace std;
using namespace std::chrono_literals;
using GetParameters = parameter_server::srv::GetParameters;

// 数据库连接参数
string envOrDefault(const char *name, const char *fallback)
{
    const char *value = std::getenv(name);
    return value && *value ? value : fallback;
}

const string host = envOrDefault("BLUEANT_DB_HOST", "localhost:3306");
const string user = envOrDefault("BLUEANT_DB_USER", "root");
const string password = envOrDefault("BLUEANT_DB_PASSWORD", "root");
const string database_name = envOrDefault("BLUEANT_DB_NAME", "db_ant");
const string table_name = envOrDefault("BLUEANT_DB_TABLE", "t_param");

// 参数结构体
struct ParameterSet {
    double vehicle_mode;
    double navigation_mode;
    double robot_radius;
    double tool_radius;
    double point_spacing;
    
    int8_t clean_mode;  
    bool enable_insertion; 
    
    double local_origin_longitude;
    double local_origin_latitude;
    double speed_run;
    double speed_max;
    double speed_min;
    
    std::string current_map;
    double coverage_direction;
    
    double forwordDis;
    double dirpropeller;
    double initpropeller;
    double iimtw;
    double closetrack;
    double rotation;
    double wheelBase;
    double vvwk;
    int8_t runmode;
};

class ParameterServer : public rclcpp::Node
{
public:
    ParameterServer() : Node("parameter_server"), params_loaded(false)
    {
        // 创建服务
        get_params_service_ = this->create_service<GetParameters>(
            "get_parameters",
            bind(&ParameterServer::handleGetParameters, this, placeholders::_1, placeholders::_2));
        
        // 订阅更新通知
        update_subscription_ = this->create_subscription<std_msgs::msg::UInt8>(
            "parameter_update_topic", 10,
            bind(&ParameterServer::updateCallback, this, placeholders::_1));
        
        // 定时更新参数
        timer_ = this->create_wall_timer(30s, bind(&ParameterServer::updateParameters, this));
        
        // 初始加载参数
        updateParameters();
        
        RCLCPP_INFO(this->get_logger(), "Parameter Server is ready");
    }

private:
    // 服务端
    rclcpp::Service<GetParameters>::SharedPtr get_params_service_;
    
    // 定时器
    rclcpp::TimerBase::SharedPtr timer_;
    
    // 订阅器
    rclcpp::Subscription<std_msgs::msg::UInt8>::SharedPtr update_subscription_;
    
    // 参数缓存
    ParameterSet cached_params_;
    
    // 互斥锁保护缓存
    mutex params_mutex_;
    
    // 参数加载状态
    bool params_loaded;
    
    // 数据库连接对象
    shared_ptr<sql::Connection> con;
    
    // 从数据库加载参数
void updateParameters()
{
    try
    {
        sql::mysql::MySQL_Driver *driver = sql::mysql::get_mysql_driver_instance();
        con = shared_ptr<sql::Connection>(driver->connect(host, user, password));
        con->setSchema(database_name);
        
        shared_ptr<sql::Statement> stmt(con->createStatement());
        shared_ptr<sql::ResultSet> res(stmt->executeQuery("SELECT * FROM " + table_name));

        if (res->next())
        {
            ParameterSet new_params;
            
            try {
                // 辅助函数定义
                auto safeGetDouble = [&](const string& field, double& output) {
                    if(!res->isNull(field)) {
                        string val = res->getString(field);
                        try {
                            output = std::stod(val);
                        } catch (...) {
                            RCLCPP_WARN(this->get_logger(), "Failed to convert %s to double: %s", 
                                      field.c_str(), val.c_str());
                        }
                    }
                };

                auto safeGetInt8 = [&](const string& field, int8_t& output) {
                    if(!res->isNull(field)) {
                        string val = res->getString(field);
                        try {
                            output = static_cast<int8_t>(std::stoi(val));
                        } catch (...) {
                            RCLCPP_WARN(this->get_logger(), "Failed to convert %s to int8: %s", 
                                      field.c_str(), val.c_str());
                        }
                    }
                };

                auto safeGetBool = [&](const string& field, bool& output) {
                    if(!res->isNull(field)) {
                        string val = res->getString(field);
                        // 处理多种布尔值表示形式
                        output = (val == "1" || val == "true" || val == "TRUE" || val == "True");
                    }
                };

                // 转换各个字段
                safeGetDouble("vehicle_mode", new_params.vehicle_mode);
                safeGetDouble("navigation_mode", new_params.navigation_mode);
                safeGetDouble("robot_radius", new_params.robot_radius);
                safeGetDouble("tool_radius", new_params.tool_radius);
                safeGetDouble("point_spacing", new_params.point_spacing);
                safeGetDouble("wheelBase", new_params.wheelBase);
                
                safeGetInt8("clean_mode", new_params.clean_mode);
                safeGetBool("enable_insertion", new_params.enable_insertion);
                
                safeGetDouble("local_origin_longitude", new_params.local_origin_longitude);
                safeGetDouble("local_origin_latitude", new_params.local_origin_latitude);
                safeGetDouble("speed_run", new_params.speed_run);
                safeGetDouble("speed_max", new_params.speed_max);
                safeGetDouble("speed_min", new_params.speed_min);
                
                safeGetDouble("coverage_direction", new_params.coverage_direction);
      
                safeGetDouble("forwordDis", new_params.forwordDis);
                safeGetDouble("dirpropeller", new_params.dirpropeller);
                safeGetDouble("initpropeller", new_params.initpropeller);
                safeGetDouble("iimtw", new_params.iimtw);
                safeGetDouble("closetrack", new_params.closetrack);
                safeGetDouble("rotation", new_params.rotation);
                safeGetDouble("vvwk", new_params.vvwk);
                safeGetInt8("runmode", new_params.runmode);
                
                // 特殊处理字符串类型的current_map
                if(!res->isNull("current_map")) {
                    new_params.current_map = res->getString("current_map");
                }

                // 更新缓存
                lock_guard<mutex> lock(params_mutex_);
                cached_params_ = new_params;
                params_loaded = true;
                RCLCPP_INFO(this->get_logger(), "Parameters updated successfully");
            } 
            catch (const std::exception& e) {
                RCLCPP_ERROR(this->get_logger(), "Error converting parameter: %s", e.what());
            }
        }
    }
    catch (sql::SQLException &e)
    {
        RCLCPP_ERROR(this->get_logger(), "MySQL error: %s (code: %d)", e.what(), e.getErrorCode());
    }
}
    
    // 订阅话题的回调函数
    void updateCallback(const std_msgs::msg::UInt8::SharedPtr msg)
    {
        (void)msg; // 不使用消息内容
        RCLCPP_INFO(this->get_logger(), "Received update signal, updating parameters...");
        updateParameters();
    }
    
void handleGetParameters(
    const shared_ptr<GetParameters::Request> request,
    shared_ptr<GetParameters::Response> response)
{
    (void)request;
    
    if (!params_loaded) {
        RCLCPP_ERROR(this->get_logger(), "Parameters not loaded yet");
        return;
    }
    
    lock_guard<mutex> lock(params_mutex_);
    
    // 填充响应
    response->vehicle_mode = cached_params_.vehicle_mode;
    response->navigation_mode = cached_params_.navigation_mode;
    response->robot_radius = cached_params_.robot_radius;
    response->tool_radius = cached_params_.tool_radius;
    response->point_spacing = cached_params_.point_spacing;
    response->wheel_base = cached_params_.wheelBase;
    
    response->clean_mode = cached_params_.clean_mode;
    response->enable_insertion = cached_params_.enable_insertion;
    
    response->local_origin_longitude = cached_params_.local_origin_longitude;
    response->local_origin_latitude = cached_params_.local_origin_latitude;
    response->speed_run = cached_params_.speed_run;
    response->speed_max = cached_params_.speed_max;
    response->speed_min = cached_params_.speed_min;
    
    response->current_map = cached_params_.current_map;
    response->coverage_direction = cached_params_.coverage_direction;
    
    response->forword_dis = cached_params_.forwordDis;
    response->dir_propeller = cached_params_.dirpropeller;
    response->init_propeller = cached_params_.initpropeller;
    response->limit_w = cached_params_.iimtw;
    response->close_track = cached_params_.closetrack;
    response->angle_threshold = cached_params_.rotation;
    response->rotation = cached_params_.rotation;
    response->vv_wk = cached_params_.vvwk;
    response->run_mode = cached_params_.runmode;
    
    RCLCPP_INFO(this->get_logger(), "Served parameters request");
}
};

int main(int argc, char** argv)
{
    rclcpp::init(argc, argv);
    auto node = make_shared<ParameterServer>();
    rclcpp::spin(node);
    rclcpp::shutdown();
    return 0;
}
