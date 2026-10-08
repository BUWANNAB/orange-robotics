(function () {
  const $ = id => document.getElementById(id), api = window.OpsAPI;
  const canvas = $('pose-map'), ctx = canvas.getContext('2d');
  let socket, retry, closed = false, lastMessage = 0, frame, trail = [], maps = [], documentMap, background, imageURL;
  let following = true, activeKey, selectedKey, mapGeneration = 0, viewRotation = 0;
  let picking=false, gesture=null, candidate=null, view=null, submitting=false;
  function confirmedMap(key){
    const entry=maps.find(m=>m.key===key),active=frame?.switch;
    return !!entry&&active?.status==='ready'&&active.key===key&&(active.map_id??null)===(entry.map_id??null)&&(active.version??null)===(entry.version??null);
  }
  function cancelPick(){picking=false;gesture=null;candidate=null;canvas.style.cursor='';$('pick-pose').setAttribute('aria-pressed','false');$('pick-hint').textContent='点击“拖拽重定位”，在地图上按下选位置，拖动箭头选朝向。';draw();}
  const names = {idle:'未切换',pending:'等待处理',loading:'加载地图',loaded:'地图已加载',localizing:'等待定位收敛',ready:'新地图定位已收敛',failed:'切换失败',timeout:'超时'};
  function draw() {
    const box = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    canvas.width = box.width*dpr; canvas.height = box.height*dpr; ctx.scale(dpr,dpr);
    const w=box.width, h=box.height, map=documentMap;
    const p=map && !confirmedMap(selectedKey) ? null : frame?.position;
    const cx=following&&p?p.LocalX:map?(map.center_x??map.origin_x+map.width/2):0;
    const cy=following&&p?p.LocalY:map?(map.center_y??map.origin_y+map.height/2):0;
    const rotation=viewRotation*Math.PI/180,cos=Math.abs(Math.cos(rotation)),sin=Math.abs(Math.sin(rotation));
    const extentX=map?(map.extent_x||map.width):25,extentY=map?(map.extent_y||map.height):25;
    const rotatedWidth=cos*extentX+sin*extentY,rotatedHeight=sin*extentX+cos*extentY;
    const scale=following?Math.min(w,h)/25:map?Math.min(w/rotatedWidth,h/rotatedHeight)*.9:20;
    view={w,h,cx,cy,scale,rotation};
    $('pick-pose').disabled=!map||!selectedKey;
    const xy=(x,y)=>[w/2+(x-cx)*scale,h/2-(y-cy)*scale];
    const step=Math.max(1,Math.ceil(35/scale));
    const rangeX=(cos*w+sin*h)/(2*scale),rangeY=(sin*w+cos*h)/(2*scale);
    ctx.save();ctx.translate(w/2,h/2);ctx.rotate(rotation);ctx.translate(-w/2,-h/2);
    if(map&&background){ctx.save();ctx.translate(...xy(map.origin_x,map.origin_y));ctx.rotate(-(map.yaw||0));ctx.drawImage(background,0,-map.height*scale,map.width*scale,map.height*scale);ctx.restore();}
    ctx.strokeStyle='#dfe8ee';ctx.lineWidth=1;
    for(let x=Math.floor((cx-rangeX)/step)*step;x<=cx+rangeX;x+=step){const a=xy(x,cy-rangeY),b=xy(x,cy+rangeY);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}
    for(let y=Math.floor((cy-rangeY)/step)*step;y<=cy+rangeY;y+=step){const a=xy(cx-rangeX,y),b=xy(cx+rangeX,y);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();}
    if(map){
      const pts=Object.fromEntries(map.points.map(v=>[v.code,v]));
      ctx.strokeStyle='#8095a8';ctx.lineWidth=2;
      for(const edge of map.paths){const a=pts[edge.start],b=pts[edge.end];if(!a||!b)continue;ctx.beginPath();ctx.moveTo(...xy(a.x,a.y));ctx.lineTo(...xy(b.x,b.y));ctx.stroke();}
      for(const point of map.points){const a=xy(point.x,point.y);ctx.fillStyle='#476074';ctx.beginPath();ctx.arc(...a,4,0,Math.PI*2);ctx.fill();ctx.fillText(point.code,a[0]+7,a[1]-6);}
    }
    ctx.strokeStyle='#168887';ctx.lineWidth=2;ctx.beginPath();(p?trail:[]).forEach((v,i)=>i?ctx.lineTo(...xy(...v)):ctx.moveTo(...xy(...v)));ctx.stroke();
    if(p){const a=xy(p.LocalX,p.LocalY);ctx.save();ctx.translate(...a);ctx.rotate(-p.Heading*Math.PI/180);ctx.fillStyle=frame.localization?.valid?'#ee791f':'#8897a2';ctx.beginPath();ctx.moveTo(15,0);ctx.lineTo(-10,-9);ctx.lineTo(-6,0);ctx.lineTo(-10,9);ctx.closePath();ctx.fill();ctx.restore();}
    if(candidate){
      const a=xy(candidate.x,candidate.y),angle=-candidate.yaw;
      ctx.save();ctx.translate(...a);ctx.rotate(angle);ctx.strokeStyle='#ad3dcc';ctx.fillStyle='#ad3dcc';ctx.lineWidth=3;
      ctx.beginPath();ctx.arc(0,0,6,0,2*Math.PI);ctx.stroke();ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(55,0);ctx.lineTo(43,-7);ctx.moveTo(55,0);ctx.lineTo(43,7);ctx.stroke();ctx.restore();
      ctx.fillStyle='#84239f';ctx.fillText('待确认初始位姿',a[0]+12,a[1]+22);
    }
    ctx.restore();
    const directions={0:'ROS +X 向右 / +Y 向上',90:'ROS +X 向下 / +Y 向右',180:'ROS +X 向左 / +Y 向下',270:'ROS +X 向上 / +Y 向左'};
    ctx.fillStyle='#62778a';ctx.font='12px Microsoft YaHei, sans-serif';ctx.fillText(`网格 ${step} m · ${directions[viewRotation]}`,12,h-12);
  }
  function setViewRotation(degrees){
    if(gesture||picking)cancelPick();
    viewRotation=(degrees+360)%360;$('map-rotation').textContent=`${viewRotation}°`;draw();
  }
  function apply(value){
    frame=value;lastMessage=Date.now();
    const loc=value.localization,p=value.position;
    $('source').textContent={ros:'真实 ROS',simulation:'仿真演示',disconnected:'ROS 未连接'}[loc.source]||'未知来源';
    $('pose-status').textContent=loc.source==='simulation'?'仿真轨迹，不是真实定位':loc.valid?'实时定位有效':loc.fresh?'位姿已到达，定位质量未通过':'定位无数据或已过期';
    $('pose-status').className='state'+(loc.valid&&loc.source==='ros'?' good':'');
    $('xy').textContent=`X ${p.LocalX.toFixed(3)} m / Y ${p.LocalY.toFixed(3)} m`;
    $('heading').textContent=`朝向 ${p.Heading.toFixed(1)}°`;
    $('quality').textContent=`匹配分数 ${loc.fitness??'—'}`;
    $('age').textContent=`数据年龄 ${loc.age_seconds===null?'—':loc.age_seconds.toFixed(1)+' s'}`;
    $('switch-state').textContent=`切换：${names[value.switch.status]||value.switch.status} · ${value.inhibited?'停止锁定':'未锁定'}`;
    const autoBusy=['pending','collecting','searching','candidate','verifying'].includes(value.relocalization?.status);
    const busy=autoBusy||['pending','searching','loading','loaded','localizing'].includes(value.switch.status);
    $('auto-pose').disabled=busy||!value.auto_available||loc.source!=='ros';
    $('auto-cancel').disabled=!autoBusy;
    $('auto-state').textContent=value.relocalization?.message||(!value.auto_available?'自动重定位节点未连接 / 当前为仿真':'自动重定位已就绪，需先选择地图并停车');
    $('switch-button').disabled=picking||submitting||busy||loc.source!=='ros';
    $('release-button').disabled=busy||!loc.valid||loc.source!=='ros';
    if(value.switch.message&&value.switch.status==='failed')$('message').textContent=value.switch.message;
    if(value.switch.status==='ready'&&value.switch.key&&activeKey!==value.switch.key){activeKey=value.switch.key;trail=[];if(!selectedKey)$('map-key').value=activeKey;loadMap(selectedKey||activeKey);}
    if(loc.fresh){const last=trail[trail.length-1];if(!last||Math.hypot(last[0]-p.LocalX,last[1]-p.LocalY)>.02){trail.push([p.LocalX,p.LocalY]);if(trail.length>600)trail.shift();}}
    draw();
  }
  function connect(){
    if(closed)return;
    socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/api/localization/ws`);
    socket.onopen=()=>socket.send(JSON.stringify({token:localStorage.getItem('token')||''}));
    socket.onmessage=e=>{try{apply(JSON.parse(e.data));}catch(error){$('message').textContent=error.message;}};
    socket.onerror=()=>socket.close();socket.onclose=()=>{if(!closed)retry=setTimeout(connect,2000);};
  }
  async function loadMap(key){
    const generation=++mapGeneration;selectedKey=key;documentMap=null;background=null;viewRotation=0;$('map-rotation').textContent='0°';
    cancelPick();
    if(imageURL)URL.revokeObjectURL(imageURL);
    const entry=maps.find(m=>m.key===key);draw();
    $('map-caption').textContent='坐标网格（米）；此 PCD 尚无可显示的栅格。';
    if(!entry)return;
    if(!entry.map_id||!entry.version){
      try{
        const assets=await api.get('/api/map-workbench/assets');
        const asset=assets.find(row=>row.id===entry.asset_id&&row.grid);
        if(!asset)return;
        const blob=await api.download('/api/map-workbench/file/pgm/'+encodeURIComponent(asset.id));
        const raster=window.MapRaster.decode(await blob.arrayBuffer());if(generation!==mapGeneration)return;
        const [x,y,yaw]=asset.origin,resolution=Number(asset.resolution);
        if(![x,y,yaw,resolution].every(Number.isFinite)||resolution<=0)throw Error('地图坐标参数无效');
        const width=raster.width*resolution,height=raster.height*resolution,c=Math.cos(yaw),s=Math.sin(yaw);
        documentMap={width,height,origin_x:x,origin_y:y,yaw,center_x:x+c*width/2-s*height/2,center_y:y+s*width/2+c*height/2,extent_x:Math.abs(c*width)+Math.abs(s*height),extent_y:Math.abs(s*width)+Math.abs(c*height),points:[],paths:[]};
        background=document.createElement('canvas');background.width=raster.width;background.height=raster.height;
        const image=background.getContext('2d').createImageData(raster.width,raster.height);
        window.MapRaster.colorizeInto(raster.pixels,image.data);
        background.getContext('2d').putImageData(image,0,0);following=false;
        $('map-caption').textContent=`${asset.id} · ${resolution} m/像素${!confirmedMap(key)?' · 底图预览，尚未确认定位地图；隐藏车辆叠加':''}`;draw();
      }catch(error){$('message').textContent=error.message;}
      return;
    }
    try{
      const versions=await api.get(`/api/maps/${entry.map_id}/versions`);
      if(generation!==mapGeneration)return;
      documentMap=versions.find(v=>v.version===entry.version)?.document;
      if(!documentMap)throw Error('绑定地图版本不存在');
      following=false;$('map-caption').textContent=`${entry.key} · RDS 地图 #${entry.map_id} v${entry.version}${!confirmedMap(key)?" · 预览，尚未确认加载此版本；隐藏车辆叠加":""}`;
      if(documentMap.image){const blob=await api.download(`/api/maps/${entry.map_id}/image/${documentMap.image}`);if(generation!==mapGeneration)return;imageURL=URL.createObjectURL(blob);const source=new Image();source.onload=()=>{if(generation!==mapGeneration)return;background=document.createElement('canvas');background.width=source.naturalWidth;background.height=source.naturalHeight;const context=background.getContext('2d');context.drawImage(source,0,0);const raster=context.getImageData(0,0,background.width,background.height);window.MapRaster.colorizeImageData(raster);context.putImageData(raster,0,0);draw();};source.onerror=()=>{$('message').textContent='地图底图图片解码失败';};source.src=imageURL;}
      draw();
    }catch(error){$('message').textContent=error.message;}
  }
  async function action(path,data){try{$('message').textContent='正在处理…';await api.post(path,data);$('message').textContent='请求已受理，请查看实时状态。';}catch(error){$('message').textContent=error.message;}}
  $('switch-form').onsubmit=async e=>{
    e.preventDefault();if(picking||submitting||gesture||Date.now()-lastMessage>2000||frame?.localization.source!=='ros')return;
    const data={key:$('map-key').value,x:Number($('pose-x').value),y:Number($('pose-y').value),yaw:Number($('pose-yaw').value)*Math.PI/180};
    if(!confirm(`确认在地图 ${data.key} 重定位？\nX ${data.x.toFixed(3)} m，Y ${data.y.toFixed(3)} m，朝向 ${(data.yaw*180/Math.PI).toFixed(1)}°\n车辆必须已停车；完成后仍保持停止锁定。`))return;
    submitting=true;$('switch-button').disabled=true;
    try{await action('/api/localization/switch',data);}finally{submitting=false;}
  };
  $('pick-pose').onclick=()=>{
    if(picking){cancelPick();return;}if(!documentMap||!selectedKey)return;
    following=false;picking=true;candidate=null;canvas.style.cursor='crosshair';$('pick-pose').setAttribute('aria-pressed','true');
    $('pick-hint').textContent='在地图上按下并拖出箭头；松开后检查坐标，再点击“停车并切换 / 重新定位”。';draw();
  };
  $('cancel-pick').onclick=cancelPick;
  const pixel=e=>{const r=canvas.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
  canvas.addEventListener('pointerdown',e=>{
    if(!picking||e.button!==0||gesture)return;e.preventDefault();
    gesture={start:pixel(e),view:{...view},id:e.pointerId};candidate=null;canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',e=>{
    if(!gesture||gesture.id!==e.pointerId)return;
    candidate=window.PoseGesture.estimate(gesture.start,pixel(e),gesture.view);draw();
  });
  canvas.addEventListener('pointerup',e=>{
    if(!gesture||gesture.id!==e.pointerId)return;
    candidate=window.PoseGesture.estimate(gesture.start,pixel(e),gesture.view);gesture=null;
    if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
    if(!candidate){$('pick-hint').textContent='拖动距离太短，请重新拖出朝向箭头（至少 8 像素）。';draw();return;}
    $('pose-x').value=candidate.x.toFixed(3);$('pose-y').value=candidate.y.toFixed(3);$('pose-yaw').value=(candidate.yaw*180/Math.PI).toFixed(2);
    picking=false;canvas.style.cursor='';$('pick-pose').setAttribute('aria-pressed','false');
    $('pick-hint').textContent=`待确认：X ${$('pose-x').value} m / Y ${$('pose-y').value} m / ${$('pose-yaw').value}°。尚未发送，请点击右侧重定位按钮。`;draw();
  });
  canvas.addEventListener('pointercancel',cancelPick);
  canvas.addEventListener('lostpointercapture',()=>{if(gesture)cancelPick();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')cancelPick();});
  for(const id of ['pose-x','pose-y','pose-yaw'])$(id).addEventListener('input',cancelPick);
  $('auto-pose').onclick=()=>{if(!$('map-key').value){$('message').textContent='请先选择定位地图';return;}cancelPick();action('/api/localization/auto',{key:$('map-key').value});};
  $('auto-cancel').onclick=()=>action('/api/localization/auto/cancel');
  $('stop-button').onclick=()=>action('/api/localization/stop');$('release-button').onclick=()=>action('/api/localization/release');
  $('use-pose').onclick=()=>{cancelPick();if(frame?.localization.fresh){$('pose-x').value=frame.position.LocalX;$('pose-y').value=frame.position.LocalY;$('pose-yaw').value=frame.position.Heading;}};
  $('map-key').onchange=()=>{trail=[];loadMap($('map-key').value);};
  $('rotate-view-left').onclick=()=>setViewRotation(viewRotation-90);
  $('rotate-view-right').onclick=()=>setViewRotation(viewRotation+90);
  $('reset-view-rotation').onclick=()=>setViewRotation(0);
  $('follow').onclick=()=>{cancelPick();following=!following;draw();};$('clear-trail').onclick=()=>{trail=[];draw();};
  window.addEventListener('resize',()=>{if(gesture)cancelPick();else draw();});
  const watchdog=setInterval(()=>{if(Date.now()-lastMessage>2000){$('pose-status').textContent='连接断流，位置仅为最后已知值';$('pose-status').className='state';$('switch-button').disabled=true;$('release-button').disabled=true;$('auto-pose').disabled=true;}},500);
  window.addEventListener('pagehide',()=>{closed=true;clearTimeout(retry);clearInterval(watchdog);socket?.close();if(imageURL)URL.revokeObjectURL(imageURL);});
  api.get('/api/localization/maps').then(rows=>{maps=rows;$('map-key').replaceChildren(...[new Option(rows.length?'请选择地图':'未发现 PCD 地图',''),...rows.map(m=>new Option(m.asset_id||m.key,m.key))]);const asset=new URLSearchParams(location.search).get('asset');const match=asset&&rows.find(m=>m.asset_id===asset);if(asset)$('map-key').disabled=true;if(match){$('map-key').value=match.key;loadMap(match.key);}}).catch(error=>{$('message').textContent=error.message;});
  connect();draw();
})();
