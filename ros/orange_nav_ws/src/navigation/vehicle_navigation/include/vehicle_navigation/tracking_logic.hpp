#pragma once

#include <cmath>

namespace orange_nav {
constexpr float pi = 3.14159265358979323846F;

inline float wrapAngle(float angle) {
    return std::atan2(std::sin(angle), std::cos(angle));
}

// The path bearing drives curvature; reverse travel only changes the body heading target.
inline float bodyHeadingError(float path_bearing, float body_yaw, bool reverse) {
    return wrapAngle(path_bearing + (reverse ? pi : 0.0F) - body_yaw);
}

enum class SpinAction { Track, Rotate, WaitForStop };

class SpinModeGate {
public:
    void reset() { completed_ = false; }

    SpinAction step(bool explicit_spin, float heading_error, float tolerance,
                    float threshold, bool stopped) {
        if (!explicit_spin) completed_ = false;
        const float error = std::abs(heading_error);
        if (explicit_spin && !completed_) {
            if (error < tolerance) {
                if (stopped) completed_ = true;
                return SpinAction::WaitForStop;
            }
            return SpinAction::Rotate;
        }
        return error > threshold ? SpinAction::Rotate : SpinAction::Track;
    }

private:
    bool completed_ = false;
};
}  // namespace orange_nav
