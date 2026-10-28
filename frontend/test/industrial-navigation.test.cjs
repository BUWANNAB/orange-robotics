const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const navSource=fs.readFileSync('frontend/src/modules/navigation/navigation.js','utf8');
function navigation(children=[]){
 let now=1000;const callbacks={};const window={frames:children},document={readyState:'loading',addEventListener:(name,fn)=>callbacks[name]=fn};window.top=window;
 vm.runInNewContext(navSource,{window,document,URLSearchParams,URL,Date:{now:()=>now},location:{search:'',origin:'http://localhost'},localStorage:{getItem:()=>null}});
 return {api:window.OrangeNavigation,window,advance:()=>now+=1100};
}
test('leave guards inspect nested editing frames before granting a single navigation approval',()=>{
 const child=navigation(),parent=navigation([child.window]);let calls=0,allow=false;
 child.api.registerLeaveGuard(()=>{calls++;return allow;});
 assert.equal(parent.api.canLeave(),false);assert.equal(parent.api.leaveApproved(),false);assert.equal(child.api.leaveApproved(),false);
 allow=true;assert.equal(parent.api.canLeave(),true);assert.equal(child.api.leaveApproved(),true);
 assert.equal(parent.api.canLeave(),true);assert.equal(calls,3,'each new navigation checks the current editing state');
 parent.advance();child.advance();assert.equal(parent.api.canLeave(),true);assert.equal(calls,4);
});
test('a pending operation blocks navigation and removed guards no longer participate',()=>{
 const n=navigation();const remove=n.api.registerLeaveGuard(()=>false);assert.equal(n.api.canLeave(),false);remove();assert.equal(n.api.canLeave(),true);
});
test('home/map links preserve hashes and replace stale map identifiers',()=>{
 const {withMap}=require('../src/modules/navigation/navigation.js');
 assert.equal(withMap('/ui/map-workbench.html?console=1&mapId=3#route',12),'/ui/map-workbench.html?console=1&mapId=12#route');
 assert.equal(withMap('/ui/index.html',12),'/ui/index.html?mapId=12');
 assert.equal(withMap('/ui/map-workbench.html#route','invalid'),'/ui/map-workbench.html#route');
});
const workbenchSource=fs.readFileSync('frontend/src/modules/maps/workbench.js','utf8');
function workbench(){
 const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='mapping-name'?'fixture':'0',type:'number',checked:false,hidden:false,disabled:false,textContent:'',setAttribute(){},removeAttribute(){},focus(){},classList:{toggle(){},add(){},remove(){}},getAttribute(){return this.src||''},contentWindow:{postMessage(){}}});return nodes.get(id);};
 const window={OpsAPI:{},OrangeNavigation:{registerLeaveGuard(){}},addEventListener(){},confirm:()=>false};
 const document={body:{classList:{add(){},remove(){},toggle(){}}},activeElement:null,getElementById:el};
 const prefix=workbenchSource.slice(0,workbenchSource.indexOf('function setBusy('));
 vm.runInNewContext(prefix+'window.test={pointDirty,canLeavePoint,openWorkflowDrawer,closeWorkflowDrawer,baseline(v){viewer=v;pointAsset="fixture";pointBaseline=pointSnapshot();}}',{window,document,URLSearchParams,location:{search:'',hash:'',origin:'http://localhost'},localStorage:{getItem:()=>null},Date,Map,JSON});
 return {window,el,controller:window.test};
}
test('unprocessed point-cloud selections require confirmation and undo restores a clean state',()=>{
 const h=workbench();let selection={erase:[],erase_brush:[]};h.controller.baseline({selection:()=>selection});assert.equal(h.controller.pointDirty(),false);
 selection={erase:[],erase_brush:[{radius:.2,points:[{x:1,y:2}]}]};assert.equal(h.controller.pointDirty(),true);assert.equal(h.controller.canLeavePoint(),false);
 selection={erase:[],erase_brush:[]};assert.equal(h.controller.pointDirty(),false);
});
test('cancelling an operation-panel switch leaves its URL, title and existing work intact',()=>{
 const h=workbench();h.el('workflow-frame').src='old-point-panel';h.el('workflow-frame').contentWindow.OrangeNavigation={canLeave:()=>false};h.el('workflow-title').textContent='裁切与坐标原点';
 assert.equal(h.controller.openWorkflowDrawer('build'),false);assert.equal(h.el('workflow-frame').src,'old-point-panel');assert.equal(h.el('workflow-title').textContent,'裁切与坐标原点');
 h.controller.closeWorkflowDrawer();assert.equal(h.el('workflow-frame').src,'old-point-panel');
});


test('return links follow the map actually selected in the workspace instead of its initial URL',()=>{
 const {contextMapId}=require('../src/modules/navigation/navigation.js');
 for(const path of ['/ui/index.html','/ui/map-workbench.html','/ui/operations.html'])assert.equal(contextMapId(path,'1','2'),'2');
 assert.equal(contextMapId('/ui/radar-settings.html','1','2'),'1','explicit configuration deep links keep their map context');
 assert.equal(contextMapId('/ui/index.html','1','bad'),'1');
});


test('beforeunload approval never bypasses a newly pending operation on the next navigation',()=>{
 const n=navigation();let pending=false,checks=0;n.api.registerLeaveGuard(()=>{checks++;return !pending;});
 assert.equal(n.api.canLeave(),true);pending=true;assert.equal(n.api.canLeave(),false);assert.equal(checks,2);
});
