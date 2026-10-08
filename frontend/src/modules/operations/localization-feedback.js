(function () {
  const busySwitch = new Set(['pending', 'searching', 'loading', 'loaded', 'localizing']);
  const busyRelocalization = new Set(['pending', 'collecting', 'searching', 'candidate', 'verifying']);

  function from(frame) {
    const localization = frame?.localization || {}, switching = frame?.switch || {}, relocalization = frame?.relocalization || {};
    if (switching.status === 'failed') return { kind: 'error', title: '地图切换失败', detail: switching.message || '请查看切换状态并检查地图与 ROS 反馈。', confirmed: false };
    if (busySwitch.has(switching.status) || busyRelocalization.has(relocalization.status)) {
      return { kind: 'pending', title: '定位确认中', detail: '收到成功的实时定位质量反馈后，这里会明确显示“定位成功”。', confirmed: false };
    }
    if (localization.source === 'simulation') {
      return { kind: 'neutral', title: '当前为仿真', detail: '演示轨迹不代表机器人真实定位成功。', confirmed: false };
    }
    if (localization.source === 'ros' && localization.fresh && localization.valid) {
      return { kind: 'success', title: '定位成功', detail: `ROS 实时位姿新鲜且匹配质量已通过。${frame?.inhibited ? '车辆仍处于停止锁定。' : '当前未处于停止锁定。'}`, confirmed: true };
    }
    if (localization.source === 'ros' && localization.fresh) {
      return { kind: 'warning', title: '尚未确认定位成功', detail: '位姿数据正在到达，但定位质量门槛尚未通过；请勿据此开始行驶。', confirmed: false };
    }
    if (localization.source === 'ros') {
      return { kind: 'warning', title: '定位数据已过期', detail: '尚未收到新鲜定位反馈；页面显示的位置可能是最后一次已知值。', confirmed: false };
    }
    return { kind: 'pending', title: '等待 ROS 定位反馈', detail: '收到真实 ROS 位姿和质量反馈后，页面会明确报告定位结果。', confirmed: false };
  }

  function disconnected() {
    return { kind: 'warning', title: '定位连接中断', detail: '定位成功状态已撤销；页面坐标仅为最后已知值。', confirmed: false };
  }

  window.LocalizationFeedback = { from, disconnected };
})();
