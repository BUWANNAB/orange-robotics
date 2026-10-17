const $=id=>document.getElementById(id), api=window.OpsAPI, base='/api/map-workbench';
const tabs=['build','point','grid','route','binding','locate'];
const requestedTab=location.hash.slice(1);
const initialTab=tabs.includes(requestedTab)?requestedTab:requestedTab==='maps'?'route':'build';
let pointAsset=null, selectedAsset='', assets=[], tab='', viewer, viewerModule, generation=0, busy=false, mapping, workflowReturnFocus=null;

function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
function current(){return assets.find(row=>row.id===$('asset').value);}
function openWorkflowDrawer(next){
  if(!['binding','locate'].includes(next))return;
  const drawer=$('workflow-drawer'),frame=$('workflow-frame'),asset=$('asset').value;
  workflowReturnFocus=document.activeElement;
  $('workflow-title').textContent=next==='binding'?'地图绑定':'重新定位';
  const src=`${next==='binding'?'map-bindings.html':'localization.html'}?embedded=1${asset?'&asset='+encodeURIComponent(asset):''}`;
  if(frame.getAttribute('src')!==src)frame.src=src;
  drawer.hidden=false;document.body.classList.add('drawer-open');$('workflow-close').focus();
}
function closeWorkflowDrawer(){
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
async function refresh(preferred){
  const previous=preferred||$('asset').value;assets=await api.get(base+'/assets');
  $('asset').replaceChildren(new Option(assets.length?'请选择地图':'暂无地图',''),...assets.map(a=>new Option(`${a.id}${a.pcd?' · PCD':''}${a.grid?' · PGM':''}`,a.id)));
  if(assets.some(a=>a.id===previous))$('asset').value=previous;await selected();
}
async function selected(){
  const row=current(),key=row?.id||'';
  if(key!==selectedAsset){selectedAsset=key;pointAsset=null;resetOrigin();document.querySelectorAll('[data-draw]').forEach(button=>button.classList.remove('active'));$('draw-origin').classList.remove('active');}
  notice(row?'当前地图：'+row.id:'请选择地图，或开始采集新地图。');
  $('asset-detail').textContent=row?`${row.pcd?'定位点云可用':'无 PCD'} · ${row.grid?'路线栅格可用':'无 PGM / YAML'}${row.resolution?' · '+row.resolution+' m/像素':''}`:'同一地图统一管理点云与栅格';
  $('output').value=row?row.id+'_processed':'';
  await show(tab||initialTab,true);
}
async function show(next,reload=false){
  if(!tabs.includes(next))next='build';
  if(tab===next&&!reload)return;
  tab=next;history.replaceState(null,'','#'+next);document.body.classList.toggle('route-mode',next==='route');
  document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===next)));
  document.querySelectorAll('.panel').forEach(p=>p.hidden=p.id!=='panel-'+next);
  const row=current(),key=row?.id||'';generation++;const token=generation;
  if(next==='point'){
    try{
      viewerModule ||= import('./point-viewer.js?v=20261017-origin-and-unified-workbench');
      const mod=await viewerModule;viewer ||= mod.createViewer($('viewer'),text=>{const target=$('selection-summary');if(target)target.textContent=text;});viewer.resize();updateHeightPreview();
      if(pointAsset===key&&row?.pcd){updateOriginPreview();return;}
      pointAsset=null;viewer.clear();$('point-info').textContent='左键旋转 · 右键平移 · 滚轮缩放';$('viewer-empty').hidden=false;
      $('viewer-empty').textContent=row?.pcd?'加载点云…':'请选择含 PCD 的地图';
      if(row?.pcd){const blob=await api.download(base+'/file/pcd/'+encodeURIComponent(key));if(token!==generation)return;const buffer=await blob.arrayBuffer();if(token!==generation)return;const count=viewer.load(buffer);pointAsset=key;$('viewer-empty').hidden=true;$('point-info').textContent=`${count.toLocaleString()} 点 · 当前显示源地图坐标`;updateOriginPreview();}
    }catch(e){notice(e.message,true);$('viewer-empty').textContent='点云加载失败，请检查文件或浏览器 WebGL 支持';}
  }
  if(next==='grid'){
    if($('grid-frame').dataset.asset!==key){$('grid-frame').src=row?.grid?'src/components/process-map/handle_map.html?embedded=1&map='+encodeURIComponent(key)+'&ui=20261017-unified-map-workbench':'about:blank';$('grid-frame').dataset.asset=key;}
    if(!row?.grid)notice('请选择含 PGM / YAML 的地图，或先从点云处理生成栅格。');
  }else if(next==='route'&&!$('route-frame').dataset.loaded){$('route-frame').src='operations.html?embedded=1#maps';$('route-frame').dataset.loaded='1';}
  else if(next==='binding'&&$('binding-frame').dataset.asset!==key){$('binding-frame').src='map-bindings.html?embedded=1'+(key?'&asset='+encodeURIComponent(key):'');$('binding-frame').dataset.asset=key;}
  else if(next==='locate'&&$('locate-frame').dataset.asset!==key){$('locate-frame').src='localization.html?embedded=1'+(key?'&asset='+encodeURIComponent(key):'');$('locate-frame').dataset.asset=key;}
  if(next==='build')await mappingStatus();
}
async function mappingStatus(){try{const wasActive=!!mapping?.active;mapping=await api.get(base+'/mapping');if(wasActive&&!mapping.active)$('manual-push-confirmed').checked=false;updateMapping();}catch(e){notice(e.message,true);}}
async function follow(job){
  setBusy(true);$('job-strip').hidden=false;localStorage.setItem('map-workbench-job',job.id);
  try{while(true){$('job-id').textContent=job.id;$('job-state').textContent=({queued:'等待处理',running:'处理中',success:'已完成',failed:'未完成'})[job.status]||job.status;$('job-message').textContent=job.message;
    if(job.status==='failed')throw new Error(job.message);
    if(job.status==='success'){
      localStorage.removeItem('map-workbench-job');const key=job.result?.asset?.id||job.result?.asset_id;await refresh(key);
      if(job.kind==='process'){await show('grid');notice('新地图已生成：原始点云未修改。可继续编辑栅格、路线、绑定并重新定位。');}
      else if(job.kind==='mapping-save'){await show('point');notice('原始点云已保存，可设置坐标原点并生成路线栅格。');}
      else notice(job.result?.message||'操作完成');break;
    }
    await new Promise(resolve=>setTimeout(resolve,1000));job=await api.get(base+'/jobs/'+job.id);
  }}catch(e){notice(e.message+'；可刷新页面重新查询任务状态。',true);if(job.status==='failed')localStorage.removeItem('map-workbench-job');}
  finally{setBusy(false);await mappingStatus();}
}
async function run(path,data){if(busy)return;setBusy(true);try{await follow(await api.post(base+path,data));}catch(e){notice(e.message,true);setBusy(false);}}

$('process-form').onsubmit=e=>{
  e.preventDefault();if(!updateHeightPreview())return notice('请修正高度范围后再处理点云。',true);
  if(!updateOriginPreview())return notice('请修正坐标原点与方向。',true);
  if(!current()?.pcd||pointAsset!==current().id)return notice('请先选择地图并等待点云加载完成。',true);
  const params=viewer?.selection()||{};
  run('/process',{source:current().id,output:$('output').value.trim(),z_min:Number($('z-min').value),z_max:Number($('z-max').value),resolution:Number($('resolution').value),denoise:$('denoise').checked,radius:Number($('radius').value),neighbors:Number($('neighbors').value),...params});
};
$('z-min').addEventListener('input',updateHeightPreview);$('z-max').addEventListener('input',updateHeightPreview);
for(const id of ['origin-enabled','origin-x','origin-y','origin-yaw'])$(id).addEventListener(id==='origin-enabled'?'change':'input',updateOriginPreview);
$('draw-origin').onclick=()=>{if(!current()?.pcd||pointAsset!==current().id)return notice('请先加载一张 PCD 点云。',true);document.querySelectorAll('[data-draw]').forEach(button=>button.classList.remove('active'));$('draw-origin').classList.add('active');$('origin-enabled').checked=true;updateOriginPreview();viewer?.drawOrigin(origin=>{$('origin-x').value=origin.x.toFixed(3);$('origin-y').value=origin.y.toFixed(3);$('origin-yaw').value=(origin.yaw*180/Math.PI).toFixed(1);updateOriginPreview();notice('坐标原点和方向已选定。生成新地图时将应用这个坐标变换。');});notice('在点云上按住左键，从新原点拖向新坐标系 +X 方向。');};
$('reset-origin').onclick=()=>{resetOrigin();$('draw-origin').classList.remove('active');};
$('mapping-start').onclick=()=>{if(!$('manual-push-confirmed').checked)return notice('请先在现场确认底盘处于厂家允许的安全手动/自由轮状态，并可人工推行。',true);run('/mapping/start',{manual_push_confirmed:true});};
$('manual-push-confirmed').onchange=updateMapping;$('mapping-form').onsubmit=e=>{e.preventDefault();if(!mapping?.active)return notice('请先开始采集，再保存点云。',true);run('/mapping/save',{name:$('mapping-name').value.trim()});};$('mapping-stop').onclick=()=>run('/mapping/stop');
$('asset').onchange=()=>selected().catch(e=>notice(e.message,true));$('refresh').onclick=()=>refresh().catch(e=>notice(e.message,true));
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>show(b.dataset.tab).catch(e=>notice(e.message,true)));
$('workflow-close').onclick=$('workflow-scrim').onclick=closeWorkflowDrawer;
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('workflow-drawer').hidden)closeWorkflowDrawer();});
$('fit').onclick=()=>viewer?.fit();$('clear-boxes').onclick=()=>{viewer?.clearBoxes();document.querySelectorAll('[data-draw]').forEach(button=>button.classList.remove('active'));$('draw-origin').classList.remove('active');};
document.querySelectorAll('[data-draw]').forEach(b=>b.onclick=()=>{if(!current()?.pcd||pointAsset!==current().id)return notice('请先选择并加载一张 PCD 地图。',true);document.querySelectorAll('[data-draw]').forEach(button=>button.classList.toggle('active',button===b));$('draw-origin').classList.remove('active');viewer?.drawBox(b.dataset.draw);notice('已进入框选模式：在点云上按住鼠标左键拖出矩形，松开完成选区。');});
window.addEventListener('message',e=>{
  if(e.origin!==location.origin)return;
  if(e.source===$('grid-frame').contentWindow&&e.data?.type==='map-saved')refresh(e.data.id).then(()=>{$('locate-frame').removeAttribute('data-asset');$('binding-frame').removeAttribute('data-asset');notice('二维地图已保存。路线编辑和地图绑定会显示更新后的栅格版本。');}).catch(err=>notice(err.message,true));
  if([$('route-frame').contentWindow,$('binding-frame').contentWindow,$('locate-frame').contentWindow,$('workflow-frame').contentWindow].includes(e.source)&&e.data?.type==='workbench-open-drawer')openWorkflowDrawer(e.data.tab);
  if([$('locate-frame').contentWindow,$('route-frame').contentWindow].includes(e.source)&&e.data?.type==='workbench-navigate'&&tabs.includes(e.data.tab))show(e.data.tab).catch(err=>notice(err.message,true));
});
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(tabs.includes(next))show(next).catch(e=>notice(e.message,true));});

await refresh(new URLSearchParams(location.search).get('map')).catch(e=>notice(e.message,true));await show(initialTab);
const pending=localStorage.getItem('map-workbench-job');if(pending)api.get(base+'/jobs/'+pending).then(follow).catch(e=>{notice(e.message,true);localStorage.removeItem('map-workbench-job');});
setInterval(()=>{if(tab==='build'&&!document.hidden)mappingStatus();},4000);
