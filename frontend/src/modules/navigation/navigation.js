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
    const shell=document.getElementById('mapNavToggle');
    if(shell){if(shell.getAttribute('aria-expanded')!=='true')shell.click();return;}
    if(drawer&&!drawer.open){lastFocus=document.activeElement;drawer.showModal();trigger?.setAttribute('aria-expanded','true');}
  }
  exported.open=open;
  async function mount(){
    if(document.getElementById('app')||embedded)return;
    const target=document.querySelector('.header-tools,.header-actions,.radar-page-nav,.masthead-links,.masthead .links,.page-heading');
    if(!target)return;
    trigger=document.createElement('button');trigger.type='button';trigger.className='orange-navigation-trigger';trigger.textContent='☰ 功能菜单';trigger.setAttribute('aria-label','打开全站功能菜单');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','orange-navigation');trigger.onclick=open;target.prepend(trigger);
    drawer=document.createElement('dialog');drawer.id='orange-navigation';drawer.className='orange-navigation';
    const heading=document.createElement('header');heading.innerHTML='<div><strong>Orange <b>Robotics</b></strong><p>功能菜单</p></div><button type="button" aria-label="关闭功能菜单">×</button>';drawer.append(heading);heading.querySelector('button').onclick=close;
    const content=document.createElement('nav');content.setAttribute('aria-label','全站功能');drawer.append(content);document.body.append(drawer);
    drawer.addEventListener('close',()=>{trigger.setAttribute('aria-expanded','false');lastFocus?.focus();});
    drawer.addEventListener('click',event=>{const rect=drawer.getBoundingClientRect();if(event.clientX>rect.right||event.clientY>rect.bottom||event.clientX<rect.left||event.clientY<rect.top)close();});
    try{
      const response=await fetch('/ui/src/config/sidebar.json?v=rds-navigation-20261028-1');if(!response.ok)throw Error('读取失败');
      const config=await response.json();
      for(const group of navigationGroups(config.sidebar)){
        const section=document.createElement('section'),title=document.createElement('h2');title.textContent=group.title;section.append(title);
        for(const item of group.items){
          const link=document.createElement('a');link.textContent=item.title;link.href=withMap(item.url,localStorage.getItem('orange.currentRouteMap'));link.target='_top';
          link.addEventListener('click',()=>{link.href=withMap(item.url,localStorage.getItem('orange.currentRouteMap'));});
          if(new URL(link.href).pathname===location.pathname&&(!new URL(link.href).hash||new URL(link.href).hash===location.hash))link.setAttribute('aria-current','page');section.append(link);
        }content.append(section);
      }
    }catch(error){const message=document.createElement('p');message.textContent='功能菜单读取失败，请刷新页面。';content.append(message);const home=document.createElement('a');home.href='/ui/index.html';home.target='_top';home.textContent='返回地图主页';content.append(home);}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})(typeof window!=='undefined'?window:globalThis);
