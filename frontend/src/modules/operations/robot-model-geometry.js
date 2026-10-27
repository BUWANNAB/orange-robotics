(function(root){
  function baseToMap(point,pose){
    const x=Number(pose.LocalX),y=Number(pose.LocalY),yaw=Number(pose.Heading)*Math.PI/180;
    if(![x,y,yaw,point.x,point.y].every(Number.isFinite))throw new Error('车体坐标无效');
    return {x:x+Math.cos(yaw)*point.x-Math.sin(yaw)*point.y,
      y:y+Math.sin(yaw)*point.x+Math.cos(yaw)*point.y};
  }
  function footprint(model){
    const b=model.body;
    if(![b.length,b.width,b.center_x,b.center_y].every(Number.isFinite)||b.length<=0||b.width<=0)throw new Error('车体尺寸无效');
    return [[1,1],[-1,1],[-1,-1],[1,-1]].map(([x,y])=>({x:b.center_x+x*b.length/2,y:b.center_y+y*b.width/2}));
  }
  function drawMap(editor,pose,data){
    if(!data?.model)return false;
    const ctx=editor.ctx,model=data.model,points=footprint(model).map(point=>editor.screen(baseToMap(point,pose)));
    const origin=editor.screen(baseToMap({x:0,y:0},pose));
    function line(from,to,color,label){
      const a=editor.screen(baseToMap(from,pose)),b=editor.screen(baseToMap(to,pose));
      ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      const angle=Math.atan2(b.y-a.y,b.x-a.x),size=5;
      ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-size*Math.cos(angle-.5),b.y-size*Math.sin(angle-.5));ctx.lineTo(b.x-size*Math.cos(angle+.5),b.y-size*Math.sin(angle+.5));ctx.closePath();ctx.fill();
      if(label)ctx.fillText(label,b.x+4,b.y-3);
    }
    ctx.save();ctx.setLineDash(model.dimensions_confirmed?[]:[4,3]);
    ctx.fillStyle='#ee7b2633';ctx.strokeStyle='#dd6b21';ctx.lineWidth=2;ctx.beginPath();
    points.forEach((point,index)=>index?ctx.lineTo(point.x,point.y):ctx.moveTo(point.x,point.y));ctx.closePath();ctx.fill();ctx.stroke();ctx.setLineDash([]);
    ctx.font='11px Segoe UI,Microsoft YaHei,sans-serif';
    const axis=Math.max(model.body.length,model.body.width,.5)*.7;
    line({x:0,y:0},{x:axis,y:0},'#d34a40','X 前');line({x:0,y:0},{x:0,y:axis},'#26935a','Y 左');
    ctx.fillStyle='#3478ce';ctx.beginPath();ctx.arc(origin.x,origin.y,3,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#354c61';ctx.fillText('base_link'+(model.dimensions_confirmed?'':' · 示意'),origin.x+7,origin.y+15);
    if(data.mount){
      const [x,y]=data.mount.translation,center=editor.screen(baseToMap({x,y},pose));
      ctx.fillStyle='#354c61';ctx.beginPath();ctx.arc(center.x,center.y,4,0,Math.PI*2);ctx.fill();
      const forward=data.mount.axes?.[0];if(forward)line({x,y},{x:x+forward[0]*.4,y:y+forward[1]*.4},'#354c61');
    }
    ctx.restore();return true;
  }
  const api={baseToMap,footprint,drawMap};
  if(typeof module==='object')module.exports=api;else root.OrangeRobotModel=api;
})(typeof window==='undefined'?globalThis:window);
