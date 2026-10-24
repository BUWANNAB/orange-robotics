(function(){
  const $=id=>document.getElementById(id),api=window.OpsAPI;
  let data,busy=false;
  function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
  function confirmCriticalAction(message){
    const dialog=$('operation-lock');if(dialog.open)return Promise.resolve(false);
    $('operation-lock-message').textContent=message;$('operation-lock-ack').checked=false;$('operation-lock-confirm').disabled=true;
    $('operation-lock-ack').onchange=()=>{$('operation-lock-confirm').disabled=!$('operation-lock-ack').checked;};
    return new Promise(resolve=>{dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true});dialog.showModal();});
  }
  function entry(){return data?.entries.find(e=>e.key===$('binding-pcd').value);}
  function selected(){
    const e=entry();$('binding-confirm').checked=false;$('binding-map').value='';
    const m=data?.maps.find(m=>m.id===e?.map_id),active=data?.active;
    $('binding-status').textContent=!e?'请选择定位点云':!e.map_id?'当前尚未绑定线路地图':`已保存：${m?.name||'线路地图已删除'} · v${e.version}${m?.published_version!==e.version?'（发布版本已更新，需要重新绑定）':''}\n${active?.status==='ready'&&active.key===e.key&&active.map_id===e.map_id&&active.version===e.version?'已确认用于当前定位':'尚未确认应用此绑定；保存后请重新定位'}`;
    if(m?.published_version)$('binding-map').value=String(m.id);
    $('binding-locate').href='map-workbench.html'+(e?.asset_id?'?map='+encodeURIComponent(e.asset_id):'')+'#locate';
    $('binding-remove').disabled=busy||!e?.map_id;
    $('binding-save').disabled=busy||!e;
    detail();
  }
  function detail(){
    $('binding-confirm').checked=false;
    const m=data?.maps.find(m=>String(m.id)===$('binding-map').value);
    $('binding-detail').textContent=m?`将绑定：${m.name} · 已发布 v${m.published_version}。后续发布新版本后，需要在这里更新绑定并重新定位。`:'没有可选地图时，请先在线路编辑器保存、校验并发布。';
  }
  async function refresh(){
    const key=$('binding-pcd').value;
    data=await api.get('/api/map-workbench/bindings');
    $('binding-pcd').replaceChildren(new Option(data.entries.length?'请选择定位点云':'没有找到定位点云',''),...data.entries.map(e=>new Option(e.asset_id||e.key,e.key)));
    $('binding-map').replaceChildren(new Option('请选择已发布线路地图',''),...data.maps.filter(m=>m.published_version>0).map(m=>new Option(`${m.name} · v${m.published_version}`,m.id)));
    const preferred=data.entries.find(e=>e.key===key)||data.entries.find(e=>e.asset_id===new URLSearchParams(location.search).get('asset'));
    if(preferred)$('binding-pcd').value=preferred.key;selected();
  }
  async function save(remove=false){
    if(busy)return;const e=entry(),m=data.maps.find(m=>String(m.id)===$('binding-map').value);if(!e||(!remove&&!m))return;
    if(!remove&&!$('binding-confirm').checked)return notice('请先确认两张地图的坐标原点、方向和单位一致。',true);
    const message=remove?`将解除点云“${e.asset_id||e.key}”的已保存地图绑定。当前正在运行的地图不变；下次重新定位时不再自动关联该线路地图。`:`将把定位点云“${e.asset_id||e.key}”绑定到线路地图“${m.name} · v${m.published_version}”。保存后需重新定位才会应用；坐标原点或方向不一致会造成定位和路线错位。`;
    if(!await confirmCriticalAction(message))return;
    busy=true;$('binding-save').disabled=true;$('binding-remove').disabled=true;
    try{
      await api.post('/api/map-workbench/bindings',{key:e.key,map_id:remove?null:m.id,version:remove?null:m.published_version,revision:data.revision,coordinates_confirmed:$('binding-confirm').checked});
      await refresh();notice(remove?'已解除保存的绑定；当前运行地图不变。':'绑定已保存。请点击“查看定位地图”，重新定位成功后再执行任务。');
    }catch(error){notice(error.message,true);}finally{busy=false;selected();}
  }
  $('binding-form').onsubmit=e=>{e.preventDefault();save();};$('binding-remove').onclick=()=>save(true);
  $('binding-pcd').onchange=selected;$('binding-map').onchange=detail;
  document.querySelectorAll('.binding-actions a').forEach(link=>link.addEventListener('click',event=>{
    if(!new URLSearchParams(location.search).has('embedded'))return;
    event.preventDefault();const tab=link.id==='binding-locate'?'locate':'route';
    window.parent.postMessage({type:tab==='locate'?'workbench-open-drawer':'workbench-navigate',tab},location.origin);
  }));
  $('binding-refresh').onclick=()=>refresh().then(()=>notice('列表已刷新')).catch(e=>notice(e.message,true));
  refresh().then(()=>notice('按顺序选择点云、线路地图，并核对坐标。')).catch(e=>notice(e.message,true));
})();
