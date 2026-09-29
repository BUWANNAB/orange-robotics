#ifndef HARDWARE_BIND_LIB_HARDWARE_BINDER_HPP_
#define HARDWARE_BIND_LIB_HARDWARE_BINDER_HPP_

#include <string>
#include <vector>
#include <memory>

namespace hardware_bind_lib {

class HardwareBinder {
public:
    HardwareBinder();
    virtual ~HardwareBinder() = default;

    // 主要接口方法
    std::string generateHardwareID();
    std::string getCPUSerial();
    std::string getDiskSerial();
    std::string getMACAddress();

    // 验证接口
    bool verifyAuthorization(const std::string& authorized_id);
    bool isAuthorized() const;

    // 工具方法
    void setDebugMode(bool debug);
    std::string getHardwareComponentsInfo() const;

private:
    // 硬件信息获取方法
    std::string getCPUSerialFromProc();
    std::string getCPUSerialFromCommand();
    std::string getDiskSerialFromLSBLK();
    std::string getDiskSerialFromUDEV();
    std::string getMACAddressFromSysFS();
    std::string getMACAddressFromIPCommand();

    // 工具方法
    std::string executeCommand(const std::string& cmd);
    std::string calculateSHA256(const std::string& input);

    // 内部状态
    std::string hardware_id_;
    std::string cpu_info_;
    std::string disk_info_;
    std::string mac_info_;
    bool debug_mode_;
    bool authorized_;
};

} // namespace hardware_bind_lib

#endif // HARDWARE_BIND_LIB_HARDWARE_BINDER_HPP_
