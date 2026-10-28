const test=require('node:test'),assert=require('node:assert/strict');
const {navigationGroups,classifyPath,metricHint}=require('../src/modules/operations/operations-layout.js');
const modules=[['dashboard','看板','dashboard:view'],['robots','机器人','robot:view'],['maps','地图编辑','map:view'],['integration','WMS','integration:manage'],['firmware','固件','firmware:view'],['logs','日志','log:view']];
test('operations navigation separates daily work from system settings and excludes map editing',()=>{
  const groups=navigationGroups(modules,()=>true);
  assert.deepEqual(groups.core.map(item=>item[0]),['dashboard','robots','logs']);
  assert.deepEqual(groups.system.map(item=>item[0]),['integration','firmware']);
  assert.ok(![...groups.core,...groups.system].some(item=>item[0]==='maps'));
});
test('configuration grouping preserves role permissions',()=>{
  const groups=navigationGroups(modules,permission=>['dashboard:view','robot:view','map:view'].includes(permission));
  assert.deepEqual(groups.core.map(item=>item[0]),['dashboard','robots']);assert.deepEqual(groups.system,[]);
});
test('modern pages own their controls while legacy pages retain their existing chrome',()=>{
  for(const path of ['/ui/operations.html','/ui/map-resources.html','/ui/radar-settings.html'])assert.equal(classifyPath(path),'modern');
  assert.equal(classifyPath('/ui/map-workbench.html'),'map');
  assert.equal(classifyPath('/src/components/process-map/handle_map.html'),'legacy');
});
test('metric explanations use operator terms without changing null values to zero',()=>{
  assert.match(metricHint('online_rate'),/60 秒/);assert.match(metricHint('success_rate'),/已结束/);
  assert.match(metricHint('alarms'),/确认/);assert.doesNotMatch(metricHint('low'),/low|is_low/);
  assert.equal(metricHint('unknown'),'当前运营统计');
});
