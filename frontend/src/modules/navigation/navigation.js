(function(root){
  const groups=[['workspace','现场工作'],['operations','调度与运营'],['resources','地图与模板'],['engineering','设备与维护']];
  function navigationGroups(items){
    return groups.map(([id,title])=>({id,title,items:items.filter(item=>item.visible&&item.group===id).sort((a,b)=>a.order-b.order)})).filter(group=>group.items.length);
  }
  function withMap(url,mapId){
    if(!/^\d+$/.test(String(mapId||''))||!url.includes('map-resources.html'))return url;
    const [path,hash]=url.split('#');return path+(path.includes('?')?'&':'?')+'mapId='+encodeURIComponent(mapId)+(hash?'#'+hash:'');
  }
  const exported={navigationGroups,withMap};
  if(typeof module!=='undefined'){module.exports=exported;return;}
  root.OrangeNavigation=exported;
  const params=new URLSearchParams(location.search),embedded=params.has('embedded')||params.get('drawer')==='1';
  let drawer,trigger,lastFocus;
  function close(){if(drawer?.open)drawer.close();trigger?.setAttribute('aria-expanded','false');lastFocus?.focus();}
  function open(){
    if(window!==window.top&&window.top.OrangeNavigation?.open){window.top.OrangeNavigation.open();return;}
    if(drawer&&!drawer.open){
      const frame=document.querySelector('#app iframe[name="iframe"]');let current=location;
      try{if(frame)current=frame.contentWindow.location;}catch(_){}
      for(const link of drawer.querySelectorAll('nav a')){const url=new URL(link.href);if(url.pathname===current.pathname&&(!url.hash||url.hash===current.hash))link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
      lastFocus=document.activeElement;drawer.showModal();trigger?.setAttribute('aria-expanded','true');
    }
  }
  exported.open=open;
  async function mount(){
    if(window!==window.top){document.documentElement.classList.add('orange-navigation-child');return;}
    if(embedded)return;
    exported.ownsBar=true;document.documentElement.classList.add('orange-navigation-host');
    const shell=document.getElementById('app'),bar=document.createElement('div');bar.className='orange-app-bar';bar.setAttribute('role','banner');
    trigger=document.createElement('button');trigger.type='button';trigger.className='orange-navigation-trigger';trigger.textContent='☰ 功能菜单';trigger.setAttribute('aria-label','打开全站功能菜单');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','orange-navigation');trigger.onclick=open;bar.append(trigger);
    const brand=document.createElement('span');brand.className='orange-app-brand';brand.innerHTML='Orange <b>Robotics</b>';bar.append(brand);
    const title=document.createElement('span');title.className='orange-page-label';title.textContent=document.title.split('·')[0].trim();bar.append(title);document.body.prepend(bar);
    const frame=shell?.querySelector('iframe[name="iframe"]');
    if(frame)frame.addEventListener('load',()=>{try{title.textContent=frame.contentDocument.title.split('·')[0].trim();}catch(_){title.textContent='Orange Robotics';}});
    drawer=document.createElement('dialog');drawer.id='orange-navigation';drawer.className='orange-navigation';
    const heading=document.createElement('header');heading.innerHTML='<div><strong>Orange <b>Robotics</b></strong><p>功能菜单</p></div><button type="button" aria-label="关闭功能菜单">×</button>';drawer.append(heading);heading.querySelector('button').onclick=close;
    const content=document.createElement('nav');content.setAttribute('aria-label','全站功能');drawer.append(content);document.body.append(drawer);
    drawer.addEventListener('close',()=>{trigger.setAttribute('aria-expanded','false');lastFocus?.focus();});
    drawer.addEventListener('click',event=>{const rect=drawer.getBoundingClientRect();if(event.clientX>rect.right||event.clientY>rect.bottom||event.clientX<rect.left||event.clientY<rect.top)close();});
    try{
      const response=await fetch('/ui/src/config/sidebar.json?v=fixed-navigation-20261028-1');if(!response.ok)throw Error('读取失败');
      const config=await response.json();
      for(const group of navigationGroups(config.sidebar)){
        const section=document.createElement('section'),title=document.createElement('h2');title.textContent=group.title;section.append(title);
        for(const item of group.items){
          const link=document.createElement('a');link.textContent=item.title;link.href=withMap(item.url,localStorage.getItem('orange.currentRouteMap'));link.target=shell?'iframe':'_top';
          link.addEventListener('click',()=>{link.href=withMap(item.url,localStorage.getItem('orange.currentRouteMap'));if(shell)close();});
          if(new URL(link.href).pathname===location.pathname&&(!new URL(link.href).hash||new URL(link.href).hash===location.hash))link.setAttribute('aria-current','page');section.append(link);
        }content.append(section);
      }
      if(params.get('navigation')==='open')open();
    }catch(error){const message=document.createElement('p');message.textContent='功能菜单读取失败，请刷新页面。';content.append(message);const home=document.createElement('a');home.href='/ui/index.html';home.target='_top';home.textContent='返回地图主页';content.append(home);}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})(typeof window!=='undefined'?window:globalThis);
