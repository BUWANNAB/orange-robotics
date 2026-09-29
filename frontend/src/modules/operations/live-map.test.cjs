const test=require('node:test'),assert=require('node:assert/strict');
const {view}=require('./live-map.js');
const frame=()=>({switch:{status:'ready',map_id:7,version:2,key:'A'},localization:{valid:true,source:'ros'},position:{LocalX:1,LocalY:2,Heading:0},navigation:{id:'job',map_id:7,version:2,key:'A',status:'running',target_index:1,progress_fresh:true,points:[{x:0,y:0},{x:1,y:2}]}});
test('live overlay requires confirmed matching map and real fresh pose',()=>{
  const f=frame();assert.ok(view(f,7,100,90).pose);assert.equal(view(f,8,100,90).route,null);
  assert.equal(view(f,7,3000,90).pose,null);assert.equal(view(f,7,3000,90).progress,false);
  f.localization.source='simulation';assert.equal(view(f,7,100,90).pose,null);
});
test('route version and coordinate map cannot bleed into another overlay',()=>{
  const f=frame();f.navigation.version=1;assert.equal(view(f,7,100,90).route,null);
  f.navigation.version=2;f.navigation.key='B';assert.equal(view(f,7,100,90).route,null);
});
test('old ROS, avoidance and cancellation do not claim completed segments',()=>{
  const f=frame();assert.equal(view(f,7,100,90).progress,true);
  f.navigation.progress_fresh=false;assert.equal(view(f,7,100,90).progress,false);
  f.navigation.progress_fresh=true;f.navigation.target_index=-1;assert.equal(view(f,7,100,90).progress,false);
  f.navigation.target_index=1;f.navigation.status='cancelled';assert.equal(view(f,7,100,90).progress,false);
  f.navigation.status='success';assert.equal(view(f,7,100,90).progress,true);
});
