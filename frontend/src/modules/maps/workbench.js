const $=id=>document.getElementById(id), api=window.OpsAPI, base='/api/map-workbench';
const tabs=['build','point','grid','route','locate'];
const query=new URLSearchParams(location.search),drawerMode=query.get('drawer')==='1';
const requestedTab=location.hash.slice(1),requestedPanel=query.get('panel');
const requestedWorkflow=!drawerMode&&['build','point','grid','locate'].includes(requestedTab)?requestedTab:null;
const initialTab=drawerMode&&tabs.includes(requestedPanel)?requestedPanel:requestedWorkflow?'route':tabs.includes(requestedTab)?requestedTab:'route';
let pointAsset=null, selectedAsset='', assets=[], tab='', viewer, viewerModule, generation=0, busy=false, mapping, workflowReturnFocus=null,brushDiameter=.4,pendingRouteOpen=null,routeOpenSequence=0;
let mainMappingPreview=false;
let drawerVisible=true,liveGridMeta=null,liveGridImage=null,liveGridSequence=-1,liveGridRequest=0;
if(drawerMode)document.body.classList.add('drawer-mode');
if(drawerMode&&requestedPanel==='build')document.body.classList.add('mapping-controls-only');
const pointFields=['output','z-min','z-max','resolution','denoise','radius','neighbors','origin-enabled','origin-x','origin-y','origin-yaw'];
const pointDefaults=pointFields.map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]);
const rawNameKey='orange.mapping-name',jobKey='map-workbench-job';
const storage={
  get(key){try{return sessionStorage.getItem(key);}catch{return null;}},
  set(key,value){try{sessionStorage.setItem(key,value);return true;}catch{return false;}},
  remove(key){try{sessionStorage.removeItem(key);}catch{}}
};
function nextMappingName(){
  const date=new Date(),parts=[date.getFullYear(),date.getMonth()+1,date.getDate(),date.getHours(),date.getMinutes(),date.getSeconds()];
  return 'map_'+parts.map(value=>String(value).padStart(2,'0')).join('');
}
$('mapping-name').value=storage.get(rawNameKey)??($('mapping-name').value||nextMappingName());
$('mapping-name').addEventListener('input',()=>storage.set(rawNameKey,$('mapping-name').value));

let pointBaseline=null,pointUpdatedAt=null,pointDraftTimer,restoringPoint=false;
let pendingJob=storage.get(jobKey);
const pointDraftKey=asset=>'orange.point-draft:'+encodeURIComponent(asset);
function pointSnapshot(){
  if(!viewer||!pointAsset)return null;
  return JSON.stringify({asset:pointAsset,updatedAt:pointUpdatedAt,selection:viewer.selection(),fields:pointFields.map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value])});
}
function setPointFields(fields){
  for(const [id,value] of fields){
    if(!pointFields.includes(id))continue;
    if($(id).type==='checkbox')$(id).checked=value===true;
    else $(id).value=value;
  }
}
function pointDirty(snapshot=pointSnapshot()){return pointBaseline!==null&&snapshot!==pointBaseline;}
function persistPointDraft(){
  clearTimeout(pointDraftTimer);
  if(restoringPoint||!pointAsset||pointBaseline===null)return true;
  const snapshot=pointSnapshot(),key=pointDraftKey(pointAsset);
  if(!pointDirty(snapshot)){
    const stored=storage.get(key);
    if(stored){try{if(JSON.parse(stored).updatedAt===pointUpdatedAt)storage.remove(key);}catch{storage.remove(key);}}
    return true;
  }
  const stored=storage.set(key,snapshot);
  $('point-draft-state').textContent=stored
    ?'处理设置已暂存到当前标签页。点击下方按钮后才会生成服务器地图。'
    :'浏览器暂存失败，请先生成地图或留在此页。';
  return stored;
}
function schedulePointDraft(){
  if(restoringPoint||!pointAsset||pointBaseline===null)return;
  clearTimeout(pointDraftTimer);
  pointDraftTimer=setTimeout(persistPointDraft,250);
}
function canLeavePoint(){
  return persistPointDraft()||window.confirm('浏览器无法暂存裁切、橡皮擦或坐标设置。仍要离开并丢弃这些修改吗？');
}
function canLeaveGrid(){return $('grid-frame').contentWindow?.gridCanLeave?.()!==false;}
window.OrangeNavigation?.registerLeaveGuard(()=>canLeavePoint()&&canLeaveGrid());
window.addEventListener('beforeunload',event=>{
  if(!persistPointDraft()&&!window.OrangeNavigation?.leaveApproved()){event.preventDefault();event.returnValue='';}
});

function notice(text,error=false){
  const target=$(tab==='build'?'mapping-action-state':tab==='point'?'point-action-state':'notice');
  target.textContent=text;
  target.classList.toggle('error',error);
}
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
  const src=['build','point','grid'].includes(next)
    ?`map-workbench.html?drawer=1&panel=${next}${asset?'&map='+encodeURIComponent(asset):''}&v=industrial-review-20261028-1`
    :`${next==='binding'?'map-bindings.html':'localization.html'}?embedded=1${asset?'&asset='+encodeURIComponent(asset):''}`;
  if(frame.getAttribute('src')&&frame.getAttribute('src')!==src&&frame.contentWindow?.OrangeNavigation?.canLeave?.()===false)return false;
  document.body.classList.toggle('mapping-workflow',next==='build');
  const sheet=drawer.querySelector('.workflow-sheet');sheet.setAttribute('role','region');sheet.removeAttribute('aria-modal');
  if(next==='build'){mainMappingPreview=true;$('route-frame').contentWindow?.postMessage({type:'workbench-mapping-preview',visible:true},location.origin);}
  workflowReturnFocus=document.activeElement;
  const titles={binding:'地图绑定',locate:'重新定位',build:'实时建图',point:'裁切与坐标原点',grid:'二维地图编辑'};
  $('workflow-title').textContent=titles[next];
  frame.onload=()=>frame.contentWindow?.postMessage({type:'workbench-drawer-visibility',visible:!drawer.hidden},location.origin);
  if(frame.getAttribute('src')!==src)frame.src=src;
  drawer.hidden=false;document.body.classList.add('drawer-open');
  frame.contentWindow?.postMessage({type:'workbench-drawer-visibility',visible:true},location.origin);
  $('workflow-close').focus();
}
function closeWorkflowDrawer(){
  $('workflow-frame').contentWindow?.postMessage({type:'workbench-drawer-visibility',visible:false},location.origin);
  $('workflow-drawer').hidden=true;document.body.classList.remove('drawer-open','mapping-workflow');
  workflowReturnFocus?.focus();workflowReturnFocus=null;
}
function setBusy(value){
  busy=value;
  const locked=busy||!!pendingJob;
  for(const id of ['asset','refresh','process-button'])$(id).disabled=locked;
  $('mapping-name').readOnly=locked;
  $('process-form').inert=locked;
  $('viewer').inert=locked;
  $('job-retry').hidden=busy||!pendingJob;
  updateMapping();
}
function updateHeightPreview(){
  const minValue=$('z-min').value.trim(),maxValue=$('z-max').value.trim(),min=Number(minValue),max=Number(maxValue),status=$('height-preview');
  if(!minValue||!maxValue||!Number.isFinite(min)||!Number.isFinite(max)||min>=max){status.textContent='高度范围无效；请填写数值，并确保最低高度小于最高高度。';status.classList.add('error');return false;}
  status.textContent=`实时预览：显示 ${min} m 至 ${max} m 的点；处理时将使用相同范围。`;status.classList.remove('error');viewer?.setZRange(min,max);return true;
}
function updateOriginPreview(){
  const enabled=$('origin-enabled').checked;
  for(const id of ['origin-x','origin-y','origin-yaw']){$(id).disabled=!enabled;$(id).required=enabled;}
  if(!enabled){viewer?.clearOrigin();$('origin-preview').classList.remove('error');$('origin-preview').textContent='沿用源地图原点和方向。';return true;}
  const x=Number($('origin-x').value),y=Number($('origin-y').value),degrees=Number($('origin-yaw').value);
  if(['origin-x','origin-y','origin-yaw'].some(id=>!$(id).value.trim())||![x,y,degrees].every(Number.isFinite)||Math.abs(x)>1e6||Math.abs(y)>1e6||degrees < -180||degrees > 180){ viewer?.clearOrigin();$('origin-preview').textContent='原点坐标须在 ±1,000,000 m 内，方向须在 -180° 到 180° 之间。';$('origin-preview').classList.add('error');return false; }
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
  if(!mapping){
    for(const id of ['mapping-start','mapping-save','mapping-stop'])$(id).disabled=true;
    return;
  }
  const locked=busy||!!pendingJob;
  const real=mapping.connected&&mapping.source==='ros',lidar=!!mapping.lidar_ready,controller=!!mapping.controller_ready;
  const localizationNodes=(mapping.localization_nodes_active||[]).length>0,navigationNodes=(mapping.navigation_nodes_active||[]).length>0;
  const localizationStopped=mapping.localization_state==='inactive'&&mapping.localization_graph_readable===true&&!localizationNodes;
  const navigationStopped=mapping.navigation_state==='inactive'&&mapping.navigation_graph_readable===true&&!navigationNodes;
  const servicesStopped=localizationStopped&&navigationStopped,confirmed=$('manual-push-confirmed').checked;
  const state=({unknown:'尚无反馈',idle:'空闲',starting:'启动中',mapping:'采集中',map_data_ready:'点云已就绪',saving:'保存中',rviz_livox_started:'雷达已恢复',mapping_stopped:'已停止'})[mapping.status]||mapping.status;
  $('mapping-start').disabled=locked||!real||!lidar||!controller||!servicesStopped||!confirmed||mapping.active;
  $('mapping-save').disabled=locked||!real||!mapping.active;$('mapping-stop').disabled=locked||!real||!mapping.active;
  $('mapping-save').classList.toggle('primary',!!mapping.active);
  $('mapping-start').classList.toggle('primary',!mapping.active);
  const localization=localizationNodes?'仍有定位节点运行':localizationStopped?'已停止':mapping.localization_state==='active'?'服务运行中':'状态未知';
  const navigation=navigationNodes?'仍有运动控制节点运行':navigationStopped?'已停止':mapping.navigation_state==='active'?'服务运行中':'状态未知';
  $('mapping-state').textContent=`ROS 桥接：${real?'已连接':'未连接'} · 雷达点云：${lidar?'实时':'无新数据'} · 建图控制器：${controller?'就绪':'未就绪'} · 定位：${localization} · 运动控制：${navigation} · 建图：${state}`;
  $('mapping-next').textContent=locked?'等待当前操作的结果。':!real?'连接机器人后可开始采集。':mapping.active?'采集结束后，输入名称并点“保存点云并结束采集”。':!lidar||!controller?'等待雷达数据与建图控制器就绪。':!servicesStopped?'请先在 ROS 运行状态页停止定位和运动控制。':!confirmed?'请完成下方现场确认，再开始采集。':'可以开始采集。';
}
async function refresh(preferred,options={}){
  const previous=preferred||(!options.initial&&$('asset').value)||localStorage.getItem('map-workbench-last-asset')||'';assets=await api.get(base+'/assets');
  $('asset').replaceChildren(new Option(assets.length?'请选择地图':'暂无地图',''),...assets.map(a=>new Option(`${a.id}${a.pcd?' · PCD':''}${a.grid?' · PGM':''}`,a.id)));
  const latest=assets.find(asset=>asset.grid)||assets[0];
  const initial=assets.find(asset=>asset.id===previous)||latest;
  if(initial)$('asset').value=initial.id;
  await selected(options);
}
async function selected({render=true}={}){
  const row=current(),key=row?.id||'';
  if(key)localStorage.setItem('map-workbench-last-asset',key);
  if(key!==selectedAsset){
    clearTimeout(pointDraftTimer);
    selectedAsset=key;pointAsset=null;pointBaseline=null;pointUpdatedAt=null;
    setPointFields(pointDefaults);updateOriginPreview();
    $('output').value=row?row.id+'_processed':'';
    $('point-draft-state').textContent='生成新地图前，处理设置暂存在当前标签页。';
    document.querySelectorAll('[data-draw]').forEach(button=>button.classList.remove('active'));
    $('draw-origin').classList.remove('active');$('erase-brush').classList.remove('active');
  }
  $('notice').textContent=row?'当前地图：'+row.id:'请选择地图，或开始采集新地图。';
  $('asset-detail').textContent=row?`${row.pcd?'定位点云可用':'无 PCD'} · ${row.grid?'路线栅格可用':'无 PGM / YAML'}${row.resolution?' · '+row.resolution+' m/像素':''}`:'同一地图统一管理点云与栅格';
  $('point-source').textContent=row?'源地图 '+row.id:'请选择有点云的地图';
  $('grid-route-action').hidden=!row?.grid;
  if(render)await show(tab||initialTab,true);
}
async function show(next,reload=false){
  if(!tabs.includes(next))next='build';
  if(tab===next&&!reload)return;
  if(tab==='grid'&&next!=='grid'&&!canLeaveGrid()){history.replaceState(null,'','#grid');return false;}
  tab=next;history.replaceState(null,'','#'+next);document.body.classList.toggle('route-mode',next==='route'&&!drawerMode);
  document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===next)));
  document.querySelectorAll('.panel').forEach(p=>p.hidden=p.id!=='panel-'+next);
  const row=current(),key=row?.id||'';generation++;const token=generation;
  if(next==='point'){
    try{
      viewerModule ||= import('./point-viewer.js?v=20261109-map-save-1');
      const mod=await viewerModule;viewer ||= mod.createViewer($('viewer'),(text,canUndo)=>{const target=$('selection-summary');if(target)target.textContent=text;$('undo-erase').disabled=!canUndo;schedulePointDraft();});viewer.resize();updateBrushDiameter();updateHeightPreview();
      if(pointAsset===key&&row?.pcd){updateOriginPreview();return;}
      pointAsset=null;viewer.clear();$('point-info').textContent='左键旋转 · 右键平移 · 滚轮缩放';$('viewer-empty').hidden=false;
      $('viewer-empty').textContent=row?.pcd?'加载点云…':'请选择含 PCD 的地图';
      if(row?.pcd){
        const blob=await api.download(base+'/file/pcd/'+encodeURIComponent(key));
        if(token!==generation)return;
        const buffer=await blob.arrayBuffer();
        if(token!==generation)return;
        const count=viewer.load(buffer);pointAsset=key;pointUpdatedAt=row.updated_at;
        $('viewer-empty').hidden=true;$('point-info').textContent=`${count.toLocaleString()} 点 · 当前显示源地图坐标`;
        updateOriginPreview();pointBaseline=pointSnapshot();
        const stored=storage.get(pointDraftKey(key));
        if(stored){
          restoringPoint=true;
          try{
            const draft=JSON.parse(stored);
            if(draft.asset===key&&draft.updatedAt===row.updated_at){
              setPointFields(draft.fields);viewer.restoreSelection(draft.selection);updateHeightPreview();updateOriginPreview();
              $('point-draft-state').textContent='已恢复当前标签页上次的处理设置。';
            }else $('point-draft-state').textContent='源地图已有更新，请重新检查处理设置。';
          }catch{storage.remove(pointDraftKey(key));}
          finally{restoringPoint=false;}
        }
      }
    }catch(e){notice(e.message,true);$('viewer-empty').textContent='点云加载失败，请检查文件或浏览器 WebGL 支持';}
  }
  if(next==='grid'){
    const frame=$('grid-frame'),revision=String(row?.revision??''),identity=`${key}:${revision}`;
    if(frame.dataset.asset!==identity){frame.src=row?.grid?'src/components/process-map/handle_map.html?embedded=1&map='+encodeURIComponent(key)+'&revision='+encodeURIComponent(revision)+'&ui=20261109-grid-dirty-snapshot-1':'about:blank';frame.dataset.asset=identity;}
    if(!row?.grid)notice('请选择含 PGM / YAML 的地图，或先从点云处理生成栅格。');
  }else if(next==='route'){
    const routeFrame=$('route-frame'),asset=key,readyForRoutes=!!row?.grid;
    if(!routeFrame.dataset.loaded){routeFrame.src='operations.html?ui=industrial-review-20261028-1&embedded=1'+(query.get('mapId')?'&mapId='+encodeURIComponent(query.get('mapId')):'')+['point','object','uid','planId'].filter(key=>query.get(key)).map(key=>'&'+key+'='+encodeURIComponent(query.get(key))).join('')+(asset&&!query.get('mapId')?'&asset='+encodeURIComponent(asset)+(readyForRoutes?'&openAsset=1':''):'')+'#maps';routeFrame.dataset.loaded='1';}
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
    const meta=await api.get(base+'/live-grid');if(!meta.available){liveGridImage=null;liveGridMeta=meta;liveGridSequence=-1;}
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
      if(request===liveGridRequest){liveGridImage=image;liveGridSequence=sequence;liveGridMeta=meta;}
    }
    if(liveGridSequence===meta.sequence)liveGridMeta=meta;drawLiveGrid();
  }catch(error){
    $('live-grid-state').textContent='实时预览暂不可用';
    if(!liveGridImage)$('live-grid-empty').textContent=error.message||'请检查建图点云与实时地图服务';
    drawLiveGrid();
  }
}
async function mappingStatus(){
  try{
    const wasActive=!!mapping?.active;
    mapping=await api.get(base+'/mapping');
    if(wasActive&&!mapping.active)$('manual-push-confirmed').checked=false;
    updateMapping();
  }catch{
    mapping=null;updateMapping();
    $('mapping-state').textContent='建图状态暂时无法读取，请检查连接。';
    $('mapping-next').textContent='连接恢复后将自动更新状态。';
  }
}
function setPendingJob(id){
  pendingJob=id;
  if(id)storage.set(jobKey,id);else storage.remove(jobKey);
}
const jobLabels={'process':'生成新地图','mapping-start':'开始采集','mapping-save':'保存点云','mapping-stop':'停止采集'};
function jobStatus(title,message,error=false){
  $('job-strip').hidden=false;
  $('job-state').textContent=title;
  $('job-message').textContent=message;
  $('job-strip').classList.toggle('error',error);
  if(tab==='build'||tab==='point')notice(message,error);
}
function requestRouteMapOpen(asset,stats={}){
  const requestId=`route-open-${Date.now()}-${++routeOpenSequence}`;
  pendingRouteOpen={requestId,asset,stats};
  $('route-open-retry').hidden=true;
  jobStatus('地图已保存，正在打开路线画布',`正在打开“${asset}”。如果画布未响应，可在这里重试；已保存的地图不会丢失。`);
  $('route-frame').contentWindow?.postMessage({type:'workbench-open-map-asset',asset,requestId},location.origin);
  setTimeout(()=>{
    if(pendingRouteOpen?.requestId!==requestId)return;
    $('route-open-retry').hidden=false;
    jobStatus('地图已保存，路线画布尚未确认打开',`“${asset}”已保存，但路线画布没有返回确认。你可以重试打开，地图数据仍保留。`,true);
  },15000);
}
function retryRouteMapOpen(){
  if(!pendingRouteOpen)return;
  requestRouteMapOpen(pendingRouteOpen.asset,pendingRouteOpen.stats);
}
async function applyJobResult(job){
  const key=job.result?.asset?.id||job.result?.asset_id;
  if(job.kind==='process'){
    clearTimeout(pointDraftTimer);
    const source=storage.get(jobKey+':source');
    if(source)storage.remove(pointDraftKey(source));
    storage.remove(jobKey+':source');
    if(pointAsset===source)pointBaseline=pointSnapshot();
    const stats=job.result?.stats||{};
    jobStatus('地图已保存',`“${key}”已保存到地图库，包含处理后的点云和二维底图。现在可编辑站点和路线。`);
    if(drawerMode)window.parent.postMessage({type:'workbench-asset-ready',asset:key,stats},location.origin);
    else{
      await refresh(key,{render:false});
      await show('route',true);
    }
  }else if(job.kind==='mapping-save'){
    storage.remove(rawNameKey);$('mapping-name').value=nextMappingName();
    jobStatus('点云已保存',`“${key}”的原始点云已保存到地图库。下一步可裁切、设定原点并生成二维底图。`);
    if(drawerMode)window.parent.postMessage({type:'workbench-raw-map-ready',asset:key},location.origin);
    else{
      await refresh(key,{render:false});
      if(tab==='route')openWorkflowDrawer('point',key);
      else await show('point',true);
    }
  }else jobStatus('操作已完成',job.result?.message||'操作完成');
}
async function follow(job){
  setPendingJob(job.id);
  setBusy(true);
  try{
    while(job.status==='queued'||job.status==='running'){
      jobStatus(job.status==='queued'?'正在排队':'正在处理',`正在${jobLabels[job.kind]||'处理地图'}，请等待服务器确认。`);
      await new Promise(resolve=>setTimeout(resolve,1000));
      job=await api.get(base+'/jobs/'+job.id);
    }
  }catch(error){
    jobStatus('暂时无法确认结果',`连接中断。请点“重新查询进度”，避免重复提交。${error.message?' '+error.message:''}`,true);
    return;
  }finally{setBusy(false);}
  setPendingJob(null);setBusy(false);
  if(job.status!=='success'){
    storage.remove(jobKey+':source');
    jobStatus('操作未完成',`${job.message||'未收到成功结果。'} 请核对地图列表和建图状态后再试。`,true);
  }else{
    try{await applyJobResult(job);}
    catch{jobStatus('已保存，地图列表暂未更新','可在连接恢复后刷新地图列表，查找刚刚保存的地图。',true);}
  }
  await mappingStatus();
}
async function resumeJob(){
  if(!pendingJob||busy)return;
  setBusy(true);
  try{await follow(await api.get(base+'/jobs/'+pendingJob));}
  catch(error){
    if(error.message.includes('处理任务不存在')){
      setPendingJob(null);storage.remove(jobKey+':source');
      jobStatus('找不到原操作记录','请先查看地图列表和建图状态，确认是否已经保存。',true);
    }else jobStatus('暂时无法确认结果','连接恢复后，点“重新查询进度”。',true);
  }finally{setBusy(false);}
}
async function run(path,data){
  if(busy||pendingJob)return;
  if(path==='/process'){persistPointDraft();storage.set(jobKey+':source',data.source);}
  setBusy(true);
  jobStatus('正在提交',`正在请求${jobLabels[path.slice(1).replace('/','-')]||'地图操作'}…`);
  try{await follow(await api.post(base+path,data));}
  catch(error){jobStatus('未收到提交确认',`${error.message}。处理设置仍保留在当前页面；请先核对地图列表和建图状态。`,true);}
  finally{setBusy(false);}
}
$('job-retry').onclick=resumeJob;
$('route-open-retry').onclick=retryRouteMapOpen;
function validateName(id,raw=false){
  const field=$(id),name=field.value.trim();
  const parts=name.split('/');
  const reserved=/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  let message='';
  if(!name)message='请输入地图名称。';
  else if(raw&&!/^[a-zA-Z0-9_-]{1,64}$/.test(name))message='点云名称可使用 1～64 个英文字母、数字、横线或下划线。';
  else if(raw&&['start','stop'].includes(name.toLowerCase()))message='请换一个名称，start 和 stop 用于控制建图。';
  else if(name.length>180||parts.some(part=>!/^[\p{L}\p{N}_ .-]+$/u.test(part)||part.startsWith('.')||/[ .]$/.test(part)||reserved.test(part)))message='请使用文字、数字、空格、横线或下划线，避开系统保留名称。';
  else if(assets.some(asset=>asset.id.toLowerCase()===name.toLowerCase()))message=`“${name}”已在地图库中，请换一个名称。`;
  field.setCustomValidity(message);
  if(message){field.reportValidity();notice(message,true);return null;}
  return name;
}
for(const id of ['mapping-name','output'])$(id).addEventListener('input',()=>$(id).setCustomValidity(''));

$('process-form').addEventListener('input',schedulePointDraft);
$('process-form').onsubmit=async e=>{
  e.preventDefault();
  if(busy||pendingJob)return;
  if(!updateHeightPreview())return notice('请修正高度范围后再处理点云。',true);
  if(!updateOriginPreview())return notice('请修正坐标原点与方向。',true);
  const source=current()?.id;
  if(!current()?.pcd||pointAsset!==source)return notice('请选择一张地图，等点云加载完成后再保存。',true);
  const output=validateName('output');
  if(!output)return;
  const data={source,output,z_min:Number($('z-min').value),z_max:Number($('z-max').value),resolution:Number($('resolution').value),denoise:$('denoise').checked,radius:Number($('radius').value),neighbors:Number($('neighbors').value),...viewer.selection()};
  const brushCount=data.erase_brush?.length||0;
  if(!await confirmCriticalAction('保存新的二维地图',`将“${source}”的点云、高度范围、${brushCount} 笔擦除及坐标设置保存为地图库中的“${output}”。源地图会保留，保存后可编辑站点和路线。`))return;
  await run('/process',data);
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
$('manual-push-confirmed').onchange=updateMapping;
$('mapping-form').onsubmit=async e=>{
  e.preventDefault();
  if(busy||pendingJob)return;
  if(!mapping?.active)return notice('请先开始采集，再保存点云。',true);
  const name=validateName('mapping-name',true);
  if(!name)return;
  if(!await confirmCriticalAction('保存点云并结束采集',`本次采集会保存到地图库，名称是“${name}”。下一步可裁切点云并生成二维底图。`))return;
  await run('/mapping/save',{name});
};
$('mapping-stop').onclick=async()=>{if(!await confirmCriticalAction('停止建图采集','停止本次雷达采集并保留定位与导航停止状态。若尚未保存点云，本次采集可能无法用于后续建图。'))return;run('/mapping/stop');};
$('asset').onchange=()=>{if(!canLeavePoint()||!canLeaveGrid()){$('asset').value=selectedAsset;return;}selected().catch(e=>notice(e.message,true));};$('refresh').onclick=()=>{if(!busy&&!pendingJob&&persistPointDraft()&&canLeaveGrid())refresh().catch(e=>notice(e.message,true));};
$('grid-route-action').onclick=()=>show('route').catch(e=>notice(e.message,true));
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>show(b.dataset.tab).catch(e=>notice(e.message,true)));
$('workflow-close').onclick=closeWorkflowDrawer;
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!document.querySelector('dialog[open]')&&!$('workflow-drawer').hidden)closeWorkflowDrawer();});
$('fit').onclick=()=>viewer?.fit();$('live-grid-fit').onclick=drawLiveGrid;$('clear-boxes').onclick=()=>{viewer?.clearBoxes();document.querySelectorAll('[data-draw]').forEach(button=>button.classList.remove('active'));$('draw-origin').classList.remove('active');$('erase-brush').classList.remove('active');};
document.querySelectorAll('[data-draw]').forEach(b=>b.onclick=()=>{if(!current()?.pcd||pointAsset!==current().id)return notice('请先选择并加载一张 PCD 点云。',true);document.querySelectorAll('[data-draw]').forEach(button=>button.classList.toggle('active',button===b));$('draw-origin').classList.remove('active');$('erase-brush').classList.remove('active');viewer?.drawBox(b.dataset.draw);notice('已进入框选模式：在点云上按住左键拖动，松开完成选区。');});
window.addEventListener('message',e=>{
  if(e.origin!==location.origin)return;
  if(e.source===$('route-frame').contentWindow&&e.data?.type==='workbench-mapping-preview-closed'){mainMappingPreview=false;return;}
  if(drawerMode&&e.source===window.parent&&e.data?.type==='workbench-drawer-visibility'){
    drawerVisible=e.data.visible===true;if(!drawerVisible)persistPointDraft();if(drawerVisible&&tab==='build')refreshLiveGrid();return;
  }
  if(e.source===$('grid-frame').contentWindow&&e.data?.type==='map-load-state'&&e.data.id===current()?.id){
    notice(e.data.ok?`${e.data.id} 的 PGM 二维地图已显示，可继续编辑或进入路线规划。`:`${e.data.id} 的 PGM 没有显示：${e.data.message||'加载失败'}`,!e.data.ok);
  }
  if(e.source===$('grid-frame').contentWindow&&e.data?.type==='map-saved')refresh(e.data.id).then(()=>{
    $('locate-frame').removeAttribute('data-asset');$('binding-frame').removeAttribute('data-asset');
    jobStatus('二维地图已保存',`“${e.data.id}”已保存到地图库，可用于路线规划。`);
  }).catch(()=>jobStatus('二维地图已保存','地图列表暂未更新，请稍后刷新。',true));
  if([$('route-frame').contentWindow,$('binding-frame').contentWindow,$('locate-frame').contentWindow,$('workflow-frame').contentWindow].includes(e.source)&&e.data?.type==='workbench-open-drawer')openWorkflowDrawer(e.data.tab,e.data.asset||'');
  if(e.source===$('workflow-frame').contentWindow&&e.data?.type==='workbench-raw-map-ready'){
    jobStatus('点云已保存',`“${e.data.asset}”的原始点云已保存到地图库。下一步可生成二维底图。`);
    refresh(e.data.asset,{render:false}).then(()=>openWorkflowDrawer('point',e.data.asset)).catch(error=>jobStatus('点云已保存','地图列表暂未更新，请稍后刷新。',true));
    return;
  }
  if(e.source===$('workflow-frame').contentWindow&&e.data?.type==='workbench-asset-ready'){
    mainMappingPreview=false;$('route-frame').contentWindow?.postMessage({type:'workbench-mapping-preview',visible:false},location.origin);
    refresh(e.data.asset,{render:false}).then(()=>{
      const stats=e.data.stats||{},erased=Number(stats.manual_erased_points),filtered=Number(stats.denoise_removed_points||0);
      const cleanup=Number.isFinite(erased)?`橡皮擦清除 ${erased.toLocaleString()} 点，自动滤波移除 ${filtered.toLocaleString()} 点。`:'';
      requestRouteMapOpen(e.data.asset,{cleanup});
    }).catch(error=>{
      jobStatus('地图已保存，列表暂未刷新',`“${e.data.asset}”已生成。地图列表刷新失败：${error.message}。可以稍后重试打开。`,true);
      requestRouteMapOpen(e.data.asset,e.data.stats||{});
    });
  }
  if(e.source===$('route-frame').contentWindow&&e.data?.type==='workbench-map-open-result'&&e.data.requestId===pendingRouteOpen?.requestId){
    if(e.data.ok){
      const completed=pendingRouteOpen;pendingRouteOpen=null;$('route-open-retry').hidden=true;
      closeWorkflowDrawer();mainMappingPreview=false;
      const cleanup=completed.stats?.cleanup||'';
      jobStatus('地图已保存并打开',`“${completed.asset}”已保存并打开到路线画布。${cleanup}可以继续设置站点、路线和区域。`);
    }else{
      $('route-open-retry').hidden=false;
      jobStatus('地图已保存，路线画布未打开',`${e.data.message||'路线地图尚未打开'}。已保存的地图不会丢失，可重试打开。`,true);
    }
    return;
  }
  if([$('locate-frame').contentWindow,$('route-frame').contentWindow].includes(e.source)&&e.data?.type==='workbench-navigate'&&tabs.includes(e.data.tab))show(e.data.tab).catch(err=>notice(err.message,true));
});
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(!drawerMode&&['build','point','grid','locate'].includes(next)){show('route').then(()=>openWorkflowDrawer(next)).catch(e=>notice(e.message,true));return;}if(tabs.includes(next)){if(next==='route'&&!drawerMode)closeWorkflowDrawer();show(next).catch(e=>notice(e.message,true));}});

await refresh(new URLSearchParams(location.search).get('map'),{initial:true}).catch(e=>notice(e.message,true));await show(initialTab);if(requestedWorkflow)openWorkflowDrawer(requestedWorkflow);
if(!drawerMode&&!pendingJob){
  try{pendingJob=localStorage.getItem(jobKey);if(pendingJob)localStorage.removeItem(jobKey);}catch{}
}
setBusy(false);if(!drawerMode&&pendingJob)resumeJob();
$('route-frame').addEventListener('load',()=>{if(mainMappingPreview)$('route-frame').contentWindow?.postMessage({type:'workbench-mapping-preview',visible:true},location.origin);});
if(!drawerMode)api.get(base+'/live-grid').then(meta=>{if(meta.mapping_active){mainMappingPreview=true;$('route-frame').contentWindow?.postMessage({type:'workbench-mapping-preview',visible:true},location.origin);}}).catch(()=>{});
new ResizeObserver(drawLiveGrid).observe($('live-grid-canvas'));
setInterval(()=>{if(tab==='build'&&!document.hidden&&drawerVisible)mappingStatus();},4000);
setInterval(()=>{if(tab==='build'&&!document.hidden&&drawerVisible)refreshLiveGrid();},1500);
