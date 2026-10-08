const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {};
vm.runInNewContext(fs.readFileSync('frontend/src/modules/operations/map-picker.js', 'utf8'), { window });

test('existing maps can be selected and opened without entering a new map name', () => {
  const html = window.OperationsMapPicker.render([
    { id: 7, name: '厂区一层', revision: 3, published_version: 2 },
  ], true, '7');

  assert.match(html, /id="existing-map-picker"/);
  assert.match(html, /value="7" selected/);
  assert.match(html, /打开路线编辑/);
  assert.match(html, /地图名称只在创建新地图时填写/);
  assert.doesNotMatch(html, /name="name"/);
});

test('map names are escaped and edit controls are omitted for read-only accounts', () => {
  const html = window.OperationsMapPicker.render([
    { id: 8, name: '<script>alert(1)</script>', revision: 1, published_version: null },
  ], false);

  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /没有地图编辑权限/);
  assert.doesNotMatch(html, /data-action="open-selected-map"/);
});

test('empty map inventory explains that a map must be created first', () => {
  const html = window.OperationsMapPicker.render([], true);

  assert.match(html, /暂无已保存地图/);
  assert.match(html, /disabled/);
});
