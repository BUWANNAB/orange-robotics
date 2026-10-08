(function(root){
  function world(point,view){
    const dx=point.x-view.w/2,dy=point.y-view.h/2,cos=Math.cos(view.rotation||0),sin=Math.sin(view.rotation||0);
    const x=cos*dx+sin*dy,y=-sin*dx+cos*dy;
    return {x:view.cx+x/view.scale,y:view.cy-y/view.scale};
  }
  function estimate(start,end,view){
    if(Math.hypot(end.x-start.x,end.y-start.y)<8)return null;
    const a=world(start,view),b=world(end,view);
    return {...a,yaw:Math.atan2(b.y-a.y,b.x-a.x)};
  }
  const api={world,estimate};
  if(typeof module==='object')module.exports=api;else root.PoseGesture=api;
})(typeof window==='undefined'?globalThis:window);
