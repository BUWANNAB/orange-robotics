// 路线管理功能模块
RosManager.init();//初始化

// 地图设置面板折叠功能
function toggleControls() {
    const controlsPanel = document.getElementById('controlsPanel');
    const toggleBtn = document.getElementById('toggleControlsBtn');
    
    if (controlsPanel.classList.contains('collapsed')) {
        // 展开
        controlsPanel.classList.remove('collapsed');
        toggleBtn.classList.remove('collapsed');
        toggleBtn.setAttribute('aria-expanded', 'true');
    } else {
        // 折叠
        controlsPanel.classList.add('collapsed');
        toggleBtn.classList.add('collapsed');
        toggleBtn.setAttribute('aria-expanded', 'false');
    }

    // 面板尺寸变化后通知 Leaflet 重新计算可视区域。
    window.setTimeout(function () {
        if (typeof map !== 'undefined' && map && typeof map.invalidateSize === 'function') {
            map.invalidateSize();
        }
    }, 320);
}

// 路线创建相关变量
let isRouteMode = false;        // 路线创建模式
window.isRouteMode = isRouteMode;  // 将isRouteMode添加到window对象中
let isRouteEditMode = false;    // 路线编辑模式
// 不需要单独设置window.isRouteEditMode，直接使用变量即可
let isClosedRouteMode = false;  // 闭合路线创建模式
let routePoints = [];           // 路线点数组（像素坐标）
let originalRoutePoints = [];   // 原始路线点数组（用于取消编辑）
let routeMarkers = [];          // 路线标记数组
let routePolyline = null;       // 路线线条
let routeSegmentLayers = [];    // 分段路段线条集合
let routeSpeedBadgeMarkers = []; // 分段速度标签标记集合
let isDragging = false;         // 是否正在拖拽
let dragPointIndex = -1;        // 拖拽的点索引
let skipRestoreEditMode = false; // 跳过恢复编辑模式标志

// 临时存储路线点数据的对象
let tempRoutePointsData = {};   // 使用对象存储路线点数据，键为点的索引，值为点的属性数据

let currentImportRoute = [];  
let isEditMode = false;         // 是否为编辑模式
let currentEditRouteInfo = null; // 当前编辑的路线信息   

let currentRouteItem = null;
let routeRectangles = [];       // 存储路线矩形框
let isDraggingRectangle = false; // 是否正在拖动矩形框
let currentDraggingRectangle = null; // 当前正在拖动的矩形框

// 全局路线数据变量
let routeData = null;           // 存储从服务器获取的路线数据

// 固定位置站点属性框相关变量
let fixedStationInfoBox = null;  // 固定位置的站点属性框
let currentStationMarker = null; // 当前选中的站点标记
let currentStationIndex = -1;    // 当前选中的站点索引
let highlightedStationMarker = null//这是创建的高亮标记
// 在两个站点之间创建可拖动矩形框
function createDraggableRectangleBetweenPoints(point1, point2, index) {
    // 计算两个点的中点
    const midX = (point1.x + point2.x) / 2;
    const midY = (point1.y + point2.y) / 2;
     
    // 根据地图缩放级别计算矩形的大小
    const zoomLevel = map.getZoom();
    // 基础大小为4像素，随着缩放级别增加而调整
    let rectSize = 4;
    if (zoomLevel > 0) {
        rectSize = 4 / Math.pow(1.2, zoomLevel);  // 调整缩放系数，使在高缩放级别下矩形不会过小
    } else if (zoomLevel < 0) {
        rectSize = 4 * Math.pow(1.3, Math.abs(zoomLevel));  // 在负缩放级别下适当增大矩形
    }
    // 确保矩形大小在合理范围内
    rectSize = Math.max(Math.min(rectSize, 20), 1);  // 限制在1-20像素之间
    
    // 创建矩形边界
    const bounds = [
        [midY - rectSize/2, midX - rectSize/2], // 西南角
        [midY + rectSize/2, midX + rectSize/2]  // 东北角
    ];
    
    // 创建矩形 - 使用L.marker配合divIcon实现拖动功能
    const centerLatLng = [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2];
    
    // 根据缩放级别调整矩形大小（以像素为单位）
    const currentZoomLevel = map.getZoom();
    const pixelSize = Math.max(20, 40 / Math.pow(1.2, 20 - currentZoomLevel)); // 基础20像素，随缩放调整
    
    // 创建矩形图标
    const rectangleIcon = L.divIcon({
        className: 'custom-rectangle-icon',
        html: `<div style="
            width: ${pixelSize}px;
            height: ${pixelSize}px;
            background-color: rgba(255, 120, 0, 0.3);
            border: 2px solid #ff7800;
            cursor: move;
            position: relative;
            top: 0;
            left: 0;
            border-radius: 3px;
            box-shadow: 0 0 6px rgba(255, 120, 0, 0.5);
        "></div>`,
        iconSize: [pixelSize, pixelSize],
        iconAnchor: [pixelSize/2, pixelSize/2]
    });
    
    // 使用L.marker创建可拖动的矩形
    const rectangle = L.marker(centerLatLng, {
        icon: rectangleIcon,
        draggable: true,
        zIndexOffset: 1000
    }).addTo(map);
    
    // 存储矩形的信息
    rectangle.rectangleIndex = index;
    rectangle.point1Index = index;
    rectangle.point2Index = index + 1;
    
    // 添加拖动事件以实现拖动功能
    rectangle.on('dragstart', function(e) {
        isDraggingRectangle = true;
        currentDraggingRectangle = rectangle;
        
        // 记录初始矩形位置
        rectangle.startLatLng = rectangle.getLatLng();
        
        // 创建预览虚线
        const point1 = routePoints[rectangle.point1Index];
        const point2 = routePoints[rectangle.point2Index];
        
        // 第一条虚线：从前一个点到矩形中心
        rectangle.previewLine1 = L.polyline([
            [point1.y, point1.x],
            [rectangle.startLatLng.lat, rectangle.startLatLng.lng]
        ], {
            color: '#ff7800',
            weight: 2,
            opacity: 0.7,
            dashArray: '5, 10',
            className: 'preview-line'
        }).addTo(map);
        
        // 第二条虚线：从矩形中心到后一个点
        rectangle.previewLine2 = L.polyline([
            [rectangle.startLatLng.lat, rectangle.startLatLng.lng],
            [point2.y, point2.x]
        ], {
            color: '#ff7800',
            weight: 2,
            opacity: 0.7,
            dashArray: '5, 10',
            className: 'preview-line'
        }).addTo(map);
    });
    
    rectangle.on('drag', function(e) {
        if (isDraggingRectangle && currentDraggingRectangle === rectangle) {
            // 更新预览虚线
            const point1 = routePoints[rectangle.point1Index];
            const point2 = routePoints[rectangle.point2Index];
            const currentLatLng = rectangle.getLatLng();
            
            if (rectangle.previewLine1) {
                rectangle.previewLine1.setLatLngs([
                    [point1.y, point1.x],
                    [currentLatLng.lat, currentLatLng.lng]
                ]);
            }
            
            if (rectangle.previewLine2) {
                rectangle.previewLine2.setLatLngs([
                    [currentLatLng.lat, currentLatLng.lng],
                    [point2.y, point2.x]
                ]);
            }
        }
    });
    
    rectangle.on('dragend', function(e) {
        if (isDraggingRectangle && currentDraggingRectangle === rectangle) {
            isDraggingRectangle = false;
            
            // 移除预览虚线
            if (rectangle.previewLine1) {
                map.removeLayer(rectangle.previewLine1);
                rectangle.previewLine1 = null;
            }
            if (rectangle.previewLine2) {
                map.removeLayer(rectangle.previewLine2);
                rectangle.previewLine2 = null;
            }
            
            // 获取矩形中心点
            const center = rectangle.getLatLng();
            
            // 在矩形中心位置添加新的路线点
            addRoutePointAtPosition(center.lng, center.lat, rectangle.point1Index + 1);
            
            // 移除当前矩形
            map.removeLayer(rectangle);
            const rectIndex = routeRectangles.indexOf(rectangle);
            if (rectIndex !== -1) {
                routeRectangles.splice(rectIndex, 1);
            }
            currentDraggingRectangle = null;
        }
    });
    
    // 添加提示信息
    rectangle.bindPopup('拖动此矩形可在两点之间添加新站点');
    
    return rectangle;
}
//创建一个高亮的函数
function hightLight(marker){
    if(highlightedStationMarker){
        map.removeLayer(highlightedStationMarker);
          highlightedStationMarker = null;
    }
    if(!marker){
        return;
    }
    const position = marker.getLatLng()
    const pointIcon = L.divIcon({
        className: 'route-point-marker',
        html: '<div style="background:rgb(247, 29, 0); width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5); cursor: pointer;"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });
    const hightlight =L.marker(position, { icon: pointIcon, draggable: true }).addTo(map);
    
}
//创建完高亮，再获取点击事件，点击站点，变成高亮

// 在指定位置添加路线点
function addRoutePointAtPosition(px, py, insertIndex) {
    // 创建路线点标记
    const pointIcon = L.divIcon({
        className: 'route-point-marker',
        html: '<div style="background: #007cba; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5); cursor: pointer;"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });
    
    const marker = L.marker([py, px], { icon: pointIcon, draggable: true }).addTo(map);
  
    // 添加拖拽事件
    marker.on('dragstart', function(e) {
        isDragging = true;
        dragPointIndex = routeMarkers.indexOf(marker);
        // 保存原始位置用于计算偏移量
        if (routePoints[dragPointIndex]) {
            // 保存像素坐标用于更新路线
            routePoints[dragPointIndex].originalX = routePoints[dragPointIndex].x;
            routePoints[dragPointIndex].originalY = routePoints[dragPointIndex].y;
            
            // 保存原始世界坐标用于计算偏移量
            const originalWorldCoords = pixelToWorldMath(routePoints[dragPointIndex].x, routePoints[dragPointIndex].y);
            routePoints[dragPointIndex].originalWorldX = originalWorldCoords.x;
            routePoints[dragPointIndex].originalWorldY = originalWorldCoords.y;
            
            // 创建原始位置的虚线标记
            const originalLatLng = L.latLng(routePoints[dragPointIndex].y, routePoints[dragPointIndex].x);
            const originalMarkerIcon = L.divIcon({
                className: 'original-position-marker',
                html: `<div style="background: transparent; width: 16px; height: 16px; border: 2px dashed #f44336; border-radius: 50%; box-shadow: 0 0 4px rgba(255,0,0,0.5); display: flex; align-items: center; justify-content: center;"></div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });
            
            marker.originalPositionMarker = L.marker(originalLatLng, { 
                icon: originalMarkerIcon,
                zIndexOffset: 500
            }).addTo(map);
            
            // 创建连接原始位置和当前位置的虚线
            const currentLatLng = marker.getLatLng();
            marker.dragConnectionLine = L.polyline(
                [originalLatLng, currentLatLng],
                {
                    color: '#f44336',
                    weight: 2,
                    opacity: 0.7,
                    dashArray: '5, 10',
                    zIndexOffset: 400
                }
            ).addTo(map);
        }
    });
    
    marker.on('drag', function(e) {
        if (isDragging && dragPointIndex >= 0 && routePoints[dragPointIndex]) {
            const newPos = e.target.getLatLng();
            // 只更新x和y属性，保留其他属性（如originalX, originalY等）
            routePoints[dragPointIndex].x = newPos.lng;
            routePoints[dragPointIndex].y = newPos.lat;
            updateRoutePolyline();
            updateAllRectangles();
            
            // 更新虚线连接
            if (marker.dragConnectionLine && routePoints[dragPointIndex].originalX !== undefined && routePoints[dragPointIndex].originalY !== undefined) {
                const originalLatLng = L.latLng(routePoints[dragPointIndex].originalY, routePoints[dragPointIndex].originalX);
                marker.dragConnectionLine.setLatLngs([originalLatLng, newPos]);
            }
            
            // 计算世界坐标偏移量和距离
            if (routePoints[dragPointIndex].originalWorldX !== undefined && routePoints[dragPointIndex].originalWorldY !== undefined) {
                const originalWorldX = routePoints[dragPointIndex].originalWorldX;
                const originalWorldY = routePoints[dragPointIndex].originalWorldY;
                const newWorldCoords = pixelToWorldMath(newPos.lng, newPos.lat);
                const deltaX = newWorldCoords.x - originalWorldX;
                const deltaY = newWorldCoords.y - originalWorldY;
                const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                
                // 更新属性框中的偏移量和距离显示
                if (fixedStationInfoBox && fixedStationInfoBox.style.display === 'block') {
                    // 确保移动信息元素存在
                    let movementInfoDiv = fixedStationInfoBox.querySelector('#movement-info');
                    if (!movementInfoDiv) {
                        // 创建移动信息元素
                        movementInfoDiv = document.createElement('div');
                        movementInfoDiv.id = 'movement-info';
                        movementInfoDiv.style.cssText = `
                            margin-bottom: 15px;
                            padding: 10px;
                            background-color: #f0f9ff;
                            border-radius: 4px;
                            border-left: 4px solid #007cba;
                            font-size: 13px;
                        `;
                        
                        // 找到坐标容器元素并插入到其下方
                        const coordContainer = fixedStationInfoBox.querySelector('#stationCoordContainer');
                        if (coordContainer) {
                            coordContainer.parentNode.insertBefore(movementInfoDiv, coordContainer.nextSibling);
                        }
                    }
                    
                    // 确保移动信息框显示
                    movementInfoDiv.style.display = 'block';
                    
                    // 更新移动信息
                    movementInfoDiv.innerHTML = `
                        <strong>移动信息：</strong><br>
                        ΔX: ${deltaX.toFixed(3)} (m)<br>
                        ΔY: ${deltaY.toFixed(3)} (m)<br>
                        移动距离: ${distance.toFixed(3)} (m)
                    `;
                }
            }
        }
    });
    
    marker.on('dragend', function(e) {
        isDragging = false;
        const index = dragPointIndex;
        dragPointIndex = -1;
        
        // 移除原始位置标记和虚线连接
        if (marker.originalPositionMarker) {
            map.removeLayer(marker.originalPositionMarker);
            marker.originalPositionMarker = null;
        }
        if (marker.dragConnectionLine) {
            map.removeLayer(marker.dragConnectionLine);
            marker.dragConnectionLine = null;
        }
        
        // 移除原始位置属性
        if (index >= 0 && routePoints[index]) {
            delete routePoints[index].originalX;
            delete routePoints[index].originalY;
            delete routePoints[index].originalWorldX;
            delete routePoints[index].originalWorldY;
        }
        
        // 打印拖动结束后的当前点信息
        if (index >= 0 && routePoints[index]) {
            const point = routePoints[index];
            const pointName = point.stationData ? 
                (point.stationData.stationName || `站点${index + 1}`) : 
                `路线点${index + 1}`;
            
            console.log('\n=== 拖动结束 - 当前点信息 ===');
            console.log(`点名称: ${pointName}`);
            console.log(`在路线中的顺序: ${index + 1}`);
            console.log(`像素坐标: (${point.x.toFixed(6)}, ${point.y.toFixed(6)})`);
            if (point.stationData) {
                console.log(`站点ID: ${point.stationData.id || 'N/A'}`);
            }
            console.log('==========================\n');
        }
    });
    
    // 从全局设置获取默认值
    const globalSpeed = localStorage.getItem('globalRouteSpeed') || '0.2';
    const globalTurnMode = localStorage.getItem('globalTurnMode') || '0';
    const globalDirectionOption = localStorage.getItem('globalDirectionOption') || 'useAngle';
    const globalNavigationMode = localStorage.getItem('globalNavigationMode') || '1';
    const globalLanechange = localStorage.getItem('globalLanechange') || '0';
    const globalDefaultDirection = localStorage.getItem('globalDefaultDirection') || '0';
    
    // 计算指向下一个点的方向
    let directionToNext = globalDefaultDirection; // 默认使用全局默认方向
    if (insertIndex < routePoints.length) {
        // 如果不是在末尾插入，计算当前点到下一个点的方向
        const nextPoint = routePoints[insertIndex];
        const dx = nextPoint.x - px;
        const dy = nextPoint.y - py;
        // 计算角度并转换为度数
        let angle = Math.atan2(dy, dx) * (180 / Math.PI);
        // 保持原始角度值，不进行360度转换
        directionToNext = angle.toFixed(2).toString();
    } else if (insertIndex > 0) {
        // 如果是在末尾插入，计算上一个点到当前点的方向
        const prevPoint = routePoints[insertIndex - 1];
        const dx = px - prevPoint.x;
        const dy = py - prevPoint.y;
        // 计算角度并转换为度数
        let angle = Math.atan2(dy, dx) * (180 / Math.PI);
        // 保持原始角度值，不进行360度转换
        directionToNext = angle.toFixed(2).toString();
    }
    
    // 在指定位置插入标记和点
    routeMarkers.splice(insertIndex, 0, marker);
    routePoints.splice(insertIndex, 0, { 
        x: px, 
        y: py,
        stationData: {
            id: -1,
            action: globalNavigationMode,  // 使用全局导航模式
            area: "1",
            direction: directionToNext,  // 使用计算的方向
            speed: globalSpeed,  // 使用全局速度
            stopTime: "0",
            runmode: globalTurnMode,  // 使用全局转弯模式
            directionOption: 'useAngle',  // 强制使用角度模式，因为我们要计算方向
            navigationMode: globalNavigationMode,  // 使用全局导航模式
            lanechange: globalLanechange,  // 使用全局变道设置
            defaultDirection: directionToNext  // 使用计算的方向
        },
        isOriginalPoint: false
    });
    
    // 自动将默认站点数据保存到临时对象
    const worldCoords = pixelToWorldMath(px, py);
    
    // 调整临时对象中的索引
    const newTempData = {};
    Object.keys(tempRoutePointsData).forEach(key => {
        const keyIndex = parseInt(key);
        if (keyIndex < insertIndex) {
            // 深拷贝前面的数据
            newTempData[keyIndex] = JSON.parse(JSON.stringify(tempRoutePointsData[keyIndex]));
        } else {
            // 深拷贝后面的数据，并将索引+1
            newTempData[keyIndex + 1] = JSON.parse(JSON.stringify(tempRoutePointsData[keyIndex]));
        }
    });
    
    // 添加新点的数据
    // 创建新点数据对象，默认使用全局设置
    const newPointData = {
        id: String(-1),
        routeId: document.getElementById("routeSelect").value || "",
        direction: localStorage.getItem('globalDefaultDirection') || "0",
        action: (localStorage.getItem('globalNavigationMode') || "1"),
        area: localStorage.getItem('globalObstacleLevel') || "1",
        lanechange: localStorage.getItem('globalLanechange') || "0",
        speed: localStorage.getItem('globalRouteSpeed') || "0.2",
        stop: "0",
        position: "1",
        runmode: localStorage.getItem('globalTurnMode') || "0",
        x: worldCoords.x.toFixed(5),
        y: worldCoords.y.toFixed(5)
    };
    
    newTempData[insertIndex] = newPointData;
    
    tempRoutePointsData = newTempData;
    
    // 更新路线线条
    updateRoutePolyline();
    
    // 更新所有矩形框
    updateAllRectangles();
    
    // 更新路线状态显示
    updateRouteStatus();
    
    // 替换bindPopup为点击事件，使用固定位置属性框
    marker.on('click', function(e) {
        const markerIndex = routeMarkers.indexOf(marker);
        if (markerIndex !== -1) {
            // 获取世界坐标
            const worldCoords = pixelToWorldMath(px, py);
            // 尝试从临时对象加载该点的数据
            let stationData = null;
            if (tempRoutePointsData && tempRoutePointsData[markerIndex]) {
                stationData = tempRoutePointsData[markerIndex];
            }
            
            // 初始化固定位置属性框
            if (!fixedStationInfoBox) {
                initFixedStationInfoBox();
            }
            
            // 保存当前选中的站点信息
            currentStationMarker = marker;
            currentStationIndex = markerIndex;
            
            // 更新坐标输入框
            const coordXInput = fixedStationInfoBox.querySelector('#station-coord-x');
            const coordYInput = fixedStationInfoBox.querySelector('#station-coord-y');
            const nameDisplay = fixedStationInfoBox.querySelector('#stationNameDisplay');
            if (coordXInput) coordXInput.value = worldCoords.x.toFixed(3);
            if (coordYInput) coordYInput.value = worldCoords.y.toFixed(3);
            if (nameDisplay) nameDisplay.textContent = `路线点 ${markerIndex + 1}`;
            
            // 设置表单值 - 优先使用临时对象中的数据，如果没有则使用默认值
            const actionSelect = fixedStationInfoBox.querySelector('#station-action');
            if (actionSelect) actionSelect.value = stationData ? stationData.action : '1';
            
            const areaSelect = fixedStationInfoBox.querySelector('#station-area');
            if (areaSelect) areaSelect.value = stationData ? stationData.area : '1';
            
            const avoidSelect = fixedStationInfoBox.querySelector('#station-avoid');
            if (avoidSelect) avoidSelect.value = stationData ? stationData.lanechange : '0';
            
            const directionInput = fixedStationInfoBox.querySelector('#station-direction');
            if (directionInput) directionInput.value = stationData ? stationData.direction : '0';
            
            const speedInput = fixedStationInfoBox.querySelector('#station-speed');
            if (speedInput) speedInput.value = stationData ? stationData.speed : '0.2';

            const workDurationInput = fixedStationInfoBox.querySelector('#station-work-duration');
            if (workDurationInput) workDurationInput.value = stationData && stationData.stopTime != null
                ? stationData.stopTime
                : '0';
            
            // 设置转向模式单选按钮的值
            const turnModeSelf = fixedStationInfoBox.querySelector('#turnModeSelf');
            const turnModeContinuous = fixedStationInfoBox.querySelector('#turnModeContinuous');
            if (turnModeSelf && turnModeContinuous) {
                const runmodeValue = stationData ? stationData.runmode : (localStorage.getItem('globalTurnMode') || "0");
                if (runmodeValue === "1") {
                    turnModeSelf.checked = true;
                    turnModeContinuous.checked = false;
                } else {
                    turnModeSelf.checked = false;
                    turnModeContinuous.checked = true;
                }
            }
            
            // 设置是否停车单选按钮的值
            const isStopSelect = fixedStationInfoBox.querySelector('#isStopSelect');
            if (isStopSelect) {
                const stopValue = stationData ? stationData.stop : "0";
                isStopSelect.value = stopValue;
            }
            
            // 显示属性框
            fixedStationInfoBox.style.display = 'block';
        }
    });
}

// 更新所有矩形框
function updateAllRectangles() {
    // 清除所有现有矩形框
    routeRectangles.forEach(rect => {
        map.removeLayer(rect);
    });
    routeRectangles = [];
    
    // 重新创建矩形框
    for (let i = 0; i < routePoints.length - 1; i++) {
        const rect = createDraggableRectangleBetweenPoints(routePoints[i], routePoints[i + 1], i);
        routeRectangles.push(rect);
    }
}
// 开始路线创建模式
function startRouteCreation() {
    if (!mapData.imageUrl) {
        cocoMessage.error('请先加载地图');
        return;
    }
    
    // 退出其他模式
    if (robotMarker) {
        map.removeLayer(robotMarker);
        robotMarker = null;
    }
    if (pathPolyline) {
        map.removeLayer(pathPolyline);
        pathPolyline = null;
    }
    
    // 清除现有路线
    clearRoute();
const select = document.getElementById('routeSelect');
select.value = ''; // 清空值
select.selectedIndex = 0; // 取消所有选项的选中

    // 重置编辑模式
    isEditMode = false;
    window.isEditMode = false;
    currentEditRouteInfo = null;
    isRouteEditMode = false;
    window.isRouteEditMode = false;
    
    // 重置闭合路线模式
    isClosedRouteMode = false;
    
    isRouteMode = true;
    window.isRouteMode = isRouteMode;
    
    // 切换按钮状态为取消新增
    const createRouteBtn = document.getElementById('createRoute');
    if (createRouteBtn) {
        createRouteBtn.textContent = '取消新增';
        createRouteBtn.onclick = function() {
            cancelNewRoute();
        };
        createRouteBtn.classList.remove('btn-primary-action');
        createRouteBtn.classList.add('btn-warning');
    }
    
    // 添加地图点击事件监听器
    map.on('click', onRouteMapClick);
    // indicator.className = 'route-mode-indicator';
    // indicator.textContent = '路线创建模式 - 点击地图添加路线点';
    // indicator.id = 'routeModeIndicator';
    // document.body.appendChild(indicator);
}

// 取消新增路线（退出路线创建模式并清屏）
function cancelNewRoute() {
    // 退出路线模式
    isRouteMode = false;
    window.isRouteMode = false;
    isClosedRouteMode = false;
    
    // 重置编辑模式状态
    isEditMode = false;
    window.isEditMode = false;
    isRouteEditMode = false;
    window.isRouteEditMode = false;
    
    // 移除地图点击事件监听器
    map.off('click', onRouteMapClick);
    
    // 移除路线模式指示器
    const indicator = document.getElementById('routeModeIndicator');
    if (indicator) {
        indicator.remove();
    }
    
    // 清除所有路线相关的标记、线条和矩形框
    clearRoute();
    
    // 重置路线点数组
    routePoints = [];
    originalRoutePoints = [];
    
    // 清空路线标记数组
    routeMarkers.forEach(marker => {
        map.removeLayer(marker);
    });
    routeMarkers = [];
    
    // 清空路线矩形框数组
    routeRectangles.forEach(rect => {
        map.removeLayer(rect);
    });
    routeRectangles = [];
    
    // 重新设置下拉框为未选择状态
    const select = document.getElementById('routeSelect');
    if (select) {
        select.value = '';
        select.selectedIndex = 0;
    }
    
    // 将按钮状态恢复为新增路线
    const createRouteBtn = document.getElementById('createRoute');
    if (createRouteBtn) {
        createRouteBtn.textContent = '新增路线';
        createRouteBtn.onclick = function() {
            startRouteCreation();
        };
        createRouteBtn.classList.remove('btn-warning');
        createRouteBtn.classList.add('btn-primary-action');
    }
    
    cocoMessage.info('已取消新增路线');
}

// 开始闭合路线创建模式
function startClosedRouteCreation() {
    // 如果已经在闭合路线模式下，则关闭该模式
    document.getElementById('createClosedRoute').textContent = '规划完成';
    if (isClosedRouteMode && isRouteMode) {
        // 打印路线信息
        console.log('===== 闭合路线世界坐标 =====');
        if (routePoints.length > 0) {
            routePoints.forEach((point, index) => {
                const worldCoords = pixelToWorldMath(point.x, point.y);
            });
        } else {
            console.log('当前没有路线点');
        }
        
        // 关闭闭合路线模式
        document.getElementById('createClosedRoute').textContent = '辅助规划';
        isClosedRouteMode = false;
        isRouteMode = false;
        window.isRouteMode = isRouteMode;
        
        // 移除地图点击事件监听器
        map.off('click', onRouteMapClick);
        
        // 移除路线模式指示器
        const indicator = document.getElementById('routeModeIndicator');
        if (indicator) {
            document.body.removeChild(indicator);
        }
        
        return;
    }
    
    if (!mapData.imageUrl) {
        cocoMessage.error('请先加载地图');
        return;
    }
    
    // 退出其他模式
    if (robotMarker) {
        map.removeLayer(robotMarker);
        robotMarker = null;
    }
    if (pathPolyline) {
        map.removeLayer(pathPolyline);
        pathPolyline = null;
    }
    
    // 清除现有路线
    clearRoute();
    
    // 重置编辑模式
    isEditMode = false;
    currentEditRouteInfo = null;
    
    isRouteMode = true;
    window.isRouteMode = isRouteMode;
    isClosedRouteMode = true; // 设置为闭合路线模式
    
    // 添加地图点击事件监听器
    map.on('click', onRouteMapClick);
    
    // 显示路线创建模式提示
    const indicator = document.createElement('div');
    indicator.className = 'route-mode-indicator';
    indicator.textContent = '闭合路线创建模式 - 点击地图添加路线点（路线将自动闭合）';
    indicator.id = 'routeModeIndicator';
    document.body.appendChild(indicator);
}

// 路线模式下的地图点击事件
function onRouteMapClick(e) {
    if (!isRouteMode) return;
    
    const latlng = e.latlng;
    const px = latlng.lng;
    const py = latlng.lat;
    
    // 添加路线点
    addRoutePoint(px, py);
}



// 添加路线点
function addRoutePoint(px, py) {
    // 创建路线点标记
    const pointIcon = L.divIcon({
        className: 'route-point-marker',
        html: '<div style="background: #007cba; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5); cursor: pointer;"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });
    
    const marker = L.marker([py, px], { icon: pointIcon, draggable: true }).addTo(map);
    
    // 添加拖拽事件
    marker.on('dragstart', function(e) {
        isDragging = true;
        dragPointIndex = routeMarkers.indexOf(marker);
        // 保存原始位置用于计算偏移量
        if (routePoints[dragPointIndex]) {
            // 保存像素坐标用于更新路线
            routePoints[dragPointIndex].originalX = routePoints[dragPointIndex].x;
            routePoints[dragPointIndex].originalY = routePoints[dragPointIndex].y;
            
            // 保存原始世界坐标用于计算偏移量
            const originalWorldCoords = pixelToWorldMath(routePoints[dragPointIndex].x, routePoints[dragPointIndex].y);
            routePoints[dragPointIndex].originalWorldX = originalWorldCoords.x;
            routePoints[dragPointIndex].originalWorldY = originalWorldCoords.y;
            
            // 创建原始位置的虚线标记
            const originalLatLng = L.latLng(routePoints[dragPointIndex].y, routePoints[dragPointIndex].x);
            const originalMarkerIcon = L.divIcon({
                className: 'original-position-marker',
                html: `<div style="background: transparent; width: 16px; height: 16px; border: 2px dashed #f44336; border-radius: 50%; box-shadow: 0 0 4px rgba(255,0,0,0.5); display: flex; align-items: center; justify-content: center;"></div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });
            
            marker.originalPositionMarker = L.marker(originalLatLng, { 
                icon: originalMarkerIcon,
                zIndexOffset: 500
            }).addTo(map);
            
            // 创建连接原始位置和当前位置的虚线
            const currentLatLng = marker.getLatLng();
            marker.dragConnectionLine = L.polyline(
                [originalLatLng, currentLatLng],
                {
                    color: '#f44336',
                    weight: 2,
                    opacity: 0.7,
                    dashArray: '5, 10',
                    zIndexOffset: 400
                }
            ).addTo(map);
        }
    });
    
    marker.on('drag', function(e) {
        if (isDragging && dragPointIndex >= 0 && routePoints[dragPointIndex]) {
            const newPos = e.target.getLatLng();
            // 只更新x和y属性，保留其他属性（如originalX, originalY等）
            routePoints[dragPointIndex].x = newPos.lng;
            routePoints[dragPointIndex].y = newPos.lat;
            updateRoutePolyline();
            updateAllRectangles();
            
            // 更新虚线连接
            if (marker.dragConnectionLine && routePoints[dragPointIndex].originalX !== undefined && routePoints[dragPointIndex].originalY !== undefined) {
                const originalLatLng = L.latLng(routePoints[dragPointIndex].originalY, routePoints[dragPointIndex].originalX);
                marker.dragConnectionLine.setLatLngs([originalLatLng, newPos]);
            }
            
            // 计算世界坐标偏移量和距离
            if (routePoints[dragPointIndex].originalWorldX !== undefined && routePoints[dragPointIndex].originalWorldY !== undefined) {
                const originalWorldX = routePoints[dragPointIndex].originalWorldX;
                const originalWorldY = routePoints[dragPointIndex].originalWorldY;
                const newWorldCoords = pixelToWorldMath(newPos.lng, newPos.lat);
                const deltaX = newWorldCoords.x - originalWorldX;
                const deltaY = newWorldCoords.y - originalWorldY;
                const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                
                // 更新属性框中的偏移量和距离显示
                if (fixedStationInfoBox && fixedStationInfoBox.style.display === 'block') {
                    // 确保移动信息元素存在
                    let movementInfoDiv = fixedStationInfoBox.querySelector('#movement-info');
                    if (!movementInfoDiv) {
                        // 创建移动信息元素
                        movementInfoDiv = document.createElement('div');
                        movementInfoDiv.id = 'movement-info';
                        movementInfoDiv.style.cssText = `
                            margin-bottom: 15px;
                            padding: 10px;
                            background-color: #f0f9ff;
                            border-radius: 4px;
                            border-left: 4px solid #007cba;
                            font-size: 13px;
                        `;
                        
                        // 找到坐标容器元素并插入到其下方
                        const coordContainer = fixedStationInfoBox.querySelector('#stationCoordContainer');
                        if (coordContainer) {
                            coordContainer.parentNode.insertBefore(movementInfoDiv, coordContainer.nextSibling);
                        }
                    }
                    
                    // 确保移动信息框显示
                    movementInfoDiv.style.display = 'block';
                    
                    // 更新移动信息
                    movementInfoDiv.innerHTML = `
                        <strong>移动信息：</strong><br>
                        ΔX: ${deltaX.toFixed(3)} (m)<br>
                        ΔY: ${deltaY.toFixed(3)} (m)<br>
                        移动距离: ${distance.toFixed(3)} (m)
                    `;
                }
            }
        }
    });
    
    marker.on('dragend', function(e) {
        isDragging = false;
        const index = dragPointIndex;
        dragPointIndex = -1;
        
        // 移除原始位置标记和虚线连接
        if (marker.originalPositionMarker) {
            map.removeLayer(marker.originalPositionMarker);
            marker.originalPositionMarker = null;
        }
        if (marker.dragConnectionLine) {
            map.removeLayer(marker.dragConnectionLine);
            marker.dragConnectionLine = null;
        }
        
        // 移除原始位置属性
        if (index >= 0 && routePoints[index]) {
            delete routePoints[index].originalX;
            delete routePoints[index].originalY;
            delete routePoints[index].originalWorldX;
            delete routePoints[index].originalWorldY;
        }
        
        // 拖拽结束后，同步更新tempRoutePointsData中的坐标
        const markerIndex = routeMarkers.indexOf(marker);
        if (markerIndex !== -1 && tempRoutePointsData[markerIndex]) {
            const newPos = e.target.getLatLng();
            const worldCoords = pixelToWorldMath(newPos.lng, newPos.lat);
            tempRoutePointsData[markerIndex].x = worldCoords.x.toFixed(5);
            tempRoutePointsData[markerIndex].y = worldCoords.y.toFixed(5);
        }
        
        // 打印拖动结束后的当前点信息
        if (index >= 0 && routePoints[index]) {
            const point = routePoints[index];
            const pointName = point.stationData ? 
                (point.stationData.stationName || `站点${index + 1}`) : 
                `路线点${index + 1}`;
            
            console.log(`点名称: ${pointName}`);
            console.log(`在路线中的顺序: ${index + 1}`);
            console.log(`像素坐标: (${point.x.toFixed(6)}, ${point.y.toFixed(6)})`);
            if (point.stationData) {
                console.log(`站点ID: ${point.stationData.id || 'N/A'}`);
            }
            console.log('==========================\n');
        }
    });
    
    routeMarkers.push(marker);
    const pointIndex = routePoints.length;
    
    // 从全局设置获取默认值
    const globalSpeed = localStorage.getItem('globalRouteSpeed') || '0.2';
    const globalTurnMode = localStorage.getItem('globalTurnMode') || '0';
    const globalDirectionOption = localStorage.getItem('globalDirectionOption') || 'useAngle';
    const globalNavigationMode = localStorage.getItem('globalNavigationMode') || '1';
    const globalLanechange = localStorage.getItem('globalLanechange') || '0';
    const globalDefaultDirection = localStorage.getItem('globalDefaultDirection') || '0';
    
    // 计算指向下一个点的方向（如果存在）
    let directionToNext = globalDefaultDirection; // 默认使用全局默认方向
    if (routePoints.length > 0) {
        // 如果已有路线点，暂时无法确定下一个点的方向，因为这是添加到末尾的点
        // 对于中间的点，方向会在addRoutePointAtPosition中计算
        // 这里保持使用全局默认方向
        directionToNext = globalDefaultDirection;
    }
    
    routePoints.push({ 
        x: px, 
        y: py,
        stationData: {
            id: -1,  // 新点没有原始站点ID
            action: globalNavigationMode,  // 使用全局导航模式
            area: "1",
            direction: directionToNext,  // 使用计算的方向或全局默认方向
            speed: globalSpeed,  // 使用全局速度
            stopTime: "0",
            runmode: globalTurnMode,  // 使用全局转弯模式
            directionOption: 'useAngle',  // 强制使用角度模式，因为我们要计算方向
            navigationMode: globalNavigationMode,  // 使用全局导航模式
            lanechange: globalLanechange,  // 使用全局变道设置
            defaultDirection: directionToNext  // 使用计算的方向或全局默认方向
        },
        isOriginalPoint: false  // 标识为新添加的点
    });
    
    // 自动将默认站点数据保存到临时对象
    const worldCoords = pixelToWorldMath(px, py);
    tempRoutePointsData[pointIndex] = {
        id: String(-1),
        routeId: document.getElementById("routeSelect").value || "",
        direction: localStorage.getItem('globalDefaultDirection') || "0",
        action: (localStorage.getItem('globalNavigationMode') || "1"),
        area: localStorage.getItem('globalObstacleLevel') || "1",
        lanechange:localStorage.getItem('globalLanechange') || "0",
        speed:localStorage.getItem('globalRouteSpeed') || "0.2",
        stopTime: "0",
        stop:"0",
        position:"1",
        runmode:localStorage.getItem('globalTurnMode') || "0",
        x: worldCoords.x.toFixed(5),
        y: worldCoords.y.toFixed(5)
    };
    
    // 更新路线线条
    updateRoutePolyline();
    
    // 更新所有矩形框
    updateAllRectangles();
    
    // 更新路线状态显示
    updateRouteStatus();
    
    // 替换bindPopup为点击事件，使用固定位置属性框
    marker.on('click', function(e) {
        const markerIndex = routeMarkers.indexOf(marker);
        if (markerIndex !== -1) {
            // 获取世界坐标
            const worldCoords = pixelToWorldMath(px, py);
            
            // 尝试从临时对象加载该点的数据
            let stationData = null;
            if (tempRoutePointsData && tempRoutePointsData[markerIndex]) {
                stationData = tempRoutePointsData[markerIndex];
            }
            
            // 初始化固定位置属性框
            if (!fixedStationInfoBox) {
                initFixedStationInfoBox();
            }
            
            // 保存当前选中的站点信息
            currentStationMarker = marker;
            currentStationIndex = markerIndex;
            
            // 更新坐标输入框
            const coordXInput = fixedStationInfoBox.querySelector('#station-coord-x');
            const coordYInput = fixedStationInfoBox.querySelector('#station-coord-y');
            const nameDisplay = fixedStationInfoBox.querySelector('#stationNameDisplay');
            if (coordXInput) coordXInput.value = worldCoords.x.toFixed(3);
            if (coordYInput) coordYInput.value = worldCoords.y.toFixed(3);
            if (nameDisplay) nameDisplay.textContent = `路线点 ${markerIndex + 1}`;
            
            // 设置表单值 - 优先使用临时对象中的数据，如果没有则使用默认值
            const actionSelect = fixedStationInfoBox.querySelector('#station-action');
            if (actionSelect) actionSelect.value = stationData ? stationData.action : '1';
            
            const areaSelect = fixedStationInfoBox.querySelector('#station-area');
            if (areaSelect) areaSelect.value = stationData ? stationData.area : '1';
            
            const avoidSelect = fixedStationInfoBox.querySelector('#station-avoid');
            if (avoidSelect) avoidSelect.value = stationData ? stationData.lanechange : '0';
            
            const directionInput = fixedStationInfoBox.querySelector('#station-direction');
            if (directionInput) directionInput.value = stationData ? stationData.direction : '0';
            
            const speedInput = fixedStationInfoBox.querySelector('#station-speed');
            if (speedInput) speedInput.value = stationData ? stationData.speed : '0.2';

            const workDurationInput = fixedStationInfoBox.querySelector('#station-work-duration');
            if (workDurationInput) workDurationInput.value = stationData && stationData.stopTime != null
                ? stationData.stopTime
                : '0';
            
            // 设置转向模式单选按钮的值
            const turnModeSelf = fixedStationInfoBox.querySelector('#turnModeSelf');
            const turnModeContinuous = fixedStationInfoBox.querySelector('#turnModeContinuous');
            if (turnModeSelf && turnModeContinuous) {
                const runmodeValue = stationData ? stationData.runmode : (localStorage.getItem('globalTurnMode') || "0");
                if (runmodeValue === "1") {
                    turnModeSelf.checked = true;
                    turnModeContinuous.checked = false;
                } else {
                    turnModeSelf.checked = false;
                    turnModeContinuous.checked = true;
                }
            }
            
            // 设置是否停车单选按钮的值
            const isStopSelect = fixedStationInfoBox.querySelector('#isStopSelect');
            if (isStopSelect) {
                const stopValue = stationData ? stationData.stop : "0";
                isStopSelect.value = stopValue;
            }
            
            // 显示属性框
            fixedStationInfoBox.style.display = 'block';
        }
    });
}

// 移除路线点
function removeRoutePoint(index) {
    if (index < 0 || index >= routeMarkers.length) return;
    
    // 移除标记
    map.removeLayer(routeMarkers[index]);
    routeMarkers.splice(index, 1);
    routePoints.splice(index, 1);
    
    // 从临时对象中移除对应的数据，并调整索引
    const newTempData = {};
    Object.keys(tempRoutePointsData).forEach(key => {
        const keyIndex = parseInt(key);
        if (keyIndex < index) {
            newTempData[keyIndex] = tempRoutePointsData[keyIndex];
        } else if (keyIndex > index) {
            newTempData[keyIndex - 1] = tempRoutePointsData[keyIndex];
        }
    });
    tempRoutePointsData = newTempData;
    
    // 更新路线线条
    updateRoutePolyline();
    
    // 更新所有矩形框
    updateAllRectangles();
    
    // 更新路线状态显示
    updateRouteStatus();
}

// 保存全局设置功能
document.addEventListener('DOMContentLoaded',  function() {
    // 获取保存设置按钮
    const saveGlobalSettingsBtn = document.getElementById('saveGlobalSettings');
    const updateMessage = {};
    if (saveGlobalSettingsBtn) {
        saveGlobalSettingsBtn.addEventListener('click', function() {
            // 获取全局设置表单中的值
            const globalRouteSpeed = document.getElementById('globalRouteSpeed').value;
            const globalDefaultDirection = document.querySelector('input[name="directionOption"]:checked').value;
            const globalDefaultDirectionAngle = document.getElementById('globalDefaultDirection').value;
            const globalNavigationMode = document.getElementById('globalNavigationMode').value;
            const globalLanechange = document.getElementById('globalLanechange').value;
            const turnModeSelf = document.getElementById('turnModeSelf').checked;
            
            // 保存全局设置到localStorage
            localStorage.setItem('globalRouteSpeed', globalRouteSpeed);
            localStorage.setItem('globalDefaultDirection', globalDefaultDirection);
            localStorage.setItem('globalDefaultDirectionAngle', globalDefaultDirectionAngle);
            localStorage.setItem('globalNavigationMode', globalNavigationMode);
            localStorage.setItem('globalLanechange', globalLanechange);
            localStorage.setItem('globalTurnMode', turnModeSelf ? '1' : '0');
            
            // 检查是否需要更新当前路线设置
            const updateRouteName = document.getElementById('updateRouteName').checked;
            const updateSpeed = document.getElementById('updateSpeed').checked;
            const updateDirection = document.getElementById('updateDirection').checked;
            const updateNavigationMode = document.getElementById('updateNavigationMode').checked;
            const updateTurnMode = document.getElementById('updateTurnMode').checked;
            const updateRouteAvoid = document.getElementById('updateRouteAvoid').checked;
            
            if  (currentRouteItem && (updateRouteName || updateSpeed || updateDirection || updateNavigationMode || updateTurnMode || updateRouteAvoid)) {
                const selectedRouteId = document.getElementById('routeSelect').value;
                const currentRouteName = document.getElementById('currentRouteName').value;
                const currentRouteSpeed = document.getElementById('currentRouteSpeed').value;
                const currentDirectionOption = document.querySelector('input[name="currentDirectionOption"]:checked').value;
                const currentRouteDirection = document.getElementById('currentRouteDirection').value;
                const currentRouteNavigationMode = document.getElementById('currentRouteNavigationMode').value;
                const currentTurnMode = document.querySelector('input[name="currentTurnMode"]:checked').value;
                const currentRouteAvoid = document.getElementById('currentRouteAvoid').value;
                // 更新当前路线数据
                if (updateRouteName && currentRouteName) {
                    currentRouteItem.name = currentRouteName;
                    const params = {}
                    params.routeName = currentRouteName;
                    params.id = selectedRouteId;
                    axiosClient.post("route/updateRoute", params)
                    .then(response => {
                        // 处理成功响应
                        console.log('路线更新成功', response.data);
                        // 刷新路线选择框，确保显示最新的路线名称
                        refreshRouteSelect(selectedRouteId);
                        // 重新加载路线，确保站点属性框显示最新数据
                        loadRoute();
                    })
                    .catch(error => {
                        // 处理错误
                        console.error('路线更新失败', error);
                        cocoMessage.error('路线更新失败');
                    });
                }
                if (updateSpeed) {
                    currentRouteItem.speed = currentRouteSpeed;
                    updateMessage.speed = currentRouteSpeed;
                }
                if (updateDirection) {
                    currentRouteItem.direction = currentDirectionOption;
                    if (currentDirectionOption === 'useAngle') {
                        currentRouteItem.directionAngle = currentRouteDirection;
                        updateMessage.direction = currentRouteDirection;
                    }else if(currentDirectionOption === 'useNextPoint'){
                        updateMessage.direction = 360;
                    }else if(currentDirectionOption === 'keepDirection'){
                        updateMessage.angle = -360;
                    }
                }
                
                if (updateNavigationMode) {
                    currentRouteItem.navigationMode = currentRouteNavigationMode;
                }
                
                if (updateTurnMode) {
                    currentRouteItem.turnMode = currentTurnMode;
                    updateMessage.runmode = currentTurnMode;
                }
                
                if (updateRouteAvoid) {
                    // 更新当前路线的变道模式
                    updateMessage.lanechange = currentRouteAvoid;
                    // 同时更新station-avoid元素的值，确保全局设置和当前路线设置一致
                    const stationAvoidElement = document.getElementById('station-avoid');
                    if (stationAvoidElement) {
                        stationAvoidElement.value = currentRouteAvoid;
                    }
                }
                if(selectedRouteId){
                axiosClient.post(`route/updateAllRouteDetails/${selectedRouteId}`, updateMessage)
                        .then(response => {
                            // 处理成功响应
                            console.log('路线更新成功', response.data);
                            // 刷新路线选择框，确保显示最新的路线信息
                            refreshRouteSelect(selectedRouteId);
                            // 重新加载路线，确保站点属性框显示最新数据
                            loadRoute();
                        })
                        .catch(error => {
                            // 处理错误
                            console.error('路线更新失败', error);
                            cocoMessage.error('路线更新失败');
                        });
                          // 更新路线列表中的显示
                updateRouteItemInList(currentRouteItem);
                }
  
            }
            
            // 显示保存成功消息
            cocoMessage.success('设置已保存');
            
            // 关闭模态框
            const modal = bootstrap.Modal.getInstance(document.getElementById('globalSettingsModal'));
            if (modal) {
                modal.hide();
            }
        });
    }
    
    // 获取打开全局设置模态框的按钮
    const openGlobalSettingsBtn = document.getElementById('openGlobalSettings');
    if (openGlobalSettingsBtn) {
        openGlobalSettingsBtn.addEventListener('click', function() {
            // 从localStorage加载全局设置
            const globalRouteSpeed = localStorage.getItem('globalRouteSpeed') || '0.2';
            const globalDefaultDirection = localStorage.getItem('globalDefaultDirection') || 'useAngle';
            const globalDefaultDirectionAngle = localStorage.getItem('globalDefaultDirectionAngle') || '0';
            const globalNavigationMode = localStorage.getItem('globalNavigationMode') || '1';
            const globalLanechange = localStorage.getItem('globalLanechange') || '0';
            const globalTurnMode = localStorage.getItem('globalTurnMode') || '0';
            
            // 设置表单值
            document.getElementById('globalRouteSpeed').value = globalRouteSpeed;
            
            // 设置方向选项
            const directionRadios = document.querySelectorAll('input[name="directionOption"]');
            directionRadios.forEach(radio => {
                radio.checked = radio.value === globalDefaultDirection;
            });
            
            document.getElementById('globalDefaultDirection').value = globalDefaultDirectionAngle;
            document.getElementById('globalNavigationMode').value = globalNavigationMode;
            document.getElementById('globalLanechange').value = globalLanechange;
            
            // 设置转弯模式
            document.getElementById('turnModeSelf').checked = globalTurnMode === '1';
            document.getElementById('turnModeContinuous').checked = globalTurnMode !== '1';
            
            // 如果有当前选中的路线，显示当前路线设置
            if (currentRouteItem) {
                document.getElementById('current-route-settings-container').style.display = 'block';
                document.getElementById('currentRouteName').value = currentRouteItem.name || '';
                document.getElementById('currentRouteSpeed').value = currentRouteItem.speed || globalRouteSpeed;
                
                // 设置当前路线方向
                const currentDirectionRadios = document.querySelectorAll('input[name="currentDirectionOption"]');
                currentDirectionRadios.forEach(radio => {
                    radio.checked = radio.value === (currentRouteItem.direction || globalDefaultDirection);
                });
                
                document.getElementById('currentRouteDirection').value = currentRouteItem.directionAngle || globalDefaultDirectionAngle;
                document.getElementById('currentRouteNavigationMode').value = currentRouteItem.navigationMode || globalNavigationMode;
                
                // 设置当前路线的转弯模式
                const currentTurnMode = currentRouteItem.turnMode || globalTurnMode;
                document.getElementById('currentTurnModeSelf').checked = currentTurnMode === '1';
                document.getElementById('currentTurnModeContinuous').checked = currentTurnMode !== '1';
            } else {
                document.getElementById('current-route-settings-container').style.display = 'none';
            }
        });
    }
});

// 更新路线列表中的项目显示
function updateRouteItemInList(routeItem) {
    if (!routeItem) return;
    
    // 查找路线列表中的对应项
    const routeItems = document.querySelectorAll('.route-item');
    routeItems.forEach(item => {
        const itemId = item.getAttribute('data-route-id');
        if (itemId === routeItem.id) {
            // 更新路线名称显示
            const routeNameElement = item.querySelector('.route-name');
            if (routeNameElement) {
                routeNameElement.textContent = routeItem.name;
            }
            
            // 更新路线速度显示
            const routeSpeedElement = item.querySelector('.route-speed');
            if (routeSpeedElement) {
                routeSpeedElement.textContent = `速度: ${routeItem.speed} m/s`;
            }
        }
    });
}

// 从站点启动箭头绘制功能
function startArrowDrawingFromStation(stationIndex) {
    
    if (stationIndex < 0 || stationIndex >= routePoints.length) {
        cocoMessage.error(`无效的站点索引: ${stationIndex}，有效范围: 0-${routePoints.length-1}`);
        return;
    }
    
    // 记录是否在新增路线模式
    const wasInRouteMode = isRouteMode;
    
    // 如果当前在新增路线模式，先退出该模式以避免冲突
    if (isRouteMode) {
        // 退出新增路线模式
        isRouteMode = false;
        window.isRouteMode = false;
        
        // 移除地图点击事件监听器
        map.off('click', onRouteMapClick);
        
        // 移除路线模式指示器
        const indicator = document.getElementById('routeModeIndicator');
        if (indicator) {
            document.body.removeChild(indicator);
        }
        
        console.log('已退出新增路线模式，准备启动箭头绘制模式');
    }
    
    // 获取站点的世界坐标
    const stationPoint = routePoints[stationIndex];
    
    const worldCoords = pixelToWorldMath(stationPoint.x, stationPoint.y);
    
    // 创建箭头绘制器实例
    if (!window.arrowDrawer) {
        window.arrowDrawer = new ArrowDrawer(map);
    } else {
    }

    // 站点箭头不允许触发定位接口，重置currentArrow
    window.currentArrow = null;

    // 启动箭头绘制模式
    try {
        window.arrowDrawer.startDrawing();
    } catch (error) {
        cocoMessage.error('启动箭头绘制模式失败');
        return;
    }
    
    // 设置起点为当前站点（模拟第一次点击）
    const startPoint = L.latLng(stationPoint.y, stationPoint.x);
    window.arrowDrawer.startPoint = startPoint;
    
    // 添加起点标记
    try {
        window.arrowDrawer.startMarker = L.circleMarker(startPoint, {
            radius: 6,
            fillColor: '#ff7800',
            color: '#000',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(map);
    } catch (error) {
    }
    
    // 显示提示信息
    cocoMessage.info('请在地图上点击设置箭头方向');
    
    // 设置箭头绘制完成后的回调函数，用于恢复新增模式
    if (wasInRouteMode && window.arrowDrawer) {
        const originalFinishArrow = window.arrowDrawer.finishArrow;
        window.arrowDrawer.finishArrow = function(endPoint) {
            // 先执行原来的finishArrow逻辑
            originalFinishArrow.call(this, endPoint);
            
            // 延迟恢复新增模式，确保箭头绘制完全完成
            setTimeout(() => {
                // 恢复新增路线模式
                isRouteMode = true;
                window.isRouteMode = true;
                
                // 重新添加地图点击事件监听器
                map.on('click', onRouteMapClick);
                
                // 重新显示路线模式指示器
                const indicator = document.createElement('div');
                indicator.id = 'routeModeIndicator';
                indicator.className = 'route-mode-indicator';
                indicator.innerHTML = `
                    <div style="background: rgba(0, 124, 186, 0.9); color: white; padding: 8px 12px; border-radius: 4px; font-size: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
                        <strong>新增路线模式</strong><br>
                        <small>点击地图添加路线点</small>
                    </div>
                `;
                indicator.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 1000; animation: fadeIn 0.3s ease-in;';
                document.body.appendChild(indicator);
                
                console.log('箭头绘制完成，已恢复新增路线模式');
                cocoMessage.info('箭头绘制完成，已恢复新增路线模式');
                
                // 恢复原始finishArrow函数
                window.arrowDrawer.finishArrow = originalFinishArrow;
            }, 100);
        };
    }
}

// 更新路线线条（支持分段独立着色、点击修改速度及速度徽章）
function updateRoutePolyline() {
    // 移除现有主线条
    if (routePolyline) {
        map.removeLayer(routePolyline);
        routePolyline = null;
    }

    // 移除现有分段线条
    if (routeSegmentLayers && routeSegmentLayers.length > 0) {
        routeSegmentLayers.forEach(layer => {
            try { map.removeLayer(layer); } catch (e) {}
        });
        routeSegmentLayers = [];
    }

    // 移除现有速度徽章
    if (routeSpeedBadgeMarkers && routeSpeedBadgeMarkers.length > 0) {
        routeSpeedBadgeMarkers.forEach(marker => {
            try { map.removeLayer(marker); } catch (e) {}
        });
        routeSpeedBadgeMarkers = [];
    }

    if (!routePoints || routePoints.length < 2) {
        return;
    }

    const isClosed = isClosedRouteMode && routePoints.length > 2;
    const segCount = isClosed ? routePoints.length : routePoints.length - 1;

    for (let i = 0; i < segCount; i++) {
        const p1 = routePoints[i];
        const p2 = (i === routePoints.length - 1) ? routePoints[0] : routePoints[i + 1];
        if (!p1 || !p2) continue;

        // 获取该路段速度（从点i发出前往点i+1的速度）
        let segSpeed = '0.5';
        if (tempRoutePointsData && tempRoutePointsData[i] && tempRoutePointsData[i].speed !== undefined && tempRoutePointsData[i].speed !== '') {
            segSpeed = String(tempRoutePointsData[i].speed);
        } else if (p1.stationData && p1.stationData.speed !== undefined && p1.stationData.speed !== '') {
            segSpeed = String(p1.stationData.speed);
        } else {
            segSpeed = localStorage.getItem('globalRouteSpeed') || '0.2';
        }
        const numSpeed = parseFloat(segSpeed) || 0.2;

        // 计算路段物理长度（米）
        let segDist = 0;
        try {
            const w1 = pixelToWorldMath(p1.x, p1.y);
            const w2 = pixelToWorldMath(p2.x, p2.y);
            segDist = Math.sqrt(Math.pow(w2.x - w1.x, 2) + Math.pow(w2.y - w1.y, 2));
        } catch (e) {}

        // 根据速度状态确定配色
        const isReverse = numSpeed < 0;
        let segColor = '#ea580c';
        if (isReverse) {
            segColor = '#dc2626'; // 倒车红色虚线
        } else if (numSpeed <= 0.3) {
            segColor = '#f59e0b'; // 慢速/转弯琥珀黄
        } else if (numSpeed > 0.7) {
            segColor = '#c2410c'; // 高速深橙色
        }

        // 绘制独立可交互路段
        const segLine = L.polyline([[p1.y, p1.x], [p2.y, p2.x]], {
            color: segColor,
            weight: 4,
            opacity: 0.88,
            dashArray: isReverse ? '6, 6' : null,
            className: 'route-segment-clickable'
        }).addTo(map);

        segLine.on('mouseover', function () {
            this.setStyle({ weight: 7, opacity: 1.0 });
        });
        segLine.on('mouseout', function () {
            this.setStyle({ weight: 4, opacity: 0.88 });
        });

        const segmentIndex = i;
        const currentSegDist = segDist;
        const currentSegSpeed = segSpeed;

        segLine.on('click', function (e) {
            if (L.DomEvent) L.DomEvent.stopPropagation(e);
            openSegmentSpeedModal(segmentIndex, e.latlng, currentSegDist, currentSegSpeed);
        });

        routeSegmentLayers.push(segLine);

        // 在路段 65% 位置放置速度胶囊标签（避开 50% 处的中点插入矩形）
        const badgeY = p1.y * 0.35 + p2.y * 0.65;
        const badgeX = p1.x * 0.35 + p2.x * 0.65;
        const badgeIcon = L.divIcon({
            className: 'segment-speed-badge',
            html: `<div class="speed-tag ${isReverse ? 'reverse' : ''}" title="点击修改路段 P${i + 1}➔P${(i + 1 === routePoints.length) ? 1 : i + 2} 速度">${isReverse ? '◀ ' : ''}${numSpeed}m/s</div>`,
            iconSize: [52, 22],
            iconAnchor: [26, 11]
        });

        const speedMarker = L.marker([badgeY, badgeX], {
            icon: badgeIcon,
            zIndexOffset: 850
        }).addTo(map);

        speedMarker.on('click', function (e) {
            if (L.DomEvent) L.DomEvent.stopPropagation(e);
            openSegmentSpeedModal(segmentIndex, speedMarker.getLatLng(), currentSegDist, currentSegSpeed);
        });

        routeSpeedBadgeMarkers.push(speedMarker);
    }
}

// 弹出路段速度设定窗口
function openSegmentSpeedModal(segmentIndex, clickLatLng, distance, currentSpeed) {
    const p1Num = segmentIndex + 1;
    const p2Num = (segmentIndex + 1 === routePoints.length) ? 1 : segmentIndex + 2;
    const distText = (distance !== undefined && !isNaN(distance) && distance > 0) ? `${distance.toFixed(2)} 米` : '';

    const popupHtml = `
        <div class="segment-speed-popup" style="min-width: 220px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f2937;">
            <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px; border-bottom: 1px solid #fed7aa; padding-bottom: 5px; display: flex; align-items: center; justify-content: space-between;">
                <span>🛤️ 路段 P${p1Num} ➔ P${p2Num} 速度设置</span>
                <span style="font-size: 11px; color: #ea580c; background: #fff7ed; padding: 1px 6px; border-radius: 4px; border: 1px solid #ffedd5;">${distText}</span>
            </div>
            
            <div style="margin-bottom: 10px;">
                <label style="display: block; font-size: 12px; margin-bottom: 4px; color: #4b5563; font-weight: 500;">设定速度 (m/s):</label>
                <div style="display: flex; gap: 6px; align-items: center;">
                    <input type="number" id="segSpeedInput" value="${currentSpeed}" step="0.05" min="-2.0" max="2.0" 
                           style="width: 105px; padding: 4px 8px; font-size: 13px; border: 1.5px solid #ea580c; border-radius: 4px; outline: none; font-weight: bold; color: #111;">
                    <span style="font-size: 12px; color: #6b7280;">m/s (负数倒车)</span>
                </div>
            </div>
            
            <div style="margin-bottom: 10px;">
                <div style="font-size: 11px; color: #9ca3af; margin-bottom: 5px;">常用快捷速度:</div>
                <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                    <button type="button" class="btn-quick-speed" onclick="document.getElementById('segSpeedInput').value='0.2'" style="font-size: 11px; padding: 2px 6px; background: #fff7ed; border: 1px solid #fdba74; color: #c2410c; border-radius: 3px; cursor: pointer;">0.2 慢速</button>
                    <button type="button" class="btn-quick-speed" onclick="document.getElementById('segSpeedInput').value='0.5'" style="font-size: 11px; padding: 2px 6px; background: #fff7ed; border: 1px solid #fdba74; color: #c2410c; border-radius: 3px; cursor: pointer;">0.5 正常</button>
                    <button type="button" class="btn-quick-speed" onclick="document.getElementById('segSpeedInput').value='0.8'" style="font-size: 11px; padding: 2px 6px; background: #fff7ed; border: 1px solid #fdba74; color: #c2410c; border-radius: 3px; cursor: pointer;">0.8 快速</button>
                    <button type="button" class="btn-quick-speed" onclick="document.getElementById('segSpeedInput').value='1.0'" style="font-size: 11px; padding: 2px 6px; background: #fff7ed; border: 1px solid #fdba74; color: #c2410c; border-radius: 3px; cursor: pointer;">1.0 高速</button>
                    <button type="button" class="btn-quick-speed" onclick="document.getElementById('segSpeedInput').value='-0.2'" style="font-size: 11px; padding: 2px 6px; background: #fef2f2; border: 1px solid #fca5a5; color: #dc2626; border-radius: 3px; cursor: pointer;">-0.2 倒车</button>
                </div>
            </div>
            
            <div style="margin-bottom: 12px; padding: 6px; background: #f9fafb; border-radius: 4px; border: 1px solid #f3f4f6;">
                <label style="cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 12px; color: #374151; margin: 0;">
                    <input type="checkbox" id="segApplySubsequent" style="cursor: pointer;">
                    <span>同步应用到后续所有路段</span>
                </label>
            </div>
            
            <div style="display: flex; justify-content: flex-end; gap: 8px;">
                <button type="button" id="btnCancelSegSpeed" style="padding: 4px 10px; font-size: 12px; border: 1px solid #d1d5db; background: #fff; border-radius: 4px; cursor: pointer; color: #374151;">取消</button>
                <button type="button" id="btnConfirmSegSpeed" style="padding: 4px 14px; font-size: 12px; border: none; background: #ea580c; color: #fff; border-radius: 4px; cursor: pointer; font-weight: 500;">确定保存</button>
            </div>
        </div>
    `;

    const popup = L.popup({
        offset: [0, -5],
        closeButton: true,
        autoClose: true,
        className: 'segment-speed-leaflet-popup'
    })
    .setLatLng(clickLatLng)
    .setContent(popupHtml)
    .openOn(map);

    setTimeout(() => {
        const input = document.getElementById('segSpeedInput');
        if (input) input.focus();

        const cancelBtn = document.getElementById('btnCancelSegSpeed');
        if (cancelBtn) {
            cancelBtn.onclick = function() {
                map.closePopup();
            };
        }

        const confirmBtn = document.getElementById('btnConfirmSegSpeed');
        if (confirmBtn) {
            confirmBtn.onclick = function() {
                const val = document.getElementById('segSpeedInput')?.value;
                const newSpeedNum = parseFloat(val);
                if (isNaN(newSpeedNum) || newSpeedNum < -5.0 || newSpeedNum > 5.0) {
                    cocoMessage.error('请输入合理的速度值 (-5.0 ~ 5.0 m/s)');
                    return;
                }
                const newSpeedStr = String(newSpeedNum);
                const applySubsequent = document.getElementById('segApplySubsequent')?.checked;

                // 更新当前路段速度（记录在起点 index 处）
                if (!tempRoutePointsData[segmentIndex]) {
                    tempRoutePointsData[segmentIndex] = { ...(routePoints[segmentIndex]?.stationData || {}) };
                }
                tempRoutePointsData[segmentIndex].speed = newSpeedStr;
                if (routePoints[segmentIndex] && routePoints[segmentIndex].stationData) {
                    routePoints[segmentIndex].stationData.speed = newSpeedStr;
                }

                // 若勾选了同步到后续路段
                let updatedCount = 1;
                if (applySubsequent) {
                    for (let k = segmentIndex + 1; k < routePoints.length; k++) {
                        if (!tempRoutePointsData[k]) {
                            tempRoutePointsData[k] = { ...(routePoints[k]?.stationData || {}) };
                        }
                        tempRoutePointsData[k].speed = newSpeedStr;
                        if (routePoints[k] && routePoints[k].stationData) {
                            routePoints[k].stationData.speed = newSpeedStr;
                        }
                        updatedCount++;
                    }
                }

                // 如果右侧面板正好打开了该站点的属性，也同步输入框
                const sidebarSpeed = document.getElementById('station-speed');
                if (sidebarSpeed && currentStationIndex === segmentIndex) {
                    sidebarSpeed.value = newSpeedStr;
                }

                map.closePopup();
                updateRoutePolyline();

                if (applySubsequent && updatedCount > 1) {
                    cocoMessage.success(`已更新 P${p1Num} 及后续共 ${updatedCount} 个路段速度为 ${newSpeedStr} m/s`);
                } else {
                    cocoMessage.success(`路段 P${p1Num} ➔ P${p2Num} 速度已设为 ${newSpeedStr} m/s`);
                }
            };
        }
    }, 50);
}

//保存指令


//发布路线
        async function startTraversal() {
        let drawArea = routePoints.map(point => {
            const worldCoords = pixelToWorldMath(parseFloat(point.x), parseFloat(point.y));
            return [ worldCoords.x,worldCoords.y];
        })
        
          const planMode = Number(document.getElementById('planModeSelect').value);
            if (!planMode) {
                cocoMessage.error('请选择发布模式');
                return;
            }
           
            
            const requestData = {
                planMode: planMode,
                drawArea: drawArea
            };
            const response = await axiosClient.post(`ros2/planstart`, requestData);
            // 发布计划模式
            // const planModeMsg = new ROSLIB.Message({
            //     data: parseFloat(planMode)
            // });
            // RosManager.publishModel.publish(planModeMsg);

             const fixedHeader = {
                stamp: { sec: 2305, nanosec: 300000000 }, // 固定时间戳
                frame_id: 'map' // 固定坐标系
            };
            if (!routePoints || routePoints.length < 2) {
                cocoMessage.error('请先创建路线');
                return;
            }
            routePoints.forEach((point,index) => {
                // 将像素坐标转换为世界坐标
                const worldCoords = pixelToWorldMath(parseFloat(point.x), parseFloat(point.y));
                
                const pointWithZ = {
                    x: worldCoords.x,
                    y: worldCoords.y,
                    z: point.z !== undefined ? point.z : 0.0 // 默认为0
                };
                const msg = new ROSLIB.Message({
                    header: fixedHeader,
                    point: pointWithZ
                });
                RosManager.pointStampedTopic.publish(msg);
            });
}

let allRoutePoints = [];
let allRoutePolyline = null;
// 完成路线创建
function finishRouteCreation() {
    // 检查是否处于路线模式或者有路线点
    if (!isRouteMode && routePoints.length < 2) {
        cocoMessage.error('请先创建路线');
        return;
    }
    
    // 如果处于路线模式，先退出路线模式
    if (isRouteMode) {
        isRouteMode = false;
        window.isRouteMode = isRouteMode;
        
        // 移除地图点击事件监听器
        map.off('click', onRouteMapClick);
        
        // 移除路线创建模式提示
        const indicator = document.getElementById('routeModeIndicator');
        if (indicator) {
            document.body.removeChild(indicator);
        }
    }
    
    if (routePoints.length < 2) {
        cocoMessage.error('路线至少需要2个点');
        clearRoute();
        return;
    }
    

    
    const modeText = isEditMode ? '编辑' : '创建';
    // 打印每个点的详细信息
    
    // 从全局设置获取默认值
    const globalSpeed = localStorage.getItem('globalRouteSpeed') || '0.2';
    const globalTurnMode = localStorage.getItem('globalTurnMode') || '0';
    const globalDirectionOption = localStorage.getItem('globalDirectionOption') || 'useAngle';
    const globalNavigationMode = localStorage.getItem('globalNavigationMode') || '1';
    const globalLanechange = localStorage.getItem('globalLanechange') || '0';
    const globalDefaultDirection = localStorage.getItem('globalDefaultDirection') || '0';
    
    routePoints.forEach((point, index) => {
        const worldCoords = pixelToWorldMath(point.x, point.y);
        // 如果点还没有stationData或者stationData没有id，则创建完整的stationData
        if (!point.stationData || point.stationData.id === undefined) {
            // 计算指向下一个点的方向
            let directionToNext = globalDefaultDirection; // 默认使用全局默认方向
            if (index < routePoints.length - 1) {
                // 如果不是最后一个点，计算当前点到下一个点的方向
                const nextPoint = routePoints[index + 1];
                const dx = nextPoint.x - point.x;
                const dy = nextPoint.y - point.y;
                // 计算角度并转换为度数
                let angle = Math.atan2(dy, dx) * (180 / Math.PI);
                // 保持原始角度值，不进行360度转换
                directionToNext = angle.toFixed(2).toString();
            } else if (index > 0) {
                // 如果是最后一个点，计算上一个点到当前点的方向
                const prevPoint = routePoints[index - 1];
                const dx = point.x - prevPoint.x;
                const dy = point.y - prevPoint.y;
                // 计算角度并转换为度数
                let angle = Math.atan2(dy, dx) * (180 / Math.PI);
                // 保持原始角度值，不进行360度转换
                directionToNext = angle.toFixed(2).toString();
            }
            
            point.stationData = {
                id: -1,  // 新点默认id为-1
                action: globalNavigationMode,  // 使用全局导航模式
                area: "1",
                direction: directionToNext,  // 使用计算的方向
                positionX: `${worldCoords.x.toFixed(5)}`,
                positionY: ` ${worldCoords.y.toFixed(5)}`,
                speed: globalSpeed,  // 使用全局速度
                stopTime: "0",
                runmode: globalTurnMode,  // 使用全局转弯模式
                directionOption: 'useAngle',  // 强制使用角度模式，因为我们要计算方向
                navigationMode: globalNavigationMode,  // 使用全局导航模式
                lanechange: globalLanechange,  // 使用全局变道设置
                defaultDirection: directionToNext  // 使用计算的方向
            };
        } else {
            // 如果已有stationData，只更新位置信息
            point.stationData.positionX = `${worldCoords.x.toFixed(5)}`;
            point.stationData.positionY = `${worldCoords.y.toFixed(5)}`;
        }
    });
    
    // 根据模式显示不同的弹框
    if (isEditMode && currentEditRouteInfo) {
        // 编辑模式：显示编辑弹框，填充原有数据
        showRouteEditModal(currentEditRouteInfo);
    } else {
        // 创建模式：显示新建弹框
        showRouteInfoModal();
    }
}

// 清除路线
function clearRoute() {
    // 移除所有路线标记
    routeMarkers.forEach(marker => {
        map.removeLayer(marker);
    });
    routeMarkers = [];
    routePoints = [];
    
    // 移除路线线条
    if (routePolyline) {
        map.removeLayer(routePolyline);
        routePolyline = null;
    }
    if (routeSegmentLayers && routeSegmentLayers.length > 0) {
        routeSegmentLayers.forEach(layer => map.removeLayer(layer));
        routeSegmentLayers = [];
    }
    if (routeSpeedBadgeMarkers && routeSpeedBadgeMarkers.length > 0) {
        routeSpeedBadgeMarkers.forEach(marker => map.removeLayer(marker));
        routeSpeedBadgeMarkers = [];
    }
    
    // 清除所有矩形框
    routeRectangles.forEach(rect => {
        map.removeLayer(rect);
    });
    routeRectangles = [];
    
    // 清除临时存储的路线点数据
    tempRoutePointsData = {};

    isDragging = false;
    dragPointIndex = -1;
    isDraggingRectangle = false;
    currentDraggingRectangle = null;
    
    // 重置编辑模式
    isEditMode = false;
    currentEditRouteInfo = null;
    
    // 更新路线状态显示
    updateRouteStatus();
    
    // 移除路线创建模式提示
    const indicator = document.getElementById('routeModeIndicator');
    if (indicator) {
        document.body.removeChild(indicator);
    }
}


// 加载路线
document.getElementById("routeSelect").addEventListener("change",loadRoute)
async function loadRoute() {
    const routeSelect = document.getElementById('routeSelect');
    const selectedRoute = routeSelect.value;
    let currentRoute = null;
    let currentRouteSpeed = null;
    if (!selectedRoute) {
        return;
    }
    try {
        const mapSelect = document.getElementById('mapSelect');
        const currentMapName = localStorage.getItem('lastMapName');
        // 从服务器获取路线详情
        const response = await axiosClient.get(`route/map-coverage/${currentMapName}`);
        routeData = response.data.data;
        routeData.forEach(item =>{
            if(item.routeGroup && item.routeGroup.length > 0 && item.routeGroup[0].id == selectedRoute ){
                currentRoute = item.stations,
                currentRouteSpeed = item.routeGroup[0].speed
            }
        })
        if (!routeData || !currentRoute) {
            cocoMessage.error('路线数据为空或没有站点信息');
            return;
        }
        // 清除现有的路线点和标记
        // 保存编辑模式状态
        const savedEditMode = isEditMode;
        const savedEditRouteInfo = currentEditRouteInfo;
        
        clearRoute();
        
        // 恢复编辑模式状态（除非设置了跳过标志）
        if (!skipRestoreEditMode) {
            isEditMode = savedEditMode;
            currentEditRouteInfo = savedEditRouteInfo;
        } else {
            // 重置标志
            skipRestoreEditMode = false;
            isEditMode = false;
            currentEditRouteInfo = null;
        }
        
        // 遍历stations集合，渲染每个点到地图上
        currentRoute.forEach((station, index) => {
            // 使用数学坐标系
            
            const currentX = parseFloat(station.positionX);
            const currentY = parseFloat(station.positionY);
            
            if (isNaN(currentX) || isNaN(currentY)) {
                return;
            }
            
            // 创建站点标记
            const stationIcon = L.divIcon({
                className: 'station-marker',
                html: `<div style="background: #2196F3; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; color: white; font-size: 10px; font-weight: bold;">${index + 1}</div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });
            
            // 将世界坐标转换为像素坐标（使用数学坐标系）
            const pixelCoords = worldToPixel(currentX, currentY);
            
            // 创建可拖拽的站点标记
            const marker = L.marker([pixelCoords.y, pixelCoords.x], { icon: stationIcon, draggable: true }).addTo(map);
            
            // 替换bindPopup为点击事件，使用固定位置属性框
            marker.on('click', function(e) {
                // 获取当前站点的索引
                const markerIndex = routeMarkers.indexOf(marker);
                if (markerIndex === -1) {
                    return;
                }
                
                // 优先使用临时对象中的数据，如果没有则使用服务器数据
                let latestStationData = station;
                if (tempRoutePointsData && tempRoutePointsData[index]) {
                    latestStationData = tempRoutePointsData[index];
                }
                
                // 初始化固定位置属性框
                if (!fixedStationInfoBox) {
                    initFixedStationInfoBox();
                }
                
                // 保存当前选中的站点信息
                currentStationMarker = marker;
                currentStationIndex = markerIndex;
                
                // 更新坐标输入框
                const coordXInput = fixedStationInfoBox.querySelector('#station-coord-x');
                const coordYInput = fixedStationInfoBox.querySelector('#station-coord-y');
                const nameDisplay = fixedStationInfoBox.querySelector('#stationNameDisplay');
                if (coordXInput) coordXInput.value = currentX.toFixed(3);
                if (coordYInput) coordYInput.value = currentY.toFixed(3);
                if (nameDisplay) nameDisplay.textContent = latestStationData.stationName || `路线点 ${markerIndex + 1}`;
                
                // 设置表单值
                const actionSelect = fixedStationInfoBox.querySelector('#station-action');
                if (actionSelect) actionSelect.value = latestStationData.action || '1';
                
                const areaSelect = fixedStationInfoBox.querySelector('#station-area');
                if (areaSelect) areaSelect.value = latestStationData.area || '1';
                
                const avoidSelect = fixedStationInfoBox.querySelector('#station-avoid');
                if (avoidSelect) avoidSelect.value = latestStationData.lanechange || '0';
                
                const directionInput = fixedStationInfoBox.querySelector('#station-direction');
                if (directionInput) directionInput.value = latestStationData.direction || '0';
                
                const speedInput = fixedStationInfoBox.querySelector('#station-speed');
                if (speedInput) speedInput.value = latestStationData.speed == 0 ? currentRouteSpeed : latestStationData.speed;

                const workDurationInput = fixedStationInfoBox.querySelector('#station-work-duration');
                if (workDurationInput) workDurationInput.value = latestStationData.stopTime != null
                    ? latestStationData.stopTime
                    : '0';
                
                // 设置转向模式单选按钮
                const turnModeSelf = fixedStationInfoBox.querySelector('#turnModeSelf');
                const turnModeContinuous = fixedStationInfoBox.querySelector('#turnModeContinuous');
                if (turnModeSelf && turnModeContinuous) {
                    const turnModeValue = String(latestStationData.runmode || localStorage.getItem('globalTurnMode') || "0");
                    if (turnModeValue === "1") {
                        turnModeSelf.checked = true;
                        turnModeContinuous.checked = false;
                    } else {
                        turnModeSelf.checked = false;
                        turnModeContinuous.checked = true;
                    }
                }
                
                // 设置是否停车选择框
                const isStopSelect = fixedStationInfoBox.querySelector('#isStopSelect');
                if (isStopSelect) {
                    const isStopValue = String(latestStationData.stop || "0");
                    isStopSelect.value = isStopValue;
                }
                
                // 显示属性框
                fixedStationInfoBox.style.display = 'block';
            });
            
            // 为现有站点标记添加拖拽事件
            marker.on('dragstart', function(e) {
                isDragging = true;
                dragPointIndex = routeMarkers.indexOf(marker);
                // 保存原始位置用于计算偏移量
                if (routePoints[dragPointIndex]) {
                    // 保存像素坐标用于更新路线
                    routePoints[dragPointIndex].originalX = routePoints[dragPointIndex].x;
                    routePoints[dragPointIndex].originalY = routePoints[dragPointIndex].y;
                    
                    // 保存原始世界坐标用于计算偏移量
                    const originalWorldCoords = pixelToWorldMath(routePoints[dragPointIndex].x, routePoints[dragPointIndex].y);
                    routePoints[dragPointIndex].originalWorldX = originalWorldCoords.x;
                    routePoints[dragPointIndex].originalWorldY = originalWorldCoords.y;
                    
                    // 创建原始位置的虚线标记
                    const originalLatLng = L.latLng(routePoints[dragPointIndex].y, routePoints[dragPointIndex].x);
                    const originalMarkerIcon = L.divIcon({
                        className: 'original-position-marker',
                        html: `<div style="background: transparent; width: 16px; height: 16px; border: 2px dashed #f44336; border-radius: 50%; box-shadow: 0 0 4px rgba(255,0,0,0.5); display: flex; align-items: center; justify-content: center;"></div>`,
                        iconSize: [20, 20],
                        iconAnchor: [10, 10]
                    });
                    
                    marker.originalPositionMarker = L.marker(originalLatLng, { 
                        icon: originalMarkerIcon,
                        zIndexOffset: 500
                    }).addTo(map);
                    
                    // 创建连接原始位置和当前位置的虚线
                    const currentLatLng = marker.getLatLng();
                    marker.dragConnectionLine = L.polyline(
                        [originalLatLng, currentLatLng],
                        {
                            color: '#f44336',
                            weight: 2,
                            opacity: 0.7,
                            dashArray: '5, 10',
                            zIndexOffset: 400
                        }
                    ).addTo(map);
                }
            });
            
            marker.on('drag', function(e) {
                if (isDragging && dragPointIndex >= 0 && routePoints[dragPointIndex]) {
                    const newPos = e.target.getLatLng();
                    // 只更新x和y属性，保留其他属性（如originalX, originalY等）
                    routePoints[dragPointIndex].x = newPos.lng;
                    routePoints[dragPointIndex].y = newPos.lat;
                    updateRoutePolyline();
                    updateAllRectangles();
                    
                    // 更新虚线连接
                    if (marker.dragConnectionLine && routePoints[dragPointIndex].originalX !== undefined && routePoints[dragPointIndex].originalY !== undefined) {
                        const originalLatLng = L.latLng(routePoints[dragPointIndex].originalY, routePoints[dragPointIndex].originalX);
                        marker.dragConnectionLine.setLatLngs([originalLatLng, newPos]);
                    }
                    
                    // 计算世界坐标偏移量和距离
                    if (routePoints[dragPointIndex].originalWorldX !== undefined && routePoints[dragPointIndex].originalWorldY !== undefined) {
                        const originalWorldX = routePoints[dragPointIndex].originalWorldX;
                        const originalWorldY = routePoints[dragPointIndex].originalWorldY;
                        const newWorldCoords = pixelToWorldMath(newPos.lng, newPos.lat);
                        const deltaX = newWorldCoords.x - originalWorldX;
                        const deltaY = newWorldCoords.y - originalWorldY;
                        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                        
                        // 更新属性框中的偏移量和距离显示
                        if (fixedStationInfoBox && fixedStationInfoBox.style.display === 'block') {
                            // 确保移动信息元素存在
                            let movementInfoDiv = fixedStationInfoBox.querySelector('#movement-info');
                            if (!movementInfoDiv) {
                                // 创建移动信息元素
                                movementInfoDiv = document.createElement('div');
                                movementInfoDiv.id = 'movement-info';
                                movementInfoDiv.style.cssText = `
                                    margin-bottom: 15px;
                                    padding: 10px;
                                    background-color: #f0f9ff;
                                    border-radius: 4px;
                                    border-left: 4px solid #007cba;
                                    font-size: 13px;
                                `;
                                
                                // 找到坐标容器元素并插入到其下方
                                const coordContainer = fixedStationInfoBox.querySelector('#stationCoordContainer');
                                if (coordContainer) {
                                    coordContainer.parentNode.insertBefore(movementInfoDiv, coordContainer.nextSibling);
                                }
                            }
                            
                            // 确保移动信息框显示
                            movementInfoDiv.style.display = 'block';
                            
                            // 更新移动信息
                            movementInfoDiv.innerHTML = `
                                <strong>移动信息：</strong><br>
                                ΔX: ${deltaX.toFixed(3)} (m)<br>
                                ΔY: ${deltaY.toFixed(3)} (m)<br>
                                移动距离: ${distance.toFixed(3)} (m)
                            `;
                        }
                    }
                }
            });
            
            marker.on('dragend', function(e) {
                isDragging = false;
                const index = dragPointIndex;
                dragPointIndex = -1;
                
                // 移除原始位置标记和虚线连接
                if (marker.originalPositionMarker) {
                    map.removeLayer(marker.originalPositionMarker);
                    marker.originalPositionMarker = null;
                }
                if (marker.dragConnectionLine) {
                    map.removeLayer(marker.dragConnectionLine);
                    marker.dragConnectionLine = null;
                }
                
                // 移除原始位置属性
                if (index >= 0 && routePoints[index]) {
                    delete routePoints[index].originalX;
                    delete routePoints[index].originalY;
                    delete routePoints[index].originalWorldX;
                    delete routePoints[index].originalWorldY;
                }
                
                // 拖拽结束后，同步更新tempRoutePointsData和stationData中的坐标
                const markerIndex = routeMarkers.indexOf(marker);
                if (markerIndex !== -1) {
                    const newPos = e.target.getLatLng();
                    const worldCoords = pixelToWorldMath(newPos.lng, newPos.lat);
                    
                    // 更新tempRoutePointsData中的坐标
                    if (tempRoutePointsData[markerIndex]) {
                        tempRoutePointsData[markerIndex].x = worldCoords.x.toFixed(5);
                        tempRoutePointsData[markerIndex].y = worldCoords.y.toFixed(5);
                    }
                    
                    // 更新stationData中的positionX和positionY
                    if (routePoints[markerIndex] && routePoints[markerIndex].stationData) {
                        routePoints[markerIndex].stationData.positionX = worldCoords.x.toFixed(5);
                        routePoints[markerIndex].stationData.positionY = worldCoords.y.toFixed(5);
                    }
                }
                
                // 打印拖动结束后的当前点信息
                if (index >= 0 && routePoints[index]) {
                    const point = routePoints[index];
                    const pointName = point.stationData ? 
                        (point.stationData.stationName || `站点${index + 1}`) : 
                        `路线点${index + 1}`;
                    
                    console.log('\n=== 拖动结束 - 当前点信息 ===');
                    console.log(`点名称: ${pointName}`);
                    console.log(`在路线中的顺序: ${index + 1}`);
                    console.log(`像素坐标: (${point.x.toFixed(6)}, ${point.y.toFixed(6)})`);
                    if (point.stationData) {
                        console.log(`站点ID: ${point.stationData.id || 'N/A'}`);
                    }
                    console.log('==========================\n');
                }
            });
            
            // 将标记添加到路线点数组中
            routeMarkers.push(marker);
          
            // 将坐标点添加到路线点数组中（用于绘制连线）
            // 注意：routePoints中需要存储像素坐标
            const worldCoords = pixelToWorldMath(pixelCoords.x, pixelCoords.y);
            const stationWithId = {
                ...station,
                id: station.stationid || -1,
                x: worldCoords.x.toFixed(5),
                y: worldCoords.y.toFixed(5)
            };
            
            // 检查是否已存在于routePoints中（从临时对象加载的情况）
            const existingPointIndex = routePoints.findIndex(point => 
                point.stationData && point.stationData.id == station.stationid
            );
            
            if (existingPointIndex === -1) {
                // 如果不存在于routePoints中，则添加新点
                routePoints.push({
                    x: pixelCoords.x,
                    y: pixelCoords.y,
                    stationData: stationWithId,
                    isOriginalPoint: true  // 标识为原始点
                });
            } else {
                // 如果已存在，确保坐标信息是最新的
                routePoints[existingPointIndex].x = pixelCoords.x;
                routePoints[existingPointIndex].y = pixelCoords.y;
                // 确保标记为原始点
                routePoints[existingPointIndex].isOriginalPoint = true;
            }
            
            // 确保将服务器数据保存到tempRoutePointsData中（如果暂存数据不存在）
            if (!tempRoutePointsData[index]) {
                tempRoutePointsData[index] = stationWithId;
            }
        });
        
        // 绘制路线连线
        updateRoutePolyline();
        
        // 调整地图视图以显示所有路线点
        if (routePoints.length > 0) {
            const group = new L.featureGroup(routeMarkers);
            map.fitBounds(group.getBounds().pad(0.1));
        }
         
        // 更新当前编辑路线信息中的速度和名称
        if (isEditMode && currentEditRouteInfo) {
            if (currentRouteSpeed) {
                currentEditRouteInfo.speed = currentRouteSpeed.toString();
            }
        }
        
        // 查找当前选中的路线对象并赋值给全局currentRouteItem
        const targetRouteItem = routeData.find(item => item.routeGroup[0].id == selectedRoute);
        if (targetRouteItem) {
            currentRouteItem = targetRouteItem;
            
            // 如果是编辑模式，更新编辑路线信息中的名称
            if (isEditMode && currentEditRouteInfo) {
                currentEditRouteInfo.routeName = targetRouteItem.routeGroup[0].routeName;
            }
        } else {
            currentRouteItem = null;
        }
        
        // 显示路线点的ID信息
        logRoutePointIds();
        
    } catch (error) {
        cocoMessage.error(`加载路线失败: ${error.message}`);
    }
}

// 保存站点数据
async function saveStationData(stationId) {
    try {
        // 获取当前弹窗中的输入值
        const popup = document.querySelector('.leaflet-popup-content');
        if (!popup) {
            cocoMessage.error('无法获取弹窗内容');
            return;
        }
        
        // 获取各个输入框的值
        const action = popup.querySelector('#station-action')?.value || '1';
        const area = popup.querySelector('#station-area')?.value || '1';
        const lanechange = popup.querySelector('#station-avoid')?.value || '0';
        const direction = popup.querySelector('#station-direction')?.value || '0';
        const speed = popup.querySelector('#station-speed')?.value || '0.5';
        const stopTime = popup.querySelector('#station-work-duration')?.value || '0';
        
        // 更新站点数据
        const stationIndex = routePoints.findIndex(point => point.stationData && point.stationData.id == stationId);
        if (stationIndex !== -1) {
            // 获取当前路线的routeid
            const routeId = document.getElementById("routeSelect").value;
            
            // 添加必要的世界坐标信息
            const worldCoords = pixelToWorldMath(routePoints[stationIndex].x, routePoints[stationIndex].y);
            
            routePoints[stationIndex].stationData = {
                ...routePoints[stationIndex].stationData,
                stationId: String(stationId),
                routeId: routeId,
                action: action,
                area: area,
                lanechange: lanechange,
                direction: direction,
                speed: speed,
                stopTime: stopTime,
                // 更新坐标信息
                positionX: worldCoords.x.toFixed(5),
                positionY: worldCoords.y.toFixed(5)
            };
            
            // 保存到临时对象
            tempRoutePointsData[stationIndex] = {
                id: String(stationId),
                routeId: routeId,
                direction: direction,
                action: action,
                area: area,
                lanechange: lanechange,
                speed: speed,
                stopTime: stopTime,
                stop: "0",
                position: "1",
                runmode: routePoints[stationIndex].stationData.runmode || localStorage.getItem('globalTurnMode') || "0",
                x: worldCoords.x.toFixed(5),
                y: worldCoords.y.toFixed(5)
            };
            
            const responseUpdateRouteMsg = await axiosClient.post("route/updateRouteDetail", routePoints[stationIndex].stationData);
           
            cocoMessage.success('站点数据保存成功');
            
            // 延迟关闭弹窗，确保保存操作完成
            setTimeout(() => {
                map.closePopup();
            }, 300);
        } else {
            cocoMessage.error('未找到对应的站点数据');
        }
    } catch (error) {
        cocoMessage.error(`保存失败: ${error.message}`);
    }
}

// 获取动作文本描述
function getActionText(action) {
    const actionMap = {
        '1': '清扫',
        '2': '充电',
        '3': '等待',
        '4': '避障',
        '5': '其他'
    };
    return actionMap[action] || `未知动作(${action})`;
}

// 获取方向文本描述
function getDirectionText(direction) {
    const directionMap = {
        '0': '无方向',
        '1': '北',
        '2': '东北',
        '3': '东',
        '4': '东南',
        '5': '南',
        '6': '西南',
        '7': '西',
        '8': '西北'
    };
    return directionMap[direction] || `未知方向(${direction})`;
}

// 删除路线
async function deleteRoute() {
    const routeSelect = document.getElementById('routeSelect');
    const selectedRoute = routeSelect.value;
    
    routeData.forEach(item => {
        if (item.routeGroup[0].id == selectedRoute) {
            currentRouteItem = item
        }
    })
    if (!selectedRoute) {
        cocoMessage.error('请选择要删除的路线');
        return;
    }
    
    let currentRouteGroup = currentRouteItem.routeGroup[0].routeGroup
    if (confirm(`确定要删除路线 "${currentRouteItem.routeName}" 吗？`)) {
        // 从下拉框中移除
        const sudesponse = await axiosClient.delete("route/deleteByRoutesource/" + currentRouteGroup);
        if (sudesponse.data.code == 0) {
            const options = routeSelect.options;
            for (let i = 0; i < options.length; i++) {
                if (options[i].value === selectedRoute) {
                    routeSelect.remove(i);
                    break;
                }
            }
            cocoMessage.success(`路线 "${currentRouteItem.routeName}" 已删除`);
            currentRouteItem = null
            
            // 退出编辑模式
            isRouteEditMode = false;
            window.isRouteEditMode = false;
            isRouteMode = false;
            window.isRouteMode = false;
            isEditMode = false;
            window.isEditMode = false;
            
            // 设置跳过恢复编辑模式标志
            skipRestoreEditMode = true;
            
            // 移除地图点击事件
            map.off('click', onRouteMapClick);
            
            // 移除编辑模式提示
            const indicator = document.getElementById('routeModeIndicator');
            if (indicator) {
                indicator.remove();
            }
            
            // 恢复按钮文字和样式
            const editBtn = document.querySelector('button[onclick="editRoute()"]');
            if (editBtn) {
                editBtn.textContent = '修改路线';
                editBtn.classList.remove('btn-danger');
                editBtn.classList.add('btn-secondary');
            }
            
            // 清空原始路线点数据
            originalRoutePoints = [];
            
            // 重新加载路线列表并更新选择框
            await refreshRouteSelect();
            
            // 清除地图上的路线显示
            clearRoute();
            
            // 重新加载当前选中的路线
            if (routeSelect && routeSelect.value) {
                await loadRoute();
            }
        }
    }
}

// 编辑路线
async function editRoute() {
    const editBtn = document.querySelector('button[onclick="editRoute()"]');
    console.log("544444",isRouteEditMode);
    
    // 检查当前是否为编辑模式
    if (isRouteEditMode) {
        // 取消编辑，恢复原始路线
        await cancelEditRoute();
        return;
    }
    
    const routeSelect = document.getElementById('routeSelect');
    const selectedRoute = routeSelect.value;

    if (!selectedRoute) {
        cocoMessage.error('请选择要编辑的路线');
        return;
    }
    
    // 设置编辑模式
    isEditMode = true;
    window.isRouteEditMode = true;
    
    // 获取当前选中的路线信息
    const mapSelect = document.getElementById('mapSelect');
    const currentMapName = localStorage.getItem('lastMapName');
        // 从服务器获取路线详情
   
    // 先从服务器获取最新的路线数据
    axiosClient.get(`route/map-coverage/${currentMapName}`).then(response => {
        const latestRouteData = response.data.data;
        
        // 从最新的路线数据中找到选中的路线
        let targetRouteItem = null;
        latestRouteData.forEach(item =>{
            if(item.routeGroup && item.routeGroup[0] && item.routeGroup[0].id == selectedRoute){
                targetRouteItem = item;
            }
        })
        
        if (!targetRouteItem) {
            cocoMessage.error('找不到选中的路线信息');
            isEditMode = false;
            return;
        }
        
        // 保存当前路线项信息
        currentRouteItem = targetRouteItem;
        
        // 构建路线信息对象
        const routeInfo = {
            id: selectedRoute,
            routeName: targetRouteItem.routeGroup[0].routeName || routeSelect.options[routeSelect.selectedIndex].text,
            mapName: mapSelect.value,
            speed: targetRouteItem.routeGroup[0].speed || '0.2',
            routeGroup: targetRouteItem.routeGroup[0].routeGroup
        };
        
        // 保存当前编辑的路线信息
        currentEditRouteInfo = routeInfo;
        
        // 更新全局routeData变量
        routeData = latestRouteData;
        
        // 加载选中的路线
        return loadRoute();
    }).then(() => {
        // 保存原始路线点数据（深拷贝）
        originalRoutePoints = JSON.parse(JSON.stringify(routePoints));
        
        // 进入路线编辑模式（基于已加载的路线）
        startRouteEditMode();
        
        // 更新按钮文字和样式
        if (editBtn) {
            editBtn.textContent = '取消修改';
            editBtn.classList.remove('btn-secondary');
            editBtn.classList.add('btn-danger');
        }
    }).catch(error => {
        cocoMessage.error('加载路线失败，无法进行编辑');
        // 重置编辑模式
        isEditMode = false;
        currentEditRouteInfo = null;
    });
}

// 取消编辑路线，恢复原始数据
async function cancelEditRoute() {
    console.log("55555555");
    
    const editBtn = document.querySelector('button[onclick="editRoute()"]');
    const routeSelect = document.getElementById('routeSelect');
    
    // 设置跳过恢复编辑模式标志
    skipRestoreEditMode = true;
    
    // 退出编辑模式
    isRouteEditMode = false;
    window.isRouteEditMode = false;
    isRouteMode = false;
    window.isRouteMode = false;
    isEditMode = false;
    window.isEditMode = false;
    
    // 移除地图点击事件
    map.off('click', onRouteMapClick);
    
    // 移除编辑模式提示
    const indicator = document.getElementById('routeModeIndicator');
    if (indicator) {
        indicator.remove();
    }
    
    // 恢复按钮文字和样式
    if (editBtn) {
        editBtn.textContent = '修改路线';
        editBtn.classList.remove('btn-danger');
        editBtn.classList.add('btn-secondary');
    }
    
    // 清空原始路线点数据
    originalRoutePoints = [];
    
    // 先清屏
    clearRoute();
    
    // 然后重新加载当前选中的路线
    if (routeSelect && routeSelect.value) {
        await loadRoute();
    }
    
   cocoMessage.success('已取消修改，恢复原始路线');
}

// 开始路线编辑模式（基于已加载的路线）
function startRouteEditMode() {
    if (!mapData.imageUrl) {
        cocoMessage.error('请先加载地图');
        return;
    }
    
    // 退出其他模式
    if (robotMarker) {
        map.removeLayer(robotMarker);
        robotMarker = null;
    }
    if (pathPolyline) {
        map.removeLayer(pathPolyline);
        pathPolyline = null;
    }
    
    isRouteMode = true;
    window.isRouteMode = true;
    isRouteEditMode = true;
    window.isRouteEditMode = true;
    
    // 添加地图点击事件监听器
    map.on('click', onRouteMapClick);
    
    // 显示路线编辑模式提示
    const indicator = document.createElement('div');
    indicator.className = 'route-mode-indicator';
    indicator.textContent = '路线编辑模式 - 点击地图添加路线点，拖拽移动点';
    indicator.id = 'routeModeIndicator';
    document.body.appendChild(indicator);
    
    // 为现有的路线点添加编辑功能
    routeMarkers.forEach((marker, index) => {
        // 确保标记可拖拽
        marker.dragging.enable();
        
        // 更新拖拽事件
        marker.off('dragstart');
        marker.off('drag');
        marker.off('dragend');
        
        marker.on('dragstart', function(e) {
            isDragging = true;
            dragPointIndex = routeMarkers.indexOf(marker);
            // 保存原始位置用于计算偏移量
            if (routePoints[dragPointIndex]) {
                // 保存像素坐标用于更新路线
                routePoints[dragPointIndex].originalX = routePoints[dragPointIndex].x;
                routePoints[dragPointIndex].originalY = routePoints[dragPointIndex].y;
                
                // 保存原始世界坐标用于计算偏移量
                const originalWorldCoords = pixelToWorldMath(routePoints[dragPointIndex].x, routePoints[dragPointIndex].y);
                routePoints[dragPointIndex].originalWorldX = originalWorldCoords.x;
                routePoints[dragPointIndex].originalWorldY = originalWorldCoords.y;
                
                // 创建原始位置标记
                const originalLatLng = L.latLng(routePoints[dragPointIndex].originalY, routePoints[dragPointIndex].originalX);
                const originalMarkerIcon = L.divIcon({
                    className: 'original-position-marker',
                    html: `<div style="background: transparent; width: 16px; height: 16px; border: 2px dashed #f44336; border-radius: 50%; box-shadow: 0 0 4px rgba(255,0,0,0.5); display: flex; align-items: center; justify-content: center;"></div>`,
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                });
                
                marker.originalPositionMarker = L.marker(originalLatLng, { 
                    icon: originalMarkerIcon,
                    zIndexOffset: 500
                }).addTo(map);
                
                // 创建连接原始位置和当前位置的虚线
                const currentLatLng = e.target.getLatLng();
                marker.dragConnectionLine = L.polyline(
                    [originalLatLng, currentLatLng],
                    {
                        color: '#f44336',
                        weight: 2,
                        opacity: 0.7,
                        dashArray: '5, 10',
                        zIndexOffset: 400
                    }
                ).addTo(map);
            }
        });
        
        marker.on('drag', function(e) {
            if (isDragging && dragPointIndex >= 0) {
                const newPos = e.target.getLatLng();
                routePoints[dragPointIndex] = { 
                    x: newPos.lng, 
                    y: newPos.lat,
                    stationData: routePoints[dragPointIndex].stationData,
                    originalX: routePoints[dragPointIndex].originalX,
                    originalY: routePoints[dragPointIndex].originalY,
                    originalWorldX: routePoints[dragPointIndex].originalWorldX,
                    originalWorldY: routePoints[dragPointIndex].originalWorldY
                };
                updateRoutePolyline();
                updateAllRectangles();
                
                // 更新虚线连接
                if (marker.dragConnectionLine && routePoints[dragPointIndex].originalX !== undefined && routePoints[dragPointIndex].originalY !== undefined) {
                    const originalLatLng = L.latLng(routePoints[dragPointIndex].originalY, routePoints[dragPointIndex].originalX);
                    marker.dragConnectionLine.setLatLngs([originalLatLng, newPos]);
                }
                
                // 计算世界坐标偏移量和距离
                const originalWorldX = routePoints[dragPointIndex].originalWorldX;
                const originalWorldY = routePoints[dragPointIndex].originalWorldY;
                const newWorldCoords = pixelToWorldMath(newPos.lng, newPos.lat);
                const deltaX = newWorldCoords.x - originalWorldX;
                const deltaY = newWorldCoords.y - originalWorldY;
                const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                
                // 更新属性框中的偏移量和距离显示
                if (fixedStationInfoBox && fixedStationInfoBox.style.display === 'block') {
                    // 确保移动信息元素存在
                    let movementInfoDiv = fixedStationInfoBox.querySelector('#movement-info');
                    if (!movementInfoDiv) {
                        // 创建移动信息元素
                        movementInfoDiv = document.createElement('div');
                        movementInfoDiv.id = 'movement-info';
                        movementInfoDiv.style.cssText = `
                            margin-bottom: 15px;
                            padding: 10px;
                            background-color: #f0f9ff;
                            border-radius: 4px;
                            border-left: 4px solid #007cba;
                            font-size: 13px;
                        `;
                        
                        // 找到坐标容器元素并插入到其下方
                        const coordContainer = fixedStationInfoBox.querySelector('#stationCoordContainer');
                        if (coordContainer) {
                            coordContainer.parentNode.insertBefore(movementInfoDiv, coordContainer.nextSibling);
                        }
                    }
                    
                    // 确保移动信息框显示
                    movementInfoDiv.style.display = 'block';
                    
                    // 更新移动信息
                    movementInfoDiv.innerHTML = `
                        <strong>移动信息：</strong><br>
                        ΔX: ${deltaX.toFixed(3)} (m)<br>
                        ΔY: ${deltaY.toFixed(3)} (m)<br>
                        移动距离: ${distance.toFixed(3)} (m)
                    `;
                }
            }
        });
        
        marker.on('dragend', function(e) {
            isDragging = false;
            const index = dragPointIndex;
            dragPointIndex = -1;
            
            // 移除原始位置标记和虚线连接
            if (marker.originalPositionMarker) {
                map.removeLayer(marker.originalPositionMarker);
                marker.originalPositionMarker = null;
            }
            if (marker.dragConnectionLine) {
                map.removeLayer(marker.dragConnectionLine);
                marker.dragConnectionLine = null;
            }
            
            // 移除原始位置属性
            if (index >= 0 && routePoints[index]) {
                delete routePoints[index].originalX;
                delete routePoints[index].originalY;
                delete routePoints[index].originalWorldX;
                delete routePoints[index].originalWorldY;
            }
            
            // 打印拖动结束后的当前点信息
            if (index >= 0 && routePoints[index]) {
                const point = routePoints[index];
                const pointName = point.stationData ? 
                    (point.stationData.stationName || `站点${index + 1}`) : 
                    `路线点${index + 1}`;
                
                console.log('\n=== 拖动结束 - 当前点信息 ===');
                console.log(`点名称: ${pointName}`);
                console.log(`在路线中的顺序: ${index + 1}`);
                console.log(`像素坐标: (${point.x.toFixed(6)}, ${point.y.toFixed(6)})`);
                if (point.stationData) {
                    console.log(`站点ID: ${point.stationData.id || 'N/A'}`);
                }
                console.log('==========================\n');
            }
        });
        
    });
    
    // 初始创建所有矩形框
    updateAllRectangles();
}





// 设置路线为活跃
function setRouteActive() {
    const routeSelect = document.getElementById('routeSelect');
    const selectedRoute = routeSelect.value;
    
    if (!selectedRoute) {
        cocoMessage.error('请选择要设置的路线');
        return;
    }
    
    cocoMessage.error(`路线 "${selectedRoute}" 已设为活跃状态`);
}

// 设置路线为非活跃
function setRouteInactive() {
    const routeSelect = document.getElementById('routeSelect');
    const selectedRoute = routeSelect.value;
    
    if (!selectedRoute) {
        cocoMessage.error('请选择要设置的路线');
        return;
    }
    cocoMessage.error(`路线 "${selectedRoute}" 已设为非活跃状态`);
}

// 预览路线
function previewRoute() {
    const routeSelect = document.getElementById('routeSelect');
    const selectedRoute = routeSelect.value;
    
    if (!selectedRoute) {
        cocoMessage.error('请选择要预览的路线');
        return;
    }
    
    cocoMessage.error(`预览路线: ${selectedRoute}\n(此功能需要连接服务器实现)`);
}

// 验证路线
function validateRoute() {
    if (routePoints.length < 2) {
        cocoMessage.error('没有可验证的路线，请先创建路线');
        return;
    }
    let issues = [];
    
    // 检查路线点数量
    if (routePoints.length < 2) {
        issues.push('路线点数量不足，至少需要2个点');
    }
    
    // 检查路线点间距
    for (let i = 1; i < routePoints.length; i++) {
        const prevWorld = pixelToWorldMath(routePoints[i-1].x, routePoints[i-1].y);
        const currWorld = pixelToWorldMath(routePoints[i].x, routePoints[i].y);
        
        const dx = currWorld.x - prevWorld.x;
        const dy = currWorld.y - prevWorld.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 2.0) {
            issues.push(`路线点 ${i} 和 ${i+1} 间距过大 (${distance.toFixed(3)}m)`);
        }
        if (distance < 0.1) {
            issues.push(`路线点 ${i} 和 ${i+1} 间距过小 (${distance.toFixed(3)}m)`);
        }
    }
    

    
    if (issues.length === 0) {
        cocoMessage.error('路线验证通过！\n路线点数: ' + routePoints.length);
    } else {
        cocoMessage.error('路线验证发现问题:\n\n' + issues.join('\n') + '\n\n请修正这些问题后重新验证');
    }
}

// 获取当前路线所有点的数学坐标系数组
function getCurrentRouteMathCoordinates() {
    if (!routePoints || routePoints.length === 0) {
        return [];
    }
    
    const mathCoordinates = [];
    
    // 遍历所有路线点，将像素坐标转换为数学坐标系的世界坐标
    routePoints.forEach((point, index) => {
        const worldCoords = pixelToWorldMath(point.x, point.y);
        
        const coordinatePoint = {
            x: worldCoords.x,
            y: worldCoords.y,
            z: 0, // 默认z坐标为0
            index: index, // 点的索引
            pixelX: point.x, // 原始像素x坐标
            pixelY: point.y, // 原始像素y坐标
            stationData: point.stationData || null // 站点数据（如果有）
        };
        
        mathCoordinates.push(coordinatePoint);
    });
    
    return mathCoordinates;
}

// 更新路线状态显示
function updateRouteStatus() {
    const routePointCountElement = document.getElementById('routePointCount');
    const routeLengthElement = document.getElementById('routeLength');
    
    // 安全地更新路线点数
    if (routePointCountElement) {
        routePointCountElement.textContent = routePoints.length;
    }
    
    // 计算路线长度
    let totalLength = 0;
    for (let i = 1; i < routePoints.length; i++) {
        const prevWorld = pixelToWorldMath(routePoints[i-1].x, routePoints[i-1].y);
        const currWorld = pixelToWorldMath(routePoints[i].x, routePoints[i].y);
        
        const dx = currWorld.x - prevWorld.x;
        const dy = currWorld.y - prevWorld.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        totalLength += distance;
    }
    

    
    // 安全地更新路线长度
    if (routeLengthElement) {
        routeLengthElement.textContent = totalLength.toFixed(3);
    }
}

// 获取当前路线所有点对应的ID信息
function getAllRoutePointIds() {
    const pointInfo = [];
    
    routePoints.forEach((point, index) => {
        const worldCoords = pixelToWorldMath(point.x, point.y);
        pointInfo.push({
            pointIndex: index,
            isOriginal: point.isOriginalPoint || false,
            originalStationId: point.stationData?.id || -1,
            pixelCoords: { x: point.x, y: point.y },
            worldCoords: worldCoords,
            stationData: point.stationData || -1
        });
    });
    
    return pointInfo;
}

// 打印当前路线所有点的ID信息（用于调试）
function logRoutePointIds() {
    const pointInfo = getAllRoutePointIds();
    
    pointInfo.forEach((point, index) => {
        const pointType = point.isOriginal ? '原始点' : '新点';
        const stationId = point.originalStationId !== -1 ? point.originalStationId : '-1';
    });
    
    return pointInfo;
}

// 显示路线信息输入弹框
function showRouteInfoModal() {
    const modal = document.getElementById('routeInfoModal');
    const routeNameInput = document.getElementById('routeNameInput');
    const routeSpeedInput = document.getElementById('routeSpeedInput');
    const confirmBtn = document.getElementById('routeInfoConfirm');
    const cancelBtn = document.getElementById('routeInfoCancel');
    const deleteBtn = document.getElementById('routeInfoDelete');
    
    if (!modal || !routeNameInput || !routeSpeedInput || !confirmBtn || !cancelBtn || !deleteBtn) {
        return;
    }
    
    // 生成默认路线名称（北京时间 UTC+8）
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000); // 加上8小时
    const defaultRouteName = '路线_' + beijingTime.toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');
    routeNameInput.value = defaultRouteName;
    routeSpeedInput.value = '0.2';
    
    // 显示弹框
    modal.classList.remove('hidden');
    
    // 在创建新路线时隐藏删除按钮
    deleteBtn.style.display = 'none';
    
    // 移除之前的事件监听器（避免重复绑定）
    confirmBtn.replaceWith(confirmBtn.cloneNode(true));
    cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    deleteBtn.replaceWith(deleteBtn.cloneNode(true));
    
    // 重新获取按钮元素
    const newConfirmBtn = document.getElementById('routeInfoConfirm');
    const newCancelBtn = document.getElementById('routeInfoCancel');
    const newDeleteBtn = document.getElementById('routeInfoDelete');
    
    // 确认按钮事件
    newConfirmBtn.addEventListener('click', function() {
        saveRouteWithInfo();
    });
    
    // 取消按钮事件
    newCancelBtn.addEventListener('click', function() {
        hideRouteInfoModal();
    });
    
    // 删除按钮事件 - 删除当前路线点
    newDeleteBtn.addEventListener('click', function() {
        deleteCurrentRoutePoint();
    });
    
    // 点击背景关闭弹框
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            hideRouteInfoModal();
        }
    });
}

// 删除当前路线点
function deleteCurrentRoutePoint() {
    if (routePoints.length === 0) {
        cocoMessage.error('没有可删除的路线点');
        return;
    }
    
    // 删除最后一个路线点
    const removedPoint = routePoints.pop();
    
    // 如果有对应的标记，也从地图上移除
    if (routeMarkers.length > 0) {
        const removedMarker = routeMarkers.pop();
        map.removeLayer(removedMarker);
    }
    
    // 重新绘制路线（更新分段及速度标签）
    updateRoutePolyline();
    
    // 更新路线状态显示
    updateRouteStatus();
    
    // 显示删除成功消息
    cocoMessage.success('已删除最后一个路线点');
    
    // 如果删除后路线点少于2个，隐藏模态框
    if (routePoints.length < 2) {
        hideRouteInfoModal();
    }
}

// 隐藏路线信息输入弹框
function hideRouteInfoModal() {
    const modal = document.getElementById('routeInfoModal');
    if (modal) {
        modal.classList.add('hidden');
    }
    
    // 清理所有拖动标记和虚线
    clearAllDragMarkers();
}

// 显示路线编辑弹框（编辑模式，显示原有数据）
function showRouteEditModal(routeInfo) {
    const modal = document.getElementById('routeInfoModal');
    const routeNameInput = document.getElementById('routeNameInput');
    const routeSpeedInput = document.getElementById('routeSpeedInput');
    const confirmBtn = document.getElementById('routeInfoConfirm');
    const cancelBtn = document.getElementById('routeInfoCancel');
    const deleteBtn = document.getElementById('routeInfoDelete');
    
    if (!modal || !routeNameInput || !routeSpeedInput || !confirmBtn || !cancelBtn || !deleteBtn) {
        return;
    }
    
    // 填充原有路线信息
    routeNameInput.value = routeInfo.routeName || '未命名路线';
    routeSpeedInput.value = routeInfo.speed || '0.2';
    
    // 保存当前编辑的路线信息
    currentEditRouteInfo = routeInfo;
    
    // 显示弹框
    modal.classList.remove('hidden');
    
    // 在编辑模式下显示删除按钮
    deleteBtn.style.display = 'inline-block';
    
    // 移除之前的事件监听器（避免重复绑定）
    confirmBtn.replaceWith(confirmBtn.cloneNode(true));
    cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    deleteBtn.replaceWith(deleteBtn.cloneNode(true));
    
    // 重新获取按钮元素
    const newConfirmBtn = document.getElementById('routeInfoConfirm');
    const newCancelBtn = document.getElementById('routeInfoCancel');
    const newDeleteBtn = document.getElementById('routeInfoDelete');
    
    // 确认按钮事件 - 调用更新函数
    newConfirmBtn.addEventListener('click', function() {
        updateRouteWithInfo();
    });
    
    // 取消按钮事件
    newCancelBtn.addEventListener('click', function() {
        hideRouteInfoModal();
    });
    
    // 删除按钮事件 - 删除当前路线点
    newDeleteBtn.addEventListener('click', function() {
        deleteCurrentRoutePoint();
    });
    
    // 点击背景关闭弹框
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            hideRouteInfoModal();
        }
    });
}

// 更新路线信息（编辑模式）
async function updateRouteWithInfo() {
    if (!currentEditRouteInfo) {
        return;
    }
    
    // 获取路线名称和速度
    const routeNameInput = document.getElementById('routeNameInput');
    const routeSpeedInput = document.getElementById('routeSpeedInput');
    
    if (!routeNameInput || !routeSpeedInput) {
        return;
    }
    
    const routeName = routeNameInput.value.trim();
    const routeSpeed = parseFloat(routeSpeedInput.value);
    
    if (!routeName) {
        cocoMessage.error('请输入路线名称');
        return;
    }
    
    if (isNaN(routeSpeed) || routeSpeed <= 0) {
        cocoMessage.error('请输入有效的速度值');
        return;
    }
    
    if (routePoints.length < 2) {
        cocoMessage.error('路线至少需要2个点');
        return;
    }
    
    // // 将像素坐标转换为数学坐标
    // const mathPoints = routePoints.map(point => {
    //     return pixelToWorldMath(point.x, point.y);
    // });
    
    // 构建请求数据
    // 处理routePoints中的站点id和站点数据
    const processedRoutePoints = routePoints.map((point, index) => {
        // 获取该点的站点数据（优先使用临时对象中的数据）
        const stationData = tempRoutePointsData[index] || point.stationData || {};
        
        // 确保保留x和y属性
        const processedPoint = {
            x: point.x,
            y: point.y,
            stationData: {}
        };
        
        if (point.stationData && point.stationData.id) {
            // 如果有stationData和id，保留原有结构并更新站点数据
            processedPoint.stationData = {
                ...point.stationData,
                action: stationData.action || "1",
                area: stationData.area || "1",
                lanechange: stationData.lanechange || "0",
                direction: stationData.direction || "0",
                speed: stationData.speed || routeSpeed,
                stopTime: stationData.stopTime || "0",
                stop: stationData.stop || "0",
                position: stationData.position || "1",
                runmode: stationData.runmode || "0"
            };
        } else {
            // 如果没有id，设置为-1并添加站点数据
            processedPoint.stationData = {
                ...point.stationData,
                id: -1,
                action: stationData.action || "1",
                area: stationData.area || "1",
                lanechange: stationData.lanechange || "0",
                direction: stationData.direction || "0",
                speed: stationData.speed || routeSpeed,
                stopTime: stationData.stopTime || "0",
                stop: stationData.stop || "0",
                position: stationData.position || "1",
                runmode: stationData.runmode || "0"
            };
        }
        
        return processedPoint;
    });
    const currentMapName = localStorage.getItem('lastMapName');
    const requestData = {
        id: String(currentEditRouteInfo.id), // 添加路线ID用于更新
        routeId: String(currentEditRouteInfo.id), // 添加路线ID用于更新
        routeName: String(routeName),
        routesource: "0",   // 路线来源
        mapName:String(currentMapName),
        speed: String(routeSpeed),
        stations: processedRoutePoints.map((point, index) => {
            // 获取世界坐标
            const worldCoords = pixelToWorldMath(point.x, point.y);
            return {
                id: point.stationData.id || -1,
                action: point.stationData.action || "1",
                area: point.stationData.area || "1",
                lanechange: point.stationData.lanechange || "0",
                direction: point.stationData.direction || "0",
                speed: point.stationData.speed || routeSpeed,
                stopTime: point.stationData.stopTime || "0",
                stop: point.stationData.stop || "0",
                position: point.stationData.position || "1",
                runmode: point.stationData.runmode || "0",
                positionX: worldCoords.x.toFixed(5),
                positionY: worldCoords.y.toFixed(5),
                stationCode: 0,
            };
        })
    };
      
        const response = await axiosClient.post('route/updateRoute', requestData);
        // 隐藏弹框
        hideRouteInfoModal();
        // 重新加载路线列表并更新选择框
        await refreshRouteSelect();
        // 更新复选框数据
        updateRouteCheckboxList();
        
        // 设置当前选中的路线为刚编辑的路线
        let mySelectRoute =  document.getElementById("routeSelect") 
        if(mySelectRoute && mySelectRoute.options.length >0){
            // 找到刚编辑的路线并选中
            for(let i = 0; i < mySelectRoute.options.length; i++){
                if(mySelectRoute.options[i].value === String(currentEditRouteInfo.id)){
                    mySelectRoute.selectedIndex = i;
                    break;
                }
            }
        }

        // 清除当前路线
        clearRoute();
        // 重新加载路线以显示编辑后的路线
        await loadRoute();
        // 重置编辑模式
        isRouteEditMode = false;
        window.isRouteEditMode = false;
        isEditMode = false;
        currentEditRouteInfo = null;
        
        // 恢复按钮文字和样式
        const editBtn = document.querySelector('button[onclick="editRoute()"]');
        if (editBtn) {
            editBtn.textContent = '修改路线';
            editBtn.classList.remove('btn-danger');
            editBtn.classList.add('btn-secondary');
        }
        
        cocoMessage.success('路线更新成功！');
     
     

}

// 刷新路线选择框
async function refreshRouteSelect(keepSelectedRoute = null) {
    try {
        const mapSelect = document.getElementById('mapSelect');
        const routeSelect = document.getElementById('routeSelect');
       const currentMapName = localStorage.getItem('lastMapName');
    
        if (!mapSelect.value) {
            return;
        }
        
        // 从服务器获取最新的路线数据
        const response = await axiosClient.get(`route/map-coverage/${currentMapName}`);
        const newRouteData = response.data.data;
        // 清空现有选项
        routeSelect.innerHTML = '';
        // 添加默认选项
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '请选择路线';
        routeSelect.appendChild(defaultOption);
        
        // 添加新的路线选项
        if (newRouteData && newRouteData.length > 0) {
            newRouteData.forEach(item => {
                if (item.routeGroup && item.routeGroup.length > 0) {
                    item.routeGroup.forEach(route => {
                        const option = document.createElement('option');
                        option.value = route.id;
                        option.textContent = route.routeName;
                        routeSelect.appendChild(option);
                    });
                }
            });
        }
        
        // 更新全局routeData变量
        routeData = newRouteData;
        
        // 恢复之前选中的路线，如果没有传入keepSelectedRoute或keepSelectedRoute为null，则选择默认的"请选择路线"
        routeSelect.value = keepSelectedRoute || '';
        
    } catch (error) {
    }
}

// 清理所有原始位置标记和虚线连接
function clearAllDragMarkers() {
    routeMarkers.forEach(marker => {
        if (marker.originalPositionMarker) {
            map.removeLayer(marker.originalPositionMarker);
            marker.originalPositionMarker = null;
        }
        if (marker.dragConnectionLine) {
            map.removeLayer(marker.dragConnectionLine);
            marker.dragConnectionLine = null;
        }
    });
    
    // 移除所有路线点的原始位置属性
    routePoints.forEach(point => {
        delete point.originalX;
        delete point.originalY;
        delete point.originalWorldX;
        delete point.originalWorldY;
    });
}

// 保存路线信息（带路线名称和速度）
async function saveRouteWithInfo() {
    const routeNameInput = document.getElementById('routeNameInput');
    const routeSpeedInput = document.getElementById('routeSpeedInput');
    
    if (!routeNameInput || !routeSpeedInput) {
        return;
    }
    
    const routeName = routeNameInput.value.trim();
    const routeSpeed = parseFloat(routeSpeedInput.value);
    
    // 验证输入
    if (!routeName) {
        cocoMessage.error('请输入路线名称');
        return;
    }
    
    if (isNaN(routeSpeed) ) {
        cocoMessage.error('请输入有效的速度值');
        return;
    }
    
    try {
        // 获取当前地图名称
        const mapSelect = document.getElementById('mapSelect');
        const currentMapName = localStorage.getItem('lastMapName');
        
        if (!currentMapName) {
            cocoMessage.error('请先选择地图');
            return;
        }
        
        // 从tempRoutePointsData构建站点数组
        const result = [];
        if (tempRoutePointsData && Object.keys(tempRoutePointsData).length > 0) {
            Object.keys(tempRoutePointsData).forEach(index => {
                const stationData = tempRoutePointsData[index];
                result.push({
                    id: Number(stationData.id) || Number(stationData.stationId) || Number(-1),
                    // routeId: stationData.routeId || "",
                    action: stationData.action || "1",
                    area: stationData.area || "1",
                    lanechange: stationData.lanechange || "0",
                    direction: stationData.direction || "0",
                    speed: stationData.speed || "0.2",
                    stopTime: stationData.stopTime || "0",
                    stop: stationData.stop || "0",
                    position: stationData.position || "1",
                    runmode: stationData.runmode || "0",
                    positionX: parseFloat(stationData.x).toFixed(5),
                    positionY: parseFloat(stationData.y).toFixed(5)
                });
            });
        }
        
        // 构建保存消息结构
        const saveMessage = { 
            routeName: String(routeName),       // 路线名称 
            routesource: "0",   
            mapName:String(currentMapName),           // 路线来源，转换为字符串 
            speed: String(routeSpeed),   // 速度，转换为字符串 
            stations: result                // 站点数组 
        };
        
        // 转换路线点为世界坐标
        const points = routePoints.map((point, index) => {
            const worldCoords = pixelToWorldMath(point.x, point.y);
            
            // 获取该点的站点数据（如果有）
            const stationData = tempRoutePointsData[index] || point.stationData || {};
            return {
              orientation:{
                w:1,
                x:0,
                y:0,
                z:0
              },
              position:{
                 x: worldCoords.x,
                 y: worldCoords.y,
                 z: 0
               },
               // 添加站点数据
               stationData: {
                   action: stationData.action || "1",
                   area: stationData.area || "1",
                   lanechange: stationData.lanechange || "0",
                   direction: stationData.direction || "0",
                   speed: stationData.speed || routeSpeed,
                   stopTime: stationData.stopTime || "0",
                   stop: stationData.stop || "0",
                   position: stationData.position || "1",
                   runmode: stationData.runmode || "0"
               }
            };
        });
        
        // 构建请求数据
        const requestData = {
            routeName:String(routeName),
            points: points,
            mapName:String(currentMapName),
            speed: String(routeSpeed)
        };
        
        // 调用接口保存路线
        // const response = await axiosClient.post('route/addWithPoints', requestData);
        const response = await axiosClient.post('route/saveRoute', saveMessage);
        
        if (response.data.code === 0) {
         cocoMessage.success("保存成功") 
            // 清理所有拖动标记和虚线
            clearAllDragMarkers();
            
            // 隐藏弹框
            hideRouteInfoModal();
            
            // 退出编辑模式
            isRouteEditMode = false;
            window.isRouteEditMode = false;
            isRouteMode = false;
            window.isRouteMode = false;
            isEditMode = false;
            window.isEditMode = false;
            
            // 设置跳过恢复编辑模式标志
            skipRestoreEditMode = true;
            
            // 移除地图点击事件
            map.off('click', onRouteMapClick);
            
            // 移除编辑模式提示
            const indicator = document.getElementById('routeModeIndicator');
            if (indicator) {
                indicator.remove();
            }
            
            // 恢复按钮文字和样式
            const editBtn = document.querySelector('button[onclick="editRoute()"]');
            if (editBtn) {
                editBtn.textContent = '修改路线';
                editBtn.classList.remove('btn-danger');
                editBtn.classList.add('btn-secondary');
            }
            
            // 清空原始路线点数据
            originalRoutePoints = [];
            
            // 重新加载路线列表并更新选择框
            await refreshRouteSelect();
            
            // 更新复选框数据
            updateRouteCheckboxList();
            
           let mySelectRoute =  document.getElementById("routeSelect")
            if(mySelectRoute.options.length >0){
                mySelectRoute.selectedIndex = mySelectRoute.options.length - 1;
            }
            // 清除当前路线
            clearRoute();
            // 重新加载当前选中的路线
            if (mySelectRoute && mySelectRoute.value) {
                await loadRoute();
            }
        } else {
            cocoMessage.error('保存路线失败: ' + (response.data.message || '未知错误'));
        }
        
    } catch (error) {
      
        cocoMessage.error('保存路线失败: ' + (error.message || '网络错误'));
    }
}

// 撤回上一步 - 清除当前路线的最后一个点
function callback() {
    // 检查是否有路线点可以撤回
    if (routePoints.length === 0) {
        cocoMessage.error('没有可撤回的路线点');
        return;
    }
    
    // 获取最后一个点的索引
    const lastIndex = routePoints.length - 1;
    
    // 调用removeRoutePoint函数移除最后一个点
    removeRoutePoint(lastIndex);
    
    // 显示撤回成功的消息
    cocoMessage.success('已撤回最后一个路线点');
}

// 路线多选展示和渲染不同颜色的功能
let routeDisplayStatus = {}; // 记录路线显示状态
let multiRoutePolylines = {}; // 存储路线线条对象（多选功能专用）
let multiRouteMarkers = {}; // 存储路线标记对象（多选功能专用）

// 路线颜色数组
const routeColors = [
  '#FF0000', // 红色
  '#00FF00', // 绿色
  '#0000FF', // 蓝色
  '#FFFF00', // 黄色
  '#FF00FF', // 紫色
  '#00FFFF', // 青色
  '#FFA500', // 橙色
  '#800080', // 深紫色
  '#008000', // 深绿色
  '#000080', // 深蓝色
  '#800000', // 深红色
  '#808000', // 橄榄色
  '#800080', // 紫色
  '#008080', // 蓝绿色
  '#C0C0C0', // 银色
  '#808080', // 灰色
  '#FFC0CB', // 粉色
  '#A52A2A', // 棕色
  '#FFD700'  // 金色
];

// 获取路线颜色
function getRouteColor(routeId) {
  // 使用routeId作为种子，确保同一条路线总是使用相同的颜色
  const index = routeId % routeColors.length;
  return routeColors[index];
}

// 初始化路线多选面板
async function initRouteMultiSelectPanel() {
  // 检查是否已经初始化过，避免重复初始化
  if (window.routePanelInitialized) {
    
    return;
  }

  const toggleButton = document.getElementById('toggleCheckboxPanel');
  const dropdown = document.getElementById('routeCheckboxContainer');
  const searchInput = document.getElementById('routeSearchInput');
  const selectButton = document.querySelector('.select-button');
  
  if (!toggleButton || !dropdown || !searchInput || !selectButton) {
    return;
  }
  
  // 确保初始状态正确
  dropdown.classList.add('collapsed');
  selectButton.classList.remove('active');
  
  // 如果还没有路线数据，先获取路线数据
  if (!routeData) {

    try {
     
     const currentMapName = localStorage.getItem('lastMapName');
      if (currentMapName) {
        const response = await axiosClient.get(`route/map-coverage/${currentMapName}`);
        routeData = response.data.data;
      } else {
      }
    } catch (error) {
    }
  }
  
  // 移除可能存在的事件监听器，避免重复绑定
  toggleButton.removeEventListener('click', handleToggleButtonClick);
  document.removeEventListener('click', handleDocumentClick);
  dropdown.removeEventListener('click', handleDropdownClick);
  document.removeEventListener('keydown', handleDocumentKeydown);
  
  // 定义事件处理函数
  function handleToggleButtonClick(e) {
    e.stopPropagation();
    
    // 确保下拉框能够正常切换显示状态
    if (dropdown.classList.contains('collapsed')) {
      dropdown.classList.remove('collapsed');
      selectButton.classList.add('active');
      
      // 展开时聚焦搜索框
      setTimeout(() => {
        searchInput.focus();
      }, 100);
    } else {
      dropdown.classList.add('collapsed');
      selectButton.classList.remove('active');
    }
  }
  
  function handleDocumentClick(e) {
    if (!selectButton.contains(e.target) && !dropdown.contains(e.target)) {
      // 确保下拉框被正确关闭
      if (!dropdown.classList.contains('collapsed')) {
        dropdown.classList.add('collapsed');
        selectButton.classList.remove('active');
      }
    }
  }
  
  function handleDropdownClick(e) {
    e.stopPropagation();
  }
  
  function handleDocumentKeydown(e) {
    if (e.key === 'Escape') {
      // 确保下拉框被正确关闭
      if (!dropdown.classList.contains('collapsed')) {
        dropdown.classList.add('collapsed');
        selectButton.classList.remove('active');
      }
    }
  }
  
  // 折叠/展开功能
  toggleButton.addEventListener('click', handleToggleButtonClick);
  
  // 搜索功能
  searchInput.addEventListener('input', (e) => {
    filterRoutes(e.target.value);
  });
  
  // 点击外部关闭下拉框
  document.addEventListener('click', handleDocumentClick);
  
  // 阻止下拉框内部点击事件冒泡
  dropdown.addEventListener('click', handleDropdownClick);
  
  // 键盘事件支持
  document.addEventListener('keydown', handleDocumentKeydown);
  
  // 初始化路线复选框列表
  updateRouteCheckboxList();
  
  // 标记已初始化
  window.routePanelInitialized = true;
}

// 生成路线复选框列表
function updateRouteCheckboxList() {
  const container = document.getElementById('routeCheckboxList');
  if (!container) {
    return;
  }
  
  container.innerHTML = '';

  if (!routeData || routeData.length === 0) {
    container.innerHTML = '<div class="no-results">暂无路线数据</div>';
    return;
  }

  // 添加全选和取消全选选项
  const selectAllDiv = document.createElement('div');
  selectAllDiv.className = 'select-option select-all-option';
  selectAllDiv.innerHTML = `
    <button type="button" class="select-all-btn" onclick="selectAllRoutes()">全选</button>
    <button type="button" class="deselect-all-btn" onclick="deselectAllRoutes()">取消全选</button>
  `;
  container.appendChild(selectAllDiv);

  // 添加分隔线
  const divider = document.createElement('div');
  divider.className = 'select-divider';
  container.appendChild(divider);

  // 遍历路线数据，为每个路线组创建复选框
  routeData.forEach(routeGroup => {
    if (routeGroup.routeGroup && routeGroup.routeGroup.length > 0) {
      routeGroup.routeGroup.forEach(route => {
        const div = document.createElement('div');
        div.className = 'select-option';
        const isChecked = routeDisplayStatus[route.id] === true;
        
        // 获取路线颜色
        const routeColor = getRouteColor(route.id);
        
        div.innerHTML = `
          <input type='checkbox'
                 class='route-checkbox' 
                 id='route_${route.id}' 
                 value='${route.id}'
                 ${isChecked ? 'checked' : ''}>
          <label for='route_${route.id}' style='display: flex; align-items: center;'>
            <span style='display: flex; width: 16px; height: 16px; background-color: ${routeColor}; margin-right: 8px; border-radius: 50%;'></span>
            ${route.routeName}
          </label>
        `;
        
        // 添加复选框事件监听
        const checkbox = div.querySelector('.route-checkbox');
        checkbox.addEventListener('change', () => {
          toggleRouteDisplay(route.id);
          updateSelectButtonText();
        });
        
        // 添加整行点击事件
        div.addEventListener('click', (e) => {
          if (e.target.type !== 'checkbox') {
            checkbox.checked = !checkbox.checked;
            toggleRouteDisplay(route.id);
            updateSelectButtonText();
          }
        });
        
        container.appendChild(div);
      });
    }
  });
}

// 更新选择框按钮文本
function updateSelectButtonText() {
  const selectText = document.querySelector('.select-text');
  if (!selectText) return;
  
  const checkedCount = Object.values(routeDisplayStatus).filter(status => status === true).length;
  
  if (checkedCount === 0) {
    selectText.textContent = '请选择路线';
  } else if (checkedCount === 1) {
    // 找到选中的路线名称
    let selectedRouteName = '';
    for (const routeGroup of routeData) {
      if (routeGroup.routeGroup && routeGroup.routeGroup.length > 0) {
        const selectedRoute = routeGroup.routeGroup.find(route => routeDisplayStatus[route.id] === true);
        if (selectedRoute) {
          selectedRouteName = selectedRoute.routeName;
          break;
        }
      }
    }
    selectText.textContent = selectedRouteName || `已选择${checkedCount}条路线`;
  } else {
    selectText.textContent = `已选择${checkedCount}条路线`;
  }
}

// 全选所有路线
function selectAllRoutes() {
  if (!routeData || routeData.length === 0) return;
  
  routeData.forEach(routeGroup => {
    if (routeGroup.routeGroup && routeGroup.routeGroup.length > 0) {
      routeGroup.routeGroup.forEach(route => {
        routeDisplayStatus[route.id] = true;
        const checkbox = document.querySelector(`#route_${route.id}`);
        if (checkbox) {
          checkbox.checked = true;
        }
        showRouteById(route.id);
      });
    }
  });
  updateSelectButtonText();
}

// 取消全选所有路线
function deselectAllRoutes() {
  if (!routeData || routeData.length === 0) return;
  
  routeData.forEach(routeGroup => {
    if (routeGroup.routeGroup && routeGroup.routeGroup.length > 0) {
      routeGroup.routeGroup.forEach(route => {
        routeDisplayStatus[route.id] = false;
        const checkbox = document.querySelector(`#route_${route.id}`);
        if (checkbox) {
          checkbox.checked = false;
        }
        hideRouteById(route.id);
      });
    }
  });
  updateSelectButtonText();
}

// 搜索路线功能
function filterRoutes(searchTerm) {
  const container = document.getElementById('routeCheckboxList');
  if (!container) return;
  
  const options = container.querySelectorAll('.select-option');
  let visibleCount = 0;
  
  // 如果搜索词为空，恢复所有选项的原始样式
  if (!searchTerm || searchTerm.trim() === '') {
    options.forEach(option => {
      option.style.display = 'flex';
      visibleCount++;
    });
    
    // 移除无结果提示
    const noResults = container.querySelector('.no-results');
    if (noResults) {
      noResults.remove();
    }
    return;
  }
  
  options.forEach(option => {
    // 跳过全选选项，不参与搜索过滤
    if (option.classList.contains('select-all-option')) {
      option.style.display = 'flex';
      visibleCount++;
      return; 
    }
    
    // 跳过分隔线
    if (option.classList.contains('select-divider')) {
      option.style.display = 'block';
      visibleCount++;
      return;
    }
    
    const labelElement = option.querySelector('label');
    if (!labelElement) {
      option.style.display = 'flex';
      visibleCount++;
      return;
    }
    
    const label = labelElement.textContent.toLowerCase();
    const matches = label.includes(searchTerm.toLowerCase());
    
    if (matches) {
      option.style.display = 'flex';
      visibleCount++;
    } else {
      option.style.display = 'none';
    }
  });
  
  // 显示或隐藏无结果提示
  let noResults = container.querySelector('.no-results');
  if (visibleCount === 0) {
    if (!noResults) {
      noResults = document.createElement('div');
      noResults.className = 'no-results';
      noResults.textContent = '没有找到匹配的路线';
      container.appendChild(noResults);
    }
  } else if (noResults) {
    noResults.remove();
  }
}

// 控制路线显示/隐藏
function toggleRouteDisplay(routeId) {
  const checkbox = document.querySelector(`#route_${routeId}`);
  if (!checkbox) return;
  
  routeDisplayStatus[routeId] = checkbox.checked;
  if (checkbox.checked) {
    showRouteById(routeId);
  } else {
    hideRouteById(routeId);
  }
  
  // 更新选择框按钮文本
  updateSelectButtonText();
}

// 显示指定路线
async function showRouteById(routeId) {
  // 声明路线站点变量
  let routeStation = null;
  
  if (!map) {
    return;
  }
  
  // 查找路线数据
  let routeDataItem = null;
  for (const routeGroup of routeData) {
    if (routeGroup.routeGroup && routeGroup.routeGroup.length > 0) {
      const route = routeGroup.routeGroup.find(r => r.id == routeId);
      if (route) {
        routeDataItem = route;
        break;
      }
    }
  }
  
  if (!routeDataItem) {
    return;
  }
  
  try {
    // 获取路线的详细数据
    const currentMapName = localStorage.getItem('lastMapName');
    // 从服务器获取最新的路线数据
    const response = await axiosClient.get(`route/map-coverage/${currentMapName}`);
    if (response.data.code != 0 || !response.data.data) {
      return;
    }
    
    // 从所有路线数据中找到当前选中的路线
    let routeDetail = null;
    const allRoutes = response.data.data;

    
    // 遍历所有路线组
    for (const routeGroup of allRoutes) {
      if (routeGroup.routeGroup && routeGroup.routeGroup.length > 0) {
        const foundRoute = routeGroup.routeGroup.find(r => r.id == routeId);
        if (foundRoute) {
          routeDetail = foundRoute;
          routeStation =  routeGroup.stations
          break;
        }
      }
    }
   
    if (!routeDetail) {
      return;
    }
    
    

    
    if (!routeStation || routeStation.length === 0) {
      return;
    }
    
    // 将站点坐标转换为地图坐标
    const routePoints = routeStation.map(station => {
      // 将世界坐标转换为像素坐标
      const pixelCoords = worldToPixelMath(station.positionX, station.positionY);
      return [pixelCoords.y, pixelCoords.x]; // Leaflet使用[lat, lng]格式
    });
    

    
    // 获取路线颜色
    const routeColor = getRouteColor(routeId);
    
    // 创建路线
    const polyline = L.polyline(routePoints, { 
      color: routeColor, 
      weight: 3,
      routeId: routeId // 将routeId存储在polyline的options中
    }).addTo(map);
    
    // 保存路线线条对象
    if (!multiRoutePolylines[routeId]) {
      multiRoutePolylines[routeId] = [];
    }
    multiRoutePolylines[routeId].push(polyline);
    
    // 为路线添加方向箭头
    for (let i = 0; i < routePoints.length - 1; i++) {
      const startPoint = routePoints[i];
      const endPoint = routePoints[i + 1];
      
      // 计算线段的角度（Leaflet坐标系：正北为0度，顺时针增加）
      const dx = endPoint[1] - startPoint[1]; // 经度差（x轴）
      const dy = endPoint[0] - startPoint[0]; // 纬度差（y轴）
      // 计算角度（弧度转角度，并调整到Leaflet坐标系）
      let angle = Math.atan2(dx, dy) * 180 / Math.PI;
      // 保持原始角度值，不进行360度转换
      
      // 计算线段中点位置
      const midPoint = [
        (startPoint[0] + endPoint[0]) / 2,
        (startPoint[1] + endPoint[1]) / 2
      ];
      
      // 创建箭头图标
      const arrowIcon = L.divIcon({
        className: 'arrow-icon',
        html: `<div style="transform-origin: center 10px; transform: rotate(${angle}deg); width: 0; height: 0; border-left: 10px solid transparent; border-right: 10px solid transparent; border-bottom: 17.3px solid ${routeColor}; position: absolute; top: 0px; left: -10px;"></div>`,
        iconSize: [20, 17.3],
        iconAnchor: [0, 10] // 锚点设在三角形底边中点
      });
      
      // 在线段中点添加箭头标记
      const arrowMarker = L.marker(midPoint, {
        icon: arrowIcon,
        routeId: routeId,
        isArrow: true // 标记这是箭头，便于后续管理
      }).addTo(map);
      
      // 保存箭头标记对象
      if (!multiRouteMarkers[routeId]) {
        multiRouteMarkers[routeId] = [];
      }
      multiRouteMarkers[routeId].push(arrowMarker);
    }
    
    // 创建起点和终点图标
    const startIcon = L.icon({
      iconUrl: '/src/assets/imges/中文起点.svg', // 起点标记图片路径
      iconSize: [25, 25],
      iconAnchor: [12.5, 30]
    });
    
    const endIcon = L.icon({
      iconUrl: '/src/assets/imges/中文终点.svg', // 终点标记图片路径
      iconSize: [25, 25],
      iconAnchor: [12.5, 30]
    });
    
    // 添加起点标记
    if (routePoints.length > 0) {
      const startPoint = routePoints[0];
      const startMarker = L.marker(startPoint, {
        icon: startIcon,
        routeId: routeId,
        isStartPoint: true // 标记这是起点
      }).addTo(map);
      
      // 保存起点标记对象
      if (!multiRouteMarkers[routeId]) {
        multiRouteMarkers[routeId] = [];
      }
      multiRouteMarkers[routeId].push(startMarker);
    }
    
    // 添加终点标记
    if (routePoints.length > 1) {
      const endPoint = routePoints[routePoints.length - 1];
      const endMarker = L.marker(endPoint, {
        icon: endIcon,
        routeId: routeId,
        isEndPoint: true // 标记这是终点
      }).addTo(map);
      
      // 保存终点标记对象
      if (!multiRouteMarkers[routeId]) {
        multiRouteMarkers[routeId] = [];
      }
      multiRouteMarkers[routeId].push(endMarker);
    }
    
    // 为每个站点添加标签
    routeStation.forEach((station, index) => {
      // 将世界坐标转换为像素坐标
      const pixelCoords = worldToPixelMath(station.positionX, station.positionY);
      
      // 创建站点标记
      const marker = L.circleMarker([pixelCoords.y, pixelCoords.x], {
        radius: 6,
        fillColor: routeColor, // 使用路线颜色
        color: '#000',
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8,
        routeId: routeId, // 存储routeId以便后续管理
        stationIndex: index // 存储站点索引
      }).addTo(map);
      
      // 添加站点标签
      const stationName = station.stationName || `站点${index + 1}`;
      marker.bindTooltip(stationName, {
        permanent: false, // 鼠标悬停时显示标签
        direction: 'right', // 标签显示在标记右侧
        className: 'station-label', // 自定义CSS类名
        offset: [10, 0] // 偏移量，避免与标记重叠
      });
      
      // 保存站点标记对象
      if (!multiRouteMarkers[routeId]) {
        multiRouteMarkers[routeId] = [];
      }
      multiRouteMarkers[routeId].push(marker);
      
  
    });
    
  
  } catch (error) {
    console.error(`显示路线时发生错误: routeId=${routeId}`, error);
  }
}

// 隐藏指定路线
function hideRouteById(routeId) {
  // 隐藏路线线条
  if (multiRoutePolylines[routeId]) {
    multiRoutePolylines[routeId].forEach(polyline => {
      if (map.hasLayer(polyline)) {
        map.removeLayer(polyline);
      }
    });
    delete multiRoutePolylines[routeId];
 
  }
  
  // 隐藏路线标记（包括箭头、起点、终点和站点标记）
  if (multiRouteMarkers[routeId]) {
    multiRouteMarkers[routeId].forEach(marker => {
      if (map.hasLayer(marker)) {
        map.removeLayer(marker);
      }
    });
    delete multiRouteMarkers[routeId];

  }
}

// 将函数暴露到全局作用域，以便HTML中的onclick事件可以调用
window.selectAllRoutes = selectAllRoutes;
window.deselectAllRoutes = deselectAllRoutes;

// 在页面加载完成后初始化路线多选面板
document.addEventListener('DOMContentLoaded', function() {
  // 延迟初始化，确保地图和路线数据已加载
  setTimeout(async () => {
    await initRouteMultiSelectPanel();
  }, 3000); // 增加延迟时间，确保所有组件都已加载
});

// 添加一个全局函数，用于在地图加载完成后初始化路线多选面板
window.initRoutePanelAfterMapLoad = async function() {
  await initRouteMultiSelectPanel();
};

// 初始化固定位置的站点属性框
function initFixedStationInfoBox() {
    // 如果已经存在固定属性框，则先移除
    if (fixedStationInfoBox) {
        document.body.removeChild(fixedStationInfoBox);
    }
    
    // 创建固定位置的站点属性框
    fixedStationInfoBox = document.createElement('div');
    fixedStationInfoBox.id = 'fixedStationInfoBox';
    fixedStationInfoBox.style.position = 'fixed';
    fixedStationInfoBox.style.left = '20px';
    fixedStationInfoBox.style.top = '50%';
    fixedStationInfoBox.style.transform = 'translateY(-50%)';
    fixedStationInfoBox.style.zIndex = '1000';
    fixedStationInfoBox.style.display = 'none';
    fixedStationInfoBox.style.background = 'white';
    fixedStationInfoBox.style.borderRadius = '8px';
    fixedStationInfoBox.style.width = '32vw'; // 增加宽度以适应水平布局
    fixedStationInfoBox.style.height = '40vh'; // 添加固定高度
    fixedStationInfoBox.style.overflowY = 'auto'; // 添加垂直滚动条
    fixedStationInfoBox.style.padding = '20px';
    fixedStationInfoBox.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
    
    // 创建关闭按钮
    const closeBtn = document.createElement('div');
    closeBtn.id = 'fixed-station-close-btn';
    closeBtn.innerHTML = '×';
    closeBtn.style.cssText = `
        position: absolute;
        top: 10px;
        right: 10px;
        width: 24px;
        height: 24px;
        font-size: 20px;
        line-height: 24px;
        text-align: center;
        cursor: pointer;
        color: #666;
        background-color: #f0f0f0;
        border-radius: 50%;
        transition: all 0.2s ease;
    `;
    
    // 添加关闭按钮悬停效果
    closeBtn.addEventListener('mouseenter', function() {
        this.style.backgroundColor = '#e0e0e0';
        this.style.color = '#333';
    });
    
    closeBtn.addEventListener('mouseleave', function() {
        this.style.backgroundColor = '#f0f0f0';
        this.style.color = '#666';
    });
    
    // 将关闭按钮添加到属性框
    fixedStationInfoBox.appendChild(closeBtn);
    
    // 克隆原始站点属性框的内容
    const originalPopup = document.getElementById('stationPopup');
    if (originalPopup) {
        const clonedContent = originalPopup.cloneNode(true);
        clonedContent.style.display = 'block';
        
        // 确保所有按钮都有正确的ID
        const buttons = clonedContent.querySelectorAll('button');
        buttons.forEach(btn => {
            const originalId = btn.id;
            if (originalId) {
                // 如果按钮没有ID或者ID为空，根据其文本内容设置ID
                if (!originalId || originalId === '') {
                    if (btn.textContent.includes('取消')) {
                        btn.id = 'station-cancel-btn';
                    } else if (btn.textContent.includes('删除')) {
                        btn.id = 'station-delete-btn';
                    } else if (btn.textContent.includes('保存')) {
                        btn.id = 'station-confirm-btn';
                    } else if (btn.textContent.includes('箭头绘制')) {
                        btn.id = 'chooseHeader';
                    }
                }
            }
        });
        
        fixedStationInfoBox.appendChild(clonedContent);
    }
    
    // 添加到文档中
    document.body.appendChild(fixedStationInfoBox);
    
    // 添加自定义样式来调整布局
    const style = document.createElement('style');
    style.textContent = `
        #fixedStationInfoBox .form-row {
            display: flex;
            gap: 15px;
            margin-bottom: 15px;
           
        }
        
        #fixedStationInfoBox .form-group {
            flex: 1;
        }
        
        #fixedStationInfoBox .form-group label {
            display: block;
            font-size: 13px;
            margin-bottom: 6px;
            color: #333;
            font-weight: 500;
        }
        
        #fixedStationInfoBox .form-group select,
        #fixedStationInfoBox .form-group input {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 13px;
            background-color: #f9f9f9;
        }
        
        #fixedStationInfoBox .radio-group {
            display: flex;
            gap: 15px;
            margin-top: 5px;
        }
        
        #fixedStationInfoBox .radio-item {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        
        #fixedStationInfoBox .radio-item input[type="radio"] {
            width: auto;
            margin: 0;
        }
        
        #fixedStationInfoBox .radio-item label {
            margin: 0;
            font-size: 13px;
        }
    `;
    document.head.appendChild(style);
    
    // 重新组织表单布局
    setTimeout(() => {
        const clonedContent = fixedStationInfoBox.querySelector('.leaflet-popup-content');
        if (clonedContent) {
            // 获取所有表单元素
            const actionGroup = clonedContent.querySelector('div:has(#station-action)');
            const areaGroup = clonedContent.querySelector('div:has(#station-area)');
            const avoidGroup = clonedContent.querySelector('div:has(#station-avoid)');
            const turnModeGroup = clonedContent.querySelector('div:has(#turnModeSelf)');
            
            // 创建新的行容器
            const firstRow = document.createElement('div');
            firstRow.className = 'form-row';
            
            // 将动作类型和避障等级放在同一行
            if (actionGroup) {
                const actionForm = document.createElement('div');
                actionForm.className = 'form-group';
                actionForm.innerHTML = `
                    <label>动作类型:</label>
                    ${actionGroup.querySelector('#station-action').outerHTML}
                `;
                firstRow.appendChild(actionForm);
                actionGroup.style.display = 'none';
            }
            
            if (areaGroup) {
                const areaForm = document.createElement('div');
                areaForm.className = 'form-group';
                areaForm.innerHTML = `
                    <label>避障等级:</label>
                    ${areaGroup.querySelector('#station-area').outerHTML}
                `;
                firstRow.appendChild(areaForm);
                areaGroup.style.display = 'none';
            }
            
            // 创建第二行容器
            const secondRow = document.createElement('div');
            secondRow.className = 'form-row';
            
            // 将变道模式和转向模式放在同一行
            if (avoidGroup) {
                const avoidForm = document.createElement('div');
                avoidForm.className = 'form-group';
                avoidForm.innerHTML = `
                    <label>变道模式:</label>
                    ${avoidGroup.querySelector('#station-avoid').outerHTML}
                `;
                secondRow.appendChild(avoidForm);
                avoidGroup.style.display = 'none';
            }
            
            if (turnModeGroup) {
                const turnModeForm = document.createElement('div');
                turnModeForm.className = 'form-group';
                turnModeForm.innerHTML = `
                    <label>转向模式:</label>
                    <div class="radio-group">
                        <div class="radio-item">
                            <input type="radio" name="turnMode" id="turnModeSelf" value="1">
                            <label for="turnModeSelf">自转模式</label>
                        </div>
                        <div class="radio-item">
                            <input type="radio" name="turnMode" id="turnModeContinuous" value="0" checked>
                            <label for="turnModeContinuous">连续模式</label>
                        </div>
                    </div>
                `;
                secondRow.appendChild(turnModeForm);
                turnModeGroup.style.display = 'none';
            }
            
            // 将新行插入到内容中
            clonedContent.insertBefore(firstRow, clonedContent.firstChild);
            clonedContent.insertBefore(secondRow, clonedContent.firstChild);
        }
    }, 50);
    
    // 使用setTimeout确保DOM更新完成后再绑定事件
    setTimeout(() => {
        console.log('DOM更新完成，开始绑定事件');
        setupFixedStationInfoBoxEvents();
    }, 100);
}

// 设置固定位置站点属性框的事件监听器
function setupFixedStationInfoBoxEvents() {
    if (!fixedStationInfoBox) {
        return;
    }
    
    // 获取关闭按钮
    const closeBtn = fixedStationInfoBox.querySelector('#fixed-station-close-btn');
    
    // 为关闭按钮添加点击事件，功能与取消按钮相同
    if (closeBtn) {
        closeBtn.addEventListener('click', function() {
            hideFixedStationInfoBox();
        });
    }
    
    // 获取属性框内的按钮和单选框
    const cancelBtn = fixedStationInfoBox.querySelector('#station-cancel-btn');
    const deleteBtn = fixedStationInfoBox.querySelector('#station-delete-btn');
    const confirmBtn = fixedStationInfoBox.querySelector('#station-confirm-btn');
    const chooseHeaderBtn = fixedStationInfoBox.querySelector('#chooseHeader');
    const pointToNextRadio = fixedStationInfoBox.querySelector('#pointToNext');
    const keepDirectionRadio = fixedStationInfoBox.querySelector('#keepDirection');
    const manualDirectionRadio = fixedStationInfoBox.querySelector('#manualDirection');
    
    // 取消按钮事件
    if (cancelBtn) {
        cancelBtn.onclick = function() {
            // 隐藏移动信息框
            const movementInfoDiv = fixedStationInfoBox.querySelector('#movement-info');
            if (movementInfoDiv) {
                movementInfoDiv.style.display = 'none';
            }
            hideFixedStationInfoBox();
        };
    }
    
    // 删除按钮事件
    if (deleteBtn) {
        deleteBtn.onclick = function() {
            if (currentStationIndex >= 0 && currentStationIndex < routePoints.length) {
                // 隐藏移动信息框
                const movementInfoDiv = fixedStationInfoBox.querySelector('#movement-info');
                if (movementInfoDiv) {
                    movementInfoDiv.style.display = 'none';
                }
                
                // 删除站点
                routePoints.splice(currentStationIndex, 1);
                delete tempRoutePointsData[currentStationIndex];
                
                // 更新后续站点的索引
                for (let i = currentStationIndex; i < routePoints.length; i++) {
                    if (tempRoutePointsData[i+1]) {
                        tempRoutePointsData[i] = tempRoutePointsData[i+1];
                        delete tempRoutePointsData[i+1];
                    }
                }
                
                // 重新绘制路线
                redrawRoute();
                
                // 隐藏属性框
                hideFixedStationInfoBox();
            }
        };
    }
    
    // 箭头绘制按钮事件
    if (chooseHeaderBtn) {
        chooseHeaderBtn.onclick = function() {
            // 检查currentStationIndex是否有效
            if (typeof currentStationIndex === 'undefined' || currentStationIndex === null) {
                cocoMessage.error('站点索引未设置，请重新选择站点');
                return;
            }
            
            if (typeof currentStationIndex !== 'number') {
                cocoMessage.error('站点索引类型错误，请重新选择站点');
                return;
            }
            
            if (currentStationIndex < 0) {
                cocoMessage.error('无效的站点索引，请重新选择站点');
                return;
            }
            
            if (!routePoints || routePoints.length === 0) {
                cocoMessage.error('没有可用的路线点');
                return;
            }
            
            if (currentStationIndex >= routePoints.length) {
                cocoMessage.error(`站点索引${currentStationIndex}超出范围(0-${routePoints.length-1})，请重新选择站点`);
                return;
            }
            
            // 自动选中"手动绘制"单选框
            if (manualDirectionRadio) {
                manualDirectionRadio.checked = true;
            }
            
            // 不隐藏属性框，保持站点属性框可见
            // hideFixedStationInfoBox(false);
            
            // 启动箭头绘制功能
            startArrowDrawingFromStation(currentStationIndex);
           
            // 不重置索引，保持站点属性框可用
            // currentStationMarker = null;
            // currentStationIndex = -1;
        };
    } else {
        // 尝试通过其他方式获取按钮
        const allButtons = fixedStationInfoBox.querySelectorAll('button');
        allButtons.forEach((btn, index) => {
            if (btn.textContent.includes('箭头绘制')) {
                btn.onclick = function() {
                    // 检查currentStationIndex是否有效
                    if (typeof currentStationIndex === 'undefined' || currentStationIndex === null) {
                        cocoMessage.error('站点索引未设置，请重新选择站点');
                        return;
                    }
                    
                    if (currentStationIndex < 0) {
                        cocoMessage.error('无效的站点索引，请重新选择站点');
                        return;
                    }
                    
                    if (!routePoints || routePoints.length === 0) {
                        cocoMessage.error('没有可用的路线点');
                        return;
                    }
                    
                    if (currentStationIndex >= routePoints.length) {
                        cocoMessage.error('站点索引超出范围，请重新选择站点');
                        return;
                    }
                    
                    // 自动选中"手动绘制"单选框
                    if (manualDirectionRadio) {
                        manualDirectionRadio.checked = true;
                    }
                    
                    // 不隐藏属性框，保持站点属性框可见
                    // hideFixedStationInfoBox(false);
                    
                    // 启动箭头绘制功能
                    startArrowDrawingFromStation(currentStationIndex);
                    
                    // 不重置索引，保持站点属性框可用
                    // currentStationMarker = null;
                    // currentStationIndex = -1;
                };
            }
        });
    }
    
    // 手动绘制单选框事件
    if (manualDirectionRadio) {
        manualDirectionRadio.onchange = function() {
            if (this.checked) {
                // 当选择"手动绘制"时，显示方向输入框
                const directionInputContainer = fixedStationInfoBox.querySelector('#stationDirectionInputContainer');
                if (directionInputContainer) {
                    directionInputContainer.style.display = 'block';
                }
                cocoMessage.info('已选择手动绘制模式，航向将保持当前值');
            }
        };
    }
    
    // 指向下一点单选框事件
    if (pointToNextRadio) {
        pointToNextRadio.onchange = function() {
            if (this.checked) {
                // 当选择"指向下一点"时，隐藏方向输入框
                const directionInputContainer = fixedStationInfoBox.querySelector('#stationDirectionInputContainer');
                if (directionInputContainer) {
                    directionInputContainer.style.display = 'none';
                }
                // 计算当前站点到下一个站点的角度
                if (currentStationIndex >= 0 && currentStationIndex < routePoints.length - 1) {
                    // 获取当前站点和下一个站点的坐标
                    const currentPoint = routePoints[currentStationIndex];
                    const nextPoint = routePoints[currentStationIndex + 1];
                    
                    // 计算世界坐标
                    const currentWorldCoords = pixelToWorldMath(currentPoint.x, currentPoint.y);
                    const nextWorldCoords = pixelToWorldMath(nextPoint.x, nextPoint.y);
                    
                    // 计算角度
                    const dx = nextWorldCoords.x - currentWorldCoords.x;
                    const dy = nextWorldCoords.y - currentWorldCoords.y;
                    const angleRadians = Math.atan2(dy, dx);
                    const angleDegrees = angleRadians * (180 / Math.PI);
                    
                    // 设置方向输入框的值
                    const directionInput = fixedStationInfoBox.querySelector('#station-direction');
                    if (directionInput) {
                        directionInput.value = angleDegrees.toFixed(2);
                    }
                    
                    cocoMessage.info(`已设置指向下一点的角度: ${angleDegrees.toFixed(2)}°`);
                } else if (currentStationIndex >= 0 && currentStationIndex === routePoints.length - 1) {
                    cocoMessage.error('当前是最后一个站点，没有下一个站点可以指向');
                    // 如果是最后一个站点，恢复到"保持原方向"
                    this.checked = false;
                    if (keepDirectionRadio) {
                        keepDirectionRadio.checked = true;
                    }
                }
            }
        };
    }
    
    // 保持原方向单选框事件
    if (keepDirectionRadio) {
        keepDirectionRadio.onchange = function() {
            if (this.checked) {
                // 当选择"保持原方向"时，隐藏方向输入框
                const directionInputContainer = fixedStationInfoBox.querySelector('#stationDirectionInputContainer');
                if (directionInputContainer) {
                    directionInputContainer.style.display = 'none';
                }
                
                // 计算上一个站点到当前站点的角度
                if (currentStationIndex > 0 && currentStationIndex < routePoints.length) {
                    // 获取上一个站点和当前站点的坐标
                    const prevPoint = routePoints[currentStationIndex - 1];
                    const currentPoint = routePoints[currentStationIndex];
                    
                    // 计算世界坐标
                    const prevWorldCoords = pixelToWorldMath(prevPoint.x, prevPoint.y);
                    const currentWorldCoords = pixelToWorldMath(currentPoint.x, currentPoint.y);
                    
                    // 计算角度
                    const dx = currentWorldCoords.x - prevWorldCoords.x;
                    const dy = currentWorldCoords.y - prevWorldCoords.y;
                    const angleRadians = Math.atan2(dy, dx);
                    const angleDegrees = angleRadians * (180 / Math.PI);
                    
                    // 设置方向输入框的值
                    const directionInput = fixedStationInfoBox.querySelector('#station-direction');
                    if (directionInput) {
                        directionInput.value = angleDegrees.toFixed(2);
                    }
                    
                    cocoMessage.info(`已设置保持原方向的角度(从上一点到当前点): ${angleDegrees.toFixed(2)}°`);
                } else if (currentStationIndex === 0) {
                    cocoMessage.error('当前是起点，没有上一个站点');
                    // 如果是起点，恢复到"指向下一点"
                    this.checked = false;
                    if (pointToNextRadio) {
                        pointToNextRadio.checked = true;
                        // 触发指向下一点的事件
                        pointToNextRadio.onchange();
                    }
                }
            }
        };
    }
    
    // 设置单选框状态和角度值
    if (currentStationIndex >= 0 && currentStationIndex < routePoints.length) {
        // 所有站点默认选择"指向下一点"
        if (pointToNextRadio) {
            pointToNextRadio.checked = true;
            // 触发指向下一点的事件
            pointToNextRadio.onchange();
        }
    }
    
    // 保存按钮事件
    if (confirmBtn) {
        confirmBtn.onclick = async function() {
            if (currentStationIndex >= 0 && currentStationIndex < routePoints.length) {
                // 隐藏移动信息框
                const movementInfoDiv = fixedStationInfoBox.querySelector('#movement-info');
                if (movementInfoDiv) {
                    movementInfoDiv.style.display = 'none';
                }
                
                // 获取表单数据
                const action = fixedStationInfoBox.querySelector('#station-action').value;
                const area = fixedStationInfoBox.querySelector('#station-area').value;
                const avoid = fixedStationInfoBox.querySelector('#station-avoid').value;
                const turnModeSelf = fixedStationInfoBox.querySelector('#turnModeSelf').checked;
                const isStopSelect = fixedStationInfoBox.querySelector('#isStopSelect').value;
                const direction = fixedStationInfoBox.querySelector('#station-direction').value;
                const speed = fixedStationInfoBox.querySelector('#station-speed').value;
                const workDurationInput = fixedStationInfoBox.querySelector('#station-work-duration');
                const rawWorkDuration = workDurationInput ? workDurationInput.value.trim() : '';
                const workDuration = rawWorkDuration === '' ? '0' : rawWorkDuration;
                const parsedWorkDuration = Number(workDuration);
                if (!Number.isFinite(parsedWorkDuration) || parsedWorkDuration < 0) {
                    cocoMessage.error('作业时长必须是大于等于0的数字（单位：秒）');
                    return;
                }
                const normalizedWorkDuration = String(parsedWorkDuration);
                const coordXInput = fixedStationInfoBox.querySelector('#station-coord-x');
                const coordYInput = fixedStationInfoBox.querySelector('#station-coord-y');
                
                // 获取输入框的坐标值（世界坐标）
                const inputWorldX = parseFloat(coordXInput ? coordXInput.value : '0');
                const inputWorldY = parseFloat(coordYInput ? coordYInput.value : '0');
                
                // 保存站点数据
                if (!tempRoutePointsData[currentStationIndex]) {
                    tempRoutePointsData[currentStationIndex] = {};
                }
                
                // 获取当前像素坐标
                const currentPixel = routePoints[currentStationIndex];
                const currentWorldCoords = pixelToWorldMath(currentPixel.x, currentPixel.y);
                
                // 检查坐标是否被修改
                const isCoordModified = Math.abs(inputWorldX - currentWorldCoords.x) > 0.0001 || 
                                         Math.abs(inputWorldY - currentWorldCoords.y) > 0.0001;
                
                // 如果坐标被修改，则更新像素坐标
                if (isCoordModified) {
                    const newPixel = worldToPixelMath(inputWorldX, inputWorldY);
                    routePoints[currentStationIndex] = {
                        x: newPixel.x,
                        y: newPixel.y,
                        stationData: routePoints[currentStationIndex].stationData
                    };
                    // 重新绘制路线
                    redrawRoute();
                }
                
                tempRoutePointsData[currentStationIndex].action = action;
                tempRoutePointsData[currentStationIndex].area = area;
                tempRoutePointsData[currentStationIndex].lanechange = avoid;
                tempRoutePointsData[currentStationIndex].runmode = turnModeSelf ? '1' : '0';
                tempRoutePointsData[currentStationIndex].stop = isStopSelect;
                tempRoutePointsData[currentStationIndex].direction = direction;
                tempRoutePointsData[currentStationIndex].speed = speed;
                tempRoutePointsData[currentStationIndex].stopTime = normalizedWorkDuration;
                // 更新坐标信息（使用输入框的值）
                tempRoutePointsData[currentStationIndex].x = inputWorldX.toFixed(5);
                tempRoutePointsData[currentStationIndex].y = inputWorldY.toFixed(5);
                tempRoutePointsData[currentStationIndex].position = "1";
                
                // 获取当前路线的routeid
                const routeId = document.getElementById("routeSelect").value;
                tempRoutePointsData[currentStationIndex].routeId = routeId;
                
                // 如果有站点ID，也保存到临时对象中
                if (routePoints[currentStationIndex].stationData && routePoints[currentStationIndex].stationData.id) {
                    tempRoutePointsData[currentStationIndex].id = String(routePoints[currentStationIndex].stationData.id);
                }
                
                // 更新routePoints中的数据
                if (!routePoints[currentStationIndex].stationData) {
                    routePoints[currentStationIndex].stationData = {};
                }
                
                routePoints[currentStationIndex].stationData.action = action;
                routePoints[currentStationIndex].stationData.area = area;
                routePoints[currentStationIndex].stationData.lanechange = avoid;
                routePoints[currentStationIndex].stationData.direction = direction;
                routePoints[currentStationIndex].stationData.speed = speed;
                routePoints[currentStationIndex].stationData.stopTime = normalizedWorkDuration;
                // 更新坐标信息
                routePoints[currentStationIndex].stationData.positionX = inputWorldX.toFixed(5);
                routePoints[currentStationIndex].stationData.positionY = inputWorldY.toFixed(5);
                
                // 如果有routeId，也保存到stationData中
                if (routeId) {
                    routePoints[currentStationIndex].stationData.routeId = routeId;
                }
                // 如果有站点ID，确保stationData中也有
                if (tempRoutePointsData[currentStationIndex].id) {
                    routePoints[currentStationIndex].stationData.stationId = tempRoutePointsData[currentStationIndex].id;
                    routePoints[currentStationIndex].stationData.id = tempRoutePointsData[currentStationIndex].id;
                }
                // 先保存当前索引，因为hideFixedStationInfoBox会重置它
                const stationIndex = currentStationIndex;
                try {
                    const responseUpdateRouteDetail = await axiosClient.post("route/updateRouteDetail", routePoints[stationIndex].stationData);
                    const responseUpdateStation = await axiosClient.post("/station/update", routePoints[stationIndex].stationData);
                    cocoMessage.success('站点属性已保存');
                    // 重新查询路线信息以更新显示
                    try {
                        await loadRoute();
                    } catch (reloadError) {
                        console.error('重新加载路线信息失败:', reloadError);
                    }
                } catch (error) {
                    console.error('保存站点数据失败:', error);
                    cocoMessage.error('保存站点数据失败: ' + (error.response?.data?.message || error.message));
                }
                hideFixedStationInfoBox();
            }
        };
    }
}

// 显示固定位置的站点属性框
function showFixedStationInfoBox(marker, index) {
    if (!fixedStationInfoBox) {
        initFixedStationInfoBox();
    }
    
    // 保存当前选中的站点信息
    currentStationMarker = marker;
    currentStationIndex = index;
    
    // 获取站点数据 - 优先从临时对象中获取，如果没有则从routePoints中获取
    let pointData = {};
    if (tempRoutePointsData && tempRoutePointsData[index]) {
        pointData = tempRoutePointsData[index];
    } else if (routePoints[index] && routePoints[index].stationData) {
        // 从stationData中提取需要的字段
        const stationData = routePoints[index].stationData;
        pointData = {
            action: stationData.action || '1',
            area: stationData.area || '1',
            lanechange: stationData.lanechange || '0',
            direction: stationData.direction || '0',
            speed: stationData.speed || '0.5',
            stopTime: stationData.stopTime || '0',
            runmode: stationData.runmode || localStorage.getItem('globalTurnMode') || '0',
            stop: stationData.stop || '0'
        };
    }
    
    // 更新属性框内容
    const point = routePoints[index];
    const worldCoords = pixelToWorldMath(point.x, point.y);
    
    // 更新坐标输入框
    const coordXInput = fixedStationInfoBox.querySelector('#station-coord-x');
    const coordYInput = fixedStationInfoBox.querySelector('#station-coord-y');
    const nameDisplay = fixedStationInfoBox.querySelector('#stationNameDisplay');
    if (coordXInput) coordXInput.value = worldCoords.x.toFixed(3);
    if (coordYInput) coordYInput.value = worldCoords.y.toFixed(3);
    if (nameDisplay) nameDisplay.textContent = `路线点 ${index + 1}`;
    
    // 设置表单值
    const actionSelect = fixedStationInfoBox.querySelector('#station-action');
    if (actionSelect) {
        actionSelect.value = pointData.action || '1';
    }
    
    const areaSelect = fixedStationInfoBox.querySelector('#station-area');
    if (areaSelect) {
        areaSelect.value = pointData.area || '1';
    }
    
    const avoidSelect = fixedStationInfoBox.querySelector('#station-avoid');
    if (avoidSelect) {
        avoidSelect.value = pointData.lanechange || '0';
    }
    
    const turnModeSelf = fixedStationInfoBox.querySelector('#turnModeSelf');
    const turnModeContinuous = fixedStationInfoBox.querySelector('#turnModeContinuous');
    if (turnModeSelf && turnModeContinuous) {
        if (pointData.runmode === '1') {
            turnModeSelf.checked = true;
            turnModeContinuous.checked = false;
        } else {
            turnModeSelf.checked = false;
            turnModeContinuous.checked = true;
        }
    }
    
    const isStopSelect = fixedStationInfoBox.querySelector('#isStopSelect');
    if (isStopSelect) {
        isStopSelect.value = pointData.stop || "0";
    }
    
    const directionInput = fixedStationInfoBox.querySelector('#station-direction');
    if (directionInput) {
        directionInput.value = pointData.direction || '0';
    }
    
    const speedInput = fixedStationInfoBox.querySelector('#station-speed');
    if (speedInput) {
        speedInput.value = pointData.speed || '0.5';
    }

    const workDurationInput = fixedStationInfoBox.querySelector('#station-work-duration');
    if (workDurationInput) {
        workDurationInput.value = pointData.stopTime != null ? pointData.stopTime : '0';
    }
    
    // 根据站点位置设置默认单选框状态
    const totalPoints = routePoints.length;
    
    // 先清除所有单选框的选中状态
    const manualRadio = fixedStationInfoBox.querySelector('#manualDirection');
    const pointToNextRadio = fixedStationInfoBox.querySelector('#pointToNext');
    const keepDirectionRadio = fixedStationInfoBox.querySelector('#keepDirection');
    
    if (manualRadio) manualRadio.checked = false;
    if (pointToNextRadio) pointToNextRadio.checked = false;
    if (keepDirectionRadio) keepDirectionRadio.checked = false;
    
    // 所有站点默认选中"指向下一点"
    if (pointToNextRadio) {
        pointToNextRadio.checked = true;
        // 隐藏方向输入框
        const directionInputContainer = fixedStationInfoBox.querySelector('#stationDirectionInputContainer');
        if (directionInputContainer) {
            directionInputContainer.style.display = 'none';
        }
        
        // 计算并显示指向下一点的方向值
        if (index < totalPoints - 1) {
            // 如果不是最后一个点，计算当前点到下一个点的方向
            const nextPoint = routePoints[index + 1];
            const dx = nextPoint.x - routePoints[index].x;
            const dy = nextPoint.y - routePoints[index].y;
            // 计算角度并转换为度数
            let angle = Math.atan2(dy, dx) * (180 / Math.PI);
            // 保持原始角度值，不进行360度转换
            const directionToNext = angle.toFixed(2).toString();
            
            // 更新方向输入框的值
            const directionInput = fixedStationInfoBox.querySelector('#station-direction');
            if (directionInput) {
                directionInput.value = directionToNext;
            }
        } else if (index > 0) {
            // 如果是最后一个点，计算上一个点到当前点的方向
            const prevPoint = routePoints[index - 1];
            const dx = routePoints[index].x - prevPoint.x;
            const dy = routePoints[index].y - prevPoint.y;
            // 计算角度并转换为度数
            let angle = Math.atan2(dy, dx) * (180 / Math.PI);
            // 保持原始角度值，不进行360度转换
            const directionToNext = angle.toFixed(2).toString();
            
            // 更新方向输入框的值
            const directionInput = fixedStationInfoBox.querySelector('#station-direction');
            if (directionInput) {
                directionInput.value = directionToNext;
            }
        }
    }
    
    // 显示属性框
    fixedStationInfoBox.style.display = 'block';
}

// 隐藏固定位置的站点属性框
function hideFixedStationInfoBox(resetIndex = true) {
    if (fixedStationInfoBox) {
        fixedStationInfoBox.style.display = 'none';
    }
    if (resetIndex) {
        currentStationMarker = null;
        currentStationIndex = -1;
    }
}

// 重新绘制路线
function redrawRoute() {
    // 清除现有标记
    routeMarkers.forEach(marker => {
        map.removeLayer(marker);
    });
    routeMarkers = [];
    
    // 清除现有线条
    if (routePolyline) {
        map.removeLayer(routePolyline);
        routePolyline = null;
    }
    
    // 清除现有矩形框
    routeRectangles.forEach(rect => {
        map.removeLayer(rect);
    });
    routeRectangles = [];
    
    // 重新创建路线
    if (routePoints.length > 0) {
        // 创建路线线条及分段速度标签
        updateRoutePolyline();
        
        // 重新创建站点标记
        routePoints.forEach((point, index) => {
            const pointIcon = L.divIcon({
                className: 'route-point-marker',
                html: '<div style="background: #007cba; width: 20px; height: 20px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5); cursor: pointer;"></div>',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });
            
            const marker = L.marker([point.y, point.x], { icon: pointIcon, draggable: true }).addTo(map);
            
            // 添加拖拽事件
            marker.on('dragstart', function(e) {
                isDragging = true;
                dragPointIndex = routeMarkers.indexOf(marker);
            });
            
            marker.on('drag', function(e) {
                if (isDragging && dragPointIndex >= 0) {
                    const newPos = e.target.getLatLng();
                    routePoints[dragPointIndex] = { x: newPos.lng, y: newPos.lat };
                    updateRoutePolyline();
                    updateAllRectangles();
                }
            });
            
            marker.on('dragend', function(e) {
                isDragging = false;
                dragPointIndex = -1;
            });
            
            // 替换bindPopup为点击事件，使用固定位置属性框
            marker.on('click', function(e) {
                // 使用闭包保存当前索引，确保索引一致性
                const currentIndex = index;
                if (currentIndex !== -1) {
                    showFixedStationInfoBox(marker, currentIndex);
                }
            });
            
            routeMarkers.push(marker);
        });
        
        // 重新创建矩形框
        for (let i = 0; i < routePoints.length - 1; i++) {
            const rect = createDraggableRectangleBetweenPoints(routePoints[i], routePoints[i + 1], i);
            routeRectangles.push(rect);
        }
    }
    
    // 更新路线状态显示
    updateRouteStatus();
}

// 全局设置功能
document.addEventListener('DOMContentLoaded', function() {
    // 获取DOM元素
    const saveGlobalSettingsBtn = document.getElementById('saveGlobalSettings');
    const openGlobalSettingsBtn = document.getElementById('openGlobalSettings');
    
    // 添加方向选项单选框的事件监听器
    const directionOptionRadios = document.querySelectorAll('input[name="directionOption"]');
    const directionInputContainer = document.getElementById('directionInputContainer');
    
    // 为全局设置中的方向选项添加事件监听器
    directionOptionRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            if (this.value === 'useAngle' && this.checked) {
                directionInputContainer.style.display = 'block';
            } else {
                directionInputContainer.style.display = 'none';
            }
        });
    });
    
    // 为当前路线设置中的方向选项添加事件监听器
    const currentDirectionOptionRadios = document.querySelectorAll('input[name="currentDirectionOption"]');
    const currentDirectionInputContainer = document.getElementById('currentDirectionInputContainer');
    
    currentDirectionOptionRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            if (this.value === 'useAngle' && this.checked) {
                currentDirectionInputContainer.style.display = 'block';
            } else {
                currentDirectionInputContainer.style.display = 'none';
            }
        });
    });
    
    // 初始化时检查默认选中的单选框
    const checkedDirectionRadio = document.querySelector('input[name="directionOption"]:checked');
    if (checkedDirectionRadio && checkedDirectionRadio.value === 'useAngle') {
        directionInputContainer.style.display = 'block';
    }
    
    const checkedCurrentDirectionRadio = document.querySelector('input[name="currentDirectionOption"]:checked');
    if (checkedCurrentDirectionRadio && checkedCurrentDirectionRadio.value === 'useAngle') {
        currentDirectionInputContainer.style.display = 'block';
    }
    
    // 为保存设置按钮添加点击事件
    if (saveGlobalSettingsBtn) {
        saveGlobalSettingsBtn.addEventListener('click', function() {
            // 获取全局设置值
            const globalSpeed = document.getElementById('globalRouteSpeed').value;
            const globalTurnMode = document.querySelector('input[name="turnMode"]:checked').value;
            const globalDirectionOption = document.querySelector('input[name="directionOption"]:checked').value;
            const globalNavigationMode = document.getElementById('globalNavigationMode').value;
            const globalLanechange = document.getElementById('globalLanechange').value;
            const globalDefaultDirection = document.getElementById('globalDefaultDirection').value;
            
            // 保存到localStorage
            localStorage.setItem('globalRouteSpeed', globalSpeed);
            localStorage.setItem('globalTurnMode', globalTurnMode);
            localStorage.setItem('globalDirectionOption', globalDirectionOption);
            localStorage.setItem('globalNavigationMode', globalNavigationMode);
            localStorage.setItem('globalLanechange', globalLanechange);
            localStorage.setItem('globalDefaultDirection', globalDefaultDirection);
            // 更新当前路线设置
            
            updateCurrentRouteSettings();
            // 显示成功消息
            // 关闭模态框
         
            const modal = bootstrap.Modal.getInstance(document.getElementById('globalSettingsModal'));
            if (modal) {
                modal.hide();
            }
        });
    }
    
    // 为打开设置按钮添加点击事件
    if (openGlobalSettingsBtn) {
        openGlobalSettingsBtn.addEventListener('click', function() {
            // 从localStorage加载设置
            const globalSpeed = localStorage.getItem('globalRouteSpeed') || '0.2';
            const globalTurnMode = localStorage.getItem('globalTurnMode') || '0';
            const globalDirectionOption = localStorage.getItem('globalDirectionOption') || 'useNextPoint';
            const globalNavigationMode = localStorage.getItem('globalNavigationMode') || '1';
            const globalLanechange = localStorage.getItem('globalLanechange') || '0';
            const globalDefaultDirection = localStorage.getItem('globalDefaultDirection') || '0';
            
            // 设置表单值
            document.getElementById('globalRouteSpeed').value = globalSpeed;
            document.querySelector(`input[name="turnMode"][value="${globalTurnMode}"]`).checked = true;
            document.querySelector(`input[name="directionOption"][value="${globalDirectionOption}"]`).checked = true;
            document.getElementById('globalNavigationMode').value = globalNavigationMode;
            document.getElementById('globalLanechange').value = globalLanechange;
            document.getElementById('globalDefaultDirection').value = globalDefaultDirection;
            
            // 根据选中的单选框显示或隐藏输入框
            if (globalDirectionOption === 'useAngle') {
                directionInputContainer.style.display = 'block';
            } else {
                directionInputContainer.style.display = 'none';
            }
            
            // 显示模态框
            const modal = new bootstrap.Modal(document.getElementById('globalSettingsModal'));
            modal.show();
        });
    }
});

// 更新当前路线设置
function updateCurrentRouteSettings() {
    // 如果有路线点，更新所有站点的属性
    if (routePoints && routePoints.length > 0) {
        const globalSpeed = localStorage.getItem('globalRouteSpeed') || '0.2';
        const globalTurnMode = localStorage.getItem('globalTurnMode') || '0';
        const globalDirectionOption = localStorage.getItem('globalDirectionOption') || 'useAngle';
        const globalNavigationMode = localStorage.getItem('globalNavigationMode') || '1';
        const globalLanechange = localStorage.getItem('globalLanechange') || '0';
        const globalDefaultDirection = localStorage.getItem('globalDefaultDirection') || '0';
        
        routePoints.forEach((point, index) => {
            // 确保stationData存在
            if (!point.stationData) {
                point.stationData = {};
            }
            
            // 更新站点数据
            point.stationData.speed = globalSpeed;
            point.stationData.runmode = globalTurnMode;
            point.stationData.directionOption = globalDirectionOption;
            point.stationData.navigationMode = globalNavigationMode;
            point.stationData.lanechange = globalLanechange;
            point.stationData.defaultDirection = globalDefaultDirection;
            // 同时更新临时数据
            if (tempRoutePointsData && tempRoutePointsData[index]) {
                tempRoutePointsData[index].speed = globalSpeed;
                tempRoutePointsData[index].runmode = globalTurnMode;
                tempRoutePointsData[index].directionOption = globalDirectionOption;
                tempRoutePointsData[index].navigationMode = globalNavigationMode;
                tempRoutePointsData[index].lanechange = globalLanechange;
                tempRoutePointsData[index].defaultDirection = globalDefaultDirection;
            }
        });
        
        // 如果当前有站点信息框打开，更新其显示
        if (currentStationIndex >= 0 && fixedStationInfoBox && fixedStationInfoBox.style.display === 'block') {
            showFixedStationInfoBox(currentStationMarker, currentStationIndex);
        }
    }
}

// 更新路线列表中项目的显示
function updateRouteItemInList(routeIndex, routeData) {
    const routeItem = document.querySelector(`#routeList .route-item[data-route-index="${routeIndex}"]`);
    if (routeItem) {
        // 更新路线名称
        const routeName = routeItem.querySelector('.route-name');
        if (routeName) {
            routeName.textContent = routeData.name || `路线 ${routeIndex + 1}`;
        }
        
        // 更新路线点数
        const pointCount = routeItem.querySelector('.point-count');
        if (pointCount) {
            pointCount.textContent = `${routeData.points ? routeData.points.length : 0} 个点`;
        }
        
        // 更新路线状态
        const statusBadge = routeItem.querySelector('.status-badge');
        if (statusBadge) {
            if (routeData.active) {
                statusBadge.textContent = '活跃';
                statusBadge.className = 'status-badge status-active';
            } else {
                statusBadge.textContent = '非活跃';
                statusBadge.className = 'status-badge status-inactive';
            }
        }
    }
}

    // 监听来自父窗口的PostMessage
window.addEventListener('message',async function(event) {
    if (event.data && event.data.type === 'REFRESH_ROUTE_SELECT') {
        if (typeof refreshRouteSelect === 'function') {
          await  refreshRouteSelect();
        }
    }
    if (event.data && event.data.type === 'LAYOUT_RESIZE') {
        window.setTimeout(function () {
            if (typeof map !== 'undefined' && map && typeof map.invalidateSize === 'function') {
                map.invalidateSize(false);
            }
        }, 60);
    }
});
