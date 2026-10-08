const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadBrowserModule(path, exportName) {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path, 'utf8'), { window, Math });
  return window[exportName];
}

const geometry = loadBrowserModule('frontend/src/modules/operations/map-canvas.js', 'OperationsMapGeometry');

test('smooth route curve passes through named stations and reaches configured lateral offset', () => {
  const path = { curve_mode: 'smooth', curve_offset: 1 };
  const points = geometry.samplePath(path, { x: 0, y: 0 }, { x: 4, y: 0 }, 8);

  assert.equal(points[0].x, 0);
  assert.equal(points[0].y, 0);
  assert.equal(points.at(-1).x, 4);
  assert.equal(points.at(-1).y, 0);
  assert.ok(Math.abs(points[4].y - 1) < 1e-9);
  assert.ok(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test('legacy and zero-offset routes remain straight and smooth route sample count is bounded', () => {
  assert.equal(geometry.samplePath({}, { x: 0, y: 1 }, { x: 3, y: 1 }).length, 2);
  assert.equal(geometry.samplePath({ curve_mode: 'smooth', curve_offset: 0 }, { x: 0, y: 1 }, { x: 3, y: 1 }).length, 2);
  assert.ok(geometry.pathSampleCount({ x: 0, y: 0 }, { x: 1000, y: 0 }) <= 24);
});
