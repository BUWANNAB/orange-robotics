#pragma once
#include <algorithm>
#include <cmath>

namespace orange_nav {
// Second-order command filter. Protective stops deliberately bypass this filter.
inline float limitJerk(float target, float velocity, float& acceleration,
                       float accel_limit, float decel_limit, float jerk_limit, float dt) {
    if (!std::isfinite(target) || !std::isfinite(velocity) || !std::isfinite(acceleration) ||
        dt <= 0 || dt > 0.2F || accel_limit <= 0 || decel_limit <= 0 || jerk_limit <= 0) {
        acceleration = 0;
        return 0;
    }
    // Brake to zero before reversing; acceleration/deceleration are magnitudes.
    if (target * velocity < 0) target = 0;
    const float old_a = acceleration;
    const float jerk = std::clamp(9.F * (target - velocity) - 6.F * old_a, -jerk_limit, jerk_limit);
    const float positive = velocity < -0.001F ? decel_limit : accel_limit;
    const float negative = velocity > 0.001F ? decel_limit : accel_limit;
    // Slew toward the acceleration bound too (no acceleration discontinuity on reversal).
    const float desired_a = std::clamp(old_a + jerk * dt, -negative, positive);
    acceleration = std::clamp(desired_a, old_a - jerk_limit * dt, old_a + jerk_limit * dt);
    float next = velocity + 0.5F * (old_a + acceleration) * dt;
    if (std::abs(target-next) < 1e-5F && std::abs(acceleration) < jerk_limit*dt*0.25F) {
        acceleration = 0; next = target;
    }
    return next;
}
}
