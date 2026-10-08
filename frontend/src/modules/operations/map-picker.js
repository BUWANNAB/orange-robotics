(function () {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function render(maps, canEdit, selectedId = '') {
    const available = Array.isArray(maps) ? maps : [];
    const options = available.map(map => {
      const status = map.published_version ? `已发布 v${escape(map.published_version)}` : '尚未发布';
      return `<option value="${escape(map.id)}" ${String(map.id) === String(selectedId) ? 'selected' : ''}>${escape(map.name)} · 草稿 r${escape(map.revision)} · ${status}</option>`;
    }).join('');
    const select = `<label for="existing-map-picker">选择已有地图</label><select id="existing-map-picker" aria-describedby="existing-map-help" ${available.length ? '' : 'disabled'}><option value="">${available.length ? '请选择地图' : '暂无已保存地图'}</option>${options}</select>`;
    const action = canEdit
      ? `<button type="button" class="primary" id="open-selected-map" data-action="open-selected-map" data-id="" disabled>打开路线编辑</button>`
      : '<span class="map-picker-readonly">当前账号没有地图编辑权限</span>';
    return `<section class="map-existing-picker" aria-labelledby="existing-map-title"><div class="map-picker-copy"><h2 id="existing-map-title">编辑已有路线地图</h2><p id="existing-map-help">选中已保存的地图后直接打开草稿继续编辑；地图名称只在创建新地图时填写。</p></div><div class="map-picker-controls">${select}${action}</div></section>`;
  }

  window.OperationsMapPicker = Object.freeze({ render });
})();
