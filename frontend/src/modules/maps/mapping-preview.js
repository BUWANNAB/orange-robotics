(function(root){
  function currentPose(meta,elapsed=0){
    const p=meta?.pose;
    return elapsed>=0&&elapsed<1500&&meta?.mapping_active&&Number.isFinite(meta.age_seconds)&&meta.age_seconds+elapsed/1000<3&&meta.age_seconds>=0&&p&&p.frame_id===meta.frame_id&&Number.isFinite(p.age_seconds)&&p.age_seconds>=0&&p.age_seconds+elapsed/1000<1.5&&[p.x,p.y,p.yaw].every(Number.isFinite)?p:null;
  }
  function project(point,meta,width,height){
    const w=meta.width*meta.resolution,h=meta.height*meta.resolution,scale=Math.min((width-40)/w,(height-40)/h),o=meta.origin;
    const dx=point.x-o.x,dy=point.y-o.y,c=Math.cos(o.yaw||0),s=Math.sin(o.yaw||0);
    return {x:(width-w*scale)/2+(c*dx+s*dy)*scale,y:(height+h*scale)/2-(-s*dx+c*dy)*scale,scale};
  }
  if(typeof module!=='undefined'){module.exports={currentPose,project};return;}
  let wanted=false,timer,host,canvas,status,info,image,meta,sequence=-1,request=0,loading=false,receivedAt=0;
  const api=()=>root.OpsAPI;
  function stop(){wanted=false;request++;clearInterval(timer);timer=null;host?.remove();host=null;canvas=null;image=null;meta=null;sequence=-1;}
  function ensureHost(){
    const target=document.querySelector('.map-center-panel');if(!target)return false;
    if(host?.parentElement===target)return true;
    host?.remove();host=document.createElement('section');host.className='mapping-main-preview';host.setAttribute('aria-label','主画布实时建图');
    host.innerHTML='<header><strong>实时二维建图</strong><span role="status"></span><button type="button" data-mapping-settings>建图设置</button><button type="button" data-mapping-close>返回路线画布</button></header><canvas aria-label="实时建图与车体位置"></canvas><p></p>';
    target.append(host);canvas=host.querySelector('canvas');status=host.querySelector('header span');info=host.querySelector('p');
    host.querySelector('[data-mapping-close]').onclick=()=>{stop();parent.postMessage({type:'workbench-mapping-preview-closed'},location.origin);};
    host.querySelector('[data-mapping-settings]').onclick=()=>parent.postMessage({type:'workbench-open-drawer',tab:'build'},location.origin);
    return true;
  }
  function draw(){
    if(!canvas)return;const rect=canvas.getBoundingClientRect(),width=rect.width,height=rect.height;if(!width||!height)return;
    const ratio=devicePixelRatio||1;canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.fillStyle='#f7f9fc';ctx.fillRect(0,0,width,height);
    if(!image||!meta?.available){ctx.fillStyle='#5f7085';ctx.font='14px Microsoft YaHei';ctx.textAlign='center';ctx.fillText('开始采集后，二维地图会随人工推行逐步展开',width/2,height/2);return;}
    const scale=Math.min((width-40)/(meta.width*meta.resolution),(height-40)/(meta.height*meta.resolution)),w=meta.width*meta.resolution*scale,h=meta.height*meta.resolution*scale;
    ctx.imageSmoothingEnabled=false;ctx.drawImage(image,(width-w)/2,(height-h)/2,w,h);
    const p=currentPose(meta,performance.now()-receivedAt);if(meta.pose&&!p)info.textContent='车体位置已过期，已隐藏；最后一帧地图仅供查看。';if(p){const screen=project(p,meta,width,height);ctx.save();ctx.translate(screen.x,screen.y);ctx.rotate(-(p.yaw-(meta.origin.yaw||0)));ctx.fillStyle='#c56a29';ctx.strokeStyle='#283b52';ctx.lineWidth=2;ctx.fillRect(-14,-8,28,16);ctx.strokeRect(-14,-8,28,16);ctx.fillStyle='#283b52';ctx.beginPath();ctx.moveTo(23,0);ctx.lineTo(15,-5);ctx.lineTo(15,5);ctx.closePath();ctx.fill();ctx.restore();}
  }
  async function tick(){
    if(!wanted||loading||document.hidden||!ensureHost())return;loading=true;const id=request;
    try{
      const next=await api().get('/api/map-workbench/live-grid');let nextImage=image;
      if(!next.available)nextImage=null;
      else if(next.sequence!==sequence||!image){const blob=await api().download('/api/map-workbench/live-grid.png?sequence='+encodeURIComponent(next.sequence)),url=URL.createObjectURL(blob),candidate=new Image();try{candidate.src=url;await candidate.decode();nextImage=candidate;}finally{URL.revokeObjectURL(url);}}
      if(!wanted||id!==request)return;
      meta=next;receivedAt=performance.now();image=nextImage;sequence=next.sequence;
      status.textContent=next.status||'等待建图点云';const p=currentPose(next);
      info.textContent=(next.available?`${next.width} × ${next.height} 格 · ${next.resolution} m/格 · ${next.frame_id} · `:'')+(p?`建图车位 X ${p.x.toFixed(2)} / Y ${p.y.toFixed(2)} m`:'车体位置未确认；不显示旧车位')+'；此图为实时占用预览，保存处理后生成导航地图。';draw();
    }catch(error){if(wanted&&id===request&&status){status.textContent='实时数据暂不可用';info.textContent='连接断流，隐藏车体位置；最后一帧地图仅供查看。';if(meta)meta={...meta,pose:null};draw();}}
    finally{loading=false;}
  }
  function start(){wanted=true;if(!timer)timer=setInterval(()=>{draw();tick();},1000);tick();}
  root.OrangeMappingPreview={start,stop,refresh:tick};addEventListener('resize',draw);addEventListener('pagehide',stop);addEventListener('visibilitychange',()=>{if(!document.hidden&&wanted){draw();tick();}});
})(typeof window!=='undefined'?window:globalThis);
