const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function element(){return {textContent:'',disabled:false,hidden:false,value:'',checked:false,dataset:{},children:[],listeners:{},classList:{toggle(){},add(){}},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},addEventListener(name,callback){this.listeners[name]=callback;},showModal(){this.open=true;},close(){this.open=false;}};}
function dom(){const nodes=new Map();return {get:id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},document:{createElement:element,hidden:false}};}
function flatten(node){return [node,...node.children.flatMap(flatten)];}
function maintenance(){
 const {get,document}=dom();document.getElementById=get;
 let offline=false;const writes=[];
 const status={control_enabled:true,busy:false,plc_start_ready:true,checks:[{name:'ROS 桥接',ready:true},{name:'底盘反馈',ready:true}],services:[{id:'localization',name:'定位',load:'loaded',state:'inactive',description:'fixture',unit:'fixture.service',detail:'waiting',observed_nodes:[],actions:['start','restart'],start_allowed:true}],nodes:['fixture_node']};
 const api={get:async()=>{if(offline)throw Error('状态读取中断');return status;},post:async(url,payload)=>{writes.push({url,payload});return {id:'fixture-job',status:'success',message:'fixture receipt'};}};
 vm.runInNewContext(fs.readFileSync('frontend/src/modules/maps/ros-maintenance.js','utf8'),{window:{OpsAPI:api},document,localStorage:{getItem(){return null;},setItem(){},removeItem(){}},setInterval(){},setTimeout,Date});
 return {get,writes,offline:value=>{offline=value;},buttons:()=>flatten(get('services')).filter(node=>node.textContent==='启动'||node.textContent==='重启')};
}
test('maintenance loses readiness on status failure, while retaining the independent stop request',async()=>{
 const h=maintenance();await settle();assert.equal(h.get('plc-start').disabled,false);
 h.buttons()[0].onclick();h.offline(true);h.get('check').onclick();await settle();
 assert.equal(h.get('plc-start').disabled,true);assert.ok(h.buttons().every(button=>button.disabled));assert.equal(h.get('plc-stop').disabled,false);
 assert.match(h.get('environment').textContent,/过期/);assert.match(h.get('nodes').textContent,/过期/);assert.ok(flatten(h.get('services')).some(node=>node.textContent==='状态已过期'));
 await h.get('action-form').onsubmit({preventDefault(){}});assert.equal(h.writes.length,0,'an already-open old confirmation cannot submit a maintenance action');
 h.get('plc-stop').onclick();await h.get('action-form').onsubmit({preventDefault(){}});
 assert.equal(h.writes[0].url,'/api/ros-runtime/plc/stop-request');
});
test('a successful maintenance retry restores readiness and clears the stale-state warning',async()=>{
 const h=maintenance();await settle();h.offline(true);h.get('check').onclick();await settle();
 h.offline(false);h.get('check').onclick();await settle();
 assert.equal(h.get('plc-start').disabled,false);assert.ok(h.buttons().every(button=>!button.disabled));assert.match(h.get('notice').textContent,/已恢复/);
});
function model(options={}){
 const {get,document}=dom();document.getElementById=get;
 const body={length:1.2,width:.8,height:.5,center_x:0,center_y:0,center_z:.25};
 const fields=Object.fromEntries(Object.keys(body).concat('confirmation').map(name=>{let value='';return [name,{get value(){return value;},set value(next){value=String(next);},name,type:name==='confirmation'?'text':'number',disabled:false,checkValidity:()=>true}];}));
 const form=get('model-form');form.elements={namedItem:name=>fields[name]};form.querySelectorAll=()=>Object.values(fields).concat(get('dimensions-confirmed'));
 const events={},guards=[],writes=[],confirmCalls=[];let readFails=!!options.readFails,permissionFails=!!options.permissionFails,approved=false,answer=false;
 const snapshot=model=>({model:model||{base_frame:'base_link',dimensions_confirmed:false,body:{...body}},mount:null,tf_notes:[],shared_with_ros:false});
 const api={get:async url=>{if(url==='/api/robot-model'){if(readFails)throw Error('模型离线');return snapshot();}if(permissionFails)throw Error('权限离线');return {permissions:options.readOnly?['map:view']:['*']};},put:async(url,payload)=>{writes.push({url,payload});if(options.saveFails)throw Error('保存失败');return snapshot(payload.model);}};
 const window={OpsAPI:api,confirm:message=>{confirmCalls.push(message);return answer;},addEventListener:(name,callback)=>{events[name]=callback;},postMessage(){},OrangeNavigation:{registerLeaveGuard:guard=>{guards.push(guard);return ()=>{};},leaveApproved:()=>approved}};
 const source=fs.readFileSync('frontend/src/modules/robot-model/model.js','utf8').replace(/^import .*;\r?\n/gm,'');
 vm.runInNewContext(source,{window,parent:window,document,location:{origin:'http://fixture',search:''},URLSearchParams,structuredClone,THREE:{WebGLRenderer:function(){throw Error('No GPU in fixture');}}});
 return {get,fields,form,events,guards,writes,confirmCalls,answer:value=>{answer=value;},approved:value=>{approved=value;},readFails:value=>{readFails=value;},permissionFails:value=>{permissionFails=value;},edit:(name,value)=>{fields[name].value=String(value);form.listeners.input({target:fields[name]});}};
}
test('model and permission read failures disable writes and can recover through the retry button',async()=>{
 for(const failure of ['readFails','permissionFails']){
  const h=model({[failure]:true});await settle();
  assert.equal(h.get('save-model').disabled,true);assert.equal(h.get('reset-model').disabled,true);assert.equal(h.get('export-urdf').disabled,true);assert.equal(h.get('retry-model').hidden,false);
  h.fields.confirmation.value='保存车体模型';await h.form.onsubmit({preventDefault(){}});assert.equal(h.writes.length,0);
  h[failure](false);await h.get('retry-model').onclick();
  assert.equal(h.get('save-model').disabled,false);assert.equal(h.get('retry-model').hidden,true);
 }
});
test('read-only model permissions cannot be bypassed by submitting its form directly',async()=>{
 const h=model({readOnly:true});await settle();h.fields.confirmation.value='保存车体模型';await h.form.onsubmit({preventDefault(){}});
 assert.equal(h.writes.length,0);assert.equal(h.get('save-model').disabled,true);
});
test('unsaved model edits guard navigation and unload, while saved-state restore clears the guard',async()=>{
 const h=model();await settle();assert.equal(h.guards[0](),true);
 h.edit('length',2);assert.equal(h.guards[0](),false);assert.match(h.confirmCalls[0],/尚未保存/);
 const event={prevented:false,preventDefault(){this.prevented=true;}};h.events.beforeunload(event);assert.equal(event.prevented,true);
 h.approved(true);const approved={prevented:false,preventDefault(){this.prevented=true;}};h.events.beforeunload(approved);assert.equal(approved.prevented,false,'an accepted shared leave dialog must not produce a second browser prompt');
 h.get('reset-model').onclick();assert.equal(h.guards[0](),true);assert.equal(h.fields.length.value,'1.2');
});
test('failed model saves retain edits and leave protection; successful saves clear it',async()=>{
 const failed=model({saveFails:true});await settle();failed.edit('length',2);failed.fields.confirmation.value='保存车体模型';await failed.form.onsubmit({preventDefault(){}});
 assert.equal(failed.writes.length,1);assert.equal(failed.guards[0](),false);assert.equal(failed.get('save-model').disabled,false);
 const saved=model();await settle();saved.edit('length',2);saved.fields.confirmation.value='保存车体模型';await saved.form.onsubmit({preventDefault(){}});
 assert.equal(saved.writes.length,1);assert.equal(saved.guards[0](),true);assert.equal(saved.get('save-model').disabled,false);
});
