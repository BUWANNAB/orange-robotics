cmake_minimum_required(VERSION 3.8)
project(orange_pointcloud_filter)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(pcl_conversions REQUIRED)
find_package(tf2_ros REQUIRED)
find_package(tf2_eigen REQUIRED)
find_package(Eigen3 3.3 REQUIRED NO_MODULE)
find_package(PCL REQUIRED COMPONENTS common filters)

add_executable(obstacle_pointcloud_filter src/obstacle_pointcloud_filter.cpp)
target_compile_features(obstacle_pointcloud_filter PUBLIC cxx_std_17)
target_include_directories(obstacle_pointcloud_filter SYSTEM PRIVATE ${PCL_INCLUDE_DIRS})
target_link_libraries(obstacle_pointcloud_filter Eigen3::Eigen ${PCL_LIBRARIES})
ament_target_dependencies(obstacle_pointcloud_filter
  rclcpp
  sensor_msgs
  pcl_conversions
  tf2_ros
  tf2_eigen
)

install(TARGETS obstacle_pointcloud_filter DESTINATION lib/${PROJECT_NAME})

ament_package()
