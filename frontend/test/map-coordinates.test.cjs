const test = require('node:test');
const assert = require('node:assert/strict');
const { pixelToWorld, worldToPixel, gridSpacing } = require('../src/components/process-map/js/map_coordinates.js');

test('converts image pixels to ROS map coordinates with positive Y upward', () => {
    assert.deepEqual(pixelToWorld(0, 20, 20, 20, 0.1, [-5, -3, 0]), { x: -5, y: -3 });
    assert.deepEqual(pixelToWorld(20, 0, 20, 20, 0.1, [-5, -3, 0]), { x: -3, y: -1 });
});

test('converts pixels and world coordinates both ways for a rotated map', () => {
    const origin = [-2.5, 1.25, Math.PI / 3];
    const pixel = { x: 34, y: 19 };
    const world = pixelToWorld(pixel.x, pixel.y, 80, 60, 0.05, origin);
    const restored = worldToPixel(world.x, world.y, 80, 60, 0.05, origin);
    assert.ok(Math.abs(restored.x - pixel.x) < 1e-9);
    assert.ok(Math.abs(restored.y - pixel.y) < 1e-9);
});

test('chooses a readable grid interval across zoom levels', () => {
    assert.equal(gridSpacing(240), 0.2);
    assert.equal(gridSpacing(24), 2);
    assert.equal(gridSpacing(2.4), 20);
});
