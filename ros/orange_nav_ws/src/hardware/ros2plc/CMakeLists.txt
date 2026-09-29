cmake_minimum_required(VERSION 3.8)
project(ros2plc)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# find dependencies
find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(std_msgs REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(tf2 REQUIRED)
find_package(tf2_ros REQUIRED)
find_package(PkgConfig REQUIRED)
find_package(nav_msgs REQUIRED)
pkg_check_modules(LIBMODBUS REQUIRED libmodbus)
# uncomment the following section in order to fill in
# further dependencies manually.
# find_package(<dependency> REQUIRED)

add_executable(ros2plc src/ros2plc.cpp)

# 自动处理ROS2依赖
ament_target_dependencies(ros2plc
  rclcpp
  sensor_msgs
  std_msgs
  geometry_msgs
  tf2
  tf2_ros
  nav_msgs
)
target_link_libraries(ros2plc ${LIBMODBUS_LIBRARIES})
target_include_directories(ros2plc PRIVATE
  ${LIBMODBUS_INCLUDE_DIRS}
)
target_include_directories(ros2plc PUBLIC
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

# 安装和导出

install(TARGETS ros2plc
  DESTINATION lib/${PROJECT_NAME}
)


ament_package()
