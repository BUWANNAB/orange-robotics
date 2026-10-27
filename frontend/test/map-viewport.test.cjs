const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {};
vm.runInNewContext(fs.readFileSync('frontend/src/modules/operations/map-canvas.js', 'utf8'), {
  window, structuredClone, AbortController, ResizeObserver: class { observe() {} disconnect() {} }
});
const MapCanvas = window.OperationsMapCanvas;
const drawCanvas = MapCanvas.prototype.draw;
MapCanvas.prototype.draw = function () { this.draws = (this.draws || 0) + 1; };

function viewport(dimensions = {}) {
  const listeners = new Map();
  const canvas = {
    clientWidth: 1000, clientHeight: 640, getContext: () => ({}),
    addEventListener: (type, callback) => listeners.set(type, callback),
    getBoundingClientRect: () => ({ left: 17, top: 23, width: 1000, height: 640 })
  };
  const document = { width: 40, height: 20, origin_x: -8.25, origin_y: 12.75, points: [], paths: [], areas: [], ...dimensions };
  const editor = new MapCanvas(canvas, document, () => {}, () => {});
  return { editor, canvas, listeners };
}
function worldAt(editor, x, y) {
  return { x: (x - editor.pan.x) / editor.scale, y: (editor.canvas.clientHeight - y - editor.pan.y) / editor.scale };
}
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`); }

test('zoom buttons preserve the world coordinate at the viewport center after panning', () => {
  const { editor, canvas } = viewport();
  editor.pan.x += 123.456; editor.pan.y -= 98.765;
  const center = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
  const before = worldAt(editor, center.x, center.y);
  assert.equal(editor.zoomBy(1.6), true);
  const projected = editor.screen(before);
  near(projected.x, center.x); near(projected.y, center.y);
  editor.zoomBy(1 / 1.6);
  const after = worldAt(editor, center.x, center.y);
  near(after.x, before.x); near(after.y, before.y);
});

test('fit resets the displayed relative zoom to 100 percent at the current viewport size', () => {
  const { editor, canvas } = viewport();
  assert.equal(editor.zoomPercent(), 100);
  editor.zoomBy(1.25);
  assert.equal(editor.zoomPercent(), 125);
  canvas.clientWidth = 1400;
  editor.fit();
  assert.equal(editor.zoomPercent(), 100);
  assert.equal(editor.scale, 28.5);
});

test('viewport resize refits the overview but preserves a manually zoomed view', () => {
  const { editor, canvas } = viewport();
  canvas.clientWidth = 600; editor.resize();
  near(editor.scale, Math.min((600 - 70) / 40, (640 - 70) / 20));
  assert.equal(editor.zoomPercent(), 100);
  editor.zoomBy(1.5); const scale = editor.scale, pan = { ...editor.pan };
  canvas.clientWidth = 1200; editor.resize();
  near(editor.scale, scale); near(editor.pan.x, pan.x); near(editor.pan.y, pan.y);
});

test('fit centers the map with nonzero origin in wide and tall viewports', () => {
  for (const [width, height] of [[1000, 640], [320, 900]]) {
    const { editor, canvas } = viewport();
    canvas.clientWidth = width; canvas.clientHeight = height; editor.fit();
    const center = editor.screen({ x: -8.25 + 40 / 2, y: 12.75 + 20 / 2 });
    near(center.x, width / 2); near(center.y, height / 2);
    const lower = editor.screen({ x: -8.25, y: 12.75 });
    const upper = editor.screen({ x: -8.25 + 40, y: 12.75 + 20 });
    assert.ok(lower.x >= 35 - 1e-9 && upper.x <= width - 35 + 1e-9);
    assert.ok(upper.y >= 35 - 1e-9 && lower.y <= height - 35 + 1e-9);
  }
});

test('wheel zoom preserves the cursor world coordinate without rounding or a vertical sign flip', () => {
  const { editor, listeners } = viewport();
  const x = 723.4567, y = 187.6543;
  const point = worldAt(editor, x, y);
  let prevented = false;
  listeners.get('wheel')({ clientX: x + 17, clientY: y + 23, deltaY: -1, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  near(editor.screen(point).x, x); near(editor.screen(point).y, y);
  assert.equal(editor.zoomPercent(), 115);
});

test('fit, wheel and button zoom share the same bounds and keep anchors stable at the bounds', () => {
  const { editor, listeners } = viewport();
  const center = worldAt(editor, 500, 320);
  editor.zoomBy(Number.MAX_VALUE);
  assert.equal(editor.scale, 100);
  near(editor.screen(center).x, 500); near(editor.screen(center).y, 320);
  listeners.get('wheel')({ clientX: 517, clientY: 343, deltaY: -1, preventDefault() {} });
  assert.equal(editor.scale, 100);
  editor.zoomBy(Number.MIN_VALUE);
  assert.equal(editor.scale, .1);
  near(editor.screen(center).x, 500); near(editor.screen(center).y, 320);
  listeners.get('wheel')({ clientX: 517, clientY: 343, deltaY: 1, preventDefault() {} });
  assert.equal(editor.scale, .1);
  assert.equal(viewport({ width: .01, height: .01 }).editor.scale, 100);
  assert.equal(viewport({ width: 100000, height: 100000 }).editor.scale, .1);
});

test('invalid zoom factors cannot corrupt the scale or pan', () => {
  const { editor } = viewport();
  const scale = editor.scale, pan = { ...editor.pan }, draws = editor.draws;
  for (const factor of [0, -1, NaN, Infinity, -Infinity, '2', null, undefined]) {
    assert.equal(editor.zoomBy(factor), false);
    assert.equal(editor.scale, scale);
    assert.equal(editor.pan.x, pan.x); assert.equal(editor.pan.y, pan.y);
  }
  assert.equal(editor.draws, draws);
});

test('the handbook palette is scoped to the RCS console and draw reports the actual zoom', () => {
  const { editor, canvas } = viewport({
    points: [{ code: 'A', x: 0, y: 15 }, { code: 'B', x: 5, y: 15 }],
    paths: [{ start: 'A', end: 'B', bidirectional: true }]
  });
  const fills = [], strokes = [], context = {};
  const ctx = new Proxy(context, { get: (target, key) => key in target ? target[key] : () => {} });
  context.fillRect = () => fills.push(ctx.fillStyle);
  context.stroke = () => strokes.push(ctx.strokeStyle);
  context.strokeRect = () => strokes.push(ctx.strokeStyle);
  context.measureText = text => ({ width: text.length * 6 });
  editor.ctx = ctx; editor.draw = drawCanvas;
  editor.draw();
  assert.equal(fills[0], '#fbfcfe');
  assert.ok(strokes.includes('#58748b'));
  fills.length = strokes.length = 0;
  canvas.closest = selector => selector === '.rcs-console' ? {} : null;
  const reports = []; editor.onViewChange = percent => reports.push(percent);
  editor.zoomBy(1.25);
  assert.equal(fills[0], '#fff');
  assert.ok(strokes.includes('#f8f9fc'));
  assert.ok(strokes.includes('#1476FB'));
  assert.ok(strokes.includes('#f36a14'), 'coordinate origin retains its orange reference');
  assert.equal(reports.at(-1), 125);
  strokes.length = 0;
  editor.shape = { kind: 'paths', index: 0 }; editor.selected = 0; editor.draw();
  assert.ok(strokes.includes('#015EE7'));
  assert.ok(!strokes.includes('#e87832'));
});
