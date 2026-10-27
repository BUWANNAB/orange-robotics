const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Run the actual console functions without starting its network/DOM boot loop.
const source = fs.readFileSync('frontend/src/modules/operations/operations.js', 'utf8');
const functions = source.slice(0, source.indexOf("  $('nav').onclick=")) +
  'window.consoleTest={state,missionDesigner,refreshMapMissions,refreshMapTasks,renderMapMissions};})();';
const mapDocument = {points:[{code:'A'},{code:'C'}],paths:[{start:'A',end:'C',bidirectional:true}]};
const plan = {id:1,name:'巡回任务',map_id:10,start_point:'A',steps:[
  {node_id:'one',action:'navigate',point:'C',delay_seconds:0},
  {node_id:'two',action:'navigate',point:'A',delay_seconds:0}
],repeat_count:2,priority:5,robot_id:null};

function harness(publishedDocument=mapDocument) {
  const elements = new Map(), calls = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, {id,innerHTML:'',textContent:'',dataset:{},value:'',checked:false,
      classList:{contains:()=>false,toggle(){},add(){},remove(){}},querySelectorAll:()=>[],rows:[]});
    return elements.get(id);
  };
  const form = element('dialog-form');
  form.elements = {repeat_count:{value:'2'}};
  form.values = new Map(Object.entries({name:plan.name,start_point:'A',repeat_count:'2',priority:'5',robot_id:'',execute_confirmation:plan.name}));
  const start = {value:'A'};
  const flow = element('mission-flow');
  flow.rows = plan.steps.map(step => ({querySelector:selector => ({value:selector.includes('point')?step.point:step.delay_seconds})}));
  flow.querySelectorAll = () => flow.rows;
  element('dialog').showModal = () => {element('dialog').open=true;};
  element('dialog').close = () => {element('dialog').open=false;};
  const document = {getElementById:element,querySelector:()=>start,querySelectorAll:()=>flow.rows,
    documentElement:{classList:{contains:()=>false}}};
  const api = {
    get:async (url,params) => {
      calls.push({method:'get',url,params});
      if(url.endsWith('/versions')) return [{version:1,document:publishedDocument}];
      if(url==='/api/task-mode') return {mode:'manual'};
      if(url==='/api/task-history') return {list:[],total:0};
      return [];
    },
    post:async (url,payload) => {calls.push({method:'post',url,payload});return {...payload,id:1,status:'waiting_manual'};},
    put:async (url,payload) => {calls.push({method:'put',url,payload});return {...payload,id:1};}
  };
  const window = {OpsAPI:api};
  class FormData {constructor(form){this.values=form.values;}get(key){return this.values.get(key)??null;}}
  vm.runInNewContext(functions,{window,document,location:{search:'',origin:'http://localhost'},URLSearchParams,FormData,Set,Map,Date,Math});
  const controller=window.consoleTest;
  Object.assign(controller.state,{map:{},mapRow:{id:10,published_version:1},robots:[],permissions:['*']});
  return {controller,element,calls,api,form,flow};
}

test('published task-chain designer opens and renders editable steps',async()=>{
  const h=harness();
  await h.controller.missionDesigner(plan);
  assert.equal(h.element('dialog').open,true);
  assert.match(h.flow.innerHTML,/data-node-point="0"/);
  assert.match(h.element('mission-loop-hint').textContent,/闭环/);
  const before=h.flow.innerHTML;
  h.element('mission-add-action').onclick();
  assert.notEqual(h.flow.innerHTML,before,'clicking the action card must add a step');
});

test('saving an infinite template never starts a device run',async()=>{
  const h=harness();await h.controller.missionDesigner(plan);
  h.element('mission-repeat-infinite').checked=true;
  await h.element('mission-save-only').onclick();
  const saves=h.calls.filter(call=>call.method==='put');
  assert.equal(saves.length,1);
  assert.equal(saves[0].payload.repeat_count,-1);
  assert.equal(h.calls.some(call=>call.method==='post'&&call.url.endsWith('/runs')),false);
});

test('execution requires the typed name and carries the mode shown when opened',async()=>{
  const h=harness();h.controller.state.taskMode='auto';await h.controller.missionDesigner(plan);
  h.form.values.set('execute_confirmation','wrong');
  await h.form.onsubmit({preventDefault(){},target:h.form});
  assert.match(h.element('dialog-error').textContent,/确认名称/);
  assert.equal(h.calls.some(call=>call.method==='put'),false);
  h.form.values.set('execute_confirmation',plan.name);
  h.controller.state.taskMode='schedule'; // Another operator/poll changed the setting.
  await h.form.onsubmit({preventDefault(){},target:h.form});
  const run=h.calls.find(call=>call.method==='post'&&call.url.endsWith('/runs'));
  assert.ok(run,'mode changes must not silently change the open form');
  assert.equal(run.payload.task_mode,'auto');
});

test('task history requests are scoped to the visible map',async()=>{
  const h=harness();await h.controller.refreshMapTasks();
  assert.equal(h.calls.find(call=>call.url==='/api/task-history').params.map_id,10);
  assert.equal(h.calls.find(call=>call.url==='/api/task-history').params.exclude_missions,true);
});

test('late mission responses cannot overwrite a newly selected map',async()=>{
  const h=harness();let resolve;
  h.api.get=async url=>url==='/api/task-plans'?await new Promise(done=>{resolve=done;}):url==='/api/task-mode'?{mode:'manual'}:[];
  const pending=h.controller.refreshMapMissions();
  h.controller.state.mapRow={id:20};
  resolve([plan]);await pending;
  assert.equal(h.controller.state.mapMissionPlans.length,0);
});

test('destinations include stations reachable through intermediate routes',async()=>{
  const h=harness({points:[{code:'A'},{code:'B'},{code:'C'}],paths:[
    {start:'A',end:'B',bidirectional:true},{start:'B',end:'C',bidirectional:true}]});
  await h.controller.missionDesigner(plan);
  assert.match(h.flow.innerHTML,/<option value="C" selected>/);
});

test('paused missions expose resume and cancel, and in-flight pause retains stop',()=>{
  const h=harness();
  const run={id:1,name:plan.name,status:'paused',steps:plan.steps,start_point:'A',cycles_completed:0,repeat_count:2,step_index:1,task_mode:'auto'};
  h.controller.state.mapMissionRuns=[run];h.controller.renderMapMissions();
  assert.match(h.element('map-mission-runs').innerHTML,/data-action="mission-resume"/);
  assert.equal(h.element('map-task-active').hidden,true);
  assert.equal(h.element('map-mission-execution').hidden,false);
  assert.match(h.element('map-mission-execution').innerHTML,/data-action="mission-resume"/);
  assert.match(h.element('map-mission-runs').innerHTML,/data-action="mission-cancel"/);
  Object.assign(run,{status:'pausing',active_task_id:11,active_task:{status:'running',from_point:'A',to_point:'C'}});
  h.controller.renderMapMissions();
  assert.match(h.element('map-mission-runs').innerHTML,/本段到站后暂停/);
  assert.match(h.element('map-mission-runs').innerHTML,/data-action="mission-stop-step"/);
  assert.doesNotMatch(h.element('map-mission-runs').innerHTML,/data-action="mission-resume"/);
});
