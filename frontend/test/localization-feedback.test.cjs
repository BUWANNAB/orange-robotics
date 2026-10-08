const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const window = {};
vm.runInNewContext(fs.readFileSync('frontend/src/modules/operations/localization-feedback.js', 'utf8'), { window, Set });
const feedback = window.LocalizationFeedback;
const frame = (localization, extra = {}) => ({ localization, switch: { status: 'ready' }, relocalization: { status: 'idle' }, ...extra });

test('only fresh, quality-passed ROS data confirms successful localization', () => {
  const valid = feedback.from(frame({ source: 'ros', fresh: true, valid: true }));
  assert.equal(valid.confirmed, true);
  assert.equal(valid.title, '定位成功');
  assert.equal(feedback.from(frame({ source: 'ros', fresh: true, valid: false })).confirmed, false);
  assert.equal(feedback.from(frame({ source: 'ros', fresh: false, valid: false })).confirmed, false);
  assert.equal(feedback.from(frame({ source: 'simulation', fresh: true, valid: true })).confirmed, false);
});

test('switch and automatic-relocalization failures or in-progress states never show success', () => {
  const switching = feedback.from(frame({ source: 'ros', fresh: true, valid: true }, { switch: { status: 'localizing' } }));
  assert.equal(switching.confirmed, false);
  assert.equal(switching.title, '定位确认中');
  const failed = feedback.from(frame({ source: 'ros', fresh: true, valid: true }, { switch: { status: 'failed', message: 'map rejected' } }));
  assert.equal(failed.kind, 'error');
  assert.equal(failed.confirmed, false);
  assert.equal(feedback.disconnected().confirmed, false);
});
