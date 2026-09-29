cmake_minimum_required(VERSION 3.8)
project(tf_to_pose)

if(CMAKE_COMPILER_IS_GNUCXX OR CMAKE_CXX_COMPILER_ID MATCHES "Clang")
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# find dependencies
find_package(ament_cmake REQUIRED)
find_package(rclcpp REQUIRED)
find_package(tf2_ros REQUIRED)
find_package(geometry_msgs REQUIRED)
find_package(tf2_geometry_msgs REQUIRED)

if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  # the following line skips the linter which checks for copyrights
  # comment the line when a copyright and license is added to all source files
  set(ament_cmake_copyright_FOUND TRUE)
  # the following line skips cpplint (only works in a git repo)
  # comment the line when this package is in a git repo and when
  # a copyright and license is added to all source files
  set(ament_cmake_cpplint_FOUND TRUE)
  ament_lint_auto_find_test_dependencies()
endif()

# 添加可执行文件
add_executable(tf_to_pose_node src/tf_to_pose_node.cpp)

# 指定目标依赖项
ament_target_dependencies(tf_to_pose_node
  rclcpp
  tf2_ros
  geometry_msgs
  tf2_geometry_msgs
)

# 安装可执行文件
install(TARGETS
  tf_to_pose_node
  DESTINATION lib/${PROJECT_NAME}
)

# 安装launch文件（如果有）
if(BUILD_TESTING)
  find_package(ament_lint_auto REQUIRED)
  ament_lint_auto_find_test_dependencies()
endif()

# 安装launch目录
install(DIRECTORY launch
  DESTINATION share/${PROJECT_NAME}
)


ament_package()
