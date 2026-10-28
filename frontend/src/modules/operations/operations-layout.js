(function(root){
  const core=['dashboard','robots','battery','alarms','tasks','logs'];
  const system=['integration','firmware','upgrades'];
  function navigationGroups(modules,can){
    const allowed=modules.filter(module=>can(module[2]));
    return {core:allowed.filter(module=>core.includes(module[0])),system:allowed.filter(module=>system.includes(module[0]))};
  }
  function showsRecording(pathname){return ['/src/components/outdoor-map/outdoor-map.html','/ui/src/components/outdoor-map/outdoor-map.html'].includes(pathname);}
  function classifyPath(pathname){
    if(pathname.endsWith('/map-workbench.html'))return 'map';
    return showsRecording(pathname)?'legacy':'modern';
  }
  const hints={robots:'已启用且不在维护中的机器人',online_rate:'启用且非维护机器人中，60 秒内在线的比例',tasks:'今天创建的任务数量',success_rate:'今天创建且已结束任务中的成功比例',failed:'今天创建且失败或超时的任务',alarms:'等待操作员确认的报警',battery:'在线且非维护的启用机器人电量均值',low:'在线、启用且非维护机器人中的低电量数量'};
  const exported={navigationGroups,classifyPath,showsRecording,metricHint:key=>hints[key]||'当前运营统计'};
  if(typeof module!=='undefined')module.exports=exported;else root.OperationsLayout=exported;
})(typeof window!=='undefined'?window:globalThis);
