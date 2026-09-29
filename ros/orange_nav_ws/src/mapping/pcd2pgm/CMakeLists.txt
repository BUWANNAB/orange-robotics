cmake_minimum_required(VERSION 3.8)
project(pcd2pgm)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

find_package(ament_cmake_auto REQUIRED)
find_package(rclcpp REQUIRED)
find_package(rclcpp_components REQUIRED)
find_package(rclcpp_action REQUIRED)
find_package(nav_msgs REQUIRED)
find_package(nav2_msgs REQUIRED)
find_package(sensor_msgs REQUIRED)
find_package(visualization_msgs REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(tf2 REQUIRED)
find_package(tf2_ros REQUIRED)
find_package(tf2_geometry_msgs REQUIRED)
find_package(cv_bridge REQUIRED)
find_package(pcl_ros REQUIRED)
find_package(pcl_conversions REQUIRED)
find_package(std_srvs REQUIRED)
find_package(std_msgs REQUIRED)
find_package(OpenCV REQUIRED)
find_package(PCL REQUIRED COMPONENTS common io filters)

add_executable(map_asset_processor src/map_asset_processor.cpp)
target_include_directories(map_asset_processor PRIVATE ${PCL_INCLUDE_DIRS})
target_link_libraries(map_asset_processor ${PCL_LIBRARIES})
install(TARGETS map_asset_processor DESTINATION lib/${PROJECT_NAME})

ament_auto_add_library(${PROJECT_NAME} SHARED src/pcd2pgm.cpp)
target_include_directories(${PROJECT_NAME} PRIVATE include)
ament_target_dependencies(${PROJECT_NAME}
  rclcpp rclcpp_components rclcpp_action
  nav_msgs nav2_msgs sensor_msgs visualization_msgs geometry_msgs
  tf2 tf2_ros tf2_geometry_msgs cv_bridge
  pcl_ros pcl_conversions std_srvs std_msgs
)
target_link_libraries(${PROJECT_NAME}
  ${OpenCV_LIBRARIES}
)

rclcpp_components_register_node(${PROJECT_NAME}
  PLUGIN pcd2pgm::Pcd2PgmNode
  EXECUTABLE ${PROJECT_NAME}_node
)

ament_auto_package(INSTALL_TO_SHARE config launch rviz)
