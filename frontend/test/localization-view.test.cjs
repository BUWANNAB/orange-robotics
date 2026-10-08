const test = require('node:test');
const assert = require('node:assert/strict');
const { colorize, colorizeImageData } = require('../src/modules/maps/pgm.js');
const PoseGesture = require('../src/modules/operations/pose-gesture.js');

test('renders unknown PGM pixels transparently and known cells with a readable palette', () => {
  const source = new Uint8Array([0, 205, 254]);
  const rgba = colorize(source);

  assert.equal(rgba[3], 255);
  assert.equal(rgba[7], 0);
  assert.equal(rgba[11], 255);
  assert.ok(rgba[0] < rgba[8]);
  assert.deepEqual(Array.from(source), [0, 205, 254]);
});

test('colorizes grayscale PNG cells while preserving colored overlays', () => {
  const imageData = { data: new Uint8ClampedArray([205, 205, 205, 255, 20, 80, 140, 255]) };
  colorizeImageData(imageData);

  assert.equal(imageData.data[3], 0);
  assert.deepEqual(Array.from(imageData.data.slice(4)), [20, 80, 140, 255]);
});

test('maps a rotated screen drag back to the correct ROS pose and heading', () => {
  const view = { w: 800, h: 600, cx: 10, cy: -2, scale: 20, rotation: Math.PI / 2 };
  const result = PoseGesture.estimate({ x: 400, y: 320 }, { x: 420, y: 320 }, view);

  assert.ok(Math.abs(result.x - 11) < 1e-9);
  assert.ok(Math.abs(result.y + 2) < 1e-9);
  assert.ok(Math.abs(result.yaw - Math.PI / 2) < 1e-9);
});

test('keeps unrotated drag-to-pose behavior unchanged', () => {
  const result = PoseGesture.estimate({ x: 400, y: 300 }, { x: 420, y: 300 }, {
    w: 800, h: 600, cx: 10, cy: -2, scale: 20, rotation: 0
  });

  assert.deepEqual(result, { x: 10, y: -2, yaw: 0 });
});
