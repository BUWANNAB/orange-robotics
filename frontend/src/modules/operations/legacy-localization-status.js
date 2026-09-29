(function () {
  const link=document.createElement('a');link.href='/ui/localization.html';
  link.style.cssText='position:fixed;bottom:12px;left:16px;z-index:2000;padding:8px 12px;border-radius:7px;background:#fff3ce;color:#614512;font:13px sans-serif;box-shadow:0 2px 8px #0002';
  link.setAttribute('role','status');document.body.appendChild(link);
  function refresh(){
    let pose;try{pose=JSON.parse(localStorage.getItem('positionData')||'null');}catch(_){pose=null;}
    const loc=pose?.localization, fresh=pose&&Date.now()-pose.timestamp<2000&&loc?.fresh;
    link.textContent=!fresh?'定位无数据 / 已过期 · 查看定位':loc.source==='simulation'?'仿真定位 · 查看详情':loc.valid?'实时定位有效 · 地图热切换':'定位质量未通过 · 查看详情';
    link.style.background=fresh&&loc.valid&&loc.source==='ros'?'#dcf5e8':'#fff3ce';
  }
  refresh();const timer=setInterval(refresh,500);window.addEventListener('pagehide',()=>clearInterval(timer));
})();
