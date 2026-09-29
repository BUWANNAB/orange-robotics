#include "vehicle_navigation/vehicle_navigation.hpp"

int main(int argc, char** argv) {
    rclcpp::init(argc, argv);
    auto node = std::make_shared<TrackedVehicleNavigation>();
    rclcpp::spin(node);
    rclcpp::shutdown(); 
    return 0;
}
