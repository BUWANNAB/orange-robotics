#include "hardware_bind_lib/hardware_binder.hpp"
#include <fstream>
#include <sstream>
#include <array>
#include <memory>
#include <cstdio>
#include <iostream>

namespace hardware_bind_lib {

HardwareBinder::HardwareBinder()
    : debug_mode_(false), authorized_(false) {
    // 初始化时生成硬件ID
    hardware_id_ = generateHardwareID();
}

std::string HardwareBinder::generateHardwareID() {
    // 获取各个硬件组件信息
    cpu_info_ = getCPUSerial();
    disk_info_ = getDiskSerial();
    mac_info_ = getMACAddress();

    // 组合原始ID
    std::string raw_id = cpu_info_ + disk_info_ + mac_info_;

    // 计算SHA256哈希
    hardware_id_ = calculateSHA256(raw_id);

    if (debug_mode_) {
        std::cout << "Hardware Components:" << std::endl;
        std::cout << "CPU: " << cpu_info_.substr(0, 32) << "..." << std::endl;
        std::cout << "Disk: " << disk_info_.substr(0, 32) << "..." << std::endl;
        std::cout << "MAC: " << mac_info_ << std::endl;
        std::cout << "Generated Hardware ID: " << hardware_id_ << std::endl;
    }
    return hardware_id_;

}

std::string HardwareBinder::getCPUSerial() {
    std::string cpu_info = getCPUSerialFromProc();
    if (cpu_info.empty() || cpu_info == "UNKNOWN_CPU") {
        cpu_info = getCPUSerialFromCommand();
    }
    return cpu_info;
}

std::string HardwareBinder::getCPUSerialFromProc() {
    std::ifstream cpuinfo("/proc/cpuinfo");
    std::string line;
    int processor_count = 0;
    std::string combined_info;

    while (std::getline(cpuinfo, line)) {
        if (line.find("processor") != std::string::npos) {
            processor_count++;
        }
        if (line.find("vendor_id") != std::string::npos ||
            line.find("model name") != std::string::npos ||
            line.find("cpu family") != std::string::npos) {
            combined_info += line + "|";
        }
    }

    if (combined_info.empty()) {
        return "UNKNOWN_CPU";
    }

    return calculateSHA256(combined_info + std::to_string(processor_count));
}

std::string HardwareBinder::getCPUSerialFromCommand() {
    std::string result = executeCommand("dmidecode -t processor 2>/dev/null | grep 'ID:' | head -1");
    if (result.empty()) {
        return "UNKNOWN_CPU";
    }
    return calculateSHA256(result);
}

std::string HardwareBinder::getDiskSerial() {
    std::string disk_info = getDiskSerialFromLSBLK();
    if (disk_info.empty() || disk_info.find("UNKNOWN") != std::string::npos) {
        disk_info = getDiskSerialFromUDEV();
    }
    return disk_info;
}

std::string HardwareBinder::getDiskSerialFromLSBLK() {
    std::string result = executeCommand("lsblk -d -o serial 2>/dev/null | grep -v SERIAL | head -1");
    if (result.empty()) {
        result = "UNKNOWN_DISK";
    }

    return result;
}

std::string HardwareBinder::getDiskSerialFromUDEV() {
    std::string result = executeCommand("udevadm info --query=property --name=/dev/sda 2>/dev/null | grep ID_SERIAL_SHORT | cut -d'=' -f2");
    if (result.empty()) {
        result = executeCommand("lsblk -d -o UUID 2>/dev/null | grep -v UUID | head -1");
    }
    return result.empty() ? "UNKNOWN_DISK" : result;
}

std::string HardwareBinder::getMACAddress() {
    std::string mac_info = getMACAddressFromSysFS();
    if (mac_info.empty() || mac_info == "00:00:00:00:00:00") {
        mac_info = getMACAddressFromIPCommand();
    }
    return mac_info.empty() ? "UNKNOWN_MAC" : mac_info;
}

std::string HardwareBinder::getMACAddressFromSysFS() {
    std::vector<std::string> interfaces = {"eth0", "enp0s3", "enp0s8", "wlan0", "wlp2s0"};

    for (const auto& interface : interfaces) {
        std::ifstream netfile("/sys/class/net/" + interface + "/address");
        if (netfile.is_open()) {
            std::string mac;
            netfile >> mac;
            netfile.close();
            if (!mac.empty() && mac != "00:00:00:00:00:00") {
                return mac;
            }
        }
    }
    return "";
}

std::string HardwareBinder::getMACAddressFromIPCommand() {
    return executeCommand("ip link show | grep link/ether | head -1 | awk '{print $2}'");
}

bool HardwareBinder::verifyAuthorization(const std::string& authorized_id) {
    authorized_ = (hardware_id_ == authorized_id);
    return authorized_;
}

bool HardwareBinder::isAuthorized() const {
    return authorized_;
}

void HardwareBinder::setDebugMode(bool debug) {
    debug_mode_ = debug;
}

std::string HardwareBinder::getHardwareComponentsInfo() const {
    std::stringstream ss;
    ss << "CPU: " << cpu_info_.substr(0, 16) << "...\n"
       << "Disk: " << disk_info_.substr(0, 16) << "...\n"
       << "MAC: " << mac_info_ << "\n"
       << "Hardware ID: " << hardware_id_.substr(0, 16) << "...";
    return ss.str();
}

std::string HardwareBinder::executeCommand(const std::string& cmd) {
    std::array<char, 128> buffer;
    std::string result;
    std::unique_ptr<FILE, decltype(&pclose)> pipe(popen(cmd.c_str(), "r"), pclose);

    if (!pipe) {
        return "";
    }

    while (fgets(buffer.data(), buffer.size(), pipe.get())) {
        result += buffer.data();
    }

    // 移除换行符
    if (!result.empty() && result.back() == '\n') {
        result.pop_back();
    }

    return result;
}

std::string HardwareBinder::calculateSHA256(const std::string& input) {
    std::string cmd = "echo -n '" + input + "' | sha256sum | cut -d' ' -f1";
    std::string result = executeCommand(cmd);

    if (result.length() > 32) {
        result = result.substr(0, 32);
    }

    return result;
}

} // namespace hardware_bind_lib
