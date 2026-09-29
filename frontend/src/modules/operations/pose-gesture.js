(function(root){
  function world(point,view){return {x:view.cx+(point.x-view.w/2)/view.scale,y:view.cy-(point.y-view.h/2)/view.scale};}
  function estimate(start,end,view){
    if(Math.hypot(end.x-start.x,end.y-start.y)<8)return null;
    const a=world(start,view),b=world(end,view);
    return {...a,yaw:Math.atan2(b.y-a.y,b.x-a.x)};
  }
  const api={world,estimate};
  if(typeof module==='object')module.exports=api;else root.PoseGesture=api;
})(typeof window==='undefined'?globalThis:window);
