(function(){
  const $=id=>document.getElementById(id),api=window.OpsAPI,base='/api/ros-runtime';
  const names={active:'服务运行',inactive:'服务停止',failed:'服务失败',activating:'启动中',deactivating:'停止中',unknown:'状态未知'};
  const verbs={start:'启动',stop:'停止',restart:'重启'};
  let data,selected,polling=false,busy=false;
  const text=(tag,value,className)=>{const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;};
  function message(value,error=false){$('notice').textContent=value;$('notice').classList.toggle('error',error);}
  function render(){
    $('environment').textContent=data.control_enabled?'服务管理已启用。维护前会检查停车与模式切换状态。':data.reason;
    $('checks').replaceChildren(...data.checks.map(check=>{const card=text('div','','check-card'+(check.ready?' good':''));card.append(text('strong',check.name),text('span',check.ready?'已就绪':'未就绪'),text('small',check.detail));return card;}));
    $('plc-start').disabled=busy||data.busy||!data.control_enabled||!data.plc_start_ready||!
      ['ROS 桥接','底盘反馈'].every(name=>data.checks.some(check=>check.name===name&&check.ready));
    $('plc-stop').disabled=busy||data.busy||!data.control_enabled||
      !data.checks.some(check=>check.name==='ROS 桥接'&&check.ready);
    $('plc-state').textContent='PLC 物理使能：未知。'+(data.plc_start_reason||data.plc_request?.message||'尚未请求操作。');
    $('services').replaceChildren(...data.services.map(service=>{
      const card=text('article','','service'),heading=text('div','','service-heading');heading.append(text('h2',service.name),text('span',service.load==='not-found'?'未安装':names[service.state]||service.state,'badge'));
      card.append(heading,text('p',service.description),text('code',service.unit),text('p','服务反馈：'+service.detail,'muted'),text('p','节点反馈：'+(service.observed_nodes.join('、')||'尚未发现预期节点'),'muted'));
      const actions=text('div','','service-actions');
      for(const action of service.actions){const button=text('button',verbs[action]);button.disabled=busy||data.busy||!data.control_enabled||service.load!=='loaded'||(action==='start'&&service.state==='active')||(action==='start'&&service.start_allowed===false);button.onclick=()=>{
        selected={service,action};$('action-title').textContent=verbs[action]+service.name;
        $('action-detail').textContent=service.id==='plc'?'启动 PLC 通信后会周期读写寄存器；仅在协议已核实、车辆物理禁动时启动。页面不提供停止/重启，避免中断控制通信。':action==='start'?'只启动预设服务，不发送行驶命令。启动后请核实各项反馈是否就绪。':'将先核实停车并锁定导航。定位服务维护后需要重新定位；建图采集中不能执行此操作。';$('plc-confirm-wrap').hidden=true;$('plc-confirm').required=false;$('reason').value='';$('confirm').showModal();};actions.append(button);}
      if(service.start_block_reason)card.append(text('p','启动条件：'+service.start_block_reason,'muted'));
      const logs=text('button','查看日志');logs.onclick=async()=>{try{$('log-title').textContent=service.name+' · 最近日志';$('logs').textContent='读取中…';$('logs').textContent=(await api.get(base+'/services/'+service.id+'/logs')).text;}catch(e){$('logs').textContent=e.message;}};actions.append(logs);card.append(actions);return card;
    }));
    $('nodes').textContent=data.graph_error||data.nodes.join('\n')||'未发现真实 ROS 节点；请先核实运行环境。';
    $('updated').textContent='最近检查 '+new Date().toLocaleTimeString();
  }
  async function refresh(){if(polling)return;polling=true;try{data=await api.get(base+'/status');render();}catch(e){message(e.message,true);}finally{polling=false;}}
  async function follow(job){busy=true;if(data)render();$('job').hidden=false;localStorage.setItem('ros-maintenance-job',job.id);try{for(;;){$('job').textContent=`${({queued:'等待执行',running:'处理中',success:'已完成',failed:'未完成'})[job.status]} · ${job.message}\n任务 ${job.id}`;if(['success','failed'].includes(job.status)){localStorage.removeItem('ros-maintenance-job');message(job.result?.message||job.message,job.status==='failed');break;}await new Promise(resolve=>setTimeout(resolve,1000));job=await api.get(base+'/jobs/'+job.id);}}catch(e){message(e.message+'；刷新页面可继续查询任务。',true);}finally{busy=false;await refresh();}}
  $('plc-start').onclick=()=>{selected={plc:'start'};$('action-title').textContent='请求 PLC 启动';$('action-detail').textContent='将先请求导航停止并核实车辆静止，再向 PLC 发启动信号。当前没有实际使能回执，发布后仍保持软件停车锁定，须现场核实。';$('plc-confirm-wrap').hidden=false;$('plc-confirm').required=true;$('plc-confirm').value='';$('plc-confirm').placeholder='PLC';$('plc-confirm-label').textContent='输入 PLC 确认';$('reason').value='';$('confirm').showModal();};
  $('plc-stop').onclick=()=>{selected={plc:'stop'};$('action-title').textContent='停车并保持软件锁定';$('action-detail').textContent='请求导航停车并核实静止。现有协议没有经过验证的物理停用命令，此操作不能替代急停或 PLC 断使能。';$('plc-confirm-wrap').hidden=false;$('plc-confirm').required=true;$('plc-confirm').value='';$('plc-confirm').placeholder='STOP';$('plc-confirm-label').textContent='输入 STOP 确认';$('reason').value='';$('confirm').showModal();};
  $('cancel').onclick=()=>$('confirm').close();
  $('action-form').onsubmit=async e=>{e.preventDefault();if(!selected||busy)return;const action=selected;busy=true;$('confirm').close();if(data)render();try{if(action.plc){const result=await api.post(base+'/plc/'+(action.plc==='start'?'start':'stop')+'-request',{confirmation:$('plc-confirm').value.trim(),reason:$('reason').value.trim()});message(result.message);busy=false;await refresh();return;}const job=await api.post(base+'/services/'+action.service.id+'/action',{action:action.action,reason:$('reason').value.trim()});await follow(job);}catch(error){message(error.message,true);busy=false;await refresh();}};
  $('check').onclick=()=>{message('');refresh();};refresh();
  const pending=localStorage.getItem('ros-maintenance-job');if(pending)api.get(base+'/jobs/'+pending).then(follow).catch(e=>{message(e.message,true);localStorage.removeItem('ros-maintenance-job');});
  setInterval(()=>{if(!document.hidden)refresh();},5000);
})();
