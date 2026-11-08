const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('frontend/src/modules/operations/operations.js','utf8');
const functions=source.slice(0,source.indexOf("  $('nav').onclick="))+'window.probe={state,dialog,closeDialog,preventPendingDialogCancel,canLeaveOperations,saveMap,leaveMap,mapRecoveries,refreshMapTasks,refreshMapMissions,renderMapMissions,action};})();';
function harness(){
  const nodes=new Map(),calls=[];
  function element(id){
    if(!nodes.has(id)){
      const classes=new Set(),attributes=new Map();
      nodes.set(id,{id,textContent:'',innerHTML:'',disabled:false,hidden:false,open:false,dataset:{},
        classList:{contains:name=>classes.has(name),toggle(name,value){if(value)classes.add(name);else classes.delete(name)},remove:name=>classes.delete(name)},
        setAttribute:(name,value)=>attributes.set(name,value),getAttribute:name=>attributes.get(name),querySelectorAll:()=>[],addEventListener(){},
        showModal(){this.open=true},close(){this.open=false}});
    }
    return nodes.get(id);
  }
  const api={get:async(url,params)=>{calls.push({method:'get',url,params});return {list:[],total:0}},post:async(url,payload)=>{calls.push({method:'post',url,payload});return {}}};
  const window={OpsAPI:api,alert:message=>calls.push({method:'alert',message}),confirm:()=>false};
  vm.runInNewContext(functions,{window,document:{getElementById:element,querySelectorAll:()=>[],documentElement:{classList:{contains:()=>false}}},location:{search:'',origin:'http://localhost'},URLSearchParams,structuredClone,clearTimeout,FormData:class{constructor(values){this.values=values}get(key){return this.values[key]}},Set,Map,Date,Math});
  const controller=window.probe;
  Object.assign(controller.state,{map:{document:{points:[],paths:[],areas:[]}},mapRow:{id:10,revision:1},permissions:['*']});
  return {controller,element,api,calls};
}

test('active navigation remains actionable when six newer history rows exist',async()=>{
  const h=harness(),active={id:1,map_id:10,name:'仍在行驶的旧任务',status:'running',from_point:'A',to_point:'B'};
  h.api.get=async(url,params)=>{
    h.calls.push({method:'get',url,params});
    return params.active_only?{list:[active],total:1}:{list:Array.from({length:6},(_,i)=>({id:i+2,map_id:10,name:'新任务',status:'queued'})),total:7};
  };
  await h.controller.refreshMapTasks();
  assert.equal(h.controller.state.mapTasks.some(task=>task.id===1),false);
  assert.match(h.element('map-task-active').innerHTML,/仍在行驶的旧任务/);
  assert.match(h.element('map-task-active').innerHTML,/task-motion-pause/);
  await h.controller.action('task-motion-pause',1);
  assert.equal(h.calls.filter(call=>call.method==='post'&&call.url==='/api/task-history/1/pause').length,1);
  assert.equal(h.calls.filter(call=>call.method==='get'&&call.params.active_only).length,2);
});

test('active mission wins over a previously selected completed mission in the execution panel',()=>{
  const h=harness();h.controller.state.selectedMissionId=1;
  const common={steps:[{point:'B'}],repeat_count:1,cycles_completed:0,step_index:0,task_mode:'auto'};
  h.controller.state.mapMissionRuns=[{...common,id:1,name:'旧历史',status:'success'},
    {...common,id:2,name:'当前任务链',status:'running',active_task:{id:8,status:'running',from_point:'A',to_point:'B'}}];
  h.controller.renderMapMissions();
  assert.match(h.element('map-mission-execution').innerHTML,/当前任务链/);
  assert.match(h.element('map-mission-execution').innerHTML,/data-action="mission-pause" data-id="2"/);
  assert.equal(h.controller.state.selectedMissionId,2);
});

test('late save responses cannot replace a different map or dereference a closed editor',async()=>{
  for(const leave of [false,true]){
    const h=harness();h.controller.state.dirty=true;
    let resolve;h.api.post=()=>new Promise(done=>{resolve=done});
    const saving=h.controller.saveMap();
    const statusBeforeReceipt=h.element('map-save-state').textContent;
    const replacement=leave?null:{document:{points:[{code:'new-map'}],paths:[],areas:[]}};
    h.controller.state.map=replacement;h.controller.state.mapRow=leave?null:{id:20,revision:7};h.controller.state.dirty=!leave;
    resolve({id:10,revision:2,draft:{points:[],paths:[],areas:[]}});await saving;
    assert.equal(h.controller.state.map,replacement);
    assert.equal(h.controller.state.mapRow?.id,leave?undefined:20);
    assert.equal(h.controller.state.dirty,!leave);
    assert.equal(h.element('map-save-state').textContent,statusBeforeReceipt);
  }
});

test('failed save preserves the editable draft and local snapshot before a retry',async()=>{
  const h=harness(),state=h.controller.state,editor=state.map;
  state.dirty=true;editor.document.points.push({code:'A'});
  const local=[];
  h.controller.mapRecoveries.set(editor,{write:(document,revision)=>{local.push({document:structuredClone(document),revision});return true;},remove:()=>local.pop()});
  h.api.post=async()=>{throw Error('Network Error');};
  assert.equal(await h.controller.leaveMap(),false);
  assert.equal(state.map,editor);
  assert.deepEqual(local.at(-1),{document:{points:[{code:'A'}],paths:[],areas:[]},revision:1});
  assert.match(h.element('map-save-state').textContent,/本机已暂存/);
  h.api.post=async()=>({id:10,revision:2,published_version:1});
  await h.controller.saveMap();
  assert.equal(state.dirty,false);
  assert.equal(local.length,0);
  assert.match(h.element('map-save-state').textContent,/服务器已保存草稿 r2/);
});

test('publishing uses the server receipt without a second fetch that could report a false failure',async()=>{
  const h=harness();
  Object.assign(h.controller.state.mapRow,{name:'验证地图',published_version:2});
  h.api.post=async(url,payload)=>{h.calls.push({method:'post',url,payload});return {version:3};};
  await h.controller.action('map-publish');
  await h.element('dialog-form').onsubmit({preventDefault(){},target:{confirmation:'验证地图'}});
  assert.equal(h.calls.filter(call=>call.method==='post').length,1);
  assert.equal(h.calls.filter(call=>call.method==='get').length,0);
  assert.match(h.element('map-save-state').textContent,/已发布 v3 · 等待设备加载确认/);
  assert.equal(h.controller.state.mapRow.revision,2);
});

test('a second save waits for the first and persists edits made while the first was pending',async()=>{
  const h=harness(),requests=[];h.controller.state.dirty=true;
  h.api.post=(url,payload)=>new Promise(resolve=>requests.push({url,payload,resolve}));
  const first=h.controller.saveMap();
  h.controller.state.map.document.points.push({code:'new-edit'});
  const second=h.controller.saveMap();assert.equal(requests.length,1);
  requests[0].resolve({id:10,revision:2});
  await new Promise(setImmediate);assert.equal(requests.length,2);
  assert.equal(requests[1].payload.revision,2);
  assert.equal(requests[1].payload.document.points[0].code,'new-edit');
  requests[1].resolve({id:10,revision:3});await Promise.all([first,second]);
  assert.equal(h.controller.state.dirty,false);assert.equal(h.controller.state.mapRow.revision,3);
});

test('pending confirmations block close, cancel and duplicate submissions until receipt',async()=>{
  const h=harness();let resolve,submissions=0;
  h.controller.dialog('继续原路线','',()=>{submissions++;return new Promise(done=>{resolve=done})});
  const event={preventDefault(){},target:{}};
  const submitting=h.element('dialog-form').onsubmit(event);
  assert.equal(h.element('dialog-submit').disabled,true);assert.equal(h.element('dialog-close').disabled,true);
  assert.equal(h.element('dialog-cancel').disabled,true);assert.equal(h.element('dialog').getAttribute('aria-busy'),'true');
  h.controller.closeDialog();assert.equal(h.element('dialog').open,true);
  assert.equal(h.controller.canLeaveOperations(),false);assert.equal(h.calls.at(-1).method,'alert');
  let prevented=false;h.controller.preventPendingDialogCancel({preventDefault(){prevented=true}});assert.equal(prevented,true);
  await h.element('dialog-form').onsubmit(event);assert.equal(submissions,1);
  resolve();await submitting;
  assert.equal(h.element('dialog').open,false);assert.equal(h.element('dialog-close').disabled,false);
});

test('a late old receipt never closes or overwrites a replacement dialog',async()=>{
  const h=harness();let resolve;
  h.controller.dialog('第一项操作','',()=>new Promise(done=>{resolve=done}));
  const submitting=h.element('dialog-form').onsubmit({preventDefault(){},target:{}});
  // Successful multi-stage workflows may deliberately replace their own dialog.
  h.controller.dialog('第二个设置窗口','',null);
  resolve();await submitting;
  assert.equal(h.element('dialog').open,true);assert.equal(h.element('dialog-title').textContent,'第二个设置窗口');
  assert.equal(h.element('dialog-submit').hidden,true);assert.equal(h.element('dialog-error').textContent,'');
});


test('active missions are fetched separately from eight newer history rows and merged once',async()=>{
  const h=harness(),common={steps:[{point:'B'}],repeat_count:1,cycles_completed:0,step_index:0,task_mode:'auto'};
  const active={...common,id:1,name:'较早但仍暂停的任务链',status:'paused',active_task:{status:'running',motion_state:'paused',from_point:'A',to_point:'B'}};
  h.api.get=async(url,params)=>{
    h.calls.push({method:'get',url,params});
    if(url==='/api/task-mode')return {mode:'manual'};
    if(url==='/api/task-plans')return [];
    return params.active_only?[active]:[...Array.from({length:8},(_,index)=>({...common,id:index+2,name:'新历史',status:'success'})),active];
  };
  await h.controller.refreshMapMissions();
  assert.equal(h.controller.state.mapMissionRuns.filter(run=>run.id===1).length,1);
  assert.match(h.element('map-mission-execution').innerHTML,/较早但仍暂停的任务链/);
  assert.match(h.element('map-mission-execution').innerHTML,/继续原路线/);
  assert.equal(h.calls.filter(call=>call.url==='/api/mission-runs'&&call.params.active_only).length,1);
});


test('a selected future queue entry does not hide a currently running mission',()=>{
  const h=harness(),common={steps:[{point:'B'}],repeat_count:1,cycles_completed:0,step_index:0,task_mode:'auto'};
  h.controller.state.selectedMissionId=2;
  h.controller.state.mapMissionRuns=[{...common,id:2,name:'明天的任务',status:'queued'},
    {...common,id:1,name:'正在行驶的任务',status:'running',active_task:{id:4,status:'running',from_point:'A',to_point:'B'}}];
  h.controller.renderMapMissions();
  assert.match(h.element('map-mission-execution').innerHTML,/正在行驶的任务/);
  assert.match(h.element('map-mission-execution').innerHTML,/data-action="mission-pause" data-id="1"/);
});

test('a refused deletion restores the document, history, selection and remaining paths',async()=>{
  const h=harness(),state=h.controller.state;
  const document={points:[{code:'A'},{code:'B'},{code:'C'}],paths:[{uid:'ab',start:'A',end:'B'},{uid:'bc',start:'B',end:'C'}],areas:[]};
  const impact={kind:'paths',index:0,label:'A → B',uid:'ab',point_codes:[],path_indices:[0],area_indices:[]};
  const original=structuredClone(document),history=[{old:'history'}];
  Object.assign(state.map,{document,history:structuredClone(history),future:[],selected:null,shape:{kind:'paths',index:0},selectedPathIndices:new Set([1]),
    deletionImpact:()=>impact,setImpactPreview(){},draw(){},selectObject(kind,index){this.shape={kind,index}},
    remove(){this.history.push(structuredClone(this.document));this.document.paths.splice(0,1);this.shape=null;this.selectedPathIndices.clear();state.dirty=true;}});
  h.api.post=async url=>{if(url.endsWith('delete-preview'))return {allowed:true,path_indices:[0],warnings:['删除后草稿需要重新连接']};throw Error('任务引用已变化，服务器拒绝删除');};
  await h.controller.action('map-remove');
  assert.match(h.element('dialog-body').innerHTML,/删除后草稿需要重新连接/);
  await h.element('dialog-form').onsubmit({preventDefault(){},target:{confirmation:impact.label}});
  assert.deepEqual(state.map.document,original);
  assert.deepEqual(state.map.history,history);
  assert.deepEqual(state.map.shape,{kind:'paths',index:0});
  assert.deepEqual([...state.map.selectedPathIndices],[1]);
  assert.equal(state.dirty,false);
  assert.equal(h.element('dialog').open,true);
  assert.match(h.element('dialog-error').textContent,/请刷新核对服务器/);
});
