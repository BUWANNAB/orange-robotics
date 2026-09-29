cmake_minimum_required(VERSION 3.8)
project(parameter_server)

set(CMAKE_CXX_STANDARD 14)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(rcl_interfaces REQUIRED)
find_package(std_msgs REQUIRED)

find_path(MYSQLCPPCONN_INCLUDE_DIR
  NAMES mysql_driver.h
  PATH_SUFFIXES jdbc mysql-cppconn/jdbc
  REQUIRED)
find_library(MYSQLCPPCONN_LIBRARY NAMES mysqlcppconn REQUIRED)

rosidl_generate_interfaces(${PROJECT_NAME}
  "srv/GetParameters.srv"
  DEPENDENCIES rcl_interfaces
)
rosidl_get_typesupport_target(cpp_typesupport_target
  ${PROJECT_NAME} "rosidl_typesupport_cpp")

add_executable(parameter_server_node src/parameter_server.cpp)
target_include_directories(parameter_server_node PRIVATE
  ${MYSQLCPPCONN_INCLUDE_DIR}
)
ament_target_dependencies(parameter_server_node
  rclcpp rcl_interfaces std_msgs
)
target_link_libraries(parameter_server_node
  "${cpp_typesupport_target}"
  ${MYSQLCPPCONN_LIBRARY}
)

install(TARGETS parameter_server_node DESTINATION lib/${PROJECT_NAME})
ament_export_dependencies(rosidl_default_runtime)
ament_package()
