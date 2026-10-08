(function (root, factory) {
    const coordinates = factory();
    if (typeof module === 'object' && module.exports) module.exports = coordinates;
    else root.MapCoordinates = coordinates;
})(globalThis, function () {
    function validFrame(width, height, resolution, origin) {
        return Number.isFinite(width) && width > 0
            && Number.isFinite(height) && height > 0
            && Number.isFinite(resolution) && resolution > 0
            && Array.isArray(origin) && origin.length === 3
            && origin.every(Number.isFinite);
    }

    function pixelToWorld(pixelX, pixelY, width, height, resolution, origin) {
        if (!validFrame(width, height, resolution, origin)
            || !Number.isFinite(pixelX) || !Number.isFinite(pixelY)) {
            throw new TypeError('地图坐标参数无效');
        }
        const [originX, originY, yaw] = origin;
        const localX = pixelX * resolution;
        const localY = (height - pixelY) * resolution;
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        return {
            x: originX + cos * localX - sin * localY,
            y: originY + sin * localX + cos * localY
        };
    }

    function worldToPixel(worldX, worldY, width, height, resolution, origin) {
        if (!validFrame(width, height, resolution, origin)
            || !Number.isFinite(worldX) || !Number.isFinite(worldY)) {
            throw new TypeError('地图坐标参数无效');
        }
        const [originX, originY, yaw] = origin;
        const dx = worldX - originX;
        const dy = worldY - originY;
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        const localX = cos * dx + sin * dy;
        const localY = -sin * dx + cos * dy;
        return { x: localX / resolution, y: height - localY / resolution };
    }

    function gridSpacing(pixelsPerMeter, targetPixels = 48) {
        if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0
            || !Number.isFinite(targetPixels) || targetPixels <= 0) {
            throw new TypeError('网格比例参数无效');
        }
        const raw = targetPixels / pixelsPerMeter;
        const magnitude = 10 ** Math.floor(Math.log10(raw));
        return [1, 2, 5, 10].map(multiplier => multiplier * magnitude)
            .find(step => step >= raw) || 10 * magnitude;
    }

    return { pixelToWorld, worldToPixel, gridSpacing };
});
