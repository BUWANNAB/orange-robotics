import os
from ament_index_python.packages import get_package_share_directory
from launch_ros.actions import Node
from launch import LaunchDescription
from launch.actions import (
    DeclareLaunchArgument,
    SetEnvironmentVariable,
)
from launch.substitutions import LaunchConfiguration


def generate_launch_description():
    # Get the launch directory
    bringup_dir = get_package_share_directory("pcd2pgm")

    # Create the launch configuration variables``
    params_file = LaunchConfiguration("params_file")
    map_base_dir = LaunchConfiguration("map_base_dir")
    rviz_config_file = LaunchConfiguration("rviz_config_file")

    stdout_linebuf_envvar = SetEnvironmentVariable(
        "RCUTILS_LOGGING_BUFFERED_STREAM", "1"
    )

    colorized_output_envvar = SetEnvironmentVariable("RCUTILS_COLORIZED_OUTPUT", "1")

    declare_params_file_cmd = DeclareLaunchArgument(
        "params_file",
        default_value=os.path.join(bringup_dir, "config", "pcd2pgm.yaml"),
        description="Full path to the ROS2 parameters file to use for all launched nodes",
    )

    pcd_base_dir = os.environ.get("ROBOT_PCD_DIR", "").strip()
    map_base_dir_default = os.environ.get("ROBOT_MAP_DIR", "").strip()
    if (not pcd_base_dir or not os.path.isabs(pcd_base_dir)
            or not map_base_dir_default or not os.path.isabs(map_base_dir_default)):
        raise RuntimeError("ROBOT_PCD_DIR and ROBOT_MAP_DIR must be absolute shared paths used by the Web backend")

    declare_map_base_dir_cmd = DeclareLaunchArgument(
        "map_base_dir",
        default_value=map_base_dir_default,
        description="Directory shared with the Web application for generated 2D maps",
    )

    declare_rviz_config_file_cmd = DeclareLaunchArgument(
        "rviz_config_file",
        default_value=os.path.join(bringup_dir, "rviz", "pcd2pgm.rviz"),
        description="Full path to the RVIZ config file to use",
    )

    start_pcd2pgm_cmd = Node(
        package="pcd2pgm",
        executable="pcd2pgm_node",
        name="pcd2pgm",
        output="screen",
        parameters=[
            params_file,
            {
                "map_base_dir": map_base_dir,
            },
        ],
    )

    start_rviz_cmd = Node(
        package="rviz2",
        executable="rviz2",
        arguments=["-d", rviz_config_file],
        output="screen",
        remappings=[
            ("/tf", "tf"),
            ("/tf_static", "tf_static"),
        ],
    )

    # Create the launch description and populate
    ld = LaunchDescription()

    # Set environment variables
    ld.add_action(stdout_linebuf_envvar)
    ld.add_action(colorized_output_envvar)

    # Declare the launch options
    ld.add_action(declare_params_file_cmd)
    ld.add_action(declare_map_base_dir_cmd)
    # ld.add_action(declare_rviz_config_file_cmd)

    # Add the actions to launch all of the navigation nodes
    ld.add_action(start_pcd2pgm_cmd)
    # ld.add_action(start_rviz_cmd)

    return ld
