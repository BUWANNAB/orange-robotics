const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const consoleUI=require('../src/modules/operations/rcs-console.js');
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const row={id:3,name:'验证地图',revision:2,published_version:1};
const markup=(options={})=>consoleUI.render({row,maps:[row],can:()=>true,escape,taskModes:'<div class="task-mode-switch"></div>',...options});

test('handbook layout preserves unique live-map, mission, layer and property hooks',()=>{
  const html=markup();
  const ids=['map-editor','map-canvas','map-switch','map-area-kind','map-save-state','map-tool-hint','map-measure-result','map-point-search','map-point-list','map-path-list','map-point-count','map-path-count','point-properties','map-issues','map-task-list','map-task-count','map-mission-plans','map-mission-runs','map-mission-execution','map-task-active','map-task-state','map-robot-card','map-robot-state','map-ros-chip','map-loc-chip','map-live-status','map-pose-readout','map-plc-readout','map-lock-readout','map-nav-readout'];
  for(const id of ids)assert.equal(html.split(`id="${id}"`).length-1,1,id);
  for(const layer of ['background','paths','stations','areas','coordinates','liveRoute','liveTrail','liveRobot'])assert.match(html,new RegExp(`data-map-layer="${layer}"`));
  assert.ok(html.indexOf('任务执行')<html.indexOf('id="map-object-inspector"'));
  assert.match(html,/id="map-object-inspector"[^>]*>/);
  assert.match(html,/<details\b[^>]*\bopen\b[^>]*id="map-object-inspector"/);
});

test('empty workspace retains the console and disables tools requiring a map',()=>{
  const html=markup({empty:true,maps:[]});
  assert.match(html,/rcs-console-empty/);
  assert.match(html,/从已有 PGM 创建路线地图/);
  assert.match(html,/data-action="tool-point"[^>]*disabled/);
  assert.match(html,/data-action="map-publish"[^>]*disabled/);
  assert.doesNotMatch(html,/data-action="workbench-build"[^>]*disabled/);
  assert.doesNotMatch(html,/data-action="open-pgm-map"[^>]*disabled/);
  assert.doesNotMatch(html,/93分钟|定位正常|ROS 已连接/);
});

test('function colors retain accessible names and remove unauthorized publish actions',()=>{
  const html=markup({can:permission=>permission!=='map:publish'});
  assert.doesNotMatch(html,/data-action="map-publish"/);
  assert.match(html,/data-action="workbench-build" data-tone="teal"/);
  assert.match(html,/data-action="tool-point" data-tone="violet"/);
  assert.match(html,/data-action="tool-relocalize" data-tone="red"/);
  assert.match(html,/aria-label="放大地图"/);
  assert.match(markup({row:{...row,name:'<img onerror=bad>'},maps:[]}),/&lt;img onerror=bad&gt;/);
  const viewer=markup({can:permission=>permission==='map:view'});
  assert.doesNotMatch(viewer,/data-action="workbench-build"/);
  assert.doesNotMatch(viewer,/data-action="tool-point"/);
  assert.doesNotMatch(viewer,/data-action="tool-relocalize"/);
});

test('online and localization colors require fresh real data for the selected map',()=>{
  const live={connected:true,matched:true,localization:{source:'ros',valid:true}};
  assert.equal(consoleUI.connectionState(live).localizationValid,true);
  for(const overrides of [{connected:false},{matched:false},{localization:{source:'simulation',valid:true}},{localization:{source:'ros',valid:false}}])assert.equal(consoleUI.connectionState({...live,...overrides}).localizationValid,false);
  assert.equal(consoleUI.connectionState({}).connected,false);
});

test('console dependencies load before operations and do not force a green offline ROS badge',()=>{
  const html=fs.readFileSync('frontend/operations.html','utf8');
  assert.ok(html.indexOf('rcs-console.js')<html.indexOf('operations/operations.js'));
  assert.ok(html.indexOf('rcs-console.css')>html.indexOf('operations/operations.css'));
  const css=fs.readFileSync('frontend/src/modules/operations/operations.css','utf8');
  assert.doesNotMatch(css,/\.map-status-brand:has\(/);
});

function navigationHarness(failSave=false){
  const nodes=new Map(),writes=[],window={top:{location:{href:'map-workbench.html'}}};
  const element=id=>{
    if(!nodes.has(id)){
      const classes=new Set();
      nodes.set(id,{textContent:'',innerHTML:'',classList:{toggle:(name,value)=>value?classes.add(name):classes.delete(name),contains:name=>classes.has(name)}});
    }
    return nodes.get(id);
  };
  window.OpsAPI={post:async(path,body)=>{writes.push({path,body});if(failSave)throw new Error('保存失败');return {id:3,revision:3,published_version:1,draft:body.document};}};
  const source=fs.readFileSync('frontend/src/modules/operations/operations.js','utf8');
  const functions=source.slice(0,source.indexOf("  $('nav').onclick="))+'window.testConsole={state,action,renderMapTasks};})();';
  vm.runInNewContext(functions,{window,document:{getElementById:element,querySelectorAll:()=>[]},location:{search:''},URLSearchParams,structuredClone,clearTimeout,Set,Map,Date,Math});
  const controller=window.testConsole;
  Object.assign(controller.state,{map:{document:{points:[],paths:[],areas:[]}},mapRow:{id:3,revision:2},dirty:true,permissions:['*']});
  return {window,controller,element,writes};
}

test('opening operations saves the current draft before navigation and stays put if save fails',async()=>{
  const good=navigationHarness();
  await good.controller.action('map-open-operations');
  assert.equal(good.writes[0].path,'/api/maps/3/draft/save');
  assert.equal(good.window.top.location.href,'operations.html#dashboard');
  const failed=navigationHarness(true);
  await assert.rejects(()=>failed.controller.action('map-open-operations'),/保存失败/);
  assert.equal(failed.window.top.location.href,'map-workbench.html');
});

test('standalone map navigation saves and opens the full shell with its current map',async()=>{
  const h=navigationHarness();
  h.window.top=h.window;h.window.location={href:'operations.html'};
  await h.controller.action('map-open-navigation');
  assert.equal(h.writes[0].path,'/api/maps/3/draft/save');
  assert.equal(h.window.location.href,'index.html?navigation=open&mapId=3');
  const failed=navigationHarness(true);
  failed.window.top=failed.window;failed.window.location={href:'operations.html'};
  await assert.rejects(()=>failed.controller.action('map-open-navigation'),/保存失败/);
  assert.equal(failed.window.location.href,'operations.html');
});

test('embedded map navigation toggles the shell without leaving the editor',async()=>{
  const h=navigationHarness(),messages=[];
  h.window.top.postMessage=(message,origin)=>messages.push({message,origin});
  await h.controller.action('map-open-navigation');
  assert.equal(messages[0].message.type,'orange-toggle-navigation');
  assert.equal(h.writes.length,0);
  assert.equal(h.window.top.location.href,'map-workbench.html');
});

test('opening resource details saves the draft and carries the selected map and point',async()=>{
  const h=navigationHarness();
  h.controller.state.map.selected=0;h.controller.state.map.document.points=[{code:'A',uid:'point-a'}];
  await h.controller.action('map-open-resources');
  assert.equal(h.writes[0].path,'/api/maps/3/draft/save');
  assert.equal(h.window.top.location.href,'map-resources.html?mapId=3&tab=points&uid=point-a&point=A');
  const failed=navigationHarness(true);
  await assert.rejects(()=>failed.controller.action('map-open-resources'),/保存失败/);
  assert.equal(failed.window.top.location.href,'map-workbench.html');
});

test('an active single task marks the execution panel as active instead of showing idle controls',()=>{
  const h=navigationHarness();
  h.controller.state.mapTasks=[{id:8,map_id:3,name:'单次任务',status:'running',from_point:'LM1',to_point:'LM2'}];
  h.controller.renderMapTasks();
  assert.equal(h.element('map-task-active').classList.contains('has-active-task'),true);
  h.controller.state.mapTasks=[];h.controller.renderMapTasks();
  assert.equal(h.element('map-task-active').classList.contains('has-active-task'),false);
});

test('deleting a selection keeps its button disabled until another object is selected',async()=>{
  const source=fs.readFileSync('frontend/src/modules/operations/operations.js','utf8');
  const delegatedClick=source.split('\n').find(line=>line.includes("document.addEventListener('click',async event"));
  const map={selected:0,shape:null},target={disabled:false,dataset:{action:'map-remove'}};
  let click,calls=0;
  vm.runInNewContext(delegatedClick,{
    document:{addEventListener:(_type,listener)=>{click=listener;}},state:{map},
    action:async()=>{calls++;map.selected=null;},notify:()=>{}
  });
  const event={target:{closest:()=>target}};
  await click(event);
  assert.equal(target.disabled,true);
  await click(event);
  assert.equal(calls,1,'disabled actions are ignored');
});


test('map tools and layers are docked and visible without opening popover menus',()=>{
  const html=markup();
  assert.match(html,/docked-console/);
  assert.doesNotMatch(html,/rcs-menu-panel|rcs-tool-menu/);
  assert.match(html,/map-layers-section/);
  assert.match(html,/map-edit-section/);
  assert.match(html,/<\/div><div class="map-view-toolbar"><div class="rcs-view-controls"/);
  for(const action of ['tool-select','tool-curve','tool-area','map-undo','map-redo','tool-measure'])
    assert.match(html,new RegExp(`data-action="${action}"`));
});
