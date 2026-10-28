const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('frontend/src/modules/operations/operations.js','utf8');
const functions=source.slice(0,source.indexOf("  $('nav').onclick="))+'window.probe={state,dialog,closeDialog,preventPendingDialogCancel,canLeaveOperations,saveMap,refreshMapTasks,refreshMapMissions,renderMapMissions,action};})();';
function harness(){
  const nodes=new Map(),calls=[];
  function element(id){
    if(!nodes.has(id)){
      const classes=new Set(),attributes=new Map();
      nodes.set(id,{id,textContent:'',innerHTML:'',disabled:false,hidden:false,open:false,dataset:{},
        classList:{contains:name=>classes.has(name),toggle(name,value){if(value)classes.add(name);else classes.delete(name)},remove:name=>classes.delete(name)},
        setAttribute:(name,value)=>attributes.set(name,value),getAttribute:name=>attributes.get(name),querySelectorAll:()=>[],
        showModal(){this.open=true},close(){this.open=false}});
    }
    return nodes.get(id);
  }
  const api={get:async(url,params)=>{calls.push({method:'get',url,params});return {list:[],total:0}},post:async(url,payload)=>{calls.push({method:'post',url,payload});return {}}};
  const window={OpsAPI:api,alert:message=>calls.push({method:'alert',message}),confirm:()=>false};
  vm.runInNewContext(functions,{window,document:{getElementById:element,querySelectorAll:()=>[],documentElement:{classList:{contains:()=>false}}},location:{search:'',origin:'http://localhost'},URLSearchParams,structuredClone,clearTimeout,FormData:class{},Set,Map,Date,Math});
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
    const replacement=leave?null:{document:{points:[{code:'new-map'}],paths:[],areas:[]}};
    h.controller.state.map=replacement;h.controller.state.mapRow=leave?null:{id:20,revision:7};h.controller.state.dirty=!leave;
    resolve({id:10,revision:2,draft:{points:[],paths:[],areas:[]}});await saving;
    assert.equal(h.controller.state.map,replacement);
    assert.equal(h.controller.state.mapRow?.id,leave?undefined:20);
    assert.equal(h.controller.state.dirty,!leave);
    assert.equal(h.element('map-save-state').textContent,'');
  }
});

test('a second save waits for the first and persists edits made while the first was pending',async()=>{
  const h=harness(),requests=[];h.controller.state.dirty=true;
  h.api.post=(url,payload)=>new Promise(resolve=>requests.push({url,payload,resolve}));
  const first=h.controller.saveMap();
  h.controller.state.map.document.points.push({code:'new-edit'});
  const second=h.controller.saveMap();assert.equal(requests.length,1);
  requests[0].resolve({id:10,revision:2});await first;
  await Promise.resolve();assert.equal(requests.length,2);
  assert.equal(requests[1].payload.revision,2);
  assert.equal(requests[1].payload.document.points[0].code,'new-edit');
  requests[1].resolve({id:10,revision:3});await second;
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
