(function(root){
  const names={idle:'无任务',sending:'等待接收',accepted:'路线已接收',running:'执行中',success:'已完成',cancelled:'已取消',failed:'执行失败'};
  function view(frame,mapId,now,lastMessage){
    const fresh=now-lastMessage<2000, loc=frame?.localization;
    const matched=frame?.switch?.status==='ready' && Number(frame.switch.map_id)===Number(mapId);
    const nav=frame?.navigation||{}, route=matched&&nav.map_id===frame.switch.map_id&&nav.version===frame.switch.version&&nav.key===frame.switch.key?nav:null;
    return {matched,pose:matched&&fresh&&loc?.valid&&loc.source==='ros'?frame.position:null,
      route,progress:route&&fresh&&((nav.status==='running'&&nav.progress_fresh&&Number.isInteger(nav.target_index)&&nav.target_index>=0)||nav.status==='success'),
      text:!fresh?'实时连接断流，隐藏车位':!matched?'当前地图未绑定到已确认的 ROS 定位地图，隐藏车辆和执行线路':
        `${loc?.source==='simulation'?'仿真模式':loc?.valid?'实时定位有效':'定位无效，隐藏车位'} · 定位版本 v${frame.switch.version} · ${names[nav.status]||'未知任务状态'}${nav.status==='running'&&(!nav.progress_fresh||nav.target_index<0)?' · 路段进度未知（反馈过期或正在避障）':''}`};
  }
  class LiveMap {
    constructor(editor,mapId,status){
      this.editor=editor;this.mapId=mapId;this.status=status;this.trail=[];this.lastMessage=0;this.closed=false;
      this.timer=setInterval(()=>this.refresh(),500);this.connect();
    }
    connect(){
      if(this.closed)return;
      const socket=this.socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/api/localization/ws`);
      socket.onopen=()=>socket.send(JSON.stringify({token:localStorage.getItem('token')||''}));
      socket.onmessage=e=>{try{this.frame=JSON.parse(e.data);this.lastMessage=Date.now();this.refresh();}catch{this.status.textContent='实时数据格式错误';}};
      socket.onerror=()=>socket.close();socket.onclose=()=>{if(!this.closed)this.retry=setTimeout(()=>this.connect(),2000);};
    }
    refresh(){
      const data=view(this.frame,this.mapId,Date.now(),this.lastMessage), key=this.frame?.switch?.key;
      if(key!==this.key||!data.pose){this.trail=[];this.key=key;}
      if(data.pose){const p={x:data.pose.LocalX,y:data.pose.LocalY}, last=this.trail.at(-1);if(!last||Math.hypot(last.x-p.x,last.y-p.y)>.03){this.trail.push(p);if(this.trail.length>1200)this.trail.shift();}}
      this.status.textContent=data.text;this.editor.live={...data,trail:this.trail};this.editor.draw();
    }
    destroy(){this.closed=true;clearInterval(this.timer);clearTimeout(this.retry);this.socket?.close();}
  }
  function draw(editor){
    const live=editor.live;if(!live)return;
    const ctx=editor.ctx,points=live.route?.points||[];
    function line(a,b,color,width,dash=[]){a=editor.screen(a);b=editor.screen(b);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    ctx.save();
    for(let i=1;i<points.length;i++){
      const completed=live.progress&&(live.route.status==='success'||i<live.route.target_index);
      line(points[i-1],points[i],completed?'#23996d':live.progress?'#ed8b25':'#8974ae',3,live.progress?[]:[7,5]);
    }
    for(let i=1;i<live.trail.length;i++)line(live.trail[i-1],live.trail[i],'#168aab',2);
    ctx.setLineDash([]);
    if(live.pose){const p=editor.screen({x:live.pose.LocalX,y:live.pose.LocalY});ctx.translate(p.x,p.y);ctx.rotate(-live.pose.Heading*Math.PI/180);ctx.fillStyle='#df5728';ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(17,0);ctx.lineTo(-11,-10);ctx.lineTo(-6,0);ctx.lineTo(-11,10);ctx.closePath();ctx.fill();ctx.stroke();}
    ctx.restore();
  }
  if(typeof module==='object')module.exports={view};
  else {root.LiveMap=LiveMap;root.drawLiveMap=draw;}
})(typeof window==='undefined'?globalThis:window);
