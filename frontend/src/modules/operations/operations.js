(function () {
  'use strict';
  const api = window.OpsAPI, $ = id => document.getElementById(id);
  const newId = () => globalThis.crypto?.randomUUID?.() || `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels = {idle:'空闲',busy:'任务中',charging:'充电中',offline:'离线',disabled:'停用',maintenance:'维护',emergency:'急停',locked:'锁定',open:'未确认',acknowledged:'已确认',closed:'已关闭',queued:'排队',dispatched:'已下发',running:'执行中',stop_requested:'请求停止',success:'成功',failed:'失败',cancelled:'已取消',timeout:'超时',pending:'待执行',paused:'已暂停',pausing:'正在停车',resuming:'正在继续',unknown:'状态待核实',completed:'已完成',partial_failed:'部分失败',uploading:'上传中',review:'待审核',released:'已发布',waiting:'等待',skipped:'跳过',retry:'等待重试',dead:'重试耗尽',sending:'发送中',rolled_back:'已回滚',rolling_back:'回滚中',downloading:'下载中',verifying:'校验中',flashing:'刷写中',rebooting:'重启中',critical:'严重',warning:'警告',info:'提示'};
  const modules = [
    ['dashboard','运营看板','dashboard:view','dashboard'],['robots','机器人管理','robot:view','robot'],['battery','电量监控','battery:view','battery'],
    ['alarms','报警中心','alarm:view','alert'],['tasks','任务历史','task:view','tasks'],['logs','日志中心','log:view','logs'],
    ['maps','实时地图 / 线路编辑','map:view','route'],['integration','WMS 对接','integration:manage','integration'],['firmware','固件库','firmware:view','package'],['upgrades','升级任务','firmware:view','upgrade']
  ];
  const navIcons = {
    dashboard:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>',
    robot:'<rect x="5" y="7" width="14" height="13" rx="3"/><path d="M12 3v4M9 12h.01M15 12h.01M9 16h6"/>',
    battery:'<rect x="3" y="7" width="17" height="10" rx="2"/><path d="M22 10v4M7 10v4M11 10v4M15 10v4"/>',
    alert:'<path d="m12 3 9 16H3L12 3Z"/><path d="M12 9v4M12 16h.01"/>',
    tasks:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5h6M9 10h6M9 14h6M9 18h3"/>',
    logs:'<path d="M8 5h13M8 10h13M8 15h13M8 20h13"/><circle cx="4" cy="5" r=".6"/><circle cx="4" cy="10" r=".6"/><circle cx="4" cy="15" r=".6"/><circle cx="4" cy="20" r=".6"/>',
    route:'<path d="M5 19c0-4 5-4 5-8s-5-3-5-7M19 5c0 4-5 4-5 8s5 3 5 7"/><circle cx="5" cy="4" r="1.5"/><circle cx="19" cy="20" r="1.5"/>',
    integration:'<path d="M9 7V4M15 7V4M7 7h10v5a5 5 0 0 1-10 0V7ZM12 17v3M9 20h6"/>',
    package:'<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/>',
    upgrade:'<path d="M12 16V4M7 9l5-5 5 5M4 15v5h16v-5"/>'
  };
  const navIcon = name => `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">${navIcons[name]||navIcons.dashboard}</svg>`;
  const state = {tab:'dashboard', page:1, rows:[], robots:[], mapTasks:[], mapTaskTotal:0, mapMissionPlans:[], mapMissionRuns:[], taskMode:'manual', taskModeReady:false, taskModePending:false, taskModeEpoch:0, taskModeMessage:'', taskModeError:false, selectedMissionId:null, permissions:[], monitor:null, map:null, mapRow:null, mapChoices:[], selectedMapId:'', preferredAssetKey:new URLSearchParams(location.search).get('asset')||'', dirty:false, saveTimer:null, lockTimer:null, mapTaskTimer:null, viewTimer:null, loadId:0, logBefore:null, logStack:[], relocalizeConfirmationOpen:false};
  const can = permission => state.permissions.includes('*') || state.permissions.includes(permission);
  const stamp = value => value ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value+'Z').toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '—';
  const badge = value => `<span class="badge ${['success','completed','idle','released','closed'].includes(value)?'good':['failed','timeout','critical','emergency','dead'].includes(value)?'bad':['queued','busy','charging','warning','stop_requested'].includes(value)?'warn':''}">${escape(labels[value]||value)}</span>`;
  const button = (label, action, id, permission, cls='') => !permission||can(permission)?`<button class="${cls}" data-action="${action}" data-id="${escape(id)}">${label}</button>`:'';
  function taskMotionStatus(task){return ['dispatched','running'].includes(task.status)&&task.motion_state&&task.motion_state!=='running'?task.motion_state:task.status;}
  function taskMotionBadge(task){return badge(taskMotionStatus(task));}
  function taskMotionControls(task){
    if(!can('robot:control')||!can('task:edit')||!['dispatched','running'].includes(task.status))return '';
    const motion=task.motion_state||'running';
    if(['pausing','resuming'].includes(motion))return `<button type="button" disabled>${motion==='pausing'?'正在停车，等待确认':'正在继续，等待确认'}</button>`;
    if(motion==='unknown')return '<span class="mission-error">停车状态待核实，请停止并锁定</span>';
    return motion==='paused'?button('继续路线','task-motion-resume',task.id,'robot:control','task-resume'):button('暂停路线','task-motion-pause',task.id,'robot:control','task-pause');
  }
  function notify(message,error=false){
    const hint=document.getElementById('map-tool-hint');
    if(document.documentElement.classList.contains('embedded')&&state.map&&hint){hint.textContent=message;hint.classList.toggle('error',error);return;}
    $('notice').hidden=false;$('notice').className=error?'error':'';$('notice').textContent=message;
  }
  function clearNotice(){$('notice').hidden=true;document.getElementById('map-tool-hint')?.classList.remove('error');}
  function filterParams(){const params={keyword:$('keyword').value,state:$('state').value,pageNo:state.page,pageSize:20};for(const key of ['start','end'])if($(key).value)params[key]=new Date($(key).value).toISOString();return params;}
  function table(headers, rows){return rows.length?`<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<div class="panel empty">暂无数据<br>数据接入后将在此显示</div>';}
  function paginate(total){$('pagination').innerHTML=`<span>共 ${total} 条 · 第 ${state.page} 页</span><button id="prev" ${state.page<=1?'disabled':''}>上一页</button><button id="next" ${state.page*20>=total?'disabled':''}>下一页</button>`;$('prev').onclick=()=>{state.page--;load();};$('next').onclick=()=>{state.page++;load();};}
  function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function battery(row){const value=row.telemetry?.battery;return value==null?'—':`<span data-battery="${row.id}" class="battery ${row.is_low?'low':''}"><i><b style="width:${Math.max(0,Math.min(100,value))}%"></b></i>${value}% ${row.telemetry.charging?'⚡':''}</span>${!row.online?'<span class="sub">最后已知电量</span>':''}`;}
  function field(name,label,value='',type='text',extra=''){return `<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;}
  function selectField(name,label,options,value=''){return `<label>${label}<select name="${name}">${options.map(([v,l])=>`<option value="${escape(v)}" ${String(v)===String(value)?'selected':''}>${escape(l)}</option>`).join('')}</select></label>`;}
  function dialog(title,html,handler,submit='保存'){
    $('dialog-title').textContent=title;$('dialog-body').innerHTML=html;$('dialog-error').textContent='';$('dialog-submit').hidden=!handler;$('dialog-submit').textContent=submit;
    $('dialog-form').onsubmit=async event=>{event.preventDefault();if(!handler)return;const submitButton=$('dialog-submit'),saveOnly=$('mission-save-only');submitButton.disabled=true;if(saveOnly)saveOnly.disabled=true;try{const close=await handler(new FormData(event.target));if(close!==false){$('dialog').close();await load();}}catch(error){$('dialog-error').textContent=error.message;}finally{submitButton.disabled=false;if(saveOnly)saveOnly.disabled=false;}};
    $('dialog').showModal();
  }
  function details(title,row){dialog(title,`<pre>${escape(JSON.stringify(row,null,2))}</pre>`,null);}
  function confirmation(title,expected,explanation,handler){dialog(title,`<p>${escape(explanation)}</p><p class="help">请输入「${escape(expected)}」确认。</p>${field('confirmation','确认名称/编号','','text','required autocomplete="off"')}`,data=>handler(data.get('confirmation')),'确认操作');}
  function chart(series){
    const entries=Object.entries(series),max=Math.max(1,...entries.map(([,v])=>Object.values(v).reduce((a,b)=>a+b,0)));
    return `<svg class="chart" viewBox="0 0 560 220" role="img" aria-label="最近七天任务数量">${entries.map(([day,counts],i)=>{const count=Object.values(counts).reduce((a,b)=>a+b,0),x=35+i*(480/Math.max(1,entries.length)),h=count/max*155;return `<rect x="${x}" y="${180-h}" width="35" height="${h}" rx="3" fill="#e9945d"/><text x="${x}" y="${170-h}">${count}</text><text x="${x}" y="202">${escape(day)}</text>`;}).join('')}</svg>`;
  }
  async function dashboard(){
    const data=await api.get('/api/dashboard/kpi');
    return `<div class="cards">${data.metrics.map(m=>`<article class="card" title="${escape(window.OperationsLayout.metricHint(m.key))}"><p>${escape(m.name)}</p><strong>${m.value??'—'}</strong><em>${escape(m.unit)}</em><small>${escape(window.OperationsLayout.metricHint(m.key))}</small></article>`).join('')}</div><div class="panels"><article class="panel"><h2>近七天任务趋势</h2>${Object.keys(data.trend).length?chart(data.trend):'<p class="empty">尚无任务执行记录</p>'}</article><article class="panel"><h2>机器人状态分布</h2>${Object.entries(data.status).map(([status,count])=>`<div class="bar-row"><span>${escape(labels[status]||status)}</span><div class="bar"><i style="width:${count/Math.max(1,state.robots.length)*100}%"></i></div><b>${count}</b></div>`).join('')||'<p class="empty">尚未添加机器人</p>'}</article></div><details class="operations-insights"><summary>更多统计与运行说明</summary><div class="panels"><article class="panel"><h2>七天任务热力 · 周一至周日 / 0—23 时</h2><div class="heat">${Array.from({length:168},(_,i)=>{const count=data.heat[`${Math.floor(i/24)}-${i%24}`]||0;return `<i title="周${Math.floor(i/24)+1} ${i%24}时：${count} 单" style="${count?`background:rgba(235,117,40,${Math.min(1,.25+count/20)})`:''}"></i>`;}).join('')}</div><p class="help">按北京时间统计；暂无可计算数据时显示 —。${data.trend_truncated?'趋势超过 10 万条，已截断。':''}</p></article><article class="panel"><h2>运行提示</h2><p class="help">设备状态来自已认证心跳。操作指令需要设备回执后才会显示成功。连接中断时会自动尝试刷新状态。</p><p class="help">上次统计：${stamp(data.updated_at)}</p></article></div></details>`;
  }
  function controls(){
    const actions={robots:button('导出档案','export-robots','','robot:view')+button('导入档案','import-robots','','robot:import')+button('新增机器人','add-robot','', 'robot:edit')+button('批量回充','batch-charge','','robot:control'),battery:button('低电量回充','batch-charge','','robot:control'),tasks:button('统计分析','task-stats','','task:view')+button('创建任务','add-task','','task:edit'),logs:button('下载 CSV','export-logs','','log:export'),maps:button('选择已有 PGM','open-pgm-map','','map:edit')+button(state.preferredAssetKey?'基于当前 PGM 新建地图':'新建地图','add-map','','map:edit','primary'),integration:button('新增应用','add-app','','integration:manage')+button('回调记录','callbacks','','integration:manage')+button('接口文档','api-doc','','integration:manage'),firmware:button('上传固件','upload-firmware','','firmware:upload'),upgrades:button('创建升级任务','add-upgrade','','firmware:upgrade')};
    $('actions').innerHTML=actions[state.tab]||'';
  }
  async function load(){
    const loadId=++state.loadId,tab=state.tab;
    if(state.map)return;
    controls();$('pagination').innerHTML='';
    try{
      const params=filterParams();let html='',data;
      if(tab==='dashboard')html=await dashboard();
      else if(tab==='robots'||tab==='battery'){
        data=await api.get('/api/robots',params);
        html=table(['编号 / 名称','机型 / 区域','状态','电量','当前版本','最后心跳','操作'],data.list.map(r=>[`${escape(r.code)}<span class="sub">${escape(r.name)}</span>`,`${escape(r.model)}<span class="sub">${escape(r.area)}</span>`,`<span data-robot-status="${r.id}">${badge(r.status)}</span>`,battery(r),escape(r.firmware||'—'),stamp(r.heartbeat),button('详情','robot-detail',r.id,'robot:view')+button('电量','battery-detail',r.id,'battery:view')+button('策略','policy',r.id,'battery:config')+button('指令','command',r.id,'robot:control')+button('编辑','edit-robot',r.id,'robot:edit')]));
      }else if(tab==='alarms'){
        data=await api.get('/api/alarms',params);
        html=table(['时间','等级','机器人','报警','状态','处理'],data.list.map(r=>[stamp(r.created_at),badge(r.level),escape(r.robot_id??'系统'),`${escape(r.title)}<span class="sub">${escape(r.code)}</span>`,badge(r.status),button('详情','detail',r.id)+ (r.status==='open'?button('确认','ack',r.id,'alarm:handle'):r.status==='acknowledged'?button('关闭','close-alarm',r.id,'alarm:handle'):'')]));
      }else if(tab==='tasks'){
        data=await api.get('/api/task-history',params);
        html=table(['任务','来源 / 外部单号','机器人','起点 → 终点','状态','创建时间','操作'],data.list.map(r=>[escape(r.name),`${escape(r.source)}<span class="sub">${escape(r.external_id||'')}</span>`,escape(r.robot_id||'等待分配'),`${escape(r.from_point)} → ${escape(r.to_point)}`,taskMotionBadge(r),stamp(r.created_at),button('时间轴','task-detail',r.id)+(r.status==='queued'?button('取消','cancel-task',r.id,'task:edit'):['dispatched','running'].includes(r.status)&&can('robot:control')?taskMotionControls(r)+button('停止并锁定','stop-task',r.id,'task:edit','danger'):'')]));
      }else if(tab==='logs'){
        data=await api.get('/api/logs',{...params,level:params.state,before:state.logBefore});
        html=table(['时间','等级','模块','操作人','消息','详情'],data.list.map(r=>[stamp(r.created_at),badge(r.level),escape(r.module),escape(r.operator),escape(r.message.slice(0,140)),button('详情','detail',r.id)]));
        $('pagination').innerHTML=`<button id="log-prev" ${state.logStack.length?'':'disabled'}>上一页</button><button id="log-next" ${data.next?'':'disabled'}>更早日志</button>`;
        $('log-next').onclick=()=>{state.logStack.push(state.logBefore);state.logBefore=data.next;load();};$('log-prev').onclick=()=>{state.logBefore=state.logStack.pop();load();};
      }else if(tab==='maps'){
        data=await api.get('/api/maps',params);
        const choices=await api.get('/api/maps',{pageNo:1,pageSize:100});
        state.mapChoices=choices.list||[];
        if(!state.mapChoices.some(map=>String(map.id)===String(state.selectedMapId)))state.selectedMapId='';
        html=!data.list.length&&document.documentElement.classList.contains('embedded')
          ?emptyMapMarkup()
          :window.OperationsMapPicker.render(state.mapChoices,can('map:edit'),state.selectedMapId)+table(['地图名称','草稿修订','发布版本','点位 / 路径 / 区域','更新人','操作'],data.list.map(r=>[escape(r.name),r.revision,r.published_version||'未发布',`${r.draft.points.length} / ${r.draft.paths.length} / ${r.draft.areas.length}`,escape(r.operator),button('打开编辑器','edit-map',r.id,'map:edit')+button('版本','map-versions',r.id,'map:view')+button('导出','export-map',r.id,'map:view')+button('删除','delete-map',r.id,'map:edit','danger')]));
      }else if(tab==='integration'){
        data=await api.get('/api/integration/apps');
        html=table(['应用编号','名称','状态','IP 白名单','回调地址','操作'],data.list.map(r=>[escape(r.code),escape(r.name),badge(r.enabled?'idle':'disabled'),escape(r.ips.join(', ')),escape(r.callback_url||'未配置'),button(r.enabled?'停用':'启用','toggle-app',r.id,'integration:manage')+button('重置密钥','rotate-secret',r.id,'integration:manage')]));
      }else if(tab==='firmware'){
        data=await api.get('/api/firmware',params);
        html=table(['固件名称','机型 / 版本','大小','状态','上传人 / 审核人','操作'],data.list.map(r=>[escape(r.name),`${escape(r.model)} / ${escape(r.version)}`,(r.size/1024/1024).toFixed(2)+' MB',(r.status==='offline'?badge('已下架'):badge(r.status)),`${escape(r.operator)} / ${escape(r.auditor||'—')}`,button('详情','detail',r.id)+(r.status==='review'?button('审核','audit-firmware',r.id,'firmware:audit'):'')+(r.status==='released'?button('下架','offline-firmware',r.id,'firmware:audit'):'')]));
      }else if(tab==='upgrades'){
        data=await api.get('/api/upgrade/tasks');
        html=table(['升级任务','固件包','批次大小','间隔','状态','操作'],data.list.map(r=>[escape(r.name),r.package_id,r.batch_size,r.interval_seconds+' 秒',badge(r.status),button('进度','upgrade-detail',r.id,'firmware:view')+ ['start','pause','resume','cancel','retry','rollback'].map(a=>button({start:'启动',pause:'暂停',resume:'继续',cancel:'取消',retry:'重试',rollback:'回滚'}[a],`upgrade-${a}`,r.id,'firmware:upgrade')).join('')]));
      }
      if(loadId!==state.loadId||tab!==state.tab)return;
      if(data?.list)state.rows=data.list;
      $('content').innerHTML=html;window.OrangeMappingPreview?.refresh();
      if(tab==='maps'){
        if($('map-editor')&&!state.map)renderMapRobot();
        const picker=$('existing-map-picker'),open=$('open-selected-map');
        if(picker&&open){
          picker.onchange=()=>{state.selectedMapId=picker.value;open.dataset.id=picker.value;open.disabled=!picker.value;};
          open.dataset.id=picker.value;open.disabled=!picker.value;
        }
      }
      if(data?.total!==undefined&&['robots','battery','alarms','tasks','maps'].includes(tab))paginate(data.total);
      $('updated').textContent='更新于 '+new Date().toLocaleTimeString('zh-CN');
    }catch(error){if(loadId===state.loadId)notify(error.message,true);}
  }
  async function robotForm(row){
    const maps=(await api.get('/api/maps',{pageSize:100})).list;
    dialog(row?'编辑机器人':'新增机器人',`<div class="form-grid">${field('code','机器人编号',row?.code||'','text','required')}${field('name','名称',row?.name||'','text','required')}${field('model','机型',row?.model||'','text','required')}${field('area','区域',row?.area||'')}${field('ip','IP 地址',row?.ip||'')}${field('hardware','硬件版本',row?.hardware||'')}${field('firmware','当前固件版本',row?.firmware||'')}${selectField('map_id','绑定地图',[['','未绑定'],...maps.map(m=>[m.id,m.name])],row?.map_id||'')}${selectField('enabled','是否启用',[['true','启用'],['false','停用']],String(row?.enabled??true))}</div>`,async form=>{
      const data=Object.fromEntries(form);data.map_id=data.map_id?Number(data.map_id):null;data.enabled=data.enabled==='true';
      const result=row?await api.put(`/api/robots/${row.id}`,data):await api.post('/api/robots',data);
      if(result.device_key){$('dialog').close();details('设备接入密钥（仅显示一次，请保存）',{robot_id:result.id,device_key:result.device_key,telemetry:`/api/devices/${result.id}/telemetry`});await load();return false;}
    });
  }
  async function taskForm(){
    const maps=(await api.get('/api/maps',{pageSize:100})).list.filter(m=>m.published_version&&String(m.id)===String(state.mapRow?.id));
    if(!maps.length)throw new Error('请先保存并发布当前线路地图，通过校验后才能创建导航任务');
    const currentMap=maps.find(map=>String(map.id)===String(state.mapRow?.id));
    const publishedVersion=Number(currentMap.published_version);
    const versions=await api.get(`/api/maps/${currentMap.id}/versions`);
    const publishedDocument=versions.find(version=>Number(version.version)===publishedVersion)?.document;
    if(!publishedDocument)throw new Error('没有找到当前已发布的地图版本，请刷新后重试');
    const points=publishedDocument.points||[];
    if(points.length<2)throw new Error('当前地图至少需要两个站点才能创建导航任务');
    const pointOptions=points.map(point=>[point.code,`${point.code} · ${point.name||'未命名站点'}`]);
    const first=points[0]?.code||'',last=points.find(point=>point.code!==first)?.code||first;
    const fromField=pointOptions.length?selectField('from_point','起点站点',pointOptions,first):field('from_point','起点编号','','text','required');
    const toField=pointOptions.length?selectField('to_point','终点站点',pointOptions,last):field('to_point','终点编号','','text','required');
    dialog('新建导航任务',`<p class="help">只使用已发布的线路地图。任务入队后会按机器人在线、空闲和设备协议状态下发；请核对现场状态再确认。</p><div class="form-grid">${field('name','任务名称','','text','required')}${selectField('map_id','已发布地图',maps.map(m=>[m.id,m.name]),currentMap?.id||maps[0].id)}${fromField}${toField}${field('priority','任务优先级（1—9）',5,'number','min="1" max="9" required')}${selectField('robot_id','机器人',[['','自动分配'],...state.robots.map(r=>[r.id,`${r.code} · ${labels[r.status]||r.status}`])])}</div><label class="wide" style="display:flex;align-items:flex-start;gap:9px"><input name="dispatch_confirmed" type="checkbox" required style="width:auto;margin-top:4px"> 我已核对地图、起终点及机器人；任务可能在机器人空闲后自动下发。</label>`,form=>{if(form.get('dispatch_confirmed')!=='on')throw new Error('请先确认地图、起终点和自动下发说明');const task=Object.fromEntries(form);delete task.dispatch_confirmed;return api.post('/api/task-history',{...task,map_id:Number(form.get('map_id')),priority:Number(form.get('priority')),robot_id:form.get('robot_id')?Number(form.get('robot_id')):null});},'确认并创建');
  }
  function renderMapTasks(){
    const list=$('map-task-list'),count=$('map-task-count');if(!list||!count)return;
    if(!can('task:view')){list.innerHTML='<p class="map-list-empty">当前账号没有任务查看权限</p>';count.textContent='—';return;}
    count.textContent=String(state.mapTaskTotal);
    list.innerHTML=state.mapTasks.map(task=>`<div class="map-task-entry"><button type="button" class="map-task-row" data-action="map-task-detail" data-id="${task.id}"><span><strong>${escape(task.name)}</strong><small>${escape(task.from_point)} → ${escape(task.to_point)}</small></span>${taskMotionBadge(task)}</button>${task.status==='queued'&&can('task:edit')?button('×','map-task-cancel',task.id,'task:edit','map-task-cancel-button'):''}</div>`).join('')||'<p class="map-list-empty">暂无任务记录</p>';
    const active=state.mapTasks.find(task=>String(task.map_id)===String(state.mapRow?.id)&&['dispatched','running','stop_requested'].includes(task.status));
    $('map-task-active').classList.toggle('has-active-task',!!active);
    $('map-task-active').innerHTML=active?`<strong>${escape(active.name)}</strong><span>${escape(active.from_point)} → ${escape(active.to_point)} · ${taskMotionBadge(active)}</span>${taskMotionControls(active)}${can('task:edit')&&can('robot:control')?button('停止并锁定','map-task-stop',active.id,'task:edit','danger'):''}`:'<span>当前没有正在执行的任务</span>';
    renderMapMissionExecution();
  }
  async function refreshMapTasks(){
    if(!state.map||!can('task:view'))return;
    const mapId=state.mapRow.id;
    try{const data=await api.get('/api/task-history',{pageNo:1,pageSize:6,map_id:mapId,exclude_missions:true});if(!state.map||state.mapRow?.id!==mapId)return;state.mapTasks=data.list||[];state.mapTaskTotal=Number(data.total)||0;renderMapTasks();}
    catch(error){const list=$('map-task-list');if(list&&state.mapRow?.id===mapId)list.innerHTML=`<p class="map-list-empty">任务状态暂不可用：${escape(error.message)}</p>`;}
  }
  async function refreshRobotModel(){
    const editor=state.map;if(!editor)return;
    try{const model=await api.get('/api/robot-model');if(state.map===editor){editor.robotModel=model;editor.draw();}}
    catch(error){if(state.map===editor)editor.robotModel=null;}
  }
  function taskModeMarkup(){
    const options=[['auto','自动'],['manual','手动'],['schedule','调度']];
    const help='仅设置新任务链：手动逐步下发、自动连续执行、调度按时间执行；不切换底盘实体驾驶模式，正在执行的任务保持原有方式。';
    return `<div class="task-mode-switch" role="group" aria-label="新任务链执行方式" aria-busy="${state.taskModePending||!state.taskModeReady}" title="${help}"><span>${state.taskModeReady?'新任务':'读取中'}</span>${options.map(([mode,label])=>`<button type="button" data-action="task-mode-set" data-id="${mode}" title="${label}：${mode==='manual'?'每一步人工下发':mode==='auto'?'按顺序连续执行':'按计划时间开始'}；仅用于新任务链" aria-pressed="${state.taskModeReady&&state.taskMode===mode}" ${!state.taskModeReady||state.taskModePending||!can('robot:control')?'disabled':''}>${label}</button>`).join('')}<output id="task-mode-feedback" class="task-mode-feedback ${state.taskModeError?'error':''}" role="status" ${state.taskModeMessage?'':'hidden'}>${escape(state.taskModeMessage)}</output></div>`;
  }
  function renderTaskMode(){const switcher=document.querySelector('.task-mode-switch');if(switcher)switcher.outerHTML=taskModeMarkup();}
  async function changeTaskMode(mode){
    const labels={auto:'自动',manual:'手动',schedule:'调度'};
    if(!labels[mode])throw new Error('不支持的任务模式');
    if(!can('robot:control'))throw new Error('没有切换任务模式的权限');
    if(!state.taskModeReady)throw new Error('任务模式尚未读取，请稍后重试');
    if(state.taskModePending||mode===state.taskMode)return;
    state.taskModePending=true;state.taskModeMessage='';state.taskModeError=false;state.taskModeEpoch++;renderTaskMode();
    try{
      const result=await api.post('/api/task-mode',{mode,confirmation:'切换到'+labels[mode]});
      if(!labels[result.mode])throw new Error('服务器未返回有效任务模式，请刷新核对');
      state.taskMode=result.mode;state.taskModeMessage=`已设置「${labels[result.mode]}」，仅用于新任务`;
      notify(`新任务已设为「${labels[result.mode]}」；执行中的任务保持原有方式。`);
    }catch(error){state.taskModeMessage='切换未确认，请重试';state.taskModeError=true;throw error;}finally{state.taskModePending=false;state.taskModeEpoch++;renderTaskMode();}
  }
  function missionStateLabel(run){
    if(run.active_task?.motion_state==='unknown')return '停车状态待核实，请停止并锁定';
    if(run.status==='waiting_manual')return '等待人工下一步';
    if(run.status==='queued'&&run.task_mode==='schedule')return '等待调度';
    if(run.status==='pausing')return '正在停车，等待设备确认';
    if(run.status==='resuming')return '正在沿原路线继续';
    if(run.status==='finishing')return '末站等待中';
    return labels[run.status]||run.status;
  }
  function missionWaitSeconds(run){
    return run.next_at?Math.max(0,Math.ceil((new Date(/[zZ]|[+-]\d\d:\d\d$/.test(run.next_at)?run.next_at:run.next_at+'Z')-Date.now())/1000)):0;
  }
  function missionControls(run){
    const activeTask=run.active_task&&!['success','failed','cancelled','timeout'].includes(run.active_task.status)?run.active_task:null;
    let actions='';
    if(run.status==='waiting_manual'&&missionWaitSeconds(run)===0)actions+=button('下发下一步','mission-advance',run.id,'robot:control','mission-advance');
    if(run.status==='paused'&&activeTask?.motion_state!=='unknown')actions+=button(run.active_task?'继续原路线':'继续任务链','mission-resume',run.id,'robot:control','task-resume');
    if(['queued','running','waiting_manual'].includes(run.status))actions+=button(activeTask?'暂停路线':'暂停任务链','mission-pause',run.id,'robot:control','task-pause');
    if(['pausing','resuming'].includes(run.status))actions+='<button type="button" disabled>等待设备确认</button>';
    if(activeTask?.status==='stop_requested')actions+='<button type="button" disabled>等待停车确认</button>';
    else if(activeTask&&can('task:edit'))actions+=button(activeTask.status==='queued'?'撤销当前步骤':'停止并锁定','mission-stop-step',run.id,'robot:control','danger');
    if(!activeTask&&['queued','waiting_manual','running','paused','finishing'].includes(run.status))actions+=button('取消','mission-cancel',run.id,'robot:control','danger');
    return actions+button('时间轴','mission-run-detail',run.id,'task:view');
  }
  function renderMapMissionExecution(){
    const panel=$('map-mission-execution'),single=$('map-task-active');if(!panel||!single)return;
    const activeStates=['queued','running','waiting_manual','paused','pausing','resuming','finishing'];
    const run=state.mapMissionRuns.find(item=>String(item.id)===String(state.selectedMissionId))||state.mapMissionRuns.find(item=>activeStates.includes(item.status))||state.mapMissionRuns[0];
    if(single.classList.contains('has-active-task')&&run&&!activeStates.includes(run.status)){
      panel.hidden=true;single.hidden=false;return;
    }
    panel.hidden=!run;single.hidden=!!run;
    const repeatReadout=$('map-repeat-readout');if(repeatReadout)repeatReadout.textContent=run?(run.repeat_count===-1?'无限':String(run.repeat_count)):'未执行';
    if(!run)return;
    state.selectedMissionId=run.id;
    $('map-task-state').textContent=missionStateLabel(run);
    const total=run.repeat_count===-1?'∞':run.repeat_count,wait=missionWaitSeconds(run);
    const target=run.active_task?.to_point||run.steps?.[run.step_index]?.point;
    panel.innerHTML=`<strong>${escape(run.name)}</strong><div class="mission-execution-progress"><b>${run.cycles_completed||0}<small> / ${total} 轮</small></b><span>第 ${Math.min((run.step_index||0)+1,run.steps.length)} / ${run.steps.length} 步</span></div>${target?`<p>目标站点 <strong>${escape(target)}</strong></p>`:''}${run.scheduled_at&&run.status==='queued'?`<p>计划时间 ${stamp(run.scheduled_at)}</p>`:''}${wait&&['running','waiting_manual','finishing'].includes(run.status)?`<p>到站等待：剩余 ${wait} 秒</p>`:''}${run.failure?`<p class="mission-error">${escape(run.failure)}</p>`:''}<div class="mission-run-actions">${missionControls(run)}</div>`;
  }
  function renderMapMissions(){
    const plans=$('map-mission-plans'),runs=$('map-mission-runs');if(!plans||!runs)return;
    if(!can('task:view')){plans.innerHTML=runs.innerHTML='<p class="map-list-empty">当前账号没有任务查看权限</p>';return;}
    const expandedPlans=new Set(Array.from(plans.querySelectorAll('details[open][data-plan-id]')).map(item=>item.dataset.planId));
    plans.innerHTML=state.mapMissionPlans.map(plan=>{
      const stops=[plan.start_point,...(plan.steps||[]).map(step=>step.point)].join(' → ');
      const repeat=plan.repeat_count===-1?'∞':plan.repeat_count;
      return `<details class="mission-plan-row" data-plan-id="${plan.id}" ${expandedPlans.has(String(plan.id))?'open':''}><summary><strong>${escape(plan.name)}</strong><span>${repeat} 次</span></summary><div class="mission-plan-detail"><small>${escape(stops)}</small><small>${plan.steps?.length||0} 步 · 重复 ${repeat} 次</small><div class="mission-plan-actions">${button('编辑','mission-edit',plan.id,'task:edit')}${button('执行','mission-start-plan',plan.id,'robot:control','primary')}${button('删除','mission-delete-plan',plan.id,'task:edit','danger')}</div></div></details>`;
    }).join('')||'<p class="map-list-empty">先添加站点并发布地图，再创建可重复使用的任务链。</p>';
    runs.innerHTML=state.mapMissionRuns.map(run=>{
      const total=run.repeat_count===-1?'∞':run.repeat_count;
      const stepTotal=run.steps?.length||0;
      const progress=`${run.cycles_completed||0}/${total} 轮 · ${Math.min((run.step_index||0)+1,stepTotal)}/${stepTotal} 步`;
      const next=run.steps?.[run.step_index]?.point||run.start_point;
      const waitSeconds=missionWaitSeconds(run);
      const statusMarkup=`<span class="badge ${['failed','timeout'].includes(run.status)?'bad':['success','cancelled'].includes(run.status)?'good':'warn'}">${escape(missionStateLabel(run))}</span>`;
      return `<article class="mission-run-row"><div class="mission-run-head">${button(run.name,'mission-select',run.id,'task:view','mission-select')}${statusMarkup}</div><small>${escape(progress)} · ${run.task_mode==='schedule'?'定时':run.task_mode==='manual'?'手动逐步':'自动连续'}</small>${run.active_task?`<small>设备步骤：${escape(run.active_task.from_point)} → ${escape(run.active_task.to_point)} · ${escape(labels[taskMotionStatus(run.active_task)]||taskMotionStatus(run.active_task))}</small>`:''}${run.status==='waiting_manual'?`<small>下一站：${escape(next)}${waitSeconds?` · 等待 ${waitSeconds} 秒` : ''}</small>`:''}${run.status==='finishing'?`<small>末站等待：剩余 ${waitSeconds} 秒</small>`:''}${run.scheduled_at&&run.status==='queued'?`<small>计划时间：${stamp(run.scheduled_at)}</small>`:''}${run.failure?`<small class="mission-error">${escape(run.failure)}</small>`:''}<div class="mission-run-actions">${missionControls(run)}</div></article>`;
    }).join('');
    renderMapMissionExecution();
  }
  async function refreshMapMissions(){
    if(!state.map||!can('task:view'))return;
    const mapId=state.mapRow.id,modeEpoch=state.taskModeEpoch;
    try{
      const [plans,runs,mode]=await Promise.all([
        api.get('/api/task-plans',{map_id:mapId}),
        api.get('/api/mission-runs',{map_id:mapId,page_size:8}),
        api.get('/api/task-mode')
      ]);
      if(!state.map||state.mapRow?.id!==mapId)return;
      state.mapMissionPlans=plans||[];state.mapMissionRuns=runs||[];if(modeEpoch===state.taskModeEpoch&&!state.taskModePending&&['manual','auto','schedule'].includes(mode.mode)){state.taskMode=mode.mode;state.taskModeReady=true;}
      renderMapMissions();
      if(state.resourcePlanId){const selected=document.querySelector(`[data-plan-id="${Number(state.resourcePlanId)}"]`);if(selected){selected.open=true;state.resourcePlanId=null;}}
      renderTaskMode();
    }catch(error){const panel=$('map-mission-plans');if(panel&&state.mapRow?.id===mapId)panel.innerHTML=`<p class="map-list-empty">任务链状态暂不可用：${escape(error.message)}</p>`;}
  }
  async function missionDesigner(existing=null){
    const map=state.mapRow;
    if(!map?.published_version)throw new Error('请先保存、校验并发布这张地图，再创建任务链');
    const versions=await api.get(`/api/maps/${map.id}/versions`);
    const publishedDocument=versions.find(version=>Number(version.version)===Number(map.published_version))?.document;
    if(!publishedDocument)throw new Error('没有找到当前已发布的地图版本，请刷新后重试');
    const designerMode=state.taskMode;
    const points=publishedDocument.points||[],codes=new Set(points.map(point=>point.code));
    if(points.length<2)throw new Error('已发布地图至少需要两个站点');
    const pointLabel=code=>{const point=points.find(item=>item.code===code);return point?`${point.code} · ${point.name||'未命名站点'}`:code;};
    const outgoing=code=>{
      const reachable=new Set([code]),pending=[code];
      while(pending.length){const current=pending.pop();for(const path of publishedDocument.paths||[]){const next=path.start===current?path.end:path.bidirectional&&path.end===current?path.start:null;if(next&&codes.has(next)&&!reachable.has(next)){reachable.add(next);pending.push(next);}}}
      return points.map(point=>point.code).filter(next=>next!==code&&reachable.has(next));
    };
    let nodes=existing?.steps?.map(step=>({...step}))||[];
    const initial=existing?.start_point||points[0].code;
    const pointOptions=points.map(point=>[point.code,pointLabel(point.code)]);
    const robotOptions=[['','自动分配'],...state.robots.map(robot=>[robot.id,`${robot.code} · ${labels[robot.status]||robot.status}${robot.online?' · 在线':' · 离线'}`])];
    const priorityOptions=Array.from({length:9},(_,index)=>[index+1,String(index+1)]);
    const flowHtml=()=>{
      if(!nodes.length)return '<div class="mission-flow-empty">把“移动到站点”拖到这里，或点动作卡添加第一步。</div>';
      let previous=$('mission-start-point')?.value||initial;
      return nodes.map((node,index)=>{
        const choices=outgoing(previous);if(!choices.includes(node.point))node.point=choices[0]||'';
        const selected=choices.includes(node.point)?node.point:'';
        const html=`<article class="mission-step" draggable="true" data-node-index="${index}"><header><i>${String(index+1).padStart(2,'0')}</i><strong>移动到站点</strong><span>顺序连接</span><button type="button" data-node-remove="${index}" aria-label="删除第 ${index+1} 步">×</button></header><div class="mission-step-fields"><label>目标站点<select data-node-point="${index}" ${choices.length?'':'disabled'}>${choices.map(code=>`<option value="${escape(code)}" ${code===selected?'selected':''}>${escape(pointLabel(code))}</option>`).join('')}</select></label><label>到站等待（秒）<input data-node-delay="${index}" type="number" min="0" max="3600" step="1" value="${Number(node.delay_seconds)||0}"></label></div>${index<nodes.length-1?'<div class="mission-connector">↓ 自动连接到下一步</div>':''}</article>`;
        previous=selected;
        return html;
      }).join('');
    };
    const modeLabels={manual:'手动 · 每一步由操作员确认',auto:'自动 · 按顺序连续执行',schedule:'调度 · 到设定时间开始'};
    dialog(existing?'编辑任务链':'创建任务链',`<div class="mission-designer">
      <p class="help">按顺序添加目的站，设置到站等待和循环次数。每个动作到站后再执行下一步。</p>
      <div class="form-grid mission-plan-fields">${field('name','任务链名称',existing?.name||'','text','required maxlength="128"')}${selectField('robot_id','执行机器人',robotOptions,existing?.robot_id||'')}${selectField('start_point','起始站点',pointOptions,initial)}${field('repeat_count','重复次数',existing?.repeat_count===-1?1:existing?.repeat_count??1,'number','min="1" max="1000" step="1" required')}<label class="check mission-repeat-toggle"><input id="mission-repeat-infinite" type="checkbox" ${existing?.repeat_count===-1?'checked':''}>无限循环</label>${selectField('priority','任务优先级',priorityOptions,String(existing?.priority??5))}</div>
      <div id="mission-schedule-wrap" class="mission-schedule-wrap" ${designerMode==='schedule'?'':'hidden'}><label>计划执行时间<input id="mission-scheduled-at" name="scheduled_at" type="datetime-local" ${designerMode==='schedule'?'required':''}></label></div>
      <div class="mission-mode-note"><span>当前任务模式</span><strong>${modeLabels[designerMode]||modeLabels.manual}</strong><small>本次执行按此方式确认；模式改变后需重新打开确认。</small></div>
      <div class="mission-execution-lock"><strong>执行确认</strong><label>输入任务链名称<input name="execute_confirmation" type="text" autocomplete="off" placeholder="仅保存模板时无需填写"></label><small>保存并执行前核对名称；单击“只保存任务链”不需要确认。</small></div>
      <div class="mission-chain-layout"><section class="mission-action-palette"><h3>动作</h3><button type="button" class="mission-action-tile" draggable="true" id="mission-add-action">↗ 移动到站点</button><p>点击或拖入动作卡，按顺序连接。选择目的站后，机器人按地图路线行驶。</p><button type="button" id="mission-add-step">＋ 添加移动动作</button></section><section class="mission-flow-area"><header><strong>任务链</strong><span>起点 <b id="mission-start-label">${escape(pointLabel(initial))}</b></span></header><div id="mission-flow" class="mission-flow" aria-label="按顺序连接的导航动作"></div></section></div>
      <p id="mission-loop-hint" class="mission-loop-hint" aria-live="polite"></p>
      <button type="button" id="mission-save-only" class="mission-save-only">只保存任务链</button>
    </div>`,async form=>{
      const serialized=Array.from(document.querySelectorAll('#mission-flow [data-node-index]')).map((element,index)=>({node_id:nodes[index]?.node_id||newId(),action:'navigate',point:element.querySelector(`[data-node-point="${index}"]`)?.value||'',delay_seconds:Number(element.querySelector(`[data-node-delay="${index}"]`)?.value||0)}));
      if(!serialized.length)throw new Error('请至少添加一个移动到站点动作');
      if(serialized.some(step=>!step.point))throw new Error('有步骤没有可达的目标站点，请检查路线是否连通');
      const repeatCount=$('mission-repeat-infinite').checked?-1:Number(form.get('repeat_count'));
      const payload={name:String(form.get('name')).trim(),map_id:map.id,start_point:form.get('start_point'),steps:serialized,repeat_count:repeatCount,priority:Number(form.get('priority')),robot_id:form.get('robot_id')?Number(form.get('robot_id')):null};
      if(!payload.name)throw new Error('请填写任务链名称');
      if(!Number.isInteger(repeatCount)||repeatCount!==-1&&(repeatCount<1||repeatCount>1000))throw new Error('重复次数请输入 1—1000，或选择无限循环');
      if(!Number.isInteger(payload.priority)||payload.priority<1||payload.priority>9)throw new Error('任务优先级须为 1—9');
      if(String(form.get('execute_confirmation')||'').trim()!==payload.name)throw new Error('执行确认名称与任务链名称不一致');
      const scheduledInput=$('mission-scheduled-at')?.value;
      let scheduledAt=null;
      if(designerMode==='schedule'){
        if(!scheduledInput)throw new Error('调度模式需要设置执行时间');
        const scheduledDate=new Date(scheduledInput);
        if(!Number.isFinite(scheduledDate.getTime()))throw new Error('计划执行时间格式无效');
        scheduledAt=scheduledDate.toISOString();
      }
      let planId=Number($('dialog-body').dataset.missionPlanId)||existing?.id;
      const saved=planId?await api.put(`/api/task-plans/${planId}`,payload):await api.post('/api/task-plans',payload);
      $('dialog-body').dataset.missionPlanId=saved.id;
      const run=await api.post(`/api/task-plans/${saved.id}/runs`,{confirmation:payload.name,repeat_count:repeatCount,robot_id:payload.robot_id,scheduled_at:scheduledAt,task_mode:designerMode});state.selectedMissionId=run.id;
      notify(run.status==='waiting_manual'?'任务链已创建，等待手动下发第一步。':designerMode==='schedule'?'任务链已加入定时调度。':'任务链已加入自动执行队列。');
      await refreshMapMissions();return true;
    },'保存并执行');
    const body=$('dialog-body');body.dataset.missionPlanId=existing?.id||'';
    const flow=$('mission-flow'),startSelect=document.querySelector('#dialog-form [name="start_point"]');
    startSelect.id='mission-start-point';
    const renderFlow=()=>{
      $('mission-start-label').textContent=pointLabel(startSelect.value);
      $('mission-loop-hint').textContent=!$('mission-repeat-infinite').checked&&Number($('dialog-form').elements.repeat_count.value)===1?'单次执行：按任务链顺序完成所有导航步骤。':'重复执行必须形成闭环，最后一步必须回到起始站点。无限循环会持续执行，直到操作员停止。';
      flow.innerHTML=flowHtml();
    };
    const addStep=()=>{const previous=nodes.length?nodes[nodes.length-1].point:startSelect.value,choices=outgoing(previous);if(!choices.length){notify('当前站点没有连通的后续路线，请先在地图上补齐路线。',true);return;}nodes.push({node_id:newId(),action:'navigate',point:choices[0],delay_seconds:0});renderFlow();};
    renderFlow();
    $('mission-add-action').ondragstart=event=>event.dataTransfer.setData('text/plain','navigate');
    $('mission-add-action').onclick=addStep;
    flow.ondragover=event=>{event.preventDefault();flow.classList.add('drag-over');};
    flow.ondragleave=event=>{if(!flow.contains(event.relatedTarget))flow.classList.remove('drag-over');};
    flow.ondrop=event=>{event.preventDefault();flow.classList.remove('drag-over');if(event.dataTransfer.getData('text/plain')==='navigate')addStep();};
    $('mission-add-step').onclick=addStep;
    startSelect.onchange=renderFlow;
    $('dialog-form').elements.repeat_count.onchange=renderFlow;
    $('mission-repeat-infinite').onchange=()=>{const input=$('dialog-form').elements.repeat_count;input.disabled=$('mission-repeat-infinite').checked;renderFlow();};
    $('mission-repeat-infinite').onchange();
    flow.onchange=event=>{const point=event.target.closest('[data-node-point]');if(point){nodes[Number(point.dataset.nodePoint)].point=point.value;renderFlow();return;}const delay=event.target.closest('[data-node-delay]');if(delay)nodes[Number(delay.dataset.nodeDelay)].delay_seconds=Number(delay.value)||0;};
    flow.onclick=event=>{const remove=event.target.closest('[data-node-remove]');if(remove){nodes.splice(Number(remove.dataset.nodeRemove),1);renderFlow();return;}const move=event.target.closest('[data-node-move]');if(move){const from=Number(move.dataset.nodeMove),to=from+Number(move.dataset.direction);if(to>=0&&to<nodes.length){[nodes[from],nodes[to]]=[nodes[to],nodes[from]];renderFlow();}}};
    flow.ondragstart=event=>{const node=event.target.closest('[data-node-index]');if(!node)return;event.dataTransfer.setData('text/plain',`reorder:${node.dataset.nodeIndex}`);};
    flow.ondrop=event=>{event.preventDefault();flow.classList.remove('drag-over');const value=event.dataTransfer.getData('text/plain');if(value==='navigate'){addStep();return;}if(value.startsWith('reorder:')){const from=Number(value.slice(8)),to=Number(event.target.closest('[data-node-index]')?.dataset.nodeIndex);if(Number.isInteger(to)&&nodes[from]&&nodes[to]){const [node]=nodes.splice(from,1);nodes.splice(to,0,node);renderFlow();}}};
    $('mission-save-only').onclick=async()=>{const saveButton=$('mission-save-only');saveButton.disabled=true;$('dialog-submit').disabled=true;try{const form=new FormData($('dialog-form'));const steps=Array.from(flow.querySelectorAll('[data-node-index]')).map((element,index)=>({node_id:nodes[index]?.node_id||newId(),action:'navigate',point:element.querySelector(`[data-node-point="${index}"]`)?.value||'',delay_seconds:Number(element.querySelector(`[data-node-delay="${index}"]`)?.value||0)}));if(!steps.length||steps.some(step=>!step.point))throw new Error('请添加可达的站点步骤');const repeatCount=$('mission-repeat-infinite').checked?-1:Number(form.get('repeat_count')),priority=Number(form.get('priority'));if(!String(form.get('name')||'').trim())throw new Error('请填写任务链名称');if(!Number.isInteger(repeatCount)||repeatCount!==-1&&(repeatCount<1||repeatCount>1000))throw new Error('重复次数请输入 1—1000，或选择无限循环');if(!Number.isInteger(priority)||priority<1||priority>9)throw new Error('任务优先级须为 1—9');const payload={name:String(form.get('name')).trim(),map_id:map.id,start_point:form.get('start_point'),steps,repeat_count:repeatCount,priority,robot_id:form.get('robot_id')?Number(form.get('robot_id')):null};const id=Number(body.dataset.missionPlanId)||existing?.id;const saved=id?await api.put(`/api/task-plans/${id}`,payload):await api.post('/api/task-plans',payload);body.dataset.missionPlanId=saved.id;notify('任务链已保存，可以稍后从任务链列表执行。');await refreshMapMissions();}catch(error){$('dialog-error').textContent=error.message;}finally{saveButton.disabled=false;$('dialog-submit').disabled=false;}};
  }
  async function startSavedMission(plan){
    const modes={manual:'手动逐步下发',auto:'自动连续执行',schedule:'按计划时间执行'};
    const selectedMode=state.taskMode;
    const body={confirmation:plan.name,repeat_count:plan.repeat_count,robot_id:plan.robot_id||null,task_mode:selectedMode};
    if(selectedMode==='schedule'){
      return dialog('安排任务链',`<p>${escape(plan.name)} · ${escape(modes[state.taskMode])}</p><label>计划执行时间<input name="scheduled_at" type="datetime-local" required></label><label>执行确认（输入任务链名称）<input name="confirmation" type="text" required autocomplete="off"></label><p class="help">任务将在所选时间开始；设备离线或地图版本变化时会保留失败原因，不会重复执行未确认步骤。</p>`,async form=>{if(String(form.get('confirmation')||'').trim()!==plan.name)throw new Error('执行确认名称与任务链名称不一致');const scheduledAt=form.get('scheduled_at');if(!scheduledAt)throw new Error('请设置计划执行时间');const scheduledDate=new Date(scheduledAt);if(!Number.isFinite(scheduledDate.getTime()))throw new Error('计划执行时间格式无效');body.confirmation=plan.name;body.scheduled_at=scheduledDate.toISOString();const run=await api.post(`/api/task-plans/${plan.id}/runs`,body);state.selectedMissionId=run.id;notify('任务链已加入调度。');await refreshMapMissions();return true;},'确认调度');
    }
    return confirmation('执行任务链',plan.name,`模式：${modes[selectedMode]}。起点 ${plan.start_point}，共 ${plan.steps.length} 步，重复 ${plan.repeat_count===-1?'无限':plan.repeat_count+' 次'}。执行前请确认地图、机器人和现场状态。`,async confirmation=>{body.confirmation=confirmation;const run=await api.post(`/api/task-plans/${plan.id}/runs`,body);state.selectedMissionId=run.id;notify(run.status==='waiting_manual'?'任务链已创建，等待手动下发第一步。':'任务链已加入自动执行队列。');await refreshMapMissions();});
  }
  async function advanceMission(id){
    const run=state.mapMissionRuns.find(item=>String(item.id)===String(id));if(!run)throw new Error('任务链状态已更新，请刷新');
    return confirmation('手动下发下一步',run.name,`将下发任务链下一段导航。当前已完成 ${run.cycles_completed} 轮，执行位置 ${run.step_index+1}/${run.steps.length}。确认机器人周围安全且定位正常后继续。`,async confirmation=>{const updated=await api.post(`/api/mission-runs/${id}/advance`,{confirmation});notify(updated.status==='failed'?updated.failure||'任务链无法继续。':'下一步导航已下发，等待设备回执。',updated.status==='failed');await refreshMapMissions();});
  }
  function renderMapRobot(){
    const panel=$('map-robot-card');if(!panel)return;
    const robot=state.robots.find(item=>item.online)||state.robots[0];
    const stateChip=$('map-robot-state');if(stateChip){stateChip.className='map-state-chip '+(robot?.online?'good':'offline');stateChip.innerHTML=`<i></i>${robot?.online?'在线':'离线'}`;}
    if(!robot){panel.innerHTML=window.RcsConsole.robotPortrait()+'<div class="map-robot-summary"><strong>等待机器人连接</strong><small>电量 — · 状态未知</small></div>';return;}
    const batteryValue=robot.telemetry?.battery,level=batteryValue!=null&&Number.isFinite(Number(batteryValue))?Math.max(0,Math.min(100,Number(batteryValue))):null;
    panel.innerHTML=`${window.RcsConsole.robotPortrait()}<div class="map-robot-summary"><strong>${escape(robot.code)} · ${escape(robot.name)}</strong><small>${escape(labels[robot.status]||robot.status)} · ${robot.online?'在线':'离线'}</small><div class="map-battery"><i><b style="width:${level??0}%"></b></i><span>${level===null?'电量未知':level+'%'}${robot.telemetry?.charging?' · 充电中':''}</span></div></div>`;
  }
  function mapEditorMarkup(row){
    return window.RcsConsole.render({row,maps:state.mapChoices.length?state.mapChoices:[row],can,escape,taskModes:taskModeMarkup()});
  }
  function emptyMapMarkup(){
    return window.RcsConsole.render({row:{name:'地图工作台'},maps:[],can,escape,taskModes:taskModeMarkup(),empty:true});
  }

  async function openAssetMap(assetId){
    if(typeof assetId!=='string'||!assetId.trim())throw new Error('请先选择一个已有地图，或完成地图生成。');
    if(state.map&&!leaveMap())return;
    const row=await api.post('/api/map-workbench/route-map',{asset_id:assetId});
    state.preferredAssetKey=assetId;
    await openMap(row);
  }

  async function openMap(row){
    localStorage.setItem('orange.currentRouteMap',String(row.id));
    state.mapMissionPlans=[];state.mapMissionRuns=[];state.selectedMissionId=null;state.mapTasks=[];state.mapTaskTotal=0;
    clearInterval(state.mapTaskTimer);state.mapTaskTimer=null;
    await api.post(`/api/maps/${row.id}/lock`);state.mapRow=row;state.dirty=false;
    state.mapChoices=[row,...state.mapChoices.filter(item=>String(item.id)!==String(row.id))];
    $('filters').hidden=true;$('pagination').innerHTML='';
    $('content').innerHTML=mapEditorMarkup(row);
    const renderMapLists=()=>{
      if(!state.map)return;
      const points=state.map.document.points,paths=state.map.document.paths,query=$('map-point-search').value.trim().toLowerCase();
      $('map-point-count').textContent=String(points.length);$('map-path-count').textContent=String(paths.length);
      $('map-point-list').innerHTML=points.map((point,index)=>({point,index})).filter(({point})=>`${point.code} ${point.name||''}`.toLowerCase().includes(query)).map(({point,index})=>`<button type="button" class="map-object-row ${state.map.selected===index?'active':''}" data-map-select-point="${escape(point.code)}"><i class="object-dot ${escape(point.type||'station')}"></i><span><strong>${escape(point.code)}</strong><small>${escape(point.name||'未命名站点')}</small></span><b>⋮</b></button>`).join('')||'<p class="map-list-empty">没有匹配站点</p>';
      $('map-path-list').innerHTML=paths.map((path,index)=>`<button type="button" class="map-object-row ${state.map.shape?.kind==='paths'&&state.map.shape.index===index?'active':''}" data-map-select-path="${index}"><i class="path-list-mark"></i><span><strong>${escape(path.start)} → ${escape(path.end)}</strong><small>${path.curve_mode==='smooth'?'平滑曲线':'直线路径'} · ${path.bidirectional?'双向':'单向'}</small></span><b>⋮</b></button>`).join('')||'<p class="map-list-empty">还没有路线</p>';
    };
    const setChip=(id,text,stateName)=>{const chip=$(id);chip.className='map-state-chip '+stateName;chip.innerHTML=`<i></i>${escape(text)}`;};
    const updateLiveStatus=live=>{
      const {connected,localizationValid:valid}=window.RcsConsole.connectionState(live),loc=live.localization||{};
      setChip('map-ros-chip',connected?'ROS 已连接':'ROS 离线',connected?'good':'offline');
      const rosStatus=$('map-ros-status');if(rosStatus)rosStatus.className='map-status-brand '+(connected?'good':'offline');
      setChip('map-loc-chip',valid?'定位正常':loc.source==='simulation'?'仿真定位':connected?(live.matched?'定位待确认':'地图待定位'):'定位无数据',valid?'good':'warn');
      $('map-pose-readout').textContent=live.pose?`X ${Number(live.pose.LocalX).toFixed(3)} m · Y ${Number(live.pose.LocalY).toFixed(3)} m · 航向 ${Number(live.pose.Heading).toFixed(1)}°`:'位姿：—';
      const task=live.navigation?.status;const taskNames={idle:'无任务',sending:'等待接收',accepted:'已接收',running:'执行中',pausing:'正在停车',paused:'已暂停',resuming:'正在继续',success:'已完成',cancelled:'已取消',failed:'执行失败'};
      $('map-nav-readout').textContent=`任务：${taskNames[task]||'未知'}`;
      const taskState=$('map-task-state');if(taskState&&$('map-mission-execution').hidden)taskState.textContent=taskNames[task]||'等待机器人反馈';
      const plc=live.vehicleStatus?.plcConnected;$('map-plc-readout').textContent=`PLC：${plc===true?'在线':plc===false?'离线':'未知'}`;
      $('map-lock-readout').textContent=`软件停止锁：${live.inhibited===true?'已锁定':live.inhibited===false&&connected?'已解除':'未知'}`;
    };
    state.map=new window.OperationsMapCanvas($('map-canvas'),row.draft,()=>{
      state.dirty=true;$('map-save-state').textContent='有未保存修改';clearTimeout(state.saveTimer);renderMapLists();
      state.saveTimer=setTimeout(()=>saveMap().catch(error=>notify(error.message,true)),10000);
    },point=>{
      renderMapLists();
      const inspector=$('map-object-inspector');if(inspector)inspector.open=true;
      const remove=document.querySelector('[data-action="map-remove"]');if(remove)remove.disabled=!point;
      if(point?.kind==='paths'){
        $('map-tool-hint').textContent=`路线 ${point.start} → ${point.end}`;
        $('point-properties').innerHTML=`<p class="inspector-title">${escape(point.start)} → ${escape(point.end)}</p>${selectField('shape-curve-mode','路线形状',[['straight','直线'],['smooth','平滑曲线']],point.curve_mode||'straight')}${field('shape-curve-offset','最大偏移（米，负数向另一侧）',point.curve_offset??0,'number','step="0.05"')}${field('shape-speed','速度上限（米/秒）',point.speed,'number','min="0.01" max="3" step="0.01"')}${field('shape-width','通道宽度（米，配置参考）',point.width,'number','min="0.01" max="20" step="0.01"')}${selectField('shape-direction','通行方向',[['true','双向'],['false','单向']],String(point.bidirectional))}<p class="help">曲线会保存为三次贝塞尔中心线，并以采样路线点发送给 ROS。发布校验仍会检查曲线越界与禁行区。</p>${button('应用路径设置','map-shape-apply','paths')}`;return;
      }
      if(point?.kind==='areas'){
        $('map-tool-hint').textContent=`区域：${point.name||'未命名区域'}`;
        $('point-properties').innerHTML=`${field('shape-name','区域名称',point.name)}${selectField('shape-type','区域用途',[['forbidden','禁行区'],['slow','减速区'],['work','作业区'],['charge','充电区']],point.type)}${field('shape-speed','限速（米/秒，仅减速区生效）',point.speed,'number','min="0.01" max="3" step="0.01"')}<label class="map-polygon-editor">边界顶点（JSON 坐标数组）<textarea name="shape-polygon" rows="6" spellcheck="false">${escape(JSON.stringify(point.polygon))}</textarea></label><p class="help">禁行区会阻止发布/路线规划，减速区限制路线速度；作业/充电区用于区域标识。</p>${button('应用区域设置','map-shape-apply','areas')}`;return;
      }
      $('map-tool-hint').textContent=point?`站点 ${point.code} · X ${Number(point.x).toFixed(2)} m · Y ${Number(point.y).toFixed(2)} m`:'选择站点、路径或区域以查看属性';
      $('point-properties').innerHTML=point?`<p class="inspector-title">站点 ${escape(point.code)}</p>${field('point-code','编号',point.code)}${field('point-name','站点名称',point.name||'')}${selectField('point-type','站点用途',[['station','普通站点'],['charger','充电点'],['shelf','货架点'],['waiting','等候点'],['elevator','电梯点']],point.type)}${field('point-theta','目标朝向（弧度）',point.theta,'number','step="0.01"')}${button('应用站点设置','map-point-apply','')}`:'未选择站点；可在画布上添加站点，然后拖动到精确位置。';
    },distance=>{$('map-measure-result').textContent=`测量距离：${distance.toFixed(3)} m`;},pose=>{
      const key=state.mapRow?.draft?.asset_id;
      if(!key){$('map-tool-hint').textContent='此路线地图还没有定位点云关联；请从地图资产创建或更换底图后再定位。';return;}
      if(pose.directionLength<0.15){$('map-tool-hint').textContent='方向箭头太短；请从车位沿车头方向拖动至少 0.15 m。';return;}
      if(state.relocalizeConfirmationOpen)return;
      state.relocalizeConfirmationOpen=true;
      $('dialog').addEventListener('close',()=>{state.relocalizeConfirmationOpen=false;},{once:true});
      confirmation('确认重新定位','确认重定位',`地图：${key}\n初始位置：X ${pose.x.toFixed(3)} m，Y ${pose.y.toFixed(3)} m，朝向 ${(pose.yaw*180/Math.PI).toFixed(1)}°。\n请确认机器人已完全停车且周围安全。请求发送后仍保持软件停止锁定。`,async value=>{
        if(value!=='确认重定位')throw new Error('请输入“确认重定位”后继续');
        await api.post('/api/localization/switch',{asset_id:key,x:pose.x,y:pose.y,yaw:pose.yaw});
        $('map-tool-hint').textContent='重定位请求已发送；正在等待地图载入和定位收敛，车辆保持停止锁定。';
        state.map.setTool('select');document.querySelectorAll('#map-editor [data-action^="tool-"]').forEach(button=>button.classList.toggle('map-tool-active',button.dataset.action==='tool-select'));
      });
    });
    state.map.onViewChange=percent=>{const level=$('map-zoom-level');if(level)level.textContent=percent+'%';};
    const resourceQuery=new URLSearchParams(location.search),resourcePoint=resourceQuery.get('point'),resourceKind=resourceQuery.get('object');
    if(resourcePoint)state.map.selectPoint(resourcePoint);
    if(['paths','areas'].includes(resourceKind)){const index=state.map.document[resourceKind].findIndex(item=>item.uid===resourceQuery.get('uid'));if(index>=0)state.map.selectObject(resourceKind,index);}
    state.resourcePlanId=resourceQuery.get('planId');
    renderMapLists();renderMapRobot();renderMapTasks();renderMapMissions();refreshMapTasks();refreshMapMissions();refreshRobotModel();window.OrangeMappingPreview?.refresh();
    state.mapTaskTimer=setInterval(()=>{refreshMapTasks();refreshMapMissions();},5000);
    $('map-point-search').oninput=renderMapLists;
    $('map-point-list').onclick=event=>{const item=event.target.closest('[data-map-select-point]');if(item)state.map?.selectPoint(item.dataset.mapSelectPoint);};
    $('map-path-list').onclick=event=>{const item=event.target.closest('[data-map-select-path]');if(item)state.map?.selectObject('paths',Number(item.dataset.mapSelectPath));};
    document.querySelectorAll('[data-map-layer]').forEach(input=>input.onchange=()=>state.map?.setLayerVisible(input.dataset.mapLayer,input.checked));

    $('map-switch').onchange=async event=>{
      const nextId=event.target.value;if(String(nextId)===String(state.mapRow?.id))return;
      try{const next=await api.get(`/api/maps/${nextId}`);if(!leaveMap()){event.target.value=String(state.mapRow.id);return;}await openMap(next);}
      catch(error){notify(error.message,true);event.target.value=String(state.mapRow?.id||'');}
    };
    $('map-area-kind').onchange=()=>state.map?.setAreaType($('map-area-kind').value);
    state.map.liveController=new window.LiveMap(state.map,row.id,$('map-live-status'),updateLiveStatus);
    if(row.draft.image) await loadMapImage();
    state.lockTimer=setInterval(()=>api.post(`/api/maps/${row.id}/lock`).catch(error=>notify(error.message,true)),60000);
  }
  async function saveMap(){
    if(!state.map||!state.dirty)return;
    clearTimeout(state.saveTimer);
    const draft=structuredClone(state.map.document);
    const result=await api.post(`/api/maps/${state.mapRow.id}/draft/save`,{revision:state.mapRow.revision,document:draft});
    state.mapRow=result;
    state.dirty=JSON.stringify(draft)!==JSON.stringify(state.map.document);
    $('map-save-state').textContent=`草稿 r${result.revision} 已保存`;$('map-revision-state').textContent=`草稿 r${result.revision} · 已发布 v${result.published_version||0}`;
  }
  function leaveMap(){if(state.dirty&&!confirm('存在未保存修改，确定离开？'))return false;if(document.fullscreenElement===$('map-editor'))document.exitFullscreen().catch(()=>{});clearTimeout(state.saveTimer);clearInterval(state.lockTimer);clearInterval(state.mapTaskTimer);state.mapTaskTimer=null;state.map?.destroy();state.map=null;state.mapRow=null;state.dirty=false;$('filters').hidden=false;return true;}
  async function loadMapImage(){
    const editor=state.map,mapId=state.mapRow.id,digest=editor.document.image;
    const blob=await api.download(`/api/maps/${mapId}/image/${digest}`);
    const url=URL.createObjectURL(blob),image=new Image();
    image.onload=()=>{if(state.map===editor&&editor.document.image===digest){editor.image=image;editor.draw();}URL.revokeObjectURL(url);};image.onerror=()=>URL.revokeObjectURL(url);
    image.onerror=()=>URL.revokeObjectURL(url);image.src=url;
  }
  async function selectMapAsset(){
    const assets=await api.get('/api/map-workbench/assets'),available=assets.filter(asset=>asset.grid);
    const selectedKey=available.some(asset=>asset.id===state.preferredAssetKey)?state.preferredAssetKey:'';
    const options=assets.map(asset=>`<option value="${escape(asset.id)}" data-revision="${escape(asset.revision)}" ${asset.grid?'':'disabled'} ${asset.id===selectedKey?'selected':''}>${escape(asset.id)} · ${asset.grid?'PGM / YAML 可用':'仅 PCD，需先生成 PGM / YAML'}${asset.pcd?' · PCD':''}</option>`).join('');
    const picker=`<label class="wide">已有地图<select name="asset_key" ${available.length?'required':'disabled'}><option value="">${available.length?'请选择已有栅格地图':'没有可用的 PGM / YAML 地图'}</option>${options}</select></label>`;
    const help='<p class="help">选择后会把 PGM 作为线路底图，并按 map.yaml 设置分辨率、原点和地图边界。PCD 点云不能直接作为二维底图；有配套 PGM / YAML 的地图可直接选择，只有 PCD 的地图请先在地图工作台生成栅格。</p><label class="wide"><input name="coordinates_confirmed" type="checkbox" required> 我已确认栅格与路线使用相同坐标系；已有点位坐标不会自动转换。</label>';
    return dialog('选择已有底图',picker+help,async form=>{
      const key=form.get('asset_key'),asset=assets.find(item=>item.id===key);
      if(!asset?.grid)throw new Error('请选择包含 PGM / YAML 的地图');
      await saveMap();
      const result=await api.post(`/api/maps/${state.mapRow.id}/image/from-asset`,{
        key,revision:state.mapRow.revision,asset_revision:asset.revision,
        coordinates_confirmed:form.get('coordinates_confirmed')==='on'
      });
      state.mapRow=result;state.map.document=structuredClone(result.draft);state.dirty=false;
      await loadMapImage();state.map.fit();
      $('map-save-state').textContent=`草稿 r${result.revision} 已保存 · 底图 ${asset.id}`;
      notify(`已应用 ${asset.id} 的 PGM 底图；请检查点位是否仍在地图边界内。`);
    },'应用底图');
  }
  async function existingPgmForm(){
    let assets=[],listRequest=0;
    dialog('选择已有 PGM 地图',`<div class="pgm-map-picker"><p class="help">选择已生成的二维地图，直接打开路线画布。已有站点和路线会保留，尺寸与原点自动读取。</p><div class="pgm-picker-row"><label>已创建的 PGM 地图<select id="pgm-asset-select" name="asset_key" required disabled><option value="">正在读取地图…</option></select></label><button id="pgm-assets-refresh" type="button">刷新列表</button></div><p id="pgm-assets-status" class="help" role="status"></p><details id="pgm-import"><summary>从本机导入 PGM / YAML</summary><p class="help">选择已有的 PGM 和对应 YAML 文件。YAML 提供分辨率与原点；导入使用新名称，不覆盖原地图。</p>${field('import_name','导入地图名称','','text','id="pgm-import-name" maxlength="100"')}${field('pgm','PGM 地图文件','','file','id="pgm-import-file" accept=".pgm"')}${field('metadata','配套 YAML 文件','','file','id="pgm-import-yaml" accept=".yaml,.yml"')}<button id="pgm-import-submit" type="button">导入地图</button></details></div>`,async form=>{
      const key=form.get('asset_key');
      if(!assets.some(asset=>asset.id===key&&asset.grid))throw new Error('请先选择一张可用的 PGM 地图');
      await openAssetMap(key);$('dialog').close();return false;
    },'打开并设置路线');
    const selector=$('pgm-asset-select'),refresh=$('pgm-assets-refresh'),status=$('pgm-assets-status'),submit=$('dialog-submit');
    function selection(){
      const asset=assets.find(item=>item.id===selector.value&&item.grid);
      submit.disabled=!asset;
      if(asset)status.textContent=`已选 ${asset.id} · 分辨率 ${asset.resolution} 米/像素 · 原点 ${(asset.origin||[]).join('，')}。打开后可直接设置站点和路线。`;
      else if(assets.some(item=>item.grid))status.textContent='请从列表选择一张已创建的 PGM 地图。';
    }
    async function reload(preferred=selector.value||state.preferredAssetKey){
      const request=++listRequest;
      refresh.disabled=selector.disabled=submit.disabled=true;status.textContent='正在读取已生成的地图…';
      try{
        const result=await api.get('/api/map-workbench/assets');
        if(request!==listRequest||$('pgm-asset-select')!==selector||!$('dialog').open)return;
        assets=result;
        const grids=assets.filter(asset=>asset.grid);
        selector.innerHTML='<option value="">请选择已创建的 PGM 地图</option>'+grids.map(asset=>`<option value="${escape(asset.id)}">${escape(asset.id)}</option>`).join('');
        selector.value=grids.some(asset=>asset.id===preferred)?preferred:grids.length===1?grids[0].id:'';
        selector.disabled=!grids.length;
        status.textContent=grids.length?`找到 ${grids.length} 张 PGM 地图，请选择后打开。`:'当前服务没有找到可用的 PGM 地图。若地图在另一台电脑或机器人上，请将 PGM 和配套 YAML 导入这里。';
        selection();
      }catch(error){
        if(request!==listRequest||$('pgm-asset-select')!==selector||!$('dialog').open)return;
        assets=[];selector.innerHTML='<option value="">地图列表读取失败</option>';status.textContent=error.message+'。请点击“刷新列表”重试。';
      }finally{if(request===listRequest)refresh.disabled=false;}
    }
    selector.onchange=selection;refresh.onclick=()=>reload();
    $('pgm-import-file').onchange=()=>{if(!$('pgm-import-name').value)$('pgm-import-name').value=($('pgm-import-file').files[0]?.name||'').replace(/\.pgm$/i,'');};
    $('pgm-import-submit').onclick=async()=>{
      const button=$('pgm-import-submit');button.disabled=true;$('dialog-error').textContent='';
      try{
        const pgm=$('pgm-import-file').files[0],metadata=$('pgm-import-yaml').files[0],name=$('pgm-import-name').value.trim();
        if(!name||!pgm||!metadata)throw new Error('请填写地图名称，并选择 PGM 和配套 YAML 文件');
        if(pgm.size>80*1024*1024||metadata.size>65536)throw new Error('PGM 不能超过 80MB，YAML 不能超过 64KB');
        const body=new FormData();body.append('asset_id',name);body.append('create_only','true');body.append('pgm',pgm);body.append('metadata',metadata);
        const imported=await api.form('/api/map-workbench/grid',body);
        await reload(imported.id);
      }catch(error){if($('pgm-asset-select')===selector&&$('dialog').open)$('dialog-error').textContent=error.message;}finally{button.disabled=false;}
    };
    await reload();
  }
  async function newMapForm(){
    const assets=await api.get('/api/map-workbench/assets');
    const preferredAsset=assets.find(asset=>asset.id===state.preferredAssetKey&&asset.grid);
    const options=assets.map(asset=>`<option value="${escape(asset.id)}" ${asset.grid?'':'disabled'} ${asset.id===preferredAsset?.id?'selected':''}>${escape(asset.id)} · ${asset.grid?'PGM / YAML 可用':'仅 PCD，需先生成 PGM / YAML'}${asset.pcd?' · PCD':''}</option>`).join('');
    const source=`<label class="wide">已有地图底图<select name="asset_key"><option value="">新建空白线路地图</option>${options}</select></label><p class="help wide" id="map-source-help">可选已有 PGM/YAML 栅格作为底图；选择后地图尺寸、分辨率和原点将读取 map.yaml。只有 PCD 的地图请先生成栅格。</p>`;
    const coordinates='<label class="wide"><input name="coordinates_confirmed" type="checkbox"> 我已确认栅格与路线使用相同坐标系；已有点位坐标不会自动转换。</label>';
    dialog('新建地图',`<div class="form-grid">${field('name','地图名称','','text','required')}${field('width','宽度（米）',100,'number','min="1" required')}${field('height','高度（米）',100,'number','min="1" required')}${field('resolution','分辨率（米/像素）',.05,'number','min="0.001" step="0.001"')}${source}${coordinates}</div>`,async form=>{
      const key=form.get('asset_key'),asset=assets.find(item=>item.id===key);
      if(key&&!asset?.grid)throw new Error('请选择包含 PGM / YAML 的地图');
      if(asset&&form.get('coordinates_confirmed')!=='on')throw new Error('请先确认已有地图与路线地图使用相同坐标系');
      let created=await api.post('/api/maps',{name:form.get('name'),document:{width:Number(form.get('width')),height:Number(form.get('height')),resolution:Number(form.get('resolution')),points:[],paths:[],areas:[]}});
      if(asset){
        try{
          created=await api.post(`/api/maps/${created.id}/image/from-asset`,{key,revision:created.revision,asset_revision:asset.revision,coordinates_confirmed:true});
        }catch(error){
          $('dialog').close();await openMap(created);
          notify(`线路地图已创建，但底图导入失败：${error.message}。可在编辑器中点击“选择已有底图”重试。`,true);
          return false;
        }
        $('dialog').close();await openMap(created);return false;
      }
      return created;
    },'创建并打开');
    const selector=$('dialog-body').querySelector('[name="asset_key"]'),confirmation=$('dialog-body').querySelector('[name="coordinates_confirmed"]');
    const dimensions=['width','height','resolution'].map(name=>$('dialog-body').querySelector(`[name="${name}"]`));
    const syncSource=()=>{
      const selected=!!selector.value;
      confirmation.required=selected;confirmation.disabled=!selected;if(!selected)confirmation.checked=false;
      dimensions.forEach(input=>input.readOnly=selected);
      $('map-source-help').textContent=selected
        ?'将使用所选 PGM/YAML 的尺寸、分辨率和原点；请确认坐标系一致，之后已有点位坐标不会自动转换。'
        :'可选已有 PGM/YAML 栅格作为底图；选择后地图尺寸、分辨率和原点将读取 map.yaml。只有 PCD 的地图请先生成栅格。';
    };
    selector.addEventListener('change',syncSource);syncSource();
  }
  function hashFirmware(file){
    return new Promise((resolve,reject)=>{
      const worker=new Worker('src/modules/operations/sha256-worker.js');
      worker.onmessage=({data})=>{
        if(data.error){worker.terminate();reject(new Error(data.error));}
        else if(data.digest){worker.terminate();resolve(data.digest);}
        else $('upload-progress').textContent=`计算 SHA256：${data.progress}%`;
      };
      worker.onerror=()=>{worker.terminate();reject(new Error('文件校验失败'));};worker.postMessage(file);
    });
  }
  async function uploadFirmware(){
    dialog('上传 / 续传固件',`<p class="help">支持 5MB 分片、断点续传和 SHA256 校验。上传完成后需要审核才能创建升级任务。</p><div class="form-grid">${field('name','固件名称','','text','required')}${field('version','版本（例如 2.3.1）','','text','required pattern="[0-9]+\\.[0-9]+\\.[0-9]+"')}${field('model','机型','','text','required')}${field('min_hardware','最低硬件版本')}${field('file','固件文件','','file','required')}<label class="wide">更新说明<textarea name="changelog"></textarea></label></div><p id="upload-progress" class="help"></p>`,async form=>{
      const file=form.get('file');if(!file.size||file.size>1024**3)throw new Error('文件大小需要在 1B—1GB 之间');
      $('upload-progress').textContent='正在计算文件 SHA256…';
      const sha256=await hashFirmware(file);
      const packageRow=await api.post('/api/firmware/upload',{name:form.get('name'),version:form.get('version'),model:form.get('model'),min_hardware:form.get('min_hardware'),changelog:form.get('changelog'),sha256,size:file.size});
      const upload=await api.get(`/api/firmware/${packageRow.id}/upload-status`),done=new Set(upload.chunks);
      if(packageRow.status==='uploading'){
        for(let i=0;i<Math.ceil(file.size/upload.chunk_size);i++){
          if(!done.has(i))await api.chunk(packageRow.id,i,file.slice(i*upload.chunk_size,(i+1)*upload.chunk_size));
          $('upload-progress').textContent=`已上传 ${Math.min(100,Math.round((i+1)*upload.chunk_size/file.size*100))}%`;
        }
        await api.post(`/api/firmware/${packageRow.id}/complete`);
      }
      notify('固件上传完成，已进入审核流程。');
    },'开始上传');
  }
  async function upgradeForm(){
    const packages=(await api.get('/api/firmware')).list.filter(p=>p.status==='released');
    if(!packages.length)throw new Error('请先上传固件并完成审核');
    dialog('创建灰度升级任务',`<p class="help">启动时逐台检查在线、电量≥50%、机型和任务占用。设备必须支持安全刷写和版本回执；失败设备会保持维护状态。</p><div class="form-grid">${field('name','任务名称','','text','required')}${selectField('package_id','已审核固件',packages.map(p=>[p.id,`${p.model} / ${p.version}`]))}${field('robot_ids','机器人 ID（逗号分隔）','','text','required')}${field('batch_size','每批台数',5,'number','min="1" max="50"')}${field('interval_seconds','批次间隔（秒）',120,'number','min="0"')}${field('confirmation','再次输入任务名称','','text','required')}</div><p class="help">当前机器人：${escape(state.robots.map(r=>`${r.id}=${r.code}`).join('，'))}</p>`,form=>api.post('/api/upgrade/tasks',{...Object.fromEntries(form),package_id:Number(form.get('package_id')),robot_ids:form.get('robot_ids').split(',').map(v=>Number(v.trim())),batch_size:Number(form.get('batch_size')),interval_seconds:Number(form.get('interval_seconds'))}),'创建任务');
  }
  async function action(name,id){
    document.querySelectorAll('.rcs-tool-menu[open]').forEach(menu=>{menu.open=false;});
    const row=state.rows.find(r=>r.id===Number(id));
    if(name==='task-motion-pause'||name==='task-motion-resume'){
      const task=state.mapTasks.find(item=>String(item.id)===String(id))||row;
      if(!task)throw new Error('任务状态已更新，请刷新');
      const resume=name==='task-motion-resume';
      const submit=async value=>{await api.post(`/api/task-history/${id}/${resume?'resume':'pause'}`,resume?{confirmation:value}:{});notify(resume?'已请求沿原路线继续，等待设备确认。':'已请求停车，等待底盘确认。');if(state.map)await refreshMapTasks();else await load();};
      if(!resume)return submit();
      return confirmation('继续原路线',task.name,'确认现场可以继续行驶。车辆将沿暂停前的路线从保留进度继续。',submit);
    }
    if(name==='export-robots'){saveBlob(await api.download('/api/fleet/export'),'机器人档案.xlsx');return;}
    if(name==='import-robots')return dialog('导入机器人档案',`${button('下载模板','robot-template','')}<p class="help">上传模板格式的 xlsx 文件，最多 1000 行。先校验预览，再确认导入。</p>${field('file','档案文件','','file','accept=".xlsx" required')}`,async form=>{
      const result=await api.upload('/api/fleet/import-preview',form.get('file'));
      $('dialog').close();dialog('导入预览',`<p>有效 ${result.valid.length} 行，错误 ${result.errors.length} 行。</p><pre>${escape(JSON.stringify(result.errors,null,2))}</pre>${field('confirmation','输入 确认导入 继续','','text','required')}`,async data=>{
        const imported=await api.post('/api/fleet/import',{confirmation:data.get('confirmation'),robots:result.valid});
        $('dialog').close();details('导入结果及设备密钥（请立即保存）',imported);await load();return false;
      },'确认导入有效行');return false;
    },'校验预览');
    if(name==='robot-template'){saveBlob(await api.download('/api/fleet/export',{template:true}),'机器人导入模板.xlsx');return;}
    if(name==='map-image')return dialog('上传地图底图',`<p class="help">支持 PNG / PGM，最多 5MB。宽高将按当前分辨率换算为米；上传后请重新校验点位边界。</p>${field('file','底图文件','','file','accept=".png,.pgm" required')}`,async form=>{
      await saveMap();const result=await api.upload(`/api/maps/${state.mapRow.id}/image`,form.get('file'),{revision:state.mapRow.revision});
      state.mapRow=result;state.map.document=structuredClone(result.draft);state.dirty=false;await loadMapImage();state.map.fit();
    },'上传底图');
    if(name==='map-asset')return selectMapAsset();
    if(name==='add-robot'||name==='edit-robot')return robotForm(name==='edit-robot'?row:null);
    if(name==='detail')return details('记录详情',row);
    if(name==='robot-detail')return details('机器人档案与指令记录',await api.get(`/api/robots/${id}`));
    if(name==='battery-detail'){
      const samples=await api.get(`/api/robots/${id}/battery/history`);
      const series=samples.length?`<svg class="chart" viewBox="0 0 600 230" role="img" aria-label="24小时电量曲线"><text x="0" y="14">100%</text><text x="0" y="215">0%</text><polyline fill="none" stroke="#3d9b76" stroke-width="2" points="${samples.map((s,i)=>`${40+i/Math.max(1,samples.length-1)*530},${210-s.percent*1.9}`).join(' ')}"/></svg>`:'<p class="empty">近 24 小时尚无电量采样</p>';
      return dialog('近 24 小时电量',series+`<p class="help">共 ${samples.length} 个采样点；超过 2000 点按分组极值降采样。</p>`,null);
    }
    if(name==='policy')return dialog('电量策略',`<div class="form-grid">${field('critical','紧急阈值 %',row.policy.critical,'number','min="1" max="98"')}${field('low','低电量阈值 %',row.policy.low,'number','min="2" max="99"')}${field('full','充满阈值 %',row.policy.full,'number','min="3" max="100"')}${selectField('auto_charge','低电量自动回充',[['false','关闭'],['true','开启']],String(row.policy.auto_charge))}</div><p class="help">自动回充只对在线、非任务占用、非急停且电量未突变的机器人生效。</p>`,form=>api.put(`/api/robots/${id}/battery-policy`,{critical:Number(form.get('critical')),low:Number(form.get('low')),full:Number(form.get('full')),auto_charge:form.get('auto_charge')==='true'}));
    if(name==='command')return dialog('机器人控制指令',`<p>操作对象：${escape(row.code)} · ${escape(row.name)}</p><div class="form-grid">${selectField('command','指令',[['goto-charge','回充'],['lock','锁定'],['unlock','解锁'],['emergency-stop','急停'],['release-stop','解除急停'],['reboot','重启'],['set-mode','切换模式'],['goto-point','前往点位'],['clear-alarm','清除设备报警']])}${field('reason','锁定原因')}${field('point','目标点位编号')}${selectField('mode','运行模式',[['auto','自动'],['manual','手动'],['remote','遥控']])}${field('confirmation',`输入 ${row.code} 确认`,'','text','required')}</div>`,form=>api.post(`/api/robots/${id}/commands/${form.get('command')}`,{confirmation:form.get('confirmation'),key:crypto.randomUUID(),params:{reason:form.get('reason'),point:form.get('point'),mode:form.get('mode')}}),'确认下发');
    if(name==='batch-charge'){
      const robots=state.robots.filter(r=>r.is_low&&r.online&&!r.telemetry.charging);
      if(!robots.length)throw new Error('没有在线且需要回充的低电量机器人');
      return confirmation('批量回充','确认批量操作',`本次涉及 ${robots.length} 台：${robots.map(r=>r.code).join('、')}。下发后等待设备回执。`,async confirmation=>{const result=await api.post('/api/robots/batch-command',{robot_ids:robots.slice(0,50).map(r=>r.id),command:'goto-charge',confirmation,key:crypto.randomUUID()});$('dialog').close();details('逐台下发结果',result);return false;});
    }
    if(name==='ack'||name==='close-alarm')return dialog(name==='ack'?'确认报警':'关闭报警',`<p>${escape(row.title)}</p>${field('note','处理备注','','text','required')}`,form=>api.post(`/api/alarms/${id}/action`,{action:name==='ack'?'acknowledge':'close',note:form.get('note')}));
    if(name==='task-stats'){
      const stats=await api.get('/api/task-statistics',filterParams());
      return dialog('任务统计（默认近 24 小时）',`<div class="cards"><article class="card"><p>任务总量</p><strong>${stats.total}</strong></article><article class="card"><p>成功率</p><strong>${stats.success_rate??'—'}</strong><em>%</em></article><article class="card"><p>平均执行</p><strong>${stats.average_execution_seconds??'—'}</strong><em>秒</em></article><article class="card"><p>平均等待</p><strong>${stats.average_wait_seconds??'—'}</strong><em>秒</em></article></div>${chart(stats.trend)}<h3>失败原因 TOP 10</h3>${table(['原因','次数'],stats.failures.map(([reason,count])=>[escape(reason),count]))}<h3>机器人任务量 TOP 10</h3>${table(['机器人 ID','任务量'],stats.robot_rank.map(([id,count])=>[id,count]))}`,null);
    }
    if(name==='add-task')return taskForm();
    if(name==='task-detail')return dialog('任务时间轴',`<p>${escape(row.name)} · ${badge(row.status)}</p>${row.timeline.map(t=>`<p>${stamp(t.at)} · ${badge(t.status)} ${escape(t.note)}</p>`).join('')}<p>${escape(row.failure)}</p>`,null);
    if(name==='cancel-task')return confirmation('取消排队任务',row.name,'仅取消尚未开始的任务。',async v=>{if(v!==row.name)throw new Error('任务名不一致');await api.post(`/api/task-history/${id}/cancel`);});
    if(name==='stop-task')return confirmation('停止执行中任务',row.name,'设备未领取时直接撤销；已领取时发送停止并锁定指令。设备确认前任务仍显示执行中；软件停止不代替物理急停。',async v=>{const result=await api.post(`/api/task-history/${id}/stop`,{confirmation:v});notify(result.stop_status==='pending'?'停止请求已排队，等待设备回执。':'任务已在设备领取前撤销。');});
    if(name==='map-open-navigation'){
      if(window.OrangeNavigation?.open){window.OrangeNavigation.open();return;}
      if(window.top===window){
        if(state.map)await saveMap();
        window.location.href='index.html?navigation=open'+(state.mapRow?.id?'&mapId='+encodeURIComponent(state.mapRow.id):'');
      }else window.top.postMessage({type:'orange-toggle-navigation'},location.origin);
      return;
    }
    if(name==='map-open-resources'){
      if(state.map)await saveMap();
      const query=new URLSearchParams();if(state.mapRow?.id)query.set('mapId',state.mapRow.id);
      const kind=state.map?.shape?.kind||(state.map?.selected!=null?'points':null);
      const selected=kind?(kind==='points'?state.map.document.points[state.map.selected]:state.map.document[kind][state.map.shape.index]):null;
      if(selected){query.set('tab',kind);if(selected.uid)query.set('uid',selected.uid);if(kind==='points')query.set('point',selected.code);}
      window.top.location.href='map-resources.html'+(query.size?'?'+query:'');return;
    }
    if(name==='map-zoom-in'){state.map?.zoomBy(1.2);return;}
    if(name==='map-zoom-out'){state.map?.zoomBy(1/1.2);return;}
    if(name==='map-home-view'){state.map?.fit();return;}
    if(name==='map-open-operations'){if(state.map)await saveMap();window.top.location.href='operations.html#dashboard';return;}
    if(name==='task-mode-set')return changeTaskMode(id);
    if(name==='map-task-create')return taskForm();
    if(name==='robot-model-open')return dialog('车体坐标与模型','<iframe id="robot-model-frame" class="robot-model-frame" src="robot-model.html?embedded=1" title="base_link 车体坐标与三维模型"></iframe>',null);
    if(name==='map-mission-create')return missionDesigner();
    if(name==='mission-edit'){const plan=state.mapMissionPlans.find(item=>String(item.id)===String(id));if(!plan)throw new Error('任务链列表已更新，请刷新后重试');return missionDesigner(plan);}
    if(name==='mission-start-plan'){const plan=state.mapMissionPlans.find(item=>String(item.id)===String(id));if(!plan)throw new Error('任务链列表已更新，请刷新后重试');return startSavedMission(plan);}
    if(name==='mission-delete-plan'){const plan=state.mapMissionPlans.find(item=>String(item.id)===String(id));if(!plan)throw new Error('任务链列表已更新，请刷新后重试');return confirmation('删除任务链模板',plan.name,'删除只作用于任务链模板；历史执行记录会保留。存在排队或执行中的任务链时不能删除。',async confirmation=>{await api.post(`/api/task-plans/${id}/delete`,{confirmation});notify('任务链模板已删除。');await refreshMapMissions();});}
    if(name==='mission-advance')return advanceMission(id);
    if(name==='mission-select'){state.selectedMissionId=id;renderMapMissionExecution();return;}
    if(name==='mission-pause'||name==='mission-resume'){
      const run=state.mapMissionRuns.find(item=>String(item.id)===String(id));if(!run)throw new Error('任务链状态已更新，请刷新');
      const resume=name==='mission-resume',endpoint=resume?'resume':'pause';
      const submit=async confirmation=>{const result=await api.post(`/api/mission-runs/${id}/${endpoint}`,{confirmation});notify(result.status==='pausing'?'已请求停车，等待底盘确认。':result.status==='resuming'?'已请求继续原路线，等待设备确认。':resume?'任务链已恢复。':'任务链已暂停。');await refreshMapMissions();};
      if(!resume)return submit(run.name);
      return confirmation('继续原路线',run.name,'确认现场可以继续行驶。将从保留的路线进度继续，已完成步骤不会重放；定位或停止锁不满足时会拒绝继续。',submit);
    }
    if(name==='mission-run-detail'){const run=state.mapMissionRuns.find(item=>String(item.id)===String(id));if(!run)throw new Error('任务链状态已更新，请刷新');return dialog('任务链执行记录',`<p><strong>${escape(run.name)}</strong> · ${escape(missionStateLabel(run))}</p><p>${escape(run.start_point)} · ${run.cycles_completed}/${run.repeat_count===-1?'∞':run.repeat_count} 轮 · 第 ${Math.min(run.step_index+1,run.steps.length)}/${run.steps.length} 步</p>${run.active_task?`<p>当前设备任务：${escape(run.active_task.name)} · ${badge(run.active_task.status)}</p>`:''}${(run.timeline||[]).map(item=>`<p>${stamp(item.at)} · ${escape(item.status)} · ${escape(item.note)}</p>`).join('')||'<p class="help">暂无执行记录</p>'}${run.failure?`<p class="mission-error">${escape(run.failure)}</p>`:''}`,null);}
    if(name==='mission-stop-step'){const run=state.mapMissionRuns.find(item=>String(item.id)===String(id));const task=run?.active_task;if(!task)throw new Error('没有正在执行的设备步骤');if(task.status==='queued')return confirmation('撤销待下发步骤',task.name,'当前步骤尚未被设备领取；撤销后任务链会停止，不会继续下发后续步骤。',async confirmation=>{if(confirmation!==task.name)throw new Error('任务名称不一致');await api.post(`/api/task-history/${task.id}/cancel`);notify('待下发步骤已撤销，任务链将停止。');await refreshMapTasks();await refreshMapMissions();});return confirmation('停止当前导航并锁定',task.name,'停止当前任务链步骤并请求设备确认停车。确认回执前任务不会标记完成；软件停止不能代替物理急停。',async confirmation=>{const result=await api.post(`/api/task-history/${task.id}/stop`,{confirmation});notify(result.stop_status==='pending'?'停止请求已发出，等待设备确认。':'设备领取前任务已撤销。');await refreshMapTasks();await refreshMapMissions();});}
    if(name==='mission-cancel'){const run=state.mapMissionRuns.find(item=>String(item.id)===String(id));if(!run)throw new Error('任务链状态已更新，请刷新');return confirmation('取消任务链',run.name,'取消后不会继续执行后续步骤。若某个导航段已由设备接收，请先在任务执行栏停止并锁定。',async confirmation=>{await api.post(`/api/mission-runs/${id}/cancel`,{confirmation});notify('任务链已取消。');await refreshMapMissions();});}
    if(name==='map-task-detail'){const task=state.mapTasks.find(item=>String(item.id)===String(id));if(!task)throw new Error('任务记录已更新，请刷新后重试');return dialog('任务时间轴',`<p><strong>${escape(task.name)}</strong> · ${badge(task.status)}</p><p>${escape(task.from_point)} → ${escape(task.to_point)} · 机器人 ${escape(task.robot_id||'等待分配')}</p>${(task.timeline||[]).map(item=>`<p>${stamp(item.at)} · ${badge(item.status)} ${escape(item.note)}</p>`).join('')||'<p class="help">暂无设备回执</p>'}<p>${escape(task.failure||'')}</p>`,null);}
    if(name==='map-task-cancel'){const task=state.mapTasks.find(item=>String(item.id)===String(id));if(!task||task.status!=='queued')throw new Error('该任务已不在排队状态');return confirmation('取消排队任务',task.name,'仅取消尚未开始的任务。',async value=>{if(value!==task.name)throw new Error('任务名称不一致');await api.post(`/api/task-history/${id}/cancel`);await refreshMapTasks();});}
    if(name==='map-task-stop'){const task=state.mapTasks.find(item=>String(item.id)===String(id));if(!task)throw new Error('没有可停止的任务记录');return confirmation('停止任务并锁定',task.name,'会向设备发送停止请求并保持软件停止锁。设备回执到达前仍显示执行中；这不代替物理急停。',async value=>{const result=await api.post(`/api/task-history/${id}/stop`,{confirmation:value});notify(result.stop_status==='pending'?'停止请求已发送，等待设备回执。':'任务已在设备领取前撤销。');await refreshMapTasks();});}
    if(name==='export-logs'){const params=filterParams();params.level=params.state;saveBlob(await api.download('/api/logs/export',params),'运行日志.csv');return;}
    if(name==='add-map')return newMapForm();
    if(name==='open-pgm-map')return existingPgmForm();
    if(name==='open-selected-map'){
      if(!id)throw new Error('请先从已有地图列表中选择一张地图。');
      return openMap(await api.get(`/api/maps/${id}`));
    }
    if(name==='edit-map')return openMap(row);
    if(name==='leave-map'){if(leaveMap())return load();return;}
    if(name==='workbench-build'||name==='workbench-point'||name==='workbench-grid'||name==='workbench-binding'||name==='workbench-locate'){
      const tab=name==='workbench-build'?'build':name==='workbench-point'?'point':name==='workbench-grid'?'grid':name==='workbench-binding'?'binding':'locate';
      window.parent.postMessage({type:'workbench-open-drawer',tab,asset:state.mapRow?.draft?.asset_id||state.preferredAssetKey},location.origin);return;
    }
    if(name.startsWith('tool-')){
      const tool=name.slice(5);if(tool==='relocalize'&&!state.mapRow?.draft?.asset_id)throw new Error('此路线地图还没有定位点云关联；请从地图资产创建或更换底图后再定位。');
      state.map.setTool(tool);document.querySelectorAll('#map-editor [data-action^="tool-"]').forEach(button=>button.classList.toggle('map-tool-active',button.dataset.action===name));
      const hints={select:'选择对象；拖动站点可微调坐标',point:'点击地图添加站点',path:'依次点击两个站点创建直线路径',curve:'依次点击两个站点创建平滑曲线路径',area:'依次点击区域边界顶点，双击闭合',pan:'拖动画布平移',measure:'按住并拖动，测量两点间距离',relocalize:'点选机器人新位置，再沿车头朝向拖动；松开后发送真实 ROS 初始位姿'};
      $('map-tool-hint').textContent=hints[tool]||'地图工具已切换';if(tool==='measure')$('map-measure-result').textContent='按住并拖动地图，查看两点间距离';return;
    }
    if(name==='map-undo')return state.map.undo();if(name==='map-redo')return state.map.redo();if(name==='map-remove')return state.map.remove();if(name==='map-fit')return state.map.fit();if(name==='map-save')return saveMap();
    if(name==='map-shape-apply'){
      const box=$('point-properties'),value=key=>box.querySelector(`[name="${key}"]`).value;
      if(id==='paths'){
        const curveMode=value('shape-curve-mode'),path=state.map.document.paths[state.map.shape.index],points=new Map(state.map.document.points.map(point=>[point.code,point]));
        let curveOffset=Number(value('shape-curve-offset'));
        if(curveMode==='smooth'&&Math.abs(curveOffset)<1e-6){const a=points.get(path.start),b=points.get(path.end);curveOffset=Math.min(5,Math.hypot(b.x-a.x,b.y-a.y)*.18);}
        state.map.updateShape({curve_mode:curveMode,curve_offset:curveOffset,speed:Number(value('shape-speed')),width:Number(value('shape-width')),bidirectional:value('shape-direction')==='true'});
      }
      else{
        let polygon;try{polygon=JSON.parse(value('shape-polygon'));}catch{throw new Error('区域顶点格式无效，请使用 [[x1,y1],[x2,y2],[x3,y3]]');}
        if(!Array.isArray(polygon)||polygon.length<3||polygon.length>200||polygon.some(point=>!Array.isArray(point)||point.length!==2||point.some(coordinate=>!Number.isFinite(Number(coordinate)))))throw new Error('区域至少需要 3 组有效的 [X,Y] 坐标');
        state.map.updateShape({name:value('shape-name'),type:value('shape-type'),speed:Number(value('shape-speed')),polygon:polygon.map(point=>point.map(Number))});
      }return;
    }
    if(name==='map-point-apply'){const box=$('point-properties');state.map.updatePoint({code:box.querySelector('[name="point-code"]').value,name:box.querySelector('[name="point-name"]').value,type:box.querySelector('[name="point-type"]').value,theta:Number(box.querySelector('[name="point-theta"]').value)});return;}
    if(name==='map-fullscreen'){const target=$('map-editor');if(document.fullscreenElement===target)await document.exitFullscreen();else if(target.requestFullscreen)await target.requestFullscreen();else throw new Error('当前浏览器不支持大图显示');return;}
    if(name==='map-validate'){const inspector=$('map-object-inspector');if(inspector)inspector.open=true;await saveMap();const issues=await api.post(`/api/maps/${state.mapRow.id}/validate`);$('map-issues').textContent=issues.length?issues.map(e=>`${e.element} ${e.message}`).join('\n'):'校验通过';return;}
    if(name==='map-publish'){await saveMap();const map=state.mapRow;return confirmation('发布地图',map.name,'发布前将校验连通性、禁行区与占用情况。设备从发布版本接口拉取地图。',async confirmation=>{const result=await api.post(`/api/maps/${map.id}/publish`,{revision:map.revision,confirmation});state.mapRow=await api.get(`/api/maps/${map.id}`);$('map-revision-state').textContent=`草稿 r${state.mapRow.revision} · 已发布 v${state.mapRow.published_version||0}`;$('map-save-state').textContent=`草稿 r${state.mapRow.revision} · 已发布 v${state.mapRow.published_version||0}`;notify(result.localization_linked?'地图已发布，定位点云与路线版本已自动关联；设备加载结果仍需设备侧确认。':'地图已发布；设备加载结果需由设备侧确认。');});}
    if(name==='map-import')return dialog('导入地图 JSON',`${field('file','地图文件','','file','accept="application/json,.json" required')}`,async form=>{const file=form.get('file');if(file.size>5*1024*1024)throw new Error('地图文件不能超过 5MB');const doc=JSON.parse(await file.text());const result=await api.post(`/api/maps/${state.mapRow.id}/draft/save`,{revision:state.mapRow.revision,document:doc});state.mapRow=result;state.map.checkpoint();state.map.document=structuredClone(result.draft);state.map.changed();state.dirty=false;clearTimeout(state.saveTimer);state.map.fit();});
    if(name==='export-map'){saveBlob(new Blob([JSON.stringify(row.draft,null,2)],{type:'application/json'}),row.name+'.json');return;}
    if(name==='delete-map')return confirmation('删除地图',row.name,'绑定机器人或有任务占用时无法删除。',confirmation=>api.delete(`/api/maps/${id}`,{confirmation}));
    if(name==='map-versions'){const versions=await api.get(`/api/maps/${id}/versions`);return dialog('地图版本',table(['版本','发布时间','操作人','操作'],versions.map(v=>[v.version,stamp(v.created_at),escape(v.operator),button('回滚','rollback-map',`${id}:${v.version}`,'map:publish')])),null);}
    if(name==='rollback-map'){const [mapId,version]=id.split(':');$('dialog').close();const map=await api.get(`/api/maps/${mapId}`);return confirmation('回滚地图',map.name,`从 v${version} 创建新的发布版本。`,confirmation=>api.post(`/api/maps/${mapId}/rollback/${version}`,{revision:map.revision,confirmation}));}
    if(name==='add-app')return dialog('新增 WMS 应用',`<div class="form-grid">${field('code','应用编号','','text','required')}${field('name','应用名称','','text','required')}${field('ips','IP / 网段（逗号分隔）','','text','required')}${field('callback_url','HTTPS 回调地址')}${field('qps','每秒请求上限',50,'number','min="1" max="100"')}</div><p class="help">回调域名须先在服务器 RCS_CALLBACK_HOSTS 中配置。密钥仅显示一次。</p>`,async form=>{const result=await api.post('/api/integration/apps',{...Object.fromEntries(form),ips:form.get('ips').split(',').map(v=>v.trim()),qps:Number(form.get('qps'))});$('dialog').close();details('应用密钥（请立即保存）',result);await load();return false;});
    if(name==='toggle-app'){await api.post(`/api/integration/apps/${id}/toggle`);return load();}
    if(name==='rotate-secret')return confirmation('重置应用密钥',row.code,'旧密钥将立即失效，需同步更新对接方配置。',async v=>{if(v!==row.code)throw new Error('编号不一致');const result=await api.post(`/api/integration/apps/${id}/rotate-secret`);$('dialog').close();details('新密钥（请立即保存）',result);return false;});
    if(name==='callbacks'){const data=await api.get('/api/integration/callbacks');return dialog('回调记录',table(['任务','状态','重试次数','结果','操作'],data.list.map(c=>[c.task_id,badge(c.status),c.attempts,escape(c.result),['dead','retry'].includes(c.status)?button('重投','retry-callback',c.id,'integration:manage'):''])),null);}
    if(name==='retry-callback'){await api.post(`/api/integration/callbacks/${id}/retry`);$('dialog').close();return action('callbacks','');}
    if(name==='api-doc'){window.open('/docs','_blank','noopener');return;}
    if(name==='upload-firmware')return uploadFirmware();
    if(name==='audit-firmware'||name==='offline-firmware')return confirmation(name==='audit-firmware'?'审核发布固件':'下架固件',row.name,`${row.model} / ${row.version} · SHA256 已由服务端验证。`,confirmation=>api.post(`/api/firmware/${id}/${name==='audit-firmware'?'audit':'offline'}`,{confirmation}));
    if(name==='add-upgrade')return upgradeForm();
    if(name==='upgrade-detail'){const result=await api.get(`/api/upgrade/tasks/${id}`);return dialog('升级进度',`<p>${escape(result.name)} · ${badge(result.status)} · ${result.progress}%</p>`+table(['机器人','原版本','状态','进度','结果'],result.details.map(d=>[d.robot_id,escape(d.version_from),badge(d.status),d.progress+'%',escape(d.error)])),null);}
    if(name.startsWith('upgrade-'))return confirmation('升级任务操作',row.name,'暂停只停止后续批次；已经刷写的设备会继续等待回执。',confirmation=>api.post(`/api/upgrade/tasks/${id}/${name.slice(8)}`,{confirmation}));
  }
  function selectTab(tab,deferLoad=false){
    if(state.map&&!leaveMap())return;
    state.tab=tab;state.page=1;state.logBefore=null;state.logStack=[];clearNotice();
    $('title').textContent=modules.find(m=>m[0]===tab)[1];$('keyword').value='';
    const states={robots:['idle','busy','charging','offline','maintenance','locked'],battery:['idle','charging','offline'],alarms:['open','acknowledged','closed'],tasks:['queued','dispatched','running','success','failed','cancelled','timeout'],logs:['INFO','WARN','ERROR'],firmware:['uploading','review','released','offline']};
    $('state').innerHTML='<option value="">全部状态</option>'+(states[tab]||[]).map(v=>`<option value="${v}">${tab==='firmware'&&v==='offline'?'已下架':labels[v]||v}</option>`).join('');
    for(const key of ['start','end'])$(key).parentElement.hidden=!['alarms','tasks','logs'].includes(tab);
    $('state').hidden=!(states[tab]?.length);
    $('filters').hidden=tab==='dashboard';document.querySelectorAll('#nav button').forEach(b=>{const active=b.dataset.tab===tab;b.classList.toggle('active',active);if(active){b.setAttribute('aria-current','page');const group=b.closest?.('.operations-system-group');if(group)group.open=true;}else b.removeAttribute('aria-current');});
    location.hash=tab;if(!deferLoad)load();
  }
  async function init(){
    try{
      const me=await api.get('/api/operations/me');state.permissions=me.permissions;
      state.taskModeReady=false;
      if(can('task:view'))try{const mode=await api.get('/api/task-mode');if(['manual','auto','schedule'].includes(mode.mode)){state.taskMode=mode.mode;state.taskModeReady=true;}}catch(error){state.taskModeMessage='任务模式暂不可用，请刷新';state.taskModeError=true;}
      $('eyebrow').textContent=me.worker_enabled?'OPERATIONS CENTER':'OPERATIONS CENTER / 自动调度已暂停';
      const navigation=window.OperationsLayout.navigationGroups(modules,can);
      const navButtons=items=>items.map(m=>`<button class="rail-item" type="button" data-tab="${m[0]}"><span class="rail-icon">${navIcon(m[3])}</span><span class="rail-item-label">${escape(m[1])}</span><span class="rail-item-mark" aria-hidden="true"></span></button>`).join('');
      $('nav').innerHTML=`<div class="operations-main-group">${navButtons(navigation.core)}</div>${navigation.system.length?`<details class="operations-system-group"><summary>系统配置</summary><div>${navButtons(navigation.system)}</div></details>`:''}`;
      state.monitor=new window.OperationsMonitor(api,data=>{
        state.robots=data.robots||[];
        renderMapRobot();
        if(['robots','battery'].includes(state.tab))for(const robot of state.robots){
          const batteryNode=document.querySelector(`[data-battery="${robot.id}"]`);
          if(batteryNode)batteryNode.parentElement.innerHTML=battery(robot);
          const statusNode=document.querySelector(`[data-robot-status="${robot.id}"]`);
          if(statusNode)statusNode.innerHTML=badge(robot.status);
        }
        const low=state.robots.filter(r=>r.is_low&&r.online);
        $('low-banner').hidden=!low.length;$('low-banner').textContent=`低电量提醒：${low.length} 台机器人低于阈值 · ${low.map(r=>`${r.code} ${r.telemetry.battery}%`).join('，')}`;
      },(status,error)=>{$('connection').textContent={open:'实时',connecting:'连接中',polling:'降级轮询',error:'数据不可用'}[status];$('connection').className='badge '+(status==='open'?'good':'warn');if(error)$('connection').title=error;});
      if(can('monitor:view'))state.monitor.start();else $('connection').textContent='非实时查看';
      const requested=location.hash.slice(1),selected=modules.some(m=>m[0]===requested&&can(m[2]))?requested:modules.find(m=>can(m[2]))[0];
      const embeddedMaps=new URLSearchParams(location.search).has('embedded')&&selected==='maps'&&can('map:edit');
      selectTab(selected,embeddedMaps);
      if(embeddedMaps){
        const choices=await api.get('/api/maps',{pageNo:1,pageSize:100});state.mapChoices=choices.list||[];
        const params=new URLSearchParams(location.search),requestedId=params.get('mapId');
        if(params.get('openAsset')==='1'&&state.preferredAssetKey)await openAssetMap(state.preferredAssetKey);
        else{
          const target=state.mapChoices.find(map=>String(map.id)===String(requestedId))||state.mapChoices.find(map=>String(map.id)===localStorage.getItem('orange.currentRouteMap'))||state.mapChoices[0];
          if(target)await openMap(await api.get(`/api/maps/${target.id}`));else await load();
        }
      }
      state.viewTimer=setInterval(()=>{if(!document.hidden&&!state.map&&!$('dialog').open&&!document.querySelector('.rcs-tool-menu[open]'))load();},5000);
    }catch(error){
      $('content').innerHTML=`<div class="login-box"><h2>登录运营管理</h2><p class="help">沿用机器人平台账号。新增管理功能需要有效登录。</p><form id="login-form"><input name="userAccount" autocomplete="username" placeholder="账号" required><input name="userPassword" type="password" autocomplete="current-password" placeholder="密码" required><button class="primary">登录</button></form><p class="help" id="login-error">${escape(error.message)}</p></div>`;
      $('filters').hidden=true;
      $('login-form').onsubmit=async event=>{event.preventDefault();try{const result=await api.post('user/login',Object.fromEntries(new FormData(event.target)));localStorage.setItem('token',result);localStorage.setItem('tokenCreateTime',String(Date.now()));localStorage.removeItem('robot.tempSkipLogin');await init();}catch(e){$('login-error').textContent=e.message;}};
    }
  }
  function closeOperationsNav(){document.body.classList.remove('operations-nav-open');$('operations-nav-toggle').setAttribute('aria-expanded','false');}
  $('nav').onclick=event=>{const button=event.target.closest('[data-tab]');if(button){selectTab(button.dataset.tab);closeOperationsNav();}};
  $('operations-nav-toggle').onclick=()=>{const open=document.body.classList.toggle('operations-nav-open');$('operations-nav-toggle').setAttribute('aria-expanded',String(open));};
  $('operations-nav-close').onclick=closeOperationsNav;
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeOperationsNav();});
  const previousMap=localStorage.getItem('orange.currentRouteMap');if(/^\d+$/.test(previousMap||''))$('operations-home').href='index.html?mapId='+previousMap;
  document.addEventListener('fullscreenchange',()=>{const button=document.querySelector('#map-editor [data-action="map-fullscreen"]');if(button)button.textContent=document.fullscreenElement===document.getElementById('map-editor')?'退出大图':'大图显示';if(state.map)state.map.fit();});
  document.addEventListener('click',async event=>{const target=event.target.closest('[data-action]');if(!target||target.disabled)return;target.disabled=true;try{await action(target.dataset.action,target.dataset.id);}catch(error){notify(error.message,true);}finally{target.disabled=target.dataset.action==='map-remove'&&state.map?.selected==null&&!state.map?.shape;}});
  $('search').onclick=()=>{state.page=1;state.logBefore=null;state.logStack=[];load();};$('refresh').onclick=()=>load();
  $('fullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen().catch(e=>notify(e.message,true));};
  $('logout').onclick=async()=>{if(state.map&&!leaveMap())return;let remoteError;try{await api.post('user/logout');}catch(error){remoteError=error;}state.monitor?.stop();clearInterval(state.viewTimer);clearInterval(state.lockTimer);clearInterval(state.mapTaskTimer);clearTimeout(state.saveTimer);localStorage.removeItem('token');localStorage.removeItem('tokenCreateTime');state.permissions=[];$('nav').innerHTML='';await init();if(remoteError)alert('本机已退出；服务器未确认令牌失效，请检查连接。');};
  $('dialog-close').onclick=$('dialog-cancel').onclick=()=>$('dialog').close();
  document.addEventListener('visibilitychange',()=>{if(document.hidden)state.monitor?.stop();else{if(can('monitor:view'))state.monitor?.start();if(!state.map)load();}});
  window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
  window.addEventListener('pagehide',()=>{state.monitor?.stop();clearInterval(state.viewTimer);clearInterval(state.lockTimer);clearTimeout(state.saveTimer);state.map?.destroy();});
  document.addEventListener('keydown',event=>{if(!state.map||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;if(event.ctrlKey&&event.key.toLowerCase()==='z'){event.preventDefault();state.map.undo();}if(event.ctrlKey&&event.key.toLowerCase()==='y'){event.preventDefault();state.map.redo();}});
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin)return;
    if(event.data?.type==='robot-model-close'&&event.source===$('robot-model-frame')?.contentWindow){$('dialog').close();return;}
    if(event.data?.type==='robot-model-updated'&&event.source===$('robot-model-frame')?.contentWindow){refreshRobotModel();return;}
    if(event.source!==parent)return;
    if(event.data?.type==='workbench-mapping-preview'){if(event.data.visible)window.OrangeMappingPreview?.start();else window.OrangeMappingPreview?.stop();return;}
    if(event.data?.type==='workbench-open-map-asset'){
      openAssetMap(event.data.asset).catch(error=>notify(error.message,true));return;
    }
    if(event.data?.type!=='workbench-selected-map-asset')return;
    state.preferredAssetKey=typeof event.data.asset==='string'?event.data.asset:'';
    if(!state.map&&state.tab==='maps'&&!$('dialog').open)load().catch(error=>notify(error.message,true));
  });
  init();
})();
