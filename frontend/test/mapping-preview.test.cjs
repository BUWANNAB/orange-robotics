const test=require('node:test'),assert=require('node:assert/strict');
const {currentPose,project}=require('../src/modules/maps/mapping-preview.js');
const meta={mapping_active:true,age_seconds:.2,frame_id:'odom',pose:{x:2,y:3,yaw:.5,frame_id:'odom',age_seconds:.1},width:100,height:100,resolution:.1,origin:{x:0,y:0,yaw:0}};
test('mapping pose requires a fresh grid and a matching fresh TF, including local delivery age',()=>{
  assert.equal(currentPose(meta),meta.pose);
  for(const changed of [{mapping_active:false},{age_seconds:4},{age_seconds:null},{pose:{...meta.pose,frame_id:'map'}},{pose:{...meta.pose,age_seconds:2}},{pose:{...meta.pose,x:NaN}}])assert.equal(currentPose({...meta,...changed}),null);
  assert.equal(currentPose(meta,1600),null);
  assert.equal(currentPose({...meta,pose:{...meta.pose,age_seconds:1.4}},200),null);
});
test('live grid projection uses ROS positive Y and respects a rotated grid origin',()=>{
  const origin=project({x:0,y:0},meta,240,240),up=project({x:0,y:1},meta,240,240);
  assert.ok(up.y<origin.y);assert.equal(up.x,origin.x);
  const rotated={...meta,origin:{x:2,y:3,yaw:Math.PI/2}};
  const a=project({x:2,y:3},rotated,240,240),b=project({x:2,y:4},rotated,240,240);
  assert.ok(b.x>a.x);assert.ok(Math.abs(a.y-b.y)<1e-8);
});
