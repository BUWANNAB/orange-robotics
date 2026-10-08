const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('frontend/src/components/process-map/js/handle_map.js', 'utf8');
const editor = fs.readFileSync('frontend/src/components/process-map/handle_map.html', 'utf8');
const workbench = fs.readFileSync('frontend/src/modules/maps/workbench.js', 'utf8');

test('coordinate frame updates call the overlay renderer that is actually defined', () => {
  assert.match(source, /function drawCoordinateOverlay\s*\(/);
  assert.match(source, /drawCoordinateOverlay\(\);/);
  assert.doesNotMatch(source, /updateCoordinateOverlay\s*\(/);
});

test('embedded map editor and renderer use the coordinate overlay fix cache key', () => {
  assert.match(editor, /handle_map\.js\?v=20261008-coordinate-overlay-fix/);
  assert.match(workbench, /ui=20261008-coordinate-overlay-fix/);
});
