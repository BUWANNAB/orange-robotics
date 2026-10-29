(function(root){
  const groups=[['workspace','现场工作'],['operations','调度与运营'],['resources','地图与模板'],['engineering','设备与维护']];
  function navigationGroups(items){
    return groups.map(([id,title])=>({id,title,items:items.filter(item=>item.visible&&item.group===id).sort((a,b)=>a.order-b.order)})).filter(group=>group.items.length);
  }
  function withMap(url,mapId){
    if(!/^\d+$/.test(String(mapId||''))||!/(?:map-resources|map-workbench|index)\.html(?:[?#]|$)/.test(url))return url;
    const [path,hash]=url.split('#'),[name,search='']=path.split('?');
    const params=new URLSearchParams(search);params.set('mapId',String(mapId));
    return name+'?'+params.toString()+(hash?'#'+hash:'');
  }
  function contextMapId(path,queryId,selectedId){
    const valid=value=>/^\d+$/.test(String(value||''))?String(value):null;
    return /\/(?:index|map-workbench|operations)\.html$/.test(path)
      ?valid(selectedId)||valid(queryId):valid(queryId)||valid(selectedId);
  }
  const exported={navigationGroups,withMap,contextMapId};
  if(typeof module!=='undefined'){module.exports=exported;return;}
  root.OrangeNavigation=exported;
  const params=new URLSearchParams(location.search),embedded=params.has('embedded')||params.get('drawer')==='1';
  const leaveGuards=new Set();let approvedUntil=0;
  function children(action){
    for(let index=0;index<window.frames.length;index++){
      try{const api=window.frames[index].OrangeNavigation;if(api&&action(api)===false)return false;}catch(error){if(error.name!=='SecurityError')throw error;}
    }
    return true;
  }
  exported.registerLeaveGuard=guard=>{leaveGuards.add(guard);return()=>leaveGuards.delete(guard);};
  exported.leaveApproved=()=>Date.now()<approvedUntil;
  exported._checkLeave=()=>{for(const guard of leaveGuards)if(guard()===false)return false;return children(api=>api._checkLeave?.());};
  exported._approveLeave=()=>{approvedUntil=Date.now()+1000;children(api=>api._approveLeave?.());};
  exported.canLeave=()=>{if(!exported._checkLeave())return false;exported._approveLeave();return true;};
  function mapId(){return contextMapId(location.pathname,params.get('mapId'),localStorage.getItem('orange.currentRouteMap'));}
  function homeUrl(){return withMap('/ui/map-workbench.html?console=1#route',mapId());}
  function shellTarget(){try{return window.top.document.querySelector('#app iframe[name="iframe"]')?'iframe':window===window.top?'_self':'_top';}catch(_){return '_self';}}
  function prepareHomeLinks(){document.querySelectorAll('a[data-map-home],a[href="map-workbench.html"]').forEach(link=>{link.href=homeUrl();link.target=shellTarget();link.textContent='← 返回地图主页';});}
  document.addEventListener('click',event=>{
    const link=event.target.closest('a[href]');if(!link||event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||link.download)return;
    if(link.id==='model-home'&&params.has('embedded'))return;
    if(link.hasAttribute('data-map-home')){link.href=homeUrl();link.target=shellTarget();}
    if(link.hasAttribute('data-app-page')){link.target=shellTarget();}
    if(link.target==='_blank')return;
    const url=new URL(link.href,location.href);if(url.origin!==location.origin)return;
    if(url.pathname===location.pathname&&url.search===location.search&&url.hash)return;
    const owner=(link.target==='_top'||link.target==='iframe')?window.top.OrangeNavigation:exported;
    if(owner?.canLeave?.()===false){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  let drawer,trigger;
  function setExpanded(expanded,remember=true){
    if(!drawer)return;
    drawer.hidden=!expanded;
    document.documentElement.classList.toggle('orange-navigation-collapsed',!expanded);
    trigger?.setAttribute('aria-expanded',String(expanded));
    trigger?.setAttribute('aria-label',expanded?'收起功能菜单':'展开功能菜单');
    if(remember)localStorage.setItem('orange.navigation.collapsed',String(!expanded));
    // The content uses the remaining layout space; nested maps resize through ResizeObserver.
    window.dispatchEvent(new Event('resize'));
  }
  function close(){setExpanded(false);trigger?.focus();}
  function syncCurrentPage(){
    if(!drawer)return;
    const frame=document.querySelector('#app iframe[name="iframe"]');let current=location;
    try{if(frame)current=frame.contentWindow.location;}catch(_){}
    for(const link of drawer.querySelectorAll('nav a')){const url=new URL(link.href);if(url.pathname===current.pathname&&(!url.hash||url.hash===current.hash))link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
  }
  function open(){
    if(window!==window.top&&window.top.OrangeNavigation?.open){window.top.OrangeNavigation.open();return;}
    syncCurrentPage();setExpanded(true);drawer?.querySelector('nav a')?.focus();
  }
  exported.open=open;
  exported.close=close;
  function mountAccount(bar){
    const button=document.createElement('button');button.type='button';button.className='orange-account-button';button.hidden=true;button.title='修改当前账号的登录密码';
    button.innerHTML='<span class="orange-account-name"></span><span>修改密码</span>';bar.append(button);
    const dialog=document.createElement('dialog');dialog.className='orange-account-dialog';dialog.setAttribute('aria-labelledby','orange-account-title');
    dialog.innerHTML='<form><header><h2 id="orange-account-title">修改密码</h2><button type="button" data-account-close aria-label="关闭修改密码">×</button></header><p data-account-identity></p><p class="orange-account-help">修改成功后需要重新登录。请先保存地图和路线的更改。</p><label>当前密码<input name="oldPassword" type="password" autocomplete="current-password" maxlength="128" required></label><label>新密码<input name="newPassword" type="password" autocomplete="new-password" minlength="3" maxlength="128" required placeholder="至少 3 位"></label><label>确认新密码<input name="checkPassword" type="password" autocomplete="new-password" minlength="3" maxlength="128" required></label><p class="orange-account-error" role="alert" aria-live="polite" data-account-error></p><footer><button type="button" data-account-cancel>取消</button><button type="submit" class="primary">确认修改并重新登录</button></footer></form>';
    document.body.append(dialog);
    const form=dialog.querySelector('form'),error=dialog.querySelector('[data-account-error]'),identity=dialog.querySelector('[data-account-identity]'),name=button.querySelector('.orange-account-name');
    const field=key=>form.elements.namedItem(key);let pending=false,account=null,observedToken=null;
    exported.registerLeaveGuard(()=>!pending);
    const close=()=>{if(pending)return;dialog.close();form.reset();error.textContent='';button.focus();};
    dialog.querySelector('[data-account-close]').onclick=close;dialog.querySelector('[data-account-cancel]').onclick=close;
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    root.addEventListener?.('beforeunload',event=>{if(pending){event.preventDefault();event.returnValue='';}});
    button.onclick=()=>{if(!account)return;form.reset();error.textContent='';dialog.showModal();field('oldPassword').focus();};
    function busy(value){pending=value;for(const input of form.querySelectorAll('input,button'))input.disabled=value;form.setAttribute('aria-busy',String(value));}
    async function refresh(){
      const token=localStorage.getItem('token');if(token===observedToken)return;observedToken=token;account=null;button.hidden=true;
      if(!token)return;
      try{
        const response=await fetch('/user/current',{headers:{Authorization:token}}),data=await response.json();
        if(!response.ok||data.code!==0||localStorage.getItem('token')!==token)return;
        account=data.data;const role=account.roles?.includes('admin')?'管理员':account.roles?.includes('operator')?'操作员':'用户';
        name.textContent=role+' '+account.username;identity.textContent='当前账号：'+account.username+'（'+role+'）';button.setAttribute('aria-label',identity.textContent+'，修改密码');button.hidden=false;
      }catch(_){observedToken=null;}
    }
    root.addEventListener?.('storage',refresh);root.addEventListener?.('orange:account-changed',refresh);root.addEventListener?.('focus',refresh);
    form.onsubmit=async event=>{
      event.preventDefault();if(pending)return;error.textContent='';
      const payload={oldPassword:field('oldPassword').value,newPassword:field('newPassword').value,checkPassword:field('checkPassword').value};
      if(!payload.oldPassword){error.textContent='请输入当前密码';field('oldPassword').focus();return;}
      if(payload.newPassword.length<3){error.textContent='新密码至少 3 位';field('newPassword').focus();return;}
      if(payload.newPassword!==payload.checkPassword){error.textContent='两次输入的新密码不一致';field('checkPassword').focus();return;}
      if(payload.newPassword===payload.oldPassword){error.textContent='新密码不能与当前密码相同';field('newPassword').focus();return;}
      if(exported.canLeave()===false)return;
      const token=localStorage.getItem('token');if(!token){error.textContent='登录已失效，请重新登录';return;}
      busy(true);
      try{
        const response=await fetch('/user/change-password',{method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:globalThis.AbortSignal?.timeout?.(15000)}),data=await response.json();
        if(!response.ok||data.code!==0)throw Error(Array.isArray(data.detail)?'请检查填写内容，密码长度为 3 至 128 位':data.detail||data.message||data.description||'修改失败，请重试');
        for(const key of ['token','tokenCreateTime','username','robot.tempSkipLogin'])localStorage.removeItem(key);
        busy(false);form.reset();dialog.close();exported._approveLeave();location.assign('/ui/login.html?passwordChanged=1');
      }catch(failure){error.textContent=['AbortError','TimeoutError','TypeError','SyntaxError'].includes(failure.name)?'未收到修改确认，密码可能已修改，请重新登录确认。':failure.message||'未收到修改结果，请检查连接后重试';busy(false);}
    };
    refresh();return {button,dialog,form,refresh};
  }
  exported.mountAccount=mountAccount;
  async function mount(){
    prepareHomeLinks();
    if(window!==window.top){document.documentElement.classList.add('orange-navigation-child');return;}
    if(embedded)return;
    exported.ownsBar=true;document.documentElement.classList.add('orange-navigation-host');
    const shell=document.getElementById('app'),bar=document.createElement('div');bar.className='orange-app-bar';bar.setAttribute('role','banner');
    trigger=document.createElement('button');trigger.type='button';trigger.className='orange-navigation-trigger';trigger.textContent='☰ 功能菜单';trigger.setAttribute('aria-label','收起功能菜单');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','orange-navigation');trigger.onclick=()=>drawer?.hidden?open():close();bar.append(trigger);
    const home=document.createElement('a');home.className='orange-home-link';home.dataset.mapHome='';home.href=homeUrl();home.target=shellTarget();home.textContent='← 返回地图主页';bar.append(home);
    const brand=document.createElement('span');brand.className='orange-app-brand';brand.innerHTML='Orange <b>Robotics</b>';bar.append(brand);
    const title=document.createElement('span');title.className='orange-page-label';title.textContent=document.title.split('·')[0].trim();bar.append(title);document.body.prepend(bar);mountAccount(bar);
    const frame=shell?.querySelector('iframe[name="iframe"]');
    if(frame)frame.addEventListener('load',()=>{try{title.textContent=frame.contentDocument.title.split('·')[0].trim();}catch(_){title.textContent='Orange Robotics';}syncCurrentPage();});
    drawer=document.createElement('aside');drawer.id='orange-navigation';drawer.className='orange-navigation';drawer.setAttribute('aria-label','功能菜单');
    const heading=document.createElement('header');heading.innerHTML='<div><strong>Orange <b>Robotics</b></strong><p>功能菜单</p></div><button type="button" aria-label="收起功能菜单">‹</button>';drawer.append(heading);heading.querySelector('button').onclick=close;
    const content=document.createElement('nav');content.setAttribute('aria-label','全站功能');drawer.append(content);bar.after(drawer);
    const saved=localStorage.getItem('orange.navigation.collapsed');
    setExpanded(params.get('navigation')==='open'||(saved!==null?saved!=='true':!matchMedia('(max-width:780px)').matches),false);
    try{
      const response=await fetch('/ui/src/config/sidebar.json?v=industrial-review-20261028-1');if(!response.ok)throw Error('读取失败');
      const config=await response.json();
      for(const group of navigationGroups(config.sidebar)){
        const section=document.createElement('section'),title=document.createElement('h2');title.textContent=group.title;section.append(title);
        for(const item of group.items){
          const link=document.createElement('a');link.textContent=item.title;link.href=withMap(item.url,mapId());link.target=shell?'iframe':'_top';
          link.addEventListener('click',()=>{link.href=withMap(item.url,mapId());drawer.querySelectorAll('a').forEach(item=>item.removeAttribute('aria-current'));link.setAttribute('aria-current','page');});
          if(new URL(link.href).pathname===location.pathname&&(!new URL(link.href).hash||new URL(link.href).hash===location.hash))link.setAttribute('aria-current','page');section.append(link);
        }content.append(section);
      }
      syncCurrentPage();
      if(params.get('navigation')==='open')open();
    }catch(error){const message=document.createElement('p');message.textContent='功能菜单读取失败，请刷新页面。';content.append(message);const home=document.createElement('a');home.href=homeUrl();home.dataset.mapHome='';home.target='_top';home.textContent='返回地图主页';content.append(home);}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})(typeof window!=='undefined'?window:globalThis);
