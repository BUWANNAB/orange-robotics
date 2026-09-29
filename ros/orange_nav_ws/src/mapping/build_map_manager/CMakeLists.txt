cmake_minimum_required(VERSION 3.8)
project(build_map_manager)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(std_msgs REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(lio_sam REQUIRED)

add_executable(build_map_manager_node src/build_map_manager_node.cpp)
target_compile_features(build_map_manager_node PUBLIC cxx_std_17)

ament_target_dependencies(build_map_manager_node
  rclcpp
  std_msgs
  sensor_msgs
  lio_sam
)

install(TARGETS
  build_map_manager_node
  DESTINATION lib/${PROJECT_NAME}
)

install(DIRECTORY launch
  DESTINATION share/${PROJECT_NAME}
)

ament_package()
