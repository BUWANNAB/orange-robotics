const test=require('node:test'),assert=require('node:assert/strict');
const {estimate,world}=require('./pose-gesture.js');
const v={w:800,h:600,cx:12,cy:-4,scale:20};
test('screen pixels map to world metres with y pointing up',()=>{
  assert.deepEqual(world({x:400,y:300},v),{x:12,y:-4});
  assert.deepEqual(world({x:440,y:240},v),{x:14,y:-1});
});
test('drag sets start position and all four ROS yaw directions',()=>{
  const a={x:400,y:300};
  for(const [x,y,yaw] of [[460,300,0],[400,240,Math.PI/2],[340,300,Math.PI],[400,360,-Math.PI/2]]){
    const p=estimate(a,{x,y},v);assert.equal(p.x,12);assert.equal(p.y,-4);assert.equal(p.yaw,yaw);
  }
});
test('click and small drags never produce an accidental heading',()=>{
  assert.equal(estimate({x:0,y:0},{x:0,y:0},v),null);
  assert.equal(estimate({x:0,y:0},{x:5,y:5},v),null);
  assert.ok(estimate({x:0,y:0},{x:8,y:0},v));
});
test('resized viewport and shifted map preserve world coordinates',()=>{
  const p=estimate({x:100,y:150},{x:100,y:110},{w:400,h:300,cx:-50,cy:70,scale:10});
  assert.deepEqual(p,{x:-60,y:70,yaw:Math.PI/2});
});
