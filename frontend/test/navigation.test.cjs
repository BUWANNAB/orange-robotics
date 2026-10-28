const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {navigationGroups,withMap}=require('../src/modules/navigation/navigation.js');
const config=JSON.parse(fs.readFileSync('frontend/src/config/sidebar.json','utf8'));
test('all published menu entries have a single group and no obsolete map creation link',()=>{
  const groups=navigationGroups(config.sidebar),visible=config.sidebar.filter(item=>item.visible);
  assert.equal(groups.length,4);assert.equal(groups.flatMap(group=>group.items).length,visible.length);
  assert.equal(new Set(visible.map(item=>item.id)).size,visible.length);
  assert.equal(visible.filter(item=>item.group==='workspace').length,1);
  assert.ok(!visible.some(item=>item.id==='drawMap'));
  assert.ok(!visible.some(item=>/indoor-map|handle_map/.test(item.url)));
});
test('shared navigation ignores hidden entries, orders its groups and preserves map context',()=>{
  assert.deepEqual(navigationGroups([{id:'hidden',group:'workspace',visible:false},{id:'b',group:'resources',visible:true,order:2},{id:'a',group:'workspace',visible:true,order:1}]).map(group=>group.items[0].id),['a','b']);
  assert.equal(withMap('/ui/map-resources.html','12'),'/ui/map-resources.html?mapId=12');
  assert.equal(withMap('/ui/map-resources.html?tab=plans#detail',12),'/ui/map-resources.html?tab=plans&mapId=12#detail');
  assert.equal(withMap('/ui/radar-settings.html',12),'/ui/radar-settings.html');
  assert.equal(withMap('/ui/map-resources.html','invalid'),'/ui/map-resources.html');
});
