const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const css = fs.readFileSync('frontend/src/components/process-map/css/handle_map.css', 'utf8');
const editor = fs.readFileSync('frontend/src/components/process-map/handle_map.html', 'utf8');
const workbench = fs.readFileSync('frontend/src/modules/maps/workbench.js', 'utf8');
const editorLogic = fs.readFileSync('frontend/src/components/process-map/js/handle_map.js', 'utf8');

test('map status messages use calm success/error colors instead of the yellow alert fill', () => {
  const statusRule = css.match(/\.status-message\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(statusRule, /background:\s*#f7f4ee/i);
  assert.doesNotMatch(statusRule, /#ffeb3b/i);
  assert.match(css, /\.status-message\.success\s*\{/);
  assert.match(css, /\.status-message\.error\s*\{/);
  assert.match(editorLogic, /statusMessage\.className = 'status-message success'/);
});

test('zoom controls use the softened palette and the embedded editor cache key is refreshed', () => {
  const zoomRule = css.match(/\.zoom-controls button\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(zoomRule, /background:\s*#607e78/i);
  assert.doesNotMatch(zoomRule, /#3498db/i);
  assert.match(editor, /handle_map\.js\?v=20261008-status-calm/);
  assert.match(editor, /handle_map\.css\?v=20261008-status-calm/);
  assert.match(workbench, /ui=20261008-status-calm/);
});
