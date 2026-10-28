(function(root){
  const shapes={
    home:'<path d="m3 10 9-7 9 7v10H6V10"/><path d="M10 20v-7h5v7"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    robot:'<rect x="5" y="7" width="14" height="13" rx="3"/><path d="M12 3v4M8 12h2m4 0h2M9 16h6"/>',
    tasks:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 9h6M9 13h6M9 17h4"/>',
    edit:'<path d="m5 15 11-11 4 4L9 19l-5 1 1-5ZM14 6l4 4M4 22h16"/>',
    lidar:'<circle cx="12" cy="12" r="3"/><path d="M5 5a10 10 0 0 1 14 0M3 2a14 14 0 0 1 18 0M5 19a10 10 0 0 0 14 0M3 22a14 14 0 0 0 18 0"/>',
    crop:'<path d="M6 3v15h15M3 6h15v15"/>',
    grid:'<path d="M4 4h16v16H4zM4 9h16M4 15h16M9 4v16M15 4v16"/>',
    point:'<path d="M18 9c0 5-6 11-6 11S6 14 6 9a6 6 0 1 1 12 0Z"/><circle cx="12" cy="9" r="2"/>',
    route:'<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18h3c6 0-2-12 4-12h3"/>',
    area:'<path d="m6 4 13 2 2 12-13 3-5-8 3-9Z"/>',
    locate:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
    layers:'<path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5"/>',
    undo:'<path d="m8 4-5 5 5 5M3 9h10a7 7 0 0 1 0 14"/>',
    redo:'<path d="m16 4 5 5-5 5m5-5H11a7 7 0 0 0 0 14"/>',
    save:'<path d="M4 3h14l3 3v15H3V3h1Zm3 0v6h10V3M7 21v-8h10v8"/>',
    check:'<path d="m4 12 5 5L20 6"/>',
    publish:'<path d="M4 15v6h16v-6M12 17V3m-5 5 5-5 5 5"/>',
    hand:'<path d="M8 12V5a2 2 0 0 1 4 0v7-9a2 2 0 0 1 4 0v9-6a2 2 0 0 1 4 0v10c0 4-3 6-7 6-4 0-5-3-8-7-2-3 0-5 3-3Z"/>',
    fit:'<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/><circle cx="12" cy="12" r="3"/>',
    plus:'<path d="M12 4v16M4 12h16"/>',minus:'<path d="M4 12h16"/>',
    more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    play:'<path d="m8 4 12 8-12 8V4Z"/>',pause:'<path d="M8 5v14M16 5v14"/>',stop:'<path d="m6 6 12 12M6 18 18 6"/>',
    ruler:'<path d="m3 16 13-13 5 5L8 21l-5-5Zm5-5 3 3m1-7 3 3"/>',
  };
  const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${shapes[name]||shapes.more}</svg>`;
  function render({row,maps,can,escape,taskModes,empty=false}){
    const button=(label,action,glyph,tone='blue',permission='',compact=true)=>{
      if(!permission&&['workbench-build','workbench-point','workbench-grid','map-asset','map-save','map-validate','map-remove','map-undo','map-redo','tool-point','tool-path','tool-curve','tool-area'].includes(action))permission='map:edit';
      if(!permission&&action==='tool-relocalize')permission='robot:control';
      if(permission&&!can(permission))return '';
      const disabled=action==='map-remove'||empty&&!['workbench-build','open-pgm-map','map-open-navigation','robot-model-open','map-open-operations'].includes(action);
      return `<button type="button" class="rcs-tool ${compact?'icon-only':''}" data-action="${action}" data-tone="${tone}" title="${label}" aria-label="${label}" ${disabled?'disabled':''}>${icon(glyph)}<span>${label}</span></button>`;
    };
    const choices=empty?'<option value="">请选择地图</option>':maps.map(map=>`<option value="${map.id}" ${String(map.id)===String(row.id)?'selected':''}>${escape(map.name)}${map.published_version?'':' · 未发布'}</option>`).join('');
    const layerNames=[['background','激光地图'],['paths','路线网络'],['stations','站点'],['areas','作业区域'],['coordinates','坐标网格'],['liveRoute','执行路线'],['liveTrail','实测轨迹'],['liveRobot','机器人模型']];
    const tool=(...args)=>button(...args);
    return `<div class="map-editor rcs-console docked-console ${empty?'rcs-console-empty':''}" id="map-editor">
      <header class="map-console-header">
        <div class="rcs-main-nav"><button type="button" class="map-menu-button" data-action="map-open-navigation" title="调度与其他功能" aria-label="打开功能导航">${icon('menu')}</button><div class="map-console-brand"><span class="map-brand-mark">O</span><strong>Orange <b>RCS</b></strong></div><button type="button" class="rcs-home-tab" data-action="map-home-view">${icon('home')}<span>主页</span></button><button type="button" class="rcs-nav-tab" data-action="map-open-operations">${icon('tasks')}<span>运行管理</span></button><a class="rcs-nav-tab" href="radar-settings.html" target="_blank" rel="noopener">${icon('robot')}<span>设备管理</span></a></div>
        ${taskModes}
        <div class="rcs-header-status"><label class="map-console-select rcs-header-map"><span>地图</span><select id="map-switch" ${empty?'disabled':''}>${choices}</select></label><span class="map-state-chip" id="map-ros-chip"><i></i>ROS 待连接</span><span class="map-state-chip" id="map-loc-chip"><i></i>定位待确认</span><button type="button" class="rcs-map-list" data-action="${empty?'open-pgm-map':'leave-map'}" title="选择地图">${icon('layers')}<span>地图</span></button></div>
      </header>
      <nav class="map-tools" aria-label="地图编辑工具"><div class="map-toolbar-row">

        ${tool('实时建图','workbench-build','lidar','teal','',false)}${tool('裁切 / 原点','workbench-point','crop','violet')}${tool('编辑二维地图','workbench-grid','grid','blue')}${tool('添加站点','tool-point','point','violet')}${tool('直线路径','tool-path','route','blue')}${tool('重新定位','tool-relocalize','locate','red')}

        <span class="map-tool-spacer"></span>${tool('保存草稿','map-save','save','blue')}${tool('验证路线','map-validate','check','teal')}${tool('发布到机器人','map-publish','publish','blue','map:publish')}

      </div></nav>
      <div class="map-workspace">
        <aside class="map-side-panel" aria-label="任务、地图工具与机器人">
          <section class="map-side-section map-edit-section"><header><strong>地图编辑</strong></header><div class="map-docked-tools">${tool('选择对象','tool-select','edit','blue','',false)}${tool('添加站点','tool-point','point','violet','',false)}${tool('直线路径','tool-path','route','blue','',false)}${tool('平滑曲线','tool-curve','route','violet','',false)}${tool('绘制作业区','tool-area','area','amber','',false)}<label class="map-toolbar-select">区域类型<select id="map-area-kind" ${empty?'disabled':''}><option value="forbidden">禁行区</option><option value="slow">减速区</option><option value="work">作业区</option><option value="charge">充电区</option></select></label>${tool('撤销','map-undo','undo','slate','',false)}${tool('重做','map-redo','redo','slate','',false)}</div></section><section class="map-side-section map-layers-section"><header><strong>地图图层</strong></header>${layerNames.map(([name,label])=>`<label class="map-layer-row"><input type="checkbox" data-map-layer="${name}" checked><span class="layer-color layer-${name}"></span>${label}</label>`).join('')}</section>

          <section class="map-side-section map-mission-plan-section"><header><strong>任务列表</strong><span>任务链</span>${button('创建任务链','map-mission-create','plus','blue','task:edit')}</header><div id="map-mission-plans" class="map-mission-plans"><p class="map-list-empty">${empty?'打开地图后配置任务链':'正在读取任务链…'}</p></div><div id="map-mission-runs" class="map-mission-runs"></div></section>
          <details open class="map-side-section map-task-list-section"><summary>单次任务 <span id="map-task-count">0</span></summary><header>${tool('创建单次任务','map-task-create','plus','blue','task:edit',false)}</header><div id="map-task-list" class="map-task-list"><p class="map-list-empty">暂无任务记录</p></div></details>
          <section class="map-side-section map-robot-section"><header><strong>车体状态</strong><span class="map-state-chip" id="map-robot-state"><i></i>离线</span></header><div id="map-robot-card" class="map-robot-card"></div></section>
          <details open class="map-side-section rcs-map-objects"><summary>站点与路线 <span id="map-point-count">0</span><span> / </span><span id="map-path-count">0</span></summary><label class="map-list-search"><span>⌕</span><input id="map-point-search" type="search" placeholder="搜索站点名称"></label><div id="map-point-list" class="map-object-list"></div><div id="map-path-list" class="map-object-list"></div></details>
        </aside>
        <section class="map-center-panel" aria-label="路线地图画布"><div class="map-canvas-head"><strong>${escape(row.name)}</strong><small id="map-save-state">${empty?'等待打开地图':`草稿 r${row.revision} · 已发布 v${row.published_version||0}`}</small><span id="map-tool-hint" role="status">${empty?'选择已有地图，或开始实时建图':'选择站点、路线或区域以编辑'}</span></div><div class="map-canvas-wrap"><canvas id="map-canvas" aria-label="地图、坐标原点、路线、站点和机器人位姿"></canvas>
          ${empty?`<div class="rcs-empty-map"><span>${icon('layers')}</span><h2>打开地图，开始工作</h2><p>地图、路线、站点与任务都在这里设置</p><div>${tool('从已有 PGM 创建路线地图','open-pgm-map','layers','blue','map:edit',false)}${tool('开始实时建图','workbench-build','lidar','teal','map:edit',false)}</div></div>`:''}
          </div><div class="map-view-toolbar"><div class="rcs-view-controls" aria-label="地图视图工具">${tool('平移','tool-pan','hand','slate')}${tool('适应窗口','map-fit','fit','slate')}${tool('放大地图','map-zoom-in','plus','slate')}<output id="map-zoom-level">100%</output>${tool('缩小地图','map-zoom-out','minus','slate')}</div><span id="map-measure-result" class="rcs-measure-readout"></span></div></section>
        <aside class="map-properties" aria-label="任务执行与对象属性"><section class="map-task-execution"><header><strong>任务执行</strong><span id="map-task-state">${empty?'未选择地图':'等待状态'}</span></header><div class="rcs-idle-task-actions">${tool('创建任务链','map-mission-create','plus','green','task:edit')}${tool('单次导航','map-task-create','play','blue','task:edit')}<button type="button" class="rcs-tool icon-only" data-tone="slate" disabled title="暂无可停止的任务" aria-label="暂无可停止的任务">${icon('stop')}</button></div><div class="rcs-task-repeat"><span>当前任务循环</span><output id="map-repeat-readout">未执行</output></div><div id="map-mission-execution" class="map-mission-execution" hidden></div><div id="map-task-active"><p class="rcs-task-empty">暂无执行中的任务</p></div><p class="rcs-execution-note">顶部模式仅用于新任务链，不切换底盘驾驶模式。选择任务链，确认后执行。</p></section>
          <section class="map-side-section map-extra-section"><header><strong>地图操作</strong></header><div class="map-docked-tools">${tool('选择已有 PGM','open-pgm-map','layers','teal','map:edit',false)}${tool('更换地图底图','map-asset','grid','blue','',false)}${tool('地图资源','map-open-resources','layers','blue','map:view',false)}${tool('车体模型','robot-model-open','robot','violet','map:view',false)}${tool('自动重定位','workbench-locate','locate','teal','',false)}${tool('测距','tool-measure','ruler','slate','',false)}</div></section>
          <details open class="rcs-inspector" id="map-object-inspector"><summary><strong>对象属性</strong></summary><div id="point-properties" class="map-object-properties">在地图上选择站点或路线</div><div class="rcs-inspector-actions">${tool('查看资源详情','map-open-resources','layers','blue','map:view',false)}${tool('删除选中对象','map-remove','stop','red','',false)}</div></details><div class="map-issues" id="map-issues" role="status"></div><details open class="rcs-document-info"><summary>地图版本</summary><div id="map-revision-card"><p id="map-revision-state">${empty?'尚未选择地图':`草稿 r${row.revision} · 已发布 v${row.published_version||0}`}</p><p>保存为草稿，验证通过后再发布。</p></div></details>
        </aside>
      </div><footer class="map-statusbar" aria-label="机器人运行状态"><span class="map-status-brand" id="map-ros-status"><i></i>ROS</span><span class="map-status-item" id="map-live-status">${empty?'尚未选择地图':'等待实时定位数据'}</span><span class="map-status-item" id="map-pose-readout">位姿：—</span><span class="map-status-item" id="map-nav-readout">任务：—</span><span class="map-status-item" id="map-plc-readout">PLC：未知</span><span class="map-status-item" id="map-lock-readout">软件停止锁：未知</span></footer></div>`;
  }
  function robotPortrait(){
    return `<div class="rcs-vehicle-stage"><svg viewBox="0 0 220 270" role="img" aria-label="车体示意模型"><defs><linearGradient id="rcs-body" x2="1" y2="1"><stop stop-color="#394b63"/><stop offset="1" stop-color="#172638"/></linearGradient></defs><path d="M65 25 15 265M155 25l50 240" fill="none" stroke="#cfe0fa" stroke-width="1.5"/><ellipse cx="110" cy="209" rx="62" ry="17" fill="#c9d5e5" opacity=".45"/><g stroke="#26374c" stroke-width="2"><rect x="55" y="100" width="17" height="38" rx="5" fill="#26374c"/><rect x="148" y="100" width="17" height="38" rx="5" fill="#26374c"/><rect x="55" y="166" width="17" height="38" rx="5" fill="#26374c"/><rect x="148" y="166" width="17" height="38" rx="5" fill="#26374c"/><rect x="65" y="79" width="90" height="133" rx="15" fill="url(#rcs-body)"/><path d="M68 101h84v17H68" fill="#ef8a3c" stroke="none"/><rect x="79" y="131" width="62" height="49" rx="5" fill="#425773"/><rect x="92" y="69" width="36" height="20" rx="7" fill="#415b7b"/><circle cx="110" cy="77" r="8" fill="#74b2f7" stroke="#e3efff"/><path d="M88 195h44" stroke="#7287a3" stroke-width="3"/></g><path d="M110 38V16m-7 8 7-8 7 8" fill="none" stroke="#1c79e8" stroke-width="2"/><text x="120" y="25" fill="#7891ad" font-size="10">X 前</text></svg><span>车体示意</span></div>`;
  }
  function connectionState(live){
    const connected=live.connected===true;
    const localizationValid=connected&&live.matched===true&&live.localization?.source==='ros'&&live.localization?.valid===true;
    return {connected,localizationValid};
  }
  const api={render,icon,robotPortrait,connectionState};
  if(typeof module==='object')module.exports=api;else root.RcsConsole=api;
})(typeof window==='undefined'?globalThis:window);
