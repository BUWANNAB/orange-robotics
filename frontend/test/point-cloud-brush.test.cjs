const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const viewer = fs.readFileSync('frontend/src/modules/maps/point-viewer.js', 'utf8');
const workbench = fs.readFileSync('frontend/src/modules/maps/workbench.js', 'utf8');
const html = fs.readFileSync('frontend/map-workbench.html', 'utf8');

test('point-cloud editor exposes the manual adjustable eraser workflow', () => {
  assert.match(html, /id="erase-brush"[^>]*>橡皮擦/);
  assert.match(html, /id="brush-size-down"/);
  assert.match(html, /id="brush-size-value">0\.4 m<\/output>/);
  assert.match(html, /id="brush-size-up"/);
  assert.match(html, /id="undo-erase"/);
  assert.match(html, /托盘、移动料车、人员/);
  assert.match(html, /墙体、产线和货架/);
});

test('brush strokes are previewed in source XY and included in new-map processing', () => {
  assert.match(viewer, /drawBrush\(\).*mode='erase-brush'/);
  assert.match(viewer, /brushFootprint\(stroke\)/);
  assert.match(viewer, /erase_brush:eraseStrokes\.map/);
  assert.match(workbench, /viewer\?\.selection\(\)/);
  assert.match(workbench, /橡皮擦删除/);
});
