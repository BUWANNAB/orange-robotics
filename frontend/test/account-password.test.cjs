const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('frontend/src/modules/navigation/navigation.js','utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function node(){return {children:[],value:'',textContent:'',hidden:false,disabled:false,attributes:{},listeners:{},append(...nodes){this.children.push(...nodes);},setAttribute(name,value){this.attributes[name]=value;},addEventListener(name,callback){this.listeners[name]=callback;},focus(){this.focused=true;}};}
function account(options={}){
  const fields=Object.fromEntries(['oldPassword','newPassword','checkPassword'].map(name=>[name,node()]));
  const close=node(),cancel=node(),submit=node(),error=node(),identity=node(),name=node(),form=node(),dialog=node(),bar=node();
  form.elements={namedItem:key=>fields[key]};form.querySelectorAll=()=>[...Object.values(fields),close,cancel,submit];form.reset=()=>{for(const field of Object.values(fields))field.value='';};
  dialog.querySelector=selector=>({'form':form,'[data-account-close]':close,'[data-account-cancel]':cancel,'[data-account-error]':error,'[data-account-identity]':identity})[selector];
  dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};
  const callbacks={},values=new Map(Object.entries({token:'fixture-token',tokenCreateTime:'1000',username:'user','robot.tempSkipLogin':'false',...options.storage})),writes=[],navigations=[];
  const storage={getItem:key=>values.get(key)||null,removeItem:key=>values.delete(key)};
  let outcome=options.outcome||{ok:true,body:{code:0,data:true}},resolveWrite;
  const fetch=async(url,request)=>{
    if(url==='/user/current')return {ok:!options.authFails,json:async()=>options.authFails?{detail:'未登录'}:{code:0,data:{username:'user',roles:['operator'],permissions:['map:edit']}}};
    writes.push({url,...request});
    if(options.networkFailure)throw Object.assign(new Error('Network failure'),{name:'TimeoutError'});
    if(options.pending)outcome=await new Promise(resolve=>{resolveWrite=resolve;});
    return {ok:outcome.ok,json:async()=>outcome.body};
  };
  const window={frames:[],addEventListener:(name,fn)=>{callbacks[name]=fn;}};window.top=window;
  const document={readyState:'loading',body:{append(){}},addEventListener(){},createElement:tag=>{if(tag==='dialog')return dialog;const button=node();button.querySelector=()=>name;return button;}};
  vm.runInNewContext(source,{window,document,fetch,URLSearchParams,URL,Date,JSON,location:{search:'',origin:'http://fixture',assign:url=>navigations.push(url)},localStorage:storage});
  const mounted=window.OrangeNavigation.mountAccount(bar);
  return {...mounted,fields,close,cancel,error,identity,name,values,writes,navigations,callbacks,api:window.OrangeNavigation,submit:()=>form.onsubmit({preventDefault(){}}),fill:()=>{fields.oldPassword.value='123';fields.newPassword.value=fields.checkPassword.value='456';},resolve:result=>resolveWrite(result),outcome:result=>{outcome=result;}};
}

test('the common account control displays the verified operator identity and stays hidden for anonymous visitors',async()=>{
  const h=account();await settle();assert.equal(h.button.hidden,false);assert.equal(h.name.textContent,'操作员 user');assert.match(h.identity.textContent,/user/);
  const anonymous=account({authFails:true});await settle();assert.equal(anonymous.button.hidden,true);
  const missing=account({storage:{token:''}});await settle();assert.equal(missing.button.hidden,true);
});

test('password mismatch, short passwords and unchanged passwords are rejected without submitting',async()=>{
  const h=account();await settle();h.button.onclick();h.fill();h.fields.checkPassword.value='789';await h.submit();assert.match(h.error.textContent,/不一致/);
  h.fields.newPassword.value=h.fields.checkPassword.value='12';await h.submit();assert.match(h.error.textContent,/至少 3 位/);
  h.fields.newPassword.value=h.fields.checkPassword.value='123';await h.submit();assert.match(h.error.textContent,/不能与当前密码相同/);
  assert.equal(h.writes.length,0);assert.equal(h.values.get('token'),'fixture-token');
});

test('unsaved workspace leave protection runs before sending a password change',async()=>{
  const h=account();await settle();h.button.onclick();h.fill();h.api.registerLeaveGuard(()=>false);await h.submit();assert.equal(h.writes.length,0);assert.equal(h.dialog.open,true);
});

test('pending password changes lock dismissal, duplicate submission and workspace navigation',async()=>{
  const h=account({pending:true});await settle();h.button.onclick();h.fill();const saving=h.submit();assert.equal(h.writes.length,1);
  assert.equal(h.api.canLeave(),false);assert.ok(h.form.querySelectorAll().every(field=>field.disabled));h.close.onclick();assert.equal(h.dialog.open,true);
  let cancelled=false;h.dialog.listeners.cancel({preventDefault(){cancelled=true;}});assert.equal(cancelled,true);assert.equal(h.dialog.open,true);
  await h.submit();assert.equal(h.writes.length,1);
  let prevented=false;h.callbacks.beforeunload({preventDefault(){prevented=true;}});assert.equal(prevented,true);
  h.resolve({ok:false,body:{detail:'当前密码错误'}});await saving;assert.equal(h.error.textContent,'当前密码错误');assert.equal(h.fields.newPassword.value,'456');assert.equal(h.api.canLeave(),true);assert.equal(h.navigations.length,0);
});

test('only a confirmed success clears credentials and redirects to login with the changed-password notice',async()=>{
  const h=account();await settle();h.button.onclick();h.fill();await h.submit();
  assert.equal(h.writes[0].url,'/user/change-password');assert.equal(h.writes[0].headers.Authorization,'fixture-token');assert.deepEqual(JSON.parse(h.writes[0].body),{oldPassword:'123',newPassword:'456',checkPassword:'456'});
  for(const key of ['token','tokenCreateTime','username','robot.tempSkipLogin'])assert.equal(h.values.has(key),false);
  assert.deepEqual(h.navigations,['/ui/login.html?passwordChanged=1']);assert.equal(h.dialog.open,false);assert.equal(h.fields.newPassword.value,'');
});

test('server failures preserve the session for a retry and auth changes hide the old account control',async()=>{
  const h=account({outcome:{ok:false,body:{detail:'当前密码错误'}}});await settle();h.button.onclick();h.fill();await h.submit();assert.equal(h.error.textContent,'当前密码错误');assert.equal(h.values.get('token'),'fixture-token');assert.equal(h.navigations.length,0);
  h.values.delete('token');await h.refresh();assert.equal(h.button.hidden,true);
});

test('a timed-out password request releases the pending lock and explains that the result needs verification',async()=>{
  const h=account({networkFailure:true});await settle();h.button.onclick();h.fill();await h.submit();
  assert.match(h.error.textContent,/密码可能已修改/);assert.match(h.error.textContent,/重新登录确认/);assert.equal(h.api.canLeave(),true);assert.equal(h.close.disabled,false);assert.equal(h.values.get('token'),'fixture-token');assert.equal(h.navigations.length,0);
});

test('legacy account registration now carries authentication rather than bypassing the token interceptor',()=>{
  const apiSource=fs.readFileSync('frontend/src/api/ApiManager.js','utf8').replace(/^import .*;?\r?\n/gm,'').replace('export default axiosClient;','');let intercept;
  const client={interceptors:{request:{use:fn=>{intercept=fn;}},response:{use(){}}}};
  vm.runInNewContext(apiSource,{axios:{create:()=>client},window:{location:{origin:'http://fixture'},parent:{postMessage(){}}},localStorage:{getItem:key=>({token:'admin-fixture',tokenCreateTime:String(Date.now())})[key]||null,removeItem(){}},Date,Promise,Error});
  assert.equal(intercept({url:'user/register',headers:{}}).headers.Authorization,'admin-fixture');assert.equal(intercept({url:'user/login',headers:{}}).headers.Authorization,undefined);
});
