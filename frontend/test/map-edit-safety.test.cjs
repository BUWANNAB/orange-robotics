const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {};
vm.runInNewContext(fs.readFileSync('frontend/src/modules/operations/map-canvas.js', 'utf8'), {
  window, structuredClone, AbortController, ResizeObserver: class { observe() {} disconnect() {} }
});
const MapCanvas = window.OperationsMapCanvas;
const draw = MapCanvas.prototype.draw;
MapCanvas.prototype.draw = function () {};

function fixture(extra = {}) {
  const listeners = new Map(), changes = [], selections = [], commands = [];
  const ctx = new Proxy({ measureText: text => ({ width: text.length * 6 }) }, {
    get(target, key) { return key in target ? target[key] : (...args) => { commands.push({ name: key, args, color: ctx.strokeStyle }); }; }
  });
  const canvas = {
    clientWidth: 1000, clientHeight: 640, getContext: () => ctx,
    addEventListener: (type, callback) => listeners.set(type, callback),
    setPointerCapture() {}, getBoundingClientRect: () => ({ left: 17, top: 23, width: 1000, height: 640 })
  };
  const document = {
    width: 40, height: 20, origin_x: 0, origin_y: 0,
    points: [{ uid: 'point-a', code: 'A', name: 'A区', type: 'station', x: 5, y: 5, theta: 0 },
      { uid: 'point-b', code: 'B', name: 'B区', type: 'station', x: 15, y: 5, theta: 0 },
      { uid: 'point-c', code: 'C', name: 'C区', type: 'station', x: 25, y: 8, theta: 0 }],
    paths: [{ uid: 'path-ab', start: 'A', end: 'B', speed: 0.5, bidirectional: true },
      { uid: 'path-ac', start: 'A', end: 'C', speed: 0.3, bidirectional: true }], areas: [], ...extra
  };
  const editor = new MapCanvas(canvas, document, doc => changes.push(structuredClone(doc)), point => selections.push(point));
  const eventAt = (point, dx = 0, dy = 0) => {
    const p = editor.screen(point);
    return { clientX: p.x + 17 + dx, clientY: p.y + 23 + dy, button: 0, pointerId: 1 };
  };
  return { editor, document, eventAt, changes, selections, listeners, commands, ctx };
}

test('selecting an existing station never unlocks or saves its position', () => {
  const { editor, eventAt, changes, selections } = fixture();
  const before = JSON.stringify(editor.document);
  editor.down(eventAt(editor.document.points[0]));
  editor.move(eventAt(editor.document.points[0], 45, -20));
  editor.up();
  assert.equal(editor.selected, 0);
  assert.equal(selections.at(-1).code, 'A');
  assert.equal(editor.pendingMove, null);
  assert.equal(JSON.stringify(editor.document), before);
  assert.equal(editor.history.length, 0);
  assert.equal(changes.length, 0);
});

test('explicit station movement previews after a five pixel threshold and cancels without dirtying the map', () => {
  const { editor, eventAt, changes, selections } = fixture();
  editor.selectPoint('A'); editor.beginPointMove();
  const start = eventAt(editor.document.points[0]);
  editor.down(start); editor.move({ ...start, clientX: start.clientX + 3, clientY: start.clientY + 3 });
  assert.equal(editor.pendingMove.point.x, 5);
  editor.move({ ...start, clientX: start.clientX + 25, clientY: start.clientY - 10 }); editor.up();
  assert.ok(editor.pendingMove.point.x > 5);
  assert.equal(editor.document.points[0].x, 5);
  assert.equal(selections.at(-1).x, editor.pendingMove.point.x);
  assert.equal(changes.length, 0); assert.equal(editor.history.length, 0);
  editor.cancelPointMove();
  assert.equal(editor.pendingMove, null); assert.equal(editor.tool, 'select');
  assert.equal(selections.at(-1).x, 5); assert.equal(changes.length, 0);
});

test('applying exact coordinates commits once, preserves identity and can be undone in one operation', () => {
  const { editor, changes } = fixture();
  editor.selectPoint('A'); editor.beginPointMove();
  editor.updatePoint({ code: 'A-new', x: 12.35, y: 4.20, theta: Math.PI / 2 });
  assert.equal(editor.document.points[0].x, 12.35);
  assert.equal(editor.document.points[0].y, 4.2);
  assert.equal(editor.document.points[0].theta, Math.PI / 2);
  assert.equal(editor.document.points[0].uid, 'point-a');
  assert.equal(editor.document.paths[0].start, 'A-new');
  assert.equal(editor.pendingMove, null); assert.equal(editor.tool, 'select');
  assert.equal(editor.history.length, 1); assert.equal(changes.length, 1);
  editor.undo();
  assert.equal(editor.document.points[0].x, 5);
  assert.equal(editor.document.points[0].code, 'A');
  assert.equal(editor.document.paths[0].start, 'A');
});

test('coordinate changes require an explicit unlock and invalid values cannot mutate a draft', () => {
  const { editor, changes } = fixture(); editor.selectPoint('A');
  assert.throws(() => editor.updatePoint({ x: 8 }), /调整位置/);
  editor.beginPointMove();
  for (const value of [{ x: NaN }, { x: Infinity }, { y: -1 }, { x: 40.01 }, { theta: NaN }, { code: 'B' }, { code: '' }]) {
    assert.throws(() => editor.updatePoint(value));
    assert.equal(editor.document.points[0].x, 5); assert.equal(editor.document.points[0].code, 'A');
  }
  assert.equal(changes.length, 0); assert.equal(editor.history.length, 0);
});

test('selecting another object or changing tool cancels movement and reports the correct final selection', () => {
  const { editor, selections, changes } = fixture();
  editor.selectPoint('A'); editor.beginPointMove(); editor.pendingMove.point.x = 9;
  editor.selectPoint('B');
  assert.equal(editor.pendingMove, null); assert.equal(editor.selected, 1); assert.equal(selections.at(-1).code, 'B');
  editor.beginPointMove(); editor.selectObject('paths', 0);
  assert.equal(editor.pendingMove, null); assert.equal(selections.at(-1).kind, 'paths');
  editor.selectPoint('C'); editor.beginPointMove(); editor.setTool('pan');
  assert.equal(editor.pendingMove, null); assert.equal(editor.tool, 'pan'); assert.equal(selections.at(-1).code, 'C');
  assert.equal(changes.length, 0); assert.equal(editor.history.length, 0);
});

test('a pending station remains outside the document and validates coordinates before confirmation', () => {
  const { editor, eventAt, changes } = fixture(); editor.setTool('point');
  editor.down(eventAt({ x: 10.25, y: 12.15 }));
  assert.equal(editor.document.points.length, 3); assert.equal(changes.length, 0);
  assert.throws(() => editor.confirmPendingPoint({ code: 'A' }), /已存在/);
  assert.throws(() => editor.confirmPendingPoint({ x: -1 }), /边界/);
  editor.confirmPendingPoint({ code: 'D' });
  assert.equal(editor.document.points.length, 4); assert.equal(editor.document.points[3].x, 10.25);
  assert.equal(changes.length, 1); assert.equal(editor.history.length, 1);
});

test('new paths inherit the persisted default linear speed and changing the default does not modify existing segments', () => {
  const { editor, eventAt, changes } = fixture({ paths: [] });
  assert.equal(editor.document.default_speed, 0.5);
  editor.setDefaultSpeed(0.8); editor.setTool('path');
  editor.down(eventAt(editor.document.points[0])); editor.down(eventAt(editor.document.points[1]));
  assert.equal(editor.document.paths[0].speed, 0.8);
  assert.equal(editor.history.length, 2); assert.equal(changes.length, 2);
  editor.setDefaultSpeed(0.6);
  assert.equal(editor.document.paths[0].speed, 0.8);
  assert.equal(editor.document.default_speed, 0.6);
});

test('batch speeds apply only to selected segments, validate every target and form one undo operation', () => {
  const { editor, changes } = fixture();
  editor.togglePathSelection(0); editor.togglePathSelection(1); editor.togglePathSelection(1);
  assert.equal(editor.selectedPathIndices.size, 1); assert.equal(changes.length, 0);
  for (const bad of [0, -1, NaN, Infinity, 3.01]) assert.throws(() => editor.applyPathSpeed([0], bad));
  assert.throws(() => editor.applyPathSpeed([0, 99], 0.9), /更新/);
  assert.equal(editor.history.length, 0); assert.equal(changes.length, 0);
  editor.applyPathSpeed(editor.selectedPathIndices, 0.9);
  assert.equal(editor.document.paths[0].speed, 0.9); assert.equal(editor.document.paths[1].speed, 0.3);
  assert.equal(editor.history.length, 1); assert.equal(changes.length, 1);
  editor.undo(); assert.equal(editor.document.paths[0].speed, 0.5); assert.equal(editor.selectedPathIndices.size, 0);
});

test('deletion previews list all connected segments without deleting or saving anything', () => {
  const { editor, changes } = fixture(); editor.selectPoint('A');
  const before = JSON.stringify(editor.document), impact = editor.deletionImpact();
  assert.equal(impact.kind, 'points'); assert.equal(impact.uid, 'point-a');
  assert.equal(JSON.stringify(impact.point_codes), '["A"]'); assert.equal(JSON.stringify(impact.path_indices), '[0,1]');
  editor.setImpactPreview(impact);
  assert.equal(editor.highlightedTargets().points.has('A'), true); assert.equal(editor.highlightedTargets().paths.has(1), true);
  assert.equal(JSON.stringify(editor.document), before); assert.equal(changes.length, 0);
  editor.setImpactPreview(null); assert.equal(editor.highlightedTargets().paths.size, 0);
  editor.remove(); assert.equal(editor.document.paths.length, 0);
  editor.undo(); assert.equal(editor.document.points.length, 3); assert.equal(editor.document.paths.length, 2);
});

test('clickable validation targets center both stations and retain map coordinates and undo history', () => {
  const { editor, changes } = fixture(); const before = JSON.stringify(editor.document);
  const issue = { message: '点位间距过近', targets: { points: ['A', 'B'], paths: [], areas: [] } };
  editor.setValidationIssues([issue]); assert.equal(editor.highlightedTargets().points.has('B'), true);
  assert.equal(editor.focusIssue(issue), true);
  const center = editor.screen({ x: 10, y: 5 });
  assert.equal(center.x, editor.canvas.clientWidth / 2); assert.equal(center.y, editor.canvas.clientHeight / 2);
  assert.equal(JSON.stringify(editor.document), before); assert.equal(changes.length, 0); assert.equal(editor.history.length, 0);
});

test('the drawn moving station and its connected path follow preview coordinates while the saved document stays fixed', () => {
  const { editor, commands } = fixture(); editor.selectPoint('A'); editor.beginPointMove();
  editor.pendingMove.point.x = 8.35; editor.pendingMove.point.y = 7.15;
  editor.layers.coordinates = false; editor.layers.background = false;
  draw.call(editor);
  const firstPathStart = commands.find(command => command.name === 'moveTo'), preview = editor.screen(editor.pendingMove.point);
  assert.equal(firstPathStart.args[0], preview.x); assert.equal(firstPathStart.args[1], preview.y);
  assert.equal(editor.document.points[0].x, 5); assert.equal(editor.document.points[0].y, 5);
});

test('invalid-object highlights remain visible when normal object layers are hidden', () => {
  const { editor, commands } = fixture();
  editor.layers.coordinates = false; editor.layers.paths = false; editor.layers.stations = false;
  editor.setValidationIssues([{ targets: { points: ['A'], paths: [0], areas: [] } }]);
  draw.call(editor);
  assert.ok(commands.some(command => command.name === 'stroke' && command.color === '#cf333d'));
});

test('straight route arrowheads sit between stations and show each allowed direction', () => {
  for (const bidirectional of [false, true]) {
    const { editor, commands } = fixture({
      paths: [{start: 'A', end: 'B', bidirectional}]
    });
    editor.layers.coordinates = false;
    editor.layers.background = false;
    editor.layers.stations = false;
    draw.call(editor);
    const left = editor.screen(editor.document.points[0]).x;
    const right = editor.screen(editor.document.points[1]).x;
    const heads = commands.flatMap((command, index) => {
      if (command.name !== 'stroke' || command.color !== 'rgba(255,255,255,.96)') return [];
      return [{tip: commands[index - 2].args[0], tail: commands[index - 3].args[0]}];
    });
    assert.equal(heads.length, bidirectional ? 2 : 1);
    assert.ok(heads.every(({tip}) => tip > left && tip < right));
    if (bidirectional) {
      assert.ok(heads[0].tip < heads[1].tip);
      assert.ok(heads[0].tip < heads[0].tail);
    }
    assert.ok(heads.at(-1).tip > heads.at(-1).tail);
  }
});
