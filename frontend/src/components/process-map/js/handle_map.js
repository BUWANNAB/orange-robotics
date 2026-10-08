
// 获取Canvas元素和上下文
    const imageCanvas = document.getElementById('imageCanvas');
    const drawCanvas = document.getElementById('drawCanvas');
    const coordinateCanvas = document.getElementById('coordinateCanvas');
    const overlayCanvas = document.getElementById('overlayCanvas');
    const resultContainer = document.getElementById('resultContainer');
    const pgmFileInput = document.getElementById('pgmFile');
    const statusMessage = document.getElementById('statusMessage');
    const brushSizeValue = document.getElementById('brushSizeValue');
    const zoomDisplay = document.getElementById('zoomDisplay');
    const dragHint = document.getElementById('dragHint');
    const modeIndicator = document.querySelector('.mode-indicator');
    const taskItemsContainer = document.getElementById('taskItems');
    const taskQueueEmpty = document.getElementById('taskQueueEmpty');
    const taskCount = document.getElementById('taskCount');
    const taskHighlightContainer = document.getElementById('taskHighlightContainer');
    const handModeInstruction = document.getElementById('handModeInstruction');
    const handModePreview = document.getElementById('handModePreview');
    const sequencePreview = document.getElementById('sequencePreview');
    const pointHighlight = document.getElementById('pointHighlight');
    const toolHint = document.getElementById('toolHint');
    
    const imageCtx = imageCanvas.getContext('2d');
    const drawCtx = drawCanvas.getContext('2d');
    const coordinateCtx = coordinateCanvas.getContext('2d');
    const overlayCtx = overlayCanvas.getContext('2d');
    const coordinateSummary = document.getElementById('coordinateFrameSummary');
    const coordinateReadout = document.getElementById('mapCursorCoordinates');
    const coordinateGridSpacing = document.getElementById('coordinateGridSpacing');
    const showMetricGrid = document.getElementById('showMetricGrid');
    const showWorldAxes = document.getElementById('showWorldAxes');
    const fitMapButton = document.getElementById('btnFitMap');

    // 状态变量
    let points = []; // 钢笔工具创建的路径点
    let history = []; // 操作历史记录
    let isDragging = false; // 是否正在拖拽路径点
    let dragPointIndex = -1; // 当前拖拽的路径点索引
    let isClosed = false; // 路径是否闭合
    let pgmData = null; // 当前PGM图像数据
    let originalPgmData = null; // 原始PGM图像数据
    let lastCutoutImageData = null; // 上一次生成的抠图数据
    let lastCutoutPGMData = null; // 上一次生成的PGM格式抠图数据
    let mapCoordinateFrame = null;

    // 画笔相关变量
    let currentTool = 'pen'; // 当前工具 ('pen', 'brush', 'drag', 'task', 'hand', 'arrow')
    let brushColor = 'black'; // 画笔颜色
    let brushSize = 5; // 画笔大小
    let isDrawing = false; // 是否正在绘制
    let lastX = 0; // 上一个鼠标X坐标
    let lastY = 0; // 上一个鼠标Y坐标

    // 矩形工具相关变量
let rectStartX = 0; // 矩形起始X坐标
let rectStartY = 0; // 矩形起始Y坐标
let isDrawingRect = false; // 是否正在绘制矩形

    // 缩放和拖拽相关变量
    let scale = 1.0; // 当前缩放比例
    let offsetX = 0; // X轴偏移量
    let offsetY = 0; // Y轴偏移量
    let isDraggingImage = false; // 是否正在拖拽图像
    let dragStartX = 0; // 拖拽起始X坐标
    let dragStartY = 0; // 拖拽起始Y坐标
    let startOffsetX = 0; // 拖拽开始时的X偏移
    let startOffsetY = 0; // 拖拽开始时的Y偏移
    let isDragMode = false; // 是否处于拖拽模式
    let isTaskMode = false; // 是否处于任务模式
    let isHandMode = false; // 是否处于小手模式

    // 任务队列相关变量
    let tasks = []; // 任务列表
    let draggedTask = null; // 当前拖拽的任务
    let isDrawingTaskRect = false; // 是否正在绘制任务矩形
    let taskRectStartX = 0; // 任务矩形起始X坐标
    let taskRectStartY = 0; // 任务矩形起始Y坐标
    let dragStartIndex = -1; // 拖拽开始时的任务索引
    let dragOverIndex = -1; // 拖拽经过的任务索引
    let taskSelectionOrder = []; // 任务选择顺序
    let taskNumberCounter = 1; // 任务编号计数器

    // 钢笔工具绘制矩形相关
    let isPotentialRect = false; // 可能开始绘制矩形
    let penStartX = 0; // 钢笔模式下矩形的起始X坐标
    let penStartY = 0; // 钢笔模式下矩形的起始Y坐标

    // 箭头工具相关变量
    let arrows = []; // 存储所有箭头
    let arrowStartPoint = null; // 当前箭头的起点
    let isDrawingArrow = false; // 是否正在绘制箭头
    
    // 垂直平分线工具相关变量
    let isPerpendicularToolActive = false; // 垂直平分线工具是否激活
    let perpendicularPoints = []; // 存储垂直平分线的两个点
    let perpendicularLines = []; // 存储所有绘制的垂直平分线
    let isDraggingPerpendicularPoint = false; // 是否正在拖拽垂直平分线点
    let dragPerpendicularPointIndex = -1; // 当前拖拽的垂直平分线点索引

    // 触摸相关变量
    let touchState = {
        isTouch: false,
        touches: [],
        lastTouchTime: 0,
        touchStartTime: 0,
        startPos: { x: 0, y: 0 },
        lastPos: { x: 0, y: 0 },
        pinchDistance: 0,
        pinchCenter: { x: 0, y: 0 },
        isPinching: false,
        isDragging: false,
        dragThreshold: 10,
        tapThreshold: 300,
        doubleTapThreshold: 400,
        longPressThreshold: 500
    };

    // 设置Canvas尺寸
    function resizeCanvas() {
        const container = document.querySelector('.canvas-container');
        const width = container.clientWidth;
        const height = container.clientHeight;

        imageCanvas.width = width;
        imageCanvas.height = height;
        drawCanvas.width = width;
        drawCanvas.height = height;
        coordinateCanvas.width = width;
        coordinateCanvas.height = height;
        overlayCanvas.width = width;
        overlayCanvas.height = height;

        if (pgmData) {
            drawPGM();
        }
    }

    // 初始化和调整大小时重置Canvas
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    /**
     * 解析PGM文件
     * @param {File} file - PGM文件对象
     * @returns {Promise} 包含解析后的PGM数据的Promise
     */
    function parsePGM(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = function(e) {
                const data = new Uint8Array(e.target.result);
                let offset = 0;

                // 解析PGM头部
                const header = [];
                let line = '';

                while (true) {
                    const char = String.fromCharCode(data[offset++]);

                    if (char === '\n') {
                        if (line[0] !== '#') {
                            header.push(line.trim());
                        }
                        line = '';

                        if (header.length >= 3) {
                            break;
                        }
                    } else {
                        line += char;
                    }
                }

                if (header[0] !== 'P5') {
                    reject('仅支持P5格式的PGM文件');
                    return;
                }

                const dimensions = header[1].split(/\s+/);
                const width = parseInt(dimensions[0]);
                const height = parseInt(dimensions[1]);
                const maxValue = parseInt(header[2]);

                const imageData = new Uint8ClampedArray(width * height);
                for (let i = 0; i < imageData.length; i++) {
                    imageData[i] = data[offset + i];
                }

                resolve({ width, height, maxValue, imageData });
            };

            reader.onerror = function() {
                reject('文件读取失败');
            };

            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * 绘制PGM图像到Canvas
     */
    function drawPGM() {
        const { width, height, imageData } = pgmData;

        // 创建临时Canvas用于处理图像
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');

        // 创建图像数据
        const imgData = tempCtx.createImageData(width, height);

        // 将灰度数据转换为RGBA格式
        for (let i = 0; i < imageData.length; i++) {
            const gray = imageData[i];
            const idx = i * 4;
            imgData.data[idx] = gray;
            imgData.data[idx + 1] = gray;
            imgData.data[idx + 2] = gray;
            imgData.data[idx + 3] = 255;
        }

        tempCtx.putImageData(imgData, 0, 0);

        // 计算缩放比例以适应容器
        const containerScale = Math.min(
            imageCanvas.width / width,
            imageCanvas.height / height
        );

        // 计算缩放后的尺寸和位置
        const scaledWidth = width * containerScale * scale;
        const scaledHeight = height * containerScale * scale;
        const x = (imageCanvas.width - scaledWidth) / 2 + offsetX;
        const y = (imageCanvas.height - scaledHeight) / 2 + offsetY;

        // 绘制图像
        imageCtx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
        // 设置黑色背景
        imageCtx.fillStyle = 'black';
        imageCtx.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
        imageCtx.drawImage(tempCanvas, 0, 0, width, height, x, y, scaledWidth, scaledHeight);

        // 保存显示信息供后续使用
        pgmData.displayInfo = {
            x,
            y,
            width: scaledWidth,
            height: scaledHeight,
            containerScale,
            origWidth: width,
            origHeight: height
        };

        // 清除绘制Canvas和覆盖Canvas
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        points = [];
        isClosed = false;
        updateButtonStates();

        // 更新任务高亮显示
        updateTaskHighlights();

        // 重绘所有箭头
        arrows.forEach(arrow => {
            drawArrow(arrow.start, arrow.end, true);
        });
        drawCoordinateOverlay();
    }

    function setMapCoordinateFrame(asset) {
        const resolution = Number(asset?.resolution);
        const origin = asset?.origin;
        if (!Number.isFinite(resolution) || resolution <= 0 || !Array.isArray(origin)
            || origin.length !== 3 || !origin.every(value => Number.isFinite(Number(value)))) {
            mapCoordinateFrame = null;
            coordinateSummary.textContent = '此地图缺少有效的 resolution / origin，无法显示米制坐标。';
            coordinateReadout.textContent = '光标坐标：—';
            coordinateGridSpacing.textContent = '网格间距：—';
            updateCoordinateOverlay();
            return;
        }

        mapCoordinateFrame = { resolution, origin: origin.map(Number) };
        updateCoordinateFrameUI();
    }

    function updateCoordinateFrameUI() {
        if (!mapCoordinateFrame) return;
        const [x, y, yaw] = mapCoordinateFrame.origin;
        const fmt = value => (Math.abs(value) < 0.0005 ? 0 : value).toFixed(3);
        coordinateSummary.textContent = `分辨率 ${mapCoordinateFrame.resolution} m/像素 · 栅格原点 X ${fmt(x)} m，Y ${fmt(y)} m · 朝向 ${fmt(yaw * 180 / Math.PI)}°`;
        updateCoordinateOverlay();
    }

    function pixelToCanvas(pixel) {
        const display = pgmData.displayInfo;
        const factor = display.containerScale * scale;
        return { x: display.x + pixel.x * factor, y: display.y + pixel.y * factor };
    }

    function worldToCanvas(x, y) {
        return pixelToCanvas(MapCoordinates.worldToPixel(
            x, y, pgmData.width, pgmData.height, mapCoordinateFrame.resolution, mapCoordinateFrame.origin
        ));
    }

    function drawCoordinateOverlay() {
        if (!coordinateCtx) return;
        coordinateCtx.clearRect(0, 0, coordinateCanvas.width, coordinateCanvas.height);
        if (!pgmData || !pgmData.displayInfo || !mapCoordinateFrame) {
            coordinateGridSpacing.textContent = '网格间距：—';
            return;
        }

        const display = pgmData.displayInfo;
        const pixelsPerMeter = display.containerScale * scale / mapCoordinateFrame.resolution;
        const step = Number.isFinite(pixelsPerMeter) && pixelsPerMeter > 0
            ? MapCoordinates.gridSpacing(pixelsPerMeter)
            : null;
        coordinateGridSpacing.textContent = !showMetricGrid.checked
            ? '网格间距：已关闭'
            : step === null
                ? '网格间距：—'
                : `网格间距：${Number.isInteger(step) ? step : Number(step.toFixed(3))} m`;
        const corners = [
            MapCoordinates.pixelToWorld(0, 0, pgmData.width, pgmData.height, mapCoordinateFrame.resolution, mapCoordinateFrame.origin),
            MapCoordinates.pixelToWorld(pgmData.width, 0, pgmData.width, pgmData.height, mapCoordinateFrame.resolution, mapCoordinateFrame.origin),
            MapCoordinates.pixelToWorld(pgmData.width, pgmData.height, pgmData.width, pgmData.height, mapCoordinateFrame.resolution, mapCoordinateFrame.origin),
            MapCoordinates.pixelToWorld(0, pgmData.height, pgmData.width, pgmData.height, mapCoordinateFrame.resolution, mapCoordinateFrame.origin)
        ];
        const minX = Math.min(...corners.map(point => point.x));
        const maxX = Math.max(...corners.map(point => point.x));
        const minY = Math.min(...corners.map(point => point.y));
        const maxY = Math.max(...corners.map(point => point.y));
        const context = coordinateCtx;
        context.save();
        context.beginPath();
        context.rect(display.x, display.y, display.width, display.height);
        context.clip();

        if (showMetricGrid.checked && step !== null) {
            context.beginPath();
            context.strokeStyle = 'rgba(52, 152, 219, 0.24)';
            context.lineWidth = 1;
            let count = 0;
            for (let x = Math.ceil(minX / step) * step; x <= maxX && count < 500; x += step, count++) {
                const start = worldToCanvas(x, minY);
                const end = worldToCanvas(x, maxY);
                context.moveTo(start.x, start.y);
                context.lineTo(end.x, end.y);
            }
            count = 0;
            for (let y = Math.ceil(minY / step) * step; y <= maxY && count < 500; y += step, count++) {
                const start = worldToCanvas(minX, y);
                const end = worldToCanvas(maxX, y);
                context.moveTo(start.x, start.y);
                context.lineTo(end.x, end.y);
            }
            context.stroke();
        }

        if (showWorldAxes.checked) {
            const xStart = worldToCanvas(minX, 0);
            const xEnd = worldToCanvas(maxX, 0);
            context.beginPath();
            context.strokeStyle = '#1688c7';
            context.lineWidth = 2;
            context.moveTo(xStart.x, xStart.y);
            context.lineTo(xEnd.x, xEnd.y);
            context.stroke();
            context.fillStyle = '#0872aa';
            context.font = '600 13px Segoe UI, Microsoft YaHei, sans-serif';
            context.fillText('+X', Math.max(display.x + 6, Math.min(display.x + display.width - 28, xEnd.x - 24)), xEnd.y - 7);

            const yStart = worldToCanvas(0, minY);
            const yEnd = worldToCanvas(0, maxY);
            context.beginPath();
            context.strokeStyle = '#2b9b75';
            context.lineWidth = 2;
            context.moveTo(yStart.x, yStart.y);
            context.lineTo(yEnd.x, yEnd.y);
            context.stroke();
            context.fillStyle = '#187c5b';
            context.fillText('+Y', yEnd.x + 7, Math.max(display.y + 16, Math.min(display.y + display.height - 6, yEnd.y + 16)));

            if (minX <= 0 && maxX >= 0 && minY <= 0 && maxY >= 0) {
                const zero = worldToCanvas(0, 0);
                context.beginPath();
                context.fillStyle = '#e56b2f';
                context.arc(zero.x, zero.y, 5, 0, Math.PI * 2);
                context.fill();
                context.fillStyle = '#9c431b';
                context.fillText('0,0', zero.x + 7, zero.y - 7);
            }
        }
        context.restore();
    }

    function updateCoordinateReadout(x, y) {
        if (!pgmData || !pgmData.displayInfo || !mapCoordinateFrame) {
            coordinateReadout.textContent = '光标坐标：—';
            return;
        }
        const display = pgmData.displayInfo;
        const factor = display.containerScale * scale;
        const pixelX = (x - display.x) / factor;
        const pixelY = (y - display.y) / factor;
        if (pixelX < 0 || pixelY < 0 || pixelX > pgmData.width || pixelY > pgmData.height) {
            coordinateReadout.textContent = '光标坐标：地图外';
            return;
        }
        const world = MapCoordinates.pixelToWorld(pixelX, pixelY, pgmData.width, pgmData.height, mapCoordinateFrame.resolution, mapCoordinateFrame.origin);
        coordinateReadout.textContent = `光标：X ${world.x.toFixed(2)} m · Y ${world.y.toFixed(2)} m`;
    }

    /**
     * 获取触摸点的坐标
     * @param {TouchEvent} e - 触摸事件
     * @returns {Object} 触摸点坐标 {x, y}
     */
    function getTouchPos(e) {
        const rect = e.target.getBoundingClientRect();
        const touch = e.touches[0] || e.changedTouches[0];
        return {
            x: touch.clientX - rect.left,
            y: touch.clientY - rect.top
        };
    }

    /**
     * 计算两点之间的距离
     * @param {Object} p1 - 点1 {x, y}
     * @param {Object} p2 - 点2 {x, y}
     * @returns {number} 距离
     */
    function getDistance(p1, p2) {
        return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    }

    /**
     * 计算两点之间的中点
     * @param {Object} p1 - 点1 {x, y}
     * @param {Object} p2 - 点2 {x, y}
     * @returns {Object} 中点坐标 {x, y}
     */
    function getMidpoint(p1, p2) {
        return {
            x: (p1.x + p2.x) / 2,
            y: (p1.y + p2.y) / 2
        };
    }

    /**
     * 处理触摸开始事件
     * @param {TouchEvent} e - 触摸事件
     */
    function handleTouchStart(e) {
        e.preventDefault();
        touchState.isTouch = true;
        touchState.touches = Array.from(e.touches);
        touchState.touchStartTime = Date.now();
        
        const touchPos = getTouchPos(e);
        touchState.startPos = { ...touchPos };
        touchState.lastPos = { ...touchPos };

        // 处理多点触摸（缩放）
        if (e.touches.length === 2) {
            touchState.isPinching = true;
            const p1 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            const p2 = { x: e.touches[1].clientX, y: e.touches[1].clientY };
            touchState.pinchDistance = getDistance(p1, p2);
            touchState.pinchCenter = getMidpoint(p1, p2);
        } else if (e.touches.length === 1) {
            // 单点触摸，根据当前工具处理
            handleSingleTouchStart(touchPos);
        }
    }

    /**
     * 处理触摸移动事件
     * @param {TouchEvent} e - 触摸事件
     */
    function handleTouchMove(e) {
        e.preventDefault();
        touchState.touches = Array.from(e.touches);
        
        if (e.touches.length === 2 && touchState.isPinching) {
            // 处理缩放
            handlePinchZoom(e);
        } else if (e.touches.length === 1) {
            // 处理单点移动
            handleSingleTouchMove(e);
        }
    }

    /**
     * 处理触摸结束事件
     * @param {TouchEvent} e - 触摸事件
     */
    function handleTouchEnd(e) {
        e.preventDefault();
        const touchEndTime = Date.now();
        const touchDuration = touchEndTime - touchState.touchStartTime;

        if (e.touches.length === 0) {
            // 所有手指都离开屏幕
            if (touchState.isPinching) {
                touchState.isPinching = false;
            } else if (!touchState.isDragging && touchDuration < touchState.tapThreshold) {
                // 处理点击事件
                handleTouchTap(e);
            } else if (touchDuration >= touchState.longPressThreshold) {
                // 处理长按事件
                handleLongPress(e);
            }
            
            // 重置钢笔工具相关状态
            if (currentTool === 'pen') {
                if (isDragging) {
                    // 结束锚点拖拽
                    isDragging = false;
                    dragPointIndex = -1;
                    pointHighlight.style.display = 'none';
                }
                
                // 如果正在绘制矩形，完成矩形绘制
                if (isDrawingRect) {
                    const touchPos = getTouchPos(e);
                    
                    // 添加矩形的四个角点
                    points = [
                        {x: penStartX, y: penStartY},
                        {x: touchPos.x, y: penStartY},
                        {x: touchPos.x, y: touchPos.y},
                        {x: penStartX, y: touchPos.y}
                    ];

                    isClosed = true;
                    
                    // 应用填充 - 使用画笔颜色
                    if (brushColor !== 'none') {
                        fillRect(penStartX, penStartY, touchPos.x, touchPos.y, brushColor);
                    }
                    
                    saveHistory();
                    showActionFeedback(touchPos.x, touchPos.y, '矩形绘制完成');
                    draw();
                }
                // 如果只是点击但没有移动足够距离，则添加一个点
                else if (isPotentialRect && !isDrawingRect) {
                    const touchPos = getTouchPos(e);
                    points.push({ x: touchPos.x, y: touchPos.y });
                    draw();
                }
                
                isPotentialRect = false;
                isDrawingRect = false;
            }
            
            touchState.isDragging = false;
            touchState.isTouch = false;
        } else if (e.touches.length === 1 && touchState.isPinching) {
            // 从双指变为单指，结束缩放模式
            touchState.isPinching = false;
            const touchPos = getTouchPos(e);
            touchState.startPos = { ...touchPos };
            touchState.lastPos = { ...touchPos };
        }
    }

    /**
     * 处理缩放手势
     * @param {TouchEvent} e - 触摸事件
     */
    function handlePinchZoom(e) {
        const p1 = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        const p2 = { x: e.touches[1].clientX, y: e.touches[1].clientY };
        const currentDistance = getDistance(p1, p2);
        
        if (touchState.pinchDistance > 0) {
            const scaleFactor = currentDistance / touchState.pinchDistance;
            const newScale = Math.max(0.1, Math.min(5.0, scale * scaleFactor));
            
            // 计算缩放中心相对于画布的位置
            const rect = overlayCanvas.getBoundingClientRect();
            const centerX = (p1.x + p2.x) / 2 - rect.left;
            const centerY = (p1.y + p2.y) / 2 - rect.top;
            
            // 调整偏移量以保持缩放中心位置
            const scaleDelta = newScale - scale;
            offsetX += (centerX - (imageCanvas.width / 2 + offsetX)) * (scaleDelta / scale);
            offsetY += (centerY - (imageCanvas.height / 2 + offsetY)) * (scaleDelta / scale);
            
            scale = newScale;
            zoomDisplay.textContent = Math.round(scale * 100) + '%';
            
            if (pgmData) {
                drawPGM();
                redrawAll();
            }
        }
        
        touchState.pinchDistance = currentDistance;
        touchState.pinchCenter = getMidpoint(p1, p2);
    }

    /**
     * 处理单点触摸开始
     * @param {Object} pos - 触摸位置 {x, y}
     */
    function handleSingleTouchStart(pos) {
        switch (currentTool) {
            case 'pen':
                // 钢笔工具触摸开始
                if (!isDragMode && !isTaskMode && !isHandMode) {
                    // 优先检测是否点击了已有的锚点
                    let clickedExistingPoint = false;
                    for (let i = 0; i < points.length; i++) {
                        const point = points[i];
                        const dx = point.x - pos.x;
                        const dy = point.y - pos.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);

                        if (dist < 10) {
                            isDragging = true;
                            dragPointIndex = i;
                            saveHistory();

                            // 高亮显示被拖拽的点
                            pointHighlight.style.display = 'block';
                            pointHighlight.style.left = `${point.x}px`;
                            pointHighlight.style.top = `${point.y}px`;
                            
                            clickedExistingPoint = true;
                            break;
                        }
                    }

                    // 如果没有点击在锚点上，则设置可能开始绘制矩形
                    if (!clickedExistingPoint) {
                        isPotentialRect = true;
                        penStartX = pos.x;
                        penStartY = pos.y;
                    }
                }
                break;
                
            case 'brush':
                // 画笔工具触摸开始
                if (!isDragMode && !isTaskMode && !isHandMode) {
                    isDrawing = true;
                    lastX = pos.x;
                    lastY = pos.y;
                    drawBrush(pos.x, pos.y);
                }
                break;
                
            case 'arrow':
                // 箭头工具触摸开始
                if (!isDragMode && !isTaskMode && !isHandMode) {
                    arrowStartPoint = { x: pos.x, y: pos.y };
                    isDrawingArrow = true;
                }
                break;
                
            case 'drag':
                // 拖拽模式触摸开始
                isDraggingImage = true;
                dragStartX = pos.x;
                dragStartY = pos.y;
                startOffsetX = offsetX;
                startOffsetY = offsetY;
                dragHint.style.display = 'block';
                break;
                
            case 'task':
                // 任务模式触摸开始
                if (!isHandMode) {
                    isDrawingTaskRect = true;
                    taskRectStartX = pos.x;
                    taskRectStartY = pos.y;
                }
                break;
                
            case 'hand':
                // 小手模式触摸开始
                handleHandModeTouchStart(pos);
                break;
        }
    }

    /**
     * 处理单点触摸移动
     * @param {TouchEvent} e - 触摸事件
     */
    function handleSingleTouchMove(e) {
        const touchPos = getTouchPos(e);
        updateCoordinateReadout(touchPos.x, touchPos.y);
        const deltaX = touchPos.x - touchState.lastPos.x;
        const deltaY = touchPos.y - touchState.lastPos.y;
        const distance = getDistance(touchPos, touchState.startPos);
        
        // 检查是否开始拖拽
        if (distance > touchState.dragThreshold && !touchState.isDragging) {
            touchState.isDragging = true;
        }
        
        if (touchState.isDragging) {
            switch (currentTool) {
                case 'pen':
                    // 钢笔工具拖拽绘制
                    if (!isDragMode && !isTaskMode && !isHandMode) {
                        if (isDragging && dragPointIndex !== -1) {
                            // 拖拽锚点
                            points[dragPointIndex].x = touchPos.x;
                            points[dragPointIndex].y = touchPos.y;
                            
                            // 更新高亮点位置
                            pointHighlight.style.left = `${touchPos.x}px`;
                            pointHighlight.style.top = `${touchPos.y}px`;
                            
                            draw();
                            redrawAll();
                        } else if (isPotentialRect) {
                            // 两点绘制矩形预览
                            drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
                            redrawAll();
                            
                            // 检查移动距离是否足够开始绘制矩形
                            const dx = Math.abs(touchPos.x - penStartX);
                            const dy = Math.abs(touchPos.y - penStartY);
                            
                            if (dx > 5 || dy > 5) {
                                isDrawingRect = true;
                                
                                // 绘制矩形预览
                                const width = touchPos.x - penStartX;
                                const height = touchPos.y - penStartY;
                                
                                drawCtx.strokeStyle = '#1abc9c';
                                drawCtx.lineWidth = 2;
                                drawCtx.setLineDash([5, 5]);
                                drawCtx.strokeRect(penStartX, penStartY, width, height);
                                drawCtx.setLineDash([]);
                            }
                        } else if (points.length > 0) {
                            // 普通预览线
                            drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
                            redrawAll();
                            
                            const lastPoint = points[points.length - 1];
                            drawCtx.beginPath();
                            drawCtx.moveTo(lastPoint.x, lastPoint.y);
                            drawCtx.lineTo(touchPos.x, touchPos.y);
                            drawCtx.strokeStyle = '#1abc9c';
                            drawCtx.lineWidth = 2;
                            drawCtx.setLineDash([5, 5]);
                            drawCtx.stroke();
                            drawCtx.setLineDash([]);
                        }
                    }
                    break;
                    
                case 'brush':
                    // 画笔工具拖拽绘制
                    if (isDrawing && !isDragMode && !isTaskMode && !isHandMode) {
                        drawBrush(touchPos.x, touchPos.y);
                        lastX = touchPos.x;
                        lastY = touchPos.y;
                    }
                    break;
                    
                case 'arrow':
                    // 箭头工具拖拽绘制
                    if (isDrawingArrow && arrowStartPoint) {
                        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
                        redrawAll();
                        drawArrow(arrowStartPoint, touchPos, false);
                    }
                    break;
                    
                case 'drag':
                    // 拖拽模式移动
                    if (isDraggingImage) {
                        offsetX = startOffsetX + (touchPos.x - dragStartX);
                        offsetY = startOffsetY + (touchPos.y - dragStartY);
                        
                        if (pgmData) {
                            drawPGM();
                            redrawAll();
                        }
                    }
                    break;
                    
                case 'task':
                    // 任务模式拖拽绘制矩形
                    if (isDrawingTaskRect && !isHandMode) {
                        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                        updateTaskHighlights();
                        
                        const width = touchPos.x - taskRectStartX;
                        const height = touchPos.y - taskRectStartY;
                        
                        overlayCtx.strokeStyle = '#e74c3c';
                        overlayCtx.lineWidth = 2;
                        overlayCtx.setLineDash([5, 5]);
                        overlayCtx.strokeRect(taskRectStartX, taskRectStartY, width, height);
                        overlayCtx.setLineDash([]);
                        
                        overlayCtx.fillStyle = 'rgba(231, 76, 60, 0.1)';
                        overlayCtx.fillRect(taskRectStartX, taskRectStartY, width, height);
                    }
                    break;
            }
        }
        
        touchState.lastPos = { ...touchPos };
    }

    /**
     * 处理触摸点击事件
     * @param {TouchEvent} e - 触摸事件
     */
    function handleTouchTap(e) {
        const touchPos = getTouchPos(e);
        const currentTime = Date.now();
        
        // 检测是否为双击
        if (currentTime - lastTapTime < touchState.doubleTapThreshold) {
            // 是双击，处理双击事件
            handleTouchDoubleTap(touchPos);
            lastTapTime = 0; // 重置双击检测
            if (tapTimer) {
                clearTimeout(tapTimer);
                tapTimer = null;
            }
            return;
        }
        
        // 记录当前点击时间
        lastTapTime = currentTime;
        
        // 延迟执行单击事件，等待检测双击
        tapTimer = setTimeout(() => {
            // 执行单击事件
            switch (currentTool) {
                case 'pen':
                    // 钢笔工具添加点或完成矩形
                    if (!isDragMode && !isTaskMode && !isHandMode) {
                        if (isDrawingRect) {
                            // 完成两点矩形绘制
                            const width = touchPos.x - penStartX;
                            const height = touchPos.y - penStartY;
                            
                            // 添加矩形的四个角点
                            points.push({ x: penStartX, y: penStartY });
                            points.push({ x: penStartX + width, y: penStartY });
                            points.push({ x: penStartX + width, y: penStartY + height });
                            points.push({ x: penStartX, y: penStartY + height });
                            
                            // 闭合路径
                            isClosed = true;
                            
                            // 重置状态
                            isDrawingRect = false;
                            isPotentialRect = false;
                            
                            // 绘制并应用填充
                            draw();
                            
                            if (brushColor !== 'none') {
                                fillRect(penStartX, penStartY, touchPos.x, touchPos.y, brushColor);
                            }
                            
                            saveHistory();
                            showActionFeedback(touchPos.x, touchPos.y, '矩形绘制完成');
                        } else {
                            // 普通添加点
                            points.push({ x: touchPos.x, y: touchPos.y });
                            draw();
                        }
                    }
                    break;
                    
                case 'task':
                    // 任务模式完成矩形
                    if (isDrawingTaskRect && !isHandMode) {
                        finishTaskRect(touchPos);
                    }
                    break;
            }
            tapTimer = null;
        }, touchState.doubleTapThreshold);
    }
    
    /**
     * 处理触摸双击事件
     * @param {Object} touchPos - 触摸位置 {x, y}
     */
    function handleTouchDoubleTap(touchPos) {
        switch (currentTool) {
            case 'pen':
                // 钢笔工具双击闭合路径
                if (points.length > 2 && !isClosed) {
                    isClosed = true;
                    draw();
                    
                    // 应用填充
                    if (brushColor !== 'none') {
                        fillPath(brushColor);
                    }
                    
                    saveHistory();
                    showActionFeedback(touchPos.x, touchPos.y, '路径已闭合');
                }
                break;
                
            case 'task':
                // 任务模式双击可以添加特殊处理（可选）
                break;
        }
    }

    /**
     * 处理长按事件
     * @param {TouchEvent} e - 触摸事件
     */
    function handleLongPress(e) {
        const touchPos = getTouchPos(e);
        
        // 根据工具处理长按
        switch (currentTool) {
            case 'pen':
                // 钢笔工具长按闭合路径
                if (points.length > 2 && !isClosed) {
                    isClosed = true;
                    draw();
                    showStatus('路径已闭合');
                }
                break;
                
            case 'hand':
                // 小手模式长按重置选择
                if (isHandMode) {
                    resetHandModeSelection();
                    showStatus('小手模式选择已重置');
                }
                break;
        }
    }

    /**
     * 完成画笔绘制
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     */
    function drawBrush(x, y) {
        drawCtx.beginPath();
        drawCtx.arc(x, y, brushSize, 0, Math.PI * 2);
        drawCtx.fillStyle = brushColor;
        drawCtx.fill();
        
        // 添加到历史记录
        addToHistory('brush', { x, y, color: brushColor, size: brushSize });
    }

    /**
     * 重新绘制所有元素
     */
    function redrawAll() {
        // 重绘钢笔路径
        if (points.length > 0) {
            draw();
        }
        
        // 重绘箭头
        arrows.forEach(arrow => {
            drawArrow(arrow.start, arrow.end, true);
        });
        
        // 重绘垂直平分线
        perpendicularLines.forEach(line => {
            drawPerpendicularBisector(line.p1, line.p2);
        });
        
        // 更新任务高亮
        updateTaskHighlights();
    }

    /**
     * 显示状态消息
     * @param {string} message - 消息内容
     * @param {string} type - 消息类型
     */
    function showStatus(message, type = 'info') {
        statusMessage.textContent = message;
        statusMessage.className = `status-message ${type}`;
        setTimeout(() => {
            statusMessage.textContent = '';
            statusMessage.className = 'status-message';
        }, 3000);
    }

    /**
     * 完成任务矩形绘制
     * @param {Object} endPos - 结束位置 {x, y}
     */
    function finishTaskRect(endPos) {
        if (!pgmData || !pgmData.displayInfo) return;
        
        const displayInfo = pgmData.displayInfo;
        const startX = Math.min(taskRectStartX, endPos.x);
        const startY = Math.min(taskRectStartY, endPos.y);
        const endX = Math.max(taskRectStartX, endPos.x);
        const endY = Math.max(taskRectStartY, endPos.y);
        
        // 转换为原始图像坐标
        const origStartX = (startX - displayInfo.x) / (displayInfo.containerScale * scale);
        const origStartY = (startY - displayInfo.y) / (displayInfo.containerScale * scale);
        const origEndX = (endX - displayInfo.x) / (displayInfo.containerScale * scale);
        const origEndY = (endY - displayInfo.y) / (displayInfo.containerScale * scale);
        
        // 确保坐标在图像范围内
        const clampedStartX = Math.max(0, Math.min(origStartX, displayInfo.origWidth));
        const clampedStartY = Math.max(0, Math.min(origStartY, displayInfo.origHeight));
        const clampedEndX = Math.max(0, Math.min(origEndX, displayInfo.origWidth));
        const clampedEndY = Math.max(0, Math.min(origEndY, displayInfo.origHeight));
        
        // 创建任务
        const task = {
            startX: clampedStartX,
            startY: clampedStartY,
            endX: clampedEndX,
            endY: clampedEndY,
            number: taskNumberCounter++,
            hasBeenSelected: false
        };
        
        tasks.push(task);
        isDrawingTaskRect = false;
        
        // 更新任务队列显示
        updateTaskQueue();
        updateTaskHighlights();
        showStatus(`任务区域已添加 (任务${task.number})`);
    }

    /**
     * 处理小手模式触摸开始
     * @param {Object} pos - 触摸位置 {x, y}
     */
    function handleHandModeTouchStart(pos) {
        if (!pgmData || !pgmDisplayInfo) return;
        
        // 检查是否点击了任务区域
        const clickedTask = getTaskAtPosition(pos);
        if (clickedTask) {
            if (!clickedTask.hasBeenSelected) {
                // 添加任务到选择顺序
                taskSelectionOrder.push(clickedTask);
                clickedTask.hasBeenSelected = true;
                
                // 更新显示
                updateHandModePreview();
                updateTaskHighlights();
                
                showStatus(`任务${clickedTask.number} 已选择 (顺序: ${taskSelectionOrder.length})`);
            } else {
                showStatus(`任务${clickedTask.number} 已经被选择过了`);
            }
        }
    }

    /**
     * 重置小手模式选择
     */
    function resetHandModeSelection() {
        taskSelectionOrder.forEach(task => {
            task.hasBeenSelected = false;
        });
        taskSelectionOrder = [];
        updateHandModePreview();
        updateTaskHighlights();
        showStatus('小手模式选择已重置');
    }

    /**
     * 更新小手模式预览
     */
    function updateHandModePreview() {
        if (taskSelectionOrder.length > 0) {
            const sequence = taskSelectionOrder.map(task => task.number).join(' → ');
            sequencePreview.textContent = sequence;
            handModePreview.style.display = 'block';
        } else {
            sequencePreview.textContent = '未选择';
            handModePreview.style.display = 'none';
        }
    }

    /**
     * 获取指定位置的任务
     * @param {Object} pos - 位置 {x, y}
     * @returns {Object|null} 任务对象或null
     */
    function getTaskAtPosition(pos) {
        if (!pgmData || !pgmData.displayInfo) return null;
        
        const displayInfo = pgmData.displayInfo;
        
        for (let task of tasks) {
            const startX = displayInfo.x + task.startX * displayInfo.containerScale * scale;
            const startY = displayInfo.y + task.startY * displayInfo.containerScale * scale;
            const endX = displayInfo.x + task.endX * displayInfo.containerScale * scale;
            const endY = displayInfo.y + task.endY * displayInfo.containerScale * scale;
            
            if (pos.x >= startX && pos.x <= endX && pos.y >= startY && pos.y <= endY) {
                return task;
            }
        }
        
        return null;
    }

    /**
     * 添加到历史记录
     * @param {string} type - 操作类型
     * @param {Object} data - 操作数据
     */
    function addToHistory(type, data) {
        history.push({ type, data, timestamp: Date.now() });
        updateButtonStates();
    }

    /**
     * 更新按钮状态
     */
    function updateButtonStates() {
        // 更新撤销按钮状态
        btnUndo.disabled = history.length === 0;
    }

    /**
     * 将线段绘制到PGM图像数据中
     * @param {Object} start - 起点坐标
     * @param {Object} end - 终点坐标
     * @param {number} lineWidth - 线宽
     * @param {string} color - 颜色 ('black' 或 'white')
     */
    function drawLineToPGM(start, end, lineWidth, color) {
        if (!pgmData) return;
        
        const displayInfo = pgmData.displayInfo;
        const { width, height, imageData } = pgmData;
        
        // 将画布坐标转换为原始图像坐标
        const startOrigX = (start.x - displayInfo.x) / (displayInfo.containerScale * scale);
        const startOrigY = (start.y - displayInfo.y) / (displayInfo.containerScale * scale);
        const endOrigX = (end.x - displayInfo.x) / (displayInfo.containerScale * scale);
        const endOrigY = (end.y - displayInfo.y) / (displayInfo.containerScale * scale);
        
        // 计算线段的dx和dy
        const dx = endOrigX - startOrigX;
        const dy = endOrigY - startOrigY;
        const length = Math.sqrt(dx * dx + dy * dy);
        
        // 计算单位向量
        const unitDx = dx / length;
        const unitDy = dy / length;
        
        // 填充值
        const fillValue = color === 'black' ? 0 : 255;
        
        // 绘制线段 - 对于1像素线宽，直接绘制中心像素
        if (lineWidth <= 1) {
            for (let i = 0; i <= length; i += 0.5) {
                const x = Math.floor(startOrigX + unitDx * i);
                const y = Math.floor(startOrigY + unitDy * i);
                
                // 确保坐标在图像范围内
                if (x >= 0 && x < width && y >= 0 && y < height) {
                    const idx = y * width + x;
                    imageData[idx] = fillValue;
                }
            }
        } else {
            // 对于较宽的线，使用线宽计算
            // 计算垂直单位向量（用于线宽）
            const perpUnitDx = -unitDy;
            const perpUnitDy = unitDx;
            
            // 线宽的一半
            const halfWidth = lineWidth / 2;
            
            for (let i = 0; i <= length; i += 0.5) {
                const x = startOrigX + unitDx * i;
                const y = startOrigY + unitDy * i;
                
                // 在线宽范围内绘制
                for (let j = -halfWidth; j <= halfWidth; j += 0.5) {
                    const px = x + perpUnitDx * j;
                    const py = y + perpUnitDy * j;
                    
                    // 确保坐标在图像范围内
                    if (px >= 0 && px < width && py >= 0 && py < height) {
                        const idx = Math.floor(py) * width + Math.floor(px);
                        imageData[idx] = fillValue;
                    }
                }
            }
        }
        
        // 重绘图像
        drawPGM();
    }
    
    /**
     * 计算并绘制两点的垂直平分线
     * @param {Object} p1 - 第一个点坐标
     * @param {Object} p2 - 第二个点坐标
     * @param {boolean} isTemp - 是否为临时绘制（用于实时更新）
     */
    function drawPerpendicularBisector(p1, p2, isTemp = false) {
        // 计算中点
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        
        // 计算两点之间的距离
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // 垂直平分线长度为两点距离的两倍
        const bisectorLength = distance * 2;
        const halfLength = bisectorLength / 2;
        
        // 计算垂直方向的单位向量
        let perpDx, perpDy;
        if (dx === 0) {
            // 原线是垂直线，垂直平分线是水平线
            perpDx = 1;
            perpDy = 0;
        } else if (dy === 0) {
            // 原线是水平线，垂直平分线是垂直线
            perpDx = 0;
            perpDy = 1;
        } else {
            // 计算垂直方向的向量
            perpDx = -dy;
            perpDy = dx;
            // 归一化
            const perpLength = Math.sqrt(perpDx * perpDx + perpDy * perpDy);
            perpDx /= perpLength;
            perpDy /= perpLength;
        }
        
        // 计算垂直平分线的起点和终点
        const startX = midX - perpDx * halfLength;
        const startY = midY - perpDy * halfLength;
        const endX = midX + perpDx * halfLength;
        const endY = midY + perpDy * halfLength;
        
        const start = { x: startX, y: startY };
        const end = { x: endX, y: endY };
        
        // 绘制原始两点连线（虚线）
        drawCtx.save();
        drawCtx.setLineDash([5, 5]);
        drawCtx.strokeStyle = '#95a5a6';
        drawCtx.lineWidth = 1;
        drawCtx.beginPath();
        drawCtx.moveTo(p1.x, p1.y);
        drawCtx.lineTo(p2.x, p2.y);
        drawCtx.stroke();
        
        // 绘制中点
        drawCtx.fillStyle = '#e74c3c';
        drawCtx.beginPath();
        drawCtx.arc(midX, midY, 5, 0, Math.PI * 2);
        drawCtx.fill();
        
        // 绘制垂直平分线（实线）
        drawCtx.setLineDash([]);
        drawCtx.strokeStyle = '#3498db';
        drawCtx.lineWidth = 2;
        drawCtx.beginPath();
        drawCtx.moveTo(startX, startY);
        drawCtx.lineTo(endX, endY);
        drawCtx.stroke();
        
        drawCtx.restore();
        
        // 仅在非临时绘制时应用到PGM图像数据
        if (!isTemp && pgmData) {
            // 使用固定线宽（1像素，最细）绘制垂直平分线
            drawLineToPGM(start, end, 1, brushColor);
            
            perpendicularLines.push({
                p1: { ...p1 },
                p2: { ...p2 },
                midpoint: { x: midX, y: midY },
                start: { x: startX, y: startY },
                end: { x: endX, y: endY }
            });
            
            // 清除临时点和连接线
            perpendicularPoints = [];
            draw();
            
            // 关闭垂直平分线功能，需要重新点击按钮才能再次使用
            isPerpendicularToolActive = false;
            
            // 切换回钢笔工具
            currentTool = 'pen';
            updateButtonStates();
        }
    }
    
    /**
     * 绘制箭头
     * @param {Object} start - 起点坐标
     * @param {Object} end - 终点坐标
     * @param {boolean} isFinal - 是否为最终箭头
     */
    function drawArrow(start, end, isFinal = false) {
        const headLength = 15;
        const headAngle = Math.PI / 6;
        const lineWidth = isFinal ? 3 : 2;
        const color = isFinal ? '#ff9800' : '#2ecc71';
        const opacity = isFinal ? 1.0 : 0.8;

        drawCtx.save();

        // 绘制线段
        drawCtx.beginPath();
        drawCtx.moveTo(start.x, start.y);
        drawCtx.lineTo(end.x, end.y);
        drawCtx.strokeStyle = `rgba(46, 204, 113, ${opacity})`;
        drawCtx.lineWidth = lineWidth;
        drawCtx.stroke();

        // 计算箭头角度
        const angle = Math.atan2(end.y - start.y, end.x - start.x);

        // 绘制箭头头部
        drawCtx.beginPath();
        drawCtx.moveTo(end.x, end.y);
        drawCtx.lineTo(
            end.x - headLength * Math.cos(angle - headAngle),
            end.y - headLength * Math.sin(angle - headAngle)
        );
        drawCtx.lineTo(
            end.x - headLength * Math.cos(angle + headAngle),
            end.y - headLength * Math.sin(angle + headAngle)
        );
        drawCtx.closePath();
        drawCtx.fillStyle = `rgba(46, 204, 113, ${opacity})`;
        drawCtx.fill();

        // 在起点绘制圆点
        if (isFinal) {
            drawCtx.beginPath();
            drawCtx.arc(start.x, start.y, 5, 0, Math.PI * 2);
            drawCtx.fillStyle = '#ff9800';
            drawCtx.fill();
            drawCtx.strokeStyle = 'white';
            drawCtx.lineWidth = 1;
            drawCtx.stroke();
        }

        drawCtx.restore();
    }

    /**
     * 更新任务高亮显示
     */
    function updateTaskHighlights() {
        if (!pgmData || !pgmData.displayInfo) return;

        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        overlayCtx.save();

        // 绘制所有任务区域
        tasks.forEach((task, index) => {
            const displayInfo = pgmData.displayInfo;
            const startX = displayInfo.x + task.startX * displayInfo.containerScale * scale;
            const startY = displayInfo.y + task.startY * displayInfo.containerScale * scale;
            const endX = displayInfo.x + task.endX * displayInfo.containerScale * scale;
            const endY = displayInfo.y + task.endY * displayInfo.containerScale * scale;

            const width = endX - startX;
            const height = endY - startY;

            // 绘制任务区域边框
            overlayCtx.strokeStyle = '#e74c3c';
            overlayCtx.lineWidth = 2;
            overlayCtx.setLineDash([5, 5]);
            overlayCtx.strokeRect(startX, startY, width, height);
            overlayCtx.setLineDash([]);

            // 填充任务区域
            overlayCtx.fillStyle = 'rgba(231, 76, 60, 0.1)';
            overlayCtx.fillRect(startX, startY, width, height);

            // 在小手模式下不显示任务编号
            if (!isHandMode) {
                // 绘制任务编号背景和文字
                overlayCtx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                overlayCtx.fillRect(startX, startY, 40, 20);

                overlayCtx.fillStyle = '#e74c3c';
                overlayCtx.font = 'bold 14px Arial';
                overlayCtx.fillText(`任务${task.number}`, startX + 5, startY + 15);
            }

            // 如果任务已被选择，显示选择指示器
            if (task.hasBeenSelected) {
                overlayCtx.fillStyle = '#2ecc71';
                overlayCtx.beginPath();
                overlayCtx.arc(startX + 10, startY + 10, 6, 0, Math.PI * 2);
                overlayCtx.fill();
            }
        });

        overlayCtx.restore();
    }

    /**
     * 绘制钢笔路径、矩形等元素
     */
    function draw() {
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

        // 绘制所有箭头
        arrows.forEach(arrow => {
            drawArrow(arrow.start, arrow.end, true);
        });

        // 绘制钢笔路径
        if (points.length > 0) {
            drawCtx.beginPath();
            drawCtx.moveTo(points[0].x, points[0].y);

            for (let i = 1; i < points.length; i++) {
                drawCtx.lineTo(points[i].x, points[i].y);
            }

            if (isClosed) {
                drawCtx.closePath();
                drawCtx.fillStyle = 'rgba(52, 152, 219, 0.2)';
                drawCtx.fill();
            }

            drawCtx.strokeStyle = '#1abc9c';
            drawCtx.lineWidth = 2;
            drawCtx.stroke();

            // 绘制路径点
            points.forEach((point, index) => {
                drawCtx.beginPath();
                drawCtx.arc(point.x, point.y, 6, 0, Math.PI * 2);
                drawCtx.fillStyle = index === 0 ? '#e74c3c' : '#1abc9c';
                drawCtx.fill();
                drawCtx.strokeStyle = 'white';
                drawCtx.lineWidth = 2;
                drawCtx.stroke();
            });

            // 绘制最后一个点的特殊标记
            if (!isClosed && points.length > 0) {
                const lastPoint = points[points.length - 1];
                drawCtx.beginPath();
                drawCtx.arc(lastPoint.x, lastPoint.y, 8, 0, Math.PI * 2);
                drawCtx.strokeStyle = '#2ecc71';
                drawCtx.lineWidth = 2;
                drawCtx.stroke();
            }
        }

        // 绘制垂直平分线
        if (perpendicularPoints.length === 2) {
            drawPerpendicularBisector(perpendicularPoints[0], perpendicularPoints[1], true);
        }
        
        // 绘制所有保存的垂直平分线
        perpendicularLines.forEach(line => {
            drawPerpendicularBisector(line.p1, line.p2);
        });
        
        // 绘制垂直平分线点
        perpendicularPoints.forEach((point, index) => {
            drawCtx.beginPath();
            drawCtx.arc(point.x, point.y, 6, 0, Math.PI * 2);
            drawCtx.fillStyle = '#3498db';
            drawCtx.fill();
            drawCtx.strokeStyle = 'white';
            drawCtx.lineWidth = 2;
            drawCtx.stroke();
        });

        // 绘制钢笔模式下的矩形预览
        if (isPotentialRect && points.length === 0) {
            const rect = drawCanvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            const minX = Math.min(penStartX, x);
            const minY = Math.min(penStartY, y);
            const maxX = Math.max(penStartX, x);
            const maxY = Math.max(penStartY, y);
            const width = maxX - minX;
            const height = maxY - minY;

            drawCtx.beginPath();
            drawCtx.rect(minX, minY, width, height);
            drawCtx.strokeStyle = '#3498db';
            drawCtx.lineWidth = 2;
            drawCtx.setLineDash([5, 5]);
            drawCtx.stroke();
            drawCtx.setLineDash([]);
        }

        // 绘制箭头预览
        if (isDrawingArrow && arrowStartPoint) {
            const rect = drawCanvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            drawArrow(arrowStartPoint, {x, y});
        }

        // 绘制任务模式下的矩形预览
        if (isTaskMode && isDrawingTaskRect) {
            const rect = drawCanvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            const minX = Math.min(taskRectStartX, x);
            const minY = Math.min(taskRectStartY, y);
            const maxX = Math.max(taskRectStartX, x);
            const maxY = Math.max(taskRectStartY, y);
            const width = maxX - minX;
            const height = maxY - minY;

            drawCtx.beginPath();
            drawCtx.rect(minX, minY, width, height);
            drawCtx.strokeStyle = '#e74c3c';
            drawCtx.lineWidth = 2;
            drawCtx.setLineDash([5, 5]);
            drawCtx.stroke();
            drawCtx.setLineDash([]);

            // 在小手模式下不显示任务预览标签
            if (!isHandMode) {
                drawCtx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                drawCtx.fillRect(minX, minY, 40, 20);
                drawCtx.fillStyle = '#e74c3c';
                drawCtx.font = 'bold 14px Arial';
                drawCtx.fillText('新任务', minX + 5, minY + 15);
            }
        }
    }

    /**
     * 应用画笔效果到图像
     * @param {number} x - 鼠标X坐标
     * @param {number} y - 鼠标Y坐标
     */
    function applyBrush(x, y) {
        if (!pgmData) return;

        const displayInfo = pgmData.displayInfo;
        // 转换为原始图像坐标
        const origX = Math.floor((x - displayInfo.x) / (displayInfo.containerScale * scale));
        const origY = Math.floor((y - displayInfo.y) / (displayInfo.containerScale * scale));

        // 检查坐标是否在图像范围内
        if (origX < 0 || origY < 0 || origX >= pgmData.width || origY >= pgmData.height) {
            return;
        }

        // 计算画笔半径
        const radius = Math.floor(brushSize / 2);
        const rSquared = radius * radius;

        // 在画笔半径范围内应用颜色
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const nx = origX + dx;
                const ny = origY + dy;

                if (nx < 0 || ny < 0 || nx >= pgmData.width || ny >= pgmData.height) {
                    continue;
                }

                if (dx * dx + dy * dy <= rSquared) {
                    const idx = ny * pgmData.width + nx;
                    pgmData.imageData[idx] = brushColor === 'black' ? 0 : 255;
                }
            }
        }

        // 重绘图像和路径
        drawPGM();
        draw();
    }

    /**
     * 填充矩形区域
     * @param {number} x1 - 起始X坐标
     * @param {number} y1 - 起始Y坐标
     * @param {number} x2 - 结束X坐标
     * @param {number} y2 - 结束Y坐标
     * @param {string} color - 填充颜色 ('black' 或 'white')
     */
    function fillRect(x1, y1, x2, y2, color) {
        if (!pgmData) return;

        const displayInfo = pgmData.displayInfo;

        // 将画布坐标转换为原始图像坐标
        const startX = Math.floor((Math.min(x1, x2) - displayInfo.x) / (displayInfo.containerScale * scale));
        const startY = Math.floor((Math.min(y1, y2) - displayInfo.y) / (displayInfo.containerScale * scale));
        const endX = Math.floor((Math.max(x1, x2) - displayInfo.x) / (displayInfo.containerScale * scale));
        const endY = Math.floor((Math.max(y1, y2) - displayInfo.y) / (displayInfo.containerScale * scale));

        // 确保坐标在图像范围内
        const clampedStartX = Math.max(0, startX);
        const clampedStartY = Math.max(0, startY);
        const clampedEndX = Math.min(pgmData.width - 1, endX);
        const clampedEndY = Math.min(pgmData.height - 1, endY);

        // 填充颜色值
        const fillValue = color === 'black' ? 0 : 255;

        // 填充矩形区域
        for (let y = clampedStartY; y <= clampedEndY; y++) {
            for (let x = clampedStartX; x <= clampedEndX; x++) {
                const idx = y * pgmData.width + x;
                pgmData.imageData[idx] = fillValue;
            }
        }

        // 重绘图像
        drawPGM();
    }

    /**
     * 填充钢笔路径区域
     * @param {string} color - 填充颜色 ('black' 或 'white')
     */
    function fillPath(color) {
        if (!pgmData || points.length < 3) return;

        const { width, height } = pgmData;
        const displayInfo = pgmData.displayInfo;

        // 创建离屏Canvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');

        // 开始路径
        tempCtx.beginPath();

        // 转换第一个点
        const firstPoint = points[0];
        const origX0 = (firstPoint.x - displayInfo.x) / (displayInfo.containerScale * scale);
        const origY0 = (firstPoint.y - displayInfo.y) / (displayInfo.containerScale * scale);
        tempCtx.moveTo(origX0, origY0);

        // 添加其他点
        for (let i = 1; i < points.length; i++) {
            const point = points[i];
            const origX = (point.x - displayInfo.x) / (displayInfo.containerScale * scale);
            const origY = (point.y - displayInfo.y) / (displayInfo.containerScale * scale);
            tempCtx.lineTo(origX, origY);
        }

        tempCtx.closePath();

        // 填充
        const fillValue = color === 'black' ? 0 : 255;
        tempCtx.fillStyle = `rgb(${fillValue},${fillValue},${fillValue})`;
        tempCtx.fill();

        // 获取图像数据
        const imgData = tempCtx.getImageData(0, 0, width, height);
        const data = imgData.data;

        // 更新原始图像数据：只更新路径内部的像素
        for (let i = 0; i < data.length; i += 4) {
            // 如果这个像素被填充了（非透明）
            if (data[i+3] > 0) {
                const pixelIndex = i / 4;
                pgmData.imageData[pixelIndex] = fillValue;
            }
        }

        // 重绘
        drawPGM();
    }

    /**
     * 显示操作反馈提示
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {string} text - 提示文本
     */
    function showActionFeedback(x, y, text) {
        const feedback = document.createElement('div');
        feedback.className = 'action-feedback';
        feedback.textContent = text;
        feedback.style.left = `${x}px`;
        feedback.style.top = `${y - 30}px`;
        document.body.appendChild(feedback);

        // 设置提示消失动画
        setTimeout(() => {
            feedback.style.opacity = '0';
            setTimeout(() => document.body.removeChild(feedback), 300);
        }, 800);
    }

    /**
     * 生成任务区域缩略图
     * @param {number} startX - 起始X坐标
     * @param {number} startY - 起始Y坐标
     * @param {number} endX - 结束X坐标
     * @param {number} endY - 结束Y坐标
     * @returns {string} 缩略图的DataURL
     */
    function generateTaskThumbnail(startX, startY, endX, endY) {
        if (!pgmData) return null;

        const width = endX - startX;
        const height = endY - startY;

        if (width <= 0 || height <= 0) return null;

        // 创建临时canvas绘制任务区域
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');

        // 创建图像数据
        const imgData = tempCtx.createImageData(width, height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const origIdx = (startY + y) * pgmData.width + (startX + x);
                const gray = pgmData.imageData[origIdx];
                const idx = (y * width + x) * 4;
                imgData.data[idx] = gray;
                imgData.data[idx + 1] = gray;
                imgData.data[idx + 2] = gray;
                imgData.data[idx + 3] = 255;
            }
        }

        tempCtx.putImageData(imgData, 0, 0);

        // 创建缩略图canvas (50x50)
        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = 50;
        thumbCanvas.height = 50;
        const thumbCtx = thumbCanvas.getContext('2d');

        // 填充背景
        thumbCtx.fillStyle = '#f5f5f5';
        thumbCtx.fillRect(0, 0, 50, 50);

        // 计算缩放比例并绘制
        const thumbScale = Math.min(50 / width, 50 / height);
        const scaledWidth = width * thumbScale;
        const scaledHeight = height * thumbScale;
        const offsetX = (50 - scaledWidth) / 2;
        const offsetY = (50 - scaledHeight) / 2;

        thumbCtx.drawImage(tempCanvas, 0, 0, width, height, offsetX, offsetY, scaledWidth, scaledHeight);

        return thumbCanvas.toDataURL('image/png');
    }

    // 鼠标事件处理
    drawCanvas.addEventListener('mousedown', handleMouseDown);
    drawCanvas.addEventListener('mousemove', handleMouseMove);
    drawCanvas.addEventListener('mouseup', handleMouseUp);
    drawCanvas.addEventListener('mouseout', handleMouseUp);
    drawCanvas.addEventListener('mouseleave', () => {
        coordinateReadout.textContent = '光标坐标：—';
    });
    showMetricGrid.addEventListener('change', drawCoordinateOverlay);
    showWorldAxes.addEventListener('change', drawCoordinateOverlay);
    fitMapButton.addEventListener('click', () => {
        scale = 1;
        offsetX = 0;
        offsetY = 0;
        zoomDisplay.textContent = '100%';
        if (pgmData) {
            drawPGM();
            redrawAll();
        }
    });

    // 触摸事件处理
    drawCanvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    drawCanvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    drawCanvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    drawCanvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    
    // 添加触摸双击检测
    let lastTapTime = 0;
    let tapTimer = null;

    /**
     * 鼠标按下事件处理
     * @param {MouseEvent} e - 鼠标事件对象
     */
    function handleMouseDown(e) {
        if (!pgmData) {
            statusMessage.style.display = 'block';
            statusMessage.textContent = "请先上传PGM文件";
            return;
        }

        const rect = drawCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // 拖拽图像模式
        if (isDragMode) {
            isDraggingImage = true;
            dragStartX = x;
            dragStartY = y;
            startOffsetX = offsetX;
            startOffsetY = offsetY;
            drawCanvas.style.cursor = 'grabbing';
            e.preventDefault();
            return;
        }

        // 箭头工具处理
        if (currentTool === 'arrow') {
            if (!arrowStartPoint) {
                // 第一次点击 - 设置起点
                arrowStartPoint = { x, y };
                isDrawingArrow = true;
                saveHistory();
                showActionFeedback(x, y, '设置箭头起点');
            } else {
                // 第二次点击 - 设置终点并完成箭头
                arrowEndPoint = { x, y };
                arrows.push({ start: arrowStartPoint, end: arrowEndPoint });
                isDrawingArrow = false;
                arrowStartPoint = null;
                saveHistory();
                showActionFeedback(x, y, '箭头绘制完成');
                draw();
            }
            return;
        }

        // 垂直平分线工具处理
        if (currentTool === 'perpendicular') {
            // 优先检测是否点击了已有的垂直平分线点
            let clickedExistingPoint = false;
            for (let i = 0; i < perpendicularPoints.length; i++) {
                const point = perpendicularPoints[i];
                const dx = point.x - x;
                const dy = point.y - y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 10) {
                    isDraggingPerpendicularPoint = true;
                    dragPerpendicularPointIndex = i;
                    saveHistory();
                    showActionFeedback(x, y, '开始拖拽垂直平分线点');
                    clickedExistingPoint = true;
                    break;
                }
            }

            if (!clickedExistingPoint) {
                perpendicularPoints.push({ x, y });
                
                if (perpendicularPoints.length === 1) {
                    // 第一次点击 - 设置第一个点
                    showActionFeedback(x, y, '设置第一个点');
                } else if (perpendicularPoints.length === 3) {
                    // 第三次点击 - 保存前两个点为垂直平分线并开始新的
                    const p1 = perpendicularPoints[0];
                    const p2 = perpendicularPoints[1];
                    drawPerpendicularBisector(p1, p2);
                    // 保留第三个点作为新的第一个点
                    perpendicularPoints = [perpendicularPoints[2]];
                    saveHistory();
                    showActionFeedback(x, y, '垂直平分线绘制完成，开始新的');
                }
            }
            draw();
            return;
        }

        // 小手模式：按点击顺序重新编号任务
        if (isHandMode) {
            let clickedOnTask = false;
            let selectedTask = null;

            // 从后往前遍历（因为后添加的任务在视觉上层）
            for (let i = tasks.length - 1; i >= 0; i--) {
                const task = tasks[i];
                const displayInfo = pgmData.displayInfo;

                // 计算任务在画布上的矩形区域
                const startX = displayInfo.x + task.startX * displayInfo.containerScale * scale;
                const startY = displayInfo.y + task.startY * displayInfo.containerScale * scale;
                const endX = displayInfo.x + task.endX * displayInfo.containerScale * scale;
                const endY = displayInfo.y + task.endY * displayInfo.containerScale * scale;

                const minX = Math.min(startX, endX);
                const maxX = Math.max(startX, endX);
                const minY = Math.min(startY, endY);
                const maxY = Math.max(startY, endY);

                // 检查点击位置是否在任务区域内
                if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
                    clickedOnTask = true;
                    selectedTask = task;

                    // 标记任务已被选择
                    task.hasBeenSelected = true;

                    // 分配任务编号
                    if (!task.number) {
                        task.number = taskNumberCounter++;
                        taskSelectionOrder.push(task.id);
                    } else {
                        // 更新选择顺序
                        const index = taskSelectionOrder.indexOf(task.id);
                        if (index !== -1) {
                            taskSelectionOrder.splice(index, 1);
                        }
                        taskSelectionOrder.push(task.id);
                    }

                    // 更新界面
                    updateSequencePreview();
                    renumberTasks();
                    updateTaskQueue();
                    saveHistory();
                    updateTaskHighlights();

                    // 显示反馈
                    showActionFeedback(x, y, `任务 #${task.number} 已分配`);
                    break;
                }
            }

            // 所有任务都已选择时退出小手模式
            if (clickedOnTask) {
                const allTasksSelected = tasks.every(task => task.hasBeenSelected);
                if (allTasksSelected) {
                    isHandMode = false;
                    updateButtonStates();
                    showActionFeedback(x, y, '所有任务已选择，小手模式已退出');
                }
            } else {
                showActionFeedback(x, y, '请点击任务区域');
            }
            return;
        }

        // 任务模式下的矩形绘制
        if (isTaskMode) {
            isDrawingTaskRect = true;
            taskRectStartX = x;
            taskRectStartY = y;
            return;
        }

        // 画笔工具
        if (currentTool === 'brush') {
            isDrawing = true;
            lastX = x;
            lastY = y;
            saveHistory();
            applyBrush(x, y);
            return;
        }

        // 钢笔工具
        if (currentTool === 'pen') {
            // 优先检测是否点击了已有的锚点
            for (let i = 0; i < points.length; i++) {
                const point = points[i];
                const dx = point.x - x;
                const dy = point.y - y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 10) {
                    isDragging = true;
                    dragPointIndex = i;
                    saveHistory();

                    // 高亮显示被拖拽的点
                    pointHighlight.style.display = 'block';
                    pointHighlight.style.left = `${point.x}px`;
                    pointHighlight.style.top = `${point.y}px`;

                    return;
                }
            }

            // 如果没有点击在锚点上，则设置可能开始绘制矩形
            isPotentialRect = true;
            penStartX = x;
            penStartY = y;

            return;
        }
    }

    /**
     * 鼠标移动事件处理
     * @param {MouseEvent} e - 鼠标事件对象
     */
    function handleMouseMove(e) {
        if (!pgmData) return;

        const rect = drawCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        updateCoordinateReadout(x, y);

        // 拖拽图像
        if (isDraggingImage) {
            offsetX = startOffsetX + (x - dragStartX);
            offsetY = startOffsetY + (y - dragStartY);
            drawPGM();
            draw();
            return;
        }

        // 画笔工具绘制
        if (currentTool === 'brush' && isDrawing) {
            drawCtx.beginPath();
            drawCtx.moveTo(lastX, lastY);
            drawCtx.lineTo(x, y);
            drawCtx.strokeStyle = brushColor;
            drawCtx.lineWidth = brushSize;
            drawCtx.lineCap = 'round';
            drawCtx.lineJoin = 'round';
            drawCtx.stroke();

            applyBrush(x, y);
            lastX = x;
            lastY = y;
            return;
        }

        // 箭头工具：预览箭头
        if (currentTool === 'arrow' && arrowStartPoint) {
            draw();
            return;
        }

        // 钢笔工具：拖拽点
        if (isDragging && dragPointIndex >= 0) {
            points[dragPointIndex] = {x, y};

            // 更新高亮点位置
            pointHighlight.style.left = `${x}px`;
            pointHighlight.style.top = `${y}px`;

            draw();
            return;
        }

        // 垂直平分线工具：拖拽点
        if (isDraggingPerpendicularPoint && dragPerpendicularPointIndex >= 0) {
            perpendicularPoints[dragPerpendicularPointIndex] = {x, y};
            draw();
            return;
        }

        // 钢笔工具：自由绘制路径预览
        if (currentTool === 'pen' && !isClosed && points.length > 0 && !isPotentialRect) {
            draw();
            const lastPoint = points[points.length - 1];
            drawCtx.beginPath();
            drawCtx.moveTo(lastPoint.x, lastPoint.y);
            drawCtx.lineTo(x, y);
            drawCtx.strokeStyle = '#2ecc71';
            drawCtx.lineWidth = 1;
            drawCtx.setLineDash([5, 5]);
            drawCtx.stroke();
            drawCtx.setLineDash([]);
        }

        // 钢笔工具：矩形绘制预览
        if (currentTool === 'pen' && isPotentialRect) {
            const dx = x - penStartX;
            const dy = y - penStartY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance > 5) {
                // 开始绘制矩形
                isDrawingRect = true;
                points = [];
            }

            draw();
        }

        // 任务模式下的实时矩形预览
        if (isTaskMode && isDrawingTaskRect) {
            draw();
        }
    }

    /**
     * 鼠标释放事件处理
     */
    function handleMouseUp(e) {
        const rect = drawCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // 箭头工具：不需要在mouseup时处理，因为通过点击处理
        if (currentTool === 'arrow') return;

        // 钢笔工具：结束拖拽点
        if (isDragging) {
            isDragging = false;
            dragPointIndex = -1;
            saveHistory();

            // 隐藏高亮点
            pointHighlight.style.display = 'none';
        }

        // 垂直平分线工具：结束拖拽点
        if (isDraggingPerpendicularPoint) {
            isDraggingPerpendicularPoint = false;
            dragPerpendicularPointIndex = -1;
            
            // 将拖拽后的垂直平分线重新绘制到PGM图像数据中
            if (perpendicularPoints.length === 2) {
                // 清除旧的垂直平分线效果
                const tempImageData = new Uint8ClampedArray(originalPgmData.imageData);
                pgmData.imageData.set(tempImageData);
                
                // 重新应用所有编辑，包括最新的垂直平分线
                // 重新应用箭头
                arrows.forEach(arrow => {
                    // 箭头目前只绘制在画布上，没有直接修改PGM数据，所以不需要重新绘制
                });
                
                // 重新应用垂直平分线
                perpendicularLines.forEach(line => {
                    drawLineToPGM(line.start, line.end, brushSize, brushColor);
                });
                
                // 重新应用当前正在编辑的垂直平分线
                if (perpendicularPoints.length === 2) {
                    const p1 = perpendicularPoints[0];
                    const p2 = perpendicularPoints[1];
                    // 计算垂直平分线的起点和终点
                    const midX = (p1.x + p2.x) / 2;
                    const midY = (p1.y + p2.y) / 2;
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const bisectorLength = distance * 2;
                    const halfLength = bisectorLength / 2;
                    
                    let perpDx, perpDy;
                    if (dx === 0) {
                        perpDx = 1;
                        perpDy = 0;
                    } else if (dy === 0) {
                        perpDx = 0;
                        perpDy = 1;
                    } else {
                        perpDx = -dy;
                        perpDy = dx;
                        const perpLength = Math.sqrt(perpDx * perpDx + perpDy * perpDy);
                        perpDx /= perpLength;
                        perpDy /= perpLength;
                    }
                    
                    const start = {
                        x: midX - perpDx * halfLength,
                        y: midY - perpDy * halfLength
                    };
                    const end = {
                        x: midX + perpDx * halfLength,
                        y: midY + perpDy * halfLength
                    };
                    
                    drawLineToPGM(start, end, brushSize, brushColor);
                }
            }
            
            saveHistory();
            showActionFeedback(x, y, '垂直平分线点拖拽完成');
        }

        // 画笔工具：结束绘制
        if (isDrawing) {
            isDrawing = false;
            saveHistory();
        }

        // 钢笔工具：完成矩形绘制
        if (currentTool === 'pen' && isDrawingRect) {
            // 添加矩形的四个角点
            points = [
                {x: penStartX, y: penStartY},
                {x: x, y: penStartY},
                {x: x, y: y},
                {x: penStartX, y: y}
            ];

            isClosed = true;
            isDrawingRect = false;
            isPotentialRect = false;

            // 应用填充 - 使用画笔颜色而不是填充选项
            if (brushColor !== 'none') {
                fillRect(penStartX, penStartY, x, y, brushColor);
            }

            saveHistory();
            showActionFeedback(x, y, '矩形选区已创建');
            draw();
        }
        // 钢笔工具：添加点
        else if (currentTool === 'pen' && isPotentialRect && !isDrawingRect) {
            // 添加点
            points.push({x: penStartX, y: penStartY});
            isClosed = false;
            saveHistory();
            draw();
            showActionFeedback(penStartX, penStartY, `添加点 ${points.length}`);
        }

        // 重置标志
        isPotentialRect = false;
        isDrawingRect = false;

        // 任务模式：完成绘制任务矩形
        if (isTaskMode && isDrawingTaskRect) {
            isDrawingTaskRect = false;

            // 确保矩形有足够大小
            if (Math.abs(x - taskRectStartX) > 10 && Math.abs(y - taskRectStartY) > 10) {
                addTask(taskRectStartX, taskRectStartY, x, y);
            }

            draw();
        }

        // 结束拖拽图像
        if (isDraggingImage) {
            isDraggingImage = false;
            drawCanvas.style.cursor = isDragMode ? 'grab' : 'crosshair';
        }
    }

    // 双击闭合路径
    drawCanvas.addEventListener('dblclick', (e) => {
        if (currentTool === 'pen' && points.length > 2 && !isClosed) {
            const rect = drawCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            isClosed = true;
            draw();

            // 应用填充
            if (brushColor !== 'none') {
                fillPath(brushColor);
            }

            saveHistory();
            showActionFeedback(x, y, '路径已闭合');
        }
    });
    /**
     * 保存当前状态到历史记录
     */
    function saveHistory() {
        history.push({
            points: [...points],
            isClosed,
            pgmData: pgmData ? {
                ...pgmData,
                imageData: new Uint8ClampedArray(pgmData.imageData)
            } : null,
            tasks: [...tasks],
            taskNumberCounter,
            taskSelectionOrder: [...taskSelectionOrder],
            arrows: [...arrows],
            perpendicularLines: [...perpendicularLines]
        });

        updateButtonStates();
    }

    /**
     * 撤销操作
     */
    function undo() {
        if (history.length > 1) {
            history.pop();
            const prevState = history[history.length - 1];

            // 恢复状态
            points = [...prevState.points];
            isClosed = prevState.isClosed;
            tasks = [...prevState.tasks];
            taskNumberCounter = prevState.taskNumberCounter || 1;
            taskSelectionOrder = [...prevState.taskSelectionOrder];
            arrows = [...prevState.arrows];
            perpendicularLines = [...prevState.perpendicularLines];

            // 恢复PGM数据
            if (prevState.pgmData) {
                pgmData = {
                    ...prevState.pgmData,
                    imageData: new Uint8ClampedArray(prevState.pgmData.imageData)
                };
                drawPGM();
            }

            // 更新界面
            draw();
            updateTaskQueue();
            updateButtonStates();
            showActionFeedback(20, 20, '已撤销');
        }
    }

    /**
     * 更新按钮状态
     */
    function updateButtonStates() {
        document.getElementById('btnUndo').disabled = history.length <= 1;

        // 更新工具按钮状态
        // document.getElementById('btnPen').classList.toggle('tool-selected', currentTool === 'pen');
        // document.getElementById('btnBrush').classList.toggle('tool-selected', currentTool === 'brush');
        // document.getElementById('btnArrow').classList.toggle('tool-selected', currentTool === 'arrow');
        // document.getElementById('btnDrag').classList.toggle('secondary', !isDragMode);
        // document.getElementById('btnTask').classList.toggle('secondary', !isTaskMode);
        // document.getElementById('btnHand').classList.toggle('secondary', !isHandMode);

        // 更新模式指示器
        document.querySelector('#btnDrag .mode-indicator').classList.toggle('active', isDragMode);
        document.querySelector('#btnTask .mode-indicator').classList.toggle('active', isTaskMode);
        document.querySelector('#btnHand .mode-indicator').classList.toggle('active', isHandMode);

        // 设置工具提示
        document.querySelector('#btnDrag .mode-indicator').title = isDragMode ? "拖拽模式已激活" : "拖拽模式已关闭";
        document.querySelector('#btnTask .mode-indicator').title = isTaskMode ? "任务模式已激活" : "任务模式已关闭";
        document.querySelector('#btnHand .mode-indicator').title = isHandMode ? "小手模式已激活" : "小手模式已关闭";

        // 小手模式相关UI显示
        handModeInstruction.style.display = isHandMode ? 'block' : 'none';
        handModePreview.style.display = isHandMode ? 'block' : 'none';

        if (isHandMode) {
            updateSequencePreview();
        }

        // 更新工具提示
        if (currentTool === 'pen') {
            toolHint.textContent = "提示：在钢笔模式下，点击/触摸添加多边形点，双击/双触闭合路径；或点击拖动绘制矩形（触摸：点击并拖动完成矩形绘制）";
        } else if (currentTool === 'brush') {
            toolHint.textContent = "提示：在画笔模式下，点击并拖动鼠标进行绘制，使用左侧控件调整画笔大小和颜色";
        } else if (currentTool === 'arrow') {
            toolHint.textContent = "提示：在箭头模式下，第一次点击设置起点，移动鼠标预览箭头，再次点击完成绘制";
        } else if (currentTool === 'drag') {
            toolHint.textContent = "提示：在拖拽模式下，点击并拖动鼠标可以移动图像位置";
        } else if (currentTool === 'task') {
            toolHint.textContent = "提示：在任务模式下，点击并拖动鼠标可以创建新的任务区域";
        } else if (currentTool === 'hand') {
            toolHint.textContent = "提示：在小手模式下，点击任务区域按点击顺序重新编号";
        } else if (currentTool === 'perpendicular') {
            toolHint.textContent = "提示：在垂直平分线模式下，点击地图上两个点，自动绘制两点之间的垂直平分线";
        }
    }

    /**
     * 清除所有编辑痕迹，恢复原始图像
     */
    function clearAll() {
        if (!originalPgmData) return;

        // 恢复原始图像数据
        pgmData = {
            ...originalPgmData,
            imageData: new Uint8ClampedArray(originalPgmData.imageData)
        };

        // 重置所有状态
        points = [];
        isClosed = false;
        history = [];
        tasks = [];
        taskSelectionOrder = [];
        taskNumberCounter = 1;
        arrows = [];
        arrowStartPoint = null;
        isDrawingArrow = false;
        perpendicularPoints = [];
        perpendicularLines = [];
        updateTaskQueue();

        // 重置缩放和偏移
        scale = 1.0;
        offsetX = 0;
        offsetY = 0;
        zoomDisplay.textContent = '100%';
        dragHint.style.display = 'none';

        // 保存当前状态
        saveHistory();

        // 重绘
        drawPGM();
        draw();
        updateButtonStates();

        showActionFeedback(20, 20, '已清除所有编辑痕迹');
    }

    /**
     * 生成抠图 - 修改后的版本：未选中的区域变为黑色
     */
    function generateCutout() {
        if (!pgmData) {
            statusMessage.style.display = 'block';
            statusMessage.textContent = "请先上传PGM文件";
            return;
        }

        const { width, height, imageData } = pgmData;
        const displayInfo = pgmData.displayInfo;

        // 创建临时Canvas
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');

        // 绘制原始图像
        const imgData = tempCtx.createImageData(width, height);
        for (let i = 0; i < imageData.length; i++) {
            const idx = i * 4;
            imgData.data[idx] = imageData[i];
            imgData.data[idx + 1] = imageData[i];
            imgData.data[idx + 2] = imageData[i];
            imgData.data[idx + 3] = 255;
        }
        tempCtx.putImageData(imgData, 0, 0);

        // 创建结果图像数据
        const resultData = new Uint8ClampedArray(width * height * 4);

        // 如果没有路径，整个图像保留（不应用任何抠图）
        if (points.length === 0) {
            for (let i = 0; i < imageData.length; i++) {
                const idx = i * 4;
                const gray = imageData[i];
                resultData[idx] = gray;
                resultData[idx + 1] = gray;
                resultData[idx + 2] = gray;
                resultData[idx + 3] = 255;
            }
        } else {
            // 创建遮罩Canvas
            const maskCanvas = document.createElement('canvas');
            maskCanvas.width = width;
            maskCanvas.height = height;
            const maskCtx = maskCanvas.getContext('2d');

            // 在遮罩上绘制路径（用原始图像坐标）
            maskCtx.beginPath();
            const firstPoint = points[0];
            const origX0 = (firstPoint.x - displayInfo.x) / (displayInfo.containerScale * scale);
            const origY0 = (firstPoint.y - displayInfo.y) / (displayInfo.containerScale * scale);
            maskCtx.moveTo(origX0, origY0);

            for (let i = 1; i < points.length; i++) {
                const point = points[i];
                const x = (point.x - displayInfo.x) / (displayInfo.containerScale * scale);
                const y = (point.y - displayInfo.y) / (displayInfo.containerScale * scale);
                maskCtx.lineTo(x, y);
            }

            // 闭合路径
            if (isClosed) {
                maskCtx.closePath();
            }

            maskCtx.fillStyle = 'white';
            maskCtx.fill();

            // 获取遮罩数据
            const maskData = maskCtx.getImageData(0, 0, width, height).data;

            // 获取原始图像数据
            const originalData = tempCtx.getImageData(0, 0, width, height).data;

            // 创建结果图像数据：路径内保留原始图像，路径外变为黑色
            for (let i = 0; i < width * height; i++) {
                const idx = i * 4;
                // 检查遮罩像素（使用红色通道）
                if (maskData[idx] > 0) {
                    // 路径内：保留原始图像
                    resultData[idx] = originalData[idx];     // R
                    resultData[idx + 1] = originalData[idx + 1]; // G
                    resultData[idx + 2] = originalData[idx + 2]; // B
                    resultData[idx + 3] = 255;                 // A
                } else {
                    // 路径外：黑色
                    resultData[idx] = 0;
                    resultData[idx + 1] = 0;
                    resultData[idx + 2] = 0;
                    resultData[idx + 3] = 255;
                }
            }
        }

        // 创建结果Canvas
        const resultCanvas = document.createElement('canvas');
        resultCanvas.width = width;
        resultCanvas.height = height;
        const resultCtx = resultCanvas.getContext('2d');

        // 将结果绘制到Canvas
        const resultImgData = new ImageData(resultData, width, height);
        resultCtx.putImageData(resultImgData, 0, 0);

        // 显示结果
        const img = document.createElement('img');
        img.src = resultCanvas.toDataURL('image/png');
        img.className = 'result-image';
        img.alt = '抠图结果';

        resultContainer.innerHTML = '';
        resultContainer.appendChild(img);

        // 保存结果用于下载
        lastCutoutImageData = resultCanvas;

        // 创建PGM格式的抠图数据
        const pgmImageData = new Uint8ClampedArray(width * height);
        for (let i = 0; i < pgmImageData.length; i++) {
            const idx = i * 4;
            pgmImageData[i] = resultData[idx]; // 取R通道值
        }

        lastCutoutPGMData = {
            width,
            height,
            maxValue: pgmData.maxValue,
            imageData: pgmImageData
        };

        showActionFeedback(20, 20, '抠图已生成');
    }

    /**
     * 下载PNG格式的抠图
     */
    // function downloadPNG() {
    //     if (!lastCutoutImageData) {
    //         statusMessage.style.display = 'block';
    //         statusMessage.textContent = "没有可下载的结果";
    //         return;
    //     }
    //
    //     const link = document.createElement('a');
    //     link.download = 'cutout.png';
    //     link.href = lastCutoutImageData.toDataURL('image/png');
    //     link.click();
    // }

    /**
     * 下载PGM格式的抠图
     */

    function downloadPGM() {
        generateCutout();
        if (!lastCutoutPGMData || !mapSelector.value) {
            statusMessage.style.display = 'block';
            statusMessage.textContent = "没有可下载的结果或未选择地图";
            return;
        }

        statusMessage.style.display = 'block';
        statusMessage.textContent = "正在保存PGM文件...";

        // 1. 创建PGM文件内容 - 单一部分
        const { width, height, maxValue, imageData } = lastCutoutPGMData;
        let pgmContent = `P5\n${width} ${height}\n${maxValue}\n`;

        // 2. 合并文件头和图像数据
        const encoder = new TextEncoder();
        const header = encoder.encode(pgmContent);
        const pgmBytes = new Uint8Array(header.length + imageData.length);
        pgmBytes.set(header);
        pgmBytes.set(imageData, header.length);

        // 3. 创建正确的Blob和File对象 🔑
        const pgmBlob = new Blob([pgmBytes], {
            type: 'image/x-portable-greymap'  // 标准PGM MIME类型
        });

        // 4. 创建File对象确保包含文件名
        const pgmFile = new File([pgmBlob], "map.pgm", {
            type: 'image/x-portable-greymap',
            lastModified: Date.now()
        });

        // 5. 构建FormData
        const formData = new FormData();
        formData.append('pgm', pgmFile);
        
        // 判断是主地图还是子地图
        let mapNameToSave;
        if (currentSelectedSubFile) {
            // 如果是子地图，使用child.path作为mapName
            mapNameToSave = currentSelectedSubFile.path;
            console.log(`保存子地图: ${mapNameToSave}`);
        } else {
            // 如果是主地图，使用选择器的值
            mapNameToSave = mapSelector.value;
            console.log(`保存主地图: ${mapNameToSave}`);
        }

        formData.append('mapName', mapNameToSave);
       
        


        // 7. 获取当前地图的YAML文件内容
        const mapName = mapSelector.value;
        
        // 异步获取YAML文件内容
        fetch(`/api/map-workbench/file/yaml/${encodeURIComponent(mapNameToSave)}`, {headers:mapAuth()})
            .then(response => {
                if (!response.ok) {
                    throw new Error(`YAML配置加载失败: ${response.status} ${response.statusText}`);
                }
                return response.text();
            })
            .then(yamlContent => {
                // 8. 创建YAML Blob对象
                const yamlBlob = new Blob([yamlContent], { type: 'text/yaml' });

                // 9. 构建FormData用于新的/pgm/save接口
                const formData = new FormData();
                
                // 直接添加Blob对象，并指定文件名
                formData.append('pgm', pgmBlob, "map.pgm");
                formData.append('metadata', yamlBlob, "map.yaml");

                // 10. 验证FormData内容
      
                const xhr = new XMLHttpRequest();
                
                // 设置请求完成和错误处理
                xhr.onload = function() {
                    let result;
                    try { result = JSON.parse(xhr.responseText); } catch { result = {}; }
                    if (xhr.status >= 200 && xhr.status < 300 && result.code === 0) {
                        if (result.data.id === loadedMapKey) gridRevision = result.data.revision;
                        parent.postMessage({type:'map-saved',id:result.data.id}, location.origin);
                        statusMessage.textContent = "地图保存成功！";
                        setTimeout(() => statusMessage.style.display = 'none', 3000);
                    } else {
                        console.error("地图保存失败:", xhr.status, xhr.responseText);
                        statusMessage.textContent = `保存失败: ${result.message || result.detail || xhr.status}`;
                    }
                };
                
                xhr.onerror = function() {
                    console.error("地图保存失败: 网络错误");
                    statusMessage.textContent = "保存失败: 网络错误";
                };
                
                // 打开POST请求到/pgm/save端点，path作为URL参数
                formData.append('asset_id', mapNameToSave);
                if (gridRevision) formData.append('revision', gridRevision);
                xhr.open('POST', '/api/map-workbench/grid', true);
                xhr.setRequestHeader('Authorization', localStorage.getItem('token') || '');
                
                // 发送FormData - 浏览器会自动设置正确的Content-Type和边界
                xhr.send(formData);
            })
            .catch(error => {
                console.error("YAML文件加载失败:", error);
                statusMessage.textContent = `保存失败: ${error.message}`;
            });
    }
    /**
     * 添加任务
     * @param {number} x1 - 起始X坐标
     * @param {number} y1 - 起始Y坐标
     * @param {number} x2 - 结束X坐标
     * @param {number} y2 - 结束Y坐标
     */
    function addTask(x1, y1, x2, y2) {
        if (!pgmData) return;

        const displayInfo = pgmData.displayInfo;

        // 转换为原始图像坐标
        const startX = Math.floor((Math.min(x1, x2) - displayInfo.x) / (displayInfo.containerScale * scale));
        const startY = Math.floor((Math.min(y1, y2) - displayInfo.y) / (displayInfo.containerScale * scale));
        const endX = Math.floor((Math.max(x1, x2) - displayInfo.x) / (displayInfo.containerScale * scale));
        const endY = Math.floor((Math.max(y1, y2) - displayInfo.y) / (displayInfo.containerScale * scale));

        // 确保坐标在图像范围内
        const clampedStartX = Math.max(0, startX);
        const clampedStartY = Math.max(0, startY);
        const clampedEndX = Math.min(pgmData.width - 1, endX);
        const clampedEndY = Math.min(pgmData.height - 1, endY);

        // 创建任务对象
        const task = {
            id: Date.now(),
            startX: clampedStartX,
            startY: clampedStartY,
            endX: clampedEndX,
            endY: clampedEndY,
            hasBeenSelected: false,
            thumbnail: generateTaskThumbnail(clampedStartX, clampedStartY, clampedEndX, clampedEndY)
        };

        // 添加到任务队列
        tasks.push(task);
        updateTaskQueue();
        saveHistory();

        showActionFeedback(20, 20, `任务已添加到队列`);
    }

    /**
     * 更新任务队列显示
     */
    function updateTaskQueue() {
        taskItemsContainer.innerHTML = '';
        taskCount.textContent = tasks.length;

        if (tasks.length === 0) {
            taskQueueEmpty.style.display = 'block';
            return;
        }

        taskQueueEmpty.style.display = 'none';

        // 按任务编号排序
        const sortedTasks = [...tasks].sort((a, b) => {
            if (a.number === undefined) return 1;
            if (b.number === undefined) return -1;
            return a.number - b.number;
        });

        // 创建任务项
        sortedTasks.forEach((task, index) => {
            const taskItem = document.createElement('div');
            taskItem.className = 'task-item';
            taskItem.dataset.id = task.id;
            taskItem.dataset.index = index;
            taskItem.draggable = true;

            taskItem.innerHTML = `
                <div class="task-thumbnail">
                    ${task.thumbnail ?
                `<img src="${task.thumbnail}" alt="任务区域缩略图">` :
                `<div class="placeholder">无缩略图</div>`
            }
                </div>
                <div class="task-number">${task.number || '?'}</div>
                <div class="task-info">
                    <div>任务 #${task.number || '未编号'}</div>
                    <div class="task-coords">(${task.startX},${task.startY}) - (${task.endX},${task.endY})</div>
                </div>
                <div class="task-actions">
                    <button class="danger" data-id="${task.id}">删除</button>
                </div>
            `;

            // 添加选择状态指示器
            if (task.hasBeenSelected) {
                const indicator = document.createElement('div');
                indicator.className = 'task-selected-indicator';
                indicator.title = '该任务已被选择';
                taskItem.querySelector('.task-thumbnail').appendChild(indicator);
            }

            taskItemsContainer.appendChild(taskItem);

            // 点击任务项：跳转到对应区域
            taskItem.addEventListener('click', (e) => {
                if (e.target.tagName === 'BUTTON') return;

                // 更新选择状态
                document.querySelectorAll('.task-item').forEach(item => {
                    item.classList.remove('selected');
                });
                taskItem.classList.add('selected');

                // 计算任务区域中心点
                const centerX = (task.startX + task.endX) / 2;
                const centerY = (task.startY + task.endY) / 2;
                const taskWidth = task.endX - task.startX;
                const taskHeight = task.endY - task.startY;

                // 计算缩放比例
                const canvasWidth = imageCanvas.width;
                const canvasHeight = imageCanvas.height;
                const scaleX = (canvasWidth * 0.8) / taskWidth;
                const scaleY = (canvasHeight * 0.8) / taskHeight;
                const newScale = Math.min(scaleX, scaleY, 3);

                // 计算偏移量
                const displayInfo = pgmData.displayInfo;
                const containerScale = displayInfo.containerScale;

                // 计算任务中心点在当前画布上的位置
                const taskCenterX = displayInfo.x + centerX * containerScale * scale;
                const taskCenterY = displayInfo.y + centerY * containerScale * scale;

                // 计算目标中心点（画布中心）
                const targetCenterX = canvasWidth / 2;
                const targetCenterY = canvasHeight / 2;

                // 更新偏移量
                offsetX = offsetX + (targetCenterX - taskCenterX);
                offsetY = offsetY + (targetCenterY - taskCenterY);

                // 更新缩放比例
                scale = newScale;
                zoomDisplay.textContent = `${Math.round(scale * 100)}%`;

                // 重绘图像
                drawPGM();
            });

            // 删除按钮事件
            const deleteBtn = taskItem.querySelector('button');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                removeTask(task.id);
            });

            // 拖拽事件
            taskItem.addEventListener('dragstart', handleDragStart);
            taskItem.addEventListener('dragover', handleDragOver);
            taskItem.addEventListener('dragenter', handleDragEnter);
            taskItem.addEventListener('dragleave', handleDragLeave);
            taskItem.addEventListener('drop', handleDrop);
            taskItem.addEventListener('dragend', handleDragEnd);
        });

        // 更新任务高亮显示
        updateTaskHighlights();
    }

    /**
     * 拖拽开始事件处理
     */
    function handleDragStart(e) {
        draggedTask = this;
        dragStartIndex = parseInt(this.dataset.index);
        this.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.dataset.id);
    }

    /**
     * 拖拽结束事件处理
     */
    function handleDragEnd() {
        this.classList.remove('dragging');
        document.querySelectorAll('.insert-indicator').forEach(el => {
            el.classList.remove('visible');
        });
        draggedTask = null;
        dragStartIndex = -1;
    }

    /**
     * 拖拽经过事件处理
     */
    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }

    /**
     * 拖拽进入事件处理
     */
    function handleDragEnter(e) {
        e.preventDefault();
        this.parentNode.insertBefore(createInsertIndicator(), this);
        dragOverIndex = parseInt(this.dataset.index);
    }

    /**
     * 创建插入指示器
     */
    function createInsertIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'insert-indicator visible';
        return indicator;
    }

    /**
     * 拖拽离开事件处理
     */
    function handleDragLeave() {
        const indicator = this.previousSibling;
        if (indicator && indicator.classList.contains('insert-indicator')) {
            indicator.remove();
        }
    }

    /**
     * 放置事件处理
     */
    function handleDrop(e) {
        e.preventDefault();
        const indicator = this.previousSibling;
        if (indicator && indicator.classList.contains('insert-indicator')) {
            indicator.remove();
        }

        const taskId = e.dataTransfer.getData('text/plain');
        const targetIndex = parseInt(this.dataset.index);

        if (dragStartIndex !== targetIndex) {
            // 重新排序任务数组
            const movedTask = tasks[dragStartIndex];
            tasks.splice(dragStartIndex, 1);
            tasks.splice(targetIndex, 0, movedTask);

            // 保存历史
            saveHistory();

            // 重新渲染任务队列
            updateTaskQueue();

            showActionFeedback(20, 20, '任务顺序已更新');
        }
    }

    /**
     * 移除任务
     * @param {number} taskId - 任务ID
     */
    function removeTask(taskId) {
        tasks = tasks.filter(task => task.id !== taskId);
        // 从选择顺序中移除
        const index = taskSelectionOrder.indexOf(taskId);
        if (index !== -1) {
            taskSelectionOrder.splice(index, 1);
        }
        updateTaskQueue();
        saveHistory();
        showActionFeedback(20, 20, '任务已移除');
    }

    /**
     * 更新顺序预览
     */
    function updateSequencePreview() {
        if (taskSelectionOrder.length === 0) {
            sequencePreview.textContent = '未选择';
            return;
        }

        const previewText = taskSelectionOrder.map(id => {
            const task = tasks.find(t => t.id === id);
            return task?.number ? `#${task.number}` : '?';
        }).join(' → ');

        sequencePreview.textContent = previewText;
    }

    /**
     * 重新编号任务
     */
    function renumberTasks() {
        let counter = 1;
        // 按照选择顺序重新编号
        taskSelectionOrder.forEach(id => {
            const task = tasks.find(t => t.id === id);
            if (task) {
                task.number = counter++;
            }
        });

        // 更新顺序预览
        updateSequencePreview();
    }

    // 地图选择器逻辑
    let gridRevision = null;
    let loadedMapKey = null;
    const mapAuth = () => ({Authorization: localStorage.getItem('token') || ''});
    const mapSelector = document.getElementById('mapSelector');
    const reloadMapsBtn = document.getElementById('reloadMapsBtn');


   // 加载选中的地图
    async function loadSelectedMap(mapName) {
        try {
            statusMessage.style.display = 'block';
            statusMessage.textContent = `正在加载地图: ${mapName}...`;
            
            // 从后端获取PGM和YAML文件
            const before = await fetch('/api/map-workbench/assets', {headers:mapAuth()}).then(r=>r.json());
            const selectedAsset = before.data?.find(row=>row.id===mapName);
            const version = selectedAsset?.revision;
            setMapCoordinateFrame(selectedAsset);
            const responsepgm = await fetch(`/api/map-workbench/file/pgm/${encodeURIComponent(mapName)}`, {headers:mapAuth()});
            const responseyaml = await fetch(`/api/map-workbench/file/yaml/${encodeURIComponent(mapName)}`, {headers:mapAuth()});
    
            // 检查PGM文件响应
            if (!responsepgm.ok) {
                throw new Error(`PGM地图加载失败: ${responsepgm.status} ${responsepgm.statusText}`);
            }
            
            // 检查YAML文件响应
            if (!responseyaml.ok) {
                throw new Error(`YAML配置加载失败: ${responseyaml.status} ${responseyaml.statusText}`);
            }
            // 将PGM响应转换为Blob并创建文件对象
            const pgmBlob = await responsepgm.blob();
            const pgmFile = new File([pgmBlob], `${mapName}.pgm`, { type: 'image/x-portable-greymap' });
            // 将YAML响应转换为文本
            const yamlContent = await responseyaml.text();
         
            // 使用现有方法解析PGM文件
            const parsedData = await parsePGM(pgmFile);
            pgmData = parsedData;
            gridRevision = version; loadedMapKey = mapName;
            lastCutoutPGMData = null; lastCutoutImageData = null;
            resultContainer.replaceChildren();
            originalPgmData = {
                ...parsedData,
                imageData: new Uint8ClampedArray(parsedData.imageData)
            };
            // 重置状态
            resetAll();

            // 绘制图像
            drawPGM();
            draw();

            statusMessage.textContent = `地图 ${mapName} 加载成功！`;
            setTimeout(() => statusMessage.style.display = 'none', 2000);
        } catch (error) {
            statusMessage.style.display = 'block';
            statusMessage.textContent = `加载地图失败: ${error.message}`;
        }
    }

    // 重置所有状态的函数
    function resetAll() {
        points = [];
        isClosed = false;
        history = [];
        tasks = [];
        taskSelectionOrder = [];
        taskNumberCounter = 1;
        arrows = [];
        arrowStartPoint = null;
        isDrawingArrow = false;
        updateTaskQueue();

        // 重置缩放和偏移
        scale = 1.0;
        offsetX = 0;
        offsetY = 0;
        zoomDisplay.textContent = '100%';
        dragHint.style.display = 'none';
    }

    // 添加变量来跟踪当前父地图
    let currentParentMap = null;
    
    // 添加变量来跟踪当前选中的子文件
    let currentSelectedSubFile = null;

    // 地图选择器事件监听
    mapSelector.addEventListener('change', () => {
        const selectedMap = mapSelector.value;
      
        if (selectedMap) {
            // 设置当前父地图
            currentParentMap = selectedMap;
            // 清空当前选中的子文件（因为选择了主地图）
            currentSelectedSubFile = null;
            // 显示子文件
            document.getElementById('subFilesContainer').style.display='none';
            // 加载选中的地图
            loadSelectedMap(selectedMap);
        } else {
            // 隐藏子文件容器
            document.getElementById('subFilesContainer').style.display = 'none';
            currentParentMap = null;
            currentSelectedSubFile = null;
         
        }
    });
    // 刷新地图列表按钮事件 - 修改为实现回到父地图功能
    reloadMapsBtn.addEventListener('click', () => {
     
        
        if (currentParentMap) {
            // 如果有当前父地图，重新加载它
            loadSelectedMap(currentParentMap);
            document.getElementById('subFilesContainer').style.display='none';
        } else {
            loadMapList();
        }
    });

    // 刷新子文件列表按钮事件
    document.getElementById('refreshSubFilesBtn').addEventListener('click', () => {
        const selectedMap = mapSelector.value;
        if (selectedMap) {
            // 清空当前选中的子文件，因为刷新后选中状态会丢失
            currentSelectedSubFile = null;
            document.getElementById('subFilesContainer').style.display='none';
        }
    });

    // 此页面可能由主界面动态加载；脚本执行时 window.load 可能已经结束。
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadMapList, { once: true });
    } else {
        loadMapList();
    }

    // 文件上传处理
    pgmFileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            statusMessage.style.display = 'block';
            statusMessage.textContent = "正在解析PGM文件...";

            const parsedData = await parsePGM(file);
            pgmData = parsedData;
            originalPgmData = {
                ...parsedData,
                imageData: new Uint8ClampedArray(parsedData.imageData)
            };

            statusMessage.textContent = "PGM文件解析成功！";
            setTimeout(() => statusMessage.style.display = 'none', 2000);

            // 重置所有状态
            points = [];
            isClosed = false;
            history = [];
            tasks = [];
            taskSelectionOrder = [];
            taskNumberCounter = 1;
            arrows = [];
            arrowStartPoint = null;
            isDrawingArrow = false;
            updateTaskQueue();

            // 重置缩放和偏移
            scale = 1.0;
            offsetX = 0;
            offsetY = 0;
            zoomDisplay.textContent = '100%';
            dragHint.style.display = 'none';

            // 保存初始状态
            saveHistory();

            // 绘制图像
            drawPGM();
            draw();

            // 更新按钮状态
            updateButtonStates();
        } catch (error) {
            statusMessage.style.display = 'block';
            statusMessage.textContent = `错误: ${error}`;
        }
    });

    // 工具按钮事件
    document.getElementById('btnPen').addEventListener('click', () => {
        currentTool = 'pen';
        isDragMode = false;
        isTaskMode = false;
        isHandMode = false;
        arrowStartPoint = null;
        isDrawingArrow = false;
        drawCanvas.style.cursor = 'crosshair';
        updateButtonStates();
    });

    document.getElementById('btnBrush').addEventListener('click', () => {
        currentTool = 'brush';
        isDragMode = false;
        isTaskMode = false;
        isHandMode = false;
        arrowStartPoint = null;
        isDrawingArrow = false;
        drawCanvas.style.cursor = 'crosshair';
        updateButtonStates();
    });

    document.getElementById('btnArrow').addEventListener('click', () => {
        currentTool = 'arrow';
        isDragMode = false;
        isTaskMode = false;
        isHandMode = false;
        drawCanvas.style.cursor = 'crosshair';
        arrowStartPoint = null;
        isDrawingArrow = false;
        updateButtonStates();
    });

    document.getElementById('btnDrag').addEventListener('click', () => {
        isDragMode = !isDragMode;
        currentTool = isDragMode ? 'drag' : 'pen';
        isTaskMode = false;
        isHandMode = false;
        arrowStartPoint = null;
        isDrawingArrow = false;
        drawCanvas.style.cursor = isDragMode ? 'grab' : 'crosshair';
        dragHint.style.display = isDragMode ? 'block' : 'none';
        updateButtonStates();
    });

    document.getElementById('btnTask').addEventListener('click', () => {
        isTaskMode = !isTaskMode;
        currentTool = isTaskMode ? 'task' : 'pen';
        isDragMode = false;
        isHandMode = false;
        arrowStartPoint = null;
        isDrawingArrow = false;
        drawCanvas.style.cursor = 'crosshair';
        updateButtonStates();
    });

    document.getElementById('btnHand').addEventListener('click', () => {
        isHandMode = !isHandMode;
        currentTool = isHandMode ? 'hand' : 'pen';
        isDragMode = false;
        isTaskMode = false;
        arrowStartPoint = null;
        isDrawingArrow = false;
        drawCanvas.style.cursor = isHandMode ? 'pointer' : 'crosshair';
        updateButtonStates();

        // 重置任务选择顺序
        if (isHandMode) {
            taskSelectionOrder = [];
            updateSequencePreview();
        }
    });

    // 功能按钮事件
    document.getElementById('btnUndo').addEventListener('click', undo);
    document.getElementById('btnClear').addEventListener('click', clearAll);
    document.getElementById('btnCut').addEventListener('click', generateCutout);
    document.getElementById('btnDownPGM').addEventListener('click', downloadPGM);

    // 垂直平分线工具按钮事件
    document.getElementById('btnPerpendicular').addEventListener('click', () => {
        currentTool = 'perpendicular';
        isDragMode = false;
        isTaskMode = false;
        isHandMode = false;
        arrowStartPoint = null;
        isDrawingArrow = false;
        perpendicularPoints = [];
        drawCanvas.style.cursor = 'crosshair';
        updateButtonStates();
    });
    
    // 顶部地图房间按钮事件 - 改为下拉展开/收起
    document.getElementById('topMapRoomBtn').addEventListener('click', () => {
        const dropdown = document.getElementById('mapRoomDropdown');
        const iframe = document.getElementById('mapRoomFrame');
        const topBtn = document.getElementById('topMapRoomBtn');
        
        if (!dropdown.classList.contains('show')) {
            // 展开下拉区域 - 先设置display再添加类以触发动画
            dropdown.style.display = 'block';
            // 强制重排以确保动画从正确状态开始
            dropdown.offsetHeight;
            dropdown.classList.add('show');
            topBtn.classList.add('expanded');
            // 重新加载iframe内容，确保每次打开都是新的实例
            if (iframe) {
                iframe.src = '../../components/pcd-loader/PCDLoader.html';
            }
        } else {
            // 收起下拉区域
            dropdown.classList.remove('show');
            topBtn.classList.remove('expanded');
            // 清除iframe内容，防止重复加载GUI
            if (iframe) {
                iframe.src = '';
            }
            // 动画结束后隐藏元素
            setTimeout(() => {
                dropdown.style.display = 'none';
            }, 400);
        }
    });
    
    // 下拉区域收起按钮事件
    document.querySelector('.close-dropdown').addEventListener('click', () => {
        const dropdown = document.getElementById('mapRoomDropdown');
        const iframe = document.getElementById('mapRoomFrame');
        const topBtn = document.getElementById('topMapRoomBtn');
        
        dropdown.classList.remove('show');
        topBtn.classList.remove('expanded');
        // 清除iframe内容，防止重复加载GUI
        if (iframe) {
            iframe.src = '';
        }
        // 动画结束后隐藏元素
        setTimeout(() => {
            dropdown.style.display = 'none';
        }, 400);
    });
    
    // 点击下拉区域外部收起（可选功能）
    document.addEventListener('click', (event) => {
        const dropdown = document.getElementById('mapRoomDropdown');
        const topBtn = document.getElementById('topMapRoomBtn');
        
        // 如果下拉区域是展开的，且点击的不是下拉区域本身也不是顶部按钮
        if (dropdown.classList.contains('show') && 
            !dropdown.contains(event.target) && 
            event.target !== topBtn && 
            !topBtn.contains(event.target)) {
            
            dropdown.classList.remove('show');
            topBtn.classList.remove('expanded');
            const iframe = document.getElementById('mapRoomFrame');
            if (iframe) {
                iframe.src = '';
            }
            // 动画结束后隐藏元素
            setTimeout(() => {
                dropdown.style.display = 'none';
            }, 400);
        }
    });

    // 画笔大小控制
    document.getElementById('brushSize').addEventListener('input', (e) => {
        brushSize = parseInt(e.target.value);
        document.getElementById('brushSizeValue').textContent = `${brushSize}px`;
    });

    // 颜色按钮事件
    document.querySelectorAll('.color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            brushColor = btn.dataset.color;
        });
    });



    // 缩放控制
    document.getElementById('btnZoomIn').addEventListener('click', () => {
        scale = Math.min(scale + 0.1, 3.0);
        zoomDisplay.textContent = `${Math.round(scale * 100)}%`;
        drawPGM();
        draw();
    });

    document.getElementById('btnZoomOut').addEventListener('click', () => {
        scale = Math.max(scale - 0.1, 0.5);
        zoomDisplay.textContent = `${Math.round(scale * 100)}%`;
        drawPGM();
        draw();
    });
    document.getElementById('btnResetZoom').addEventListener('click', () => {
        scale = 1.0;
        zoomDisplay.textContent = '100%';
        drawPGM();
        draw();
    });
    // 地图选择器事件监听 - 点击时加载地图列表
    mapSelector.addEventListener('click', () => {
        // 检查是否已加载过地图列表
        if (mapSelector.options.length > 1) return;

        loadMapList();
    });

    // 显示子文件列表
    function displaySubFiles(selectedPath) {
        const subFilesContainer = document.getElementById('subFilesContainer');
        const subFilesList = document.getElementById('subFilesList');
        
        // 使用新的 API 获取地图列表
        fetch('/pgm/list')
            .then(response => {
                if (!response.ok) throw new Error('网络响应异常');
                return response.json();
            })
            .then(data => {
                if (data.code !== 0) throw new Error(data.message || '获取地图列表失败');
                
                // 查找选中的目录
                const selectedItem = data.data.find(item => item.path === selectedPath);
                displaySubFilesFromData(selectedItem, subFilesContainer, subFilesList);
            })
            .catch(error => {
                console.error('获取子文件失败:', error);
                // 使用本地模拟数据
                const localData = {
                    clean4: { path: 'clean4', name: 'clean4', children: [{name: '333', path: '333'}, {name: '444', path: '444'}] }
                };
                const selectedItem = localData[selectedPath];
                displaySubFilesFromData(selectedItem, subFilesContainer, subFilesList);
            });
    }
    
    // 从数据对象显示子文件的辅助函数
    function displaySubFilesFromData(selectedItem, subFilesContainer, subFilesList) {
        if (selectedItem && selectedItem.children && selectedItem.children.length > 0) {
            // 清空子文件列表
            subFilesList.innerHTML = '';
            
            // 添加子文件项
            selectedItem.children.forEach(child => {
                const fileItem = document.createElement('div');
                fileItem.className = 'sub-file-item';
                fileItem.dataset.path = child.path;
                
                // 判断是目录还是文件
                const isDirectory = child.children && child.children.length > 0;
                const icon = isDirectory ? '📁' : '📄';
                
                fileItem.innerHTML = `
                    <div>
                        <span class="sub-file-icon">${icon}</span>
                        <span>${child.name}</span>
                    </div>
                    <span class="sub-file-path">${child.path}</span>
                `;
                
                // 添加点击事件
                fileItem.addEventListener('click', () => {
                    // 移除其他项的选中状态
                    document.querySelectorAll('.sub-file-item').forEach(item => {
                        item.classList.remove('selected');
                    });
                    
                    // 添加当前项的选中状态
                    fileItem.classList.add('selected');
                    
                    // 设置当前选中的子文件
                    currentSelectedSubFile = child;
                    
                    // 加载子文件 - 使用子项的名称而不是完整路径
                    // 注意：保持currentParentMap不变，这样刷新时还能回到父地图
                    loadSelectedMap(child.name);
                });
                
                subFilesList.appendChild(fileItem);
            });
            
            // 显示子文件容器
            subFilesContainer.style.display = 'block';
        } else {
            // 隐藏子文件容器
            subFilesContainer.style.display = 'none';
        }
    }

    // 加载地图列表函数
    async function loadMapList() {
        try {
            const selected = mapSelector.value || new URLSearchParams(location.search).get('map');
            const response = await fetch('/api/map-workbench/assets', {headers:mapAuth(),cache:'no-store'});
            const body = await response.json();
            if (!response.ok || body.code !== 0) throw new Error(body.message || '地图列表读取失败');
            const rows = body.data.filter(row=>row.grid);
            mapSelector.replaceChildren(new Option('请选择地图',''), ...rows.map(row=>new Option(row.id,row.id)));
            document.getElementById('subFilesContainer').style.display='none';
            if (rows.some(row=>row.id===selected)) {
                mapSelector.value=selected;
                if (loadedMapKey !== selected) mapSelector.dispatchEvent(new Event('change'));
            }
            statusMessage.textContent=`已加载 ${rows.length} 个地图`;
        } catch(error) {
            statusMessage.style.display='block';
            statusMessage.textContent=`加载地图列表失败: ${error.message}`;
        }
    }


    const deleteMapBtn = document.getElementById('deleteMapBtn');

    // 删除选中的地图
    async function deleteSelectedMap() {
        const selectedMap = mapSelector.value;
        if (!selectedMap) {
            alert('请先选择要删除的地图');
            return;
        }

        if (!confirm(`确定要删除地图 "${selectedMap}" 吗？此操作不可恢复！`)) {
            return;
        }

        try {
            statusMessage.style.display = 'block';
            statusMessage.textContent = "正在删除地图...";

            const response = await fetch(`/files/delete?fileName=${encodeURIComponent(selectedMap)}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error(`删除失败: ${response.status} ${response.statusText}`);
            }

            const result = await response.text();
            statusMessage.textContent = result;

            // 重新加载地图列表
            await loadMapList();

            // 重置UI状态
            resetAll();
            resultContainer.innerHTML = '<p class="result-placeholder">上传PGM文件并编辑后点击"生成抠图"按钮</p>';

        } catch (error) {
            statusMessage.style.display = 'block';
            statusMessage.textContent = `删除失败: ${error.message}`;
            console.error("删除错误:", error);
        }
    }

    // 绑定删除按钮事件
    deleteMapBtn.addEventListener('click', deleteSelectedMap);

    /**
     * 弹出对话框让用户输入地图名称，然后保存PGM
     */


    function saveAsNewMap() {
        generateCutout();
        if (!lastCutoutPGMData) {
            statusMessage.style.display = 'block';
            statusMessage.textContent = "没有可保存的结果";
            return;
        }

        // 获取当前选中的地图名称
        const currentMapName = mapSelector.value;
        if (!currentMapName) {
            statusMessage.style.display = 'block';
            statusMessage.textContent = "请先选择一个地图";
            return;
        }

        // 获取所有地图名称
        const mapNames = Array.from(mapSelector.options).map(opt => opt.value);

        // 提取基础名称（移除任何现有的副本后缀）
        const baseName = currentMapName.replace(/-副本\d*$/, '');

        // 找出所有以基础名称开头的副本
        const copyRegex = new RegExp('^' + baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-副本(\\d+)$');
        const simpleCopyRegex = new RegExp('^' + baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-副本$');

        let maxCopyNumber = 0;
        mapNames.forEach(name => {
            // 检查带编号的副本
            const match = name.match(copyRegex);
            if (match) {
                const copyNum = parseInt(match[1]);
                if (copyNum > maxCopyNumber) {
                    maxCopyNumber = copyNum;
                }
            }
            // 检查不带编号的副本
            else if (simpleCopyRegex.test(name)) {
                if (maxCopyNumber === 0) {
                    maxCopyNumber = 1; // 将不带编号的副本视为副本1
                }
            }
        });

        // 计算下一个副本编号
        const nextCopyNumber = maxCopyNumber + 1;
        const defaultNewName = baseName + '-副本' + nextCopyNumber;


        // 弹出输入框，默认显示计算出的副本名称
        const newMapName = prompt("请输入新地图的名称:", defaultNewName);

        if (!newMapName) {
            // 用户取消了输入
            return;
        }

        if (!newMapName.trim()) {
            statusMessage.style.display = 'block';
            statusMessage.textContent = "地图名称不能为空";
            return;
        }
        // 其余保存逻辑保持不变...
        statusMessage.style.display = 'block';
        statusMessage.textContent = "正在保存PGM文件...";

        // 创建PGM文件内容
        const { width, height, maxValue, imageData } = lastCutoutPGMData;
        let pgmContent = `P5\n${width} ${height}\n${maxValue}\n`;

        // 合并文件头和图像数据
        const encoder = new TextEncoder();
        const header = encoder.encode(pgmContent);
        const pgmBytes = new Uint8Array(header.length + imageData.length);
        pgmBytes.set(header);
        pgmBytes.set(imageData, header.length);

        // 创建PGM Blob对象
        const pgmBlob = new Blob([pgmBytes], {
            type: 'image/x-portable-greymap'
        });

        // 获取当前地图的YAML文件内容
        fetch(`/api/map-workbench/file/yaml/${encodeURIComponent(currentMapName)}`, {headers:mapAuth()})
            .then(response => {
                if (!response.ok) {
                    throw new Error(`YAML配置加载失败: ${response.status} ${response.statusText}`);
                }
                return response.text();
            })
            .then(yamlContent => {
                // 创建YAML Blob对象
                const yamlBlob = new Blob([yamlContent], { type: 'text/yaml' });

                // 构建FormData用于新的/pgm/save-as接口
                const formData = new FormData();
                
                // 添加parentPath参数（当前选中的地图路径）
                formData.append('create_only', 'true');
                
                // 添加newName参数（用户输入的新地图名称）
                formData.append('asset_id', newMapName);
                
                // 创建File对象确保包含文件名
                const pgmFile = new File([pgmBlob], "map.pgm", {
                    type: 'image/x-portable-greymap',
                    lastModified: Date.now()
                });
                
                const yamlFile = new File([yamlBlob], "map.yaml", {
                    type: 'text/yaml',
                    lastModified: Date.now()
                });
                
                // 添加File对象
                formData.append('pgm', pgmFile);
                formData.append('metadata', yamlFile);
                // 使用XMLHttpRequest发送multipart/form-data请求
                const xhr = new XMLHttpRequest();
                // 设置请求完成和错误处理
                xhr.onload = function() {
                    let result;
                    try { result = JSON.parse(xhr.responseText); } catch { result = {}; }
                    if (xhr.status >= 200 && xhr.status < 300 && result.code === 0) {
                        if (result.data.id === loadedMapKey) gridRevision = result.data.revision;
                        parent.postMessage({type:'map-saved',id:result.data.id}, location.origin);
                        statusMessage.textContent = "地图保存成功！";
                        setTimeout(() => statusMessage.style.display = 'none', 3000);
                        // 刷新地图列表以包含新保存的地图
                        loadMapList();
                    } else {
                        console.error("保存失败:", xhr.status, xhr.responseText);
                        statusMessage.textContent = `保存失败: ${result.message || result.detail || xhr.status}`;
                    }
                };
                
                xhr.onerror = function() {
                    console.error("保存失败: 网络错误");
                    statusMessage.textContent = "保存失败: 网络错误";
                };
                
                // 打开POST请求到/pgm/save-as端点
                xhr.open('POST', '/api/map-workbench/grid', true);
                xhr.setRequestHeader('Authorization', localStorage.getItem('token') || '');
                
                // 发送FormData - 浏览器会自动设置正确的Content-Type和边界
                xhr.send(formData);
            })
            .catch(error => {
                console.error("保存失败:", error);
                statusMessage.textContent = `保存失败: ${error.message}`;
            });
    }

    // 修改按钮事件绑定
    document.getElementById('btnDownPNG').addEventListener('click', saveAsNewMap);
    
    // 录制地图功能
    let isRecording = false; // 已进入可录制状态
    let recordingBusy = false; // 防止启动/保存期间重复提交
    let recordingInterval = null; // 录制定时器
   
    // 录制地图按钮事件
    const recordMapBtn = document.getElementById('recordMap');
    function checkRecordingStatus() {
        // 页面重新加载后不能根据旧缓存误判ROS建图状态
        isRecording = false;
        localStorage.removeItem('isRecording');
        renderRecordingButton();
    }

    function renderRecordingButton() {
        recordMapBtn.disabled = recordingBusy;
        recordMapBtn.classList.toggle('recording', isRecording);
        if (recordingBusy) {
            recordMapBtn.innerHTML = '正在处理...';
        } else {
            recordMapBtn.innerHTML = isRecording ? '结束录制' : '录制3D地图';
        }
    }

    checkRecordingStatus();
    recordMapBtn.addEventListener('click', async function() {
        if (recordingBusy) return;
        if (isRecording) {
            await stopRecording();
        } else {
            await startRecording();
        }
    });
    
    // 开始录制函数
    async function startRecording() {
        recordingBusy = true;
        isRecording = false;
        localStorage.removeItem('isRecording');
        renderRecordingButton();
        statusMessage.style.display = 'block';
        statusMessage.textContent = '正在启动建图并等待点云就绪，请稍候...';

        try {
            const response = await axiosClient.post('ros2/run_mapping');
            if (response.data.code === 0) {
                isRecording = true;
                localStorage.setItem('isRecording', 'true');
                statusMessage.textContent = '点云已就绪，可以移动机器人录制地图。';
            } else {
                const reason = response.data.description || response.data.message || '建图未就绪';
                statusMessage.textContent = `开始录制失败：${reason}`;
            }
        } catch (error) {
            console.error('启动建图失败:', error);
            statusMessage.textContent = '开始录制失败：无法连接业务系统';
        } finally {
            recordingBusy = false;
            renderRecordingButton();
        }
    }
    
    // 结束录制函数
    async function stopRecording() {
        if (!isRecording || recordingBusy) return;

        recordingBusy = true;
        isRecording = false;
        localStorage.removeItem('isRecording');
        renderRecordingButton();

        if (recordingInterval) {
            clearInterval(recordingInterval);
            recordingInterval = null;
        }

        statusMessage.style.display = 'block';

        try {
            const mapName = prompt('请输入地图名称：', '');
            if (!mapName || !mapName.trim()) {
                await axiosClient.post('ros2/save_mapping/stopbuildmap');
                statusMessage.textContent = '录制已取消！';
                return;
            }

            statusMessage.textContent = `正在保存地图 ${mapName.trim()}，请等待文件落盘...`;
            const response = await axiosClient.post(`ros2/save_mapping/${encodeURIComponent(mapName.trim())}`);
            if (response.data.code === 0) {
                statusMessage.textContent = `地图 ${mapName.trim()} 保存成功！`;
                saveRecordingData(mapName.trim());
                refreshPcdPreview();
            } else {
                const reason = response.data.description || response.data.message || '保存失败';
                statusMessage.textContent = `结束录制失败：${reason}`;
            }
        } catch (error) {
            console.error('保存地图失败:', error);
            statusMessage.textContent = '结束录制失败：无法连接业务系统';
        } finally {
            recordingBusy = false;
            renderRecordingButton();
        }
    }
    
    // 保存录制数据函数
    function saveRecordingData(mapName) {
        // 模拟保存录制数据
        const recordingData = {
            timestamp: new Date().toISOString(),
            duration: '录制时长', // 可以计算实际录制时长
            mapName: mapName || document.getElementById('mapSelector').value || '未知地图',
            // 这里可以添加更多录制相关的数据
        };
    }

    function refreshPcdPreview() {
        const iframe = document.getElementById('mapRoomFrame');
        if (!iframe || !iframe.src || iframe.src === 'about:blank') return;
        const separator = iframe.src.includes('?') ? '&' : '?';
        iframe.src = `${iframe.src}${separator}refresh=${Date.now()}`;
    }
    
    // 键盘快捷键支持
    document.addEventListener('keydown', function(event) {
        // 按 R 键切换录制状态
        if (event.key === 'r' || event.key === 'R') {
            // 确保不是在输入框中按下
            if (event.target.tagName !== 'INPUT' && event.target.tagName !== 'TEXTAREA') {
                event.preventDefault();
                recordMapBtn.click();
            }
        }
    });
    
