const $=id=>document.getElementById(id), api=window.OpsAPI, base='/api/map-workbench';
const tabs=['build','point','grid','route','locate'];
const query=new URLSearchParams(location.search),drawerMode=query.get('drawer')==='1';
const requestedTab=location.hash.slice(1),requestedPanel=query.get('panel');
const initialTab=drawerMode&&tabs.includes(requestedPanel)?requestedPanel:tabs.includes(requestedTab)?requestedTab:'route';
let pointAsset=null, selectedAsset='', assets=[], tab='', viewer, viewerModule, generation=0, busy=false, mapping, workflowReturnFocus=null,brushDiameter=.4;
let drawerVisible=true,liveGridMeta=null,liveGridImage=null,liveGridSequence=-1,liveGridRequest=0;
if(drawerMode)document.body.classList.add('drawer-mode');

function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
function confirmCriticalAction(title,message){
  const dialog=$('operation-lock');if(dialog.open)return Promise.resolve(false);
  $('operation-lock-title').textContent=title;$('operation-lock-message').textContent=message;
  $('operation-lock-ack').checked=false;$('operation-lock-confirm').disabled=true;
  $('operation-lock-ack').onchange=()=>{$('operation-lock-confirm').disabled=!$('operation-lock-ack').checked;};
  return new Promise(resolve=>{dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true});dialog.showModal();});
}
function current(){return assets.find(row=>row.id===$('asset').value);}
function openWorkflowDrawer(next,requestedAsset=''){
  if(!['binding','locate','build','point','grid'].includes(next))return;
  const drawer=$('workflow-drawer'),frame=$('workflow-frame'),asset=requestedAsset||$('asset').value;
  workflowReturnFocus=document.activeElement;
  const titles={binding:'地图绑定',locate:'重新定位',build:'实时建图',point:'裁切与坐标原点',grid:'二维地图编辑'};
  $('workflow-title').textContent=titles[next];
  const src=['build','point','grid'].includes(next)
    ?`map-workbench.html?drawer=1&panel=${next}${asset?'&map='+encodeURIComponent(asset):''}&v=comfortable-theme-20261028-1`
    :`${next==='binding'?'map-bindings.html':'localization.html'}?embedded=1${asset?'&asset='+encodeURIComponent(asset):''}`;
  frame.onload=()=>frame.contentWindow?.postMessage({type:'workbench-drawer-visibility',visible:!drawer.hidden},location.origin);
  if(frame.getAttribute('src')!==src)frame.src=src;
  drawer.hidden=false;document.body.classList.add('drawer-open');
  frame.contentWindow?.postMessage({type:'workbench-drawer-visibility',visible:true},location.origin);
  $('workflow-close').focus();
}
function closeWorkflowDrawer(){
  $('workflow-frame').contentWindow?.postMessage({type:'workbench-drawer-visibility',visible:false},location.origin);
  $('workflow-drawer').hidden=true;document.body.classList.remove('drawer-open');
  workflowReturnFocus?.focus();workflowReturnFocus=null;
}
function setBusy(value){busy=value;for(const id of ['process-button','mapping-start','mapping-save','mapping-stop'])$(id).disabled=value;updateMapping();}
function updateHeightPreview(){
  const minValue=$('z-min').value.trim(),maxValue=$('z-max').value.trim(),min=Number(minValue),max=Number(maxValue),status=$('height-preview');
  if(!minValue||!maxValue||!Number.isFinite(min)||!Number.isFinite(max)||min>=max){status.textContent='高度范围无效；请填写数值，并确保最低高度小于最高高度。';status.classList.add('error');return false;}
  status.textContent=`实时预览：显示 ${min} m 至 ${max} m 的点；处理时将使用相同范围。`;status.classList.remove('error');viewer?.setZRange(min,max);return true;
}
function updateOriginPreview(){
  const enabled=$('origin-enabled').checked;
  for(const id of ['origin-x','origin-y','origin-yaw']){$(id).disabled=!enabled;$(id).required=enabled;}
  if(!enabled){viewer?.clearOrigin();$('origin-preview').textContent='未启用坐标变换：输出沿用源地图坐标系。';return true;}
  const x=Number($('origin-x').value),y=Number($('origin-y').value),degrees=Number($('origin-yaw').value);
  if(['origin-x','origin-y','origin-yaw'].some(id=>!$(id).value.trim())||![x,y,degrees].every(Number.isFinite)||Math.abs(x)>1e6||Math.abs(y)>1e6||degrees < -180||degrees > 180){ $('origin-preview').textContent='原点坐标须在 ±1,000,000 m 内，方向须在 -180° 到 180° 之间。';$('origin-preview').classList.add('error');return false; }
  const yaw=degrees*Math.PI/180;
  viewer?.setOrigin({x,y,yaw});
  $('origin-preview').classList.remove('error');$('origin-preview').textContent=`输出原点 (0, 0) 对应源坐标 (${x.toFixed(3)}, ${y.toFixed(3)}) m；新 X 轴方向 ${degrees.toFixed(1)}°。原始地图不变。`;
  return true;
}
function updateBrushDiameter(value=brushDiameter){
  const numeric=Number(value);if(!Number.isFinite(numeric))return;
  brushDiameter=Math.min(2,Math.max(.1,Math.round(numeric*10)/10));
  $('brush-size-value').textContent=`${brushDiameter.toFixed(1)} m`;
  $('brush-size-down').disabled=brushDiameter<=.1;$('brush-size-up').disabled=brushDiameter>=2;
  viewer?.setBrushDiameter(brushDiameter);
}
function resetOrigin(){
  $('origin-enabled').checked=false;
  $('origin-x').value='0';$('origin-y').value='0';$('origin-yaw').value='0';
  updateOriginPreview();
}
function updateMapping(){
  if(!mapping)return;
  const real=mapping.connected&&mapping.source==='ros',lidar=!!mapping.lidar_ready,controller=!!mapping.controller_ready;
  const localizationNodes=(mapping.localization_nodes_active||[]).length>0,navigationNodes=(mapping.navigation_nodes_active||[]).length>0;
  const localizationStopped=mapping.localization_state==='inactive'&&mapping.localization_graph_readable===true&&!localizationNodes;
  const navigationStopped=mapping.navigation_state==='inactive'&&mapping.navigation_graph_readable===true&&!navigationNodes;
  const servicesStopped=localizationStopped&&navigationStopped,confirmed=$('manual-push-confirmed').checked;
  const state=({unknown:'尚无反馈',idle:'空闲',starting:'启动中',mapping:'采集中',map_data_ready:'点云已就绪',saving:'保存中',rviz_livox_started:'雷达已恢复',mapping_stopped:'已停止'})[mapping.status]||mapping.status;
  $('mapping-start').disabled=busy||!real||!lidar||!controller||!servicesStopped||!confirmed||mapping.active;
  $('mapping-save').disabled=busy||!real||!mapping.active;$('mapping-stop').disabled=busy||!real||!mapping.active;
  const localization=localizationNodes?'仍有定位节点运行':localizationStopped?'已停止':mapping.localization_state==='active'?'服务运行中':'状态未知';
  const navigation=navigationNodes?'仍有运动控制节点运行':navigationStopped?'已停止':mapping.navigation_state==='active'?'服务运行中':'状态未知';
  $('mapping-state').textContent=`ROS 桥接：${real?'已连接':'未连接'} · 雷达点云：${lidar?'实时':'无新数据'} · 建图控制器：${controller?'就绪':'未就绪'} · 定位：${localization} · 运动控制：${navigation} · 建图：${state}`;
}
async function refresh(preferred,options={}){
  const previous=options.initial?(preferred||''):(preferred||$('asset').value||localStorage.getItem('map-workbench-last-asset')||localStorage.getItem('lastMapName')||'');assets=await api.get(base+'/assets');
  $('asset').replaceChildren(new Option(assets.length?'请选择地图':'暂无地图',''),...assets.map(a=>new Option(`${a.id}${a.pcd?' · PCD':''}${a.grid?' · PGM':''}`,a.id)));
  const latest=assets.find(asset=>asset.grid)||assets[0];
  const initial=assets.find(asset=>asset.id===previous)||latest;
  if(initial)$('asset').value=initial.id;
  await selected(options);
}
async function selected({render=true}={}){
  const row=current(),key=row?.id||'';
  if(key)localStorage.setItem('map-workbench-last-asset',key);
  if(key!==selectedAsset){selectedAsset=key;pointAsset=null;resetOrigin();document.querySelectorAll('[data-draw]').forEach(button=>button.classList.remove('active'));$('draw-origin').classList.remove('active');$('erase-brush').classList.remove('active');}
  notice(row?'当前地图：'+row.id:'请选择地图，或开始采集新地图。');
  $('asset-detail').textContent=row?`${row.pcd?'定位点云可用':'无 PCD'} · ${row.grid?'路线栅格可用':'无 PGM / YAML'}${row.resolution?' · '+row.resolution+' m/像素':''}`:'同一地图统一管理点云与栅格';
  $('output').value=row?row.id+'_processed':'';
  $('grid-route-action').hidden=!row?.grid;
  if(render)await show(tab||initialTab,true);
}
async function show(next,reload=false){
  if(!tabs.includes(next))next='build';
  if(tab===next&&!reload)return;
  tab=next;history.replaceState(null,'','#'+next);document.body.classList.toggle('route-mode',next==='route'&&!drawerMode);
  document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===next)));
  document.querySelectorAll('.panel').forEach(p=>p.hidden=p.id!=='panel-'+next);
  const row=current(),key=row?.id||'';generation++;const token=generation;
  if(next==='point'){
    try{
      viewerModule ||= import('./point-viewer.js?v=20261024-point-cloud-brush-1');
      const mod=await viewerModule;viewer ||= mod.createViewer($('viewer'),(text,canUndo)=>{const target=$('selection-summary');if(target)target.textContent=text;$('undo-erase').disabled=!canUndo;});viewer.resize();updateBrushDiameter();updateHeightPreview();
      if(pointAsset===key&&row?.pcd){updateOriginPreview();return;}
      pointAsset=null;viewer.clear();$('point-info').textContent='左键旋转 · 右键平移 · 滚轮缩放';$('viewer-empty').hidden=false;
      $('viewer-empty').textContent=row?.pcd?'加载点云…':'请选择含 PCD 的地图';
      if(row?.pcd){const blob=await api.download(base+'/file/pcd/'+encodeURIComponent(key));if(token!==generation)return;const buffer=await blob.arrayBuffer();if(token!==generation)return;const count=viewer.load(buffer);pointAsset=key;$('viewer-empty').hidden=true;$('point-info').textContent=`${count.toLocaleString()} 点 · 当前显示源地图坐标`;updateOriginPreview();}
    }catch(e){notice(e.message,true);$('viewer-empty').textContent='点云加载失败，请检查文件或浏览器 WebGL 支持';}
  }
  if(next==='grid'){
    const frame=$('grid-frame'),revision=String(row?.revision??''),identity=`${key}:${revision}`;
    if(frame.dataset.asset!==identity){frame.src=row?.grid?'src/components/process-map/handle_map.html?embedded=1&map='+encodeURIComponent(key)+'&revision='+encodeURIComponent(revision)+'&ui=comfortable-theme-20261028-1':'about:blank';frame.dataset.asset=identity;}
    if(!row?.grid)notice('请选择含 PGM / YAML 的地图，或先从点云处理生成栅格。');
  }else if(next==='route'){
    const routeFrame=$('route-frame'),asset=key,readyForRoutes=!!row?.grid;
    if(!routeFrame.dataset.loaded){routeFrame.src='operations.html?ui=comfortable-theme-20261028-1&embedded=1'+(query.get('mapId')?'&mapId='+encodeURIComponent(query.get('mapId')):'')+['point','object','uid','planId'].filter(key=>query.get(key)).map(key=>'&'+key+'='+encodeURIComponent(query.get(key))).join('')+(asset&&!query.get('mapId')?'&asset='+encodeURIComponent(asset)+(readyForRoutes?'&openAsset=1':''):'')+'#maps';routeFrame.dataset.loaded='1';}
    else if(asset&&readyForRoutes)routeFrame.contentWindow?.postMessage({type:'workbench-open-map-asset',asset},location.origin);
    else if(asset)routeFrame.contentWindow?.postMessage({type:'workbench-selected-map-asset',asset},location.origin);
    else routeFrame.contentWindow?.postMessage({type:'workbench-selected-map-asset',asset:''},location.origin);
  }
  else if(next==='binding'&&$('binding-frame').dataset.asset!==key){$('binding-frame').src='map-bindings.html?embedded=1'+(key?'&asset='+encodeURIComponent(key):'');$('binding-frame').dataset.asset=key;}
  else if(next==='locate'&&$('locate-frame').dataset.asset!==key){$('locate-frame').src='localization.html?embedded=1'+(key?'&asset='+encodeURIComponent(key):'');$('locate-frame').dataset.asset=key;}
  if(next==='build')await mappingStatus();
}
function drawLiveGrid(){
  const canvas=$('live-grid-canvas');if(!canvas)return;
  const rect=canvas.getBoundingClientRect(),width=rect.width,height=rect.height;
  if(!width||!height)return;
  const ratio=window.devicePixelRatio||1,ctx=canvas.getContext('2d');
  if(canvas.width!==Math.round(width*ratio)||canvas.height!==Math.round(height*ratio)){
    canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
  }
  ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);ctx.fillStyle='#fbfcfd';ctx.fillRect(0,0,width,height);
  ctx.strokeStyle='#ebeff2';ctx.lineWidth=1;
  for(let x=0;x<width;x+=24){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}
  for(let y=0;y<height;y+=24){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke();}
  const meta=liveGridMeta,image=liveGridImage;
  if(!meta||!image||!meta.width||!meta.height){$('live-grid-empty').hidden=false;return;}
  $('live-grid-empty').hidden=true;
  const margin=24,worldWidth=meta.width*meta.resolution,worldHeight=meta.height*meta.resolution;
  const scale=Math.min((width-margin*2)/worldWidth,(height-margin*2)/worldHeight);
  const drawWidth=worldWidth*scale,drawHeight=worldHeight*scale;
  const left=(width-drawWidth)/2,top=(height-drawHeight)/2;
  ctx.imageSmoothingEnabled=false;ctx.drawImage(image,left,top,drawWidth,drawHeight);
  const origin=meta.origin||{x:0,y:0},zeroX=left-origin.x*scale,zeroY=top+drawHeight+origin.y*scale;
  if(zeroX>=left&&zeroX<=left+drawWidth&&zeroY>=top&&zeroY<=top+drawHeight){
    ctx.save();ctx.strokeStyle='#e87523';ctx.fillStyle='#d65e11';ctx.lineWidth=1;ctx.setLineDash([5,4]);
    ctx.beginPath();ctx.moveTo(zeroX,top);ctx.lineTo(zeroX,top+drawHeight);ctx.moveTo(left,zeroY);ctx.lineTo(left+drawWidth,zeroY);ctx.stroke();ctx.setLineDash([]);
    ctx.beginPath();ctx.arc(zeroX,zeroY,5,0,Math.PI*2);ctx.stroke();ctx.font='11px Segoe UI, Microsoft YaHei, sans-serif';ctx.fillText('(0, 0)',zeroX+8,zeroY-8);ctx.restore();
  }
}
async function refreshLiveGrid(){
  try{
    const meta=await api.get(base+'/live-grid');liveGridMeta=meta;
    const stateText=meta.status||'等待建图点云';$('live-grid-state').textContent=stateText;
    $('live-grid-info').textContent=meta.width&&meta.height
      ?`${(meta.width*meta.resolution).toFixed(1)} × ${(meta.height*meta.resolution).toFixed(1)} m · ${meta.resolution.toFixed(2)} m/格 · ${meta.frame_id||'坐标系未知'}`
      :'分辨率 0.05 m/格 · 未知区域显示为空白';
    if(meta.available&&meta.sequence!==liveGridSequence&&drawerVisible){
      const request=++liveGridRequest,sequence=meta.sequence;
      const blob=await api.download(base+'/live-grid.png?sequence='+encodeURIComponent(sequence));
      const url=URL.createObjectURL(blob),image=new Image();
      try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('实时二维地图图片无法解码'));image.src=url;});}
      finally{URL.revokeObjectURL(url);}
      if(request===liveGridRequest){liveGridImage=image;liveGridSequence=sequence;}
    }
    drawLiveGrid();
  }catch(error){
    $('live-grid-state').textContent='实时预览暂不可用';
    if(!liveGridImage)$('live-grid-empty').textContent=error.message||'请检查建图点云与实时地图服务';
    drawLiveGrid();
  }
}
async function mappingStatus(){try{const wasActive=!!mapping?.active;mapping=await api.get(base+'/mapping');if(wasActive&&!mapping.active)$('manual-push-confirmed').checked=false;updateMapping();}catch(e){notice(e.message,true);}}
async function follow(job){
  setBusy(true);$('job-strip').hidden=false;localStorage.setItem('map-workbench-job',job.id);
  try{while(true){$('job-id').textContent=job.id;$('job-state').textContent=({queued:'等待处理',running:'处理中',success:'已完成',failed:'未完成'})[job.status]||job.status;$('job-message').textContent=job.message;
    if(job.status==='failed')throw new Error(job.message);
    if(job.status==='success'){
      localStorage.removeItem('map-workbench-job');const key=job.result?.asset?.id||job.result?.asset_id;
      await refresh(key,{render:job.kind!=='process'});
      if(job.kind==='process'){
        const stats=job.result?.stats||{};
        const eraseSummary=Number.isFinite(Number(stats.manual_erased_points))?`橡皮擦删除 ${Number(stats.manual_erased_points).toLocaleString()} 点；自动滤波删除 ${Number(stats.denoise_removed_points||0).toLocaleString()} 点。`:'';
        if(drawerMode){
          notice(`新地图已生成，正在把它打开到路线主画布。${eraseSummary}原始点云保持不变。`);
          window.parent.postMessage({type:'workbench-asset-ready',asset:key,stats},location.origin);
        }else{
          await show('route',true);
          notice(`新地图已生成并打开到路线主画布。${eraseSummary}原始点云保持不变。`);
        }
      }
      else if(job.kind==='mapping-save'){await show('point');notice('原始点云已保存，可设置坐标原点并生成路线栅格。');}
      else notice(job.result?.message||'操作完成');break;
    }
    await new Promise(resolve=>setTimeout(resolve,1000));job=await api.get(base+'/jobs/'+job.id);
  }}catch(e){notice(e.message+'；可刷新页面重新查询任务状态。',true);if(job.status==='failed')localStorage.removeItem('map-workbench-job');}
  finally{setBusy(false);await mappingStatus();}
}
async function run(path,data){if(busy)return;setBusy(true);try{await follow(await api.post(base+path,data));}catch(e){notice(e.message,true);setBusy(false);}}

$('process-form').onsubmit=async e=>{
  e.preventDefault();if(!updateHeightPreview())return notice('请修正高度范围后再处理点云。',true);
  if(!updateOriginPreview())return notice('请修正坐标原点与方向。',true);
  if(!current()?.pcd||pointAsset!==current().id)return notice('请先选择地图并等待点云加载完成。',true);
  const params=viewer?.selection()||{};
  const output=$('output').value.trim();
  const brushCount=params.erase_brush?.length||0;
  if(!await confirmCriticalAction('生成新的路线地图',`将根据当前点云、高度过滤、${brushCount} 笔橡皮擦、选区与坐标原点生成新地图“${output}”，并创建 PGM / YAML 栅格。源点云不会覆盖。`))return;
  run('/process',{source:current().id,output,z_min:Number($('z-min').value),z_max:Number($('z-max').value),resolution:Number($('resolution').value),denoise:$('denoise').checked,radius:Number($('radius').value),neighbors:Number($('neighbors').value),...params});
};
$('z-min').addEventListener('input',updateHeightPreview);$('z-max').addEventListener('input',updateHeightPreview);
for(const id of ['origin-enabled','origin-x','origin-y','origin-yaw'])$(id).addEventListener(id==='origin-enabled'?'change':'input',updateOriginPreview);
$('draw-origin').onclick=()=>{if(!current()?.pcd||pointAsset!==current().id)return notice('请先加载一张 PCD 点云。',true);document.querySelectorAll('[data-draw]').forEach(button=>button.classList.remove('active'));$('erase-brush').classList.remove('active');$('draw-origin').classList.add('active');$('origin-enabled').checked=true;updateOriginPreview();viewer?.drawOrigin(origin=>{$('origin-x').value=origin.x.toFixed(3);$('origin-y').value=origin.y.toFixed(3);$('origin-yaw').value=(origin.yaw*180/Math.PI).toFixed(1);updateOriginPreview();notice('坐标原点和方向已选定。生成新地图时将应用这个坐标变换。');});notice('在点云上按住左键，从新原点拖向新坐标系 +X 方向。');};
$('reset-origin').onclick=()=>{resetOrigin();$('draw-origin').classList.remove('active');viewer?.cancelMode();};
$('brush-size-down').onclick=()=>updateBrushDiameter(brushDiameter-.1);$('brush-size-up').onclick=()=>updateBrushDiameter(brushDiameter+.1);
$('erase-brush').onclick=()=>{
  if(!current()?.pcd||pointAsset!==current().id)return notice('请先选择并加载一张 PCD 点云。',true);
  const enable=!$('erase-brush').classList.contains('active');
  document.querySelectorAll('[data-draw]').forEach(button=>button.classList.remove('active'));
  $('draw-origin').classList.remove('active');$('erase-brush').classList.toggle('active',enable);
  if(enable){updateBrushDiameter();viewer?.drawBrush();notice('橡皮擦已启用：按住鼠标左键涂抹要删除的点；再次点击退出。');}
  else{viewer?.cancelMode();notice('已退出橡皮擦模式。');}
};
$('undo-erase').onclick=()=>{if(!viewer?.undoErase())notice('没有可撤销的橡皮擦操作。');else notice('已撤销上一笔删除。');};
$('mapping-start').onclick=async()=>{if(!$('manual-push-confirmed').checked)return notice('请先在现场确认底盘处于厂家允许的安全手动/自由轮状态，并可人工推行。',true);if(!await confirmCriticalAction('开始实时建图','开始后将采集雷达点云。必须确认定位和自动导航已停止，底盘处于厂家允许的安全手动/自由轮状态，现场人员可控地推动车辆。网页不会发送行驶命令。'))return;run('/mapping/start',{manual_push_confirmed:true});};
$('manual-push-confirmed').onchange=updateMapping;$('mapping-form').onsubmit=async e=>{e.preventDefault();if(!mapping?.active)return notice('请先开始采集，再保存点云。',true);const name=$('mapping-name').value.trim();if(!await confirmCriticalAction('保存本次建图点云',`将结束当前采集并保存为“${name}”。保存后可继续裁切、设置坐标原点并生成路线栅格。`))return;run('/mapping/save',{name});};
$('mapping-stop').onclick=async()=>{if(!await confirmCriticalAction('停止建图采集','停止本次雷达采集并保留定位与导航停止状态。若尚未保存点云，本次采集可能无法用于后续建图。'))return;run('/mapping/stop');};
$('asset').onchange=()=>selected().catch(e=>notice(e.message,true));$('refresh').onclick=()=>refresh().catch(e=>notice(e.message,true));
$('grid-route-action').onclick=()=>show('route').catch(e=>notice(e.message,true));
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>show(b.dataset.tab).catch(e=>notice(e.message,true)));
$('workflow-close').onclick=$('workflow-scrim').onclick=closeWorkflowDrawer;
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('workflow-drawer').hidden)closeWorkflowDrawer();});
$('fit').onclick=()=>viewer?.fit();$('live-grid-fit').onclick=drawLiveGrid;$('clear-boxes').onclick=()=>{viewer?.clearBoxes();document.querySelectorAll('[data-draw]').forEach(button=>button.classList.remove('active'));$('draw-origin').classList.remove('active');$('erase-brush').classList.remove('active');};
document.querySelectorAll('[data-draw]').forEach(b=>b.onclick=()=>{if(!current()?.pcd||pointAsset!==current().id)return notice('请先选择并加载一张 PCD 点云。',true);document.querySelectorAll('[data-draw]').forEach(button=>button.classList.toggle('active',button===b));$('draw-origin').classList.remove('active');$('erase-brush').classList.remove('active');viewer?.drawBox(b.dataset.draw);notice('已进入框选模式：在点云上按住左键拖动，松开完成选区。');});
window.addEventListener('message',e=>{
  if(e.origin!==location.origin)return;
  if(drawerMode&&e.source===window.parent&&e.data?.type==='workbench-drawer-visibility'){
    drawerVisible=e.data.visible===true;if(drawerVisible&&tab==='build')refreshLiveGrid();return;
  }
  if(e.source===$('grid-frame').contentWindow&&e.data?.type==='map-load-state'&&e.data.id===current()?.id){
    notice(e.data.ok?`${e.data.id} 的 PGM 二维地图已显示，可继续编辑或进入路线规划。`:`${e.data.id} 的 PGM 没有显示：${e.data.message||'加载失败'}`,!e.data.ok);
  }
  if(e.source===$('grid-frame').contentWindow&&e.data?.type==='map-saved')refresh(e.data.id).then(()=>{$('locate-frame').removeAttribute('data-asset');$('binding-frame').removeAttribute('data-asset');notice('二维地图已保存。路线编辑和地图绑定会显示更新后的栅格版本。');}).catch(err=>notice(err.message,true));
  if([$('route-frame').contentWindow,$('binding-frame').contentWindow,$('locate-frame').contentWindow,$('workflow-frame').contentWindow].includes(e.source)&&e.data?.type==='workbench-open-drawer')openWorkflowDrawer(e.data.tab,e.data.asset||'');
  if(e.source===$('workflow-frame').contentWindow&&e.data?.type==='workbench-asset-ready'){
    refresh(e.data.asset,{render:false}).then(()=>{
      closeWorkflowDrawer();
      $('route-frame').contentWindow?.postMessage({type:'workbench-open-map-asset',asset:e.data.asset},location.origin);
      const stats=e.data.stats||{},erased=Number(stats.manual_erased_points),filtered=Number(stats.denoise_removed_points||0);
      const cleanup=Number.isFinite(erased)?`橡皮擦清除 ${erased.toLocaleString()} 点，自动滤波移除 ${filtered.toLocaleString()} 点。`:'';
      notice(`二维地图已生成并关联到路线画布；${cleanup}可以直接设置站点、路线和区域。`);
    }).catch(error=>notice(error.message,true));
  }
  if([$('locate-frame').contentWindow,$('route-frame').contentWindow].includes(e.source)&&e.data?.type==='workbench-navigate'&&tabs.includes(e.data.tab))show(e.data.tab).catch(err=>notice(err.message,true));
});
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(tabs.includes(next))show(next).catch(e=>notice(e.message,true));});

await refresh(new URLSearchParams(location.search).get('map'),{initial:true}).catch(e=>notice(e.message,true));await show(initialTab);
const pending=localStorage.getItem('map-workbench-job');if(pending)api.get(base+'/jobs/'+pending).then(follow).catch(e=>{notice(e.message,true);localStorage.removeItem('map-workbench-job');});
new ResizeObserver(drawLiveGrid).observe($('live-grid-canvas'));
setInterval(()=>{if(tab==='build'&&!document.hidden&&drawerVisible)mappingStatus();},4000);
setInterval(()=>{if(tab==='build'&&!document.hidden&&drawerVisible)refreshLiveGrid();},1500);
