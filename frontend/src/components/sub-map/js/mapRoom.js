
    // 初始化 ROS 连接：默认跟随当前网页主机，也允许统一配置覆盖。
    const rosProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const configuredRosUrl = window.localStorage.getItem('rosbridgeUrl');
    const rosUrl = configuredRosUrl && /^wss?:\/\//i.test(configuredRosUrl)
      ? configuredRosUrl
      : `${rosProtocol}//${window.location.hostname}:9090`;
    const ros = new ROSLIB.Ros({
      url: rosUrl
    });

    ros.on('connection', () => console.log('Connected to ROS.'));
    ros.on('error', (error) => console.error('Error connecting to ROS:', error));
    ros.on('close', () => console.log('Connection to ROS closed.'));

    // 订阅 /map 话题
    const mapTopic = new ROSLIB.Topic({
      ros: ros,
      name: '/map',
      messageType: 'nav_msgs/msg/OccupancyGrid'
    });

    // 用于发布数据的话题
    const dataTopic = new ROSLIB.Topic({
      ros: ros,
      name: '/data_range',  // 请根据实际需求修改话题名称
      messageType:'std_msgs/msg/Float64MultiArray'
    });

    // 创建一个话题发布者，发布到 "/coordinates" 话题
    var coordinatesPublisher = new ROSLIB.Topic({
      ros: ros,
      name: '/coordinates',  // 话题名
      messageType: 'std_msgs/msg/Float32MultiArray'  // 消息类型
    });

    // 用于发布位姿的话题
    const poseTopic = new ROSLIB.Topic({
      ros: ros,
      name: '/pgm_home_tf',
      messageType: 'geometry_msgs/msg/PoseStamped'
    });

    // 用于发布位姿的话题
    const initialpose = new ROSLIB.Topic({
      ros: ros,
      name: '/initialpose',
      messageType: 'geometry_msgs/msg/PoseWithCovarianceStamped'
    });

    // 创建一个话题发布者，发布到 "/coordinates" 话题
    const pointArrayer = new ROSLIB.Topic({
      ros: ros,
      name: '/pointArray',  // 话题名
      messageType: 'std_msgs/msg/Float32MultiArray'  // 消息类型
    });


    let mapData = null; // 存储地图数据
    let mapInfo = null; // 存储地图信息
    let planPoses = []; // 存储路径点
    let robotPose = null; // 存储机器人的实时位置
    let isDrawingRectangle = false; // 矩形绘制状态
    let startPoint = null; // 矩形起始点
    let endPoint = null; // 矩形结束点
    let drawnRectangles = []; // 存储已绘制的矩形
    let isDragging = false; // 地图拖动状态
    let dragStart = { x: 0, y: 0 }; // 拖动起始点
    let rotationAngle = 0; // 旋转角度
    let isPoseArrowEnabled = false; // 位姿箭头功能是否开启
    let isPoseInitEnabled = false; // 初始位置箭头功能是否开启
    let poseArrowPosition = null; // 位姿箭头的位置
    let poseArrowAngle = 0; // 位姿箭头的角度
    const poseArrowLength = 20; // 位姿箭头的长度
    let isRotatingArrow = false; // 是否正在旋转箭头
    let startMouseY = 0; // 鼠标按下时的初始 Y 坐标
    let initialArrowAngle = 0; // 箭头的初始角度
    let arrowTailMapPosition = null; // 用于存储箭头尾部的地图坐标
    let isMarking = false; // 标记状态
    let markers = []; // 存储标记的数组

    const canvas = document.getElementById('mapCanvas');
    const ctx = canvas.getContext('2d');
    const drawRectangleButton = document.getElementById('drawRectangleButton');
    const clearRectanglesButton = document.getElementById('clearRectanglesButton');
    const rectangleInfo = document.getElementById('rectangleInfo');
    const rotatePlusButton = document.getElementById('rotatePlusButton');
    const rotateMinusButton = document.getElementById('rotateMinusButton');
    const publishDataButton = document.getElementById('publishDataButton');
    const poseArrowButton = document.getElementById('poseArrowButton');
    const poseinitButton = document.getElementById('poseinitButton');
    const markButton = document.getElementById('markButton'); // 获取标记按钮
    const undoButton = document.getElementById('undoButton'); // 获取撤回按钮
    // 获取打印标记位置按钮
    const printMarkersButton = document.getElementById('printMarkersButton');
    let scaleFactor = 7; // 初始缩放比例
    let offsetX = 0; // 地图偏移量 X
    let offsetY = 0; // 地图偏移量 Y

    mapTopic.subscribe((message) => {
      mapData = message.data;
      mapInfo = message.info;
      redrawMap(); // 每次收到新地图数据时重新绘制
    });

    // 订阅 /plan 话题
    const planTopic = new ROSLIB.Topic({
      ros: ros,
      name: '/plan',
      messageType: 'nav_msgs/msg/Path'
    });

    planTopic.subscribe((message) => {
      // 提取路径点
      planPoses = message.poses.map(pose => ({
        x: pose.pose.position.x,
        y: pose.pose.position.y
      }));

      // 重新绘制地图和路径
      redrawMap();
    });

    // 订阅机器人的 pose 话题
    const robotPoseTopic = new ROSLIB.Topic({
      ros: ros,
      name: '/pose', // 请根据实际话题名称修改
      messageType: 'geometry_msgs/msg/PoseWithCovarianceStamped'
    });

    robotPoseTopic.subscribe((message) => {
      robotPose = message.pose.pose;
      redrawMap(); // 每次收到新的机器人位置时重新绘制
    });

    // 切换矩形绘制状态
    drawRectangleButton.addEventListener('click', () => {
      isDrawingRectangle =!isDrawingRectangle;
      drawRectangleButton.textContent = isDrawingRectangle? '关闭矩形绘制' : '开启矩形绘制';
      if (!isDrawingRectangle) {
        startPoint = null;
        endPoint = null;
        redrawMap();
      }
    });

    // 清除所有绘制的矩形
    clearRectanglesButton.addEventListener('click', () => {
      drawnRectangles = [];
      rectangleInfo.textContent = '';
      redrawMap();
    });

    // 增加旋转角度
    rotatePlusButton.addEventListener('click', () => {
      rotationAngle += 10; // 每次增加 10 度
      redrawMap();
    });

    // 减少旋转角度
    rotateMinusButton.addEventListener('click', () => {
      rotationAngle -= 10; // 每次减少 10 度
      redrawMap();
    });

    // 位姿箭头按钮的点击事件处理函数
    poseArrowButton.addEventListener('click', () => {
      isPoseArrowEnabled =!isPoseArrowEnabled;
      poseArrowButton.textContent = isPoseArrowEnabled? '停止设置位姿箭头' : '开始设置位姿箭头';
      poseinitButton.textContent = '开始设置初始位置';
      isPoseInitEnabled = false;
      poseArrowPosition = null;
      poseArrowAngle = 0;
      redrawMap();
    });

    // 位姿初始位置按钮的点击事件处理函数
    poseinitButton.addEventListener('click', () => {
      isPoseInitEnabled =!isPoseInitEnabled;
      poseinitButton.textContent = isPoseInitEnabled? '停止设置初始位置' : '开始设置初始位置';
      poseArrowButton.textContent = '开始设置位姿箭头';
      isPoseArrowEnabled = false;
      poseArrowPosition = null;
      poseArrowAngle = 0;
      redrawMap();
    });

    // 标记按钮的点击事件处理函数
    markButton.addEventListener('click', () => {
      if (isMarking) {
        console.log(markers,"markers");
        markers = []; // 清空标记数组
        markButton.textContent = '开始标记';
    
      } else {
        markButton.textContent = '清空标记';
      
      }
      isMarking =!isMarking;
      redrawMap();
    });

    // 撤回按钮的点击事件处理函数
    undoButton.addEventListener('click', () => {
      if (markers.length > 0) {
        markers.pop(); // 删除标记数组的最后一个元素
        redrawMap();
      }
    });

    // 处理鼠标按下事件
    canvas.addEventListener('mousedown', (event) => {
      if (isDrawingRectangle) {
        const rect = canvas.getBoundingClientRect();
        startPoint = {
          x: (event.clientX - rect.left) / scaleFactor - offsetX,
          y: (event.clientY - rect.top) / scaleFactor - offsetY
        };
      } else if (isPoseArrowEnabled || isPoseInitEnabled) {
        const rect = canvas.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const clickY = event.clientY - rect.top;

        // 直接计算点击位置的地图坐标（避免多次转换误差）
        const resolution = mapInfo.resolution;
        const originX = mapInfo.origin.position.x;
        const originY = mapInfo.origin.position.y;
        const mapX = originX + ((clickX / scaleFactor - offsetX) * resolution);
        const mapY = originY + ((mapInfo.height - (clickY / scaleFactor - offsetY)) * resolution);

        // 记录箭头尾部的地图坐标
        arrowTailMapPosition = { x: mapX, y: mapY };

        // 记录画布坐标用于绘制箭头
        poseArrowPosition = {
          x: (clickX / scaleFactor - offsetX),
          y: (clickY / scaleFactor - offsetY)
        };
        isRotatingArrow = true;
      } else if (isMarking) {
        const rect = canvas.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const clickY = event.clientY - rect.top;
        const markerX = (clickX / scaleFactor - offsetX);
        const markerY = (clickY / scaleFactor - offsetY);
        markers.push({ x: markerX, y: markerY });
        redrawMap();
      } else {
        isDragging = true;
        const rect = canvas.getBoundingClientRect();
        dragStart = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top
        };
      }
    });

    // 处理鼠标移动事件
    canvas.addEventListener('mousemove', (event) => {
      if (isDrawingRectangle && startPoint) {
        const rect = canvas.getBoundingClientRect();
        endPoint = {
          x: (event.clientX - rect.left) / scaleFactor - offsetX,
          y: (event.clientY - rect.top) / scaleFactor - offsetY
        };
        redrawMap();
      } else if (isDragging) {
        const rect = canvas.getBoundingClientRect();
        const currentX = event.clientX - rect.left;
        const currentY = event.clientY - rect.top;
        const dx = (currentX - dragStart.x) / scaleFactor;
        const dy = (currentY - dragStart.y) / scaleFactor;
        offsetX += dx;
        offsetY += dy;
        dragStart = { x: currentX, y: currentY };
        redrawMap();
      } else if (isRotatingArrow && poseArrowPosition) {
        const rect = canvas.getBoundingClientRect();
        const mouseX = (event.clientX - rect.left) / scaleFactor - offsetX;
        const mouseY = (event.clientY - rect.top) / scaleFactor - offsetY;

        // 计算鼠标相对于箭头尾部的角度
        const dx = mouseX - poseArrowPosition.x;
        const dy = mouseY - poseArrowPosition.y;
        poseArrowAngle = Math.atan2(dy, dx) * (180 / Math.PI);

        // 确保角度在 0 到 360 度之间
        if (poseArrowAngle < 0) {
          poseArrowAngle += 360;
        }
        redrawMap();
      }
    });

    // 处理鼠标松开事件
    canvas.addEventListener('mouseup', (event) => {
      if (isDrawingRectangle && startPoint) {
        const rect = canvas.getBoundingClientRect();
        endPoint = {
          x: (event.clientX - rect.left) / scaleFactor - offsetX,
          y: (event.clientY - rect.top) / scaleFactor - offsetY
        };
        // 将绘制好的矩形添加到已绘制矩形数组中
        drawnRectangles.push({
          start: startPoint,
          end: endPoint
        });
        // 打印矩形四个边的坐标
        printRectangleCoordinates(startPoint, endPoint);
        startPoint = null;
        endPoint = null;
        redrawMap();
      }
      isDragging = false;
      isRotatingArrow = false;
      if (isPoseArrowEnabled && arrowTailMapPosition) {
        // 获取当前时间并转换为 ROS 时间格式
        const now = Date.now();
        const secs = Math.floor(now / 1000);
        const nsecs = (now % 1000) * 1000000;

        // 直接使用存储的地图坐标发布位姿
        const poseMsg = new ROSLIB.Message({
          header: {
            stamp: { secs, nsecs },
            frame_id: 'map' // 通常地图帧名为 'map'
          },
          pose: {
            position: {
              x: arrowTailMapPosition.x,
              y: arrowTailMapPosition.y,
              z: 0
            },
            orientation: {
              x: 0,
              y: 0,
              // 计算四元数（根据箭头角度）
              z: Math.sin((poseArrowAngle * Math.PI) / 180),
              w: Math.cos((poseArrowAngle * Math.PI) / 180)
            }
          }
        });
        poseTopic.publish(poseMsg);
        console.log('Published Pose:', poseMsg);
        arrowTailMapPosition = null; // 重置坐标
      } else if (isPoseInitEnabled && arrowTailMapPosition) {
        // 获取当前时间并转换为 ROS 时间格式
        const now = Date.now();
        const secs = Math.floor(now / 1000);
        const nsecs = (now % 1000) * 1000000;

        const poseWithCovariance = {
          header: {
            stamp: { secs, nsecs },
            frame_id: "map"  // 坐标系，通常是 "map" 或 "odom"
          },
          pose: {
            pose: {
              position: {
                x: arrowTailMapPosition.x,
                y: arrowTailMapPosition.y,
                z: 0.0
              },
              orientation: {
                x: 0.0,
                y: 0.0,
                // 计算四元数（根据箭头角度）
                z: Math.sin((poseArrowAngle * Math.PI) / 180),
                w: Math.cos((poseArrowAngle * Math.PI) / 180)
              }
            },
            covariance: [
              0, 0.0, 0.0, 0.0, 0.0, 0.0,  // x
              0.0, 0, 0.0, 0.0, 0.0, 0.0,  // y
              0.0, 0.0, 0, 0.0, 0.0, 0.0,  // z
              0.0, 0.0, 0.0, 0.0, 0.0, 0.0, // roll
              0.0, 0.0, 0.0, 0.0, 0.0, 0.0, // pitch
              0.0, 0.0, 0.0, 0.0, 0.0, 0.0  // yaw
            ]
          }
        };

        initialpose.publish(poseWithCovariance);
        console.log('Published poseWithCovariance:', poseWithCovariance);
        arrowTailMapPosition = null; // 重置坐标
      }
    });


    // 绘制地图和路径
    function redrawMap() {
      if (!mapInfo ||!mapData) return;

      const width = mapInfo.width;
      const height = mapInfo.height;
      const resolution = mapInfo.resolution;

      // 清空画布
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 保存当前画布状态
      ctx.save();

      // 平移到画布中心
      ctx.translate(canvas.width / 2, canvas.height / 2);
      // 旋转画布
      ctx.rotate((rotationAngle * Math.PI) / 180);
      // 平移回原来的位置
      ctx.translate(-canvas.width / 2, -canvas.height / 2);

      // 绘制地图
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const index = y * width + x;
          const value = mapData[index];

          let color;
          if (value === -1) {
            color = 'gray'; // 未知区域
          } else if (value === 0) {
            color = 'white'; // 自由空间
          } else {
            color = 'black'; // 障碍物
          }

          // 翻转Y轴以适配Canvas坐标系
          const flippedY = height - 1 - y;

          // 使用 scale factor 和偏移量绘制每个单元格
          ctx.fillStyle = color;
          ctx.fillRect(
            (x + offsetX) * scaleFactor,
            (flippedY + offsetY) * scaleFactor,
            scaleFactor,
            scaleFactor
          );
        }
      }

      // 绘制路径
      if (planPoses.length > 0) {
        ctx.lineWidth = 2; // 路径线宽
        ctx.beginPath();

        planPoses.forEach((pose, index) => {
          // 将地图坐标转换为Canvas像素坐标
          const canvasX =
            ((pose.x - mapInfo.origin.position.x) / mapInfo.resolution + offsetX) * scaleFactor;
          const canvasY =
            ((mapInfo.height - (pose.y - mapInfo.origin.position.y) / mapInfo.resolution + offsetY) *
              scaleFactor);

          if (index === 0) {
            ctx.moveTo(canvasX, canvasY); // 移动到第一个点
          } else {
            ctx.lineTo(canvasX, canvasY); // 连接到下一个点
          }
        });

        ctx.stroke(); // 绘制路径
      }

      // 绘制机器人位置
      if (robotPose) {
        const robotX =
          ((robotPose.position.x - mapInfo.origin.position.x) / mapInfo.resolution + offsetX) * scaleFactor;
        const robotY =
          ((mapInfo.height - (robotPose.position.y - mapInfo.origin.position.y) / mapInfo.resolution + offsetY) *
            scaleFactor);

        ctx.fillStyle = 'red'; // 机器人标记颜色
        ctx.beginPath();
        ctx.arc(robotX, robotY, 5, 0, 2 * Math.PI); // 绘制圆形代表机器人
        ctx.fill();
      }

      // 绘制已绘制的矩形
      drawnRectangles.forEach((rect) => {
        const scaledStartX = (rect.start.x + offsetX) * scaleFactor;
        const scaledStartY = (rect.start.y + offsetY) * scaleFactor;
        const scaledEndX = (rect.end.x + offsetX) * scaleFactor;
        const scaledEndY = (rect.end.y + offsetY) * scaleFactor;

        ctx.strokeStyle = '#ea580c';
        ctx.lineWidth = 2;
        ctx.strokeRect(
          scaledStartX,
          scaledStartY,
          scaledEndX - scaledStartX,
          scaledEndY - scaledStartY
        );
      });

      // 绘制正在绘制的矩形
      if (isDrawingRectangle && startPoint && endPoint) {
        const scaledStartX = (startPoint.x + offsetX) * scaleFactor;
        const scaledStartY = (startPoint.y + offsetY) * scaleFactor;
        const scaledEndX = (endPoint.x + offsetX) * scaleFactor;
        const scaledEndY = (endPoint.y + offsetY) * scaleFactor;

        ctx.strokeStyle = '#ea580c';
        ctx.lineWidth = 2;
        ctx.strokeRect(
          scaledStartX,
          scaledStartY,
          scaledEndX - scaledStartX,
          scaledEndY - scaledStartY
        );
      }

      // 绘制箭头，修改条件判断，让 isPoseInitEnabled 为 true 时也绘制
      if ((isPoseArrowEnabled || isPoseInitEnabled) && poseArrowPosition) {
        const arrowCanvasX = (poseArrowPosition.x + offsetX) * scaleFactor;
        const arrowCanvasY = (poseArrowPosition.y + offsetY) * scaleFactor;
        const angleRad = (poseArrowAngle * Math.PI) / 180; // 转换为弧度
        const arrowHeadLength = 10; // 箭头头部长度
        const arrowHeadAngle = 30; // 箭头头部角度（度数）

        // 计算箭头尖端点
        const tipX = arrowCanvasX + poseArrowLength * Math.cos(angleRad);
        const tipY = arrowCanvasY + poseArrowLength * Math.sin(angleRad);

        // 计算箭头头部两侧点（三角形顶点）
        const leftX = tipX - arrowHeadLength * Math.cos(angleRad - arrowHeadAngle * Math.PI / 180);
        const leftY = tipY - arrowHeadLength * Math.sin(angleRad - arrowHeadAngle * Math.PI / 180);
        const rightX = tipX - arrowHeadLength * Math.cos(angleRad + arrowHeadAngle * Math.PI / 180);
        const rightY = tipY - arrowHeadLength * Math.sin(angleRad + arrowHeadAngle * Math.PI / 180);

        ctx.beginPath();
        ctx.moveTo(arrowCanvasX, arrowCanvasY); // 尾部起点
        ctx.lineTo(tipX, tipY); // 绘制主箭头线

        // 绘制箭头头部三角形
        ctx.lineTo(leftX, leftY);
        ctx.lineTo(rightX, rightY);
        ctx.lineTo(tipX, tipY); // 闭合三角形

        ctx.strokeStyle = 'green';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'green'; // 添加填充颜色
        ctx.fill(); // 填充箭头头部
      }

      // 绘制标记
      markers.forEach((marker) => {
        const markerCanvasX = (marker.x + offsetX) * scaleFactor;
        const markerCanvasY = (marker.y + offsetY) * scaleFactor;
        ctx.fillStyle = 'orange';
        ctx.beginPath();
        ctx.arc(markerCanvasX, markerCanvasY, 3, 0, 2 * Math.PI);
        ctx.fill();
      });

      // 恢复画布状态
      ctx.restore();
    }

    // 监听鼠标滚轮事件
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left; // 鼠标相对于画布的 X 坐标
      const mouseY = event.clientY - rect.top; // 鼠标相对于画布的 Y 坐标

      const zoomFactor = 1.1; // 缩放因子
      const oldScaleFactor = scaleFactor;

      // 根据滚轮方向调整缩放比例
      if (event.deltaY < 0) {
        scaleFactor *= zoomFactor; // 放大
      } else {
        scaleFactor /= zoomFactor; // 缩小
      }

      // 限制缩放范围
      scaleFactor = Math.max(0.5, Math.min(scaleFactor, 10));

      // 调整偏移量以保持鼠标位置不变
      offsetX -= (mouseX / oldScaleFactor - mouseX / scaleFactor);
      offsetY -= (mouseY / oldScaleFactor - mouseY / scaleFactor);

      // 重新绘制地图
      redrawMap();
    });

    // 获取点击位置
    canvas.addEventListener('click', (event) => {
      if (!mapInfo) {
        alert('Map data not loaded yet.');
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;
      // 将像素坐标转换为地图坐标
      const resolution = mapInfo.resolution;
      const originX = mapInfo.origin.position.x;
      const originY = mapInfo.origin.position.y;

      const mapX =
        originX + ((clickX / scaleFactor - offsetX) * resolution);
      const mapY =
        originY + ((mapInfo.height - (clickY / scaleFactor - offsetY)) * resolution);

      // 显示点击位置
      document.getElementById('positionInfo').innerText =
        `Clicked Position: (${mapX.toFixed(2)}, ${mapY.toFixed(2)}) meters`;
    });

    // 打印矩形四个边的坐标
    function printRectangleCoordinates(start, end) {
      const resolution = mapInfo.resolution;
      const originX = mapInfo.origin.position.x;
      const originY = mapInfo.origin.position.y;
      const topLeftX = originX + (start.x * resolution);
      const topLeftY = originY + ((mapInfo.height - start.y) * resolution);
      const topRightX = originX + (end.x * resolution);
      const topRightY = originY + ((mapInfo.height - start.y) * resolution);
      const bottomLeftX = originX + (start.x * resolution);
      const bottomLeftY = originY + ((mapInfo.height - end.y) * resolution);
      const bottomRightX = originX + (end.x * resolution);
      const bottomRightY = originY + ((mapInfo.height - end.y) * resolution);

      rectangleInfo.textContent = `矩形四个边坐标：
        左上角: (${topLeftX.toFixed(2)}, ${topLeftY.toFixed(2)}) meters
        右上角: (${topRightX.toFixed(2)}, ${topRightY.toFixed(2)}) meters
        左下角: (${bottomLeftX.toFixed(2)}, ${bottomLeftY.toFixed(2)}) meters
        右下角: (${bottomRightX.toFixed(2)}, ${bottomRightY.toFixed(2)}) meters`;

      // 发布数据按钮的点击事件处理函数
      publishDataButton.addEventListener('click', () => {
        // 定义四个坐标点 (x, y)
        var coordinates = [
          { x: topLeftX, y: topLeftY },
          { x: topRightX, y: topRightY },
          { x: bottomLeftX, y: bottomLeftY },
          { x: bottomRightX, y: bottomRightY }
        ];
        // 将坐标点转换为一维数组
        var coordinateArray = [];
        coordinates.forEach(function (coord) {
          coordinateArray.push(coord.x, coord.y);
        });
        // 创建消息并发送
        var message = new ROSLIB.Message({
          data: coordinateArray
        });
        // 发布消息
        console.log(coordinateArray,"coordinateArray");
        coordinatesPublisher.publish(message);
      });
    }

// 为打印标记位置按钮添加点击事件监听器
printMarkersButton.addEventListener('click', () => {
  let allPointData = [];
    if (markers.length > 0) {
        console.log('标记位置信息：');
        markers.forEach((marker, index) => {
            // 将标记的画布坐标转换为地图坐标
            const resolution = mapInfo.resolution;
            const originX = mapInfo.origin.position.x;
            const originY = mapInfo.origin.position.y;
            const mapX = originX + (marker.x * resolution);
            const mapY = originY + ((mapInfo.height - marker.y) * resolution);
            allPointData.push(Number(mapX.toFixed(3)))
            allPointData.push(Number(mapY.toFixed(3)))
            console.log(`标记 ${index + 1}: (${mapX.toFixed(3)}, ${mapY.toFixed(3)}) 米`);
        });
        var message = new ROSLIB.Message({
          data: allPointData
        });
        pointArrayer.publish(message)
        console.log(allPointData,"allPointData");
    } else {
        console.log('当前没有标记位置。');
    }
});
