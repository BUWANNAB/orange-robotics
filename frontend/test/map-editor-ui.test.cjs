const test=require('node:test'),assert=require('node:assert/strict');
const ui=require('../src/modules/operations/map-editor-ui.js');
const point={code:'P1',name:'收货口',type:'station',x:12.35,y:4.2,theta:Math.PI/2};
test('point inspector locks position until explicitly adjusted and shows degrees',()=>{
  const locked=ui.pointMarkup(point),editing=ui.pointMarkup(point,{moving:true});
  assert.match(locked,/name="point-x"[^>]*readonly/);assert.match(locked,/name="point-heading"[^>]*value="90"/);
  assert.doesNotMatch(editing,/readonly/);assert.match(editing,/map-point-move-cancel/);
  assert.doesNotMatch(ui.pointMarkup(point,{canEdit:false}),/data-action/);
});
test('coordinate form submits metres and converts degrees to ROS radians',()=>{
  const values={'point-code':' P1 ','point-name':' 收货口 ','point-type':'station','point-x':'12.35','point-y':'4.2','point-heading':'90'};
  const box={querySelector:selector=>({value:values[selector.match(/name="([^"]+)"/)[1]]})};
  assert.deepEqual(ui.pointValues(box),point);
  values['point-x']='';assert.throws(()=>ui.pointValues(box),/有效数字/);
  values['point-x']='Infinity';assert.throws(()=>ui.pointValues(box),/有效数字/);
});
test('validation errors remain clickable while escaping map-provided labels',()=>{
  const html=ui.issuesMarkup([{element:'<P1>',message:'<script>bad()</script>'}]);
  assert.match(html,/data-action="map-issue-focus" data-id="0"/);assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;P1&gt;/);
});
test('recovery controls do not claim another maps progress or valid stale coordinates',()=>{
  const pending={connected:true,matched:false,recovery:{map_id:2,status:'searching',message:'搜索中'},localization:{valid:true}};
  assert.equal(ui.recoveryView(pending,1).busy,false);assert.equal(ui.recoveryView(pending,1).cancel,false);
  assert.equal(ui.recoveryView(pending,2).busy,true);assert.equal(ui.recoveryView(pending,2).activate,false);
  const ready=ui.recoveryView({...pending,matched:true},2);assert.equal(ready.label,'定位正常');assert.equal(ready.activate,false);
  assert.notEqual(ui.recoveryView({...pending,matched:true,connected:false},2).label,'定位正常');
});
