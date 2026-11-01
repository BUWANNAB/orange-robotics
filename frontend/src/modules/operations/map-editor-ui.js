(function(root){
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const toDegrees=radians=>Number(radians||0)*180/Math.PI;
  const toRadians=degrees=>Number(degrees)*Math.PI/180;
  function pointMarkup(point,{moving=false,canEdit=true}={}){
    if(!point)return '<p class="help">选择站点查看属性；点位位置默认锁定。</p>';
    const input=(name,label,value,type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;
    const locked=moving?'':'readonly',disabled=canEdit?'':'disabled';
    return `<p class="inspector-title">站点 ${escape(point.code)}</p><p class="map-position-state ${moving?'editing':''}">${moving?'正在调整位置 · 应用后保存':'位置已锁定 · 点击只选中'}</p>${input('point-code','站点编号',point.code,'text',`maxlength="80" ${disabled}`)}${input('point-name','站点名称',point.name||'','text',`maxlength="128" ${disabled}`)}<label>站点用途<select name="point-type" ${disabled}>${[['station','普通站点'],['charger','充电点'],['shelf','货架点'],['waiting','等候点'],['elevator','电梯点']].map(([value,label])=>`<option value="${value}" ${value===point.type?'selected':''}>${label}</option>`).join('')}</select></label><div class="map-coordinate-fields">${input('point-x','X（米）',Number(point.x).toFixed(3),'number',`step="0.01" ${locked} ${disabled}`)}${input('point-y','Y（米）',Number(point.y).toFixed(3),'number',`step="0.01" ${locked} ${disabled}`)}</div>${input('point-heading','朝向（°）',Number(toDegrees(point.theta).toFixed(3)),'number',`step="1" ${locked} ${disabled}`)}<p class="help">0° 沿地图 +X，90° 沿 +Y。坐标输入精度与车辆实际定位精度分别确认。</p>${canEdit?`<div class="map-point-edit-actions">${moving?'<button class="primary" data-action="map-point-apply">应用位置</button><button data-action="map-point-move-cancel">撤销调整</button>':'<button data-action="map-point-move">调整位置 / 朝向</button><button class="primary" data-action="map-point-apply">应用属性</button>'}</div>`:''}`;
  }
  function pointValues(box){
    const value=name=>box.querySelector(`[name="${name}"]`).value;
    const x=Number(value('point-x')),y=Number(value('point-y')),heading=Number(value('point-heading'));
    if(['point-x','point-y','point-heading'].some(name=>!value(name).trim())||![x,y,heading].every(Number.isFinite))throw new Error('坐标和朝向必须填写有效数字');
    return {code:value('point-code').trim(),name:value('point-name').trim(),type:value('point-type'),x,y,theta:toRadians(heading)};
  }
  function issuesMarkup(issues){
    if(!issues.length)return '<p class="map-validation-good">✓ 校验通过</p>';
    return `<p class="map-validation-summary">发现 ${issues.length} 处问题，点击定位</p><div class="map-validation-list">${issues.map((issue,index)=>`<button type="button" data-action="map-issue-focus" data-id="${index}"><strong>${escape(issue.element||'地图')}</strong><span>${escape(issue.message)}</span></button>`).join('')}</div>`;
  }
  function recoveryView(live,mapId){
    const recovery=live?.recovery||{},same=Number(recovery.map_id)===Number(mapId),valid=live?.matched&&live?.connected&&live?.localization?.valid;
    if(valid)return {label:'定位正常',message:'已接续实时定位，无需重复重定位。',tone:'good',busy:false,cancel:false,activate:false,manual:false};
    const status=same?recovery.status:'idle',busy=['waiting','loading','searching'].includes(status);
    const labels={waiting:'等待定位条件',loading:'验证上次位置',searching:'自动寻找位置',ready:'等待实时定位',manual_required:'需要辅助定位',cancelled:'自动定位已取消'};
    return {label:labels[status]||'定位待准备',message:same&&recovery.message?recovery.message:live?.connected?'将此地图设为作业地图后，系统会自动寻找并验证车位。':'等待 ROS 连接；现有实时定位会自动接续。',tone:status==='manual_required'?'bad':'warn',busy,cancel:busy,activate:!busy,manual:status==='manual_required'||status==='cancelled'};
  }
  const api={escape,toDegrees,toRadians,pointMarkup,pointValues,issuesMarkup,recoveryView};
  if(typeof module==='object')module.exports=api;else root.MapEditorUI=api;
})(typeof window==='undefined'?globalThis:window);
