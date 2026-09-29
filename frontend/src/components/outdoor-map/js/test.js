import RosManager from "./RosManager.js";
import axiosClient from "./ApiManager.js";
import webSocketUtil from "../tool/webSocketUtil.js";
const rosManager = new RosManager();
var map;
let toggleStatus = false;
let dragStatus = false; // 初始状态为禁止拖动
let editStatus = false; // 编辑模式初始状态
var markers = [];
var routePoints = [];
var currentPolyline = null;
let alldata = [];  //路线数据
let routeDisplayStatus = {}; // 记录路线显示状态

// 全局变量，用于跟踪是否正在拖动操作
let isDragging = false;
let dragEndTime = 0;
const DRAG_END_THRESHOLD = 200; // 拖动结束后200ms内的点击将被忽略
let currentBootPoint = null; // 当前选中的引导点
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

// 生成路线复选框列表
function updateRouteCheckboxList() {
  const container = document.getElementById('routeCheckboxList');
  container.innerHTML = '';

  if (alldata.length === 0) {
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

  alldata.forEach(route => {
    const div = document.createElement('div');
    div.className = 'select-option';
    const isChecked = routeDisplayStatus[route.routeId] === true;
    
    // 获取路线颜色
    const routeColor = getRouteColor(route.routeId);
    
    div.innerHTML = `
      <input type='checkbox'
             class='route-checkbox' 
             id='route_${route.routeId}' 
             value='${route.routeId}'
             ${isChecked ? 'checked' : ''}>
      <label for='route_${route.routeId}' style='display: flex; align-items: center;'>
        <span style='display: flex; width: 16px; height: 16px; background-color: ${routeColor}; margin-right: 8px; border-radius: 50%;'></span>
        ${route.routeName}
      </label>
    `;
    
    // 添加复选框事件监听
    const checkbox = div.querySelector('.route-checkbox');
    checkbox.addEventListener('change', () => {
      toggleRouteDisplay(route.routeId);
      updateSelectButtonText();
    });
    
    // 添加整行点击事件
    div.addEventListener('click', (e) => {
      if (e.target.type !== 'checkbox') {
        checkbox.checked = !checkbox.checked;
        toggleRouteDisplay(route.routeId);
        updateSelectButtonText();
      }
    });
    
    container.appendChild(div);
  });
}
// 确保DOM加载完成后再绑定事件监听器
document.addEventListener('DOMContentLoaded', function() {
    const publishAvoidnmodelElement = document.getElementById("publishAvoidnmodel");
    if (publishAvoidnmodelElement) {
        publishAvoidnmodelElement.addEventListener("change",()=>{
            const publishAvoidnmodel = publishAvoidnmodelElement.value;
            let aviodMsg = new ROSLIB.Message({
                 data: Number(publishAvoidnmodel),
            });
            rosManager.opstacleAvoidance.publish(aviodMsg);
        });
        
    } else {
        console.error("未找到ID为'publishAvoidnmodel'的元素");
    }
});
// 更新选择框按钮文本
function updateSelectButtonText() {
  const selectText = document.querySelector('.select-text');
  const checkedCount = Object.values(routeDisplayStatus).filter(status => status === true).length;
  
  if (checkedCount === 0) {
    selectText.textContent = '请预览路线';
  } else if (checkedCount === 1) {
    const selectedRoute = alldata.find(route => routeDisplayStatus[route.routeId] === true);
    selectText.textContent = selectedRoute ? selectedRoute.routeName : `已选择${checkedCount}条路线`;
  } else {
    selectText.textContent = `已选择${checkedCount}条路线`;
  }
}

// 全选所有路线
function selectAllRoutes() {
  alldata.forEach(route => {
    routeDisplayStatus[route.routeId] = true;
    const checkbox = document.querySelector(`#route_${route.routeId}`);
    if (checkbox) {
      checkbox.checked = true;
    }
    showRouteById(route.routeId);
  });
  updateSelectButtonText();
}

// 取消全选所有路线
function deselectAllRoutes() {
  alldata.forEach(route => {
    routeDisplayStatus[route.routeId] = false;
    const checkbox = document.querySelector(`#route_${route.routeId}`);
    if (checkbox) {
      checkbox.checked = false;
    }
    hideRouteById(route.routeId);
  });
  updateSelectButtonText();
}

// 将函数暴露到全局作用域，以便HTML中的onclick事件可以调用
window.selectAllRoutes = selectAllRoutes;
window.deselectAllRoutes = deselectAllRoutes;

// 搜索路线功能
function filterRoutes(searchTerm) {
  const container = document.getElementById('routeCheckboxList');
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
function showRouteById(routeId) {

  
  const route = alldata.find(r => r.routeId == routeId);
  if (route && route.stations) {
    const routePoints = route.stations.map(station => [Number(station.latitude), Number(station.longitude)]);
    if (routePoints.length > 0) {
      if (map) {
        // 获取路线颜色
        const routeColor = getRouteColor(routeId);
        
        // 创建路线
        const polyline = L.polyline(routePoints, { 
          color: routeColor, 
          weight: 3,
          routeId: routeId // 将routeId存储在polyline的options中
        }).addTo(map);
        
        // 为路线添加方向箭头
        for (let i = 0; i < routePoints.length - 1; i++) {
          const startPoint = routePoints[i];
          const endPoint = routePoints[i + 1];
          
          // 计算线段的角度（Leaflet坐标系：正北为0度，顺时针增加）
          const dx = endPoint[1] - startPoint[1]; // 经度差（x轴）
          const dy = endPoint[0] - startPoint[0]; // 纬度差（y轴）
          // 计算角度（弧度转角度，并调整到Leaflet坐标系）
          let angle = Math.atan2(dx, dy) * 180 / Math.PI;
          // 确保角度在0-360度范围内
          if (angle < 0) angle += 360;
          
          // 计算线段中点位置
          const midPoint = [
            (startPoint[0] + endPoint[0]) / 2,
            (startPoint[1] + endPoint[1]) / 2
          ];
          
          // 创建箭头图标
          const arrowIcon = L.divIcon({
            className: 'arrow-icon',
            html: `<div style="transform-origin: center 5px; transform: rotate(${angle}deg); width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 8.7px solid ${routeColor}; position: absolute; top: 0px; left: -5px;"></div>`,
            iconSize: [10, 8.7],
            iconAnchor: [0, 5] // 锚点设在三角形底边中点
          });
          
          // 在线段中点添加箭头标记
          const arrowMarker = L.marker(midPoint, {
            icon: arrowIcon,
            routeId: routeId,
            isArrow: true // 标记这是箭头，便于后续管理
          }).addTo(map);
        }
        
        // 创建起点和终点图标
        const specialIcon = L.icon({
          iconUrl: '../plugins/img/中文终点.svg', // 终点标记图片路径
          iconSize: [25, 25],
          iconAnchor: [12.5,30 ]
        });
        const startIcon = L.icon({
          iconUrl: '../plugins/img/中文起点.svg', // 起点标记图片路径
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
        }
        
        // 添加终点标记
        if (routePoints.length > 1) {
          const endPoint = routePoints[routePoints.length - 1];
          const endMarker = L.marker(endPoint, {
            icon: specialIcon,
            routeId: routeId,
            isEndPoint: true // 标记这是终点
          }).addTo(map);
        }
        
        // 为每个站点添加标签
        route.stations.forEach((station, index) => {
          // 创建站点标记
          const marker = L.circleMarker([station.latitude, station.longitude], {
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
            offset: [20, 0] // 偏移量，左边距20像素
        });
          
          // 添加鼠标悬浮事件，控制标签显示
          marker.on('mouseover', function() {
            this.openTooltip();
            // 使用CSS类控制标签显示
            const tooltip = this.getTooltip();
            if (tooltip) {
              L.DomUtil.addClass(tooltip._container, 'leaflet-tooltip-visible');
            }
            
            // 如果在新增路线模式下，显示加号标记
            if (toggleStatus) {
              showAddButtonNearStation(this, routeId, index);
            }
          });
          
          marker.on('mouseout', function() {
            this.closeTooltip();
            // 移除显示类
            const tooltip = this.getTooltip();
            if (tooltip) {
              L.DomUtil.removeClass(tooltip._container, 'leaflet-tooltip-visible');
            }
            
            // 延迟隐藏加号标记，给用户时间将鼠标移动到加号标记上
            if (addButtonTimeout) {
              clearTimeout(addButtonTimeout);
            }
            addButtonTimeout = setTimeout(function() {
              hideAddButtonNearStation();
            }, 500); // 延迟0.5秒隐藏
          });
          
        });
        
        
        // 调整地图视图以适应路线
        const group = new L.featureGroup([
          polyline, 
          ...route.stations.map((station, index) => 
            L.circleMarker([station.latitude, station.longitude], {
              radius: 6,
              fillColor: routeColor,
              color: '#000',
              weight: 1,
              opacity: 1,
              fillOpacity: 0.8
            })
          )
        ]);
        map.fitBounds(group.getBounds().pad(0.1));
      } else {
        console.error('map对象未初始化，无法显示路线');
      }
    }
  } else {
    console.error(`未找到路线数据或路线无站点: routeId=${routeId}`);
  }
}

// 隐藏指定路线
function hideRouteById(routeId) {
  
  // 遍历地图的所有图层，找到匹配的polyline和站点标记
  let foundCount = 0;
  let stationCount = 0;
  
  map.eachLayer(layer => {
    // 移除路线
    if (layer instanceof L.Polyline && layer.options.routeId == routeId) {
      map.removeLayer(layer);
      foundCount++;
    }
    
    // 移除站点标记
    if (layer instanceof L.CircleMarker && layer.options.routeId == routeId) {
      map.removeLayer(layer);
      stationCount++;
    }
    
    // 移除箭头标记
    if (layer instanceof L.Marker && layer.options.routeId == routeId && layer.options.isArrow) {
      map.removeLayer(layer);
    }
    
    // 移除起点标记
    if (layer instanceof L.Marker && layer.options.routeId == routeId && layer.options.isStartPoint) {
      map.removeLayer(layer);
    }
    
    // 移除终点标记
    if (layer instanceof L.Marker && layer.options.routeId == routeId && layer.options.isEndPoint) {
      map.removeLayer(layer);
    }
  });
  
}

// 初始化事件绑定
window.addEventListener('load', async () => {
  const toggleButton = document.getElementById('toggleCheckboxPanel');
  const dropdown = document.getElementById('routeCheckboxContainer');
  const searchInput = document.getElementById('routeSearchInput');
  const selectButton = document.querySelector('.select-button');
  
  // 折叠/展开功能
  toggleButton.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('collapsed');
    selectButton.classList.toggle('active');
    
    // 展开时聚焦搜索框
    if (!dropdown.classList.contains('collapsed')) {
    //   setTimeout(() => {
    //     searchInput.focus();
    //   }, 100);
    }
  });
  
  // 搜索功能
  searchInput.addEventListener('input', (e) => {
    filterRoutes(e.target.value);
  });
  
  // 点击外部关闭下拉框
  document.addEventListener('click', (e) => {
    if (!selectButton.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('collapsed');
      selectButton.classList.remove('active');
    }
  });
  
  // 阻止下拉框内部点击事件冒泡
  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  
  // 键盘事件支持
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dropdown.classList.add('collapsed');
      selectButton.classList.remove('active');
    }
  });
  
  // 等待地图和数据加载完成后再生成复选框
  try {
    // 等待地图初始化完成
    if (!map) {
      await new Promise(resolve => {
        const checkMap = setInterval(() => {
          if (map) {
            clearInterval(checkMap);
            resolve();
          }
        }, 100);
      });
    }
    
    // 尝试加载路线数据
    try {
      await getAllRoute();
      updateSelectButtonText(); // 初始化按钮文本
    } catch (error) {
      console.error('路线数据加载失败，使用空数据生成选择框:', error);
      // 即使数据加载失败，也生成空的选择框列表
      updateRouteCheckboxList();
    }
  } catch (error) {
    console.error('初始化过程中发生错误:', error);
  }
});
var editableMarkers = []; // 用于存储编辑模式下的可拖动标记
// 在全局变量声明部分添加新变量
var randomMarker = null;
let stationVisibility = false; // 初始状态为隐藏站点
let stationData = null;
//所有站点的数据
let allStationData = null
let longitudeCurrent = null //当前机器的经度
let latitudeCurrent = null//当前机器维度
let currentAvoidArr = []//当前数组信息
let allowAddingStations = false; //当前的状态
let callbackStatus = 1
let carCurrentX;
let carCurrentY;
let machineMarker; // 机器位置标记（全局）
let updateTimer; // 定时器引用
//地图默认载入的数据
let initlongitudeCurrent = 116.9698175483 // 默认经度
let initlatitudeCurrent = 36.6145191040 // 默认纬度
const UPDATE_INTERVAL = 1000; // 1秒更新间隔（毫秒）
let localX = null
let localY = null
let linePreview = null; // 预览路线
let preViewRouteStatus = true; // 预览状态（注意：这里初始值建议设为false，根据你的需求调整）
let startMarker = null;
let endMarker = null;
let needPoint = 0;
let already = 0;
let pointInterval;
let carCurrentRunStatus = null;
// 新增：预览线和预览距离标记
let previewLine = null;
let previewDistanceMarker = null;
// 存储距离标记的数组
let distanceMarkers = [];
// 存储可拖动矩形标记的数组
let draggableRectMarkers = [];
// 存储新增点的历史记录，用于撤回功能
let addedPointsHistory = [];
let allRouteMsg = null
let currentRouteMsg = null
const webSocketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
let websocket = new webSocketUtil(`${webSocketProtocol}//${window.location.host}/ws/test7`);
window.addEventListener('beforeunload', () => {
    websocket.close();
    clearInterval(updateTimer); // 清除定时器
    if (machineMarker) {
        map.removeLayer(machineMarker); // 移除标记
    }
});

// rosManager.gpsSub.subscribe(function (message) {
//     latitudeCurrent = message.data[2]
//     longitudeCurrent = message.data[3]
// })
// setInterval(() => {
//     getPose()
// }, 800);
// function getPose() {
//     localStorage.setItem("latitudeCurrent", latitudeCurrent)
//     localStorage.setItem("longitudeCurrent", longitudeCurrent)
// }


websocket.setOnMessage((event) => {
    const data = JSON.parse(event.data);
    if (data.action === "PATHPOINT") {
        needPoint = data.pointnum
        already = data.pointsendnum
    }
    if (data.action === "carCurrentPosition") {
        carCurrentRunStatus = data.position.routeEnd
        if (carCurrentRunStatus == 1) {
            needPoint = 0;
            already = 0;
        }
        if (data.position.runStatus == 0) {
            $("#btnSend").val("Stop");
            $("#btnSend").text("运行");
            $("#btnSend").removeClass("btn-warning");
            $("#btnSend").addClass("btn-success");
        }
        else if (data.position.runStatus == 1) {
            $("#btnSend").val("Run");
            $("#btnSend").text("暂停");
            $("#btnSend").removeClass("btn-success");
            $("#btnSend").addClass("btn-warning");

        }
        if (data.position.runStatus === 1) {
        } else if (data.position.runStatus === 0) {
            $("#btnSend").val("Stop");
            $("#btnSend").text("运行");
            $("#btnSend").removeClass("btn-warning");
            $("#btnSend").addClass("btn-success");
        }
    }


});
function sendCtrlModeMsg() {
    const originData = {
        action: "RemoteCtrlAutomaticSwitch",
        points: 1
    }
    const finalData = JSON.stringify(originData);
    websocket.send(finalData);
}
websocket.setOnOpen(() => {
    sendCtrlModeMsg();
})

    function publishHandMove() {
      const message = new ROSLIB.Message({
        data: 1,
      });
      const messageContorl = new ROSLIB.Message({
        data: 0,
      });
        if(localStorage.getItem('currentInterface') == '3'){
        rosManager.publishGeneralTopic("RemoteCtrlAutomaticSwitch", "std_msgs/msg/UInt8", messageContorl);
      }else{
        rosManager.publishGeneralTopic("RemoteCtrlAutomaticSwitch", "std_msgs/msg/UInt8", message);
      }
    }
    publishHandMove()


function updateMachinePosition(map) { // 接收地图对象作为参数
    // 从 localStorage 获取坐标（可替换为实际数据源，如 WebSocket）
    const lat = parseFloat(localStorage.getItem('latitudeCurrent'));
    const lng = parseFloat(localStorage.getItem('longitudeCurrent'));
    
    // 从 localStorage 获取四元数数据
    const orientationW = parseFloat(localStorage.getItem('orientationW')) || 0;
    const orientationX = parseFloat(localStorage.getItem('orientationX')) || 0;
    const orientationY = parseFloat(localStorage.getItem('orientationY')) || 0;
    const orientationZ = parseFloat(localStorage.getItem('orientationZ')) || 0;
    
    // 将四元数转换为偏航角（绕Z轴的旋转）
    const yaw = Math.atan2(2 * (orientationW * orientationZ + orientationX * orientationY),
                          1 - 2 * (orientationY * orientationY + orientationZ * orientationZ));
    
    // 转换为角度制，调整旋转方向使图标与实际朝向一致
    const rotationDegrees = -yaw * (180 / Math.PI) + 90;
    
    // 检查位置变化是否明显（减少不必要的更新）
    const lastPosition = updateMachinePosition.lastPosition || { lat: null, lng: null };
    const latDiff = lastPosition.lat !== null ? Math.abs(lat - lastPosition.lat) : Infinity;
    const lngDiff = lastPosition.lng !== null ? Math.abs(lng - lastPosition.lng) : Infinity;
    
    // 保存当前位置供下次比较
    updateMachinePosition.lastPosition = { lat, lng };

    // 校验坐标范围（纬度 [-90, 90]，经度 [-180, 180]）
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        // 坐标无效时隐藏标记（如果存在）
        if (machineMarker && map) {
            try {
                map.removeLayer(machineMarker);
            } catch (e) {
                console.error('移除标记失败:', e);
            }
            machineMarker = null;
        }
        return;
    }

    const coords = { lat, lng };

    // 处理有效坐标
    if (!machineMarker) {
        if (!map) {
            console.error('地图对象未定义，无法创建标记');
            return;
        }
        createMachineMarker(coords, map, rotationDegrees); // 传递地图对象和旋转角度
    } else {
        try {
            // 只有当位置变化明显时才更新位置（阈值：0.000002
            if (latDiff > 0.0000005 || lngDiff > 0.0000005) {
                machineMarker.setLatLng([coords.lat, coords.lng]);
            }
            // 始终更新旋转角度（因为updateMachineMarkerRotation内部会检查变化）
            updateMachineMarkerRotation(rotationDegrees);
        } catch (e) {
            console.error('更新标记位置失败:', e);
        }
    }
}

function createMachineMarker(coords, map, rotationDegrees = 0) { // 接收地图对象和旋转角度作为参数
    if (!map) {
        throw new Error('无法创建标记：地图对象未定义');
    }

    const machineIcon = L.divIcon({
        className: 'machine-marker',
        html: `<img src="../plugins/img/车.svg" style="width: 30px; height: 30px; transform: rotate(${rotationDegrees}deg);" />`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });

    try {
        machineMarker = L.marker([coords.lat, coords.lng], { icon: machineIcon, zIndexOffset: -9000 }).addTo(map);
        // 保存旋转角度到标记对象
        machineMarker.rotationDegrees = rotationDegrees;
    } catch (e) {
        console.error('创建标记失败:', e);
        machineMarker = null;
    }
}

// 更新标记旋转角度的函数（优化版，减少闪烁）
function updateMachineMarkerRotation(rotationDegrees) {
    if (!machineMarker) {
        return;
    }
    
    try {
        // 检查角度变化是否明显（大于1度才更新，减少不必要的重绘）
        const currentRotation = machineMarker.rotationDegrees || 0;
        const rotationDiff = Math.abs(rotationDegrees - currentRotation);
        
        if (rotationDiff < 1) {
            return; // 角度变化太小，跳过更新
        }
        
        // 获取当前的图标元素
        const iconElement = machineMarker.getElement();
        if (iconElement) {
            const imgElement = iconElement.querySelector('img');
            if (imgElement) {
                // 直接修改img的transform属性，避免重新创建整个图标
                imgElement.style.transform = `rotate(${rotationDegrees}deg)`;
                imgElement.style.transition = 'transform 0.2s ease-in-out'; // 添加平滑过渡
                machineMarker.rotationDegrees = rotationDegrees;
                
                // 减少日志输出，避免控制台刷屏
                if (rotationDiff > 5) {
                }
                return;
            }
        }
        
        // 如果无法直接修改，则回退到原来的方法
        const newIcon = L.divIcon({
            className: 'machine-marker',
            html: `<img src="../plugins/img/车.svg" style="width: 30px; height: 30px; transform: rotate(${rotationDegrees}deg); transition: transform 0.2s ease-in-out;" />`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
        
        machineMarker.setIcon(newIcon);
        machineMarker.rotationDegrees = rotationDegrees;
    } catch (e) {
        console.error('更新标记旋转角度失败:', e);
    }
}


//这是运行，暂停的话题部分
$("#btnCloseRoute").click(function (e) {
    const selectElement = document.getElementById('routeSelect');
    const selectedValue = selectElement.value;
        rosManager.closeRoutePub.publish(rosManager.CAR_RUN_MSG);
        cocoMessage.warning("取消成功");
        $(".route_choose").text("");
        rosManager.carRunStarPub.publish(rosManager.CAR_STOP_MSG);
        $("#btnSend").val("Stop");
        $("#btnSend").text("运行");
        $("#btnSend").removeClass("btn-warning");
        $("#btnSend").addClass("btn-success");
        const selectedRouteName = selectElement.options[selectElement.selectedIndex].text.split(":")[1];
        let params = {
            routeMsg: `${selectedRouteName}`,
            carRun: "",
            carStop: "",
            workCancel: "机器停止并取消了执行的任务路线"
        }
        addWaterDepth(params)

        const closeData = {
            action: "CloseRoute"
        }
        const finalCloseData = JSON.stringify(closeData);
        websocket.send(finalCloseData);
        const originData = {
            action: "car_run_star",
            data: 0
        }
        const finalData = JSON.stringify(originData);
        websocket.send(finalData);

});
document.getElementById("carstop").addEventListener("click", () => {
    rosManager.carRunStarPub.publish(rosManager.CAR_STOP_MSG);
      const selectElement = document.getElementById('routeSelect');
    
      const selectedValue = selectElement.options[selectElement.selectedIndex].text.split(":")[1];
        let params = {
        routeMsg: `${selectedValue}`,
        carRun: "",
        carStop: "机器停止",
        workCancel: ""
    }
    addWaterDepth(params)
    cocoMessage.error("机器停止")
    const originData = {
        action: "car_run_star",
        data: 0
    }
    const finalData = JSON.stringify(originData);
    websocket.send(finalData);


})
$("#btnSend").click(async function (e) {
    let tmpchoose = $(".route_choose").text();
    const selectElement = document.getElementById('routeSelect');
    const selectedValue = selectElement.value;
    if (!selectedValue) {
        cocoMessage.error("请选择路线")
        return
    }
    else {
        // await    printCurrentRouteId()
        rosManager.carRunStarPub.publish(rosManager.CAR_RUN_MSG);
        const selectElement = document.getElementById('routeSelect');
        const selectedValue = selectElement.options[selectElement.selectedIndex].text.split(":")[1];
        let params = {
            routeMsg: `${selectedValue}`,
            carRun: "机器开始行驶", 
            carStop: "",
            workCancel: ""
        }
        cocoMessage.success("机器运行")
        addWaterDepth(params)
        const originData = {
            action: "car_run_star",
            data: 1
        }
        const finalData = JSON.stringify(originData);
        // 等待条件满足或超时

        // rosManager.carRunStarPub.publish(rosManager.CAR_STOP_MSG);
    }
});

document.addEventListener('DOMContentLoaded', (event) => {
    // 使用事件委托，将事件监听器绑定到一个总是存在的父级元素上
    document.body.addEventListener('click', function (e) {
        if (e.target && e.target.id == 'addNewPoint') {
            addCuurrentPoint();
        }
    });
});

//这边是获取所有数据的接口函数
// 获取所有路线数据


// 获取所有路线消息数据
async function getAllRouteMsg() {
    try {
        const response = await axiosClient.get("route/queryall");
        allRouteMsg = response.data.data
    } catch (error) {
        console.error("Error fetching data in getAllRouteMsg:", error); // 打印完整的错误信息
        allRouteMsg = []; // 清空数据，避免后续处理出错
        // 不抛出错误，让系统继续运行
    }
}

// 初始化时调用getAllRouteMsg，但不阻塞系统运行
getAllRouteMsg().catch(err => {
    console.error("getAllRouteMsg初始化调用失败:", err);
});

// 监听来自index.html的广播消息
window.addEventListener('storage', function(event) {
    if (event.key === 'routeUpdateBroadcast') {
        try {
            const broadcastData = JSON.parse(event.newValue);
            
            if (broadcastData.action === 'routeSaved') {
                // 重新获取路线数据并更新选择框
                getAllRoute().then(() => {
                    populateRouteSelect(true); // true表示选择最后添加的路线
                   
                }).catch(err => {
                    console.error('更新routeSelect选择框失败:', err);
                });
            }
        } catch (error) {
            console.error('解析广播消息失败:', error);
        }
    }
});

window.addEventListener("saveCompleted", (event) => {
  // 从event.detail中获取传递的信息
  const { success, data, timestamp } = event.detail;
  
  if (success) {
      getAllRoute().then(() => {
                    const selectedRoute = document.getElementById("routeSelect").value
                 
                    populateRouteSelect(false, selectedRoute);
                }).catch(err => {
                    console.error('更新routeSelect选择框失败:', err);
                });
  }
});


async function getAllRoute() {
    try {
        
        const response = await axiosClient.get("route/queryall");
    
        if (response && response.data && Array.isArray(response.data.data)) {
            const oldDataLength = alldata.length;
            alldata = response.data.data;
            // 数据加载完成后更新复选框列表
            updateRouteCheckboxList();
            
            // 更新选择框按钮文本
            updateSelectButtonText();
            
            // 更新currentRouteMsg，确保标记点击时显示最新数据
            const selectElement = document.getElementById('routeSelect');
            const selectedRouteId = selectElement ? selectElement.value : null;
            if (selectedRouteId) {
                const selectedRoute = alldata.find(r => r.routeId == selectedRouteId);
                if (selectedRoute) {
                    currentRouteMsg = selectedRoute.stations;
                } else {
                    console.warn("未找到选中的路线，currentRouteMsg保持不变");
                }
            } else {
                currentRouteMsg = null;
            }
        } else {
            console.error("Unexpected response structure from API:", response);
            alldata = []; // 清空数据
            updateRouteCheckboxList(); // 更新复选框列表
            updateSelectButtonText(); // 更新选择框按钮文本
        }
    } catch (error) {
        console.error("Error fetching data:", error); // 打印完整的错误信息
        alldata = []; // 清空数据
        updateRouteCheckboxList(); // 更新复选框列表
        updateSelectButtonText(); // 更新选择框按钮文本
        // 不抛出错误，让系统继续运行
    }
}

async function getAllCurrentPoint() {
    await axiosClient
        .get("station/querynew/2")
        .then((res) => {
            let data = res.data.data;
            stationData = data[0]
            // 标准化坐标数据类型
            stationData = stationData.map(s => ({
                ...s,
                latitude: parseFloat(s.latitude),
                longitude: parseFloat(s.longitude)
            }));
            //   allPointData = data.map((item) => [item.stationName, Number(item.longitude), Number(item.latitude), item.id]);
            // 转换函数
            // 添加标记并显示自己的名字
            // allPointData.forEach((item) => {
            //     addMarkerWithName(item[1],item[2],item[0],item[3]);
            // });
        })
}
var currentRoutePolyline = null; // 存储当前路线折线
// let alldata = response.data
// 在全局变量声明部分添加新变量
//当前的地图层级
let currentMapCover = 18
var randomMarker = null;
document.getElementById("controlButton").addEventListener("click", toggleClickEventWithoutRoute);
// document.getElementById("dragButton").addEventListener("click", toggleDragEvent);
document.getElementById("saveButton").addEventListener("click", saveRoute);
document.getElementById("callBack").addEventListener("click", callBack);
document.getElementById("editButton").addEventListener("click", editToggleClickEventWithRoute); // 添加事件监听器
//发布话题的事件监听
document.getElementById('printCurrentRouteId').addEventListener('click', printCurrentRouteId);
document.getElementById("clearButton").addEventListener("click", clearAllRoutes);
//随机点移动的问题

document.getElementById('getCurrentPositonXY').addEventListener('click', getCurrentPositonXY);
document.getElementById('deleteRoute').addEventListener('click', showDeleteConfirmation);
document.getElementById("saveRouteDataButton").addEventListener("click", saveRouteData);
document.getElementById('currentCarPosePose').addEventListener('click', getCurrentCarPosi);
// 清屏并重置选择框函数
function clearScreenAndReset() {
        if (previewLine) {
            map.removeLayer(previewLine);
            previewLine = null;
        }
        if (previewDistanceMarker) {
            map.removeLayer(previewDistanceMarker);
            previewDistanceMarker = null;
        }
    // 清除所有路线和标记
    clearAllRoutes();
    // 重置选择框
    const selectElement = document.getElementById('routeSelect');
    selectElement.selectedIndex = 0;
   document.getElementById("routeSpeed").textContent = "" 
   deleteBtnStatus = false
   addBtnStatus = false
   // 重置新增路线按钮状态
   if (toggleStatus) {
       toggleStatus = false;
       document.querySelector(".text-editLine").textContent = "新增路线";
       // 重置新增路线按钮图标
       const addEdit = document.getElementById('addEdit');
       if (addEdit) {
           addEdit.src = '../plugins/img/img-right/绘制路线 (1).png';
       }
   }
   
   // 重置编辑状态
   if (editStatus) {
       editStatus = false;
       document.querySelector(".text-edit").textContent = "开始编辑";
   }
   
   // 清除点的属性框
   const infoBox = document.getElementById('pointInfoBox');
   if (infoBox) {
       infoBox.style.display = 'none';
   }
   
   // 清除多点的属性框容器
   const multipleContainer = document.getElementById('multiplePointsContainer');
   if (multipleContainer) {
       multipleContainer.remove();
   }
   
   // 清除选中站点的特殊标记
   if (selectedStationMarker) {
       map.removeLayer(selectedStationMarker);
       selectedStationMarker = null;
   }
   
   // 清空左侧界面预览的复选框
   deselectAllRoutes();
   updateSelectButtonText();
   
   cocoMessage.success("已清除路线并重置选择框");
}
document.getElementById('clearScreenBtn').addEventListener('click', clearScreenAndReset);
document.getElementById('clearRouteLabelsBtn').addEventListener('click', function() {
    if (typeof clearCurrentRouteLabels === 'function') {
        clearCurrentRouteLabels();
    } else {
        console.error('clearCurrentRouteLabels 函数不存在');
    }
});
// document.getElementById('renderRouteLabelsBtn').addEventListener('click', function() {
//     if (typeof renderCurrentRouteStationLabels === 'function') {
//         renderCurrentRouteStationLabels();
//         console.log('重新渲染站点标签操作已完成');
//     } else {
//         console.error('renderCurrentRouteStationLabels 函数不存在');
//     }
// });
//   L.tileLayer('../tianditu/{z}/{x}/{y}.png', {
// L.tileLayer('http://124.222.227.182:8888/services/shuMaGang/tiles/{z}/{x}/{y}.png', {
// 添加 MBTiles 图层     }).setView([36.67782468164, 117.04736528708], 18);
async function onLoad() {
    await getRobotData()
    // 天地图在线图层
    const onlineVec = L.tileLayer('http://t{s}.tianditu.gov.cn/vec_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=vec&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=2ca63bb61a24b022abe84ddfe208ab57', {
        maxZoom: 19,
        subdomains: '01234567',
        attribution: '天地图'
    });
    const onlineCva = L.tileLayer('http://t{s}.tianditu.gov.cn/cva_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=cva&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=2ca63bb61a24b022abe84ddfe208ab57', {
        maxZoom: 19,
        subdomains: '01234567',
        attribution: '天地图'
    });
    const onlineLayers = L.layerGroup([onlineVec, onlineCva]);

    // 离线地图图层
    const offlineLayer = L.tileLayer('../tianditu/{z}/{x}/{y}.png', {
        minZoom: 1,
        maxZoom: 25,
        tms: false,
        attribution: '本地瓦片'
    });

    map = L.map('mapDiv', {
        doubleClickZoom: false,
        zoomSnap: 0.1
    }).setView([initlatitudeCurrent, initlongitudeCurrent], 22);

    // 地图加载完成后调用
    map.whenReady(() => {
        // 初始更新
        updateMachinePosition(map);

        // 设置定时器定期更新（每200ms更新一次，平衡实时性和性能）
        setInterval(() => updateMachinePosition(map), 200);
    });
    map.on('click', hideInfoBoxesOnMapClick)

    // map.on('click', ()=>{
    //     if (previewLine) {
    //         map.removeLayer(previewLine);
    //         previewLine = null;
    //     }
    //     if (previewDistanceMarker) {
    //         map.removeLayer(previewDistanceMarker);
    //         previewDistanceMarker = null;
    //     }
    // })

   // 原地图点击隐藏逻辑函数

    //图层控制函数
    function updateLayersByZoom() {
        const zoom = map.getZoom();
        if (zoom > 18) {
            // 18级及以上只显示离线地图
            if (map.hasLayer(onlineLayers)) {
                map.removeLayer(onlineLayers);
            }
            if (!map.hasLayer(offlineLayer)) {
                map.addLayer(offlineLayer);
            }
        } else {
            // 18级以下同时显示在线和离线地图
            if (!map.hasLayer(onlineLayers)) {
                map.addLayer(onlineLayers);
            }
            if (!map.hasLayer(offlineLayer)) {
                map.addLayer(offlineLayer);
            }
        }
    }

    // 监听地图缩放事件
    map.on('zoomend', updateLayersByZoom);
    //    }).setView([ 36.6145191040, 116.9698175483], 18);
    // 添加图层（在线先加载，离线覆盖在上层）
    onlineLayers.addTo(map);
    offlineLayer.addTo(map);
    L.tileLayer('../tianditu/{z}/{x}/{y}.png', {
        minZoom: 1,
        maxZoom: 25,
        tms: false,
        attribution: 'Created by QGIS'
    }).addTo(map);

    // 添加比例尺控件
    L.control.scale({
        position: 'bottomleft',
        metric: true,
        imperial: false,
        maxWidth: 200
    }).addTo(map);

    // 添加图标
    const icon = L.icon({
        iconUrl: '../plugins/img/当前位置 (2).png', // 替换为你的图标URL
        iconSize: [16, 16], // 图标大小
        iconAnchor: [8, 8] // 图标锚点
    });

    const markerHome = L.marker([initlatitudeCurrent, initlongitudeCurrent], { icon: icon, zIndexOffset: -1000 }).addTo(map);


    map.on('zoomend', function () {
        currentMapCover = map.getZoom()
    });
    map.on('mousemove', handleMouseMove);

    // 禁用/启用地图拖拽

    // 监听鼠标移动事件，创建预览效果
    map.on('mousemove', handleMouseMoveLine);


    map.on('click', handleMapClick);

    var customIcon = L.icon({
        iconUrl: '../plugins/img/坐标.svg',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
    });
    map.on('click', () => {
        document.getElementById('infoBox').style.display = 'none';
        currentInfoBox = null;
    });

    await getAllCurrentPoint()
    await getAllRoute()
    stationData.forEach(station => {
        var marker = L.marker([station.latitude, station.longitude], {
            icon: customIcon,
            title: station.stationName,
            draggable: dragStatus
        }).addTo(map);

        marker.bindTooltip(station.stationName, {
            permanent: false,
            direction: 'right',
            offset: [20, 0],
            className: 'station-label'
        });

        // 添加鼠标悬浮事件处理
        marker.on('mouseover', function() {
            this.openTooltip();
            const tooltipElement = this.getTooltip()._container;
            if (tooltipElement) {
                L.DomUtil.addClass(tooltipElement, 'leaflet-tooltip-visible');
            }
            
            // 如果处于新增路线模式，显示加号标记
            if (toggleStatus) {
                showAddButtonNearStation(this, station);
            }
        });

        marker.on('mouseout', function() {
            this.closeTooltip();
            const tooltipElement = this.getTooltip()._container;
            if (tooltipElement) {
                L.DomUtil.removeClass(tooltipElement, 'leaflet-tooltip-visible');
            }
            
            // 不再在鼠标移开时隐藏加号标记，让它持续显示直到点击事件
        });

        // 添加点击事件处理
        marker.on('click', function(e) {
            e.originalEvent.stopPropagation();
            
            // 在新增路线模式下，点击特殊点时显示属性框
            if (allowAddingStations) {
                // 查找与特殊点位置相同的普通路线点
                let normalStation = null;
                const markerLatLng = this.getLatLng();
                
                // 首先检查当前正在编辑的路线中是否有相同位置的点
                if (selectedRoute && selectedRoute.stations) {
                    normalStation = selectedRoute.stations.find(s => 
                        Math.abs(s.latitude - markerLatLng.lat) < 1e-6 && 
                        Math.abs(s.longitude - markerLatLng.lng) < 1e-6
                    );
                }
                
                // 如果在当前路线中没找到，尝试在routePoints中查找
                if (!normalStation && routePoints && routePoints.length > 0) {
                    const routePointIndex = routePoints.findIndex(point => 
                        Math.abs(point[0] - markerLatLng.lat) < 1e-6 && 
                        Math.abs(point[1] - markerLatLng.lng) < 1e-6
                    );
                    
                    if (routePointIndex !== -1) {
                        // 创建普通路线点对象
                        normalStation = {
                            stationName: `站点${routePointIndex + 1}`,
                            latitude: markerLatLng.lat,
                            longitude: markerLatLng.lng,
                            id: -1,
                            stationId: -1,
                            direction: '',
                            speed: '',
                            area: '1',
                            action: '1',
                            position: '0',
                            lanechange: '0',
                            stop: '0',
                            runmode: '0',
                            index: routePointIndex,
                            isRoutePoint: true // 标记为路线点
                        };
                    }
                }
                
                // 如果仍然没找到，创建一个新的普通路线点对象
                if (!normalStation) {
                    normalStation = {
                        stationName: `站点${(selectedRoute ? selectedRoute.stations.length : 0) + 1}`,
                        latitude: markerLatLng.lat,
                        longitude: markerLatLng.lng,
                        id: null,
                        stationId: null,
                        direction: '',
                        speed: '',
                        area: '1',
                        action: '1',
                        position: '0',
                        lanechange: '0',
                        stop: '0',
                        runmode: '0',
                        index: selectedRoute ? selectedRoute.stations.length : 0,
                        isRoutePoint: true // 标记为路线点
                    };
                }
                
                // 确保normalStation对象有所需的属性
                normalStation.stationId = normalStation.stationId || normalStation.id;
                normalStation.direction = normalStation.direction || '';
                normalStation.speed = normalStation.speed || '';
                normalStation.area = normalStation.area || '1';
                normalStation.action = normalStation.action || '1';
                normalStation.position = normalStation.position || '0';
                normalStation.lanechange = normalStation.lanechange || '0';
                normalStation.stop = normalStation.stop || '0';
                normalStation.runmode = normalStation.runmode || '0';
                normalStation.isRoutePoint = true; // 确保isRoutePoint属性设置为true
                
                // 显示普通路线点的属性框
                showMultiplePointInfoBoxes(e, [normalStation]);
            }
        });

        // 新增：存储原始的样式和标签状态
        marker.originalVisibility = {
            icon: marker.options.icon,
            tooltip: marker.options.tooltip
        };
        markers.push(marker);
    });

    populateRouteSelect();
    // 在地图初始化完成后调用 moveRandomMarker 函数
}
// 创建一个透明的图标
const transparentIcon = L.icon({
    iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    iconSize: [0, 0],
    iconAnchor: [0, 0]
});

function toggleStationVisibility() {
    let showHideImg = document.getElementById("showHideImg")
    stationVisibility = !stationVisibility;
    const buttonText = stationVisibility ? "隐藏特殊站点标签" : "显示特殊站点标签";
    document.querySelector(".text-showhide").textContent = buttonText;
    if (stationVisibility) {
        showHideImg.src = '../plugins/img/img-right/显示隐藏.png';
    } else {
        showHideImg.src = '../plugins/img/img-right/闭眼.png';
    }
    
    // 遍历所有特殊站点
    stationData.forEach(station => {
        // 找到对应的标记
        const marker = markers.find(m => 
            Math.abs(m.getLatLng().lat - station.latitude) < 1e-6 && 
            Math.abs(m.getLatLng().lng - station.longitude) < 1e-6
        );
        
        if (marker) {
            if (stationVisibility) {
                // 显示标签 - 重新绑定tooltip
                marker.bindTooltip(station.stationName, {
                    permanent: true,
                    className: 'station-label',
                    direction: 'right',
                    offset: [20, 0]
                });
            } else {
                // 隐藏标签 - 解绑tooltip
                if (marker.getTooltip()) {
                    marker.unbindTooltip();
                }
            }
        }
    });
}

document.getElementById("toggleStationVisibilityButton").addEventListener("click", toggleStationVisibility);

function handleMouseMove(e) {
    document.body.style.cursor = 'pointer'; // 可以改为 'crosshair' 或其他样式
    const latLng = e.latlng;
    document.getElementById('mousePosition').innerHTML = `鼠标位置：纬度 ${latLng.lat.toFixed(10)}，经度 ${latLng.lng.toFixed(10)}`;
}

function hideInfoBoxesOnMapClick() {
    const infoBox = document.getElementById('pointInfoBox');
    if (infoBox) {
        infoBox.style.display = 'none';
    }
    // 同时隐藏多个点的容器
    const multipleContainer = document.getElementById('multiplePointsContainer');
    if (multipleContainer) {
        multipleContainer.remove();
    }
}

// 在站点附近显示加号标记
let addButtonMarker = null;
let addButtonTimeout = null;

function showAddButtonNearStation(stationMarker, routeId, stationIndex) {
  // 如果已经存在加号标记，先移除
  hideAddButtonNearStation();
  
  // 获取站点的位置
  const stationLatLng = stationMarker.getLatLng();
  
  // 创建加号图标
  const addButtonIcon = L.icon({
    iconUrl: '../plugins/img/img-right/add.png', // 使用正确的加号图标路径
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
  
  // 创建加号标记，使用像素偏移，放置在站点右边
  // 获取站点在屏幕上的像素位置
  const stationPoint = map.latLngToContainerPoint(stationLatLng);
  // 向上偏移30像素
  const addButtonPoint = L.point(stationPoint.x, stationPoint.y - 30);
  // 将像素位置转换回经纬度
  const addButtonLatLng = map.containerPointToLatLng(addButtonPoint);
  
  addButtonMarker = L.marker(addButtonLatLng, {
    icon: addButtonIcon,
    interactive: true
  }).addTo(map);
  
  // 为加号标记添加点击事件
  addButtonMarker.on('click', function(e) {
    L.DomEvent.stopPropagation(e); // 阻止事件冒泡
    
    // 获取站点的位置（而不是加号标记的位置）
    const stationLatLng = stationMarker.getLatLng();
    
    // 直接调用addToRoute函数将特殊站点添加到路线中
    addToRoute(stationLatLng);
    
    // 注释掉创建原点标记的代码，避免在特殊点上添加原点
    // 在特殊站点位置创建一个标记，就像新增路线时的点击事件一样
    // var customIcon = L.icon({
    //     iconUrl: '../plugins/img/原点.png',
    //     iconSize: [22, 22],
    //     iconAnchor: [11, 11]
    // });

    // var marker = L.marker(stationLatLng, { icon: customIcon, draggable: editStatus }).addTo(map);
    
    // 保存原始位置和数据以备拖动操作使用
    // marker.originalData = {
    //     position: stationLatLng,
    //     id: null
    // };
    
    // 添加鼠标悬浮事件处理逻辑，显示加号标记
    // marker.on('mouseover', function(e) {
    //     if (toggleStatus) {
    //         console.log('Calling showAddButtonNearRoutePoint from special station marker');
    //         showAddButtonNearRoutePoint(e.latlng, this);
    //     }
    // });
    
    // 添加拖动结束事件处理，确保标记与路线点同步
    // marker.on('dragend', function(e) {
    //     const updatedPosition = e.target.getLatLng();
    //     const oldPosition = this.originalData.position;
    //     
    //     // 更新routePoints中的对应点
    //     let index = routePoints.findIndex(p => 
    //         p.lat === oldPosition.lat && 
    //         p.lng === oldPosition.lng
    //     );
    //     
    //     if (index !== -1) {
    //         routePoints[index] = updatedPosition;
    //         updatePolyline();
    //         // 更新原始数据位置
    //         this.originalData.position = updatedPosition;
    //         
    //         // 更新tempRouteStations中的对应数据
    //         if (window.tempRouteStations && window.tempRouteStations.length > 0) {
    //             const tempStationIndex = window.tempRouteStations.findIndex(s => 
    //                 Math.abs(s.latitude - oldPosition.lat) < 1e-6 && 
    //                 Math.abs(s.longitude - oldPosition.lng) < 1e-6
    //             );
    //             
    //             if (tempStationIndex !== -1) {
    //                 // 更新tempRouteStations中的经纬度信息
    //                 window.tempRouteStations[tempStationIndex].latitude = updatedPosition.lat;
    //                 window.tempRouteStations[tempStationIndex].longitude = updatedPosition.lng;
    //             }
    //         }
    //         
    //         // 更新对应的原始station数据中的坐标
    //         if (window.originalRouteStations) {
    //             const originalStation = window.originalRouteStations.find(item => 
    //                 Math.abs(item.latLng.lat - oldPosition.lat) < 1e-6 && 
    //                 Math.abs(item.latLng.lng - oldPosition.lng) < 1e-6
    //             );
    //             if (originalStation) {
    //                 originalStation.latLng = updatedPosition;
    //                 originalStation.stationData.latitude = updatedPosition.lat;
    //                 originalStation.stationData.longitude = updatedPosition.lng;
    //             }
    //         }
    //     }
    //     
    //     cocoMessage.success('拖动成功');
    // });
    
    // 将新创建的标记添加到全局数组中
    // markers.push(marker);
    // if (editStatus) {
    //     editableMarkers.push(marker);
    // }
    
    // 为新创建的标记添加点击事件
    // marker.on('click', function (e) {
    //     e.originalEvent.stopPropagation();
    //     // 判断是否在新增模式下
    //     if (toggleStatus) {
    //         // 新增模式下的行为
    //         if (window.isAddingToExistingRoute && window.baseRouteName) {
    //             cocoMessage.success(`已添加到路线"${window.baseRouteName}"中`);
    //         } else {
    //             cocoMessage.success("已添加,1342");
    //         }
    //         const isNewPoint = !stationData.some(s =>
    //             Math.abs(s.latitude - e.latlng.lat) < 1e-6 &&
    //             Math.abs(s.longitude - e.latlng.lng) < 1e-6
    //         );
    //         // 初始化 originalVisibility
    //         marker.originalVisibility = {
    //             icon: marker.options.icon, // 保存原始图标
    //             tooltip: marker.options.tooltip // 保存原始提示
    //         };
    //         
    //         // 在新增模式下也显示属性框
    //         if (isNewPoint) {
    //             // 自定义点的属性框
    //             const station = {
    //                 stationName: '',
    //                 latitude: e.latlng.lat,
    //                 longitude: e.latlng.lng,
    //                 id: null,
    //                 stationId: null,
    //                 direction: localStorage.getItem('globalDefaultDirection') || '0',
    //                 speed: localStorage.getItem('globalRouteSpeed') || "0.2",
    //                 area: localStorage.getItem('globalObstacleLevel') || "1",
    //                 action: localStorage.getItem('globalActionSelect') || "0",
    //                 position: localStorage.getItem('globalNavigationMode') || "1",
    //                 stop: '0',
    //                 runmode: localStorage.getItem('globalTurnMode') || "0",
    //                 lanechange: localStorage.getItem('globalLanechange') || "0",
    //                 index: 0
    //             };
    //             console.log(station,"特殊站点标记");
    //             
    //             showMultiplePointInfoBoxes(e, [station]);
    //         } else {
    //             // 已有站点的属性框
    //             const station = stationData.find(s =>
    //                 Math.abs(s.latitude - e.latlng.lat) < 1e-6 &&
    //                 Math.abs(s.longitude - e.latlng.lng) < 1e-6
    //             );
    //             if (station) {
    //                 station.index = 0;
    //                 // 确保station对象有所需的属性
    //                 station.stationId = station.stationId || station.id;
    //                 station.direction = station.direction || localStorage.getItem('globalDefaultDirection') || '0';
    //                 station.speed = station.speed || localStorage.getItem('globalRouteSpeed') || "0.2";
    //                 station.area = station.area || localStorage.getItem('globalObstacleLevel') || "1";
    //                 station.action = station.action || localStorage.getItem('globalActionSelect') || "0";
    //                 station.position = station.position || localStorage.getItem('globalNavigationMode') || "1";
    //                 station.runmode = station.runmode || localStorage.getItem('globalTurnMode') || "0";
    //                 station.lanechange = station.lanechange || localStorage.getItem('globalLanechange') || "0";
    //                 showMultiplePointInfoBoxes(e, [station]);
    //             }
    //         }
    //     } else {
    //         // 非新增模式下弹出属性框
    //         const isNewPoint = !stationData.some(s =>
    //             Math.abs(s.latitude - e.latlng.lat) < 1e-6 &&
    //             Math.abs(s.longitude - e.latlng.lng) < 1e-6
    //         );
    //         
    //         if (isNewPoint) {
    //             // 自定义点的属性框
    //             const station = {
    //                 stationName: '',
    //                 latitude: e.latlng.lat,
    //                 longitude: e.latlng.lng,
    //                 id: null,
    //                 stationId: null,
    //                 direction: localStorage.getItem('globalDefaultDirection') || '0',
    //                 speed: localStorage.getItem('globalRouteSpeed') || "0.2",
    //                 area: localStorage.getItem('globalObstacleLevel') || "1",
    //                 action: localStorage.getItem('globalActionSelect') || "0",
    //                 position: localStorage.getItem('globalNavigationMode') || "1",
    //                 stop: '0',
    //                 runmode: localStorage.getItem('globalTurnMode') || "0",
    //                 lanechange: localStorage.getItem('globalLanechange') || "0",
    //                 index: 0
    //             };
    //             
    //             showMultiplePointInfoBoxes(e, [station]);
    //         } else {
    //             // 已有站点的属性框
    //             const station = stationData.find(s =>
    //                 Math.abs(s.latitude - e.latlng.lat) < 1e-6 &&
    //                 Math.abs(s.longitude - e.latlng.lng) < 1e-6
    //             );
    //             if (station) {
    //                 station.index = 0;
    //                 // 确保station对象有所需的属性
    //                 station.stationId = station.stationId || station.id;
    //                 station.direction = station.direction || localStorage.getItem('globalDefaultDirection') || '0';
    //                 station.speed = station.speed || localStorage.getItem('globalRouteSpeed') || "0.2";
    //                 station.area = station.area || localStorage.getItem('globalObstacleLevel') || "1";
    //                 station.action = station.action || localStorage.getItem('globalActionSelect') || "0";
    //                 station.position = station.position || localStorage.getItem('globalNavigationMode') || "1";
    //                 station.runmode = station.runmode || localStorage.getItem('globalTurnMode') || "0";
    //                 station.lanechange = station.lanechange || localStorage.getItem('globalLanechange') || "0";
    //                 showMultiplePointInfoBoxes(e, [station]);
    //             }
    //         }
    //     }
    // });
    
    // 隐藏加号标记
    hideAddButtonNearStation();
  });
  
  // 为加号标记添加鼠标悬停事件，防止鼠标移入加号时消失
  addButtonMarker.on('mouseover', function() {
    // 清除可能存在的隐藏定时器
    if (addButtonTimeout) {
      clearTimeout(addButtonTimeout);
      addButtonTimeout = null;
    }
  });
  
  // 为加号标记添加鼠标移出事件，延迟隐藏
  addButtonMarker.on('mouseout', function() {
    // 设置延迟隐藏，给用户时间点击
    if (addButtonTimeout) {
      clearTimeout(addButtonTimeout);
    }
    addButtonTimeout = setTimeout(function() {
      hideAddButtonNearStation();
    }, 1000); // 延迟1秒隐藏
  });
}

// 隐藏加号标记
function hideAddButtonNearStation() {
            if (previewLine) {
            map.removeLayer(previewLine);
            previewLine = null;
        }
        if (previewDistanceMarker) {
            map.removeLayer(previewDistanceMarker);
            previewDistanceMarker = null;
        }
  // 清除可能存在的隐藏定时器
  if (addButtonTimeout) {
    clearTimeout(addButtonTimeout);
    addButtonTimeout = null;
  }
  
  if (addButtonMarker) {
    map.removeLayer(addButtonMarker);
    addButtonMarker = null;
  }
}

// 在路线站点附近显示加号按钮
function showAddButtonNearRoutePoint(point, routeMarker) {
    // 如果已有加号标记，先移除
    if (addButtonMarker) {
        if (map.hasLayer(addButtonMarker)) {
            map.removeLayer(addButtonMarker);
        }
        addButtonMarker = null;
    }
    
    // 直接使用站点位置，通过iconAnchor调整显示位置
    const addButtonPosition = L.latLng(point.lat, point.lng);
    // 创建加号图标，使用与showAddButtonNearStation函数相同的图标样式
    const addButtonIcon = L.icon({
        iconUrl: '../plugins/img/img-right/add.png', // 使用与showAddButtonNearStation函数相同的图标路径
        iconSize: [24, 24],
        iconAnchor: [12, 36] // 调整锚点，使图标显示在站点上方24像素处
    });
    
    // 创建加号标记
    addButtonMarker = L.marker(addButtonPosition, {
        icon: addButtonIcon,
        zIndexOffset: 2000,
        interactive: true
    }).addTo(map);
    
    // 为加号标记添加点击事件
    addButtonMarker.on('click', function(e) {
        L.DomEvent.stopPropagation(e); // 阻止事件冒泡
        
        // 直接调用addToRoute函数，将当前路线站点添加到路线中
        addToRoute(point);
      
        // 隐藏加号标记
        hideAddButtonNearStation();
    });
    
    // 为加号标记添加鼠标悬停事件，防止鼠标移入加号时消失
    addButtonMarker.on('mouseover', function() {
        // 清除可能存在的隐藏定时器
        if (addButtonTimeout) {
            clearTimeout(addButtonTimeout);
            addButtonTimeout = null;
        }
    });
    
    // 为加号标记添加鼠标移出事件，延迟隐藏
    addButtonMarker.on('mouseout', function() {
        // 设置延迟隐藏，给用户时间点击
        if (addButtonTimeout) {
            clearTimeout(addButtonTimeout);
        }
        addButtonTimeout = setTimeout(function() {
            hideAddButtonNearStation();
        }, 1000); // 延迟1秒隐藏
    });
}

// 独立的鼠标移动事件处理函数
function handleMouseMoveLine(e) {
    // 至少已有一个点时才显示预览
    if (routePoints.length === 0) {
        // 确保恢复默认样式
        document.body.classList.remove('leaflet-drawing-preview');
        return;
    }

    // 添加预览模式类，强制统一光标样式
    document.body.classList.add('leaflet-drawing-preview');

    const lastPoint = routePoints[routePoints.length - 1];
    const mouseLatLng = e.latlng;

    // 彻底阻止事件传递，避免Leaflet内部处理
    L.DomEvent.stop(e.originalEvent); // 替代单纯的stopPropagation，更彻底

    // 创建或更新预览线
    if (!previewLine) {
        previewLine = L.polyline([lastPoint, mouseLatLng], {
            color: 'gray',
            dashArray: '5, 5',
            opacity: 0.7
        }).addTo(map);
    } else {
        previewLine.setLatLngs([lastPoint, mouseLatLng]);
    }

    // 计算并显示预览距离
    const distance = lastPoint.distanceTo(mouseLatLng);
    const midpoint = getMidpoint(lastPoint, mouseLatLng);
    const distanceText = `${distance.toFixed(2)}m`;

    // 创建或更新预览距离标记
    if (!previewDistanceMarker) {
        previewDistanceMarker = L.marker(midpoint, {
            icon: createDistanceIcon(distanceText),
            interactive: false
        }).addTo(map);
    } else {
        previewDistanceMarker.setLatLng(midpoint);
        previewDistanceMarker.setIcon(createDistanceIcon(distanceText));
    }
}



function handleMapClick(e) {
    // 检查是否刚刚完成拖动操作，如果是则忽略点击事件
    const currentTime = Date.now();
    if (isDragging || (currentTime - dragEndTime < DRAG_END_THRESHOLD)) {
        return;
    }
    
    if (!toggleStatus) return;

    const latLng = e.latlng;
    
    // 检查点击位置是否为特殊站点位置
    const isSpecialStationLocation = stationData.some(station => 
        Math.abs(station.latitude - latLng.lat) < 1e-6 && 
        Math.abs(station.longitude - latLng.lng) < 1e-6
    );
    // 如果是特殊站点位置，不直接连线，只显示属性框
    if (isSpecialStationLocation) {
        // 获取当前特殊站点的数据
        const station = stationData.find(s => 
            Math.abs(s.latitude - latLng.lat) < 1e-6 && 
            Math.abs(s.longitude - latLng.lng) < 1e-6
        );
        
        if (station) {
            // 确保station对象有所需的属性
            station.stationId = station.stationId || station.id;
            station.direction = station.direction || localStorage.getItem('globalDefaultDirection') || '0';
            station.speed = station.speed || localStorage.getItem('globalRouteSpeed') || '0.2';
            station.area = station.area || localStorage.getItem('globalObstacleLevel') || '1';
            station.action = station.action || localStorage.getItem('globalActionSelect') || '1';
            station.position = station.position || localStorage.getItem('globalNavigationMode') || '1';
            station.lanechange = station.lanechange || localStorage.getItem('globalLanechange') || '0';
            station.index = 0;
            
            // 显示站点的属性框
            showMultiplePointInfoBoxes(e, [station]);
        }
        
        return;
    }
    var customIcon = L.icon({
        iconUrl: '../plugins/img/原点.png',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
    });

    var marker = L.marker(latLng, { icon: customIcon, draggable: editStatus }).addTo(map);
    
    // 添加鼠标悬浮事件处理逻辑，显示加号标记
    marker.on('mouseover', function(e) {
        if (toggleStatus) {
            showAddButtonNearRoutePoint(e.latlng, this);
        }
    });
    
    // // 为新创建的标记添加tooltip，使其样式与复选框渲染路线的站点一致
    // marker.bindTooltip('自定义点', {
    //     permanent: true,
    //     direction: 'right',
    //     offset: [10, 0],
    //     className: 'station-label'
    // });
    
    // 在创建新标记的位置添加：
    marker.on('click', function (e) {
        e.originalEvent.stopPropagation();
        // 判断是否在新增模式下
        if (toggleStatus) {
            // 新增模式下的行为
            if (window.isAddingToExistingRoute && window.baseRouteName) {
                cocoMessage.success(`已添加到路线"${window.baseRouteName}"中`);
            } else {
                cocoMessage.success("已添加,1342");
            }
            const isNewPoint = !stationData.some(s =>
                Math.abs(s.latitude - e.latlng.lat) < 1e-6 &&
                Math.abs(s.longitude - e.latlng.lng) < 1e-6
            );
            // **新增：初始化 originalVisibility**
            marker.originalVisibility = {
                icon: marker.options.icon, // 保存原始图标
                tooltip: marker.options.tooltip // 保存原始提示
            };
            
            // 在新增模式下也显示属性框
            if (isNewPoint) {
                // 自定义点的属性框
                const station = {
                    stationName: '',
                    latitude: e.latlng.lat,
                    longitude: e.latlng.lng,
                    id: null,
                    stationId: null,
                    direction: localStorage.getItem('globalDefaultDirection') || '0',
                    speed: localStorage.getItem('globalRouteSpeed') || "0.2",
                    area:localStorage.getItem('globalObstacleLevel') || "1",
                    action: localStorage.getItem('globalActionSelect') || "0",
                    position: localStorage.getItem('globalNavigationMode') || "1",
                    stop: '0',
                    runmode: localStorage.getItem('globalTurnMode') || "0",
                    lanechange: localStorage.getItem('globalLanechange') || "0",
                    index: 0
                };
                
                showMultiplePointInfoBoxes(e, [station]);
            } else {
                // 已有站点的属性框
                const station = stationData.find(s =>
                    Math.abs(s.latitude - e.latlng.lat) < 1e-6 &&
                    Math.abs(s.longitude - e.latlng.lng) < 1e-6
                );
                if (station) {
                    station.index = 0;
                    // 确保station对象有所需的属性
                    station.stationId = station.stationId || station.id;
                    station.direction = station.direction || localStorage.getItem('globalDefaultDirection') || '0';
                    station.speed = station.speed || localStorage.getItem('globalRouteSpeed') || "0.2";
                    station.area = station.area || localStorage.getItem('globalObstacleLevel') || "1";
                    station.action = station.action || localStorage.getItem('globalActionSelect') || "0";
                    station.position = station.position || localStorage.getItem('globalNavigationMode') || "1";
                    station.runmode  = station.runmode ||localStorage.getItem('globalTurnMode') || "0";
                    station.lanechange = station.lanechange || localStorage.getItem('globalLanechange') || "0";
                    showMultiplePointInfoBoxes(e, [station]);
                }
            }
        } else {
            // 非新增模式下弹出属性框
            const isNewPoint = !stationData.some(s =>
                Math.abs(s.latitude - e.latlng.lat) < 1e-6 &&
                Math.abs(s.longitude - e.latlng.lng) < 1e-6
            );
            
            if (isNewPoint) {
                // 自定义点的属性框
                const station = {
                    stationName: 'new p',
                    latitude: e.latlng.lat,
                    longitude: e.latlng.lng,
                    id: null,
                    stationId: null,
                    direction: localStorage.getItem('globalDefaultDirection') || '0',
                    speed: localStorage.getItem('globalRouteSpeed') || "0.2",
                    area:localStorage.getItem('globalObstacleLevel') || "1",
                    action: localStorage.getItem('globalActionSelect') || "0",
                    position: localStorage.getItem('globalNavigationMode') || "1",
                    stop: '0',
                    runmode: localStorage.getItem('globalTurnMode') || "0",
                    lanechange: localStorage.getItem('globalLanechange') || "0",
                    index: 0
                };
                showMultiplePointInfoBoxes(e, [station]);
            } else {
                // 已有站点的属性框
                const station = stationData.find(s =>
                    Math.abs(s.latitude - e.latlng.lat) < 1e-6 &&
                    Math.abs(s.longitude - e.latlng.lng) < 1e-6
                );
                if (station) {
                    station.index = 0;
                    // 确保station对象有所需的属性
                    station.stationId = station.stationId || station.id;
                    station.direction = station.direction || localStorage.getItem('globalDefaultDirection') || '0';
                    station.speed = station.speed || localStorage.getItem('globalRouteSpeed') || "0.2";
                    station.area = station.area || localStorage.getItem('globalObstacleLevel') || "1";
                    station.action = station.action || localStorage.getItem('globalActionSelect') || "0";
                    station.position = station.position || localStorage.getItem('globalNavigationMode') || "1";
                    station.runmode  = station.runmode ||localStorage.getItem('globalTurnMode') || "0";
                    showMultiplePointInfoBoxes(e, [station]);
                }
            }
        }
    });
    if (editStatus) {
        // 如果处于编辑模式，则直接启用拖动功能并添加事件监听器
        marker.dragging.enable();
        marker.on('dragend', function (e) {
            // 找到对应的routePoint并更新它
            let index = routePoints.findIndex(point => point.lat === latLng.lat && point.lng === latLng.lng);
            if (index !== -1) {
                routePoints[index] = e.target.getLatLng();
                updatePolyline();
            }
        });
        editableMarkers.push(marker);
    }
    markers.push(marker);
    // 强制覆盖所有可能的光标样式（优先级拉满）
    const style = document.createElement('style');
    style.innerHTML = `
  /* 覆盖地图容器的所有光标状态 */
  .leaflet-drawing-preview .leaflet-container {
    cursor: pointer !important; /* 统一为箭头，可改为crosshair等 */
  }
  /* 覆盖Leaflet拖拽状态的光标 */
  .leaflet-drawing-preview .leaflet-grab,
  .leaflet-drawing-preview .leaflet-grabbing {
    cursor: pointer !important;
  }
  /* 覆盖地图控件的光标 */
  .leaflet-drawing-preview .leaflet-control {
    cursor: pointer !important;
  }
  /* 覆盖鼠标悬停在标记上的光标 */
 .leaflet-drawing-preview .leaflet-marker-icon {
   cursor: pointer !important;
 }
`;
    document.head.appendChild(style);

    addToRoute(latLng);
    // 确保在新建模式下editStatus为true，以允许拖动
    if (!editStatus && toggleStatus) {
        editStatus = true;
    }
    disableEditing()
    enableEditing();
}


const testPosition = () => {
    latitudeCurrent = parseFloat(localStorage.getItem("latitudeCurrent"));
    longitudeCurrent = parseFloat(localStorage.getItem("longitudeCurrent"));
}
setInterval(() => {
    testPosition()
}, 500)

function getCurrentCarPosi() {
    // 强制转换经纬度为数字
    latitudeCurrent = localStorage.getItem("latitudeCurrent")
    longitudeCurrent = localStorage.getItem("longitudeCurrent")
    if (longitudeCurrent == '未运行' || latitudeCurrent == '未运行' || latitudeCurrent == '0' || latitudeCurrent == "NaN") {
        cocoMessage.error("未找到机器位置数据");
    } else {
        map.setView([Number(latitudeCurrent), Number(longitudeCurrent)], 22);
    }
}


// 创建自定义距离显示图标
function createDistanceIcon(distanceText) {
    return L.divIcon({
        className: 'distance-label',
        html: `<div style="color:green; margin-top:20px; font-weight: bold; text-align: center; line-height: 20px;">${distanceText}</div>`,
        iconSize: [60, 24],
        iconAnchor: [30, 12]
    });
}
// 计算两点之间的中点
function getMidpoint(p1, p2) {
    // 使用更精确的方法计算路线中点
    // 考虑到地球曲率，使用球面中点计算
    const lat1 = p1.lat * Math.PI / 180;
    const lon1 = p1.lng * Math.PI / 180;
    const lat2 = p2.lat * Math.PI / 180;
    const lon2 = p2.lng * Math.PI / 180;
    
    const dLon = lon2 - lon1;
    
    const Bx = Math.cos(lat2) * Math.cos(dLon);
    const By = Math.cos(lat2) * Math.sin(dLon);
    
    const lat3 = Math.atan2(
        Math.sin(lat1) + Math.sin(lat2),
        Math.sqrt((Math.cos(lat1) + Bx) * (Math.cos(lat1) + Bx) + By * By)
    );
    
    const lon3 = lon1 + Math.atan2(By, Math.cos(lat1) + Bx);
    
    // 转换回度数
    return L.latLng(
        lat3 * 180 / Math.PI,
        lon3 * 180 / Math.PI
    );
}

// 扩展后的连线函数
function addToRoute(latLng) {
    routePoints.push(latLng);

    // 移除旧的连线
    if (currentPolyline) map.removeLayer(currentPolyline);

    // 添加新连线
    currentPolyline = L.polyline(routePoints, { color: 'red' }).addTo(map);
    
    // 注释掉调用recreateDistanceAndRectMarkers函数，避免创建原点标记
    // 使用统一的函数重新创建距离标记和可拖动矩形标记
    // recreateDistanceAndRectMarkers();
    
    // 不再重新创建所有点标记，因为标记已经在handleMapClick中创建
    // 避免重复标记的问题
}

// 重新创建所有点标记
function recreateAllPointMarkers() {
    // 清除现有的所有点标记，但保留位于特殊站点位置的标记
    const specialStationMarkers = [];
    markers.forEach(marker => {
        try {
            const markerPosition = marker.getLatLng();
            const isSpecialStationPosition = stationData.some(station => 
                Math.abs(station.latitude - markerPosition.lat) < 1e-6 && 
                Math.abs(station.longitude - markerPosition.lng) < 1e-6
            );
            
            if (isSpecialStationPosition) {
                // 保存特殊站点位置的标记
                specialStationMarkers.push(marker);
            } else {
                // 清除非特殊站点位置的标记
                marker.off(); // 移除所有事件监听器
                if (map.hasLayer(marker)) {
                    map.removeLayer(marker);
                }
            }
        } catch (e) {
            // 如果标记无效，直接清理
            marker.off(); // 移除所有事件监听器
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        }
    });
    
    // 重置数组，只保留特殊站点位置的标记
    markers = specialStationMarkers;
    
    // 清除可编辑标记，但保留位于特殊站点位置的标记
    const specialStationEditableMarkers = [];
    editableMarkers.forEach(marker => {
        try {
            const markerPosition = marker.getLatLng();
            const isSpecialStationPosition = stationData.some(station => 
                Math.abs(station.latitude - markerPosition.lat) < 1e-6 && 
                Math.abs(station.longitude - markerPosition.lng) < 1e-6
            );
            
            if (isSpecialStationPosition) {
                // 保存特殊站点位置的标记
                specialStationEditableMarkers.push(marker);
            } else {
                // 清除非特殊站点位置的标记
                marker.off(); // 移除所有事件监听器
                if (map.hasLayer(marker)) {
                    map.removeLayer(marker);
                }
            }
        } catch (e) {
            // 如果标记无效，直接清理
            marker.off(); // 移除所有事件监听器
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        }
    });
    
    // 重置数组，只保留特殊站点位置的标记
    editableMarkers = specialStationEditableMarkers;
    
    // 为routePoints中的每个点重新创建标记
    routePoints.forEach((point, index) => {
        // 检查该位置是否为特殊站点位置
        const isSpecialStationLocation = stationData.some(station => 
            Math.abs(station.latitude - point.lat) < 1e-6 && 
            Math.abs(station.longitude - point.lng) < 1e-6
        );
        
        // 如果该位置是特殊站点位置，跳过创建新标记，避免重复
        if (isSpecialStationLocation) {
            return;
        }
        
        // 查找对应的原始station数据，优先使用tempRouteStations中的更新数据
        let originalStation = null;
        if (window.tempRouteStations && window.tempRouteStations.length > 0) {
            const tempStation = window.tempRouteStations.find(station => 
                Math.abs(station.latitude - point.lat) < 1e-6 && 
                Math.abs(station.longitude - point.lng) < 1e-6
            );
            if (tempStation) {
                originalStation = {
                    latLng: point,
                    stationData: tempStation
                };
            }
        }
        
        // 如果window.tempRouteStations中没有找到，再检查window.originalRouteStations
        if (!originalStation && window.originalRouteStations) {
            originalStation = window.originalRouteStations.find(item => 
                Math.abs(item.latLng.lat - point.lat) < 1e-6 && 
                Math.abs(item.latLng.lng - point.lng) < 1e-6
            );
        }
        
        // 获取stop值，决定使用哪种图标
        let stopValue = "0"; // 默认值
        if (originalStation && originalStation.stationData) {
            stopValue = originalStation.stationData.stop || "0";
        }
        
        // 检查stop值，决定使用哪种图标
        let routeIcon;
        if (stopValue === "0" || stopValue === 0) {
            // 如果stop=0，使用circle-fill.svg图标
            routeIcon = L.icon({
                iconUrl: '../plugins/img/原点.png',
                iconSize: [22, 22],
                iconAnchor: [11, 11]
            });
        } else {
            // 否则使用任务进程.svg图标
            routeIcon = L.icon({
                iconUrl: '../plugins/img/任务进程.svg',
                iconSize: [25, 25],
                iconAnchor: [12.5, 25]
            });
        }
        
        const newPointMarker = L.marker(point, {
            icon: routeIcon,
            draggable: editStatus || toggleStatus,
            zIndexOffset: 1000
        }).addTo(map);
        
        // originalStation已在前面定义和查找，这里直接使用
        
        // 如果有原始数据，使用原始站点名称作为标签
        if (originalStation) {
            // newPointMarker.bindTooltip(originalStation.stationData.stationName, {
            //     permanent: true,
            //     direction: 'right',
            //     offset: [10, 0],
            //     className: 'station-label'
            // });
        } else {
            // 如果没有原始数据，添加默认标签，使样式与复选框渲染路线的站点一致
            // newPointMarker.bindTooltip('自定义点', {
            //     permanent: true,
            //     direction: 'right',
            //     offset: [10, 0],
            //     className: 'station-label'
            // });
        }
        
        // 添加鼠标悬浮事件处理逻辑，显示加号标记
        newPointMarker.on('mouseover', function (e) {
            if (toggleStatus) {
                showAddButtonNearRoutePoint(e.latlng, this);
            }
        });
        
        // 添加事件处理逻辑
        newPointMarker.on('click', function (e) {
            e.originalEvent.stopPropagation();
            
            if (toggleStatus) {
                cocoMessage.success("已添加1745");
                // 优先使用tempRouteStations中的更新数据
            let station = null;
            if (window.tempRouteStations && window.tempRouteStations.length > 0) {
                const tempStation = window.tempRouteStations.find(station => 
                        Math.abs(station.latitude - e.latlng.lat) < 1e-6 && 
                        Math.abs(station.longitude - e.latlng.lng) < 1e-6
                    );
                    if (tempStation) {
                        station = {
                            ...tempStation,
                            index: 0
                        };
                    }
            }
            
            // 如果window.tempRouteStations中没有找到，再使用window.originalRouteStations中的数据
                if (!station && window.originalRouteStations) {
                    const originalStation = window.originalRouteStations.find(item => 
                        Math.abs(item.latLng.lat - e.latlng.lat) < 1e-6 && 
                        Math.abs(item.latLng.lng - e.latlng.lng) < 1e-6
                    );
                    if (originalStation) {
                        station = {
                            ...originalStation.stationData,
                            index: 0
                        };
                    }
                }
                
                // 如果没有找到原始数据，则从stationData中查找
                if (!station) {
                    const existingStation = stationData.find(s =>
                        Math.abs(s.latitude - e.latlng.lat) < 1e-6 &&
                        Math.abs(s.longitude - e.latlng.lng) < 1e-6
                    );
                    if (existingStation) {
                        station = {
                            ...existingStation,
                            index: 0
                        };
                    }
                }
                
                // 如果还是没有找到，创建新的自定义点
                if (!station) {
                    station = {
                        stationName: '自定义点',
                        latitude: e.latlng.lat,
                        longitude: e.latlng.lng,
                        id: null,
                        stationId: null,
                        direction: localStorage.getItem('globalDefaultDirection') || '0',
                        speed: localStorage.getItem('globalRouteSpeed') || "0.2",
                        area:localStorage.getItem('globalObstacleLevel') || "1",
                        action: localStorage.getItem('globalActionSelect') || "0",
                        position: localStorage.getItem('globalNavigationMode') || "1",
                        stop: '0',
                        runmode: localStorage.getItem('globalTurnMode') || "0",
                        index: 0
                    };
                }
                showMultiplePointInfoBoxes(e, [station]);
            } else {
                // 优先使用tempRouteStations中的更新数据
            let station = null;
            
            if (window.tempRouteStations && window.tempRouteStations.length > 0) {
                const tempStation = window.tempRouteStations.find(station => 
                        Math.abs(station.latitude - e.latlng.lat) < 1e-6 && 
                        Math.abs(station.longitude - e.latlng.lng) < 1e-6
                    );
                    if (tempStation) {
                        station = {
                            ...tempStation,
                            index: 0
                        };
                    }
            }
            
            // 如果window.tempRouteStations中没有找到，再使用window.originalRouteStations中的数据
                if (!station && window.originalRouteStations) {
                    const originalStation = window.originalRouteStations.find(item => 
                        Math.abs(item.latLng.lat - e.latlng.lat) < 1e-6 && 
                        Math.abs(item.latLng.lng - e.latlng.lng) < 1e-6
                    );
                    if (originalStation) {
                        station = {
                            ...originalStation.stationData,
                            index: 0
                        };
                    }
                }
                
                // 如果没有找到原始数据，则从stationData中查找
                if (!station) {
                    const existingStation = stationData.find(s =>
                        Math.abs(s.latitude - e.latlng.lat) < 1e-6 &&
                        Math.abs(s.longitude - e.latlng.lng) < 1e-6
                    );
                    if (existingStation) {
                        station = {
                            ...existingStation,
                            index: 0
                        };
                    }
                }
                
                // 如果还是没有找到，创建新的自定义点
                if (!station) {
                    station = {
                        stationName: '自定义点',
                        latitude: e.latlng.lat,
                        longitude: e.latlng.lng,
                        id: null,
                        stationId: null,
                        direction: localStorage.getItem('globalDefaultDirection') || '0',
                        speed: localStorage.getItem('globalRouteSpeed') || "0.2",
                        area:localStorage.getItem('globalObstacleLevel') || "1",
                        action: localStorage.getItem('globalActionSelect') || "0",
                        position: localStorage.getItem('globalNavigationMode') || "1",
                        stop: '0',
                        runmode: localStorage.getItem('globalTurnMode') || "0",
                        index: 0
                    };
                }
                showMultiplePointInfoBoxes(e, [station]);
            }
        });
        
        if (editStatus || toggleStatus) {
            // 保存原始位置和数据以备拖动操作使用
            newPointMarker.originalData = {
                position: point,
                id: stationData.find(item =>
                    item.latitude === point.lat &&
                    item.longitude === point.lng
                )
            };
            
            newPointMarker.dragging.enable();
            newPointMarker.on('dragend', function (e) {
               
                const updatedPosition = e.target.getLatLng();
                const oldPosition = this.originalData.position;
                cocoMessage.success('拖动成功');
                // 清除预览线路和距离标记
                // if (previewLine) { 
                //     map.removeLayer(previewLine); 
                //     previewLine = null; 
                // }
                // if (previewDistanceMarker) { 
                //     map.removeLayer(previewDistanceMarker); 
                //     previewDistanceMarker = null; 
                // }
                
                // 更新routePoints中的对应点
                let index = routePoints.findIndex(p => 
                    p.lat === oldPosition.lat && 
                    p.lng === oldPosition.lng
                );
                if (index !== -1) {
                    routePoints[index] = updatedPosition;
                    updatePolyline();
                    // 更新原始数据位置
                    this.originalData.position = updatedPosition;
                    
                    // 更新tempRouteStations中的对应数据（关键修复）
                    if (window.tempRouteStations && window.tempRouteStations.length > 0) {
                        const tempStationIndex = window.tempRouteStations.findIndex(s => 
                            Math.abs(s.latitude - oldPosition.lat) < 1e-6 && 
                            Math.abs(s.longitude - oldPosition.lng) < 1e-6
                        );
                        
                        if (tempStationIndex !== -1) {
                            // 更新tempRouteStations中的经纬度信息
                            window.tempRouteStations[tempStationIndex].latitude = updatedPosition.lat;
                            window.tempRouteStations[tempStationIndex].longitude = updatedPosition.lng;
                        }
                    }
                    
                    // 更新对应的原始station数据中的坐标
                    if (window.originalRouteStations) {
                        const originalStation = window.originalRouteStations.find(item => 
                            Math.abs(item.latLng.lat - oldPosition.lat) < 1e-6 && 
                            Math.abs(item.latLng.lng - oldPosition.lng) < 1e-6
                        );
                        if (originalStation) {
                            originalStation.latLng = updatedPosition;
                            originalStation.stationData.latitude = updatedPosition.lat;
                            originalStation.stationData.longitude = updatedPosition.lng;
                        }
                    }
                    
                    // 更新标签位置和内容
                    if (e.target.getTooltip()) {
                        const tooltip = e.target.getTooltip();
                        // 如果有原始站点数据，使用原始站点名称
                        if (window.originalRouteStations) {
                            const originalStation = window.originalRouteStations.find(item => 
                                Math.abs(item.latLng.lat - updatedPosition.lat) < 1e-6 && 
                                Math.abs(item.latLng.lng - updatedPosition.lng) < 1e-6
                            );
                            if (originalStation) {
                                e.target.setTooltipContent(originalStation.stationData.stationName);
                            }
                        }
                        // 强制更新标签位置
                        e.target.unbindTooltip();
                        e.target.bindTooltip(tooltip.getContent(), {
                            permanent: true,
                            direction: 'right',
                            offset: [10, 0],
                            className: 'station-label'
                        });
                    }
                }
            });
            editableMarkers.push(newPointMarker);
        }
        
        markers.push(newPointMarker);
    });
}

// 重新创建距离标记和可拖动矩形标记
function recreateDistanceAndRectMarkers() {
    // 清除现有的距离标记和可拖动矩形标记
    distanceMarkers.forEach(marker => {
        try {
            marker.off(); // 移除所有事件监听器
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        } catch (e) {
            console.warn('清除距离标记时出错:', e);
        }
    });
    distanceMarkers = [];
    // 清除可拖动矩形标记，但保留位于特殊站点位置的标记
    const specialStationMarkers = [];
    draggableRectMarkers.forEach(marker => {
        // 检查该标记是否位于特殊站点位置
        const markerPosition = marker.getLatLng();
        const isSpecialStationPosition = stationData.some(station => 
            Math.abs(station.latitude - markerPosition.lat) < 1e-6 && 
            Math.abs(station.longitude - markerPosition.lng) < 1e-6
        );
        
        if (isSpecialStationPosition) {
            // 保存特殊站点位置的标记
            specialStationMarkers.push(marker);
        } else {
            // 清除非特殊站点位置的标记
            marker.off(); // 移除所有事件监听器
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        }
    });
    
    // 重置数组，只保留特殊站点位置的标记
    draggableRectMarkers = specialStationMarkers;

    // 当有至少两个点时，为每一段线段添加距离标记和可拖动矩形标记
    if (routePoints.length >= 2) {
        for (let i = 0; i < routePoints.length - 1; i++) {
            const p1 = routePoints[i];
            const p2 = routePoints[i + 1];

            const distance = p1.distanceTo(p2);

            // 计算线段中点
            const midpoint = getMidpoint(p1, p2);

            // 创建并添加距离标记
            const distanceText = `${distance.toFixed(2)}m`;
            const distanceMarker = L.marker(midpoint, {
                icon: createDistanceIcon(distanceText),
                interactive: false, // 标记不可交互，避免干扰地图操作
                zIndexOffset: 1000 // 提高层级，确保距离标签显示在顶部
            }).addTo(map);
            distanceMarkers.push(distanceMarker);
            
            // 检查中点是否为特殊站点位置
            const isSpecialStationMidpoint = stationData.some(station => 
                Math.abs(station.latitude - midpoint.lat) < 1e-6 && 
                Math.abs(station.longitude - midpoint.lng) < 1e-6
            );
            
            // 如果不是特殊站点位置，才创建新的矩形标记
            if (!isSpecialStationMidpoint) {
                const rectMarker = createDraggableRectMarker(i, midpoint);
                draggableRectMarkers.push(rectMarker);
            } else {
                // 如果是特殊站点位置，创建一个虚拟标记占位但不显示在地图上
                const dummyMarker = {
                    segmentIndex: i,
                    isDummy: true,
                    getLatLng: () => midpoint,
                    off: () => {},
                    on: () => {}
                };
                draggableRectMarkers.push(dummyMarker);
            }
        }
    }
}

// 创建可拖动的空心矩形标记
function createDraggableRectMarker(segmentIndex, position) {
    // 创建空心矩形图标
    const rectIcon = L.divIcon({
        className: 'draggable-rect-marker',
        html: '<div style="width: 20px; height: 20px; border: 2px solid rgb(145, 134, 134); background-color: transparent; cursor: move; border-radius: 2px;"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });
    
    const marker = L.marker(position, {
        icon: rectIcon,
        draggable: true,
        zIndexOffset: 1000
    }).addTo(map);
    
    // 存储线段索引信息
    marker.segmentIndex = segmentIndex;
    marker.originalPosition = position;
    
    // 绑定拖动事件
    marker.on('dragstart', function(e) {
        // 设置拖动状态标志
        isDragging = true;
    });
    
    marker.on('drag', function(e) {
        // 拖动过程中可以添加视觉反馈
    });
    marker.on('dragend', function(e) {
        const newPosition = e.target.getLatLng();
        
        // 清除拖动状态标志并记录拖动结束时间
        isDragging = false;
        dragEndTime = Date.now();
        
        // 检查该标记的原始位置是否为特殊站点位置
        const originalPosition = marker.originalPosition;
        const isSpecialStationPosition = stationData.some(station => 
            Math.abs(station.latitude - originalPosition.lat) < 1e-6 && 
            Math.abs(station.longitude - originalPosition.lng) < 1e-6
        );
        // 只移除非特殊站点位置的标记
        if (!isSpecialStationPosition) {
            // 移除当前矩形标记的所有事件监听器和图层
            marker.off();
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
            
            // 从draggableRectMarkers数组中移除当前标记
            const index = draggableRectMarkers.indexOf(marker);
            if (index > -1) {
                draggableRectMarkers.splice(index, 1);
            }
        } else {
            // 如果是特殊站点位置的标记，将其移回原始位置
            marker.setLatLng(originalPosition);
        }
        
        // 在插入新点之前，先清除该位置的所有旧标记和标签，避免重复标签
        // 包括特殊站点标记也要清除，确保拖动时清除所有有id的站点标签
        clearAllMarkersAtPosition(newPosition);
        
        // 清除当前路线的所有标签
        clearCurrentRouteLabels();
        
        // 在新位置插入点
        insertPointAtPosition(marker.segmentIndex, newPosition);
    });
    
    return marker;
}

// 清除指定位置的所有标记和标签
function clearMarkersAtPosition(position) {
    // 清除markers数组中该位置的所有标记
    const markersToRemove = markers.filter(marker => {
        try {
            const markerPos = marker.getLatLng();
            return Math.abs(markerPos.lat - position.lat) < 1e-6 && 
                   Math.abs(markerPos.lng - position.lng) < 1e-6;
        } catch (e) {
            // 如果标记无效，也需要清理
            return true;
        }
    });
    
    markersToRemove.forEach(marker => {
        // 先关闭并清除标签（tooltip）
        if (marker.getTooltip()) {
            marker.closeTooltip();
            marker.unbindTooltip();
            // 确保tooltip选项也被清除
            if (marker.options.tooltip) {
                marker.options.tooltip = null;
            }
        }
        
        // 从markers数组中移除
        const index = markers.indexOf(marker);
        if (index > -1) {
            markers.splice(index, 1);
        }
        
        // 从editableMarkers数组中移除
        const editableIndex = editableMarkers.indexOf(marker);
        if (editableIndex > -1) {
            editableMarkers.splice(editableIndex, 1);
        }
        
        // 从地图上移除并清理事件监听器
        marker.off();
        if (map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
    });
    
    // 清除addedPointsHistory中该位置的记录
    const historyToRemove = addedPointsHistory.filter(item => {
        return Math.abs(item.position.lat - position.lat) < 1e-6 && 
               Math.abs(item.position.lng - position.lng) < 1e-6;
    });
    
    historyToRemove.forEach(item => {
        const index = addedPointsHistory.indexOf(item);
        if (index > -1) {
            addedPointsHistory.splice(index, 1);
        }
    });
    
    // 额外检查并清除可能残留的tooltip元素
    const tooltipElements = document.querySelectorAll('.leaflet-tooltip');
    tooltipElements.forEach(tooltip => {
        // 检查tooltip是否与该位置相关
        const tooltipText = tooltip.textContent || tooltip.innerText;
        const relatedStation = stationData.find(station => 
            Math.abs(station.latitude - position.lat) < 1e-6 && 
            Math.abs(station.longitude - position.lng) < 1e-6
        );
        
        if (relatedStation && tooltipText === relatedStation.stationName) {
            tooltip.remove();
        }
    });
}

// 清除指定位置的所有标记（包括特殊站点标记）
function clearAllMarkersAtPosition(position) {
    // 清除markers数组中该位置的所有标记，包括特殊站点标记
    const markersToRemove = markers.filter(marker => {
        try {
            const markerPos = marker.getLatLng();
            return Math.abs(markerPos.lat - position.lat) < 1e-6 && 
                   Math.abs(markerPos.lng - position.lng) < 1e-6;
        } catch (e) {
            // 如果标记无效，也需要清理
            return true;
        }
    });
    
    markersToRemove.forEach(marker => {
        // 先关闭并清除标签（tooltip）
        if (marker.getTooltip()) {
            marker.closeTooltip();
            marker.unbindTooltip();
            // 确保tooltip选项也被清除
            if (marker.options.tooltip) {
                marker.options.tooltip = null;
            }
        }
        
        // 从markers数组中移除
        const index = markers.indexOf(marker);
        if (index > -1) {
            markers.splice(index, 1);
        }
        
        // 从editableMarkers数组中移除
        const editableIndex = editableMarkers.indexOf(marker);
        if (editableIndex > -1) {
            editableMarkers.splice(editableIndex, 1);
        }
        
        // 从地图上移除并清理事件监听器
        marker.off();
        if (map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
    });
    
    // 清除addedPointsHistory中该位置的记录
    const historyToRemove = addedPointsHistory.filter(item => {
        return Math.abs(item.position.lat - position.lat) < 1e-6 && 
               Math.abs(item.position.lng - position.lng) < 1e-6;
    });
    
    historyToRemove.forEach(item => {
        const index = addedPointsHistory.indexOf(item);
        if (index > -1) {
            addedPointsHistory.splice(index, 1);
        }
    });
    
    // 清除draggableRectMarkers中该位置的记录
    const rectMarkersToRemove = draggableRectMarkers.filter(marker => {
        try {
            if (!marker.getLatLng) return false; // 跳过虚拟标记
            const markerPos = marker.getLatLng();
            return Math.abs(markerPos.lat - position.lat) < 1e-6 && 
                   Math.abs(markerPos.lng - position.lng) < 1e-6;
        } catch (e) {
            // 如果标记无效，也需要清理
            return true;
        }
    });
    
    rectMarkersToRemove.forEach(marker => {
        // 从draggableRectMarkers数组中移除
        const index = draggableRectMarkers.indexOf(marker);
        if (index > -1) {
            draggableRectMarkers.splice(index, 1);
        }
        
        // 从地图上移除并清理事件监听器
        marker.off();
        if (map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
    });
    
    // 额外检查并清除可能残留的tooltip元素
    const tooltipElements = document.querySelectorAll('.leaflet-tooltip');
    tooltipElements.forEach(tooltip => {
        // 检查tooltip是否与该位置相关
        const tooltipText = tooltip.textContent || tooltip.innerText;
        const relatedStation = stationData.find(station => 
            Math.abs(station.latitude - position.lat) < 1e-6 && 
            Math.abs(station.longitude - position.lng) < 1e-6
        );
        
        if (relatedStation && tooltipText === relatedStation.stationName) {
            tooltip.remove();
        }
    });
    
    // 清除所有可能残留的DOM元素
    const markerElements = document.querySelectorAll('.leaflet-marker-icon, .leaflet-shadow');
    markerElements.forEach(element => {
        // 检查元素是否与该位置相关
        const style = window.getComputedStyle(element);
        const transform = style.transform;
        if (transform && transform !== 'none') {
            // 尝试从transform中提取位置信息
            const values = transform.split('(')[1].split(')')[0].split(',');
            const x = parseFloat(values[4]);
            const y = parseFloat(values[5]);
            
            // 将屏幕坐标转换为地理坐标
            const containerPoint = L.point(x, y);
            const latlng = map.containerPointToLatLng(containerPoint);
            
            // 检查是否与目标位置匹配
            if (Math.abs(latlng.lat - position.lat) < 1e-6 && 
                Math.abs(latlng.lng - position.lng) < 1e-6) {
                element.remove();
            }
        }
    });
}

// 清除当前路线的所有标签
function clearCurrentRouteLabels() {
    
    // 遍历当前路线的所有标记点
    markers.forEach(marker => {
        // 检查标记是否在当前路线上
        const markerPos = marker.getLatLng();
        const isOnRoute = routePoints.some(point => 
            Math.abs(point.lat - markerPos.lat) < 1e-6 && 
            Math.abs(point.lng - markerPos.lng) < 1e-6
        );
        
        if (isOnRoute) {
            // 清除标签（tooltip）
            if (marker.getTooltip()) {
                marker.closeTooltip();
                marker.unbindTooltip();
                // 确保tooltip选项也被清除
                if (marker.options.tooltip) {
                    marker.options.tooltip = null;
                }
            }
        }
    });
    
    // 额外清除所有可能残留的tooltip元素
    const tooltipElements = document.querySelectorAll('.leaflet-tooltip');
    tooltipElements.forEach(tooltip => {
        // 检查tooltip是否与当前路线上的站点相关
        const tooltipText = tooltip.textContent || tooltip.innerText;
        const isRouteStation = routePoints.some(point => {
            const station = stationData.find(s => 
                Math.abs(s.latitude - point.lat) < 1e-6 && 
                Math.abs(s.longitude - point.lng) < 1e-6
            );
            return station && station.stationName === tooltipText;
        });
        
        if (isRouteStation) {
            tooltip.remove();
        }
    });
    
    // 额外清除所有可能残留的tooltip元素，不管是否与路线相关
    // 这是为了确保没有任何残留的标签
    const allTooltipElements = document.querySelectorAll('.leaflet-tooltip.station-label');
    allTooltipElements.forEach(tooltip => {
        tooltip.remove();
    });
}

// 重新渲染当前路线中有站点ID的站点标签
function renderCurrentRouteStationLabels() {
    
    // 检查是否有选中的路线
    const routeSelect = document.getElementById('routeSelect');
    const selectedRouteId = routeSelect ? routeSelect.value : null;
    
    if (!selectedRouteId) {
        cocoMessage.warning('请先选择一条路线');
        return;
    }
    
    // 找到选中的路线
    const selectedRoute = alldata.find(r => r.routeId == selectedRouteId);
    if (!selectedRoute || !selectedRoute.stations) {
        cocoMessage.warning('选中的路线没有站点数据');
        return;
    }
    
    // 遍历当前路线的所有标记点
    markers.forEach(marker => {
        // 检查标记是否在当前路线上
        const markerPos = marker.getLatLng();
        const isOnRoute = routePoints.some(point => 
            Math.abs(point.lat - markerPos.lat) < 1e-6 && 
            Math.abs(point.lng - markerPos.lng) < 1e-6
        );
        
        if (isOnRoute) {
            // 查找对应的站点数据
            const station = selectedRoute.stations.find(s => 
                Math.abs(s.latitude - markerPos.lat) < 1e-6 && 
                Math.abs(s.longitude - markerPos.lng) < 1e-6
            );
            
            if (station && (station.stationId || station.id)) {
                // 如果有站点ID，重新绑定标签
                const labelText = station.stationName || `站点${station.stationId || station.id}`;
                
                // 清除现有标签
                if (marker.getTooltip()) {
                    marker.closeTooltip();
                    marker.unbindTooltip();
                }
                
                // 重新绑定标签
                marker.bindTooltip(labelText, {
                    permanent: true,
                    direction: 'right',
                    offset: [10, 0],
                    className: 'station-label'
                });
                
            }
        }
    });
    
    cocoMessage.success('已重新渲染当前路线中有站点ID的站点标签');
    
}

// 在指定位置插入新点
function insertPointAtPosition(segmentIndex, position) {
    // 在routePoints数组的指定位置插入新点
    const insertIndex = segmentIndex + 1;
    routePoints.splice(insertIndex, 0, position);
    
    // 检查是否已经存在相同位置的标记，避免重复创建
    const existingMarker = markers.find(marker => {
        try {
            const markerPos = marker.getLatLng();
            return Math.abs(markerPos.lat - position.lat) < 1e-6 && 
                   Math.abs(markerPos.lng - position.lng) < 1e-6;
        } catch (e) {
            // 如果标记无效，需要清理
            return false;
        }
    });
    
    // 检查该位置是否为特殊站点（从station/querynew/2获取的站点）
    const isSpecialStationLocation = stationData.some(station => 
        Math.abs(station.latitude - position.lat) < 1e-6 && 
        Math.abs(station.longitude - position.lng) < 1e-6
    );
    
    // 如果已存在相同位置的标记，先彻底清除它及其相关数据
    if (existingMarker) {
        // 清除该位置的所有标记和标签，确保完全清理
        clearAllMarkersAtPosition(position);
        
        // 从地图上移除并清理事件监听器
        existingMarker.off();
        if (map.hasLayer(existingMarker)) {
            map.removeLayer(existingMarker);
        }
        
        // 从markers数组中移除
        const markerIndex = markers.indexOf(existingMarker);
        if (markerIndex > -1) {
            markers.splice(markerIndex, 1);
        }
        
        // 从editableMarkers数组中移除
        const editableIndex = editableMarkers.indexOf(existingMarker);
        if (editableIndex > -1) {
            editableMarkers.splice(editableIndex, 1);
        }
    }
    
    // 如果是特殊站点位置，需要重新创建特殊站点标记
    if (isSpecialStationLocation) {
        const specialStation = stationData.find(station => 
            Math.abs(station.latitude - position.lat) < 1e-6 && 
            Math.abs(station.longitude - position.lng) < 1e-6
        );
        
        if (specialStation) {
            // 在创建新标记之前，再次确保该位置的所有旧标记和标签都被清除
            // 包括特殊站点标记也要彻底清除
            clearAllMarkersAtPosition(position);
            
            // 创建特殊站点标记
            const routeIcon = L.icon({
                iconUrl: '../plugins/img/坐标.png',
                iconSize: [22, 22],
                iconAnchor: [11, 11]
            });
            
            const specialMarker = L.marker(position, {
                icon: routeIcon,
                // draggable: editStatus, // 暂时禁用特殊点拖动功能
                draggable: false,
                zIndexOffset: 1000
            }).addTo(map);
            
            // 绑定特殊站点名称作为标签
            specialMarker.bindTooltip(specialStation.stationName, {
                permanent: true,
                direction: 'right',
                offset: [20, 0],
                className: 'station-label'
            });
            
            // 添加事件处理逻辑
            specialMarker.on('click', function (e) {
                e.originalEvent.stopPropagation();
                const station = {...specialStation, index: 0};
                showMultiplePointInfoBoxes(e, [station]);
            });
            
            // 添加到markers数组
            markers.push(specialMarker);
            
            if (editStatus) {
                // 特殊点不再添加到editableMarkers数组，防止拖动
                // editableMarkers.push(specialMarker);
                // 保存原始位置和数据
                specialMarker.originalData = {
                    position: position,
                    id: specialStation
                };
                
                // 特殊点不再启用拖动功能
                /*
                specialMarker.dragging.enable();
                specialMarker.on('dragend', function (e) {
                    const updatedPosition = e.target.getLatLng();
                    // 更新routePoints中的对应点
                    let index = routePoints.findIndex(point => 
                        point.lat === this.originalData.position.lat && 
                        point.lng === this.originalData.position.lng
                    );
                    if (index !== -1) {
                        routePoints[index] = updatedPosition;
                        updatePolyline();
                        // 更新原始数据位置
                        this.originalData.position = updatedPosition;
                        
                        // 更新对应的原始station数据中的坐标
                        specialStation.latitude = updatedPosition.lat;
                        specialStation.longitude = updatedPosition.lng;
                        
                        // 更新标签位置和内容
                        if (e.target.getTooltip()) {
                            e.target.unbindTooltip();
                            e.target.bindTooltip(specialStation.stationName, {
                                permanent: true,
                                direction: 'right',
                                offset: [10, 0],
                                className: 'station-label'
                            });
                        }
                    }
                });
                */
            }
            
            updatePolyline();
            return;
        }
    }
    
    // 在拖动结束的位置添加一个与新增路线相同的图标
    const routeIcon = L.icon({
        iconUrl: '../plugins/img/原点.png',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
    });
    
    // 如果是特殊站点位置，禁用拖动功能
    const newPointMarker = L.marker(position, {
        icon: routeIcon,
        draggable: isSpecialStationLocation ? false : editStatus,
        zIndexOffset: 1000
    }).addTo(map);
    
    // 查找对应的原始station数据
    let originalStation = null;
    if (window.originalRouteStations) {
        originalStation = window.originalRouteStations.find(item => 
            Math.abs(item.latLng.lat - position.lat) < 1e-6 && 
            Math.abs(item.latLng.lng - position.lng) < 1e-6
        );
    }
    
    // 如果有原始数据，使用原始站点名称作为标签
    if (originalStation) {
        newPointMarker.bindTooltip(originalStation.stationData.stationName, {
            permanent: true,
            direction: 'right',
            offset: [20, 0],
            className: 'station-label'
        });
    }
    
    // 添加与手动点击新增点相同的事件处理逻辑
    newPointMarker.on('click', function (e) {
        e.originalEvent.stopPropagation();
        
        // 判断是否在新增模式下
        if (toggleStatus) {
            // 新增模式下的行为
            cocoMessage.success("已添加");
            const isNewPoint = !stationData.some(s =>
                Math.abs(s.latitude - e.latlng.lat) < 1e-6 &&
                Math.abs(s.longitude - e.latlng.lng) < 1e-6
            );
            // **新增：初始化 originalVisibility**
            newPointMarker.originalVisibility = {
                icon: newPointMarker.options.icon, // 保存原始图标
                tooltip: newPointMarker.options.tooltip // 保存原始提示
            };
            
            // 在新增模式下也显示属性框
            if (isNewPoint) {
                // 自定义点的属性框
                const station = {
                    stationName: '自定义点',
                    latitude: e.latlng.lat,
                    longitude: e.latlng.lng,
                    id: null,
                    stationId: null,
                    direction: '',
                    speed: '',
                    area: '1',
                    action: '1',
                    position: '',
                    index: 0
                };
                showMultiplePointInfoBoxes(e, [station]);
            } else {
                // 已有站点的属性框
                const station = stationData.find(s =>
                    Math.abs(s.latitude - e.latlng.lat) < 1e-6 &&
                    Math.abs(s.longitude - e.latlng.lng) < 1e-6
                );
                if (station) {
                    station.index = 0;
                    // 确保station对象有所需的属性
                    station.stationId = station.stationId || station.id;
                    station.direction = station.direction || '';
                    station.speed = station.speed || '';
                    station.area = station.area || '1';
                    station.action = station.action || '1';
                    showMultiplePointInfoBoxes(e, [station]);
                }
            }
        } else {
            // 非新增模式下弹出属性框
            const isNewPoint = !stationData.some(s =>
                Math.abs(s.latitude - e.latlng.lat) < 1e-6 &&
                Math.abs(s.longitude - e.latlng.lng) < 1e-6
            );
            
            if (isNewPoint) {
                // 自定义点的属性框
                const station = {
                    stationName: '自定义点',
                    latitude: e.latlng.lat,
                    longitude: e.latlng.lng,
                    id: null,
                    stationId: null,
                    direction: '',
                    speed: '',
                    area: '1',
                    action: '1',
                    index: 0
                };
                showMultiplePointInfoBoxes(e, [station]);
            } else {
                // 已有站点的属性框
                const station = stationData.find(s =>
                    Math.abs(s.latitude - e.latlng.lat) < 1e-6 &&
                    Math.abs(s.longitude - e.latlng.lng) < 1e-6
                );
                if (station) {
                    station.index = 0;
                    // 确保station对象有所需的属性
                    station.stationId = station.stationId || station.id;
                    station.direction = station.direction || '';
                    station.speed = station.speed || '';
                    station.area = station.area || '1';
                    station.action = station.action || '1';
                    showMultiplePointInfoBoxes(e, [station]);
                }
            }
        }
    });
    
    if (editStatus && !isSpecialStationLocation) {
        // 保存原始位置和数据以备拖动操作使用
        newPointMarker.originalData = {
            position: position,
            id: stationData.find(item =>
                item.latitude === position.lat &&
                item.longitude === position.lng
            )
        };
        
        // 如果处于编辑模式且不是特殊站点位置，则直接启用拖动功能并添加事件监听器
        newPointMarker.dragging.enable();
        newPointMarker.on('dragstart', function(e) {
            // 设置拖动状态标志
            isDragging = true;
        });
        
        newPointMarker.on('dragend', function (e) {
            cocoMessage.success('拖动成功2');
            const updatedPosition = e.target.getLatLng();
            
            // 清除拖动状态标志并记录拖动结束时间
            isDragging = false;
            dragEndTime = Date.now();
            
            // 更新routePoints中的对应点
            let index = routePoints.findIndex(point => 
                point.lat === this.originalData.position.lat && 
                point.lng === this.originalData.position.lng
            );
            if (index !== -1) {
                routePoints[index] = updatedPosition;
                updatePolyline();
                // 更新原始数据位置
                this.originalData.position = updatedPosition;
                
                // 更新对应的原始station数据中的坐标
                if (window.originalRouteStations) {
                    const originalStation = window.originalRouteStations.find(item => 
                        Math.abs(item.latLng.lat - routePoints[index].lat) < 1e-6 && 
                        Math.abs(item.latLng.lng - routePoints[index].lng) < 1e-6
                    );
                    if (originalStation) {
                        originalStation.latLng = updatedPosition;
                        originalStation.stationData.latitude = updatedPosition.lat;
                        originalStation.stationData.longitude = updatedPosition.lng;
                    }
                }
                
                // 更新标签位置和内容
                if (e.target.getTooltip()) {
                    const tooltip = e.target.getTooltip();
                    // 如果有原始站点数据，使用原始站点名称
                    if (window.originalRouteStations) {
                        const originalStation = window.originalRouteStations.find(item => 
                            Math.abs(item.latLng.lat - updatedPosition.lat) < 1e-6 && 
                            Math.abs(item.latLng.lng - updatedPosition.lng) < 1e-6
                        );
                        if (originalStation) {
                            e.target.setTooltipContent(originalStation.stationData.stationName);
                        }
                    }
                    // 强制更新标签位置
                    e.target.unbindTooltip();
                    e.target.bindTooltip(tooltip.getContent(), {
                        permanent: true,
                        direction: 'right',
                        offset: [10, 0],
                        className: 'station-label'
                    });
                }
            }
        });
        editableMarkers.push(newPointMarker);
    } else {
        newPointMarker.on('click', function (e) {
            e.originalEvent.stopPropagation();
            if (toggleStatus) {
                addToRoute(this.getLatLng());
            } else {
                // 结束新增后，点击标记时检查重叠点
                const currentLatLng = e.target.getLatLng();
                
                // 检查routePoints中是否有重叠的点
                const overlappingRoutePoints = [];
                routePoints.forEach((point, index) => {
                    if (Math.abs(point.lat - currentLatLng.lat) < 1e-6 && 
                        Math.abs(point.lng - currentLatLng.lng) < 1e-6) {
                        overlappingRoutePoints.push({
                            latitude: point.lat,
                            longitude: point.lng,
                            stationName: `路线点${index + 1}`,
                            direction: '',
                            speed: '',
                            id: `route_point_${index}`,
                            stationId: `route_point_${index}`,
                            index: index,
                            isRoutePoint: true // 标记为路线点
                        });
                    }
                });
                
                // 检查stationData中是否有重叠的点
                const overlappingStations = stationData.filter(station => 
                    Math.abs(station.latitude - currentLatLng.lat) < 1e-6 && 
                    Math.abs(station.longitude - currentLatLng.lng) < 1e-6
                ).map((station, index) => ({
                    ...station,
                    index: index,
                    isRoutePoint: false // 标记为站点
                }));
                
                // 合并所有重叠点
                const allOverlappingPoints = [...overlappingRoutePoints, ...overlappingStations];
                
                if (allOverlappingPoints.length > 0) {
                    // 显示所有重叠点的信息框
                    showMultiplePointInfoBoxes(e, allOverlappingPoints);
                }
            }
        });
    }
    
    // 将新标记添加到markers数组中以便管理
    markers.push(newPointMarker);
    
    // 记录新增点到历史数组中，只记录必要信息用于撤回
    // 注意：不再依赖insertIndex进行撤回，而是使用位置匹配
    addedPointsHistory.push({
        marker: newPointMarker,
        position: position,
        timestamp: Date.now()
    });
    
    // 在重新创建标记之前，先彻底清理现有的距离标记和可拖动矩形标记
    distanceMarkers.forEach(marker => {
        try {
            marker.off();
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        } catch (e) {
            console.warn('清除距离标记时出错:', e);
        }
    });
    distanceMarkers = [];
    
    draggableRectMarkers.forEach(marker => {
        try {
            marker.off();
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        } catch (e) {
            console.warn('清除矩形标记时出错:', e);
        }
    });
    draggableRectMarkers = [];
    
    // 使用updatePolyline函数重新绘制路线和更新标记位置
    updatePolyline();
    
    // 重新创建距离标记和可拖动矩形标记（只重新创建必要的标记）
    recreateDistanceAndRectMarkers();
    
    // 重新创建所有点标记，确保完全同步
    // 注意：这里需要延迟执行，避免标记创建冲突
    setTimeout(() => {
        recreateAllPointMarkers();
    }, 50);
    
    cocoMessage.success('在路线中插入了新点');
}

// 撤回最后新增的点
function undoLastAddedPoint() {
    if (addedPointsHistory.length === 0) {
        cocoMessage.info('没有可撤回的点');
        return;
    }
    
    // 获取最后新增的点
    const lastAddedPoint = addedPointsHistory.pop();
    
    // 从markers数组中移除该标记
    const markerIndex = markers.indexOf(lastAddedPoint.marker);
    if (markerIndex > -1) {
        markers.splice(markerIndex, 1);
    }
    
    // 从地图上移除该标记
    if (map.hasLayer(lastAddedPoint.marker)) {
        // 移除所有事件监听器
        lastAddedPoint.marker.off();
        map.removeLayer(lastAddedPoint.marker);
    }
    
    // 从editableMarkers数组中移除（如果存在）
    const editableMarkerIndex = editableMarkers.indexOf(lastAddedPoint.marker);
    if (editableMarkerIndex > -1) {
        editableMarkers.splice(editableMarkerIndex, 1);
    }
    
    // 使用位置匹配而不是insertIndex来删除点，避免索引失效问题
    // 因为后续插入操作可能导致之前记录的insertIndex不再指向正确的位置
    const pointIndex = routePoints.findIndex(point => 
        Math.abs(point.lat - lastAddedPoint.position.lat) < 1e-6 && 
        Math.abs(point.lng - lastAddedPoint.position.lng) < 1e-6
    );
    
    if (pointIndex !== -1) {
        routePoints.splice(pointIndex, 1);
    }
    
    // 重要：在撤回后，需要确保所有标记数组都正确同步
    // 因为可能有其他地方重新创建了标记，我们需要再次清理
    // 查找所有位置与被删除点相同的标记，确保彻底清理
    // 注意：这里需要检查所有可能的标记数组，包括markers和editableMarkers
    const allMarkers = [...markers, ...editableMarkers];
    const markersToRemove = allMarkers.filter(marker => {
        try {
            const markerPos = marker.getLatLng();
            return Math.abs(markerPos.lat - lastAddedPoint.position.lat) < 1e-6 && 
                   Math.abs(markerPos.lng - lastAddedPoint.position.lng) < 1e-6;
        } catch (e) {
            // 如果标记已经无效，也需要清理
            return true;
        }
    });
    
    // 去重处理，避免重复清理同一个标记
    const uniqueMarkersToRemove = [...new Set(markersToRemove)];
    
    uniqueMarkersToRemove.forEach(marker => {
        // 从markers数组中移除
        const index = markers.indexOf(marker);
        if (index > -1) {
            markers.splice(index, 1);
        }
        
        // 从editableMarkers数组中移除
        const editableIndex = editableMarkers.indexOf(marker);
        if (editableIndex > -1) {
            editableMarkers.splice(editableIndex, 1);
        }
        
        // 从地图上移除
        if (map.hasLayer(marker)) {
            marker.off();
            map.removeLayer(marker);
        }
    });
    
    // 彻底清理所有距离标记和可拖动矩形标记
    distanceMarkers.forEach(marker => {
        // 移除所有事件监听器
        try {
            marker.off();
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        } catch (e) {
            console.warn('撤回时清除距离标记出错:', e);
        }
    });
    distanceMarkers = [];
    
    draggableRectMarkers.forEach(marker => {
        // 移除所有事件监听器
        try {
            marker.off();
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        } catch (e) {
            console.warn('撤回时清除矩形标记出错:', e);
        }
    });
    draggableRectMarkers = [];

    // 移除机器位置标记
    if (machineMarker) {
        if (map.hasLayer(machineMarker)) {
            map.removeLayer(machineMarker);
        }
        machineMarker = null;
    }
    
    // 清理预览相关的标记和线条
    if (previewLine && map.hasLayer(previewLine)) {
        map.removeLayer(previewLine);
        previewLine = null;
    }
    
    if (previewDistanceMarker && map.hasLayer(previewDistanceMarker)) {
        previewDistanceMarker.off(); // 移除所有事件监听器
        map.removeLayer(previewDistanceMarker);
        previewDistanceMarker = null;
    }
    

    
    // 重新绘制路线和更新标记
    updatePolyline();
    recreateDistanceAndRectMarkers();
    recreateAllPointMarkers(); // 重新创建所有点标记，确保完全同步
    
    cocoMessage.success('已撤回最后新增的点');
}

// 添加必要的CSS样式
const style = document.createElement('style');
style.innerHTML = `
  .distance-label {
    pointer-events: none; /* 让鼠标可以穿透标签，点击地图 */
    background: none;
    border: none;
    padding: 0;
    font-size: 12px;
    font-weight: bold;
    text-align: center;
  }
`;
document.head.appendChild(style);

// function addToRoute(latLng) {
//     console.log(latLng, "测试进本数据")
//     routePoints.push(latLng);
//     if (currentPolyline) map.removeLayer(currentPolyline);
//     currentPolyline = L.polyline(routePoints, { color: 'red' }).addTo(map);
// }
let deleteBtnStatus = false
let addBtnStatus = false
let editRouteStatus = false
async function editToggleClickEventWithRoute() {
    if (!editRouteStatus) {
        // 开始编辑模式
        clearAllRoutes();
        map.on('mousemove', handleMouseMoveLine);
        let imgEdit = document.getElementById("imgEdit")
        // let addEdit = document.getElementById('addEdit');
        const selectElement = document.getElementById('routeSelect');
        callbackStatus = 1
        map.on('click', handleMapClick);
        document.querySelector(".text-edit").textContent = "编辑中...";
        imgEdit.src = '../plugins/img/img-right/编辑状态.png';
        editStatus = false
        allowAddingStations = false;
        disableEditing()
        
        deleteBtnStatus = true
        addBtnStatus = true
        toggleStatus = true
        document.querySelector(".text-editLine").textContent = "关闭增加";
        // addEdit.src = '../plugins/img/img-right/绘制路线 (2).png';
        
        // 检查是否有选中的路线
        const selectedValue = selectElement ? selectElement.value : null;
        
        if (selectedValue && alldata) {
            // 找到选中的路线
            const selectedRoute = alldata.find(route => route.routeId.toString() === selectedValue);
            if (selectedRoute && selectedRoute.stations && selectedRoute.stations.length > 0) {
                // 保存选中路线的数据，用于清除后重新创建
                const savedRouteData = {
                    stations: JSON.parse(JSON.stringify(selectedRoute.stations)),
                    routeName: selectedRoute.routeName,
                    mapCoverage: selectedRoute.mapCoverage || 22
                };
                
                // 在清除路线之前，保存tempRouteStations中的数据
                const savedTempRouteStations = window.tempRouteStations ? JSON.parse(JSON.stringify(window.tempRouteStations)) : [];
                
                // 将tempRouteStations中的更新数据同步到savedRouteData.stations中
                if (savedTempRouteStations && savedTempRouteStations.length > 0) {
                    savedTempRouteStations.forEach(tempStation => {
                        const originalStation = savedRouteData.stations.find(s => 
                            Math.abs(s.latitude - tempStation.latitude) < 1e-6 && 
                            Math.abs(s.longitude - tempStation.longitude) < 1e-6
                        );
                        
                        if (originalStation) {
                            // 更新原始站点数据，确保所有属性都被继承
                            originalStation.stationName = tempStation.stationName;
                            originalStation.direction = tempStation.direction;
                            originalStation.speed = tempStation.speed;
                            originalStation.area = tempStation.area;
                            originalStation.action = tempStation.action;
                            originalStation.position = tempStation.position;
                            originalStation.stop = tempStation.stop;
                            originalStation.runmode = tempStation.runmode;
                        }
                    });
                }
                
                // 设置基于已有路线新增的标志
                window.isAddingToExistingRoute = true;
                window.baseRouteId = selectedValue;
                window.baseRouteName = selectedRoute.routeName;
                
                // 先清除现有路线
                clearAllRoutes();
                
                // 根据保存的路线数据重新创建路线
                savedRouteData.stations.forEach(station => {
                    const latLng = L.latLng(station.latitude, station.longitude);
                    routePoints.push(latLng);
                    
                    // 首先检查保存的tempRouteStations中是否有更新的数据
                    let updatedStation = null;
                    if (savedTempRouteStations && savedTempRouteStations.length > 0) {
                        updatedStation = savedTempRouteStations.find(tempStation => 
                            Math.abs(tempStation.latitude - station.latitude) < 1e-6 && 
                            Math.abs(tempStation.longitude - station.longitude) < 1e-6
                        );
                    }
                    
                    // 将原始station数据保存到全局数组中，优先使用window.tempRouteStations中的更新数据
                    if (!window.originalRouteStations) {
                        window.originalRouteStations = [];
                    }
                    
                    const stationDataToSave = updatedStation || {
                        stationName: station.stationName || '站点',
                        id: station.id,
                        stationId: station.stationId || station.id,
                        direction: station.direction || '360',
                        speed: station.speed || '',
                        area: station.area || '',
                        action: station.action || '',
                        position: station.position || '0',
                        latitude: station.latitude,
                        longitude: station.longitude,
                        runmode: station.runmode || '0',
                        stop: station.stop || '0',
                    };
                    
                    window.originalRouteStations.push({
                        latLng: latLng,
                        stationData: stationDataToSave
                    });
                });
                
                // 重新创建所有点标记，确保标记被正确创建
                recreateAllPointMarkers();
                
                // 重新创建距离标记和可拖动矩形标记
                recreateDistanceAndRectMarkers();
                
                // 绘制折线
                if (currentPolyline) {
                    map.removeLayer(currentPolyline);
                }
                currentPolyline = L.polyline(routePoints, {
                    color: 'red',
                    weight: 3
                }).addTo(map);
                
                // 自动缩放地图以显示完整路线，让路线基本充满地图
                if (currentRoutePolyline) {
                    map.fitBounds(currentRoutePolyline.getBounds(), { padding: [20, 20] });
                } else if (routePoints && routePoints.length > 0) {
                    const bounds = L.latLngBounds(routePoints);
                    map.fitBounds(bounds, { padding: [20, 20] });
                }
                
                // 恢复tempRouteStations数据，确保后续拖动操作能使用更新后的数据
                if (savedTempRouteStations && savedTempRouteStations.length > 0) {
                    window.tempRouteStations = savedTempRouteStations;
                }
                
                cocoMessage.success(`路线"${savedRouteData.routeName}"创建新的可编辑路线，包含点的属性和矩形框`);
            } else {
                // 如果没有选中路线或路线为空，清空所有路线
                clearAllRoutes();
                window.isAddingToExistingRoute = false;
                window.baseRouteId = null;
                window.baseRouteName = null;
           
            }
        } else {
            // 如果没有选中路线，清空所有路线
            clearAllRoutes();
            window.isAddingToExistingRoute = false;
            window.baseRouteId = null;
            window.baseRouteName = null;
          
        }
        
        // 清除预览线和距离标记
        if (previewLine) {
            map.removeLayer(previewLine);
            previewLine = null;
        }
        if (previewDistanceMarker) {
            map.removeLayer(previewDistanceMarker);
            previewDistanceMarker = null;
        }
        
        // 设置编辑状态为开启
        editRouteStatus = true;
    } else {
        // 结束编辑模式
        deleteBtnStatus = false;
        addBtnStatus = false;
        toggleStatus = false;
        editRouteStatus = false;
        
        let imgEdit = document.getElementById("imgEdit");
        document.querySelector(".text-edit").textContent = "开始编辑";
        imgEdit.src = '../plugins/img/img-right/编辑.png';
        document.querySelector(".text-editLine").textContent = "新增路线";
        
        // 隐藏所有加号标记
        hideAddButtonNearStation();
        
        // 清除预览线和距离标记
        if (previewLine) {
            map.removeLayer(previewLine);
            previewLine = null;
        }
        if (previewDistanceMarker) {
            map.removeLayer(previewDistanceMarker);
            previewDistanceMarker = null;
        }
        
        // 移除鼠标移动事件监听器，防止继续创建预览线
        map.off('mousemove', handleMouseMoveLine);
        map.off('click', handleMapClick);
        
        // 清除所有路线点和标签
        clearAllRoutes();
        
        // 清除基于已有路线新增的标志
        window.isAddingToExistingRoute = false;
        window.isNewRouteMode = false; // 退出新增路线模式
        window.baseRouteId = null;
        window.baseRouteName = null;
        
        // const selectElement = document.getElementById('routeSelect');
        // selectElement.selectedIndex = 0;
        // 清除保存的原始路线站点数据
        // document.getElementById("routeSpeed").textContent = "";
      
        const selectedRouteId = document.getElementById('routeSelect') ? document.getElementById('routeSelect').value : '';
        await populateRouteSelect(!selectedRouteId, selectedRouteId);
    }
}

function toggleClickEventWithoutRoute() {
    window.isAddingToExistingRoute = false;
    window.isNewRouteMode = true; // 标记当前处于新增路线模式
     const selectElement = document.getElementById('routeSelect');
     selectElement.selectedIndex = 0;
    if (!toggleStatus) {
        // 打开新增功能
        clearAllRoutes();
        map.on('mousemove', handleMouseMoveLine);
        let imgEdit = document.getElementById("imgEdit")
        let addEdit = document.getElementById('addEdit');
        const selectElement = document.getElementById('routeSelect');
        callbackStatus = 1
        map.on('click', handleMapClick);
        document.querySelector(".text-edit").textContent = "开始编辑";
        imgEdit.src = '../plugins/img/img-right/编辑.png';
        editStatus = false
        allowAddingStations = false;
        disableEditing()
        
        deleteBtnStatus = true
        addBtnStatus = true
        toggleStatus = true
        document.querySelector(".text-editLine").textContent = "关闭增加";
        addEdit.src = '../plugins/img/img-right/绘制路线 (2).png';
        
        // 清空所有路线
        clearAllRoutes();
        window.isAddingToExistingRoute = false;
        window.baseRouteId = null;
        window.baseRouteName = null;
     
        
        // 清除预览线和距离标记
        if (previewLine) {
            map.removeLayer(previewLine);
            previewLine = null;
        }
        if (previewDistanceMarker) {
            map.removeLayer(previewDistanceMarker);
            previewDistanceMarker = null;
        }
    } else {
        // 关闭新增功能
        deleteBtnStatus = false;
        addBtnStatus = false;
        toggleStatus = false
        document.querySelector(".text-editLine").textContent = "新增路线";
        addEdit.src = '../plugins/img/img-right/绘制路线 (1).png';
        
        // 隐藏所有加号标记
        hideAddButtonNearStation();
        // 清除预览线和距离标记
        if (previewLine) {
            map.removeLayer(previewLine);
            previewLine = null;
        }
        if (previewDistanceMarker) {
            map.removeLayer(previewDistanceMarker);
            previewDistanceMarker = null;
        }
        // 移除鼠标移动事件监听器，防止继续创建预览线
        map.off('mousemove', handleMouseMoveLine);
        
        // 清除所有路线点和标签
        clearAllRoutes();
        
        // 清除基于已有路线新增的标志
        window.isAddingToExistingRoute = false;
        window.baseRouteId = null;
        window.baseRouteName = null;
        const selectElement = document.getElementById('routeSelect');
        selectElement.selectedIndex = 0;
        // 清除保存的原始路线站点数据
        document.getElementById("routeSpeed").textContent = "" 
   
    }
}

function toggleClickEvent() {
    clearAllRoutes();
    map.on('mousemove', handleMouseMoveLine);
    let imgEdit = document.getElementById("imgEdit")
    let addEdit = document.getElementById('addEdit');
    const selectElement = document.getElementById('routeSelect');
    callbackStatus = 1
    map.on('click', handleMapClick);
    document.querySelector(".text-edit").textContent = "开始编辑";
    imgEdit.src = '../plugins/img/img-right/编辑.png';
    editStatus = false
    allowAddingStations = false;
    disableEditing()
    if (!toggleStatus) {
        // 检查是否有选中的路线
        const selectedValue = selectElement ? selectElement.value : null;
        
        if (selectedValue && alldata) {
            editToggleClickEventWithRoute();
        } else {
            toggleClickEventWithoutRoute();
        }
    }
    else {
        deleteBtnStatus = false;
        addBtnStatus = false;
        toggleStatus = false
        document.querySelector(".text-editLine").textContent = "新增路线";
        addEdit.src = '../plugins/img/img-right/绘制路线 (1).png';
        
        // 隐藏所有加号标记
        hideAddButtonNearStation();
        // 清除预览线和距离标记
        if (previewLine) {
            map.removeLayer(previewLine);
            previewLine = null;
        }
        if (previewDistanceMarker) {
            map.removeLayer(previewDistanceMarker);
            previewDistanceMarker = null;
        }
        // 移除鼠标移动事件监听器，防止继续创建预览线
        map.off('mousemove', handleMouseMoveLine);
        
        // 清除所有路线点和标签
        clearAllRoutes();
        
        // 清除基于已有路线新增的标志
        window.isAddingToExistingRoute = false;
        window.baseRouteId = null;
        window.baseRouteName = null;
        selectElement.selectedIndex = 0;
        // 清除保存的原始路线站点数据
        document.getElementById("routeSpeed").textContent = "" 
    }
    }

// 定义打印当前路线ID的函数，这里主要是发布话题

async function printCurrentRouteId() {
    const selectElement = document.getElementById('routeSelect');
    const selectedValue = selectElement.value;
    let selectedItem = alldata.find(item => item.routeId == selectedValue);
    if (!selectedValue) {
        cocoMessage.error("请选择路线");
    } else {
        cocoMessage.success("发布成功")
        if(document.getElementById("publishRouteModel").value == "1"){
              rosManager.publishRouteId(Number(selectedValue));
        }else if(document.getElementById("publishRouteModel").value == "0"){
            try {
            const response = await axiosClient.get("route/detail/" + selectedValue);
                    let flag = response.data.code;
                    if (!flag) {
                        $(".route_choose").text("选择成功");
                        let poseMsg = new ROSLIB.Message({
                            data: response.data.data,
                        });
                        rosManager.pathPointPub.publish(poseMsg);
                        // const originData = {
                        //     action: "gnsspoint",
                        //     points: response.data.data
                        // }
                        // const finalData = JSON.stringify(originData);
                        // websocket.send(finalData);
                        // console.log(selectedItem, "selectedItemselectedItem");
                        // let params = {
                        //     routeMsg: String(selectedItem.routeName),
                        //     carRun: "",
                        //     carStop: "",
                        //     workCancel: ""
                        // }
                        // await addWaterDepth(params)
                    } else {
                        cocoMessage.error("系统错误");
                    }
        } catch (error) {
            throw error;
        }
        }
    }
}




//添加操作日志
async function addWaterDepth(params) {
    try {
        // let params = {
        //     routeMsg:"机器运行了路线",
        //     carRun:"机器运行",
        //     carStop:"机器暂停",
        //     workCancel:"机器停止并取消了执行的任务路线"
        //     }
        const response = await axiosClient.post("carLog/add", params);

    } catch (error) {
        console.error("Error fetching data:", error); // 打印完整的错误信息
        throw error; // 抛出错误以便在调用处捕获
    }
}


// 修改后的 recordRoute 函数
function recordRoute() {
    let recordPoints = JSON.parse(localStorage.getItem("myRecording")) || [];
    let recordRouteBtn = document.getElementById("recordRoute");
    if (recordPoints.length <= 1) {
        cocoMessage.error("录制预览失败没有有效的点来生成路线")
        return
    }
    // 过滤有效坐标点
    let stationsUseful = recordPoints.filter(station => {
        return isNumeric(station.lat) && isNumeric(station.lng);
    });

    if (preViewRouteStatus) {
        // 开始预览
        recordRouteBtn.textContent = "结束预览";
        drawPreviewRoute(stationsUseful);
    } else {
        // 结束预览
        const modal = new bootstrap.Modal('#recordNameModal');

        // 关键修复：在显示模态框前移除旧的事件监听器
        const confirmBtn = document.getElementById('confirmRecordName');
        const cancelBtn = document.getElementById('cancelRecordName');

        // 创建新的事件监听器（使用箭头函数保存上下文）
        const confirmHandler = () => {
            const name = document.getElementById('recordNameInput').value.trim();
            if (name) {
                modal.hide();
                savePreViewRoute(name, stationsUseful);
            }
        };

        const cancelHandler = () => {
            document.getElementById('recordNameInput').value = '';
            modal.hide();
        };

        // 移除旧监听器并添加新监听器
        confirmBtn.replaceWith(confirmBtn.cloneNode(true));
        cancelBtn.replaceWith(cancelBtn.cloneNode(true));
        document.getElementById('confirmRecordName').addEventListener('click', confirmHandler);
        document.getElementById('cancelRecordName').addEventListener('click', cancelHandler);

        // 显示模态框
        modal.show();

        // 更新按钮文本并清除预览元素
        recordRouteBtn.textContent = "开始预览";
        if (linePreview) map.removeLayer(linePreview);
        if (startMarker) map.removeLayer(startMarker);
        if (endMarker) map.removeLayer(endMarker);
        linePreview = null;
        startMarker = null;
        endMarker = null;
    }

    preViewRouteStatus = !preViewRouteStatus;
}






// 保持原有isNumeric函数不变
function isNumeric(str) {
    return /^-?\d+(\.\d+)?$/.test(str);
}



function loadRoute(routeId) {
    // 获取路线数据
    const selectedRoute = alldata.find(r => r.routeId == routeId);
    if (!selectedRoute) return;

    // 如果是基于已有路线新增模式，不清除现有路线元素，而是将选中的路线点添加到routePoints中
    if (window.isAddingToExistingRoute) {
        // 将选中的路线点添加到routePoints数组中，并保留原始属性数据
        selectedRoute.stations.forEach(station => {
            const latLng = L.latLng(station.latitude, station.longitude);
            routePoints.push(latLng);
            
            // 将原始station数据保存到全局数组中，以便后续使用
            if (!window.originalRouteStations) {
                window.originalRouteStations = [];
            }
            window.originalRouteStations.push({
                latLng: latLng,
                stationData: {
                    stationName: station.stationName || '站点',
                    id: station.id,
                    stationId: station.stationId || station.id,
                    direction: station.direction || '',
                    speed: station.speed || '',
                    area: station.area || '1',
                    action: station.action || '1',
                    position: station.position || '',
                    latitude: station.latitude,
                    longitude: station.longitude
                }
            });
        });
        
        // 注意：不在这里调用recreateAllPointMarkers()，避免重复创建标记
        // 标记创建会在其他地方统一处理
        
        // 重新创建距离标记和可拖动矩形标记
        recreateDistanceAndRectMarkers();
        
        // 绘制新的折线
        if (currentPolyline) {
            map.removeLayer(currentPolyline);
        }
        currentPolyline = L.polyline(routePoints, {
            color: 'red',
            weight: 3
        }).addTo(map);
        
        // 聚焦首站点
        map.setView(routePoints[0], 18);
    } else {
        // 清除现有路线元素
        if (currentRoutePolyline) map.removeLayer(currentRoutePolyline);
        editableMarkers.forEach(marker => {
            try {
                map.removeLayer(marker);
            } catch (e) {
                console.warn('清除可编辑标记时出错:', e);
            }
        });
        editableMarkers = [];

        // 创建可拖拽标记
        const routePoints = selectedRoute.stations.map(station => {
            const marker = L.marker([station.latitude, station.longitude], {
                draggable: true,
                icon: L.icon({
                    iconUrl: '../plugins/img/原点.png',
                    title: station.stationName,
                    iconSize: [12, 12],
                    iconAnchor: [6, 6]
                })
            }).addTo(map);
            marker.bindTooltip(station.stationName, {
                permanent: false,
                direction: 'right',
                offset: [10, 0],
                className: 'station-label'
            });
            
            // 添加鼠标悬浮事件，控制标签显示
            marker.on('mouseover', function() {
                this.openTooltip();
                // 使用CSS类控制标签显示
                const tooltip = this.getTooltip();
                if (tooltip) {
                    L.DomUtil.addClass(tooltip._container, 'leaflet-tooltip-visible');
                }
                
                // 在新增路线模式下，显示加号标记
                if (toggleStatus) {
                    showAddButtonNearStation(this.getLatLng(), this);
                }
            });
            
            marker.on('mouseout', function() {
                this.closeTooltip();
                // 移除显示类
                const tooltip = this.getTooltip();
                if (tooltip) {
                    L.DomUtil.removeClass(tooltip._container, 'leaflet-tooltip-visible');
                }
                
                // 设置延迟隐藏，给用户时间点击
                if (addButtonTimeout) {
                    clearTimeout(addButtonTimeout);
                }
                addButtonTimeout = setTimeout(function() {
                    hideAddButtonNearStation();
                }, 1000); // 延迟1秒隐藏
            });
            // 为marker绑定原始数据（关键修复）
            marker.originalData = {
                position: L.latLng(station.latitude, station.longitude),
                stationData: {
                    stationName: station.stationName || '站点',
                    id: station.id,
                    stationId: station.stationId || station.id,
                    direction: station.direction || '',
                    speed: station.speed || '',
                    area: station.area || '1',
                    action: station.action || '1',
                    position: station.position || '',
                    latitude: station.latitude,
                    longitude: station.longitude
                }
            };
            
            // 绑定拖拽事件
            marker.on('dragend', function (e) {
                cocoMessage.success('拖动成功3');
                const updatedPosition = e.target.getLatLng();
                const oldPosition = marker.originalData.position;
                
                // 更新routePoints中的对应点
                let index = routePoints.findIndex(point =>
                    point.lat === oldPosition.lat &&
                    point.lng === oldPosition.lng
                );
                if (index !== -1) {
                    routePoints[index] = updatedPosition;
                    updatePolyline(); // 更新Polyline
                }
                
                // 更新marker的原始位置为新位置，以便下次拖动
                marker.originalData.position = updatedPosition;
                
                // 更新tempRouteStations中的对应数据（关键修复）
                if (window.tempRouteStations && window.tempRouteStations.length > 0) {
                    const tempStationIndex = window.tempRouteStations.findIndex(s => 
                        Math.abs(s.latitude - oldPosition.lat) < 1e-6 && 
                        Math.abs(s.longitude - oldPosition.lng) < 1e-6
                    );
                    
                    if (tempStationIndex !== -1) {
                        // 更新tempRouteStations中的经纬度信息
                        window.tempRouteStations[tempStationIndex].latitude = updatedPosition.lat;
                        window.tempRouteStations[tempStationIndex].longitude = updatedPosition.lng;
                    }
                }
                
                // 更新selectedRoute.stations中的对应数据
                if (selectedRoute && selectedRoute.stations) {
                    const stationIndex = selectedRoute.stations.findIndex(s => 
                        Math.abs(s.latitude - oldPosition.lat) < 1e-6 && 
                        Math.abs(s.longitude - oldPosition.lng) < 1e-6
                    );
                    
                    if (stationIndex !== -1) {
                        selectedRoute.stations[stationIndex].latitude = updatedPosition.lat;
                        selectedRoute.stations[stationIndex].longitude = updatedPosition.lng;
                    }
                }

                // 移除旧的标记
                map.removeLayer(marker);
                // 将更新后的标记重新添加到地图上
                marker.setLatLng(updatedPosition);
                map.addLayer(marker);
            });

            editableMarkers.push(marker);
            return marker.getLatLng();
        });

        // 绘制动态折线
        currentRoutePolyline = L.polyline(routePoints, {
            color: 'red',//#3388ff
            weight: 3
        }).addTo(map);
        map.setView(routePoints[0], selectedRoute.mapCoverage);
        // 聚焦首站点
        map.setView(routePoints[0], 18);
    }
}

function updateRoutePolyline(points) {
    if (currentRoutePolyline) map.removeLayer(currentRoutePolyline);
    currentRoutePolyline = L.polyline(points, {
        color: 'red',
        weight: 3
    }).addTo(map);
}

// 全局变量：跟踪当前选中的站点标记
let selectedStationMarker = null;

// 全局变量：跟踪当前的信息框容器
let currentInfoBoxContainer = null;

// 全局函数：点击地图其他区域关闭所有信息框
function closeOnMapClick(e) {
    if (currentInfoBoxContainer && currentInfoBoxContainer.parentNode) {
        currentInfoBoxContainer.remove();
        currentInfoBoxContainer = null;
    }
    // 移除选中站点的标记
    if (selectedStationMarker) {
        map.removeLayer(selectedStationMarker);
        selectedStationMarker = null;
    }
    map.off('click', closeOnMapClick);
}

// 全局函数：显示多个点的信息框
function showMultiplePointInfoBoxes(event, stations, startIndex = 0) {
    // 清除已有的信息框容器
    const existingContainer = document.getElementById('multiplePointsContainer');
    if (existingContainer) {
        existingContainer.remove();
        currentInfoBoxContainer = null;
    }
    
    // 清除之前选中的站点标记
    if (selectedStationMarker) {
        map.removeLayer(selectedStationMarker);
        selectedStationMarker = null;
    }

    // 创建容器用于flex排列所有信息框
    const container = document.createElement('div');
    container.addEventListener('click', function (e) {
        e.stopPropagation(); // 阻止容器的点击事件冒泡到地图
        if (e.originalEvent) e.originalEvent.stopPropagation(); // 兼容Leaflet事件
    });
    container.id = 'multiplePointsContainer';
    container.style.position = 'absolute';
    container.style.display = 'flex';
    container.style.flexDirection = 'column'; // 保持垂直排列
    container.style.gap = '8px'; // 减小间距，节省空间
    container.style.zIndex = '1000';
    // 关键：限制最大高度+滚动条
    container.style.maxHeight = '350px'; // 根据界面调整合适高度
    container.style.overflowY = 'auto'; // 超出时显示垂直滚动条
    container.style.overflowX = 'hidden'; // 禁止水平滚动
    container.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'; // 增强阴影，区分滚动区域


    // 2. 动态计算容器位置（避免靠近边缘时溢出）
    const mapContainer = document.getElementById('mapDiv');
    if (!mapContainer) {
        return;
    }
    const mapRect = mapContainer.getBoundingClientRect(); // 地图容器的位置和尺寸
    const clickX = event.originalEvent.clientX - mapRect.left;
    const clickY = event.originalEvent.clientY - mapRect.top;

    // 计算容器位置 - 固定在最左边，高度为地图容器一半
    let finalLeft = 10; // 固定距离左边10px
    let finalTop = mapRect.height / 2 - 150; // 地图容器一半高度减去信息框一半高度（300px/2）

    // 确保不会超出地图边界
    if (finalTop < 10) {
        finalTop = 10; // 最小距离顶部10px
    }
    if (finalTop + 300 > mapRect.height) {
        finalTop = mapRect.height - 310; // 距离底部预留10px间距
    }

    container.style.left = `${finalLeft}px`;
    container.style.top = `${finalTop}px`;
    container.style.minWidth = '280px'; // 固定最小宽度，避免内容挤压


    // 3. 为每个重叠点创建信息框（保持原有逻辑，优化样式）
    stations.forEach((station, idx) => {
        // 直接判断这个点在路线中的实际位置
        let actualIndex;
        
        // 获取当前选中的路线
        const selectedRouteId = document.getElementById('routeSelect') ? document.getElementById('routeSelect').value : '';
        
        // 如果station对象已经有index属性，优先使用它
        if (station.index !== undefined && station.index !== null) {
            actualIndex = station.index;
        } else {
            if (selectedRouteId && alldata) {
                const selectedRoute = alldata.find(r => r.routeId == selectedRouteId);
                if (selectedRoute && selectedRoute.stations) {
                    // 查找当前点在路线中的位置
                    const stationIndex = selectedRoute.stations.findIndex(s => 
                        Math.abs(s.latitude - station.latitude) < 1e-6 && 
                        Math.abs(s.longitude - station.longitude) < 1e-6
                    );
                    
                    if (stationIndex !== -1) {
                        // 找到了点，使用实际位置
                        actualIndex = stationIndex;
                    } else {
                        // 新增的点，使用路线长度作为位置（显示时会+1）
                        actualIndex = selectedRoute.stations.length;
                    }
                } else {
                    // 没有路线数据，使用startIndex + idx
                    actualIndex = startIndex + idx;
                }
            } else {
                // 没有选中路线，使用startIndex + idx
                actualIndex = startIndex + idx;
            }
        }
        
        // 检查tempRouteStations中是否有对应点的暂存数据
        let stationToUse = {...station}; // 创建副本避免修改原对象
        // 确保isRoutePoint属性被复制
        stationToUse.isRoutePoint = station.isRoutePoint || false;
        
        // 在新增路线模式下，将isRoutePoint设置为true
        if (window.isNewRouteMode) {
            stationToUse.isRoutePoint = true;
        }
        
        if (window.tempRouteStations && window.tempRouteStations.length > 0) {
            const tempStation = window.tempRouteStations.find(s => 
                Math.abs(s.latitude - station.latitude) < 1e-6 && 
                Math.abs(s.longitude - station.longitude) < 1e-6
            );
            
            if (tempStation) {
                // 使用暂存数据覆盖station对象的属性，但保留isRoutePoint
                stationToUse = {
                    ...stationToUse,
                    stationName: tempStation.stationName || stationToUse.stationName,
                    speed: tempStation.speed || stationToUse.speed,
                    direction: tempStation.direction || stationToUse.direction,
                    area: tempStation.area || stationToUse.area,
                    action: tempStation.action || stationToUse.action,
                    position: tempStation.position || stationToUse.position,
                    stop: tempStation.stop || stationToUse.stop,
                    runmode: tempStation.runmode || stationToUse.runmode,
                    lanechange: tempStation.lanechange || stationToUse.lanechange,
                    isRoutePoint: stationToUse.isRoutePoint // 确保保留isRoutePoint属性
                };
            }
        }
        
        // 获取当前选中的路线，用于显示路线速度
        // selectedRouteId 已在上面声明，无需重复声明
        // 检查是否为新增路线模式
    const isAddingModeAtStart = window.isAddingToExistingRoute || window.isNewRouteMode || (window.tempRouteStations && window.tempRouteStations.length > 0);
    
    // 新增模式下允许selectedRouteId为空，直接使用idx查找
    if ((selectedRouteId && alldata) || (isAddingModeAtStart && idx !== undefined && idx !== null)) {
            const selectedRoute = alldata.find(r => r.routeId == selectedRouteId);
            if (selectedRoute) {
                // 添加路线速度到stationToUse对象中
                stationToUse.routeSpeed = selectedRoute.speed || '';
            }
        }
        // 使用actualIndex作为索引，确保显示正确的点序号
        // 注意：这里传递的第二个参数是actualIndex，用于显示点序号
        // 第三个参数是idx，用于创建唯一的ID
        

        
        const infoBox = createSinglePointInfoBox(stationToUse, actualIndex, idx);
        container.appendChild(infoBox);
    });

    // 添加到地图容器
    mapContainer.appendChild(container);
    
    // 设置全局容器变量
    currentInfoBoxContainer = container;
    
    // 注释掉为当前选中的站点添加特殊标记的代码
    // if (stations.length > 0) {
    //     const selectedStation = stations[0];
    //     // 创建一个特殊的标记图标，用于标识当前选中的站点
    //     const selectedIcon = L.icon({
    //         iconUrl: '../plugins/img/坐标 (3).svg', // 使用一个特殊的图标来表示选中的站点
    //         iconSize: [30, 30], // 设置图标大小
    //         iconAnchor: [15,15] // 设置图标锚点
    //     });
    //     
    //     // 创建选中站点的标记
    //     selectedStationMarker = L.marker([selectedStation.latitude, selectedStation.longitude], {
    //         icon: selectedIcon,
    //         zIndexOffset: 1000 // 确保选中标记在其他标记之上
    //     }).addTo(map);
    // }

    // 点击地图其他区域关闭所有信息框（使用全局函数）
    map.on('click', closeOnMapClick);
}

// 保存单个点信息的函数
async function savePointInfo(stationId, boxIndex, station) {
    const stationNameInput = document.getElementById(`stationName-${stationId}-${boxIndex}`);
    const speedInput = document.getElementById(`speed-${stationId}-${boxIndex}`);
    const routeSpeedInput = document.getElementById(`routeSpeed-${stationId}-${boxIndex}`);
    const obstacleSelect = document.getElementById(`obstacle-${stationId}-${boxIndex}`);
    const directionInput = document.getElementById(`direction-${stationId}-${boxIndex}`);
    const taskSelect = document.getElementById(`task-${stationId}-${boxIndex}`);
    const positionSelect = document.getElementById(`position-${stationId}-${boxIndex}`);
    const lanechangeSelect = document.getElementById(`lanechange-${stationId}-${boxIndex}`);
    const avoidDistanceInput = document.getElementById(`avoidDistance-${stationId}-${boxIndex}`);
    const stopRadios = document.getElementsByName(`stop-option-${stationId}-${boxIndex}`);
    const runmodeRadios = document.getElementsByName(`runmode-option-${stationId}-${boxIndex}`);
    const selectElement = document.getElementById('routeSelect');
    const selectedValue = selectElement.value;
    
    if (!speedInput || !obstacleSelect || !directionInput || !taskSelect || !positionSelect || !lanechangeSelect || !stopRadios || !runmodeRadios) {
        return;
    }

    // 获取是否停车的值
    let stopValue = '0'; // 默认为否
    for (let i = 0; i < stopRadios.length; i++) {
        if (stopRadios[i].checked) {
            stopValue = stopRadios[i].value;
            break;
        }
    }
    
    // 获取是否自转的值
    let runmodeValue = '0'; // 默认为否
    for (let i = 0; i < runmodeRadios.length; i++) {
        if (runmodeRadios[i].checked) {
            runmodeValue = runmodeRadios[i].value;
            break;
        }
    }

    // 检查是否是新增路线模式下的点（没有stationId或者是基于已有路线新增的模式）
    // 在新增模式下，特殊站点也只执行暂存操作，不进入正常保存模式
 
    if (!stationId || stationId === 'null' || stationId === null || station.isRoutePoint || window.isAddingToExistingRoute || window.isNewRouteMode || (window.tempRouteStations && window.tempRouteStations.length > 0)) {
        // 新增路线模式下，暂存站点属性信息
        // 优先使用输入框的值，其次使用tempRouteStations中保存的值，最后使用原始值或默认值
        const existingTempStation = window.tempRouteStations && window.tempRouteStations.find(s => 
            Math.abs(s.latitude - station.latitude) < 1e-6 && 
            Math.abs(s.longitude - station.longitude) < 1e-6
        );
        
        const tempStationData = {
            stationName: stationNameInput ? stationNameInput.value : (existingTempStation ? existingTempStation.stationName : (station.stationName || '自定义点')),
            latitude: station.latitude,
            longitude: station.longitude,
            id: "-1", // 新增站点ID用-1
            stationId: "-1",
            direction: directionInput.getAttribute('data-actual-value') || directionInput.value || (existingTempStation ? existingTempStation.direction : "360"),
            speed: speedInput.value || (existingTempStation ? existingTempStation.speed : ""),
            area: obstacleSelect.value || (existingTempStation ? existingTempStation.area : "1"),
            action: taskSelect.value || (existingTempStation ? existingTempStation.action : "1"),
            position: positionSelect.value || (existingTempStation ? existingTempStation.position : "0"),
            lanechange: lanechangeSelect.value !== undefined && lanechangeSelect.value !== null && lanechangeSelect.value !== "" ? lanechangeSelect.value : (existingTempStation ? existingTempStation.lanechange : "0"),
            avoidDistance: avoidDistanceInput ? avoidDistanceInput.value || (existingTempStation ? existingTempStation.avoidDistance : "0.5") : (existingTempStation ? existingTempStation.avoidDistance : "0.5"),
            stop: stopValue !== undefined ? stopValue : (existingTempStation ? existingTempStation.stop : "0"),
            runmode: runmodeValue !== undefined ? runmodeValue : (existingTempStation ? existingTempStation.runmode : "0"),
            index: station.index || 0
        };
        
        // 暂存到全局数组中
        if (!window.tempRouteStations) {
            window.tempRouteStations = [];
        }
        
        // 检查是否已存在相同位置的站点，如果存在则更新，否则添加
        const existingIndex = window.tempRouteStations.findIndex(s => 
            Math.abs(s.latitude - station.latitude) < 1e-6 && 
            Math.abs(s.longitude - station.longitude) < 1e-6
        );
        
        if (existingIndex > -1) {
            window.tempRouteStations[existingIndex] = tempStationData;
        } else {
            window.tempRouteStations.push(tempStationData);
        }
        
        cocoMessage.success("站点属性已暂存");
        
        // 更新地图上对应标记的标签为输入的站点名称
        const markerIndex = markers.findIndex(marker => {
            const pos = marker.getLatLng();
            return Math.abs(pos.lat - station.latitude) < 1e-6 && 
                   Math.abs(pos.lng - station.longitude) < 1e-6;
        });
        
        if (markerIndex > -1 && markers[markerIndex]) {
            const marker = markers[markerIndex];
            // 获取用户输入的站点名称，如果没有输入则使用默认值
            const stationName = stationNameInput ? stationNameInput.value : (station.stationName || '自定义点');
            // 更新tooltip显示为输入的站点名称
            marker.unbindTooltip();
            // marker.bindTooltip(stationName, {
            //     permanent: true,
            //     direction: 'right',
            //     offset: [10, 0],
            //     className: 'station-label'
            // });
            
            // 检查是否是特殊点标记
            const isSpecialStationMarker = stationData.some(s => 
                Math.abs(s.latitude - station.latitude) < 1e-6 && 
                Math.abs(s.longitude - station.longitude) < 1e-6
            );
            
            // 如果是特殊点，不修改图标
            if (isSpecialStationMarker) {
            } else {
                // 检查stop值，决定使用哪种图标
                // 判断是否是起点或终点 - 使用routePoints中的实际位置来判断
                // 找到当前站点在routePoints中的实际位置
                let actualStationIndex = -1;
                if (routePoints && routePoints.length > 0) {
                    actualStationIndex = routePoints.findIndex(point => 
                        Math.abs(point.lat - station.latitude) < 1e-6 && 
                        Math.abs(point.lng - station.longitude) < 1e-6
                    );
                }
                
                const isFirstStation = actualStationIndex === 0;
                const isLastStation = routePoints && routePoints.length > 0 && 
                                      actualStationIndex === routePoints.length - 1;
                
                // 判断是否为停车点
                const isStopStation = stopValue === "1" || stopValue === 1;
                
                // 根据站点类型设置图标 - 停车点优先于起点和终点
                if (isStopStation && !isFirstStation && !isLastStation) {
                    // 停车点使用任务进程.svg图标（但不是起点或终点的停车点）
                    const taskProcessIcon = L.icon({
                        iconUrl: '../plugins/img/任务进程.svg',
                        iconSize: [25, 25],
                        iconAnchor: [12.5, 25]
                    });
                    marker.setIcon(taskProcessIcon);
                } else if (isFirstStation) {
                    // 起点使用起点图标
                    const startIcon = L.icon({
                        iconUrl: '../plugins/img/英文起点.png',
                        iconSize: [25, 25],
                        iconAnchor: [10, 18]
                    });
                    marker.setIcon(startIcon);
                } else if (isLastStation) {
                    // 终点使用终点图标
                    const endIcon = L.icon({
                        iconUrl: '../plugins/img/英文终点.png',
                        iconSize: [25, 25],
                        iconAnchor: [10, 18]
                    });
                    marker.setIcon(endIcon);
                } else if (isStopStation) {
                    // 停车点使用任务进程.svg图标（包括起点或终点的停车点）
                    const taskProcessIcon = L.icon({
                        iconUrl: '../plugins/img/任务进程.svg',
                        iconSize: [25, 25],
                        iconAnchor: [12.5, 25]
                    });
                    marker.setIcon(taskProcessIcon);
                } else {
                    // 检查stop值，决定使用哪种图标
                    if (stopValue === "0" || stopValue === 0) {
                        // 如果stop=0，使用circle-fill.svg图标
                        const circleFillIcon = L.icon({
                            iconUrl: '../plugins/img/circle-fill.svg',
                            iconSize: [12, 12],
                            iconAnchor: [6, 6]
                        });
                        marker.setIcon(circleFillIcon);
                    } else {
                        // 否则使用默认图标
                        const defaultIcon = L.icon({
                            iconUrl: '../plugins/img/原点.png',
                            iconSize: [25, 25],
                            iconAnchor: [12, 12]
                        });
                        marker.setIcon(defaultIcon);
                    }
                }
            }
        }
        
        // 只隐藏当前信息框，不影响容器和其他信息框
    const infoBox = document.getElementById(`pointInfoBox-${boxIndex}`);
    if (infoBox) infoBox.style.display = 'none';
    return;
    }



    // 获取方向值，优先使用自定义属性中的实际值，如果没有则使用输入框的值
    let directionValue = directionInput.value;
    const actualValue = directionInput.getAttribute('data-actual-value');
    if (actualValue) {
        directionValue = actualValue;
    } else if (!directionValue) {
        directionValue = "360"; // 默认值
    }
    
    const params = {
        routeId: selectedValue,
        stationId: stationId,
        speed: speedInput.value,
        area: obstacleSelect.value,
        direction: directionValue,
        stopTime: 0,
        action: taskSelect.value,
        position: positionSelect.value,
        lanechange: lanechangeSelect.value,
        stop: stopValue,
        runmode: runmodeValue,
        avoidDistance: avoidDistanceInput ? avoidDistanceInput.value : "0.5"
    };
    
    // 确保方向值正确传递给后端
    
    // 如果有路线速度输入框，更新路线速度
    if (routeSpeedInput && routeSpeedInput.value) {
        const selectedRoute = alldata.find(r => r.routeId == selectedValue);
        if (selectedRoute) {
            selectedRoute.speed = routeSpeedInput.value;
        }
    }
    
    const stationParams = {
        id:stationId,
        stationName:stationNameInput.value
    }
    
    // 在保存之前就判断标记的更换
    const routeSelect = document.getElementById('routeSelect');
    const selectedRouteId = routeSelect.value;
    const selectedRoute = alldata.find(r => r.routeId == selectedRouteId);
    
    if (selectedRoute) {
        // 找到对应的站点
        const station = selectedRoute.stations.find(s => 
            s.stationId == stationParams.id || s.id == stationParams.id
        );
        
        if (station) {
            // 更新站点名称
            station.stationName = stationParams.stationName;
            
            // 找到对应的标记并更新图标
            const stationIndex = selectedRoute.stations.findIndex(s => 
                s.stationId == stationParams.id || s.id == stationParams.id
            );
            
            if (stationIndex > -1 && editableMarkers[stationIndex]) {
                const marker = editableMarkers[stationIndex];
                
                // 检查是否是特殊点标记
                const isSpecialStationMarker = stationData.some(s => 
                    Math.abs(s.latitude - station.latitude) < 1e-6 && 
                    Math.abs(s.longitude - station.longitude) < 1e-6
                );
                
                // 如果是特殊点，不修改图标
                if (isSpecialStationMarker) {
                    console.log("特殊点不修改图标");
                } else {
                    // 判断是否为起点或终点
                    const isFirstStation = stationIndex === 0;
                    const isLastStation = stationIndex === selectedRoute.stations.length - 1;
                    
                    // 判断是否为停车点
                    const isStopStation = stopValue === "1" || stopValue === 1;
                    
                    // 根据站点类型设置图标
                    if (isStopStation && !isFirstStation && !isLastStation) {
                        // 非起点/终点的停车点使用任务进程.svg图标
                        const taskProcessIcon = L.icon({
                            iconUrl: '../plugins/img/任务进程.svg',
                            iconSize: [25, 25],
                            iconAnchor: [12.5, 25]
                        });
                        marker.setIcon(taskProcessIcon);
                    } else if (isFirstStation) {
                        // 起点使用起点图标
                        const startIcon = L.icon({
                            iconUrl: '../plugins/img/英文起点.png',
                            iconSize: [25, 25],
                            iconAnchor: [10, 18]
                        });
                        marker.setIcon(startIcon);
                    } else if (isLastStation) {
                        // 终点使用终点图标
                        const endIcon = L.icon({
                            iconUrl: '../plugins/img/英文终点.png',
                            iconSize: [25, 25],
                            iconAnchor: [10, 18]
                        });
                        marker.setIcon(endIcon);
                    } else if (isStopStation) {
                        // 起点/终点的停车点也使用任务进程.svg图标
                        const taskProcessIcon = L.icon({
                            iconUrl: '../plugins/img/任务进程.svg',
                            iconSize: [25, 25],
                            iconAnchor: [12.5, 25]
                        });
                        marker.setIcon(taskProcessIcon);
                    } else {
                        // 检查stop值，决定使用哪种图标
                        if (stopValue === "0" || stopValue === 0) {
                            // 如果stop=0，使用circle-fill.svg图标
                            const circleFillIcon = L.icon({
                                iconUrl: '../plugins/img/circle-fill.svg',
                                iconSize: [12, 12],
                                iconAnchor: [6, 6]
                            });
                            marker.setIcon(circleFillIcon);
                        } else {
                            // 否则使用默认图标
                            const defaultIcon = L.icon({
                                iconUrl: '../plugins/img/原点.png',
                                iconSize: [25, 25],
                                iconAnchor: [12, 12]
                            });
                            marker.setIcon(defaultIcon);
                        }
                    }
                }
                
                // 移除tooltip，不显示标签
                marker.unbindTooltip();
            }
        }
    }
    
    try {
        if (selectedValue) {
            const statoinResponse = await axiosClient.post("station/update", stationParams);
           
            const response = await axiosClient.post("route/updateRouteDetail", params);
            
            if (response.data.message == "ok") {
                cocoMessage.success("更新成功");

                // 重新获取最新的路线数据，确保alldata是最新的
                getAllRoute().then(() => {
                   
                }).catch(error => {
                    console.error("重新获取路线数据失败:", error);
                });

                // 只隐藏当前信息框，不影响容器和其他信息框
                const infoBox = document.getElementById(`pointInfoBox-${boxIndex}`);
                if (infoBox) infoBox.style.display = 'none';
            }
        } else {
            console.log("正常保存模式: selectedValue为空，显示'站点属性修改失败'");
            cocoMessage.error("站点属性修改失败");
        }
    } catch (error) {
        console.error("保存失败:", error);
        cocoMessage.error("保存失败");
    }
}

// 删除单个点信息的函数
function deletePointInfo(stationId, boxIndex, station) {
    // 确认删除
    if (!confirm("确定要删除这个点吗？")) {
        return;
    }
    
    // 检查是否是新增路线模式下的点（没有stationId或者是基于已有路线新增的模式）
    if (!stationId || stationId === 'null' || stationId === null || station.isRoutePoint || window.isAddingToExistingRoute || window.isNewRouteMode) {
        // 新增路线模式下，直接从routePoints中删除点
        const pointIndex = routePoints.findIndex(point => 
            Math.abs(point.lat - station.latitude) < 1e-6 && 
            Math.abs(point.lng - station.longitude) < 1e-6
        );
        
        if (pointIndex > -1) {
            // 从routePoints中删除点
            routePoints.splice(pointIndex, 1);
            
            // 清除现有的标记、折线和距离标记
            if (currentRoutePolyline) map.removeLayer(currentRoutePolyline);
            if (currentPolyline) map.removeLayer(currentPolyline);
            
            // 找到对应的标记并删除（但保留特殊点标记）
            const markerToDelete = markers.find(marker => {
                const pos = marker.getLatLng();
                return Math.abs(pos.lat - station.latitude) < 1e-6 && 
                       Math.abs(pos.lng - station.longitude) < 1e-6;
            });
            
            if (markerToDelete) {
                // 检查是否是特殊点标记
                const isSpecialStationMarker = stationData.some(s => 
                    Math.abs(s.latitude - station.latitude) < 1e-6 && 
                    Math.abs(s.longitude - station.longitude) < 1e-6
                );
                
                // 如果不是特殊点标记，则删除
                if (!isSpecialStationMarker) {
                    map.removeLayer(markerToDelete);
                    // 从markers数组中删除
                    const markerIndex = markers.indexOf(markerToDelete);
                    if (markerIndex > -1) {
                        markers.splice(markerIndex, 1);
                    }
                    // 从editableMarkers数组中删除
                    const editableIndex = editableMarkers.indexOf(markerToDelete);
                    if (editableIndex > -1) {
                        editableMarkers.splice(editableIndex, 1);
                    }
                }
            }
            
            // 重新创建距离标记和红色矩形框（包含特殊站点标记保护）
            recreateDistanceAndRectMarkers();
            
            // 重新绘制折线
            if (routePoints.length > 0) {
                if (allowAddingStations) {
                    // 新增路线模式，使用currentRoutePolyline
                    currentRoutePolyline = L.polyline(routePoints, { color: 'red', weight: 3 }).addTo(map);
                    currentPolyline = null;
                } else {
                    // 编辑模式，使用currentPolyline
                    currentPolyline = L.polyline(routePoints, { color: 'red' }).addTo(map);
                    currentRoutePolyline = null;
                }
            }
            
            // 只隐藏当前信息框，不影响容器和其他信息框
            const infoBox = document.getElementById(`pointInfoBox-${boxIndex}`);
            if (infoBox) infoBox.style.display = 'none';
            
            cocoMessage.success("点已删除");
        } else {
            cocoMessage.error("未找到要删除的点");
        }
        return;
    }
    
    // 找到当前选中的路线
    const routeSelect = document.getElementById('routeSelect');
    const selectedRouteId = routeSelect.value;
    const selectedRoute = alldata.find(r => r.routeId == selectedRouteId);
    
    if (selectedRoute) {
        // 从路线的stations数组中删除对应的点
        const stationIndex = selectedRoute.stations.findIndex(s => 
            s.stationId == stationId || s.id == stationId
        );
        
        if (stationIndex > -1) {
            // 删除点
            selectedRoute.stations.splice(stationIndex, 1);
            
            // 重新渲染路线
            routePoints = selectedRoute.stations.map(station => [station.latitude, station.longitude]);
            
            // 清除现有的标记、折线和距离标记（但保留特殊点标记）
            if (currentRoutePolyline) map.removeLayer(currentRoutePolyline);
            
            // 只清除非特殊点标记
            editableMarkers.forEach(marker => {
                const markerPos = marker.getLatLng();
                const isSpecialStation = stationData.some(station => 
                    Math.abs(station.latitude - markerPos.lat) < 1e-6 && 
                    Math.abs(station.longitude - markerPos.lng) < 1e-6
                );
                
                // 如果不是特殊点标记，则删除
                if (!isSpecialStation) {
                    map.removeLayer(marker);
                }
            });
            
            // 从editableMarkers数组中移除非特殊点标记
            editableMarkers = editableMarkers.filter(marker => {
                const markerPos = marker.getLatLng();
                return stationData.some(station => 
                    Math.abs(station.latitude - markerPos.lat) < 1e-6 && 
                    Math.abs(station.longitude - markerPos.lng) < 1e-6
                );
            });
            
            // 重新创建距离标记和红色矩形框（包含特殊站点标记保护）
            recreateDistanceAndRectMarkers();
            
            // 重新创建标记
            selectedRoute.stations.forEach((station, index) => {
                const latlng = [station.latitude, station.longitude];
                const isLastStation = index === selectedRoute.stations.length - 1;
                const marker = L.marker(latlng, {
                    draggable: true,
                    icon: isLastStation ? specialIcon : defaultIcon,
                }).addTo(map);
                
                marker.bindTooltip(`s${index + 1}`, {
                    permanent: true,
                    direction: 'right',
                    offset: [10, 0],
                    className: 'station-label'
                });
                
                // 关键：添加点击事件，显示弹窗
                marker.on('click', function (e) {
                    e.originalEvent.stopPropagation();
                    const currentLatLng = e.target.getLatLng();
                    const overlappingStations = [];
                    
                    // 如果没有重叠点，显示当前点的信息
                    if (overlappingStations.length === 0) {
                        overlappingStations.push({
                            latitude: station.latitude,
                            longitude: station.longitude,
                            stationName: station.stationName || `站点${index + 1}`,
                            direction: station.direction || '',
                            speed: station.speed || '',
                            id: station.id || `temp_${index}`,
                            stationId: station.stationId || station.id || `temp_${index}`,
                            index: index
                        });
                    }
                    // 显示所有重叠点的信息框
                    showMultiplePointInfoBoxes(e, overlappingStations);
                });

                marker.on('dragend', function (e) {
                    
                    const newLatlng = e.target.getLatLng();
                    const oldLat = selectedRoute.stations[index].latitude;
                    const oldLng = selectedRoute.stations[index].longitude;
                    
                    // 更新经纬度
                    selectedRoute.stations[index].latitude = newLatlng.lat;
                    selectedRoute.stations[index].longitude = newLatlng.lng;
                    routePoints[index] = [newLatlng.lat, newLatlng.lng];
                    updateRoutePolyline(routePoints);
                    
                    // 更新tempRouteStations中的对应数据，保留原始属性
                    if (window.tempRouteStations && window.tempRouteStations.length > 0) {
                        const tempStationIndex = window.tempRouteStations.findIndex(s => 
                            Math.abs(s.latitude - oldLat) < 1e-6 && 
                            Math.abs(s.longitude - oldLng) < 1e-6
                        );
                        
                        if (tempStationIndex > -1) {
                            // 更新暂存数据中的经纬度，保留其他属性
                            window.tempRouteStations[tempStationIndex].latitude = newLatlng.lat;
                            window.tempRouteStations[tempStationIndex].longitude = newLatlng.lng;
                        }
                    }
                });

                editableMarkers.push(marker);
                markers.push(marker);
            });
            
            // 重新绘制折线
            updateRoutePolyline(routePoints);
            
            // 只隐藏当前信息框，不影响容器和其他信息框
            const infoBox = document.getElementById(`pointInfoBox-${boxIndex}`);
            if (infoBox) infoBox.style.display = 'none';
            
            cocoMessage.success("点已删除");
        } else {
            cocoMessage.error("未找到要删除的点");
        }
    } else {
        cocoMessage.error("请先选择一条路线");
    }
}

// 全局函数：创建单个点的信息框
function createSinglePointInfoBox(station, index, boxIndex) {
    const infoBox = document.createElement('div');
    infoBox.id = `pointInfoBox-${boxIndex}`;
    infoBox.className = 'point-info-box';
    // 紧凑样式：减小内边距和字体
    infoBox.style.padding = '8px 10px';
    infoBox.style.backgroundColor = 'white';
    infoBox.style.border = '1px solid #eee';
    infoBox.style.borderRadius = '4px';
    infoBox.style.fontSize = '14px'; // 缩小字体

    // 检查localStorage中的currentInterface值
    const currentInterface = localStorage.getItem('currentInterface');
    // 当currentInterface为1时，不显示保存按钮
    const showSaveButton = currentInterface !== '1';
    // 当currentInterface为1时，禁用除取消按钮外的所有输入框和选择框
    const disableInputs = currentInterface === '1';

    window.handleDirectionRadio = function (stationId, boxIndex, value) {
        // 构建输入框ID（与HTML中保持一致）
        const inputId = `direction-${stationId}-${boxIndex}`;
        const directionInput = document.getElementById(inputId);

        if (value === "360") {
            // 处理"指向下一个点"选项
            if (directionInput) {
                directionInput.value = "";  // 强制清空值，不显示任何值
                directionInput.placeholder = "指向下一个点";  // 可选：提示当前状态
                // 存储实际值到自定义属性中 - 修正为360
                directionInput.setAttribute('data-actual-value', '360');
            }
        } else if (value === "-360") {
            // 处理"保持当前方向"选项
            if (directionInput) {
                directionInput.value = "";  // 强制清空值，不显示任何值
                directionInput.placeholder = "保持当前方向";  // 可选：提示当前状态
                // 存储实际值到自定义属性中 - 修正为-360
                directionInput.setAttribute('data-actual-value', '-360');
            }
        }
    };
    // 内容保持不变，但输入框尺寸优化
    // 获取当前选中的路线
    const selectedRouteId = document.getElementById('routeSelect').value;
    let routeSpeed = station.routeSpeed || ''; // 优先使用station对象中的routeSpeed属性
    
    if (!routeSpeed && selectedRouteId && alldata) {
        const selectedRoute = alldata.find(r => r.routeId == selectedRouteId);
        if (selectedRoute) {
            // 获取路线速度
            routeSpeed = selectedRoute.speed || '';
        }
    }
    
    // 判断是否为新增模式（stationId为null或undefined）
    const isNewMode = !station.stationId || station.stationId === 'null' || station.stationId === null;
    
    // 如果是新增模式且有选中的路线，则显示路线速度输入框
    const showRouteSpeed = false;
    
    // 判断是否为特殊点
    const isSpecialStation = stationData && stationData.some(s => 
        Math.abs(s.latitude - station.latitude) < 1e-6 && 
        Math.abs(s.longitude - station.longitude) < 1e-6
    );
    
    // 判断是否为最后一个站点
    let isLastStation = false;
    if (selectedRouteId && alldata) {
        const selectedRoute = alldata.find(r => r.routeId == selectedRouteId);
        if (selectedRoute && selectedRoute.stations) {
            isLastStation = index === selectedRoute.stations.length - 1;
        }
    }
    
    // 获取全局设置
    const globalRouteSpeed = localStorage.getItem('globalRouteSpeed') || "0.2";
    const globalDefaultDirection = localStorage.getItem('globalDefaultDirection') || '0';
    const globalNavigationMode = localStorage.getItem('globalNavigationMode') || '1';
    const globalActionSelect = localStorage.getItem('globalActionSelect') || '0';
    const globalObstacleLevel = localStorage.getItem('globalObstacleLevel') || '1';
    const globalLanechange = localStorage.getItem('globalLanechange') || '0';
    const globalTurnMode = localStorage.getItem('globalTurnMode') || '0';
    
    // 如果是特殊点且没有设置对应属性，则使用全局设置
    const stationSpeed = isSpecialStation && !station.speed ? globalRouteSpeed : (station.speed || '');
    const stationDirection = isSpecialStation && !station.direction ? globalDefaultDirection : (station.direction || '');
    const stationPosition = isSpecialStation && !station.position ? globalNavigationMode : (station.position || '');
    const stationAction = isSpecialStation && !station.action ? globalActionSelect : (station.action || '');
    const stationArea = isSpecialStation && !station.area ? globalObstacleLevel : (station.area || '');
    const stationLanechange = isSpecialStation && !station.lanechange ? globalLanechange : (station.lanechange || '0');
    const stationRunmode = isSpecialStation && !station.runmode ? globalTurnMode : (station.runmode || '');
    
    // 记录特殊点使用全局设置的情况
 
    
    infoBox.innerHTML = `
<div><strong>第${index + 1}个点 </strong></div>
<div>站点名称:<input class="param-input" id="stationName-${station.stationId}-${boxIndex}" value='${station.stationName || ""}' style="width: 160px;" ${disableInputs ? 'disabled' : ''}></input></div>
<div>站点速度:<input type="number" value='${stationSpeed}' id="speed-${station.stationId}-${boxIndex}" class="param-input" placeholder="速度(m/s)" step="0.1" min="0" max="1" style="width: 160px;" ${disableInputs ? 'disabled' : ''}></div>
${showRouteSpeed ? `<div>路线速度:<input type="number" value='${routeSpeed}' id="routeSpeed-${station.stationId}-${boxIndex}" class="param-input" placeholder="路线速度(m/s)" step="0.1" min="0" max="1" style="width: 160px;" ${disableInputs ? 'disabled' : ''}></div>` : ''}
<div class="direction-container" style="margin: 5px 0;">
<label>机器朝向:</label>
<input type="number" 
       id="direction-${station.stationId}-${boxIndex}" 
       class="param-input direction-input" 
       placeholder="方向(°)" 
       step="1" 
       min="-180" 
       max="180"
       value='${stationDirection == "360" || stationDirection == "-360" ? "" : (stationDirection == "0" || stationDirection == "0.0" ? "" : stationDirection)}'
       data-actual-value='${stationDirection}'
       style="width: 100px;"
       ${disableInputs ? 'disabled' : ''}
       oninput="handleDirectionInput('${station.stationId}', ${boxIndex})"
       onblur="handleDirectionBlur('${station.stationId}', ${boxIndex})"> <!-- 新增失焦验证 -->
  <button 
       class="calculate-direction-btn" 
       style="margin-left: 5px; padding: 2px 6px; font-size: 12px; background-color: #28a745; color: white; border: none; border-radius: 3px; cursor: pointer; ${showSaveButton ? '' : 'display: none;'}"
       onclick="calculateDirectionFromPoints('${station.stationId}', ${boxIndex}, ${station.latitude}, ${station.longitude})"
       title="点击计算方向"
       ${disableInputs ? 'disabled' : ''}>
    使用箭头绘制
  </button>
  <div class="direction-radios" style="margin-top: 3px;margin-left: 68px;">
<label style="font-size: 13px; ${isLastStation ? 'display: none;' : ''}">
  <input type="radio" 
         name="direction-option-${station.stationId}-${boxIndex}" 
         value="360"
         ${stationDirection === "360" ? 'checked' : ''}
         ${disableInputs ? 'disabled' : ''}
         onchange="handleDirectionRadio('${station.stationId}', ${boxIndex}, this.value)">
  指向下一个点
</label>
<label style="font-size: 13px; ${index === 0 ? 'display: none;' : ''}">
  <input type="radio" 
         name="direction-option-${station.stationId}-${boxIndex}" 
         value="-360"
         ${stationDirection === "-360" || stationDirection === "0" || stationDirection === '0.0' ? 'checked' : ''}
         ${disableInputs ? 'disabled' : ''}
         onchange="handleDirectionRadio('${station.stationId}', ${boxIndex}, this.value)">
  保持当前方向
</label>
  </div>
</div>
<div style="display:none;">动作选择:
  <select id="task-${station.stationId}-${boxIndex}"   style="width: 160px;" ${disableInputs ? 'disabled' : ''}>
    <option value="0">任务1</option>
    <option value="1">任务2</option>
    <option value="2">任务3</option>
    <option value="3">任务4</option>
  </select>
</div>
<div>定位模式:
  <select id="position-${station.stationId}-${boxIndex}"  style="width: 160px;" ${disableInputs ? 'disabled' : ''}>
    <option value="1">室内</option>
    <option value="2">室外</option>
  </select>
</div>
<div style="display:none;">避障等级:
  <select id="obstacle-${station.stationId}-${boxIndex}"  style="width: 160px;" ${disableInputs ? 'disabled' : ''}>
    <option value="1">等级1</option>
    <option value="2">等级2</option>
    <option value="3">等级3</option>
    <option value="4">等级4</option>
  </select>
</div>
<div>变道绕障:
  <select id="lanechange-${station.stationId}-${boxIndex}"  style="width: 160px;" ${disableInputs ? 'disabled' : ''}>
    <option value="0">禁止变道</option>
    <option value="1">左侧变道</option>
    <option value="2">右侧变道</option>
    <option value="3">左右都可以变道</option>
  </select>
</div>
<div style="margin: 5px 0;">
  <label>停障反应距离:</label>
  <input type="number" 
         id="avoidDistance-${station.stationId}-${boxIndex}" 
         style="width: 140px; margin-left: 5px;" 
         min="0" 
         step="0.1" 
         value="${station.avoidDistance || 0.5}" 
         ${disableInputs ? 'disabled' : ''}>
  <span style="margin-left: 5px; font-size: 12px;">米</span>
</div>
<div class="stop-container" style="margin: 5px 0; display:flex; align-items: center;">
<label>是否停车:</label>
<div class="stop-radios" style="margin-top: 3px;">
<label style="font-size: 13px; display:flex; margin-right: 10px;">
  <input type="radio" 
         name="stop-option-${station.stationId}-${boxIndex}" 
         value="1"
         ${station.stop === "1" || station.stop === 1 ? 'checked' : ''}
         ${disableInputs ? 'disabled' : ''}>
  <div class="isStop">是</div>
</label>
<label style="font-size: 13px;">
  <input type="radio" 
         name="stop-option-${station.stationId}-${boxIndex}" 
         value="0"
         ${station.stop === "0" || station.stop === 0 || station.stop === undefined || station.stop === null ? 'checked' : ''}
         ${disableInputs ? 'disabled' : ''}>
  否
</label>
</div>
</div>
<div class="runmode-container" style="margin: 5px 0; display:flex; align-items: center;">
<label>转弯模式:</label>
<div class="runmode-radios" style="margin-top: 3px;">

<label style="font-size: 13px;">
  <input type="radio" 
         name="runmode-option-${station.stationId}-${boxIndex}" 
         value="1"
         ${stationRunmode === "1" || stationRunmode === 1 || stationRunmode === undefined || stationRunmode === null ? 'checked' : ''}
         ${disableInputs ? 'disabled' : ''}>
  自转模式
</label>
<label style="font-size: 13px; display:flex; margin-right: 10px;">
  <input type="radio" 
         name="runmode-option-${station.stationId}-${boxIndex}" 
         value="0"
         ${stationRunmode === "0" || stationRunmode === 0 ? 'checked' : ''}
         ${disableInputs ? 'disabled' : ''}>
  <div class="isRunmode">连续模式</div>
</label>
</div>
</div>
${showSaveButton ? `<button class="save-point-btn btn btn-success" style="margin-top: 5px; margin-right: 5px;" data-station-id="${station.stationId}" data-box-index="${boxIndex}">保存</button>` : ''}
<button 
  class="delete-point-btn btn btn-danger" 
  style="margin-top: 5px; margin-right: 5px; display: ${deleteBtnStatus ? 'inline-block' : 'none'};" 
  data-station-id="${station.stationId}" 
  data-box-index="${boxIndex}"
  ${disableInputs ? 'disabled' : ''}
>
  删除                                      
</button>
<button class="add-point-btn btn btn-primary" style="margin-top: 5px; display: ${deleteBtnStatus ? 'inline-block' : 'none'};  margin-right: 5px;" data-station-id="${station.stationId}" data-box-index="${boxIndex}" data-station-lat="${station.latitude}" data-station-lng="${station.longitude}" ${disableInputs ? 'disabled' : ''}>增加</button>
<button class="cancel-point-btn btn btn-secondary" style="margin-top: 5px;" data-station-id="${station.stationId}" data-box-index="${boxIndex}">取消</button>
`;
    // 设置避障等级默认值
    const obstacleSelect = infoBox.querySelector(`#obstacle-${station.stationId}-${boxIndex}`);
    if (obstacleSelect) {
        // 确保值为字符串类型，与option的value类型匹配
        obstacleSelect.value = String(stationArea);
    }
    const taskSelect = infoBox.querySelector(`#task-${station.stationId}-${boxIndex}`);
    if (taskSelect) {
        
        // 确保值为字符串类型，与option的value类型匹配
        taskSelect.value = String(stationAction);
    }
    const positionSelect = infoBox.querySelector(`#position-${station.stationId}-${boxIndex}`);
    if (positionSelect) {
        // 确保值为字符串类型，与option的value类型匹配
        positionSelect.value = String(stationPosition);
    }
    const lanechangeSelect = infoBox.querySelector(`#lanechange-${station.stationId}-${boxIndex}`);
    if (lanechangeSelect) {
        // 确保值为字符串类型，与option的value类型匹配
        // 即使lanechange为0或空字符串也要设置，因为0是有效的选项值（禁止变道）
        lanechangeSelect.value = String(stationLanechange);
    }
    
    // 处理方向输入框和单选按钮的状态
    const directionInput = infoBox.querySelector(`#direction-${station.stationId}-${boxIndex}`);
    if (directionInput) {
        // 如果方向值是360或-360，清空输入框并设置相应的占位符
        if (stationDirection === "360") {
            directionInput.value = "";
            directionInput.placeholder = "指向下一个点";
            directionInput.setAttribute('data-actual-value', '360');
        } else if (stationDirection === "-360") {
            directionInput.value = "";
            directionInput.placeholder = "保持当前方向";
            directionInput.setAttribute('data-actual-value', '-360');
        } else if (stationDirection === "0" || stationDirection === "0.0") {
            // 对于0或0.0值，也视为"保持当前方向"
            directionInput.value = "";
            directionInput.placeholder = "保持当前方向";
            directionInput.setAttribute('data-actual-value', '-360');
        } else {
            // 对于其他值，显示实际值
            directionInput.value = stationDirection || "";
            directionInput.placeholder = "方向(°)";
            directionInput.setAttribute('data-actual-value', stationDirection || "");
        }
    }
    window.handleDirectionBlur = function (stationId, boxIndex) {
        const input = document.getElementById(`direction-${stationId}-${boxIndex}`);
        if (!input) return;

        const value = parseFloat(input.value);
        if (isNaN(value)) {
            input.value = ''; // 非数字清空
            return;
        }

        // 强制修正超出范围的值
        if (value < -180) {
            input.value = -180;
        } else if (value > 180) {
            input.value = 180;
        }
    };

    // 修改全局的handleDirectionInput函数（确保在window作用域下）
    window.handleDirectionInput = function (stationId, boxIndex) {
        const input = document.getElementById(`direction-${stationId}-${boxIndex}`);
        if (!input) return;

        // 当用户在输入框中输入数据时，取消单选框的选中状态
        const radio360 = document.querySelector(`input[name="direction-option-${stationId}-${boxIndex}"][value="360"]`);
        const radioMinus360 = document.querySelector(`input[name="direction-option-${stationId}-${boxIndex}"][value="-360"]`);
        
        if (radio360) radio360.checked = false;
        if (radioMinus360) radioMinus360.checked = false;

        // 1. 清除可能存在的错误提示
        const existingError = input.nextElementSibling?.classList.contains('direction-error')
            ? input.nextElementSibling
            : null;
        if (existingError) {
            existingError.remove();
        }

        // 2. 验证输入值
        const value = parseFloat(input.value);
        if (isNaN(value)) {
            input.value = ''; // 非数字清空
            // 清除自定义属性，表示用户手动输入
            input.removeAttribute('data-actual-value');
            return;
        }

        // 3. 强制修正超出范围的值
        if (value < -180) {
            input.value = -180;
        } else if (value > 180) {
            input.value = 180;
        }
        
        // 4. 清除自定义属性，表示用户手动输入
        input.removeAttribute('data-actual-value');
    };
    
    // 添加handleDirectionRadio函数，处理单选框选择时清空输入框
    window.handleDirectionRadio = function(stationId, boxIndex, value) {
        const input = document.getElementById(`direction-${stationId}-${boxIndex}`);
        if (!input) return;
        
        // 当用户选择单选框时，清空输入框的值
        input.value = '';
        // 设置正确的data-actual-value属性，表示用户选择的单选框值
        input.setAttribute('data-actual-value', value);
        
        // 可以添加其他逻辑，比如更新站点的方向值
        // 这里value参数是单选框的值（360或-360）
    };

    // 关键：遍历所有内部元素，阻止点击冒泡
    const innerElements = infoBox.querySelectorAll('input, select, button, label');
    innerElements.forEach(el => {
        el.addEventListener('click', function (e) {
            e.stopPropagation();
            e.originalEvent && e.originalEvent.stopPropagation();
            
            // 移除previewLine和previewDistanceMarker图层
            if (previewLine) { 
                map.removeLayer(previewLine); 
                previewLine = null; 
            } 
            if (previewDistanceMarker) { 
                map.removeLayer(previewDistanceMarker); 
                previewDistanceMarker = null; 
            }
        });
    });
    
    // 保存按钮事件
    const saveBtn = infoBox.querySelector('.save-point-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', function () {
            // 移除previewLine和previewDistanceMarker图层
            if (previewLine) { 
                map.removeLayer(previewLine); 
                previewLine = null; 
            } 
            if (previewDistanceMarker) { 
                map.removeLayer(previewDistanceMarker); 
                previewDistanceMarker = null; 
            }
            
            const stationId = this.getAttribute('data-station-id');
            const boxIndex = this.getAttribute('data-box-index');
          
 
            savePointInfo(stationId, boxIndex, station);
            
            // 移除选中站点的标记
            if (selectedStationMarker) {
                map.removeLayer(selectedStationMarker);
                selectedStationMarker = null;
            }
        });
    }
    
    // 删除按钮事件
    const deleteBtn = infoBox.querySelector('.delete-point-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', function () {
            // 移除previewLine和previewDistanceMarker图层
            if (previewLine) { 
                map.removeLayer(previewLine); 
                previewLine = null; 
            } 
            if (previewDistanceMarker) { 
                map.removeLayer(previewDistanceMarker); 
                previewDistanceMarker = null; 
            }
            
            const stationId = this.getAttribute('data-station-id');
            const boxIndex = this.getAttribute('data-box-index');
            deletePointInfo(stationId, boxIndex, station);
            
            // 移除选中站点的标记
            if (selectedStationMarker) {
                map.removeLayer(selectedStationMarker);
                selectedStationMarker = null;
            }
        });
    }
    
    // 增加按钮事件
    infoBox.querySelector('.add-point-btn').addEventListener('click', function () {
        // 移除previewLine和previewDistanceMarker图层
        if (previewLine) { 
            map.removeLayer(previewLine); 
            previewLine = null; 
        } 
        if (previewDistanceMarker) { 
            map.removeLayer(previewDistanceMarker); 
            previewDistanceMarker = null; 
        }
        
        const stationId = this.getAttribute('data-station-id');
        const boxIndex = this.getAttribute('data-box-index');
        const stationLat = parseFloat(this.getAttribute('data-station-lat'));
        const stationLng = parseFloat(this.getAttribute('data-station-lng'));
        
        // 获取当前选中的路线
        const selectedRouteId = document.getElementById('routeSelect') ? document.getElementById('routeSelect').value : null;
        let selectedRoute = null;
        
        // 检查是否选择了现有路线
        if (selectedRouteId) {
            selectedRoute = alldata.find(r => r.routeId == selectedRouteId);
            if (!selectedRoute) {
                cocoMessage.error("未找到选中的路线");
                return;
            }
        }
        
        // 检查是否是新增路线模式（没有选择现有路线，但routePoints中有点）
        const isNewRouteMode = !selectedRouteId && routePoints.length > 0;
        
        // 如果既没有选择路线，也没有新增路线点，则提示用户
        if (!selectedRouteId && routePoints.length === 0) {
            cocoMessage.error("请先选择一条路线或在地图上添加路线起点");
            return;
        }
        
        // 获取当前路线的最后一个点
        const lastPoint = routePoints[routePoints.length - 1];
        
        // 检查当前站点是否已经是路线的最后一个点
        const isLastPoint = Math.abs(lastPoint.lat - stationLat) < 1e-6 && Math.abs(lastPoint.lng - stationLng) < 1e-6;
        if (isLastPoint) {
            cocoMessage.warning("当前站点已经是路线的最后一个点");
            return;
        }
        
        // 检查当前站点是否已经在路线中
        let isStationInRoute = false;
        if (selectedRoute) {
            isStationInRoute = selectedRoute.stations.some(station => 
                Math.abs(station.latitude - stationLat) < 1e-6 && 
                Math.abs(station.longitude - stationLng) < 1e-6
            );
        } else {
            // 在新增路线模式下，检查routePoints中是否已存在该点
            isStationInRoute = routePoints.some(point => 
                Math.abs(point.lat - stationLat) < 1e-6 && 
                Math.abs(point.lng - stationLng) < 1e-6
            );
        }
        
        // 允许复用已存在于路线中的站点
        if (isStationInRoute) {
        }
        
        // 将当前站点添加到路线中
        const stationLatLng = L.latLng(stationLat, stationLng);
        addToRoute(stationLatLng);
        
        // 根据模式处理站点数据
        if (selectedRoute) {
            // 现有路线模式：将站点添加到selectedRoute.stations中
            // 查找当前站点对应的stationData
            const stationDataItem = stationData.find(s => 
                Math.abs(s.latitude - stationLat) < 1e-6 && 
                Math.abs(s.longitude - stationLng) < 1e-6
            );
            
            // 如果找到了stationData，将其添加到selectedRoute.stations中
            if (stationDataItem) {
                const newStation = {
                    ...stationDataItem,
                    latitude: stationLat,
                    longitude: stationLng
                };
                selectedRoute.stations.push(newStation);
            } else {
                // 如果没有找到对应的stationData，创建一个新的站点
                const newStation = {
                    stationId: stationId,
                    stationName: `站点${selectedRoute.stations.length + 1}`,
                    latitude: stationLat,
                    longitude: stationLng,
                    positionX: "0",
                    positionY: "0", 
                    positionZ: "0",
                    orientationX: "0",
                    orientationY: "0",
                    orientationZ: index === 0 ? "0" : "0.707",
                    orientationW: index === 0 ? "1" : "0.707",
                    speed: tempStation ? tempStation.speed : (originalStation ? originalStation.speed : (localStorage.getItem('globalRouteSpeed') || "0.2")),
                    action: tempStation ? tempStation.action : (originalStation ? originalStation.action : (localStorage.getItem('globalActionSelect') || "0")),
                    area: tempStation ? tempStation.area : (originalStation ? originalStation.area : (localStorage.getItem('globalObstacleLevel') || "1")),
                    direction: tempStation ? tempStation.direction : (originalStation ? originalStation.direction : (localStorage.getItem('globalDefaultDirection') || '0')),
                    stopTime:  "0",
                    position: tempStation ? tempStation.position : (originalStation ? originalStation.position : (localStorage.getItem('globalNavigationMode') || "1")),
                    stop: tempStation ? tempStation.stop : (originalStation ? originalStation.stop : "0"),
                    runmode: tempStation ? tempStation.runmode : (originalStation ? originalStation.runmode : (localStorage.getItem('globalTurnMode') || "0")),
                        lanechange: tempStation ? tempStation.lanechange : (originalStation ? originalStation.lanechange : (localStorage.getItem('globalLanechange') || "0")),
                        avoidDistance: tempStation ? tempStation.avoidDistance : (originalStation ? originalStation.avoidDistance : (localStorage.getItem('globalAvoidDistance') || "0.5"))
                };
                selectedRoute.stations.push(newStation);
            }
            
            // 更新routePoints数组
            routePoints = selectedRoute.stations.map(station => 
                L.latLng(station.latitude, station.longitude)
            );
        } else {
            // 新增路线模式：routePoints已经由addToRoute更新，不需要额外处理
            // 但需要确保routePoints中的坐标是LatLng对象
            routePoints = routePoints.map(point => {
                if (typeof point.lat === 'function') {
                    return point; // 已经是LatLng对象
                } else {
                    return L.latLng(point.lat || point[0], point.lng || point[1]);
                }
            });
        }
        
        // 重新绘制路线
        updateRoutePolyline(routePoints);
        
        // 隐藏当前信息框
        const infoBox = document.getElementById(`pointInfoBox-${boxIndex}`);
        if (infoBox) infoBox.style.display = 'none';
        
        // 移除选中站点的标记
        if (selectedStationMarker) {
            map.removeLayer(selectedStationMarker);
            selectedStationMarker = null;
        }
        
        cocoMessage.success("已将当前站点添加到路线中");
    });
    
    // 取消按钮事件
    infoBox.querySelector('.cancel-point-btn').addEventListener('click', function () {
        // 移除previewLine和previewDistanceMarker图层
        if (previewLine) { 
            map.removeLayer(previewLine); 
            previewLine = null; 
        } 
        if (previewDistanceMarker) { 
            map.removeLayer(previewDistanceMarker); 
            previewDistanceMarker = null; 
        }
        
        const boxIndex = this.getAttribute('data-box-index');
        // 隐藏当前信息框，使用与保存按钮相同的隐藏逻辑
        const infoBox = document.getElementById(`pointInfoBox-${boxIndex}`);
        if (infoBox) infoBox.style.display = 'none';
        
        // 移除选中站点的标记
        if (selectedStationMarker) {
            map.removeLayer(selectedStationMarker);
            selectedStationMarker = null;
        }
    });

    return infoBox;
}

function toggleDragEvent() {
    dragStatus = !dragStatus;
    document.getElementById("dragButton").innerText = dragStatus ? "关闭拖动" : "开启拖动";
    markers.forEach(marker => {
        if (dragStatus) {
            marker.dragging.enable();
        } else {
            marker.dragging.disable();
        }
    });
}


async function populateRouteSelect(selectLast = false, selectId) {
    if (previewLine) {
        map.removeLayer(previewLine);
        previewLine = null;
    }
    if (previewDistanceMarker) {
        map.removeLayer(previewDistanceMarker);
        previewDistanceMarker = null;
    }
    
    // 清除所有距离标记
    distanceMarkers.forEach(marker => {
        // 移除所有事件监听器
        try {
            marker.off();
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        } catch (e) {
            console.warn('清除距离标记时出错:', e);
        }
    });
    distanceMarkers = [];
    
    // 清除所有可拖动矩形标记
    draggableRectMarkers.forEach(marker => {
        // 移除所有事件监听器
        try {
            marker.off();
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        } catch (e) {
            console.warn('清除矩形标记时出错:', e);
        }
    });
    draggableRectMarkers = [];

    // callbackStatus = 2
    const defaultIcon = L.icon({
        iconUrl: '../plugins/img/原点.png',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
    });
    let currentSelectId = selectId;
    const specialIcon = L.icon({
        iconUrl: '../plugins/img/中文终点.svg', // 终点标记图片路径
        iconSize: [25, 25],
        iconAnchor: [12.5, 25]
    });
    const startIcon = L.icon({
        iconUrl: '../plugins/img/中文起点.svg', // 起点标记图片路径
        iconSize: [25, 25],
        iconAnchor: [12.5, 25]
    });
    const selectElement = document.getElementById('routeSelect');
    const stationInfoDisplay = document.createElement('div');
    stationInfoDisplay.id = "stationInfoDisplay";
    document.querySelector('.bottomBox').appendChild(stationInfoDisplay);

    selectElement.innerHTML = "";
    if (selectElement.options.length === 0 || selectElement.options[0].value !== '') {
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '请选择路线';
        defaultOption.disabled = true;
        defaultOption.selected = true;
        selectElement.appendChild(defaultOption);
    }

    if (alldata && alldata.length) {
        let lastRouteId = null; // 记录最后一个 routeId
        alldata.forEach((item, index) => {
            let option = document.createElement('option');
            option.value = item.routeId;
            option.textContent = `路线${index + 1}: ${item.routeName}`;
            selectElement.appendChild(option);
            lastRouteId = item.routeId; // 更新到最后一个 routeId
        });

        if (selectLast && lastRouteId) {
            selectElement.value = lastRouteId;
            selectElement.dispatchEvent(new Event('change'));
        } else if (currentSelectId) {
            selectElement.value = currentSelectId;
            selectElement.dispatchEvent(new Event('change'));
        }
    } else {
        const noDataOption = document.createElement('option');
        noDataOption.value = '';
        noDataOption.textContent = '无可用路线';
        noDataOption.disabled = true;
        selectElement.appendChild(noDataOption);
    }

    selectElement.addEventListener('change', function (e) {
        let imgEdit = document.getElementById("imgEdit")
        imgEdit.src = '../plugins/img/img-right/编辑.png';
        document.querySelector(".text-edit").textContent = "开始编辑";
        map.off('mousemove', handleMouseMoveLine);
        allowAddingStations = false;
        editStatus = false
        
        // 重置新增路线相关状态变量，确保选择已有路线时退出新增模式
        window.isAddingToExistingRoute = false;
        window.isNewRouteMode = false;
        window.tempRouteStations = [];
        
        clearAllRoutes()
        // 修改clearExistingMarkers调用，确保特殊点标记不受影响
        clearExistingMarkers();

        if (e.target.value) {
            if (currentRoutePolyline) map.removeLayer(currentRoutePolyline);
            editableMarkers.forEach(marker => map.removeLayer(marker));
            editableMarkers = [];
            const selectedRoute = alldata.find(r => r.routeId == e.target.value);
            if (selectedRoute) {
           
                // 使用全局currentRouteMsg变量，直接从selectedRoute.stations获取数据
                currentRouteMsg = selectedRoute.stations;
                if (currentRouteMsg) {
                    currentRouteMsg.forEach((item, index) => {
                        item.index = index
                    })
                }
                routePoints = selectedRoute.stations.map(station => [station.latitude, station.longitude]);
                selectedRoute.stations.forEach((station, index) => {
                    const latlng = [station.latitude, station.longitude];
                    const isFirstStation = index === 0; // 判断是否为第一个站点（起点）
                    const isLastStation = index === selectedRoute.stations.length - 1; // 判断是否为最后一个站点（终点）
                    const isStopStation = station.stop === "1" || station.stop === 1;
                    const isZeroStopStation = station.stop === "0" || station.stop === 0;
                    
                    // 检查该位置是否已存在特殊站点标记
                    const existingSpecialMarker = markers.find(marker => {
                        const markerLatLng = marker.getLatLng();
                        return Math.abs(station.latitude - markerLatLng.lat) < 1e-6 && 
                               Math.abs(station.longitude - markerLatLng.lng) < 1e-6;
                    });
                    
                    // 检查该位置是否为特殊站点位置
                    const isSpecialStationPosition = stationData.some(s => 
                        Math.abs(s.latitude - station.latitude) < 1e-6 && 
                        Math.abs(s.longitude - station.longitude) < 1e-6
                    );
                    
                    // 创建停车站点图标
                    const stopIcon = L.icon({
                        iconUrl: '../plugins/img/任务进程.svg', // 停车站点图标，用户可以根据需要修改
                        iconSize: [25, 25],
                        iconAnchor: [12.5, 25]
                    });
                    
                    // 创建红色实心圆图标（用于stop值为0的情况）
                    const redCircleIcon = L.icon({
                        iconUrl: '../plugins/img/circle-fill.svg',
                        iconSize: [12, 12],
                        iconAnchor: [6, 6]
                    });
                    
                    const customIcon = L.icon({
                        iconUrl: '../plugins/img/坐标.svg',
                        iconSize: [22, 22],
                        iconAnchor: [11, 11]
                    });
    
                    let marker;
                    if (existingSpecialMarker) {
                        // 如果已存在特殊站点标记，则复用该标记
                        marker = existingSpecialMarker;
                        // 保存原始图标信息（如果还没有保存）
                        if (!marker.originalSpecialIcon) {
                            marker.originalSpecialIcon = marker.options.icon;
                        }
                        // 更新图标为路线图标（根据起点、终点、stop值选择不同图标）
                        if (isFirstStation) {
                            marker.setIcon(startIcon);
                        } else if (isLastStation) {
                            marker.setIcon(specialIcon);
                        } else if (isStopStation) {
                            marker.setIcon(stopIcon);
                        } else if (isZeroStopStation && !isSpecialStationPosition) {
                            // 如果是stop值为0的情况且不是特殊站点位置，才使用redCircleIcon
                            marker.setIcon(redCircleIcon);
                        }else if (isSpecialStationPosition && !isFirstStation && !isLastStation) {
                            marker.setIcon(customIcon);
                        } 
                        else  {
                            marker.setIcon(defaultIcon);
                        }
                        // 检查是否已有tooltip，如果没有则添加
                        if (!marker.getTooltip()) {
                            marker.bindTooltip(`${station.stationName}`, {
                                permanent: false,
                                direction: 'right',
                                offset: [10, 0],
                                className: 'station-label'
                            });
                        }
                    } else {
                        // 如果没有现有标记，则创建新标记
                        // 根据起点、终点和stop值选择不同的图标
                        let selectedIcon;
                        if (isFirstStation) {
                            selectedIcon = startIcon;
                        } else if (isLastStation) {
                            selectedIcon = specialIcon;
                        } else if (isStopStation) {
                            selectedIcon = stopIcon;
                        } else if (isZeroStopStation && !isSpecialStationPosition) {
                            // 如果是stop值为0的情况且不是特殊站点位置，才使用redCircleIcon
                            selectedIcon = redCircleIcon;
                        } else {
                            selectedIcon = defaultIcon;
                        }
                        
                        marker = L.marker(latlng, {
                            draggable: true,
                            icon: selectedIcon,
                        }).addTo(map);
                        // 新增：初始化 originalVisibility
                        marker.originalVisibility = {
                            icon: marker.options.icon,
                            tooltip: marker.options.tooltip // 如果有提示的话
                        };
                        marker.bindTooltip(`${station.stationName}`, {
                            permanent: false,
                            direction: 'right',
                            offset: [10, 0],
                            className: 'station-label'
                        });
                    }
                    // 关键：添加点击事件，显示弹窗
                    marker.on('click', function (e) {
                        e.originalEvent.stopPropagation(); // 阻止事件冒泡（避免触发地图点击关闭弹窗）
                        const currentLatLng = e.target.getLatLng();
                        const overlappingStations = currentRouteMsg ? findOverlappingStations(currentLatLng, currentRouteMsg) : [];
                        // 如果没有重叠点，显示当前点的信息
                        if (overlappingStations.length === 0) {
                            overlappingStations.push({
                                latitude: station.latitude,
                                longitude: station.longitude,
                                stationName: station.stationName || `站点${index + 1}`,
                                direction: station.direction || '',
                                speed: station.speed || '',
                                id: station.id || `temp_${index}`,
                                stationId: station.stationId || station.id || `temp_${index}`,
                                index: index
                            });
                        }
                        // 显示所有重叠点的信息框
                        showMultiplePointInfoBoxes(e, overlappingStations);
                    });

                    marker.on('dragend', function (e) {
                        const newLatlng = e.target.getLatLng();
                        
                        // 检查拖拽后的位置是否是特殊站点
                        const targetSpecialStation = stationData.find(station => 
                            Math.abs(station.latitude - newLatlng.lat) < 1e-6 && 
                            Math.abs(station.longitude - newLatlng.lng) < 1e-6
                        );
                        
                        // 如果是特殊站点，检查是否已经在当前路线中（排除当前站点本身）
                        if (targetSpecialStation && selectedRoute && selectedRoute.stations) {
                            const isDuplicate = selectedRoute.stations.some((existingStation, existingIndex) => 
                                existingIndex !== index && // 排除当前拖拽的站点本身
                                Math.abs(existingStation.latitude - targetSpecialStation.latitude) < 1e-6 && 
                                Math.abs(existingStation.longitude - targetSpecialStation.longitude) < 1e-6
                            );
                            
                            if (isDuplicate) {
                                cocoMessage.warning(`特殊站点"${targetSpecialStation.stationName}"已经存在于路线中，不能重复经过`);
                                // 恢复到原始位置
                                e.target.setLatLng([selectedRoute.stations[index].latitude, selectedRoute.stations[index].longitude]);
                                return;
                            }
                        }
                        
                        selectedRoute.stations[index].latitude = newLatlng.lat;
                        selectedRoute.stations[index].longitude = newLatlng.lng;
                        routePoints[index] = [newLatlng.lat, newLatlng.lng];
                        updateRoutePolyline(routePoints);
                        
                        // 更新拖拽后站点的图标
                        // 创建起点图标
                        const startIcon = L.icon({
                            iconUrl: '../plugins/img/英文起点.png',
                            iconSize: [25, 25],
                            iconAnchor: [10, 18]
                        });
                        
                        // 创建终点图标
                        const specialIcon = L.icon({
                            iconUrl: '../plugins/img/终点.png',
                            iconSize: [25, 25],
                            iconAnchor: [10, 18]
                        });
                        
                        // 创建停车站点图标
                        const stopIcon = L.icon({
                            iconUrl: '../plugins/img/任务进程.svg',
                            iconSize: [25, 25],
                            iconAnchor: [12.5, 25]
                        });
                        
                        // 创建红色实心圆图标（用于stop值为0的情况）
                        const redCircleIcon = L.icon({
                            iconUrl: '../plugins/img/圆圈.png',
                            iconSize: [12, 12],
                            iconAnchor: [6, 6]
                        });
                        
                        // 创建默认图标
                        const defaultIcon = L.icon({
                            iconUrl: '../plugins/img/原点.png',
                            iconSize: [25, 25],
                            iconAnchor: [12, 12]
                        });
                        
                        // 判断是否是起点、终点、停车站点或其他站点
                        const isFirstStation = index === 0;
                        const isLastStation = index === selectedRoute.stations.length - 1;
                        const isStopStation = selectedRoute.stations[index].stop === "1" || selectedRoute.stations[index].stop === 1;
                        const isZeroStopStation = selectedRoute.stations[index].stop === "0" || selectedRoute.stations[index].stop === 0;
                        
                        // 检查当前位置是否为特殊站点位置
                        const isSpecialStationPosition = stationData.some(s => 
                            Math.abs(s.latitude - newLatlng.lat) < 1e-6 && 
                            Math.abs(s.longitude - newLatlng.lng) < 1e-6
                        );
                        
                        // 根据站点类型设置图标
                        if (isFirstStation) {
                            e.target.setIcon(startIcon);
                        } else if (isLastStation) {
                            e.target.setIcon(specialIcon);
                        } else if (isStopStation) {
                            e.target.setIcon(stopIcon);
                        } else if (isZeroStopStation && !isSpecialStationPosition) {
                            // 如果是stop值为0的情况且不是特殊站点位置，才使用redCircleIcon
                            e.target.setIcon(redCircleIcon);
                        } else {
                            e.target.setIcon(defaultIcon);
                        }
                    });

                    editableMarkers.push(marker);
                    markers.push(marker);
                });

                updateRoutePolyline(routePoints);
                // 检测重叠点的函数
                function findOverlappingStations(targetLatLng, stations) {
                    const tolerance = 0.00000001; // 经纬度容差，处理浮点数精度问题
                    return stations.filter(station => {
                        const latDiff = Math.abs(station.latitude - targetLatLng.lat);
                        const lngDiff = Math.abs(station.longitude - targetLatLng.lng);
                        return latDiff < tolerance && lngDiff < tolerance;
                    });
                }
                map.on('click', async function (e) {


                    if (!allowAddingStations) return; // 如果不允许添加，则直接返回
                    const latlng = e.latlng;
                    
                    // 检查该位置是否是特殊站点
                    const specialStation = stationData.find(station => 
                        Math.abs(station.latitude - latlng.lat) < 1e-6 && 
                        Math.abs(station.longitude - latlng.lng) < 1e-6
                    );
                    
                    // 如果是特殊站点，检查是否已经在当前路线中
                    if (specialStation && selectedRoute && selectedRoute.stations) {
                        const isDuplicate = selectedRoute.stations.some(existingStation => 
                            Math.abs(existingStation.latitude - specialStation.latitude) < 1e-6 && 
                            Math.abs(existingStation.longitude - specialStation.longitude) < 1e-6
                        );
                        
                        if (isDuplicate) {
                            cocoMessage.warning(`特殊站点"${specialStation.stationName}"已经存在于路线中，不能重复经过`);
                            return;
                        }
                    }
                    
                    const newStation = {
                        latitude: latlng.lat,
                        longitude: latlng.lng,
                        stationName: specialStation ? specialStation.stationName : `站点${selectedRoute.stations.length + 1}`
                    };
                    // 更新最后一个点的图标为默认图标（如果该点不是起点）
                    if (editableMarkers.length > 0) {
                        const lastMarker = editableMarkers[editableMarkers.length - 1];
                        // 检查最后一个点是否是起点
                        const isLastPointFirstStation = selectedRoute.stations.length > 0 && 
                            Math.abs(lastMarker.getLatLng().lat - selectedRoute.stations[0].latitude) < 1e-6 &&
                            Math.abs(lastMarker.getLatLng().lng - selectedRoute.stations[0].longitude) < 1e-6;
                        
                        if (!isLastPointFirstStation) {
                            lastMarker.setIcon(defaultIcon);
                        }
                    }

                    // 检查该位置是否已存在特殊站点标记
                    const existingSpecialMarker = markers.find(marker => {
                        const markerLatLng = marker.getLatLng();
                        return Math.abs(latlng.lat - markerLatLng.lat) < 1e-6 && 
                               Math.abs(latlng.lng - markerLatLng.lng) < 1e-6;
                    });
                    
                    // 创建停车站点图标
                    const stopIcon = L.icon({
                        iconUrl: '../plugins/img/任务进程.svg', // 停车站点图标，用户可以根据需要修改
                        iconSize: [25, 25],
                        iconAnchor: [12.5, 25]
                    });
                    
                    // 创建红色实心圆图标（用于stop值为0的情况）
                    const redCircleIcon = L.icon({
                        iconUrl: '../plugins/img/圆圈.png',
                        iconSize: [12, 12],
                        iconAnchor: [6, 6]
                    });
                    
                    // 创建起点图标
                    const startIcon = L.icon({
                        iconUrl: '../plugins/img/英文起点.png',
                        iconSize: [25, 25],
                        iconAnchor: [10, 18]
                    });
                    
                    let marker;
                    if (existingSpecialMarker) {
                        // 如果已存在特殊站点标记，则复用该标记
                        marker = existingSpecialMarker;
                        // 检查是否是停车站点
                        if (specialStation && (specialStation.stop === "1" || specialStation.stop === 1)) {
                            marker.setIcon(stopIcon);
                        } else {
                            // 检查是否是起点
                            const isFirstStation = selectedRoute.stations.length === 0;
                            if (isFirstStation) {
                                marker.setIcon(startIcon);
                            } else {
                                marker.setIcon(specialIcon);
                            }
                        }
                        // 检查是否已有tooltip，如果没有则添加
                        if (!marker.getTooltip()) {
                            marker.bindTooltip(newStation.stationName, {
                                permanent: false,
                                direction: 'right',
                                offset: [10, 0],
                                className: 'station-label'
                            });
                        }
                    } else {
                        // 如果没有现有标记，则创建新标记
                        // 检查是否是停车站点
                        let selectedIcon = specialIcon;
                        if (specialStation && (specialStation.stop === "1" || specialStation.stop === 1)) {
                            selectedIcon = stopIcon;
                        } else if (specialStation && (specialStation.stop === "0" || specialStation.stop === 0)) {
                            selectedIcon = redCircleIcon;
                        } else {
                            // 检查是否是起点
                            const isFirstStation = selectedRoute.stations.length === 0;
                            if (isFirstStation) {
                                selectedIcon = startIcon;
                            }
                        }
                        marker = L.marker([latlng.lat, latlng.lng], {
                            draggable: true,
                            icon: selectedIcon,
                        }).addTo(map);

                        marker.bindTooltip(newStation.stationName, {
                            permanent: false,
                            direction: 'right',
                            offset: [10, 0],
                            className: 'station-label'
                        });
                    }

                    marker.on('dragend', function (e) {
                        const newLatlng = e.target.getLatLng();
                        // 找到当前标记对应的索引
                        const index = editableMarkers.indexOf(e.target); 
                        if (index > -1) {
                            // 更新对应站点的经纬度
                            selectedRoute.stations[index].latitude = newLatlng.lat;
                            selectedRoute.stations[index].longitude = newLatlng.lng;
                            // 更新routePoints
                            routePoints[index] = [newLatlng.lat, newLatlng.lng];
                            updateRoutePolyline(routePoints); // 重新绘制折线
                        }
                    });

                    marker.on('click', function (e) {
                        e.originalEvent.stopPropagation();
                        
                        // 在新增路线模式下，点击特殊点时显示属性框
                        if (allowAddingStations && specialStation) {
                            // 找到当前点在路线中的实际位置
                            const stationIndex = selectedRoute.stations.findIndex(s => 
                                Math.abs(s.latitude - latlng.lat) < 1e-6 && 
                                Math.abs(s.longitude - latlng.lng) < 1e-6
                            );
                            
                            // 创建临时站点对象，用于显示属性框
                            const tempStation = {
                                latitude: latlng.lat,
                                longitude: latlng.lng,
                                stationName: specialStation.stationName || `站点${stationIndex + 1}`,
                                direction: specialStation.direction || "360",
                                speed: specialStation.speed || "",
                                area: specialStation.area || "1",
                                action: specialStation.action || "1",
                                position: specialStation.position || "0",
                                lanechange: specialStation.lanechange || "0",
                                stop: specialStation.stop || "0",
                                runmode: specialStation.runmode || "0",
                                id: specialStation.id || "-1",
                                stationId: specialStation.stationId || specialStation.id || "-1",
                                index: stationIndex
                            };
                            
                            // 显示属性框，使用正确的索引
                            // 使用stationIndex作为起始索引，确保显示正确的点序号
                            showMultiplePointInfoBoxes(e, [tempStation], stationIndex);
                        } else {
                            const content = `站点：${newStation.stationName}`;
                            // toggleInfoBox(e.originalEvent.clientX, e.originalEvent.clientY, content, newStation.stationName); // 已解绑，不再使用
                        }
                    });

                    editableMarkers.push(marker);
                    markers.push(marker);
                    routePoints.push([String(latlng.lat), String(latlng.lng)]);
                    updateRoutePolyline(routePoints);

                    // 添加新站到路线中
                    selectedRoute.stations.push(newStation);
                });

                if (currentRoutePolyline) {
                    map.fitBounds(currentRoutePolyline.getBounds(), { padding: [20, 20] });
                } else if (routePoints && routePoints.length > 0) {
                    const bounds = L.latLngBounds(routePoints);
                    map.fitBounds(bounds, { padding: [20, 20] });
                }
                disableEditing();
                
                // 恢复特殊点标记的原始图标，确保特殊点标记不受影响
                setTimeout(() => {
                    markers.forEach(marker => {
                        if (marker.originalSpecialIcon) {
                            // 检查该标记是否是特殊站点
                            const markerLatLng = marker.getLatLng();
                            const isSpecialStation = stationData.some(station => 
                                Math.abs(station.latitude - markerLatLng.lat) < 1e-6 && 
                                Math.abs(station.longitude - markerLatLng.lng) < 1e-6
                            );
                            
                            // 如果是特殊站点且不在当前路线中，恢复原始图标
                            if (isSpecialStation && !selectedRoute.stations.some(station => 
                                Math.abs(station.latitude - markerLatLng.lat) < 1e-6 && 
                                Math.abs(station.longitude - markerLatLng.lng) < 1e-6
                            )) {
                                marker.setIcon(marker.originalSpecialIcon);
                            }
                        }
                    });
                }, 100); // 延迟执行，确保路线渲染完成后再恢复特殊点图标
            }
            if(selectedRoute.speed){
                document.getElementById("routeSpeed").textContent = `${selectedRoute.speed}m/s`
            }else{
                document.getElementById("routeSpeed").textContent = ""
            }
            routePoints = selectedRoute.stations.map(station =>
                L.latLng(station.latitude, station.longitude)  // 使用 L.latLng 创建坐标对象
            );
            updateAllDistanceMarkers(); // 触发距离计算和标记显示
        } else {
            stationInfoDisplay.innerHTML = "";
            // 未选择路线时，清除所有距离标记
            distanceMarkers.forEach(marker => {
                // 移除所有事件监听器
                try {
                    marker.off();
                    if (map.hasLayer(marker)) {
                        map.removeLayer(marker);
                    }
                } catch (e) {
                    console.warn('清除距离标记时出错:', e);
                }
            });
            distanceMarkers = [];
        }
    });
    callbackStatus = 3
}

//删除的模态框
async function showDeleteConfirmation() {
    // 获取模态框实例并显示
    const modalElement = document.getElementById('deleteConfirmationModal');
    const modal = new bootstrap.Modal(modalElement);
    modal.show();
    // 确保我们只添加一次点击事件监听器
    const confirmDeleteButton = document.getElementById('confirmDeleteButton');
    confirmDeleteButton.addEventListener('click', async () => {
        try {
            const selectElement = document.getElementById('routeSelect');
            const selectedValue = selectElement.value;
            if (selectedValue) {
                const response = await axiosClient.delete("route/delete/" + selectedValue);
                let flag = response.data.code;
                if (!flag) {
                    cocoMessage.success("删除路线成功");
                    await getAllRoute()
                    await getAllCurrentPoint()
                    await populateRouteSelect();
                    modal.hide();
                    clearAllRoutes()
                    document.getElementById("routeSpeed").value = ""
                } else {
                    cocoMessage.error("系统错误");
                }
            } else {
                cocoMessage.error("请选择要删除的路线再点击删除")
            }

        } catch (error) {
            console.error("Error fetching data:", error); // 打印完整的错误信息
            throw error; // 抛出错误以便在调用处捕获
        }
    }, { once: true }); // 使用 {once: true} 选项来确保这个监听器只会触发一次
}








//获取参数列表里面的数据
async function getRobotData() {
    try {
        const res = await axiosClient.get("param/queryalldata");
        let currentDataBag = res.data.data
        initlongitudeCurrent = currentDataBag[0].local_origin_longitude
        initlatitudeCurrent = currentDataBag[0].local_origin_latitude
        currentBootPoint = currentDataBag[0].boot_point
        let flag = res.data.code;
        if (!flag) {
            // 获取初始经纬成功
        } else {
            cocoMessage.error("获取初始经纬度失败");
        }
    } catch (error) {
    }
}

async function saveRouteData() {
    const selectedRoute = alldata.find(r => r.routeId == document.getElementById('routeSelect').value);
    // 示例：处理 currentAvoidArr
    let currentlength = selectedRoute.stations.length;
    selectedRoute.stations.forEach(item => {
        if (item.area) {
            currentAvoidArr.push(item.area);
        } else {
            currentAvoidArr.push("1");
        }
    });
    currentAvoidArr = currentAvoidArr.slice(-currentlength)

    if (!selectedRoute) return;

    const updatedStations = selectedRoute.stations.map((station, index) => {
        const marker = editableMarkers[index];
        if (!marker || typeof marker.getLatLng !== 'function') {
            return null; // 或者跳过这个无效的标记
        }
        const latLng = marker.getLatLng();
        return {
            id: station.stationId,
            latitude: String(latLng.lat),
            longitude: String(latLng.lng)
        };
    }).filter(station => station !== null); // 过滤掉无效的标记


    const dataToSave = {
        id: selectedRoute.routeId,
        routeName: selectedRoute.routeName,
        mapCoverage: selectedRoute.mapCoverage,
        stations: updatedStations,
        rowData: currentAvoidArr
    };
    try {
        const response = await axiosClient.post("route/updateMap", dataToSave);
        if (response) {
            // 响应处理成功
        } else {
            // API响应结构异常
        }
    } catch (error) {
        throw error;
    }
    await getAllCurrentPoint()
    await getAllRoute()
    await populateRouteSelect(false, selectedRoute.routeId);
    // await renderStations();
    let imgEdit = document.getElementById("imgEdit")
    imgEdit.src = '../plugins/img/img-right/编辑.png';
    document.querySelector(".text-edit").textContent = "开始编辑";
    allowAddingStations = false;
    editStatus = false
    disableEditing()
    
    // 重置editRouteStatus状态，确保保存后处于编辑结束模式
    editRouteStatus = false;
    deleteBtnStatus = false;
    addBtnStatus = false;
    toggleStatus = false;
    
    // 移除鼠标移动事件监听器，防止继续创建预览线
    map.off('mousemove', handleMouseMoveLine);
    map.off('click', handleMapClick);
    
    // 这里可以添加代码将数据发送到服务器或者进行其他保存操作
}
function toggleEditMode() {
    map.off('mousemove', handleMouseMoveLine);

    // 通过ID选择图像元素
    if (previewLine) {
        map.removeLayer(previewLine);
        previewLine = null;
    }
    // 清除预览距离标记
    if (previewDistanceMarker) {
        map.removeLayer(previewDistanceMarker);
        previewDistanceMarker = null;
    }
    
    // 清理暂存的站点数据，确保每次新增路线都是独立的
    window.tempRouteStations = [];
    
    // 设置新增路线模式标志
    window.isAddingToExistingRoute = false; // 全新新增路线模式
   
    let addEdit = document.getElementById('addEdit');
    let imgEdit = document.getElementById("imgEdit")
    toggleStatus = true
    document.querySelector(".text-editLine").textContent = "新增路线";
    addEdit.src = '../plugins/img/img-right/绘制路线 (1).png';
    editStatus = !editStatus;
    document.querySelector(".text-edit").textContent = editStatus ? "结束编辑" : "开始编辑";
    if (editStatus) {
        // 开始编辑模式 - 允许拖动操作和新增点
        allowAddingStations = true; // 允许新增点
        enableEditing();
        imgEdit.src = '../plugins/img/img-right/编辑状态.png';
        // 保持地图点击事件，允许在编辑模式下新增点
        if (toggleStatus) {
            map.on('click', handleMapClick);
        }
    }
    else {
        // 结束编辑模式
        disableEditing();
        allowAddingStations = false; // 禁止新增点
        imgEdit.src = '../plugins/img/img-right/编辑.png';
        // 移除地图点击事件，防止在非编辑模式下新增点
        map.off('click', handleMapClick);
    }
}


// 添加标志位，防止重复调用enableEditing
let isEnableEditingCalled = false;

function enableEditing() {
    // 如果已经调用过，直接返回
    if (isEnableEditingCalled) {
        return;
    }
    
    isEnableEditingCalled = true;
    
    // 存储拖动过程中的临时距离标记和虚线预览
    let dragDistanceMarkers = [];
    let dragPreviewLines = [];

    markers.forEach(marker => {
        // 先移除已有的事件监听器，防止重复绑定
        marker.off('dragstart');
        marker.off('drag');
        marker.off('dragend');
        
        // 保存原始位置和数据以备撤回操作使用
        marker.originalData = {
            position: marker.getLatLng(),
            id: stationData.find(item =>
                Math.abs(item.latitude - marker.getLatLng().lat) < 1e-6 &&
                Math.abs(item.longitude - marker.getLatLng().lng) < 1e-6
            )
        };

        marker.dragging.enable(); // 启用拖动

        // 拖动开始时清理所有旧的距离标记、虚线和标签
        marker.on('dragstart', function () {
            // 清除所有旧的固定距离标记
            distanceMarkers.forEach(m => {
                // 移除所有事件监听器
                try {
                    m.off();
                    if (map.hasLayer(m)) {
                        map.removeLayer(m);
                    }
                } catch (e) {
                    console.warn('清除距离标记时出错:', e);
                }
            });
            distanceMarkers = [];

            // 清除可能存在的拖动临时标记和虚线
            dragDistanceMarkers.forEach(m => {
                try {
                    map.removeLayer(m);
                } catch (e) {
                    console.warn('清除拖动距离标记时出错:', e);
                }
            });
            dragDistanceMarkers = [];
            dragPreviewLines.forEach(l => {
                try {
                    map.removeLayer(l);
                } catch (e) {
                    console.warn('清除预览线时出错:', e);
                }
            });
            dragPreviewLines = [];
            
            // 临时禁用地图点击事件，防止拖拽过程中意外创建新站点
            map.off('click', handleMapClick);
        });

        // 拖动过程中动态显示距离和虚线预览
        marker.on('drag', function (e) {
            // 清除之前的拖动临时标记和虚线
            dragDistanceMarkers.forEach(m => {
                try {
                    map.removeLayer(m);
                } catch (e) {
                    console.warn('清除拖动距离标记时出错:', e);
                }
            });
            dragDistanceMarkers = [];
            dragPreviewLines.forEach(l => {
                try {
                    map.removeLayer(l);
                } catch (e) {
                    console.warn('清除预览线时出错:', e);
                }
            });
            dragPreviewLines = [];

            const draggedPosition = e.target.getLatLng();
            const markerOriginalPos = marker.originalData.position;

            // 查找当前标记在routePoints中的所有对应位置（处理重合点）
            const markerIndices = routePoints
                .map((p, idx) => ({ point: p, index: idx }))
                .filter(item =>
                    Math.abs(item.point.lat - markerOriginalPos.lat) < 1e-6 &&
                    Math.abs(item.point.lng - markerOriginalPos.lng) < 1e-6
                )
                .map(item => item.index);

            // 仅处理第一个匹配的索引（假设一个标记只对应一个路径点）
            if (markerIndices.length === 0) return;
            const markerIndex = markerIndices[0];

            // 更新routePoints中的对应点（仅用于计算距离）
            const tempRoutePoints = [...routePoints];
            tempRoutePoints[markerIndex] = draggedPosition;

            // 计算并显示与相邻点的距离和虚线
            if (tempRoutePoints.length >= 2) {
                // 与前一个点的距离和虚线
                if (markerIndex > 0) {
                    const prevPoint = tempRoutePoints[markerIndex - 1];
                    addDragDistanceMarker(prevPoint, draggedPosition);
                    addDragPreviewLine(prevPoint, draggedPosition);
                }

                // 与后一个点的距离和虚线
                if (markerIndex < tempRoutePoints.length - 1) {
                    const nextPoint = tempRoutePoints[markerIndex + 1];
                    addDragDistanceMarker(draggedPosition, nextPoint);
                    addDragPreviewLine(draggedPosition, nextPoint);
                }
            }
            
            // 如果只有一个点，显示与原始位置的距离
            if (tempRoutePoints.length === 1) {
                addDragDistanceMarker(markerOriginalPos, draggedPosition);
                addDragPreviewLine(markerOriginalPos, draggedPosition);
            }
        });

        // 拖动结束时更新所有距离标记并清除虚线
        marker.on('dragend', async function (e) {
           if (previewLine) {
                map.removeLayer(previewLine);
                previewLine = null;
                }
                if (previewDistanceMarker) {
                    map.removeLayer(previewDistanceMarker);
                    previewDistanceMarker = null;
                }
            const updatedPosition = e.target.getLatLng();

            // 清除拖动过程中的临时标记和虚线
            dragDistanceMarkers.forEach(m => {
                try {
                    map.removeLayer(m);
                } catch (e) {
                    console.warn('清除拖动距离标记时出错:', e);
                }
            });
            dragDistanceMarkers = [];
            dragPreviewLines.forEach(l => {
                try {
                    map.removeLayer(l);
                } catch (e) {
                    console.warn('清除预览线时出错:', e);
                }
            });
            dragPreviewLines = [];
            
            // 重新启用地图点击事件，允许用户创建新站点
            if (toggleStatus) {
                map.on('click', handleMapClick);
            }

            // 更新routePoints中的所有对应点（处理重合点）
            routePoints = routePoints.map(point => {
                if (Math.abs(point.lat - marker.originalData.position.lat) < 1e-6 &&
                    Math.abs(point.lng - marker.originalData.position.lng) < 1e-6) {
                    return updatedPosition;
                }
                return point;
            });

            updatePolyline(); // 更新折线

            // 更新marker的原始位置
            marker.originalData.position = updatedPosition;

            // 如果有站点ID，更新后端数据
            if (marker.originalData.id) {
                await updatePoint(
                    marker.originalData.id.id,
                    updatedPosition.lng,
                    updatedPosition.lat
                );
                await getAllRoute();
                await getAllCurrentPoint();
            }

            // 重新计算并显示所有固定距离标记
            updateAllDistanceMarkers();
            
            // 更新当前路线的折线
            if (currentRoutePolyline) {
                currentRoutePolyline.setLatLngs(routePoints);
            } else {
                currentRoutePolyline = L.polyline(routePoints, {
                    color: 'red',
                    weight: 3
                }).addTo(map);
            }
        });
    });

    // 创建虚线预览的函数
    function addDragPreviewLine(point1, point2) {
        // 创建虚线样式的Polyline
        const line = L.polyline([point1, point2], {
            color: '#ff0000',
            weight: 2,
            dashArray: '10, 10',
            opacity: 0.7,
            interactive: false
        }).addTo(map);

        dragPreviewLines.push(line);
    }

    // 创建距离标记的函数
    function addDragDistanceMarker(point1, point2) {
        // 计算两点之间的距离（单位：米）
        const distance = point1.distanceTo(point2);

        // 计算中间点位置（使用改进的getMidpoint函数）
        const midPoint = getMidpoint(point1, point2);

        // 创建距离标记
        const distanceMarker = L.marker(midPoint, {
            icon: createDistanceIcon(`${distance.toFixed(2)}m`),
            interactive: false,
            zIndexOffset: 1000 // 提高层级，确保距离标签显示在顶部
        }).addTo(map);

        dragDistanceMarkers.push(distanceMarker);
    }
}

// 更新所有固定的距离标记（非拖动状态下显示的标记）
function updateAllDistanceMarkers() {
    // 清除现有的距离标记
    distanceMarkers.forEach(marker => {
        // 移除所有事件监听器
        try {
            marker.off();
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        } catch (e) {
            console.warn('清除距离标记时出错:', e);
        }
    });
    distanceMarkers = [];

    // 确保有足够的点来计算距离
    if (routePoints.length < 2) return;

    // 为每对相邻点添加距离标记
    for (let i = 0; i < routePoints.length - 1; i++) {
        const pointA = routePoints[i];
        const pointB = routePoints[i + 1];

        // 计算两点之间的距离（单位：米）
        const distance = pointA.distanceTo(pointB);

        // 计算中间点位置（使用改进的getMidpoint函数）
        const midPoint = getMidpoint(pointA, pointB);

        // 创建并添加距离标记
        const distanceMarker = L.marker(midPoint, {
            icon: createDistanceIcon(`${distance.toFixed(2)}m`),
            interactive: false, // 不可交互，避免干扰地图操作
            zIndexOffset: 1000 // 提高层级，确保距离标签显示在顶部
        }).addTo(map);

        distanceMarkers.push(distanceMarker);
    }
}
//禁止编辑
function disableEditing() {
    // 重置标志位，允许下次调用enableEditing
    isEnableEditingCalled = false;
    
    markers.forEach(marker => {
        if (marker.dragging && marker.dragging.disable) {
            marker.dragging.disable();
            delete marker.originalPosition;
        }
    });
}

//修改站点
// 添加防抖机制，避免短时间内多次调用updatePoint
let updatePointTimeout = null;
let isUpdating = false;

async function updatePoint(id, lng, lat) {
    // 检查是否为特殊站点
    const isSpecialStation = stationData.some(station => 
        station.id === id
    );
    
    // 如果是特殊站点，不允许更新位置
    if (isSpecialStation) {
        cocoMessage.warning("特殊站点位置不允许修改");
        return;
    }
    
    // 如果正在更新中，直接返回
    if (isUpdating) {
        return;
    }
    
    // 清除之前的定时器
    if (updatePointTimeout) {
        clearTimeout(updatePointTimeout);
    }
    
    // 设置新的定时器，延迟300ms执行
    updatePointTimeout = setTimeout(async () => {
        isUpdating = true;
        try {
            let params = {
                id: id,
                longitude: lng,
                latitude: lat
            }
            const res = await axiosClient.post("station/update", params);
            let flag = res.data.code;
            if (!flag) {
                cocoMessage.success("修改成功");
            } else {
                cocoMessage.error("修改失败");
            }
        } catch (error) {
            console.log("catch", error);
            cocoMessage.error("修改失败");
        } finally {
            isUpdating = false;
        }
    }, 300);
}


//清除所有路线
function clearAllRoutes() {
    // 移除当前的 polyline（如果存在）
    if (currentPolyline) {
        map.removeLayer(currentPolyline);
        currentPolyline = null;
    }
    if (currentRoutePolyline) {
        map.removeLayer(currentRoutePolyline);
        currentRoutePolyline = null;
    }

    // 移除所有标记，但保留特殊站点（从station/querynew/2获取的站点）
    const specialStationIds = stationData.map(station => station.id);
    markers = markers.filter(marker => {
        // 检查标记是否为特殊站点
        const markerLatLng = marker.getLatLng();
        const isSpecialStation = stationData.some(station => 
            Math.abs(station.latitude - markerLatLng.lat) < 1e-6 && 
            Math.abs(station.longitude - markerLatLng.lng) < 1e-6
        );
        
        if (isSpecialStation) {
            // 保留特殊站点标记，但先清除其标签
            // if (marker.options.tooltip) {
            //     marker.closeTooltip();
            //     marker.options.tooltip = null;
            // }
            // 恢复特殊站点的原始图标（如果之前保存了）
            if (marker.originalSpecialIcon) {
                marker.setIcon(marker.originalSpecialIcon);
            }
            return true;
        } else {
            // 移除非特殊站点标记
            map.removeLayer(marker);
            // 移除标记对应的标签
            if (marker.options.tooltip) {
                marker.closeTooltip();
                marker.options.tooltip = null;
            }
            return false;
        }
    });
    editableMarkers = [];
    
    // 移除距离标记
    distanceMarkers.forEach(marker => {
        // 移除所有事件监听器
        try {
            marker.off();
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        } catch (e) {
            console.warn('清除距离标记时出错:', e);
        }
    });
    distanceMarkers = [];

    // 移除可拖动矩形标记
    draggableRectMarkers.forEach(marker => {
        // 移除所有事件监听器
        try {
            marker.off();
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        } catch (e) {
            console.warn('清除矩形标记时出错:', e);
        }
    });
    draggableRectMarkers = [];

    // 移除机器位置标记
    if (machineMarker) {
        if (map.hasLayer(machineMarker)) {
            map.removeLayer(machineMarker);
        }
        machineMarker = null;
    }

    // 重新渲染原始站点
    renderStations();

    // 清空可编辑标记数组
    editableMarkers = [];

    // 清空路线点数组
    routePoints = [];
}

function renderStations() {
    // 清除所有现有的标记，确保特殊点也能被正确移除
    markers.forEach(marker => {
        if (map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
        // 移除标记的事件监听器
        marker.off('click');
        marker.off('mouseover');
        marker.off('mouseout');
        marker.off('dragend');
    });
    markers = [];
    
    // 清除编辑模式下的可拖动标记
    editableMarkers.forEach(marker => {
        if (map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
        // 移除标记的事件监听器
        marker.off('click');
        marker.off('mouseover');
        marker.off('mouseout');
        marker.off('dragend');
    });
    editableMarkers = [];
    
    var customIcon = L.icon({
        iconUrl: '../plugins/img/坐标.svg',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
    });
    
    // 为所有站点创建或更新标记
    stationData.forEach(station => {
        const existingMarker = markers.find(marker => {
            const markerLatLng = marker.getLatLng();
            return Math.abs(station.latitude - markerLatLng.lat) < 1e-6 && 
                   Math.abs(station.longitude - markerLatLng.lng) < 1e-6;
        });
        
        if (!existingMarker) {
            // 检查是否为特殊站点
            const isSpecialStation = stationData.some(s => 
                s.id === station.id && 
                Math.abs(s.latitude - station.latitude) < 1e-6 && 
                Math.abs(s.longitude - station.longitude) < 1e-6
            );
            
            var marker = L.marker([station.latitude, station.longitude], {
                icon: customIcon,
                title: station.stationName,
                draggable: isSpecialStation ? false : true  // 特殊站点不可拖动
            }).addTo(map);

            marker.bindTooltip(station.stationName, {
                permanent: true,
                direction: 'right',
                offset: [10, 0],
                className: 'station-label'
            });
            
            // 添加鼠标悬浮事件，控制标签显示
            marker.on('mouseover', function() {
                this.openTooltip();
                // 使用CSS类控制标签显示
                const tooltip = this.getTooltip();
                if (tooltip) {
                    L.DomUtil.addClass(tooltip._container, 'leaflet-tooltip-visible');
                }
                
                // 在新增路线模式下，显示加号标记
                if (toggleStatus) {
                    showAddButtonNearStation(this, null, null);
                }
            });
            
            marker.on('mouseout', function() {
                this.closeTooltip();
                // 移除显示类
                const tooltip = this.getTooltip();
                if (tooltip) {
                    L.DomUtil.removeClass(tooltip._container, 'leaflet-tooltip-visible');
                }
                
                // 设置延迟隐藏，给用户时间点击
                if (addButtonTimeout) {
                    clearTimeout(addButtonTimeout);
                }
                addButtonTimeout = setTimeout(function() {
                    hideAddButtonNearStation();
                }, 1000); // 延迟1秒隐藏
            });
            marker.originalVisibility = {
                icon: marker.options.icon,
                tooltip: marker.options.tooltip
            };
            // 保存特殊站点的原始图标信息
            marker.originalSpecialIcon = marker.options.icon;

            marker.on('click', function (e) {
                e.originalEvent.stopPropagation();
            });
            // 确保绑定点击事件
            marker.on('click', function (e) {
                e.originalEvent.stopPropagation();
                // 获取当前点击的位置
                const currentLatLng = e.target.getLatLng();
                
                // 查找所有相同位置的站点
                const overlappingStations = stationData.filter(s => 
                    Math.abs(s.latitude - currentLatLng.lat) < 1e-6 && 
                    Math.abs(s.longitude - currentLatLng.lng) < 1e-6
                );
                
                if (overlappingStations.length > 1) {
                    // 如果有多个点在同一位置，显示选择界面
                    showMultipleStationSelector(e, overlappingStations);
                } else {
                    // 如果只有一个点，直接显示其属性
                    showSingleStationInfoBox(station, e);
                }
            });
            markers.push(marker);
        } else {
            // 为已存在的特殊站点标记检查是否需要重新绑定标签
            // 检查是否已经有tooltip，避免重复绑定
            const hasTooltip = existingMarker.getTooltip();
            if (!hasTooltip) {
                // 只有在没有tooltip时才绑定新的tooltip
                existingMarker.bindTooltip(station.stationName, {
                    direction: 'right',
                    offset: [10, 0],
                    className: 'station-label'
                });
                
                // 添加鼠标悬浮事件，控制标签显示
                existingMarker.on('mouseover', function() {
                    this.openTooltip();
                    // 使用CSS类控制标签显示
                    const tooltip = this.getTooltip();
                    if (tooltip) {
                        L.DomUtil.addClass(tooltip._container, 'leaflet-tooltip-visible');
                    }
                    
                    // 在新增路线模式下，显示加号标记
                    if (toggleStatus) {
                        showAddButtonNearStation(this, null, null);
                    }
                });
                
                existingMarker.on('mouseout', function() {
                    this.closeTooltip();
                    // 移除显示类
                    const tooltip = this.getTooltip();
                    if (tooltip) {
                        L.DomUtil.removeClass(tooltip._container, 'leaflet-tooltip-visible');
                    }
                    
                    // 设置延迟隐藏，给用户时间点击
                    if (addButtonTimeout) {
                        clearTimeout(addButtonTimeout);
                    }
                    addButtonTimeout = setTimeout(function() {
                        hideAddButtonNearStation();
                    }, 1000); // 延迟1秒隐藏
                });
            }
        }
    });
}
// 显示多个相同位置站点的选择界面
function showMultipleStationSelector(event, stations) {
    // 移除之前的选择器（如果存在）
    const existingSelector = document.getElementById('multipleStationSelector');
    if (existingSelector) {
        existingSelector.remove();
    }
    
    // 创建选择器容器
    const selector = document.createElement('div');
    selector.id = 'multipleStationSelector';
    selector.style.position = 'absolute';
    selector.style.left = (event.originalEvent.clientX + 10) + 'px';
    selector.style.top = (event.originalEvent.clientY + 10) + 'px';
    selector.style.backgroundColor = 'white';
    selector.style.border = '1px solid #ccc';
    selector.style.borderRadius = '5px';
    selector.style.padding = '10px';
    selector.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
    selector.style.zIndex = '10000';
    selector.style.maxWidth = '300px';
    selector.style.maxHeight = '400px';
    selector.style.overflowY = 'auto';
    
    // 添加标题
    const title = document.createElement('div');
    title.textContent = '选择要查看的站点';
    title.style.fontWeight = 'bold';
    title.style.marginBottom = '10px';
    title.style.paddingBottom = '5px';
    title.style.borderBottom = '1px solid #eee';
    selector.appendChild(title);
    
    // 添加站点列表
    stations.forEach((station, index) => {
        const stationItem = document.createElement('div');
        stationItem.style.padding = '8px';
        stationItem.style.margin = '5px 0';
        stationItem.style.backgroundColor = '#f8f9fa';
        stationItem.style.borderRadius = '3px';
        stationItem.style.cursor = 'pointer';
        stationItem.style.transition = 'background-color 0.2s';
        
        // 鼠标悬停效果
        stationItem.onmouseover = function() {
            this.style.backgroundColor = '#e9ecef';
        };
        stationItem.onmouseout = function() {
            this.style.backgroundColor = '#f8f9fa';
        };
        
        // 站点信息
        const stationName = document.createElement('div');
        stationName.textContent = station.stationName || `站点${index + 1}`;
        stationName.style.fontWeight = 'bold';
        stationName.style.marginBottom = '3px';
        
        const stationCoords = document.createElement('div');
        stationCoords.textContent = `坐标: (${station.latitude.toFixed(6)}, ${station.longitude.toFixed(6)})`;
        stationCoords.style.fontSize = '12px';
        stationCoords.style.color = '#666';
        
        stationItem.appendChild(stationName);
        stationItem.appendChild(stationCoords);
        
        // 点击事件
        stationItem.onclick = function(e) {
            e.stopPropagation(); // 阻止事件冒泡
            // 不移除选择器，让用户可以继续选择其他站点
        };
        
        selector.appendChild(stationItem);
    });
    
    // 添加关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.style.marginTop = '10px';
    closeBtn.style.padding = '5px 10px';
    closeBtn.style.backgroundColor = '#dc3545';
    closeBtn.style.color = 'white';
    closeBtn.style.border = 'none';
    closeBtn.style.borderRadius = '3px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.onclick = function(e) {
        e.stopPropagation(); // 阻止事件冒泡
        selector.remove();
    };
    selector.appendChild(closeBtn);
    
    // 添加到页面
    document.body.appendChild(selector);
    
    // 点击其他地方关闭选择器（但不影响信息框）
    setTimeout(() => {
        document.addEventListener('click', function closeSelector(e) {
            // 检查点击是否在任何信息框内
            const infoBoxes = document.querySelectorAll('[id^="stationDetailsInfoBox_"]');
            let isClickInInfoBox = false;
            infoBoxes.forEach(box => {
                if (box.contains(e.target)) {
                    isClickInInfoBox = true;
                }
            });
            
            // 只有当点击不在选择器内且不在任何信息框内时才关闭
            if (!selector.contains(e.target) && !isClickInInfoBox) {
                selector.remove();
                document.removeEventListener('click', closeSelector);
            }
        });
    }, 100);
}



// 显示单个站点的属性框（使用与showMultiplePointInfoBoxes相同的样式和功能）
function showSingleStationInfoBox(station, event) {
    // 创建一个包含当前站点的数组，然后调用showMultiplePointInfoBoxes函数
    const stationsArray = [station];
    showMultiplePointInfoBoxes(event, stationsArray);
}

// 隐藏所有相同位置站点的信息框
function hideAllOverlappingStationInfoBoxes(station) {
    // 查找所有相同位置的站点
    const overlappingStations = stationData.filter(s => 
        Math.abs(s.latitude - station.latitude) < 1e-6 && 
        Math.abs(s.longitude - station.longitude) < 1e-6
    );
    
    // 隐藏每个站点的信息框
    overlappingStations.forEach(s => {
        const infoBox = document.getElementById(`stationInfoBox_${s.id || s.stationName}`);
        if (infoBox) {
            infoBox.style.display = 'none';
        }
    });
}

function updatePolyline() {
    // 移除旧的Polyline
    if (currentPolyline) map.removeLayer(currentPolyline);
    if (currentRoutePolyline) map.removeLayer(currentRoutePolyline);
    
    if (routePoints.length > 0) { // 如果还有路线点，则根据新的路线点绘制Polyline
        // 根据当前模式决定使用哪个折线变量
        if (allowAddingStations) {
            // 新增路线模式，使用currentRoutePolyline
            currentRoutePolyline = L.polyline(routePoints, { color: 'red', weight: 3 }).addTo(map);
            currentPolyline = null;
        } else {
            // 编辑模式，使用currentPolyline
            currentPolyline = L.polyline(routePoints, { color: 'red' }).addTo(map);
            currentRoutePolyline = null;
        }
        
        // 确保矩形标记数量与线段数量一致
        const requiredSegments = routePoints.length - 1;
        
        // 如果矩形标记数量多于需要的线段数量，移除多余的标记
        // 首先识别所有特殊站点位置的标记
        const specialStationMarkers = [];
        const normalMarkers = [];
        
        for (let i = 0; i < draggableRectMarkers.length; i++) {
            const marker = draggableRectMarkers[i];
            if (marker.isDummy) continue; // 跳过虚拟标记
            
            const markerPosition = marker.getLatLng();
            const isSpecialStationPosition = stationData.some(station => 
                Math.abs(station.latitude - markerPosition.lat) < 1e-6 && 
                Math.abs(station.longitude - markerPosition.lng) < 1e-6
            );
            
            if (isSpecialStationPosition) {
                specialStationMarkers.push(marker);
            } else {
                normalMarkers.push(marker);
            }
        }
        
        // 计算需要保留的普通标记数量
        const normalMarkersToKeep = Math.max(0, requiredSegments - specialStationMarkers.length);
        
        // 移除多余的普通标记
        while (normalMarkers.length > normalMarkersToKeep) {
            const excessMarker = normalMarkers.pop();
            excessMarker.off(); // 移除所有事件监听器
            if (map.hasLayer(excessMarker)) {
                map.removeLayer(excessMarker);
            }
        }
        
        // 重新组合标记数组：特殊站点标记 + 保留的普通标记
        draggableRectMarkers.length = 0; // 清空原数组
        specialStationMarkers.forEach(marker => draggableRectMarkers.push(marker));
        normalMarkers.forEach(marker => draggableRectMarkers.push(marker));
        
        // 如果矩形标记数量少于需要的线段数量，添加新的标记
        while (draggableRectMarkers.length < requiredSegments) {
            const segmentIndex = draggableRectMarkers.length;
            const p1 = routePoints[segmentIndex];
            const p2 = routePoints[segmentIndex + 1];
            const midpoint = getMidpoint(p1, p2);
            
            // 检查中点位置是否为特殊站点
            const isSpecialStationMidpoint = stationData.some(station => 
                Math.abs(station.latitude - midpoint.lat) < 1e-6 && 
                Math.abs(station.longitude - midpoint.lng) < 1e-6
            );
            
            // 如果不是特殊站点位置，才创建新的矩形标记
            if (!isSpecialStationMidpoint) {
                const newMarker = createDraggableRectMarker(segmentIndex, midpoint);
                draggableRectMarkers.push(newMarker);
            } else {
                // 如果是特殊站点位置，创建一个虚拟标记来占位，但不显示在地图上
                const dummyMarker = {
                    segmentIndex: segmentIndex,
                    originalPosition: midpoint,
                    isDummy: true, // 标记为虚拟标记
                    setLatLng: function() {}, // 空方法
                    getLatLng: function() { return midpoint; },
                    off: function() {}, // 空方法
                    on: function() {} // 空方法
                };
                draggableRectMarkers.push(dummyMarker);
            }
        }
        
        // 更新所有矩形标记的位置和segmentIndex
        for (let i = 0; i < draggableRectMarkers.length; i++) {
            // 跳过虚拟标记
            if (draggableRectMarkers[i].isDummy) {
                continue;
            }
            
            const p1 = routePoints[i];
            const p2 = routePoints[i + 1];
            const midpoint = getMidpoint(p1, p2);
            
            // 更新矩形标记的位置
            draggableRectMarkers[i].setLatLng(midpoint);
            // 更新存储的原始位置
            draggableRectMarkers[i].originalPosition = midpoint;
            // 更新segmentIndex
            draggableRectMarkers[i].segmentIndex = i;
        }
        
        // 更新距离标记的位置
        if (distanceMarkers.length > 0 && routePoints.length >= 2) {
            for (let i = 0; i < distanceMarkers.length && i < routePoints.length - 1; i++) {
                const p1 = routePoints[i];
                const p2 = routePoints[i + 1];
                const distance = p1.distanceTo(p2);
                const midpoint = getMidpoint(p1, p2);
                
                // 更新距离标记的位置和文本
                distanceMarkers[i].setLatLng(midpoint);
                const distanceText = `${distance.toFixed(2)}m`;
                distanceMarkers[i].setIcon(createDistanceIcon(distanceText));
            }
        }
    } else {
        currentPolyline = null; // 没有路线点时，设置currentPolyline为null
        currentRoutePolyline = null; // 没有路线点时，设置currentRoutePolyline为null
    }
}

let currentInfoBox = null;
function toggleInfoBox(x, y, content, name) {
    const selectedRoute = alldata.find(r => r.routeId == document.getElementById('routeSelect').value);
    if (!selectedRoute) return;

    // 更新 stations 的 area 属性（如果需要）
    const stationToUpdate = selectedRoute.stations.find(station => station.stationName === name);
    if (stationToUpdate && !stationToUpdate.area && stationToUpdate.area == 0) {
        stationToUpdate.area = "1"; // 设置默认值
    }

    const infoBox = document.getElementById('infoBox');
    // 更新信息框的内容
    infoBox.innerHTML = content;

    // 创建选择器组件
    let select = infoBox.querySelector('#stationSelect');
    if (!select) { // 如果不存在，则创建新的
        select = document.createElement('select');
        select.id = 'stationSelect';
        ['避障1', '避障2', '避障3', '避障4', '避障5', '避障6'].forEach((text, idx) => {
            const option = document.createElement('option');
            option.value = idx + 1;
            option.textContent = text;
            select.appendChild(option);
        });
        const currentDiv = document.createElement("div")
        currentDiv.className = "currentDiv"

        const saveBtn = document.createElement('button');
        saveBtn.id = 'saveStation';
        saveBtn.textContent = '保存';
        const cancelBtn = document.createElement('button');
        cancelBtn.id = 'cancelBtn';
        cancelBtn.textContent = '取消';
        cancelBtn.className = 'cancelBtn';
        currentDiv.appendChild(saveBtn);
        currentDiv.appendChild(cancelBtn);
        // 将选择器和按钮添加到信息框中
        infoBox.appendChild(select);
        infoBox.appendChild(currentDiv)
    }
    // 设置选择器的值为当前 station 的 avoid 值
    if (stationToUpdate) {
        select.value = stationToUpdate.area; // 确保 avoid 是数字或可以转换为字符串的值
    }

    // 绑定或重新绑定保存事件（防止重复绑定）
    const cancelBtn = document.getElementById("cancelBtn")
    cancelBtn.onclick = () => {
        infoBox.style.display = 'none';
    }
    // 绑定或重新绑定保存事件（防止重复绑定）
    const saveBtn = infoBox.querySelector('#saveStation');
    saveBtn.onclick = () => {
        const selectedValue = infoBox.querySelector('#stationSelect').value;

        // 直接遍历并更新 avoid 属性
        selectedRoute.stations.forEach(item => {
            if (name === item.stationName) {
                item.area = selectedValue;
            }
        });

        // 示例：处理 currentAvoidArr
        let currentlength = selectedRoute.stations.length;

        selectedRoute.stations.forEach(item => {
            if (item.area) {
                currentAvoidArr.push(item.area);
            } else {
                currentAvoidArr.push("1");
            }
        });
        currentAvoidArr = currentAvoidArr.slice(-currentlength)
        infoBox.style.display = 'none';
    };

    // 设置信息框的位置并显示
    infoBox.style.left = "30px";
    infoBox.style.top = "30px";
    infoBox.style.display = 'block';
}
async function saveRoute() {
    map.off('mousemove', handleMouseMoveLine);
    // 清理预览线和距离标记
    if (previewLine) {
        map.removeLayer(previewLine);
        previewLine = null;
    }
    if (previewDistanceMarker) {
        map.removeLayer(previewDistanceMarker);
        previewDistanceMarker = null;
    }

    // 移除鼠标移动预览事件（避免双击后仍显示预览线）

    toggleStatus = false
    document.querySelector(".text-editLine").textContent = "新增路线";
    addEdit.src = '../plugins/img/img-right/绘制路线 (1).png';
    
    // 隐藏所有加号标记
    hideAddButtonNearStation();

    disableEditing()
    if (routePoints.length === 0) return;
    
    // 获取路线选择框的值，判断是新增还是修改
    const selectElement = document.getElementById('routeSelect');
    const selectedRouteId = selectElement ? selectElement.value : null;
    
    try {
        // 如果选择框有路线，则是修改已有路线
        if (selectedRouteId) {
            // 修改已有路线的逻辑
            const selectedRoute = alldata.find(r => r.routeId == selectedRouteId);
            if (!selectedRoute) {
                cocoMessage.error("未找到选中的路线");
                return;
            }
            
            // 显示修改路线模态框，预填充原有名称和速度
            const routeData = await showRouteEditModal(selectedRoute.routeName, selectedRoute.speed || "0.2");
            if (!routeData) return; // 用户取消操作
            
            const newRouteName = routeData.name;
            const newRouteSpeed = routeData.speed;
            
            const result = routePoints.map((point, index) => {
                // 查找对应的marker
                const matchedMarker = markers.find(marker =>
                    marker.originalData &&
                    marker.originalData.position.lat === point.lat &&
                    marker.originalData.position.lng === point.lng
                );

                let stationId;
                if (matchedMarker && matchedMarker.originalData.id) {
                    // 如果找到匹配的marker，并且有原始ID，则使用该ID
                    stationId = matchedMarker.originalData.id.id;
                } else {
                    // 否则尝试从stationData中匹配，或者设置为-1
                    const matchId = stationData.find(item => item.longitude == point.lng && item.latitude == point.lat);
                    stationId = matchId ? matchId.id : -1;
                }
                
                // 查找暂存的站点属性信息
                const tempStation = window.tempRouteStations ? window.tempRouteStations.find(s => 
                    Math.abs(s.latitude - point.lat) < 1e-6 && 
                    Math.abs(s.longitude - point.lng) < 1e-6
                ) : null;
                
                // 查找特殊站点名称
                const specialStation = stationData.find(item => 
                    Math.abs(item.latitude - point.lat) < 1e-6 && 
                    Math.abs(item.longitude - point.lng) < 1e-6
                );
                
                // 查找原始路线数据中的站点信息
                const originalStation = selectedRoute.stations ? selectedRoute.stations.find(s => 
                    Math.abs(parseFloat(s.latitude) - point.lat) < 1e-6 && 
                    Math.abs(parseFloat(s.longitude) - point.lng) < 1e-6
                ) : null;
                
                // 获取方向值，并根据站点位置自动调整
                let directionValue = tempStation ? tempStation.direction : (originalStation ? originalStation.direction : (localStorage.getItem('globalDefaultDirection') || '0'));
                
                // 起点的航向如果是-360，自动改成360
                if (index === 0 && directionValue === "-360") {
                    directionValue = "360";
                }
                
                // 终点的航向如果是360，自动改成-360
                if (index === routePoints.length - 1 && directionValue === "360") {
                    directionValue = "-360";
                }
                
                // 构建符合用户要求的站点数据结构
                return {
                    id: stationId,
                    stationName: tempStation ? tempStation.stationName : (specialStation ? specialStation.stationName : (originalStation ? originalStation.stationName : `站点${index + 1}`)),
                    stationCode: stationId == "-1" ? "0" : 2,
                    longitude: point.lng.toString(),
                    latitude: point.lat.toString(),
                    positionX: "0",
                    positionY: "0", 
                    positionZ: "0",
                    orientationX: "0",
                    orientationY: "0",
                    orientationZ: index === 0 ? "0" : "0.707",
                    orientationW: index === 0 ? "1" : "0.707",
                    speed: tempStation ? tempStation.speed : (originalStation ? originalStation.speed : (localStorage.getItem('globalRouteSpeed') || "0.2")),
                    action: tempStation ? tempStation.action : (originalStation ? originalStation.action : (localStorage.getItem('globalActionSelect') || "0")),
                    area: tempStation ? tempStation.area : (originalStation ? originalStation.area : (localStorage.getItem('globalObstacleLevel') || "1")),
                    direction: directionValue,
                    stopTime:  "0",
                    position: tempStation ? tempStation.position : (originalStation ? originalStation.position : (localStorage.getItem('globalNavigationMode') || "1")),
                    stop: tempStation ? tempStation.stop : (originalStation ? originalStation.stop : "0"),
                    runmode: tempStation ? tempStation.runmode : (originalStation ? originalStation.runmode : (localStorage.getItem('globalTurnMode') || "0")),
                    lanechange: tempStation ? tempStation.lanechange : (originalStation ? originalStation.lanechange : (localStorage.getItem('globalLanechange') || "0")),
                    avoidDistance: tempStation ? tempStation.avoidDistance : (originalStation ? originalStation.avoidDistance : (localStorage.getItem('globalAvoidDistance') || "0.5"))
                };
            });
            
            const updateMessage = {
                id: selectedRouteId,
                routeId: selectedRouteId,
                routeName: newRouteName,
                mapCoverage: selectedRoute.mapCoverage,
                speed: newRouteSpeed,
                stations: result
            };
            
            
            try {
                const response = await axiosClient.post("route/updateRoute", updateMessage);
                if (response && response.data && !response.data.code) {
                    cocoMessage.success("路线更新成功");
                } else {
                    cocoMessage.error("路线更新失败");
                }
            } catch (error) {
                console.error("Error updating route:", error);
                cocoMessage.error("路线更新失败");
                throw error;
            }
        } else {
            // 新增路线的逻辑
            const routeData = await showRouteNameModal();
            if (!routeData) return; // 用户取消操作
            const inputSaveName = routeData.name;
            const routeSpeed = routeData.speed;
            
            // 保存原始路线点和标记数组，用于创建反向路线
            const originalRoutePoints = [...routePoints];
            const originalMarkers = [...markers];

            // 获取原始路线数据（如果是从现有路线点击新增按钮进入的）
            const originalRouteData = window.originalRouteStations && window.originalRouteStations.length > 0 ? window.originalRouteStations : null;
            
            const result = routePoints.map((point, index) => {
                // 查找对应的marker
                const matchedMarker = markers.find(marker =>
                    marker.originalData &&
                    marker.originalData.position.lat === point.lat &&
                    marker.originalData.position.lng === point.lng
                );

                let stationId;
                if (matchedMarker && matchedMarker.originalData.id) {
                    // 如果找到匹配的marker，并且有原始ID，则使用该ID
                    stationId = matchedMarker.originalData.id.id;
                } else {
                    // 否则尝试从stationData中匹配，或者设置为-1
                    const matchId = stationData.find(item => item.longitude == point.lng && item.latitude == point.lat);
                    stationId = matchId ? matchId.id : -1;
                }
                
                // 查找暂存的站点属性信息
                const tempStation = window.tempRouteStations ? window.tempRouteStations.find(s => 
                    Math.abs(s.latitude - point.lat) < 1e-6 && 
                    Math.abs(s.longitude - point.lng) < 1e-6
                ) : null;
                
                // 查找特殊站点名称
                const specialStation = stationData.find(item => 
                    Math.abs(item.latitude - point.lat) < 1e-6 && 
                    Math.abs(item.longitude - point.lng) < 1e-6
                );
                
                // 查找原始路线数据中的站点信息
                const originalStation = originalRouteData ? originalRouteData.find(s => 
                    Math.abs(s.latitude - point.lat) < 1e-6 && 
                    Math.abs(s.longitude - point.lng) < 1e-6
                ) : null;
                
                // 获取方向值，并根据站点位置自动调整
                let directionValue = tempStation ? tempStation.direction : (originalStation ? originalStation.direction : (localStorage.getItem('globalDefaultDirection') || '0'));
                
                // 起点的航向如果是-360，自动改成360
                if (index === 0 && directionValue === "-360") {
                    directionValue = "360";
                }
                
                // 终点的航向如果是360，自动改成-360
                if (index === routePoints.length - 1 && directionValue === "360") {
                    directionValue = "-360";
                }
                
                // 构建符合用户要求的站点数据结构
                return {
                    id: stationId,
                    stationName: tempStation ? tempStation.stationName : (specialStation ? specialStation.stationName : (originalStation ? originalStation.stationName : "")),
                    stationCode: "0",
                    longitude: point.lng.toString(),
                    latitude: point.lat.toString(),
                    positionX: "0",
                    positionY: "0", 
                    positionZ: "0",
                    orientationX: "0",
                    orientationY: "0",
                    orientationZ: index === 0 ? "0" : "0.707",
                    orientationW: index === 0 ? "1" : "0.707",
                    speed: tempStation ? tempStation.speed : (originalStation ? originalStation.speed : routeSpeed),
                    action: tempStation ? tempStation.action : (originalStation ? originalStation.action : (localStorage.getItem('globalActionSelect') || "0")),
                    area: tempStation ? tempStation.area : (originalStation ? originalStation.area : (localStorage.getItem('globalObstacleLevel') || "1")),
                    direction: directionValue,
                    stopTime:  "0" ,
                    position: tempStation ? tempStation.position : (originalStation ? originalStation.position : (localStorage.getItem('globalNavigationMode') || "1")),
                    stop: tempStation ? tempStation.stop : (originalStation ? originalStation.stop : "0"),
                    runmode: tempStation ? tempStation.runmode : (originalStation ? originalStation.runmode : (localStorage.getItem('globalTurnMode') || "0")),
                    lanechange: tempStation ? tempStation.lanechange : (originalStation ? originalStation.lanechange : (localStorage.getItem('globalLanechange') || "0")),
                    avoidDistance: tempStation ? tempStation.avoidDistance : (originalStation ? originalStation.avoidDistance : "0.5")
                };
            });
            let allRouteName = alldata.map(item => item.routeName)
            let avoidLv = [];
            for (let i = 0; i < result.length; i++) {
                avoidLv.push("1")
            }
            // 构建完整的路线信息JSON数据
            const completeRouteData = {
                routeInfo: {
                    routeName: inputSaveName,
                    mapCoverage: currentMapCover,
                    routesource: 0,
                    speed: routeSpeed
                },
                stations: result.map((point, index) => {
                    // 查找暂存的站点属性信息
                    const tempStation = window.tempRouteStations ? window.tempRouteStations.find(s => 
                        Math.abs(s.latitude - point.latitude) < 1e-6 && 
                        Math.abs(s.longitude - point.longitude) < 1e-6
                    ) : null;
                    
                    // 查找特殊站点名称
                    const specialStation = stationData.find(item => 
                        Math.abs(item.latitude - parseFloat(point.latitude)) < 1e-6 && 
                        Math.abs(item.longitude - parseFloat(point.longitude)) < 1e-6
                    );
                    
                    // 查找原始路线数据中的站点信息
                    const originalStation = originalRouteData ? originalRouteData.find(s => 
                        Math.abs(s.latitude - parseFloat(point.latitude)) < 1e-6 && 
                        Math.abs(s.longitude - parseFloat(point.longitude)) < 1e-6
                    ) : null;
                    
                    return {
                        id: point.id,
                        latitude: point.latitude,
                        longitude: point.longitude,
                        stationName: tempStation ? tempStation.stationName : (specialStation ? specialStation.stationName : (originalStation ? originalStation.stationName : `站点${index + 1}`)),
                        direction: tempStation ? tempStation.direction : (originalStation ? originalStation.direction : (localStorage.getItem('globalDefaultDirection') || '0')),
                        speed: tempStation ? tempStation.speed : (originalStation ? originalStation.speed : (localStorage.getItem('globalRouteSpeed') || "0.2")),
                        area: tempStation ? tempStation.area : (originalStation ? originalStation.area : (localStorage.getItem('globalObstacleLevel') || "1")),
                        action: tempStation ? tempStation.action : (originalStation ? originalStation.action : (localStorage.getItem('globalActionSelect') || "0")),
                        position: tempStation ? tempStation.position : (originalStation ? originalStation.position : (localStorage.getItem('globalNavigationMode') || "1")),
                        stop: tempStation ? tempStation.stop : (originalStation ? originalStation.stop : "0"),
                        runmode: tempStation ? tempStation.runmode : (originalStation ? originalStation.runmode : (localStorage.getItem('globalTurnMode') || "0")),
                    lanechange: tempStation ? tempStation.lanechange : (originalStation ? originalStation.lanechange : (localStorage.getItem('globalLanechange') || "0")),
                    avoidDistance: tempStation ? tempStation.avoidDistance : (originalStation ? originalStation.avoidDistance : "0.5")
                };
                }),
                // rowData: avoidLv,
                // allCoordinates: routePoints.map(point => ({
                //     latitude: point.lat,
                //     longitude: point.lng
                // }))
            };
            
            // 输出完整的JSON数据到控制台
            
            // 保存正向路线
            const saveMessage = {
                routeName: inputSaveName,       // 路线名称
                // mapCoverage: currentMapCover.toString(),      // 地图覆盖层级，转换为字符串
                routesource: "0",              // 路线来源，转换为字符串
                // speed: routeSpeed.toString(),   // 速度，转换为字符串
                stations: result                // 站点数组
            };

    
            
            // 移除所有折线
            if (currentPolyline) map.removeLayer(currentPolyline);
            if (currentRoutePolyline) map.removeLayer(currentRoutePolyline);
            routePoints = [];
            currentPolyline = null;
            currentRoutePolyline = null;
            disableEditing(); // 清除编辑标记

            // 检查正向路线名称是否重复
            if (inputSaveName && !allRouteName.includes(inputSaveName)) {
                try {
                    const response = await axiosClient.post("route/saveRoute", saveMessage);
                    if (response) {
                        // 检查是否需要创建反向路线
                        if (routeData.createReverse) {
                            // 恢复路线点和标记数组
                            routePoints = [...originalRoutePoints];
                            markers = [...originalMarkers];
                            
                            // 反转路线点数组
                            routePoints.reverse();
                            // 同时反转markers数组以保持一致性
                            markers.reverse();
                            
                            // 为反向路线构建结果数组
                            const reverseResult = routePoints.map((point, index) => {
                                // 查找对应的marker
                                const matchedMarker = markers.find(marker =>
                                    marker.originalData &&
                                    marker.originalData.position.lat === point.lat &&
                                    marker.originalData.position.lng === point.lng
                                );

                                let stationId;
                                if (matchedMarker && matchedMarker.originalData.id) {
                                    // 如果找到匹配的marker，并且有原始ID，则使用该ID
                                    stationId = matchedMarker.originalData.id.id;
                                } else {
                                    // 否则尝试从stationData中匹配，或者设置为-1
                                    const matchId = stationData.find(item => item.longitude == point.lng && item.latitude == point.lat);
                                    stationId = matchId ? matchId.id : -1;
                                }
                                
                                // 查找暂存的站点属性信息
                                const tempStation = window.tempRouteStations ? window.tempRouteStations.find(s => 
                                    Math.abs(s.latitude - point.lat) < 1e-6 && 
                                    Math.abs(s.longitude - point.lng) < 1e-6
                                ) : null;
                                
                                // 查找特殊站点名称
                                const specialStation = stationData.find(item => 
                                    Math.abs(item.latitude - point.lat) < 1e-6 && 
                                    Math.abs(item.longitude - point.lng) < 1e-6
                                );
                                
                                // 查找原始路线数据中的站点信息
                                const originalStation = originalRouteData ? originalRouteData.find(s => 
                                    Math.abs(s.latitude - point.lat) < 1e-6 && 
                                    Math.abs(s.longitude - point.lng) < 1e-6
                                ) : null;
                                
                                // 获取方向值，并根据站点位置自动调整
                                let directionValue = tempStation ? tempStation.direction : (originalStation ? originalStation.direction : (localStorage.getItem('globalDefaultDirection') || '0'));
                                
                                // 起点的航向如果是-360，自动改成360
                                if (index === 0 && directionValue === "-360") {
                                    directionValue = "360";
                                }
                                
                                // 终点的航向如果是360，自动改成-360
                                if (index === routePoints.length - 1 && directionValue === "360") {
                                    directionValue = "-360";
                                }
                                
                                // 构建符合用户要求的站点数据结构
                                return {
                                    id: stationId,
                                    stationName: tempStation ? tempStation.stationName : (specialStation ? specialStation.stationName : (originalStation ? originalStation.stationName : "")),
                                    stationCode: "0",
                                    longitude: point.lng.toString(),
                                    latitude: point.lat.toString(),
                                    positionX: "0",
                                    positionY: "0", 
                                    positionZ: "0",
                                    orientationX: "0",
                                    orientationY: "0",
                                    orientationZ: index === 0 ? "0" : "0.707",
                                    orientationW: index === 0 ? "1" : "0.707",
                                    speed: tempStation ? tempStation.speed : (originalStation ? originalStation.speed : routeSpeed),
                                    action: tempStation ? tempStation.action : (originalStation ? originalStation.action : (localStorage.getItem('globalActionSelect') || "1")),
                                    area: tempStation ? tempStation.area : (originalStation ? originalStation.area : (localStorage.getItem('globalObstacleLevel') || "1")),
                                    direction: directionValue,
                                    stopTime:  "0" ,
                                    position: tempStation ? tempStation.position : (originalStation ? originalStation.position : (localStorage.getItem('globalNavigationMode') || "1")),
                                    stop: tempStation ? tempStation.stop : (originalStation ? originalStation.stop : "0"),
                                    runmode: tempStation ? tempStation.runmode : (originalStation ? originalStation.runmode : (localStorage.getItem('globalTurnMode') || "0")),
                                    lanechange: tempStation ? tempStation.lanechange : (originalStation ? originalStation.lanechange : (localStorage.getItem('globalLanechange') || "0")),
                                    avoidDistance: tempStation ? tempStation.avoidDistance : (originalStation ? originalStation.avoidDistance : (localStorage.getItem('globalAvoidDistance') || "0.5"))
                                };
                            });
                            
                            // 构建反向路线的保存消息
                            const reverseRouteName = inputSaveName + '_返';
                            const reverseSaveMessage = {
                                routeName: reverseRouteName,       // 反向路线名称
                                mapCoverage: currentMapCover.toString(),      // 地图覆盖层级，转换为字符串
                                routesource: "0",              // 路线来源，转换为字符串
                                speed: routeSpeed.toString(),   // 速度，转换为字符串
                                stations: reverseResult         // 站点数组
                            };
                            
                            
                            try {
                                const reverseResponse = await axiosClient.post("route/saveRoute", reverseSaveMessage);
                                if (reverseResponse) {
                                    cocoMessage.success("反向路线保存成功");
                                } else {
                                    console.error("Unexpected response structure from API for reverse route");
                                    cocoMessage.error("反向路线保存失败");
                                }
                            } catch (error) {
                                console.error("Error saving reverse route:", error);
                                cocoMessage.error("反向路线保存失败");
                            }
                        }
                    } else {
                        console.error("Unexpected response structure from API");
                        cocoMessage.error("路线保存失败");
                    }
                } catch (error) {
                    console.error("Error fetching data:", error); // 打印完整的错误信息
                    cocoMessage.error("路线保存失败");
                    throw error; // 抛出错误以便在调用处捕获
                }
            } else {
                cocoMessage.error("名字重复，请重新输入")
            }
        }
        
        await getAllRoute()
        await getAllCurrentPoint()
        // await renderStations();
        // 修改路线时，选择被修改的路线ID；新增路线时，选择最后一个路线
        await populateRouteSelect(!selectedRouteId, selectedRouteId);
        // await refreshDataAndUI(); // 封装数据刷新与UI清理
        
        // 清理暂存的站点数据
        window.tempRouteStations = [];
    } catch (error) {
        cocoMessage.error("保存失败: " + error.message);
    }
    toggleStatus = false
    editRouteStatus = false
    deleteBtnStatus = false
    addBtnStatus = false
    
    // 重置新增路线相关状态变量，确保保存完路线后退出新增模式
    window.isAddingToExistingRoute = false;
    window.isNewRouteMode = false;
    window.tempRouteStations = [];

    // 移除地图事件监听器
    map.off('click', handleMapClick);
    map.off('mousemove', handleMouseMoveLine);
    
    // 注释掉隐藏加号标记的调用，确保特殊点标记不受影响
    // hideAddButtonNearStation();
    
    // 显示编辑结束提示
    cocoMessage.success("编辑模式已关闭");
}

// 删除所有站点样式
async function deleteCurrentRoute() {
    // 移除与 ccpp/traverseRoute 接口请求相关的事件监听器
    // 移除旧的监听器
    // document.getElementById("saveFirstPoint").removeEventListener("click", previewRouteHandler);
    // 移除当前的 polyline（如果存在）
    if (currentPolyline) {
        map.removeLayer(currentPolyline);
        currentPolyline = null;
    }
    if (currentRoutePolyline) {
        map.removeLayer(currentRoutePolyline);
        currentRoutePolyline = null;
    }
    
    // 移除所有标记，包括特殊点标记
    markers.forEach(marker => {
        if (map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
        // 移除标记对应的标签
        if (marker.options.tooltip) {
            marker.closeTooltip();
            marker.options.tooltip = null;
        }
        // 移除标记的事件监听器（如果有）
        marker.off('click');
        marker.off('dragend');
        marker.off('mouseover');
        marker.off('mouseout');
    });
    markers = [];

    // 移除编辑模式下的可拖动标记
    editableMarkers.forEach(marker => {
        if (map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
        // 移除标记对应的标签
        if (marker.options.tooltip) {
            marker.closeTooltip();
            marker.options.tooltip = null;
        }
        // 移除标记的事件监听器（如果有）
        marker.off('click');
        marker.off('dragend');
        marker.off('mouseover');
        marker.off('mouseout');
    });
    editableMarkers = [];
    
    // 清除所有距离标记
    distanceMarkers.forEach(marker => {
        // 移除所有事件监听器
        try {
            marker.off();
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        } catch (e) {
            console.warn('清除距离标记时出错:', e);
        }
    });
    distanceMarkers = [];
    
    // 清除所有可拖动矩形标记
    draggableRectMarkers.forEach(marker => {
        // 移除所有事件监听器
        try {
            marker.off();
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
        } catch (e) {
            console.warn('清除矩形标记时出错:', e);
        }
    });
    draggableRectMarkers = [];

    // 移除机器位置标记
    if (machineMarker) {
        if (map.hasLayer(machineMarker)) {
            map.removeLayer(machineMarker);
        }
        machineMarker = null;
    }

    routePoints = [];
    // // 重置相关状态
    dragStatus = false;
    editStatus = false;

    // 移除地图上可能存在的其他未被清理的图层
    const allLayers = map._layers;
    Object.keys(allLayers).forEach(key => {
        const layer = allLayers[key];
        if (layer instanceof L.Polyline || layer instanceof L.Marker) {
            map.removeLayer(layer);
        }
    });

    const icon = L.icon({
        iconUrl: '../plugins/img/当前位置 (2).png', // 替换为你的图标URL
        iconSize: [16, 16], // 图标大小
        iconAnchor: [8, 8] // 图标锚点
    });
    const markerHome = L.marker([initlatitudeCurrent, initlongitudeCurrent], { icon: icon ,zIndexOffset: -90000 }).addTo(map);
    createMachineMarkerIfNeeded();
    // 重置特殊点图标为原始状态
    resetSpecialStationIcons();
 
}

// 重置特殊点图标为原始状态
function resetSpecialStationIcons() {
    // 这个函数现在不需要做任何事情，因为renderStations函数已经负责重新创建所有标记
    // 保留这个函数以避免可能的引用错误
}

function createMachineMarkerIfNeeded() {
    const lat = parseFloat(localStorage.getItem('latitudeCurrent'));
    const lng = parseFloat(localStorage.getItem('longitudeCurrent'));

    // 校验坐标有效性
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        createMachineMarker({ lat, lng }, map);
    }
}
//展示模态框
function showRouteNameModal() {
    return new Promise((resolve) => {
        const modal = new bootstrap.Modal('#routeNameModal');
        const input = document.getElementById('routeNameInput');
        const speedInput = document.getElementById('routeSpeedInput');
        const errorDiv = document.getElementById('duplicateError');
        
        // 隐藏速度输入框
        if (speedInput && speedInput.parentElement) {
            speedInput.parentElement.style.display = 'none';
        }
        
        // 添加反向路线复选框元素
        let reverseRouteCheckbox = document.getElementById('reverseRouteCheckbox');
        let reverseRouteLabel = document.getElementById('reverseRouteLabel');
        
        // 如果元素不存在，则创建它们
        if (!reverseRouteCheckbox) {
            // 创建复选框
            reverseRouteCheckbox = document.createElement('input');
            reverseRouteCheckbox.type = 'checkbox';
            reverseRouteCheckbox.id = 'reverseRouteCheckbox';
            reverseRouteCheckbox.className = 'form-check-input';
            
            // 创建标签
            reverseRouteLabel = document.createElement('label');
            reverseRouteLabel.id = 'reverseRouteLabel';
            reverseRouteLabel.className = 'form-check-label';
            reverseRouteLabel.htmlFor = 'reverseRouteCheckbox';
            reverseRouteLabel.textContent = '同时创建反向路线（反向路线名称将自动添加"_返"后缀）';
            
            // 创建容器
            const container = document.createElement('div');
            container.className = 'form-check mt-2';
            container.appendChild(reverseRouteCheckbox);
            container.appendChild(reverseRouteLabel);
            
            // 添加到模态框body中
            const modalBody = document.querySelector('#routeNameModal .modal-body');
            modalBody.appendChild(container);
        }

        const cleanup = () => {
            input.value = '';
            speedInput.value = localStorage.getItem('globalRouteSpeed') || '0.2';
            errorDiv.style.display = 'none';
            // 重置复选框选择
            if (reverseRouteCheckbox) reverseRouteCheckbox.checked = false;
            modal.hide();
        };

        document.getElementById('confirmSave').onclick = () => {
            const currentName = input.value.trim();
            const currentSpeed = localStorage.getItem('globalRouteSpeed') || '0.2';
            const allRouteNames = alldata.map(item => item.routeName);
            
            // 获取是否同时创建反向路线的选择
            const createReverseRoute = reverseRouteCheckbox && reverseRouteCheckbox.checked;
            
            // 检查正向路线名称是否重复
            const isForwardDuplicate = allRouteNames.includes(currentName);
            
            // 检查反向路线名称是否重复
            const reverseRouteName = currentName + '_返';
            const isReverseDuplicate = allRouteNames.includes(reverseRouteName);

            if (isForwardDuplicate || (createReverseRoute && isReverseDuplicate)) {
                let errorMsg = '';
                if (isForwardDuplicate) errorMsg += '正向路线名称已存在。';
                if (createReverseRoute && isReverseDuplicate) errorMsg += '反向路线名称已存在。';
                errorDiv.textContent = errorMsg;
                errorDiv.style.display = 'block'; // 显示重复错误提示
            } else {
                cleanup();
                resolve({ 
                    name: currentName, 
                    speed: currentSpeed,
                    createReverse: createReverseRoute
                });
            }
        };

        modal.show();
        input.focus();

        modal._element.addEventListener('hidden.bs.modal', () => {
            resolve(null); // 模态框关闭时返回null
        });
    });
}

//展示修改路线模态框
function showRouteEditModal(originalName, originalSpeed) {
    return new Promise((resolve) => {
        const modal = new bootstrap.Modal('#routeNameModal');
        const input = document.getElementById('routeNameInput');
        const speedInput = document.getElementById('routeSpeedInput');
        const errorDiv = document.getElementById('duplicateError');

        // 隐藏速度输入框
        if (speedInput && speedInput.parentElement) {
            speedInput.parentElement.style.display = 'none';
        }

        // 预填充原有数据
        input.value = originalName;
        speedInput.value = originalSpeed;
        errorDiv.style.display = 'none';

        const cleanup = () => {
            input.value = '';
            speedInput.value = localStorage.getItem('globalRouteSpeed') || '0.2';
            errorDiv.style.display = 'none';
            modal.hide();
        };

        document.getElementById('confirmSave').onclick = () => {
            const currentName = input.value.trim();
            const currentSpeed = parseFloat(speedInput.value) || 0.2;
            const allRouteNames = alldata.map(item => item.routeName);
            
            // 检查是否与其他路线重名（排除当前路线）
            const hasDuplicate = allRouteNames.includes(currentName) && currentName !== originalName;

            if (hasDuplicate) {
                errorDiv.style.display = 'block'; // 显示重复错误提示
            } else {
                cleanup();
                resolve({ name: currentName, speed: currentSpeed });
            }
        };

        modal.show();
        input.focus();

        modal._element.addEventListener('hidden.bs.modal', () => {
            resolve(null); // 模态框关闭时返回null
        });
    });
}

// 绑定随机移动按钮的点击事
function callBack() {
        hideAddButtonNearStation()
        if(callbackStatus ==3){
            cocoMessage.success("当前不处于新增或者编辑状态")
            return
        }
        if (previewLine) {
            map.removeLayer(previewLine);
            previewLine = null;
        }
        if (previewDistanceMarker) {
            map.removeLayer(previewDistanceMarker);
            previewDistanceMarker = null;
        }
    if (callbackStatus == 2) {
        if (routePoints.length === 0) return;

        // 获取被移除的坐标点
        const removedPoint = routePoints.pop();
        let lat = removedPoint[0]
        let lng = removedPoint[1]

        // 移除对应的标记
        let foundMarkerIndex = -1;
        for (let i = 0; i < editableMarkers.length; i++) {
            const markerLatLng = editableMarkers[i].getLatLng();
            if (Math.abs(markerLatLng.lat - lat) < 1e-6 && Math.abs(markerLatLng.lng - lng) < 1e-6) {
                foundMarkerIndex = i;
                break;
            }
        }

        if (foundMarkerIndex > -1) {
            const markerToRemove = editableMarkers[foundMarkerIndex];
            map.removeLayer(markerToRemove); // 从地图上移除标记
            editableMarkers.splice(foundMarkerIndex, 1); // 从editableMarkers中移除
            markers.splice(markers.indexOf(markerToRemove), 1); // 从markers中移除
        }

        // 更新折线显示
        if (currentRoutePolyline) map.removeLayer(currentRoutePolyline); // 移除旧的折线

        if (routePoints.length > 0) {
            currentRoutePolyline = L.polyline(routePoints, { color: 'red', weight: 3 }).addTo(map);
        } else {
            currentRoutePolyline = null;
        }
    } else if (callbackStatus == 1) {
        // 这是新增路线可以使用的
        if (routePoints.length === 0) return;
        
        // 获取最后一个标记的当前位置（可能是被拖动后的位置）
        const lastMarker = markers[markers.length - 1];
        let lat, lng;
        
        if (lastMarker) {
            const markerLatLng = lastMarker.getLatLng();
            lat = markerLatLng.lat;
            lng = markerLatLng.lng;
        } else {
            // 如果没有标记，使用routePoints的最后一个点
            const removedPoint = routePoints.pop();
            lat = removedPoint.lat;
            lng = removedPoint.lng;
        }
        
        // 从routePoints中移除最后一个点
        routePoints.pop();

        // 检查是否属于预设站点（含容差比较）
        const isPresetStation = stationData.some(station =>
            Math.abs(station.latitude - lat) < 1e-6 &&
            Math.abs(station.longitude - lng) < 1e-6
        );

        // 判断撤回的点是否为起点
        const isStartPoint = routePoints.length > 0 &&
            Math.abs(routePoints[0].lat - lat) < 1e-6 &&
            Math.abs(routePoints[0].lng - lng) < 1e-6;

        // 检查该位置是否还有其他点存在
        const hasOtherPoints = routePoints.some(point =>
            Math.abs(point.lat - lat) < 1e-6 &&
            Math.abs(point.lng - lng) < 1e-6
        );
        // 移除对应的标记
        if (!isStartPoint && !isPresetStation && !hasOtherPoints) {
            // 找到并移除对应的标记，但保留特殊站点标记
            for (let i = markers.length - 1; i >= 0; i--) {
                const markerLatLng = markers[i].getLatLng();
                if (Math.abs(markerLatLng.lat - lat) < 1e-6 &&
                    Math.abs(markerLatLng.lng - lng) < 1e-6) {
                    
                    // 检查该标记是否为特殊站点
                    const isSpecialStation = stationData.some(station => 
                        Math.abs(station.latitude - markerLatLng.lat) < 1e-6 && 
                        Math.abs(station.longitude - markerLatLng.lng) < 1e-6
                    );
                    
                    // 如果不是特殊站点，才移除标记
                    if (!isSpecialStation) {
                        map.removeLayer(markers[i]);
                        markers.splice(i, 1); // 更新标记数组
                    }
                    break; // 找到后退出循环
                }
            }
        }

        // 调用updatePolyline函数统一更新折线显示
        updatePolyline();
        // 重新计算和更新所有距离标记
        distanceMarkers.forEach(marker => {
            try {
                map.removeLayer(marker);
            } catch (e) {
                console.warn('清除距离标记时出错:', e);
            }
        });
        distanceMarkers = [];

        // 移除机器位置标记
        if (machineMarker) {
            if (map.hasLayer(machineMarker)) {
                map.removeLayer(machineMarker);
            }
            machineMarker = null;
        }
        
        // 当有至少两个点时，为每一段线段重新添加距离标记
        if (routePoints.length >= 2) {
            for (let i = 0; i < routePoints.length - 1; i++) {
                const p1 = routePoints[i];
                const p2 = routePoints[i + 1];

                const distance = p1.distanceTo(p2);

                // 计算线段中点
                const midpoint = getMidpoint(p1, p2);

                // 创建并添加距离标记
                const distanceText = `${distance.toFixed(2)}m`;
                const distanceMarker = L.marker(midpoint, {
                    icon: createDistanceIcon(distanceText),
                    interactive: false // 标记不可交互，避免干扰地图操作
                }).addTo(map);
                distanceMarkers.push(distanceMarker);
            }
        }
    }
}



//重新遍历站点前，遍历并清除所有标记。
function clearExistingMarkers() {
    // 保留特殊站点标记，只移除非特殊站点标记
    for (let i = markers.length - 1; i >= 0; i--) {
        const marker = markers[i];
        
        // 检查是否为特殊站点
        let isSpecialStation = false;
        if (marker.getLatLng && stationData && stationData.length > 0) {
            const markerLatLng = marker.getLatLng();
            for (const station of stationData) {
                if (Math.abs(markerLatLng.lat - station.latitude) < 0.000001 && 
                    Math.abs(markerLatLng.lng - station.longitude) < 0.000001) {
                    isSpecialStation = true;
                    break;
                }
            }
        }
        
        // 只移除非特殊站点标记
        if (!isSpecialStation) {
            if (map.hasLayer(marker)) {
                map.removeLayer(marker);
            }
            markers.splice(i, 1);
        }
    }
}

async function getCurrentPositonXY() {
    // 如果处于新增路线功能状态，先关闭新增功能
    if (toggleStatus) {
        // 调用toggleClickEventWithoutRoute函数关闭新增功能
        await toggleClickEventWithoutRoute();
    }
    
    // 如果处于编辑状态，也要结束编辑
    if (editRouteStatus) {
        // 调用editToggleClickEventWithRoute函数结束编辑模式
        await editToggleClickEventWithRoute();
    }
    
    // 这里可以处理表单提交逻辑
    if (!latitudeCurrent || !longitudeCurrent) {
        // 或者如果您希望在点击按钮打开模态框时才设置placeholder，可以这样做：
        document.getElementById('siteName').setAttribute('placeholder', '请输入站点名称');
        document.getElementById('addlongitude').setAttribute('placeholder', '未找到机器的位置,请输入');
        document.getElementById('addlatitude').setAttribute('placeholder', '未找到机器的位置,请输入');
    }
    // 检查名字是否有效
    else {
        document.getElementById('addlongitude').value = longitudeCurrent
        document.getElementById('addlatitude').value = latitudeCurrent
    }
    // 确保allparams被正确赋值后调用addCuurrentPoint

}

function removeInputValue() {
    document.getElementById('siteName').value = ""
    document.getElementById('addlongitude').value = ""
    document.getElementById('addlatitude').value = ""
}
//这个程序是直接获取机器的实时位置，如果没有就手动输入进行保存
function addCuurrentPoint() {
    // 示例：简单地关闭模态框
     // 清除所有路线点和标签


    var myModal = bootstrap.Modal.getInstance(document.getElementById('exampleModal'));
    let siteName = document.getElementById('siteName').value;
    let addlongitude = document.getElementById('addlongitude').value;
    let addlatitude = document.getElementById('addlatitude').value;
    let allparams = {
        latitude: addlatitude,
        longitude: addlongitude,
        positionX: localStorage.getItem("localX"),
        positionY: localStorage.getItem("localY"),
        positionZ: 0,
        orientationX: localStorage.getItem("orientationX") || 0,
        orientationY: localStorage.getItem("orientationY") || 0,
        orientationZ: localStorage.getItem("orientationZ") || 0,
        orientationW: localStorage.getItem("orientationW") || 0,
        stationName: siteName, // 添加站点名称到参数中
        stationCode: 2
    };
    if (addlongitude && addlatitude) {
        axiosClient.post("station/add", allparams)
            .then((res) => {
                let flag = res.data.code;
                if (!flag) { // 假设code为false表示成功
                    cocoMessage.success("新添成功");
                    // 调用getAllCurrentPoint函数获取最新的站点数据
                    getAllCurrentPoint().then(() => {
                        // 在获取数据成功后，调用renderStations函数重新渲染站点标记
                        renderStations();
                        
                        // 重新渲染当前选中的路线，确保路线上的站点标记不会消失
                        const selectedRouteId = document.getElementById("routeSelect").value;
                        if (selectedRouteId) {
                            const selectedRoute = alldata.find(r => r.routeId == selectedRouteId);
                            if (selectedRoute) {
                                // 更新currentRouteMsg
                                currentRouteMsg = selectedRoute.stations;
                                // 重新渲染路线
                                const routeSelect = document.getElementById("routeSelect");
                                const event = new Event('change', { bubbles: true });
                                routeSelect.dispatchEvent(event);
                            }
                        }
                    });
                    removeInputValue()
                    myModal.hide();
                } else {
                    cocoMessage.error("新增失败，请勿重复名字");
                    myModal.hide();
                    removeInputValue()
                }
            })
            .catch((error) => {
                console.log("catch", error);
            });
    } else {
        cocoMessage.error("新增失败，经纬度不能为空");
    }
}

// 获取DOM元素
const drawer = document.getElementById('customDrawer');
const pageContent = document.getElementById('pageContent');
const openDrawerBtn = document.getElementById('openDrawerBtn');
const closeDrawerBtn = document.getElementById('closeDrawerBtn');

// 打开抽屉函数
async function openDrawer() {
    await deleImportData()
    drawer.classList.add('open');
    if (window.innerWidth > 992) {
        pageContent.classList.add('shifted');
    }
}

// 关闭抽屉函数
function closeDrawer() {

    drawer.classList.remove('open');
    pageContent.classList.remove('shifted');
}

// 绑定按钮事件
openDrawerBtn.addEventListener('click', openDrawer);
closeDrawerBtn.addEventListener('click', closeDrawer);

// 监听窗口大小变化
window.addEventListener('resize', () => {
    if (window.innerWidth <= 992 && drawer.classList.contains('open')) {
        pageContent.classList.remove('shifted');
    } else if (window.innerWidth > 992 && drawer.classList.contains('open')) {
        pageContent.classList.add('shifted');
    }
});
async function updateRobotData(boot_point) {
    const paramRequest = {
        id: 1,
        boot_point: boot_point || "0",
    };
    try {
        const res = await axiosClient.post("param/update", paramRequest);
        let flag = res.data.code;
        if (!flag) {
            // rosManager.updateTopicPub.publish(rosManager.CAR_RUN_MSG);
            rosManager.updateTopicPub.publish(rosManager.CAR_RUN_MSG);
        } else {
            cocoMessage.error("更新失败");
        }
    } catch (error) {
        console.error("Error updating data:", error); // 打印完整的错误信息
    }
}

// 声明在函数外部，以便可以移除它
let deleteClickListener;
async function deleImportData() {
    let allImportPoints = await axiosClient.get("station/querynew/2");
    const itemList = document.getElementById('itemList');
    const filterInput = document.getElementById('filterInput');
    const resetFilterBtn = document.getElementById('resetFilterBtn');


    let originalItems = allImportPoints.data.data[0] || [];
    let filteredItems = [...originalItems];
    // 移除旧的监听器（如果存在）
    if (deleteClickListener) {
        itemList.removeEventListener('click', deleteClickListener);
    }
    // 初始化渲染
    renderItems(originalItems);

    // 添加新的监听器并保存引用
    deleteClickListener = async function (e) {
        if (e.target.classList.contains('delete-btn')) {
            const listItem = e.target.closest('.list-group-item');
            const itemId = parseInt(listItem.dataset.id);
            await axiosClient
                .delete("station/delete/" + itemId)
                .then(async (res) => {
                    let flag = res.data.code;
                    if (!flag) {
                        cocoMessage.success("删除成功");
                        await deleteCurrentRoute()
                         document.getElementById("routeSpeed").textContent = "";
                        await getAllCurrentPoint().then(() => {
                            // 在获取数据成功后，调用renderStations函数重新渲染站点标记
                            renderStations();
                        });
                        await getAllRoute()
                        await populateRouteSelect();
                       
                    } else {
                        cocoMessage.error("删除失败");
                    }
                })
                .finally(() => {
                    // 确保删除按钮在删除动画完成后移除
                   document.getElementById("routeSpeed").textContent = "";
                })
                .catch((error) => {
                    console.log("catch");
                });

            // 记录当前滚动位置
            const scrollTop = itemList.parentElement.scrollTop;

            // 添加删除动画
            listItem.classList.add('deleting');

            // 动画结束后删除元素
            setTimeout(() => {
                // 从原始数据中删除
                originalItems = originalItems.filter(item => item.id !== itemId);

                // 重新应用筛选
                applyFilter();

                // 恢复滚动位置（考虑到列表高度变化）
                itemList.parentElement.scrollTop = adjustScrollPosition(scrollTop, listItem.offsetHeight);
            }, 300);
        } else if (e.target.classList.contains('set-startup-btn')) {
            // 处理设置为开机点按钮点击事件
            const listItem = e.target.closest('.list-group-item');
            const itemId = parseInt(listItem.dataset.id);
            const stationName = listItem.textContent.trim().split('\n')[0]; // 获取站点名称
            
            // 从原始数据中找到对应的站点信息
            const stationData = originalItems.find(item => item.id === itemId);
            
            // 显示确认对话框
            if (confirm(`确定要将站点 "${stationName}" 设置为开机点吗？`)) {
                try {
                    // 打印站点的所有属性信息
                    if (stationData) {
                    const poseWithCovariance = new ROSLIB.Message({
                    header: {
                        stamp: {
                            secs: Math.floor(Date.now() / 1000),
                            nsecs: (Date.now() % 1000) * 1000000
                        },
                        frame_id: "map"  // 坐标系，通常是 "map" 或 "odom"
                    },
                    pose: {
                        pose: {
                        position: {
                            x: parseFloat(stationData.positionX),
                            y: parseFloat(stationData.positionY),
                            z: 0.0
                        },
                        orientation: {
                            x: parseFloat(stationData.orientationX) || 0.0,
                            y: parseFloat(stationData.orientationY) || 0.0,
                            z: parseFloat(stationData.orientationZ) || 0.0,
                            w: parseFloat(stationData.orientationW) || 1.0
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
                    });
                      rosManager.initialPosePub.publish(poseWithCovariance);
                        // 计算欧拉角（偏航角）
                        if (stationData.orientationX && stationData.orientationY && 
                            stationData.orientationZ && stationData.orientationW) {
                            const qx = parseFloat(stationData.orientationX);
                            const qy = parseFloat(stationData.orientationY);
                            const qz = parseFloat(stationData.orientationZ);
                            const qw = parseFloat(stationData.orientationW);
                            
                            // 计算yaw（偏航）角度
                            const ysqr = qy * qy;
                            const t3 = 2.0 * (qw * qz + qx * qy);
                            const t4 = 1.0 - 2.0 * (ysqr + qz * qz);
                            const yaw = Math.atan2(t3, t4);
                            
                           
                        }
                    }
                    
                    // 这里可以添加实际的API调用逻辑
                    // 例如：await axiosClient.post("station/setStartup/" + itemId);
                    // 临时显示成功消息
                    cocoMessage.success(`站点 "${stationName}" 已设置为开机点`);
                    // 可以在这里添加视觉反馈，比如高亮显示当前设置为开机点的站点
                    // 移除其他站点的开机点标记
                    document.querySelectorAll('.list-group-item').forEach(item => {
                        item.classList.remove('startup-station');
                    });
                    // 为当前站点添加开机点样式
                    listItem.classList.add('startup-station');
                    
                } catch (error) {
                    console.error('设置开机点失败:', error);
                    cocoMessage.error('设置开机点失败');
                }
            }
        } else if (e.target.classList.contains('set-default-startup-btn')) {
            // 处理设置为默认开机点按钮点击事件
            const listItem = e.target.closest('.list-group-item');
            const itemId = parseInt(listItem.dataset.id);
            const stationName = listItem.textContent.trim().split('\n')[0]; // 获取站点名称
            
            // 显示确认对话框
            if (confirm(`确定要将站点 "${stationName}" 设置为默认开机点吗？`)) {
                try {
                    // 更新currentBootPoint变量
                    currentBootPoint = itemId;
                    
                    // 重新渲染列表以更新按钮状态
                    renderItems(filteredItems.length > 0 ? filteredItems : originalItems);
                    updateRobotData(currentBootPoint);
                    // 显示成功消息
                    cocoMessage.success(`站点 "${stationName}" 已设置为默认开机点`);
                    // 这里可以添加保存到服务器的API调用
                    // 例如：await axiosClient.post("station/setDefaultStartup/" + itemId);
                    
                } catch (error) {
                    console.error('设置默认开机点失败:', error);
                    cocoMessage.error('设置默认开机点失败');
                }
            }
        }
    };

    itemList.addEventListener('click', deleteClickListener);

    // 筛选功能（仅文本筛选）
    filterInput.addEventListener('input', applyFilter);
    resetFilterBtn.addEventListener('click', resetFilter);
    // 应用筛选（仅文本匹配）
    function applyFilter() {
        const searchTerm = filterInput.value.toLowerCase().trim();
        filteredItems = originalItems.filter(item =>
            item.stationName.toLowerCase().includes(searchTerm)
        );
        renderItems(filteredItems);
    }

    // 重置筛选
    function resetFilter() {
        filterInput.value = '';
        applyFilter();
    }
    // 创建列表项元素


    function createListItem(item) {
   
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center';
        li.dataset.id = item.id;
        
        // 判断是否为当前开机点
        const isBootPoint = item.id == currentBootPoint;
        
        li.innerHTML = `
          ${item.stationName}
          
          <div class="btn-group" role="group">
            <button class="btn btn-sm ${isBootPoint ? 'btn-success' : 'btn-outline-success'} set-default-startup-btn" title="设置当前点为默认开机点">
              <i class="bi bi-star${isBootPoint ? '-fill' : ''}"></i> ${isBootPoint ? '默认开机点' : '设为默认开机点'}
            </button>
            <button class="btn btn-sm btn-primary set-startup-btn" title="设置为开机点">
              <i class="bi bi-play-fill"></i> 设为开机点
            </button>

            <button class="btn btn-sm btn-danger delete-btn">
              <i class="bi bi-trash"></i> 删除
            </button>
          </div>
        `;
        return li;
    }

    // 渲染列表
    function renderItems(items) {
        itemList.innerHTML = '';
        items.forEach(item => {
            const li = createListItem(item);
            itemList.appendChild(li);
        });
    }

    // 调整滚动位置
    function adjustScrollPosition(originalScrollTop, deletedItemHeight) {
        return Math.max(0, originalScrollTop - deletedItemHeight);
    }
}
// 获取DOM元素
const progressCircle = document.getElementById('progressCircle');
const percentageText = document.getElementById('percentage');
const alreadySend = document.getElementById('alreadysend').querySelector('span');
const needSend = document.getElementById('needsend').querySelector('span');
// 圆周长
const circumference = 2 * Math.PI * 45;
// 设置圆环样式
progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
progressCircle.style.strokeDashoffset = circumference;

// 更新进度edit
function updateProgress(percent) {
    if (percent == 0) {
        alreadySend.textContent = 0;
        needSend.textContent = 0;
        percentageText.textContent = `${Math.round(percent)}%`;
    }
    else {
        const offset = circumference - (percent / 100) * circumference;
        progressCircle.style.strokeDashoffset = offset;
        percentageText.textContent = `${Math.round(percent)}%`;
    }
}
// 初始化显示20%进度
updateProgress(0);
// 计算两个点之间的方向角度
window.calculateDirectionFromPoints = function(stationId, boxIndex, centerLat, centerLng) {
    // 获取前一个站点的坐标
    let prevLat = null, prevLon = null;
  
   if (previewLine) {
            map.removeLayer(previewLine);
            previewLine = null;
        }
    if (previewDistanceMarker) {
            map.removeLayer(previewDistanceMarker);
            previewDistanceMarker = null;
    }
    map.off('mousemove', handleMouseMoveLine);
    map.off('click', hideInfoBoxesOnMapClick);
    map.off('click', closeOnMapClick);
    // 检查是否为新增路线模式
    const isAddingMode = window.isAddingToExistingRoute || (window.tempRouteStations && window.tempRouteStations.length > 0);
    
    // if (isAddingMode && boxIndex !== undefined && boxIndex !== null) {
     if (isAddingMode && boxIndex !== undefined && boxIndex !== null) {
            // 新增路线模式：通过坐标匹配找到当前点在tempRouteStations中的位置，然后获取前一个点
        // 首先找到当前点击的站点在tempRouteStations中的索引
        let currentStationIndex = -1;
        if (window.tempRouteStations && window.tempRouteStations.length > 0) {
            // 通过boxIndex找到对应的station对象（从stations数组中）
            // 注意：这里需要通过其他方式获取当前点击站点的坐标，因为boxIndex只是stations数组的索引
            // 我们可以通过函数参数中的centerLat和centerLng来匹配当前站点
            for (let i = 0; i < window.tempRouteStations.length; i++) {
                const tempStation = window.tempRouteStations[i];
                if (Math.abs(tempStation.latitude - centerLat) < 1e-6 && 
                    Math.abs(tempStation.longitude - centerLng) < 1e-6) {
                    currentStationIndex = i;
                    break;
                }
            }
        }
        
        if (currentStationIndex > 0) {
            // 获取前一个站点
            const prevStation = window.tempRouteStations[currentStationIndex - 1];
            if (prevStation && prevStation.longitude && prevStation.latitude) {
                prevLat = parseFloat(prevStation.latitude);
                prevLon = parseFloat(prevStation.longitude);
            }
        }
    } else {
        // 非新增路线模式：使用原有逻辑
        const routeSelect = document.getElementById('routeSelect');
        const selectedRouteId = routeSelect ? routeSelect.value : null;
        
        if (selectedRouteId && alldata) {
            const selectedRoute = alldata.find(r => r.routeId == selectedRouteId);
            if (selectedRoute && selectedRoute.stations) {
                let currentIndex = -1;
                
                if (stationId && stationId !== "-1" && stationId !== "null" && stationId !== null) {
                    currentIndex = selectedRoute.stations.findIndex(station => station.stationId === stationId);
                }
                
                if (currentIndex > 0) {
                    const prevStation = selectedRoute.stations[currentIndex - 1];
                    prevLat = parseFloat(prevStation.latitude);
                    prevLon = parseFloat(prevStation.longitude);
                }
            }
        }
    }
    
    // 保存当前新增模式状态并暂停路线新增功能
    window.savedRouteAddMode = {
        isAddingToExistingRoute: window.isAddingToExistingRoute,
        toggleStatus: toggleStatus
    };
    
    // 暂停路线新增功能
    window.isAddingToExistingRoute = false;
    const originalToggleStatus = toggleStatus;
    toggleStatus = false;
    
    // 移除之前的事件监听器（如果存在）
    if (window.directionCalculateMapClickHandler) {
        map.off('click', window.directionCalculateMapClickHandler);
    }
    if (window.directionCalculateMouseMoveHandler) {
        map.off('mousemove', window.directionCalculateMouseMoveHandler);
    }
    
    // 移除之前的临时标记
    if (window.directionTempMarker) {
        map.removeLayer(window.directionTempMarker);
        window.directionTempMarker = null;
    }
    
    if (window.directionTempLine) {
        map.removeLayer(window.directionTempLine);
        window.directionTempLine = null;
    }
    
    if (window.centerMarker) {
        map.removeLayer(window.centerMarker);
        window.centerMarker = null;
    }
    
    if (window.previewLine) {
        map.removeLayer(window.previewLine);
        window.previewLine = null;
    }
    
    if (window.directionDisplay) {
        map.removeLayer(window.directionDisplay);
        window.directionDisplay = null;
    }
    
  
    
    // 添加中心点标记
    window.centerMarker = L.marker([centerLat, centerLng], {
        icon: L.icon({
            iconUrl: '../plugins/img/中文起点.svg',
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        })
    }).addTo(map);
    
    // 将角度转换为方向描述（以AB延长线为0度）
    function getDirectionDescription(angle) {
        // 处理负角度，转换为等效的正角度
        let normalizedAngle = angle;
        if (normalizedAngle < 0) {
            normalizedAngle += 360;
        }
        // 返回角度值，保留一位小数
        return normalizedAngle.toFixed(1) + '°';
    }
    
    // 鼠标移动事件处理函数 - 创建预览虚线和实时角度显示
    window.directionCalculateMouseMoveHandler = function(e) {
        const mouseLat = e.latlng.lat;
        const mouseLng = e.latlng.lng;
        
        // 计算实时方向角度
        const direction = calculateBearing(centerLat, centerLng, mouseLat, mouseLng, prevLat, prevLon);
        const directionDesc = getDirectionDescription(direction);
        
        // 移除旧的预览线
        if (window.previewLine) {
            map.removeLayer(window.previewLine);
        }
        
        // 创建预览虚线
        window.previewLine = L.polyline([
            [centerLat, centerLng],
            [mouseLat, mouseLng]
        ], {
            color: '#007bff',
            weight: 2,
            opacity: 0.6,
            dashArray: '10, 10'
        }).addTo(map);
        
        // 移除旧的角度显示
        if (window.directionDisplay) {
            map.removeLayer(window.directionDisplay);
        }
        
        // 计算路线中点位置
        const midLat = (centerLat + mouseLat) / 2;
        const midLng = (centerLng + mouseLng) / 2;
        
        // 创建实时角度显示标记（显示在路线中间）
        window.directionDisplay = L.marker([midLat, midLng], {
            icon: L.divIcon({
                className: 'direction-display',
                html: `<div style="background: rgba(0, 123, 255, 0.8); color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; white-space: nowrap;">${Math.round(direction)}° </div>`,
                iconSize: [80, 20],
                iconAnchor: [40, 10]
            })
        }).addTo(map);
    };
    
    // 地图点击事件处理函数
    window.directionCalculateMapClickHandler = function(e) {
        // 防止事件冒泡和多次触发
        if (window.isProcessingClick) {
            return;
        }
        window.isProcessingClick = true;
        
        const targetLat = e.latlng.lat;
        const targetLng = e.latlng.lng;
        
        // 移除预览线和角度显示
        if (window.previewLine) {
            map.removeLayer(window.previewLine);
            window.previewLine = null;
        }
        if (window.directionDisplay) {
            map.removeLayer(window.directionDisplay);
            window.directionDisplay = null;
        }
        
        // 计算方向角度
        const direction = calculateBearing(centerLat, centerLng, targetLat, targetLng, prevLat, prevLon);
        const directionDesc = getDirectionDescription(direction);
        
        // 更新方向输入框
        const directionInput = document.getElementById(`direction-${stationId}-${boxIndex}`);
        if (directionInput) {
            directionInput.value = Math.round(direction);
            // 触发输入验证
            if (window.handleDirectionInput) {
                window.handleDirectionInput(stationId, boxIndex);
            }
        }
        
        // 添加目标点标记
        if (window.directionTempMarker) {
            map.removeLayer(window.directionTempMarker);
        }
        window.directionTempMarker = L.marker([targetLat, targetLng], {
            icon: L.icon({
                iconUrl: '../plugins/img/中文终点.svg',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(map);
        
        // 绘制连接线
        if (window.directionTempLine) {
            map.removeLayer(window.directionTempLine);
        }
        window.directionTempLine = L.polyline([
            [centerLat, centerLng],
            [targetLat, targetLng]
        ], {
            color: '#28a745',
            weight: 3,
            opacity: 0.8
        }).addTo(map);
        
        // 显示计算结果
        cocoMessage.success(`方向计算完成: ${directionDesc}`);
        
        // 立即移除地图事件监听器，防止重复触发
        map.off('click', window.directionCalculateMapClickHandler);
        map.off('mousemove', window.directionCalculateMouseMoveHandler);
        window.directionCalculateMapClickHandler = null;
        window.directionCalculateMouseMoveHandler = null;
        
        // 仅在新增模式或修改模式下监听鼠标移动事件
        if (toggleStatus || editStatus) {
            map.on('mousemove', handleMouseMoveLine);
        }
        map.on('click', closeOnMapClick);
        map.on('click', hideInfoBoxesOnMapClick);
        
        // 恢复路线新增功能
        if (window.savedRouteAddMode) {
            window.isAddingToExistingRoute = window.savedRouteAddMode.isAddingToExistingRoute;
            toggleStatus = window.savedRouteAddMode.toggleStatus;
            window.savedRouteAddMode = null;
        }
        
        // 清理取消函数引用和事件监听器（但不清理临时元素，让setTimeout处理）
        if (window.directionCalculationCleanup) {
            // 只移除事件监听器，不移除临时元素
            document.removeEventListener('keydown', handleEscKey);
            window.directionCalculationCleanup = null;
        }
        
        // 延迟重置处理标志，防止快速连续点击
        setTimeout(() => {
            window.isProcessingClick = false;
        }, 300);
        
        // 3秒后移除连接线和标记点，保留属性框
        setTimeout(() => {
            if (window.directionTempLine) {
                map.removeLayer(window.directionTempLine);
                window.directionTempLine = null;
            }
            if (window.directionTempMarker) {
                map.removeLayer(window.directionTempMarker);
                window.directionTempMarker = null;
            }
            if (window.centerMarker) {
                map.removeLayer(window.centerMarker);
                window.centerMarker = null;
            }
        }, 2000);
    };
    
    // 添加地图事件监听器
    map.on('click', window.directionCalculateMapClickHandler);
    map.on('mousemove', window.directionCalculateMouseMoveHandler);
    
    // 添加ESC键取消功能
    const handleEscKey = function(e) {
        if (e.key === 'Escape') {
            cancelDirectionCalculation();
        }
    };
    document.addEventListener('keydown', handleEscKey);
    
    // 保存取消函数引用以便清理
    window.directionCalculationCleanup = function() {
        document.removeEventListener('keydown', handleEscKey);
        // 移除临时元素和事件监听器，但不恢复路线新增功能（因为已经在directionCalculateMapClickHandler中处理了）
        // 注意：不在这里移除临时元素，让setTimeout处理
        window.directionCalculationCleanup = null;
    };
};

// 取消方向计算的函数
function cancelDirectionCalculation() {
    // 移除地图事件监听器
    if (window.directionCalculateMapClickHandler) {
        map.off('click', window.directionCalculateMapClickHandler);
        window.directionCalculateMapClickHandler = null;
    }
    if (window.directionCalculateMouseMoveHandler) {
        map.off('mousemove', window.directionCalculateMouseMoveHandler);
        window.directionCalculateMouseMoveHandler = null;
    }
    
    // 移除临时元素
    if (window.directionTempMarker) {
        map.removeLayer(window.directionTempMarker);
        window.directionTempMarker = null;
    }
    if (window.directionTempLine) {
        map.removeLayer(window.directionTempLine);
        window.directionTempLine = null;
    }
    if (window.centerMarker) {
        map.removeLayer(window.centerMarker);
        window.centerMarker = null;
    }
    if (window.previewLine) {
        map.removeLayer(window.previewLine);
        window.previewLine = null;
    }
    if (window.directionDisplay) {
        map.removeLayer(window.directionDisplay);
        window.directionDisplay = null;
    }
    
    // 恢复路线新增功能
    if (window.savedRouteAddMode) {
        window.isAddingToExistingRoute = window.savedRouteAddMode.isAddingToExistingRoute;
        toggleStatus = window.savedRouteAddMode.toggleStatus;
        window.savedRouteAddMode = null;
  
    }
    
    // 清理取消函数引用
    window.directionCalculationCleanup = null;
}

// 计算两个经纬度点之间的方位角（东北天坐标系：正东为0度，正北为90度）
function calculateBearing(lat1, lon1, lat2, lon2, prevLat = null, prevLon = null) {
    // 将经纬度从度转换为弧度
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    
    // 计算方位角
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    
    // 计算角度并转换为度
    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    

    
    // 修正为东北天坐标系：正东为0度，正北为90度
    // 原始Math.atan2: 正东=0°, 正北=90°, 正西=180°/-180°, 正南=-90°
    // 我们需要: 正东=0°, 正南=90°, 正西=180°/-180°, 正北=-90°
    bearing = 90 - bearing;
    
    // 将角度标准化到-180到180度范围
    if (bearing > 180) {
        bearing = bearing - 360;
    } else if (bearing < -180) {
        bearing = bearing + 360;
    }
    return bearing;
}


//封装的函数：为select元素添加点击已选中项触发事件的功能

    function addSelectClickHandler(selectElement, callback) {
            // 参数验证
            if (!selectElement || typeof callback !== 'function') {
                console.error('addSelectClickHandler: 必须提供select元素和回调函数');
                return;
            }
            
            let isDropdownOpen = false;
            
            // 监听select点击事件，判断下拉框是否打开
            selectElement.addEventListener('click', function() {
                isDropdownOpen = !isDropdownOpen;
                
                // 如果下拉框关闭（即点击选项后），则触发处理函数
                if (!isDropdownOpen) {
                    const value = selectElement.value;
                    const text = selectElement.options[selectElement.selectedIndex].text;
                    callback(value, text);
                }
            });
            
            // 监听点击页面其他地方，关闭下拉框
            document.addEventListener('click', function(e) {
                if (e.target !== selectElement && isDropdownOpen) {
                    isDropdownOpen = false;
                }
            });
            
            // 监听键盘事件，支持使用键盘选择选项
            selectElement.addEventListener('keyup', function(e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    const value = selectElement.value;
                    const text = selectElement.options[selectElement.selectedIndex].text;
                    callback(value, text);
                }
            });
            
            // 返回一个对象，包含一些有用的方法
            return {
                // 获取当前选中的值
                getValue: function() {
                    return selectElement.value;
                },
                // 获取当前选中的文本
                getText: function() {
                    return selectElement.options[selectElement.selectedIndex].text;
                },
                // 手动触发回调
                trigger: function() {
                    const value = selectElement.value;
                    const text = selectElement.options[selectElement.selectedIndex].text;
                    callback(value, text);
                },
                // 销毁事件监听
                destroy: function() {
                    // 这里可以添加销毁事件监听的代码
                    // 由于我们使用了匿名函数，实际销毁会比较复杂
                    // 在实际应用中，可能需要使用命名函数或保存事件监听器的引用
                }
            };
        }

        document.addEventListener('DOMContentLoaded', function() {
            const select = document.getElementById('routeSelect');
            // 定义回调函数
            function handleOptionSelect(value, text) {
                const time = new Date().toLocaleTimeString();
                const logText = `[${time}] 选中选项：值=${value}，文本=${text}`;

                // 这里可以添加您的业务逻辑，例如加载地图等
                // loadMap(value);
            }
            // 使用封装的函数
            const selectHandler = addSelectClickHandler(select, handleOptionSelect);
            // 初始化时显示当前选中项
            // selectHandler.trigger();
        });

window.onload = onLoad;
