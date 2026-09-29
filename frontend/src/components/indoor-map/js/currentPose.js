// 将四元数转换为偏航角（弧度）
function quaternionToYaw(x, y, z, w) {
    // 四元数转欧拉角 - 偏航角（yaw）
    const siny_cosp = 2 * (w * z + x * y);
    const cosy_cosp = 1 - 2 * (y * y + z * z);
    // 取反值以修正方向问题，并减去90度修正偏移
    return -Math.atan2(siny_cosp, cosy_cosp) + (Math.PI / 2);
}

// 将弧度转换为角度
function radiansToDegrees(radians) {
    return radians * (180 / Math.PI);
}

const ROBOT_POSITION_DEADBAND_METERS = 0.05;
const ROBOT_HEADING_DEADBAND_DEGREES = 2;
let lastDisplayedRobotPose = null;

function angleDifferenceDegrees(a, b) {
    return Math.abs(((a - b + 180) % 360 + 360) % 360 - 180);
}

// 定期渲染机器人位置到地图
setInterval(() => {
    renderPoseToMap();
}, 800);

// 渲染机器人位置到地图
function renderPoseToMap() {
    try {
        // 从localStorage获取positionData
        const positionDataStr = localStorage.getItem('positionData');
        if (!positionDataStr) {
            return;
        }
        
        const positionData = JSON.parse(positionDataStr);
        if (Date.now() - positionData.timestamp > 2000 || (positionData.localization && !positionData.localization.fresh)) return;
        const localX = Number(positionData.localX);
        const localY = Number(positionData.localY);
        const orientationX = Number(positionData.orientationX);
        const orientationY = Number(positionData.orientationY);
        const orientationZ = Number(positionData.orientationZ);
        const orientationW = Number(positionData.orientationW);
        
        // 直接使用当前页面的地图对象
        if (typeof map === 'undefined') {
            console.log('地图对象未初始化');
            return;
        }
        
        if (![localX, localY, orientationX, orientationY, orientationZ, orientationW].every(Number.isFinite)) {
            console.log('坐标数据无效');
            return;
        }
        
        // 计算朝向角度
        const yaw = quaternionToYaw(orientationX, orientationY, orientationZ, orientationW);
        const headingDegrees = radiansToDegrees(yaw);

        if (lastDisplayedRobotPose) {
            const movement = Math.hypot(
                localX - lastDisplayedRobotPose.x,
                localY - lastDisplayedRobotPose.y
            );
            const headingChange = angleDifferenceDegrees(
                headingDegrees,
                lastDisplayedRobotPose.heading
            );
            if (movement < ROBOT_POSITION_DEADBAND_METERS &&
                headingChange < ROBOT_HEADING_DEADBAND_DEGREES) {
                return;
            }
        }
        
        // 创建机器人图标（包含朝向指示器）
        const robotIcon = L.divIcon({
            className: 'robot-marker',
            html: `<div style="position: relative; width: 20px; height: 20px;">
                <div style="background: #ff4444; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5); position: absolute; top: 2px; left: 2px;"></div>
                <div style="position: absolute; top: 0; left: 9px; width: 2px; height: 8px; background: red; transform-origin: bottom center; transform: rotate(${headingDegrees}deg);">
                    <div style="position: absolute; top: -8px; left: -5px; width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 8px solid red;"></div>
                </div>
            </div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
        
        // 检查worldToPixel函数是否可用
        if (typeof worldToPixel !== 'function') {
            console.log('worldToPixel函数不可用');
            return;
        }
        
        // 将世界坐标转换为像素坐标（使用数学坐标系）
        const pixelCoords = worldToPixel(localX, localY);
        
        const markerPosition = [pixelCoords.y, pixelCoords.x];
        const popup = `机器人位置<br>世界坐标: (${localX.toFixed(3)}, ${localY.toFixed(3)})<br>像素坐标: (${pixelCoords.x.toFixed(2)}, ${pixelCoords.y.toFixed(2)})<br>朝向: ${headingDegrees.toFixed(1)}°`;

        if (typeof robotMarker !== 'undefined' && robotMarker) {
            robotMarker.setLatLng(markerPosition);
            robotMarker.setIcon(robotIcon);
            robotMarker.setPopupContent(popup);
        } else {
            robotMarker = L.marker(markerPosition, {
                icon: robotIcon,
                zIndexOffset: -1000
            }).addTo(map);
            robotMarker.bindPopup(popup);
        }

        lastDisplayedRobotPose = {
            x: localX,
            y: localY,
            heading: headingDegrees
        };
        
    } catch (error) {
        console.error('渲染机器人位置到地图时出错:', error);
        console.log("请确保webSocketUtil.js已正确创建并更新positionData");
    }
}
