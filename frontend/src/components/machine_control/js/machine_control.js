import RosManager from "../../../rosManage/RosManager.js";
import webSocketUtil from "../../../tools/webSocketUtil.js";
const rosManager = new RosManager();
const currentHostname = window.location.hostname;
let wsUrl;
// 根据不同的hostname采用不同的WebSocket连接策略
if (currentHostname.includes('127.0.0.1') || currentHostname.includes('localhost') || currentHostname.includes('192.168.')) {
    wsUrl = `ws://${currentHostname}:8088/ws/control`;
} else {
     const rosbridgeHostname = window.location.hostname;
    wsUrl = `ws://${rosbridgeHostname}/ws/control`;
}

webSocketUtil.destroyInstance(wsUrl);
let websocket = webSocketUtil.getInstance(wsUrl);
window.addEventListener('beforeunload', () => {
    console.log("页面即将卸载");
});
function sendCtrlModeMsg() {
    // 检查WebSocket连接状态
    if (!websocket || !websocket.websocket || websocket.websocket.readyState !== WebSocket.OPEN) {
        console.warn('[WebSocket] 连接未打开，无法发送控制模式消息');
        return;
    }
    
    const originData = {
        action: "RemoteCtrlAutomaticSwitch",
        points: 0
    };
    const finalData = JSON.stringify(originData);
    websocket.send(finalData);
}

// 订阅连接打开事件
websocket.subscribe('open', () => {
    sendCtrlModeMsg();
    // 开始定时发送数据
    if (positionTimer) {
        clearInterval(positionTimer);
    }
    positionTimer = setInterval(() => {
        // 检查连接状态后再发送数据
        if (websocket.websocket?.readyState === WebSocket.OPEN) {
            sendData();
        }
    }, 50); // 每50毫秒发送一次数据，可根据需求调整
});

// 关闭浏览器默认缩放行为
document.documentElement.style.touchAction = 'none';
document.documentElement.style.msTouchAction = 'none';
// 监听窗口大小变化并调整图表大小
window.addEventListener('resize', function () {
    // 调整右侧图表大小
    mychart_right.resize();
    // 调整左侧图表大小
    mychart_left.resize();
});

// 初始化 ECharts 图表和设置其他配置...
// circleDrag.js
function setupCircle(canvasId, onMoveCallback, id) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    const radiusLarge = 100;
    const radiusSmall = 50;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const maxDistance = 100; // 小圆中心点到大圆中心点的最大允许距离
    let isDragging = false;
    let offsetX = centerX - radiusSmall;
    let offsetY = centerY - radiusSmall;
    let touchId = null;

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 绘制大圆
        const largeCircleGradient = ctx.createRadialGradient(
            centerX, centerY, 0,
            centerX, centerY, radiusLarge
        );
        largeCircleGradient.addColorStop(0, 'rgb(4, 8, 44)');
        largeCircleGradient.addColorStop(1, 'rgb(10, 22, 155)');
        ctx.fillStyle = largeCircleGradient;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radiusLarge, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 绘制小圆
        const smallCircleGradient = ctx.createRadialGradient(
            offsetX + radiusSmall, offsetY + radiusSmall, 0,
            offsetX + radiusSmall, offsetY + radiusSmall, radiusSmall
        );
        smallCircleGradient.addColorStop(0, 'rgba(32, 138, 191, 1)');
        smallCircleGradient.addColorStop(1, 'rgba(32, 138, 191, 0.3)');
        ctx.fillStyle = smallCircleGradient;
        ctx.beginPath();
        ctx.arc(offsetX + radiusSmall, offsetY + radiusSmall, radiusSmall, 0, Math.PI * 2);
        ctx.fill();
    }

    function getTouchCoordinates(e, rect, touchId) {
        if (e.touches) {
            for (let i = 0; i < e.touches.length; i++) {
                const touch = e.touches[i];
                if (touch.identifier === touchId) {
                    return {
                        x: touch.clientX - rect.left,
                        y: touch.clientY - rect.top
                    };
                }
            }
        } else {
            return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
        }
        return null;
    }

    function handleStart(e) {
        e.preventDefault(); // 阻止浏览器默认行为
        const rect = canvas.getBoundingClientRect();
        if (e.touches) {
            for (let i = 0; i < e.touches.length; i++) {
                const touch = e.touches[i];
                const { x, y } = getTouchCoordinates(e, rect, touch.identifier);
                const dx = x - (offsetX + radiusSmall);
                const dy = y - (offsetY + radiusSmall);

                if (Math.sqrt(dx * dx + dy * dy) < radiusSmall) {
                    isDragging = true;
                    touchId = touch.identifier;
                    break;
                }
            }
        } else {
            const { x, y } = getTouchCoordinates(e, rect, null);
            const dx = x - (offsetX + radiusSmall);
            const dy = y - (offsetY + radiusSmall);

            if (Math.sqrt(dx * dx + dy * dy) < radiusSmall) {
                isDragging = true;
            }
        }
    }

    function handleMove(e) {
        e.preventDefault(); // 阻止浏览器默认行为
        if (!isDragging) return;
        const rect = canvas.getBoundingClientRect();
        const { x, y } = getTouchCoordinates(e, rect, touchId);

        if (x !== undefined && y !== undefined) {
            const distX = x - centerX;
            const distY = y - centerY;
            const distance = Math.sqrt(distX * distX + distY * distY);

            if (distance < maxDistance) { // 使用 maxDistance 控制最大移动范围
                offsetX = x - radiusSmall;
                offsetY = y - radiusSmall;
            } else {
                const ratio = maxDistance / distance;
                offsetX = centerX + distX * ratio - radiusSmall;
                offsetY = centerY + distY * ratio - radiusSmall;
            }
            draw();
            const relX = parseFloat(((offsetX + radiusSmall) - centerX).toFixed(2));
            const relY = parseFloat(((offsetY + radiusSmall) - centerY).toFixed(2));
            onMoveCallback(relX, relY, id);
        }
    }

    function handleEnd(e) {
        e.preventDefault(); // 阻止浏览器默认行为
        isDragging = false;
        touchId = null;
        offsetX = centerX - radiusSmall;
        offsetY = centerY - radiusSmall;
        draw();
        // 开始回零缓冲发布
        startReturnToZero(id);
    }

    canvas.addEventListener('mousedown', handleStart);
    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('mouseup', handleEnd);
    canvas.addEventListener('touchstart', handleStart);
    canvas.addEventListener('touchmove', handleMove);
    canvas.addEventListener('touchend', handleEnd);
    canvas.addEventListener('touchcancel', handleEnd);
    draw();
}
// 初始化左边圆圈
let leftX = 0, leftY = 0;
setupCircle('circleCanvasLeft', (x, y, id) => {
    if (id === 'left') {
        // 如果正在缓冲回零，先打断缓冲过程
        if (isReturningToZeroLeft) {
            isReturningToZeroLeft = false;
        }
        
        // 更新位置
        leftX = x;
        leftY = y;
        // 计算左侧控制百分比：触摸点距离百分比 × 进度条限制百分比
        const distancePercentage = calculateDistancePercentage(x, y);
        const throttlePercentage = window.globalPercentage2 || 20; // 使用当前进度条值，默认20%
        window.globalPercentage2_for_calculation = distancePercentage * (throttlePercentage / 100);
        // document.getElementById('coordinates').innerText = `左圆圈位置: (${x.toFixed(2)}, ${(-y).toFixed(2)})`;

    }
    
    // 检查位置是否变化，如果变化则立即发布
    if (checkPositionChanged()) {
        publishPosition();
    }
    
}, 'left');

// 初始化右边圆圈
let rightX = 0, rightY = 0;
setupCircle('circleCanvasRight', (x, y, id) => {
    if (id === 'right') {
        // 如果正在缓冲回零，先打断缓冲过程
        if (isReturningToZeroRight) {
            isReturningToZeroRight = false;
        }
        
        // 更新位置
        rightX = x;
        rightY = y;
        // 计算右侧控制百分比：触摸点距离百分比 × 进度条限制百分比
        const distancePercentage = calculateDistancePercentage(x, y);
        const throttlePercentage = window.globalPercentage1 || 20; // 使用当前进度条值，默认20%
        window.globalPercentage1_for_calculation = distancePercentage * (throttlePercentage / 100);
        // document.getElementById('coordinates2').innerText = `右圆圈位置: (${x.toFixed(2)}, ${(-y).toFixed(2)})`;
        

    }
    
    // 检查位置是否变化，如果变化则立即发布
    if (checkPositionChanged()) {
        publishPosition();
    }
}, 'right');

// 定义 MOVEMENT_THRESHOLD 变量
const MOVEMENT_THRESHOLD = 0.01;

const ZERO_THRESHOLD = 4; // 坐标视为0的阈值（避免浮点精度问题）
const NORMAL_THROTTLE_DELAY = 200; // 非0状态节流间隔（ms）
const ZERO_INTERVAL = 100; // 0状态连续发送间隔（ms）

// 定义全局百分比变量 - 使用window对象，以便与progress-bar.js共享
// let globalPercentage1 = 0; // 右侧控制百分比
// let globalPercentage2 = 0; // 左侧控制百分比
// 注释掉局部变量定义，使用progress-bar.js中定义的window.globalPercentage1和window.globalPercentage2

// 添加位置跟踪和定时发布变量
let lastLeftX = 0, lastLeftY = 0, lastRightX = 0, lastRightY = 0;
let positionChanged = false;
let positionTimer = null;
const POSITION_CHECK_INTERVAL = 300; // 300ms检查间隔

// 添加回零缓冲变量
let isReturningToZeroLeft = false;
let isReturningToZeroRight = false;
let returnStartTimeLeft = 0;
let returnStartTimeRight = 0;
let returnStartLeftX = 0, returnStartLeftY = 0;
let returnStartRightX = 0, returnStartRightY = 0;
const RETURN_DURATION = 1500; // 1.5秒回零时间

// 发送数据的函数
function sendData() {
    // 检查WebSocket连接状态
    if (!websocket || !websocket.websocket || websocket.websocket.readyState !== WebSocket.OPEN) {
        console.warn('[WebSocket] 连接未打开，无法发送控制数据');
        return;
    }
    
    // 确保使用最新的全局百分比值（已包含进度条节流）
    const percentage1 = window.globalPercentage1_for_calculation || 0;
    const percentage2 = window.globalPercentage2_for_calculation || 0;
    
    const originData = {
        action: "WebRemoteCtrlData",
        remote: {
            CTR_X1: parseFloat((rightX * (percentage1 / 10000)).toFixed(4)),
            CTR_Y1: parseFloat((-rightY * (percentage1 / 10000)).toFixed(4)),
            CTR_X2: parseFloat((leftX * (percentage2 / 10000)).toFixed(4)),
            CTR_Y2: parseFloat((-leftY * (percentage2 / 10000)).toFixed(4)),
        }
    };
    

    websocket.send(JSON.stringify(originData));
}
// 检查位置是否发生变化
function checkPositionChanged() {
    // 确保使用最新的全局百分比值（已包含进度条节流）
    const percentage1 = window.globalPercentage1_for_calculation || 0;
    const percentage2 = window.globalPercentage2_for_calculation || 0;
    
    const currentLeftX = parseFloat((leftX * (percentage2 / 100)).toFixed(2));
    const currentLeftY = parseFloat((-leftY * (percentage2 / 100)).toFixed(2));
    const currentRightX = parseFloat((rightX * (percentage1 / 100)).toFixed(2));
    const currentRightY = parseFloat((-rightY * (percentage1 / 100)).toFixed(2));
    
    if (currentLeftX !== lastLeftX || currentLeftY !== lastLeftY || 
        currentRightX !== lastRightX || currentRightY !== lastRightY) {
        lastLeftX = currentLeftX;
        lastLeftY = currentLeftY;
        lastRightX = currentRightX;
        lastRightY = currentRightY;
        return true;
    }
    return false;
}

// 检查是否在原点（考虑阈值）
function isAtOrigin() {
    const leftDistance = Math.sqrt(leftX * leftX + leftY * leftY);
    const rightDistance = Math.sqrt(rightX * rightX + rightY * rightY);
    return leftDistance < 1 && rightDistance < 1; // 使用1作为原点阈值
}

// 定时检查并发布位置
function startPositionTimer() {
    if (positionTimer) {
        clearInterval(positionTimer);
    }
    
    positionTimer = setInterval(() => {
        // 如果不在原点，则发布位置
        if (!isAtOrigin()) {
            publishPosition();
        }
    }, POSITION_CHECK_INTERVAL);
}

// 开始回零缓冲发布
function startReturnToZero(circleId) {
    if (circleId === 'left') {
        // 左侧按钮立即归零，不缓冲
        if (isReturningToZeroLeft) {
            isReturningToZeroLeft = false;
        }
        
        // 直接归零
        leftX = 0;
        leftY = 0;
        window.globalPercentage2 = 0;
        
        // 立即发布位置
        publishPosition();
    } else if (circleId === 'right') {
        if (isReturningToZeroRight) return;
        
        isReturningToZeroRight = true;
        returnStartTimeRight = Date.now();
        
        // 记录右侧当前位置作为起始点
        returnStartRightX = rightX;
        returnStartRightY = rightY;
        
        animateReturnToZeroRight();
    }
}

// 缓冲回零发布（左侧滚轮）
function animateReturnToZeroLeft() {
    const currentTime = Date.now();
    const elapsed = currentTime - returnStartTimeLeft;
    const progress = Math.min(elapsed / RETURN_DURATION, 1);
    
    // 匀减速：线性变化，速度恒定减小
    // position = position₀ * (1 - progress)
    // 这相当于 v = v₀ + at，其中 a = -v₀ / RETURN_DURATION
    
    // 更新左侧圆圈位置（用于发布，不影响界面显示）
    leftX = 0;  // X轴直接归零，不缓冲
    leftY = returnStartLeftY * (1 - progress);  // Y轴缓冲归零
    
    // 更新左侧全局百分比
    window.globalPercentage2 = calculateDistancePercentage(leftX, leftY);
    
    // 发布当前缓冲位置
    publishPosition();
    
    if (progress < 1) {
        // 继续缓冲
        requestAnimationFrame(animateReturnToZeroLeft);
    } else {
        // 缓冲结束，确保位置为0
        isReturningToZeroLeft = false;
        leftX = 0;  // X轴直接归零
        leftY = 0;  // Y轴缓冲归零
        window.globalPercentage2 = 0;
        
        // 发布最终位置
        publishPosition();
    }
}

// 缓冲回零发布（右侧滚轮）
function animateReturnToZeroRight() {
    const currentTime = Date.now();
    const elapsed = currentTime - returnStartTimeRight;
    const progress = Math.min(elapsed / RETURN_DURATION, 1);
    
    // 匀减速：线性变化，速度恒定减小
    // position = position₀ * (1 - progress)
    // 这相当于 v = v₀ + at，其中 a = -v₀ / RETURN_DURATION
    
    // 更新右侧圆圈位置（用于发布，不影响界面显示）
    rightX = 0;  // X轴直接归零，不缓冲
    rightY = returnStartRightY * (1 - progress);  // Y轴缓冲归零
    
    // 更新右侧全局百分比
    window.globalPercentage1 = calculateDistancePercentage(rightX, rightY);
    
    // 发布当前缓冲位置
    publishPosition();
    
    if (progress < 1) {
        // 继续缓冲
        requestAnimationFrame(animateReturnToZeroRight);
    } else {
        // 缓冲结束，确保位置为0
        isReturningToZeroRight = false;
        rightX = 0;  // X轴直接归零
        rightY = 0;  // Y轴缓冲归零
        window.globalPercentage1 = 0;
        
        // 发布最终位置
        publishPosition();
    }
}

// 发布位置信息到ROS话题
function publishPosition() {
    // 确保使用最新的全局百分比值（已包含进度条节流）
    const percentage1 = window.globalPercentage1_for_calculation || 0;
    const percentage2 = window.globalPercentage2_for_calculation || 0;
    
    const data = [
        parseFloat((rightX * (percentage1 / 100)).toFixed(2)), 
        parseFloat((-rightY * (percentage1 / 100)).toFixed(2)), 
        parseFloat((leftX * (percentage2 / 100)).toFixed(2)), 
        parseFloat((-leftY * (percentage2 / 100)).toFixed(2))
    ].map(Number);
    
    const message = new ROSLIB.Message({
        layout: {
            dim: [
                { label: '', size: 4, stride: 4 }  // 假设我们只有一个维度，大小为4
            ],
            data_offset: 0
        },
        data: data
    });
    

    
    rosManager.publishContorlTopic("WebRemoteCtrlData", message);
    
    // 重置位置变化标志
    positionChanged = false;
}

// 初始化 ECharts 图表
const mychart_right = echarts.init(document.getElementById('main-right'));
// 计算距离圆心的距离并转换为百分比
function calculateDistancePercentage(x, y) {
    const maxRadius = 100;
    const distance = Math.sqrt(x * x + y * y);
    return (distance / maxRadius) * 100;
}
// ECharts 图表配置
const option_right = {
    series: [
        {
            type: 'gauge',
            radius: '100%', // 设置仪表盘半径为容器宽度的75%
            axisLine: {
                lineStyle: {
                    width: 30,
                    color: [
                        [0.3, '#67e0e3'],
                        [0.7, '#37a2da'],
                        [1, '#fd666d']
                    ]
                }
            },
            pointer: {
                itemStyle: {
                    color: 'auto'
                }
            },
            axisTick: {
                distance: -30,
                length: 8,
                lineStyle: {
                    color: '#fff',
                    width: 2
                }
            },
            splitLine: {
                distance: -30,
                length: 30,
                lineStyle: {
                    color: '#fff',
                    width: 4
                }
            },
            axisLabel: {
                show: false, // 隐藏轴标签（刻度下的数字）
                color: 'inherit',
                distance: 40,
                fontSize: 20
            },
            detail: {
                valueAnimation: true,
                formatter: function (value) {
                    return `${value.toFixed(2)}%\n移速`;
                },
                rich: {
                    a: {
                        fontSize: 20,
                        color: 'inherit'
                    },
                    b: {
                        fontSize: 14,
                        color: '#999'
                    }
                },
                color: 'inherit',
                fontSize: 20
            },
            data: [
                {
                    value: 0
                }
            ]
        }
    ]
};

// 设置初始配置
mychart_right.setOption(option_right);
// 定时器函数，每2秒生成一个新的随机点并更新图表
setInterval(function () {
    const distancePercentage = calculateDistancePercentage(rightX, rightY);
    mychart_right.setOption({
        series: [
            {
                data: [
                    {
                        value: distancePercentage.toFixed(2)
                    }
                ]
            }
        ]
    });
}, 200);

// 启动位置定时器
startPositionTimer();

// 初始化 ECharts 图表
const mychart_left = echarts.init(document.getElementById('main-left'));
// ECharts 图表配置
const option_left = {
    series: [
        {
            type: 'gauge',
            radius: '100%', // 设置仪表盘半径为容器宽度的75%
            axisLine: {
                lineStyle: {
                    width: 30,
                    color: [
                        [0.3, '#67e0e3'],
                        [0.7, '#37a2da'],
                        [1, '#fd666d']
                    ]
                }
            },
            pointer: {
                itemStyle: {
                    color: 'auto'
                }
            },
            axisTick: {
                distance: -30,
                length: 8,
                lineStyle: {
                    color: '#fff',
                    width: 2
                }
            },
            splitLine: {
                distance: -30,
                length: 30,
                lineStyle: {
                    color: '#fff',
                    width: 4
                }
            },
            axisLabel: {
                show: false, // 隐藏轴标签（刻度下的数字）
                color: 'inherit',
                distance: 40,
                fontSize: 20
            },
            detail: {
                valueAnimation: true,
                formatter: function (value) {
                    return `${value.toFixed(2)}%\n转速`;
                },
                rich: {
                    a: {
                        fontSize: 20,
                        color: 'inherit'
                    },
                    b: {
                        fontSize: 14,
                        color: '#999'
                    }
                },
                color: 'inherit',
                fontSize: 20
            },
            data: [
                {
                    value: 0
                }
            ]
        }
    ]
};
// 设置初始配置
mychart_left.setOption(option_left);
// 定时器函数，每2秒生成一个0 - 70的随机数并更新图表
setInterval(function () {
    const distancePercentage = calculateDistancePercentage(leftX, leftY);
    mychart_left.setOption({
        series: [
            {
                data: [
                    {
                        value: distancePercentage.toFixed(2)
                    }
                ]
            }
        ]
    });
}, 200);