(function () {
  'use strict';
  const api = window.OpsAPI, $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels = {idle:'空闲',busy:'任务中',charging:'充电中',offline:'离线',disabled:'停用',maintenance:'维护',emergency:'急停',locked:'锁定',open:'未确认',acknowledged:'已确认',closed:'已关闭',queued:'排队',dispatched:'已下发',running:'执行中',stop_requested:'请求停止',success:'成功',failed:'失败',cancelled:'已取消',timeout:'超时',pending:'待执行',paused:'已暂停',completed:'已完成',partial_failed:'部分失败',uploading:'上传中',review:'待审核',released:'已发布',waiting:'等待',skipped:'跳过',retry:'等待重试',dead:'重试耗尽',sending:'发送中',rolled_back:'已回滚',rolling_back:'回滚中',downloading:'下载中',verifying:'校验中',flashing:'刷写中',rebooting:'重启中',critical:'严重',warning:'警告',info:'提示'};
  const modules = [
    ['dashboard','运营看板','dashboard:view'],['robots','机器人管理','robot:view'],['battery','电量监控','battery:view'],
    ['alarms','报警中心','alarm:view'],['tasks','任务历史','task:view'],['logs','日志中心','log:view'],
    ['maps','实时地图 / 线路编辑','map:view'],['integration','WMS 对接','integration:manage'],['firmware','固件库','firmware:view'],['upgrades','升级任务','firmware:view']
  ];
  const state = {tab:'dashboard', page:1, rows:[], robots:[], permissions:[], monitor:null, map:null, mapRow:null, mapChoices:[], selectedMapId:'', dirty:false, saveTimer:null, lockTimer:null, viewTimer:null, loadId:0, logBefore:null, logStack:[]};
  const can = permission => state.permissions.includes('*') || state.permissions.includes(permission);
  const stamp = value => value ? new Date(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : value+'Z').toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) : '—';
  const badge = value => `<span class="badge ${['success','completed','idle','released','closed'].includes(value)?'good':['failed','timeout','critical','emergency','dead'].includes(value)?'bad':['queued','busy','charging','warning','stop_requested'].includes(value)?'warn':''}">${escape(labels[value]||value)}</span>`;
  const button = (label, action, id, permission, cls='') => !permission||can(permission)?`<button class="${cls}" data-action="${action}" data-id="${escape(id)}">${label}</button>`:'';
  function notify(message,error=false){$('notice').hidden=false;$('notice').className=error?'error':'';$('notice').textContent=message;}
  function clearNotice(){$('notice').hidden=true;}
  function filterParams(){const params={keyword:$('keyword').value,state:$('state').value,pageNo:state.page,pageSize:20};for(const key of ['start','end'])if($(key).value)params[key]=new Date($(key).value).toISOString();return params;}
  function table(headers, rows){return rows.length?`<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<div class="panel empty">暂无数据<br>数据接入后将在此显示</div>';}
  function paginate(total){$('pagination').innerHTML=`<span>共 ${total} 条 · 第 ${state.page} 页</span><button id="prev" ${state.page<=1?'disabled':''}>上一页</button><button id="next" ${state.page*20>=total?'disabled':''}>下一页</button>`;$('prev').onclick=()=>{state.page--;load();};$('next').onclick=()=>{state.page++;load();};}
  function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function battery(row){const value=row.telemetry?.battery;return value==null?'—':`<span data-battery="${row.id}" class="battery ${row.is_low?'low':''}"><i><b style="width:${Math.max(0,Math.min(100,value))}%"></b></i>${value}% ${row.telemetry.charging?'⚡':''}</span>${!row.online?'<span class="sub">最后已知电量</span>':''}`;}
  function field(name,label,value='',type='text',extra=''){return `<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;}
  function selectField(name,label,options,value=''){return `<label>${label}<select name="${name}">${options.map(([v,l])=>`<option value="${escape(v)}" ${String(v)===String(value)?'selected':''}>${escape(l)}</option>`).join('')}</select></label>`;}
  function dialog(title,html,handler,submit='保存'){
    $('dialog-title').textContent=title;$('dialog-body').innerHTML=html;$('dialog-error').textContent='';$('dialog-submit').hidden=!handler;$('dialog-submit').textContent=submit;
    $('dialog-form').onsubmit=async event=>{event.preventDefault();if(!handler)return;const submitButton=$('dialog-submit');submitButton.disabled=true;try{const close=await handler(new FormData(event.target));if(close!==false){$('dialog').close();await load();}}catch(error){$('dialog-error').textContent=error.message;}finally{submitButton.disabled=false;}};
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
    return `<div class="cards">${data.metrics.map(m=>`<article class="card" title="${escape(m.formula)}"><p>${escape(m.name)}</p><strong>${m.value??'—'}</strong><em>${escape(m.unit)}</em><small>${escape(m.formula)}</small></article>`).join('')}</div><div class="panels"><article class="panel"><h2>近七天任务趋势</h2>${Object.keys(data.trend).length?chart(data.trend):'<p class="empty">尚无任务执行记录</p>'}</article><article class="panel"><h2>机器人状态分布</h2>${Object.entries(data.status).map(([status,count])=>`<div class="bar-row"><span>${escape(labels[status]||status)}</span><div class="bar"><i style="width:${count/Math.max(1,state.robots.length)*100}%"></i></div><b>${count}</b></div>`).join('')||'<p class="empty">尚未添加机器人</p>'}</article><article class="panel"><h2>七天任务热力 · 周一至周日 / 0—23 时</h2><div class="heat">${Array.from({length:168},(_,i)=>{const count=data.heat[`${Math.floor(i/24)}-${i%24}`]||0;return `<i title="周${Math.floor(i/24)+1} ${i%24}时：${count} 单" style="${count?`background:rgba(235,117,40,${Math.min(1,.25+count/20)})`:''}"></i>`;}).join('')}</div><p class="help">业务日期统一按 Asia/Shanghai 统计；空分母显示 —。${data.trend_truncated?'趋势超过 10 万条，已截断。':''}</p></article><article class="panel"><h2>运行提示</h2><p class="help">设备状态来自已认证心跳。操作指令需要设备回执后才会显示成功。断线时自动使用 3 秒快照轮询。</p><p class="help">上次统计：${stamp(data.updated_at)}</p></article></div>`;
  }
  function controls(){
    const actions={robots:button('导出档案','export-robots','','robot:view')+button('导入档案','import-robots','','robot:import')+button('新增机器人','add-robot','', 'robot:edit')+button('批量回充','batch-charge','','robot:control'),battery:button('低电量回充','batch-charge','','robot:control'),tasks:button('统计分析','task-stats','','task:view')+button('创建任务','add-task','','task:edit'),logs:button('下载 CSV','export-logs','','log:export'),maps:button('新建地图','add-map','','map:edit'),integration:button('新增应用','add-app','','integration:manage')+button('回调记录','callbacks','','integration:manage')+button('接口文档','api-doc','','integration:manage'),firmware:button('上传固件','upload-firmware','','firmware:upload'),upgrades:button('创建升级任务','add-upgrade','','firmware:upgrade')};
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
        html=table(['任务','来源 / 外部单号','机器人','起点 → 终点','状态','创建时间','操作'],data.list.map(r=>[escape(r.name),`${escape(r.source)}<span class="sub">${escape(r.external_id||'')}</span>`,escape(r.robot_id||'等待分配'),`${escape(r.from_point)} → ${escape(r.to_point)}`,badge(r.status),stamp(r.created_at),button('时间轴','task-detail',r.id)+(r.status==='queued'?button('取消','cancel-task',r.id,'task:edit'):['dispatched','running'].includes(r.status)&&can('robot:control')?button('停止并锁定','stop-task',r.id,'task:edit','danger'):'')]));
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
        html=window.OperationsMapPicker.render(state.mapChoices,can('map:edit'),state.selectedMapId)+table(['地图名称','草稿修订','发布版本','点位 / 路径 / 区域','更新人','操作'],data.list.map(r=>[escape(r.name),r.revision,r.published_version||'未发布',`${r.draft.points.length} / ${r.draft.paths.length} / ${r.draft.areas.length}`,escape(r.operator),button('打开编辑器','edit-map',r.id,'map:edit')+button('版本','map-versions',r.id,'map:view')+button('导出','export-map',r.id,'map:view')+button('删除','delete-map',r.id,'map:edit','danger')]));
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
      $('content').innerHTML=html;
      if(tab==='maps'){
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
    const maps=(await api.get('/api/maps',{pageSize:100})).list.filter(m=>m.published_version);
    if(!maps.length)throw new Error('请先发布一张通过校验的地图');
    dialog('创建调度任务',`<p class="help">任务会在匹配地图且空闲的机器人上线后下发。设备适配器必须支持 execute-task 协议。</p><div class="form-grid">${field('name','任务名称','','text','required')}${selectField('map_id','已发布地图',maps.map(m=>[m.id,m.name]))}${field('from_point','起点编号','','text','required')}${field('to_point','终点编号','','text','required')}${field('priority','优先级（1—9）',5,'number','min="1" max="9" required')}${selectField('robot_id','机器人',[['','自动分配'],...state.robots.map(r=>[r.id,r.code])])}</div>`,form=>api.post('/api/task-history',{...Object.fromEntries(form),map_id:Number(form.get('map_id')),priority:Number(form.get('priority')),robot_id:form.get('robot_id')?Number(form.get('robot_id')):null}),'创建任务');
  }
  async function openMap(row){
    await api.post(`/api/maps/${row.id}/lock`);state.mapRow=row;state.dirty=false;
    $('filters').hidden=true;$('pagination').innerHTML='';
    $('content').innerHTML=`<div class="map-editor" id="map-editor"><div class="map-tools">${button('返回列表','leave-map','')}${button('选择 / 拖动','tool-select','')}${button('添加站点','tool-point','')}${button('直线路径','tool-path','')}${button('平滑曲线','tool-curve','')}${button('绘制作业区','tool-area','')}<label class="map-toolbar-select">新区域类型<select id="map-area-kind"><option value="forbidden">禁行区</option><option value="slow">减速区</option><option value="work">作业区</option><option value="charge">充电区</option></select></label>${button('平移','tool-pan','')}${button('撤销','map-undo','')}${button('重做','map-redo','')}${button('删除选中','map-remove','')}${button('适应窗口','map-fit','')}${button('大图显示','map-fullscreen','')}${button('保存草稿','map-save','')}${button('校验','map-validate','')}${button('发布','map-publish',row.id,'map:publish')}${button('导入 JSON','map-import','')}${button('上传底图','map-image','')}</div><p id="map-live-status" class="help" role="status">正在连接实时定位…</p><div class="map-editor-help"><span>点位拖动可微调坐标；滚轮缩放，中键拖动平移。直线或曲线路径：依次点击两个站点。</span><span>作业区依次点边界顶点，双击闭合；禁行区与减速区会参与路线校验。</span></div><div class="map-legend"><span><i class="path-swatch"></i>草稿路线</span><span><i class="live-done-swatch"></i>已行驶路段</span><span><i class="live-active-swatch"></i>当前路段</span><span><i class="live-unknown-swatch"></i>进度未确认</span><span><i class="trail-swatch"></i>实测轨迹</span><span><i class="station-swatch"></i>站点</span><span><i class="zone-swatch forbidden"></i>禁行</span><span><i class="zone-swatch slow"></i>减速</span><span><i class="zone-swatch work"></i>作业</span><span><i class="zone-swatch charge"></i>充电</span></div><div class="map-layout" id="map-layout"><canvas id="map-canvas" aria-label="地图、运行路线、站点与作业区编辑画布"></canvas><aside class="map-properties"><h3>${escape(row.name)}</h3><p id="map-save-state" class="help">草稿 r${row.revision} · 已发布 v${row.published_version}</p><p class="help">编辑草稿不会改变正在执行的路线。平滑曲线会保存并以下发路线点形式传给 ROS；实车平顺度仍需现场验证。</p><div id="point-properties">选择站点、路径或区域以编辑详细属性</div><div class="map-issues" id="map-issues"></div></aside></div></div>`;
    state.map=new window.OperationsMapCanvas($('map-canvas'),row.draft,()=>{
      state.dirty=true;$('map-save-state').textContent='有未保存修改';clearTimeout(state.saveTimer);
      state.saveTimer=setTimeout(()=>saveMap().catch(error=>notify(error.message,true)),10000);
    },point=>{
      if(point?.kind==='paths'){
        $('point-properties').innerHTML=`<p class="inspector-title">${escape(point.start)} → ${escape(point.end)}</p>${selectField('shape-curve-mode','路线形状',[['straight','直线'],['smooth','平滑曲线']],point.curve_mode||'straight')}${field('shape-curve-offset','最大偏移（米，负数向另一侧）',point.curve_offset??0,'number','step="0.05"')}${field('shape-speed','速度上限（米/秒）',point.speed,'number','min="0.01" max="3" step="0.01"')}${field('shape-width','通道宽度（米，配置参考）',point.width,'number','min="0.01" max="20" step="0.01"')}${selectField('shape-direction','通行方向',[['true','双向'],['false','单向']],String(point.bidirectional))}<p class="help">曲线会保存为三次贝塞尔中心线，并以采样路线点发送给 ROS。发布校验会检查曲线越界和穿越禁行区；通道宽度目前仅作配置参考。</p>${button('应用路径设置','map-shape-apply','paths')}`;return;
      }
      if(point?.kind==='areas'){
        $('point-properties').innerHTML=`${field('shape-name','区域名称',point.name)}${selectField('shape-type','区域用途',[['forbidden','禁行区'],['slow','减速区'],['work','作业区'],['charge','充电区']],point.type)}${field('shape-speed','限速（米/秒，仅减速区生效）',point.speed,'number','min="0.01" max="3" step="0.01"')}<label class="map-polygon-editor">边界顶点（JSON 坐标数组）<textarea name="shape-polygon" rows="6" spellcheck="false">${escape(JSON.stringify(point.polygon))}</textarea></label><p class="help">坐标格式：[[x1,y1],[x2,y2],[x3,y3]]。禁行区会阻止发布/路线规划，减速区限制路线速度；作业/充电区用于区域标识。</p>${button('应用区域设置','map-shape-apply','areas')}`;return;
      }
      $('point-properties').innerHTML=point?`<p class="inspector-title">站点 ${escape(point.code)}</p>${field('point-code','编号',point.code)}${field('point-name','站点名称',point.name||'')}${selectField('point-type','站点用途',[['station','普通站点'],['charger','充电点'],['shelf','货架点'],['waiting','等候点'],['elevator','电梯点']],point.type)}${field('point-theta','目标朝向（弧度）',point.theta,'number','step="0.01"')}${button('应用站点设置','map-point-apply','')}`:'未选择站点；可在画布上添加站点，然后拖动到精确位置。';
    });
    $('map-area-kind').onchange=()=>state.map?.setAreaType($('map-area-kind').value);
    state.map.liveController=new window.LiveMap(state.map,row.id,$('map-live-status'));
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
    $('map-save-state').textContent=`草稿 r${result.revision} 已保存`;
  }
  function leaveMap(){if(state.dirty&&!confirm('存在未保存修改，确定离开？'))return false;if(document.fullscreenElement===$('map-editor'))document.exitFullscreen().catch(()=>{});clearTimeout(state.saveTimer);clearInterval(state.lockTimer);state.map?.destroy();state.map=null;state.mapRow=null;state.dirty=false;$('filters').hidden=false;return true;}
  async function loadMapImage(){
    const blob=await api.download(`/api/maps/${state.mapRow.id}/image/${state.map.document.image}`);
    const url=URL.createObjectURL(blob),image=new Image();
    image.onload=()=>{if(state.map){state.map.image=image;state.map.draw();}URL.revokeObjectURL(url);};
    image.onerror=()=>URL.revokeObjectURL(url);image.src=url;
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
    const row=state.rows.find(r=>r.id===Number(id));
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
    if(name==='export-logs'){const params=filterParams();params.level=params.state;saveBlob(await api.download('/api/logs/export',params),'运行日志.csv');return;}
    if(name==='add-map')return dialog('新建地图',`<div class="form-grid">${field('name','地图名称','','text','required')}${field('width','宽度（米）',100,'number','min="1" required')}${field('height','高度（米）',100,'number','min="1" required')}${field('resolution','分辨率（米/像素）',.05,'number','min="0.001" step="0.001"')}</div>`,form=>api.post('/api/maps',{name:form.get('name'),document:{width:Number(form.get('width')),height:Number(form.get('height')),resolution:Number(form.get('resolution')),points:[],paths:[],areas:[]}}));
    if(name==='open-selected-map'){
      if(!id)throw new Error('请先从已有地图列表中选择一张地图。');
      return openMap(await api.get(`/api/maps/${id}`));
    }
    if(name==='edit-map')return openMap(row);
    if(name==='leave-map'){if(leaveMap())return load();return;}
    if(name.startsWith('tool-')){state.map.tool=name.slice(5);document.querySelectorAll('#map-editor [data-action^="tool-"]').forEach(tool=>tool.classList.toggle('map-tool-active',tool.dataset.action===name));notify({select:'拖动站点可调整坐标；点击路径或区域可编辑',point:'点击画布添加站点',path:'依次点击两个站点创建直线路径',curve:'依次点击两个站点创建平滑曲线路径',area:'依次点击区域顶点，双击闭合；新区域类型可在工具栏选择',pan:'拖动画布平移'}[state.map.tool]);return;}
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
    if(name==='map-validate'){await saveMap();const issues=await api.post(`/api/maps/${state.mapRow.id}/validate`);$('map-issues').textContent=issues.length?issues.map(e=>`${e.element} ${e.message}`).join('\n'):'校验通过';return;}
    if(name==='map-publish'){await saveMap();const map=state.mapRow;return confirmation('发布地图',map.name,'发布前将校验连通性、禁行区与占用情况。设备从发布版本接口拉取地图。',async confirmation=>{await api.post(`/api/maps/${map.id}/publish`,{revision:map.revision,confirmation});state.mapRow=await api.get(`/api/maps/${map.id}`);notify('地图已发布，设备加载结果需由设备侧确认。');});}
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
  function selectTab(tab){
    if(state.map&&!leaveMap())return;
    state.tab=tab;state.page=1;state.logBefore=null;state.logStack=[];clearNotice();
    $('title').textContent=modules.find(m=>m[0]===tab)[1];$('keyword').value='';
    const states={robots:['idle','busy','charging','offline','maintenance','locked'],battery:['idle','charging','offline'],alarms:['open','acknowledged','closed'],tasks:['queued','dispatched','running','success','failed','cancelled','timeout'],logs:['INFO','WARN','ERROR'],firmware:['uploading','review','released','offline']};
    $('state').innerHTML='<option value="">全部状态</option>'+(states[tab]||[]).map(v=>`<option value="${v}">${tab==='firmware'&&v==='offline'?'已下架':labels[v]||v}</option>`).join('');
    for(const key of ['start','end'])$(key).parentElement.hidden=!['alarms','tasks','logs'].includes(tab);
    $('state').hidden=!(states[tab]?.length);
    $('filters').hidden=tab==='dashboard';document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    location.hash=tab;load();
  }
  async function init(){
    try{
      const me=await api.get('/api/operations/me');state.permissions=me.permissions;
      $('eyebrow').textContent=me.worker_enabled?'OPERATIONS CENTER':'OPERATIONS CENTER / 自动调度已暂停';
      $('nav').innerHTML=modules.filter(m=>can(m[2])).map((m,i)=>`<button data-tab="${m[0]}"><span>${String(i+1).padStart(2,'0')}</span>${m[1]}</button>`).join('');
      state.monitor=new window.OperationsMonitor(api,data=>{
        state.robots=data.robots||[];
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
      const requested=location.hash.slice(1);selectTab(modules.some(m=>m[0]===requested&&can(m[2]))?requested:modules.find(m=>can(m[2]))[0]);
      state.viewTimer=setInterval(()=>{if(!document.hidden&&!state.map&&!$('dialog').open)load();},5000);
    }catch(error){
      $('content').innerHTML=`<div class="login-box"><h2>登录运营管理</h2><p class="help">沿用机器人平台账号。新增管理功能需要有效登录。</p><form id="login-form"><input name="userAccount" autocomplete="username" placeholder="账号" required><input name="userPassword" type="password" autocomplete="current-password" placeholder="密码" required><button class="primary">登录</button></form><p class="help" id="login-error">${escape(error.message)}</p></div>`;
      $('filters').hidden=true;
      $('login-form').onsubmit=async event=>{event.preventDefault();try{const result=await api.post('user/login',Object.fromEntries(new FormData(event.target)));localStorage.setItem('token',result);localStorage.setItem('tokenCreateTime',String(Date.now()));localStorage.removeItem('robot.tempSkipLogin');await init();}catch(e){$('login-error').textContent=e.message;}};
    }
  }
  $('nav').onclick=event=>{const button=event.target.closest('[data-tab]');if(button)selectTab(button.dataset.tab);};
  document.addEventListener('fullscreenchange',()=>{const button=document.querySelector('#map-editor [data-action="map-fullscreen"]');if(button)button.textContent=document.fullscreenElement===document.getElementById('map-editor')?'退出大图':'大图显示';if(state.map)state.map.fit();});
  document.addEventListener('click',async event=>{const target=event.target.closest('[data-action]');if(!target)return;target.disabled=true;try{await action(target.dataset.action,target.dataset.id);}catch(error){notify(error.message,true);}finally{target.disabled=false;}});
  $('search').onclick=()=>{state.page=1;state.logBefore=null;state.logStack=[];load();};$('refresh').onclick=()=>load();
  $('fullscreen').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen().catch(e=>notify(e.message,true));};
  $('logout').onclick=async()=>{if(state.map&&!leaveMap())return;let remoteError;try{await api.post('user/logout');}catch(error){remoteError=error;}state.monitor?.stop();clearInterval(state.viewTimer);clearInterval(state.lockTimer);clearTimeout(state.saveTimer);localStorage.removeItem('token');localStorage.removeItem('tokenCreateTime');state.permissions=[];$('nav').innerHTML='';await init();if(remoteError)alert('本机已退出；服务器未确认令牌失效，请检查连接。');};
  $('dialog-close').onclick=$('dialog-cancel').onclick=()=>$('dialog').close();
  document.addEventListener('visibilitychange',()=>{if(document.hidden)state.monitor?.stop();else{if(can('monitor:view'))state.monitor?.start();if(!state.map)load();}});
  window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
  window.addEventListener('pagehide',()=>{state.monitor?.stop();clearInterval(state.viewTimer);clearInterval(state.lockTimer);clearTimeout(state.saveTimer);state.map?.destroy();});
  document.addEventListener('keydown',event=>{if(!state.map||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;if(event.ctrlKey&&event.key.toLowerCase()==='z'){event.preventDefault();state.map.undo();}if(event.ctrlKey&&event.key.toLowerCase()==='y'){event.preventDefault();state.map.redo();}});
  init();
})();
