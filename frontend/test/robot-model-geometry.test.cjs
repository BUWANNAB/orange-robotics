const test=require('node:test');
const assert=require('node:assert/strict');
const geometry=require('../src/modules/operations/robot-model-geometry.js');
const model={dimensions_confirmed:false,body:{length:1.2,width:.8,height:.45,center_x:.3,center_y:0,center_z:.225}};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);

test('base X is forward and base Y is left after a positive 90-degree map yaw',()=>{
  const pose={LocalX:10,LocalY:20,Heading:90};
  let point=geometry.baseToMap({x:1,y:0},pose);close(point.x,10);close(point.y,21);
  point=geometry.baseToMap({x:0,y:1},pose);close(point.x,9);close(point.y,20);
});

test('body center offset rotates around base_link without moving its origin',()=>{
  const pose={LocalX:10,LocalY:20,Heading:90},outline=geometry.footprint(model).map(p=>geometry.baseToMap(p,pose));
  close(outline.reduce((sum,p)=>sum+p.x,0)/4,10);
  close(outline.reduce((sum,p)=>sum+p.y,0)/4,20.3);
  assert.deepEqual(geometry.baseToMap({x:0,y:0},pose),{x:10,y:20});
  close(Math.hypot(outline[1].x-outline[0].x,outline[1].y-outline[0].y),1.2);
});

test('map model and lidar lever arm use metre geometry with only the canvas Y reflection',()=>{
  const arcs=[],labels=[];
  const ctx={save(){},restore(){},setLineDash(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},stroke(){},
    arc(...values){arcs.push(values);},fillText(text){labels.push(text);}};
  const editor={ctx,screen:p=>({x:p.x*10,y:-p.y*10})};
  const pose={LocalX:10,LocalY:20,Heading:90};
  const result=geometry.drawMap(editor,pose,{model,mount:{translation:[-.5,0,1.07],axes:[[0,-1,0]]}});
  assert.equal(result,true);
  const lidar=arcs.find(values=>values[2]===4);close(lidar[0],100);close(lidar[1],-195);
  assert.ok(labels.some(label=>label.includes('示意')));
  assert.deepEqual(pose,{LocalX:10,LocalY:20,Heading:90});
});

test('missing model retains the old position marker and invalid poses are rejected',()=>{
  assert.equal(geometry.drawMap({}, {}, null),false);
  assert.throws(()=>geometry.baseToMap({x:0,y:0},{LocalX:0,LocalY:0,Heading:NaN}));
});
