(function(){
  const $=id=>document.getElementById(id),api=window.OpsAPI;
  const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const tabs={points:['站点','位置、朝向与用途'],paths:['路线','方向、速度与通行设置'],areas:['区域','禁行、减速与作业范围'],plans:['任务链','导航顺序与循环设置'],files:['地图文件','当前地图关联的点云与底图'],versions:['版本记录','已发布版本与操作记录']};
  const types={station:'普通站点',charger:'充电点标记',shelf:'库位标记',waiting:'等候点',elevator:'电梯点标记',forbidden:'禁行区',slow:'减速区',work:'作业区',charge:'充电区'};
  const store=window.MapResourceStore.createStore(api,render),s=store.state;
  const can=permission=>s.data?.permissions.includes('*')||s.data?.permissions.includes(permission);
  function notice(message,error=false){$('notice').textContent=message;$('notice').hidden=!message;$('notice').className='notice'+(error?' error':'');}
  const display=value=>value===null||value===undefined||value===''?'—':escape(value);
  function count(tab){return (tab==='plans'?s.data?.plans:tab==='versions'?s.data?.versions:tab==='files'?s.data?.files:s.data?.document[tab])?.length||0;}
  function key(row){return String(row.uid??row.id??row.version??row.kind);}
  function currentRows(){return window.MapResourceStore.rows(s);}
  function columns(row){
    if(s.tab==='points'){const refs=s.data.references[row.code];return [row.code,row.name||'未命名',types[row.type],`${row.x.toFixed(2)}, ${row.y.toFixed(2)} m`,`${(row.theta*180/Math.PI).toFixed(1)}°`,`${refs.paths.length} 条路线 · ${refs.plans.length} 个任务链`];}
    if(s.tab==='paths'){const a=s.data.document.points.find(p=>p.code===row.start),b=s.data.document.points.find(p=>p.code===row.end);return [`${row.start} → ${row.end}`,row.bidirectional?'双向':'单向',row.curve_mode==='smooth'?'平滑曲线':'直线',a&&b?`${Math.hypot(b.x-a.x,b.y-a.y).toFixed(2)} m${row.curve_mode==='smooth'?'（端点距离）':''}`:'端点缺失',`${row.speed} m/s`];}
    if(s.tab==='areas')return [row.name,types[row.type],`${row.polygon.length} 个顶点`,row.type==='slow'?`${row.speed} m/s`:'—'];
    if(s.tab==='plans')return [row.name,row.start_point,`${row.steps.length} 步`,row.repeat_count===-1?'无限循环':`${row.repeat_count} 次`,row.resource_status==='ready'?'可用':'需要核对'];
    if(s.tab==='versions')return [`v${row.version}`,row.created_at?.replace('T',' ').slice(0,19),row.operator];
    return [row.name,row.kind.toUpperCase(),'当前地图源文件'];
  }
  const headers={points:['编号','名称','用途','位置 XY','朝向','关联情况'],paths:['路线','方向','形状','距离','速度'],areas:['名称','类型','范围','限速'],plans:['名称','起点','步骤','循环','状态'],versions:['版本','发布时间','操作人'],files:['地图名称','格式','归属']};
  function render(){
    $('map-select').innerHTML=s.maps.length?s.maps.map(map=>`<option value="${map.id}" ${map.id===s.mapId?'selected':''}>${escape(map.name)}</option>`).join(''):'<option value="">暂无地图</option>';
    $('map-select').disabled=s.loading||!s.maps.length;
    $('map-state').textContent=s.data?`草稿 r${s.data.map.revision} · 已发布 ${s.data.map.published_version?'v'+s.data.map.published_version:'—'}`:s.loading?'正在读取…':'尚未打开地图';
    $('resource-tabs').innerHTML=Object.entries(tabs).map(([tab,[title,help]])=>`<button type="button" data-tab="${tab}" aria-pressed="${s.tab===tab}"><span>${title}<small>${help}</small></span><b>${count(tab)}</b></button>`).join('');
    $('section-title').textContent=tabs[s.tab][0];$('section-help').textContent=s.data?`${s.data.map.name} · ${s.tab==='files'&&s.data.file_warning?s.data.file_warning:tabs[s.tab][1]}`:'选择地图后显示真实资源';
    $('create').hidden=!['points','paths','areas','plans'].includes(s.tab)||!can(s.tab==='plans'?'task:edit':'map:edit');
    $('create').textContent={points:'添加站点',paths:'添加路线',areas:'在地图绘制',plans:'在地图配置任务链'}[s.tab]||'添加';$('create').disabled=!s.data||s.loading;
    const options=s.tab==='points'?['station','charger','shelf','waiting','elevator']:s.tab==='areas'?['forbidden','slow','work','charge']:s.tab==='plans'?['ready','needs_review']:[];
    $('type-filter').innerHTML='<option value="">全部类型</option>'+options.map(type=>`<option value="${type}" ${s.type===type?'selected':''}>${types[type]||({ready:'可用',needs_review:'需要核对'})[type]}</option>`).join('');$('type-filter').hidden=!options.length;
    $('search').value=s.keyword;const rows=currentRows(),pages=Math.max(1,Math.ceil(rows.length/20));s.page=Math.min(s.page,pages);
    $('result-count').textContent=`${rows.length} 项`;$('page-info').textContent=`${s.page} / ${pages}`;$('previous').disabled=s.page<=1;$('next').disabled=s.page>=pages;
    let empty=s.loading?'正在读取当前地图…':s.error?`读取失败：${s.error}`:!s.maps.length?'还没有地图，请返回地图主页创建或导入 PGM':`当前地图没有${tabs[s.tab][0]}${s.keyword?'匹配搜索条件':''}`;
    $('resource-table').innerHTML=!rows.length?`<div class="empty-state"><strong>${s.error?'暂时无法读取':s.loading?'读取中':`暂无${tabs[s.tab][0]}`}</strong><p>${escape(empty)}</p>${s.error?'<button data-retry type="button">重新读取</button>':''}</div>`:`<table><thead><tr>${headers[s.tab].map(h=>`<th>${h}</th>`).join('')}<th>操作</th></tr></thead><tbody>${rows.slice((s.page-1)*20,s.page*20).map(row=>`<tr ${s.selected===key(row)?'class="selected"':''}><td>${display(columns(row)[0])}</td>${columns(row).slice(1).map(value=>`<td>${display(value)}</td>`).join('')}<td><button data-select="${escape(key(row))}" type="button">查看</button>${['points','paths','areas'].includes(s.tab)&&can('map:edit')?`<button data-edit="${escape(key(row))}" type="button">编辑</button><button data-delete="${escape(key(row))}" class="danger-text" type="button">删除</button>`:''}</td></tr>`).join('')}</tbody></table>`;
    $('back-map').disabled=!s.mapId;
    if(s.error)notice(s.error,true);else if($('notice').classList.contains('error'))notice('');
    renderInspector();
  }
  function find(uid){return currentRows().find(row=>key(row)===uid);}
  function renderInspector(){
    const row=find(s.selected);if(!row){$('inspector').innerHTML='<h2>资源详情</h2><p>选择一项资源，查看属性和关联关系。</p>';return;}
    let extra='';
    if(s.tab==='points'){const refs=s.data.references[row.code];extra=`<h3>相连路线</h3><p>${refs.paths.map(p=>escape(p.name)).join('<br>')||'没有相连路线'}</p><h3>引用任务链</h3><p>${refs.plans.map(p=>escape(p.name)).join('<br>')||'没有任务链引用'}</p>`;}
    if(s.tab==='plans')extra=`<h3>导航步骤</h3><ol>${row.steps.map(step=>`<li>${escape(step.point)}${step.delay_seconds?` · 等待 ${step.delay_seconds} 秒`:''}</li>`).join('')}</ol><p class="${row.resource_message?'warning':''}">${escape(row.resource_message||'目标与当前草稿一致，执行仍以已发布地图为准')}</p>`;
    if(s.tab==='versions')extra='<p>发布版本保留当时的地图快照。查看版本不会修改草稿。</p><button data-version type="button">查看版本内容</button>';
    if(s.tab==='files')extra='<p>下载的是当前地图关联的真实文件。</p><button data-download type="button">下载文件</button>';
    $('inspector').innerHTML=`<div class="inspector-heading"><span>${tabs[s.tab][0]}</span><h2>${display(columns(row)[0])}</h2></div><dl>${headers[s.tab].slice(1).map((title,index)=>`<dt>${title}</dt><dd>${display(columns(row)[index+1])}</dd>`).join('')}</dl>${extra}${['points','paths','areas','plans'].includes(s.tab)?'<button data-show-map class="primary" type="button">在地图查看</button>':''}`;
  }
  function mapUrl(row){return `/ui/index.html?mapId=${s.mapId}${row&&s.tab==='points'?'&point='+encodeURIComponent(row.code):''}${row&&['paths','areas'].includes(s.tab)?'&object='+s.tab+'&uid='+encodeURIComponent(row.uid):''}${row&&s.tab==='plans'?'&planId='+row.id:''}`;}
  function showMap(row){if(!s.mapId)return;window.top.location.href=mapUrl(row);}
  let submitAction=null;
  function rememberMap(){if(!s.mapId)return;localStorage.setItem('orange.currentRouteMap',String(s.mapId));const url=new URL(location.href);url.searchParams.set('mapId',s.mapId);history.replaceState(null,'',url);}
  function dialog(title,html,handler,label='保存草稿'){$('dialog-title').textContent=title;$('dialog-fields').innerHTML=html;$('dialog-error').textContent='';$('dialog-submit').textContent=label;$('dialog-submit').hidden=!handler;submitAction=handler;$('resource-dialog').showModal();}
  function field(name,label,value='',type='text',attributes=''){return `<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" ${attributes}></label>`;}
  function select(name,label,options,value){return `<label>${label}<select name="${name}">${options.map(([v,t])=>`<option value="${escape(v)}" ${String(v)===String(value)?'selected':''}>${escape(t)}</option>`).join('')}</select></label>`;}
  function edit(row){
    if(!s.data)return;const kind=s.tab,mapId=s.mapId,revision=s.data.map.revision,item=row?structuredClone(row):{};
    let form='';
    if(kind==='points')form=field('code','站点编号',item.code||'','text','required pattern="[a-zA-Z0-9_-]{1,80}" maxlength="80"')+field('name','站点名称',item.name||'','text','maxlength="128"')+select('type','用途',['station','waiting','shelf','charger','elevator'].map(t=>[t,types[t]]),item.type||'station')+field('x','X（米）',item.x??0,'number','required step="0.01"')+field('y','Y（米）',item.y??0,'number','required step="0.01"')+field('theta','朝向（度）',((item.theta||0)*180/Math.PI).toFixed(2),'number','required step="0.1"');
    if(kind==='paths'){const points=s.data.document.points.map(p=>[p.code,`${p.code} · ${p.name||'未命名'}`]);form=select('start','起点',points,item.start)+select('end','终点',points,item.end)+select('bidirectional','通行方向',[[true,'双向'],[false,'单向']],item.bidirectional??true)+field('speed','速度上限（米/秒）',item.speed??0.5,'number','required min="0.01" max="3" step="0.01"')+field('width','通道宽度（米）',item.width??1,'number','required min="0.01" max="20" step="0.01"');}
    if(kind==='areas')form=field('name','区域名称',item.name,'text','required maxlength="128"')+select('type','区域类型',['forbidden','slow','work','charge'].map(t=>[t,types[t]]),item.type)+field('speed','区域速度（仅减速区生效，米/秒）',item.speed??0.3,'number','required min="0.01" max="3" step="0.01"')+'<p>区域边界请通过“在地图查看”编辑。</p>';
    dialog(`${row?'编辑':'添加'}${tabs[kind][0]}`,`<div class="form-grid">${form}</div><p class="dialog-help">${escape(s.data.map.name)} · 保存到草稿；当前执行与已发布版本保持原样。</p>`,async data=>{
      const values=Object.fromEntries(data);for(const name of ['x','y','speed','width'])if(name in values)values[name]=Number(values[name]);
      if('theta' in values)values.theta=Number(values.theta)*Math.PI/180;if('bidirectional' in values)values.bidirectional=values.bidirectional==='true';
      if(kind==='paths'&&values.start===values.end)throw Error('路线起点和终点不能相同');
      const url=`/api/maps/${mapId}/resources/${kind}`+(row?'/'+encodeURIComponent(row.uid):'');
      await api[row?'put':'post'](url,{revision,item:{...item,...values}});notice('已保存草稿；发布后用于后续任务');await store.refresh();
    });
  }
  async function remove(row){
    const kind=s.tab,mapId=s.mapId,impact=await api.get(`/api/maps/${mapId}/resources/${kind}/${row.uid}/impact`);
    if(mapId!==s.mapId||kind!==s.tab)return;
    const refs=`<p>相连路线：${impact.paths.length} 条 · 引用任务链：${impact.plans.length} 个</p>${impact.paths.length?`<ul>${impact.paths.map(p=>`<li>${escape(p.name)}</li>`).join('')}</ul>`:''}${impact.plans.length?`<ul>${impact.plans.map(p=>`<li>${escape(p.name)}</li>`).join('')}</ul>`:''}`;
    if(impact.blocked){dialog('请先处理任务链引用',`<p>${escape(impact.name)} 仍被以下任务链使用，暂不能删除。</p>${refs}`,null);return;}
    dialog('删除'+tabs[kind][0],`<p>${escape(impact.name)}</p>${refs}<p>${escape(impact.scope)}</p>${impact.paths.length?'<label class="check"><input type="checkbox" name="cascade" required>同时移除这些草稿路线，其他站点保留</label>':''}${field('confirmation','输入上方对象名称确认删除','','text','required autocomplete="off"')}`,async data=>{
      if(data.get('confirmation')!==impact.name)throw Error('确认名称不一致');
      await api.post(`/api/maps/${mapId}/resources/${kind}/${row.uid}/delete`,{revision:impact.revision,confirmation:impact.name,cascade_paths:data.get('cascade')==='on'});notice('已从草稿删除，已发布版本与历史记录保留');await store.refresh();
    },'确认删除');
  }
  $('resource-form').onsubmit=async event=>{event.preventDefault();if(!submitAction)return;$('dialog-submit').disabled=true;$('dialog-cancel').disabled=true;$('dialog-close').disabled=true;try{await submitAction(new FormData(event.target));$('resource-dialog').close();}catch(error){$('dialog-error').textContent=error.message;}finally{$('dialog-submit').disabled=false;$('dialog-cancel').disabled=false;$('dialog-close').disabled=false;}};
  $('resource-dialog').addEventListener('cancel',event=>{if($('dialog-submit').disabled)event.preventDefault();});
  $('dialog-close').onclick=$('dialog-cancel').onclick=()=>$('resource-dialog').close();
  $('map-select').onchange=async event=>{notice('');await store.select(event.target.value);rememberMap();};
  $('resource-tabs').onclick=event=>{const button=event.target.closest('[data-tab]');if(!button)return;s.tab=button.dataset.tab;s.page=1;s.keyword='';s.type='';s.selected=null;render();};
  $('search').oninput=event=>{s.keyword=event.target.value;s.page=1;render();$('search').focus();};$('type-filter').onchange=event=>{s.type=event.target.value;s.page=1;render();};
  $('previous').onclick=()=>{s.page--;render();};$('next').onclick=()=>{s.page++;render();};$('refresh').onclick=()=>store.refresh();$('back-map').onclick=()=>showMap();
  $('create').onclick=()=>['areas','plans'].includes(s.tab)?showMap():edit();
  document.addEventListener('click',async event=>{const target=event.target.closest('[data-select],[data-edit],[data-delete],[data-show-map],[data-version],[data-download],[data-retry]');if(!target)return;try{
    if(target.hasAttribute('data-select')){s.selected=target.dataset.select;render();}
    if(target.hasAttribute('data-edit'))edit(find(target.dataset.edit));
    if(target.hasAttribute('data-delete'))await remove(find(target.dataset.delete));
    if(target.hasAttribute('data-show-map'))showMap(find(s.selected));
    if(target.hasAttribute('data-retry'))await store.refresh();
    if(target.hasAttribute('data-version')){const version=find(s.selected),versions=await api.get(`/api/maps/${s.mapId}/versions`),snapshot=versions.find(v=>v.version===version.version);dialog(`已发布 v${version.version}`,`<p>操作人：${escape(version.operator)}</p><table><thead><tr><th>对象</th><th>此版本</th><th>当前草稿</th></tr></thead><tbody>${['points','paths','areas'].map(kind=>`<tr><td>${tabs[kind][0]}</td><td>${snapshot.document[kind].length}</td><td>${s.data.document[kind].length}</td></tr>`).join('')}</tbody></table><p>运行任务使用启动时的发布版本；该视图不会回滚地图。</p>`,null);}
    if(target.hasAttribute('data-download')){const row=find(s.selected),path=row.kind==='png'?`/api/maps/${s.mapId}/image/${row.digest}`:`/api/map-workbench/file/${row.kind}/${encodeURIComponent(row.asset_id)}`,blob=await api.download(path),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${row.name}.${row.kind}`;link.click();URL.revokeObjectURL(url);}
  }catch(error){notice(error.message,true);}});
  store.load(new URLSearchParams(location.search).get('mapId')||localStorage.getItem('orange.currentRouteMap')).then(()=>{
    rememberMap();const query=new URLSearchParams(location.search),tab=query.get('tab');
    if(Object.hasOwn(tabs,tab))s.tab=tab;
    const found=currentRows().find(row=>key(row)===query.get('uid')||s.tab==='points'&&row.code===query.get('point'));
    if(found){s.selected=key(found);s.page=Math.floor(currentRows().indexOf(found)/20)+1;}render();
  }).catch(error=>{s.loading=false;s.error=error.message;render();notice(error.message,true);});
})();
