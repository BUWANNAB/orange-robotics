#include "vehicle_navigation/jerk_limiter.hpp"
#include "vehicle_navigation/velocity_profiler.hpp"
#include "vehicle_navigation/tracking_logic.hpp"
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <cassert>
#include <iostream>

int main() {
    using orange_nav::SpinAction;
    assert(std::abs(orange_nav::bodyHeadingError(0,0,false)) < 1e-5F);
    assert(std::abs(orange_nav::bodyHeadingError(orange_nav::pi,0,true)) < 1e-5F);
    assert(std::abs(orange_nav::bodyHeadingError(3*orange_nav::pi/4,0,true)+orange_nav::pi/4) < 1e-5F);
    orange_nav::SpinModeGate gate;
    assert(gate.step(true, .5F, .04F, 1.F, false) == SpinAction::Rotate);
    assert(gate.step(true, 0.F, .04F, 1.F, false) == SpinAction::WaitForStop);
    assert(gate.step(true, 0.F, .04F, 1.F, true) == SpinAction::WaitForStop);
    // Repeated resampled points in one explicit-spin section must not restart rotation.
    assert(gate.step(true, .5F, .04F, 1.F, false) == SpinAction::Track);
    assert(gate.step(false, 0.F, .04F, 1.F, true) == SpinAction::Track);
    assert(gate.step(true, .5F, .04F, 1.F, false) == SpinAction::Rotate);
    gate.reset();
    assert(gate.step(true, 0.F, .04F, 1.F, false) == SpinAction::WaitForStop);
    for(float target : {0.8F,-0.8F}) {
        float v=0,a=0;
        for(int i=0;i<400;i++) {
            const float old_a=a,old_v=v;
            v=orange_nav::limitJerk(target,v,a,.6F,.8F,.8F,.05F);
            assert(std::isfinite(v));assert(std::abs(a-old_a)<=.04001F);
            assert(std::abs(v-old_v)<=.04001F);
        }
        assert(std::abs(v-target)<.0001F);
        for(int i=0;i<400;i++) {
            const float old=a;v=orange_nav::limitJerk(0,v,a,.6F,.8F,.8F,.05F);
            assert(std::abs(a-old)<=.04001F);
        }
        assert(std::abs(v)<.0001F);
    }
    for(int count : {2,20,1000}) {
        double path[1000][9]{};std::size_t n=count;
        for(int i=0;i<count;i++){path[i][0]=i*2.;path[i][3]=100+i;path[i][4]=-.5;}
        std::vector<std::size_t> indices;
        orange_nav::BidirectionalVelocityProfiler::ProfilerParams p;
        orange_nav::BidirectionalVelocityProfiler::profile(path,n,1000,p,0,&indices);
        assert(n<=1000);assert(indices.size()==n);assert(path[n-1][0]==(count-1)*2.);
        assert(path[n-1][4]==0);
        for(std::size_t i=0;i<n;i++){assert(path[i][4]<=0);assert(indices[i]>=1&&indices[i]<static_cast<std::size_t>(count));}
    }
    float v=0,a=0;
    for(float goal : {.6F, -.4F, .02F, 0.F}) {
        for(int i=0;i<500;i++) {
            float before=a;v=orange_nav::limitJerk(goal,v,a,.6F,.8F,.8F,.05F);
            assert(std::abs(a-before)<=.04001F);
        }
        assert(std::abs(v-goal)<.0001F);
    }
    std::cout<<"motion profile checks passed\n";
}
