import axiosClient from "../../../api/ApiManager.js";
let carCurrentX;
let carCurrentY;
let latitudeCurrent;
let longitudeCurrent;
let visibilityConfig = null; // 存储可见性配置

// 加载参数可见性配置
async function loadVisibilityConfig() {
    try {
        const response = await fetch("../../../src/config/robot_data_visibility.json");
        visibilityConfig = await response.json();
        console.log("参数可见性配置加载成功:", visibilityConfig);
    } catch (error) {
        console.error("加载参数可见性配置失败:", error);
    }
}

// 根据配置控制参数显示/隐藏
function applyParameterVisibility() {
    if (!visibilityConfig || !visibilityConfig.parameters) {
        console.warn("参数可见性配置不可用");
        return;
    }

    console.log("应用参数可见性配置...");

    // 遍历所有参数组
    Object.keys(visibilityConfig.parameters).forEach(groupKey => {
        const group = visibilityConfig.parameters[groupKey];
        
        // 遍历组内所有参数
        Object.keys(group).forEach(paramKey => {
            const param = group[paramKey];
            const paramId = param.id;
            const isVisible = param.visible;
            
            // 获取参数的输入元素
            const paramElement = document.getElementById(paramId);
            if (paramElement) {
                console.log(`处理参数: ${paramId}, 可见性: ${isVisible}`);
                
                // 尝试多种方式找到包含标签和输入框的容器
                let container = null;
                
                // 方法1: 查找最近的.col-md-4容器
                container = paramElement.closest('.col-md-4');
                
                // 方法2: 如果没找到，查找父级div
                if (!container) {
                    container = paramElement.parentElement;
                }
                
                // 方法3: 如果还没找到，查找包含label的父容器
                if (!container) {
                    const label = document.querySelector(`label[for="${paramId}"]`);
                    if (label) {
                        container = label.closest('.col-md-4');
                    }
                }
                
                // 方法4: 最后尝试查找任何包含该元素的父级容器
                if (!container) {
                    let parent = paramElement.parentElement;
                    while (parent && parent !== document.body) {
                        if (parent.classList.contains('col-md-4') || 
                            parent.classList.contains('param-container') ||
                            parent.classList.contains('form-group')) {
                            container = parent;
                            break;
                        }
                        parent = parent.parentElement;
                    }
                }
                
                if (container) {
                    container.style.display = isVisible ? 'block' : 'none';
                    console.log(`参数 ${paramId} 容器已${isVisible ? '显示' : '隐藏'}`);
                } else {
                    console.warn(`无法找到参数 ${paramId} 的容器`);
                }
            } else {
                console.warn(`无法找到参数元素: ${paramId}`);
            }
        });
    });
    
    console.log("参数可见性配置应用完成");
}

$(document).ready(function () {
    // 先加载配置文件，再获取机器人数据
    loadVisibilityConfig().then(() => {
        getRobotData();
        // 应用参数可见性设置
        applyParameterVisibility();
    });
});
     // 获取元素
  const switchEl = document.getElementById('closetrackSwitch');
  const valueEl = document.getElementById('closetrack');
  const statusEl = document.getElementById('switchStatus');
  
  // 开关状态变化时触发
  switchEl.addEventListener('change', function() {
    if (this.checked) {
      // 开启状态（存储值为1）
      valueEl.value = "1";
      statusEl.textContent = "当前：开启";
      statusEl.classList.remove('text-muted');
      statusEl.classList.add('text-primary');
    } else {
      // 关闭状态（存储值为0）
      valueEl.value = "0";
      statusEl.textContent = "当前：关闭";
      statusEl.classList.remove('text-primary');
      statusEl.classList.add('text-muted');
    }
  });
async function getRobotData() {
    try {
        const res = await axiosClient.get("param/queryalldata");
        console.log(res.data.data[0]);
        let getRobotDataMessage = res.data.data[0]
        let vehicle_mode = getRobotDataMessage.vehicle_mode;
        let navigation_mode = getRobotDataMessage.navigation_mode;
        let longitude_0 = getRobotDataMessage.local_origin_longitude;
        let latitude_0 = getRobotDataMessage.local_origin_latitude;
        let samplInte = getRobotDataMessage.samplInte;
        let speed_run = getRobotDataMessage.speed_run;
        let speed_max = getRobotDataMessage.speed_max;
        let speed_min = getRobotDataMessage.speed_min;
        let speed_down = getRobotDataMessage.speed_down;
        let stop_set = getRobotDataMessage.stop_set;
        let remote_mode = getRobotDataMessage.remote_mode;
        let forwordDis = getRobotDataMessage.forwordDis;
        let upward = getRobotDataMessage.upward;
        let reduced = getRobotDataMessage.reduced;
        let scandis_max = getRobotDataMessage.scandis_max;
        let scandis_min = getRobotDataMessage.scandis_min;
        let lidarinstallpara_x = getRobotDataMessage.lidarinstallpara_x;
        let lidarinstallpara_y = getRobotDataMessage.lidarinstallpara_y;
        let lidarinstallpara_z = getRobotDataMessage.lidarinstallpara_z;
        let lidarinstallpara_yaw = getRobotDataMessage.lidarinstallpara_yaw;
        let lidarinstallpara_pitch = getRobotDataMessage.lidarinstallpara_pitch;
        let lidarinstallpara_roll = getRobotDataMessage.lidarinstallpara_roll;
        let lpropeller = getRobotDataMessage.lpropellerl
        let rpropeller = getRobotDataMessage.rpropellerl
        let rotation=getRobotDataMessage.rotation;   
        let dirpropeller=getRobotDataMessage.dirpropeller; 
        let closetrack=getRobotDataMessage.closetrack; 
        let iimtw=getRobotDataMessage.iimtw; 
        let initpropeller=getRobotDataMessage.initpropeller; 
        let vvwk = getRobotDataMessage.vvwk; 
        let runmode = getRobotDataMessage.runmode; 
        let wheelBase = getRobotDataMessage.wheelBase;
        document.getElementById('wheelBase').value = wheelBase;

        document.getElementById('model').value = vehicle_mode
        document.getElementById('navigationMode').value = navigation_mode
        document.getElementById('longitude').value = longitude_0
        document.getElementById('latitude').value = latitude_0
        document.getElementById('getRobotMsgmsg').value = samplInte
        document.getElementById('carRunSpeed').value = speed_run
        document.getElementById('maxSpeed').value = speed_max
        document.getElementById('minSpeed').value = speed_min
        document.getElementById('deceleration').value = speed_down
        document.getElementById('parkingCompensation').value = stop_set
        document.getElementById('remoteAutoSwitch').value = remote_mode
        document.getElementById('lookaheadDistance').value = forwordDis
        document.getElementById('forkliftRaisedWheelbase').value = upward
        document.getElementById('forkliftLoweredWheelbase').value = reduced
        document.getElementById('lidarScanDistance').value = scandis_max
        document.getElementById('safetyParameters').value = scandis_min
        document.getElementById('lidar-x').value = lidarinstallpara_x
        document.getElementById('lidar-y').value = lidarinstallpara_y
        document.getElementById('lidar-z').value = lidarinstallpara_z
        document.getElementById('lidar-yaw').value = lidarinstallpara_yaw
        document.getElementById('lidar-pitch').value = lidarinstallpara_pitch
        document.getElementById('lidar-roll').value = lidarinstallpara_roll
        document.getElementById('leftPropulsion').value = lpropeller
        document.getElementById('rightPropulsion').value = rpropeller
        document.getElementById('rotation').value = rotation
        document.getElementById('dirpropeller').value = dirpropeller
        document.getElementById('closetrack').value = closetrack
        document.getElementById('iimtw').value = iimtw
        document.getElementById('initpropeller').value = initpropeller
        document.getElementById('vvwk').value = vvwk
        document.getElementById('runmode').value = runmode 
        let flag = res.data.code;
        if (!flag) {
            if(closetrack==1){
                switchEl.checked = true
                statusEl.textContent = "当前：开启";
                statusEl.classList.remove('text-muted');
                statusEl.classList.add('text-primary');
            }else{
            // 关闭状态（存储值为0）
                switchEl.checked = false
                valueEl.value = "0";
                statusEl.textContent = "当前：关闭";
                statusEl.classList.remove('text-primary');
                statusEl.classList.add('text-muted');
            }
            cocoMessage.success("获取成功");
        } else {
            cocoMessage.error("删除失败");
        }
    } catch (error) {
        console.log("catch", error);
    }
}

function limitData(id, bottomId) {
    document.getElementById(id).addEventListener('input', function (event) {
        const value = event.target.value;
        if (value !== '0' && value !== '1') {
            event.target.value = '';
            document.getElementById(bottomId).innerText = '请输入0或1';
        } else {
            document.getElementById(bottomId).innerText = '';
        }
    });
}

limitData('remoteAutoSwitch', 'remoteAutoSwitchError');
limitData('lidarScanDistance', 'lidarScanSwitchError');

function limitInput(id) {
    document.getElementById(id).addEventListener('input', function (event) {
        const value = parseFloat(event.target.value);
        if (isNaN(value || value > 100 || value < -100)) {
            event.target.value = ''; // 清空输入框
            document.getElementById('webRemoteDataError').innerText = '请输入-100至+100的数值';
        } else {
            document.getElementById('webRemoteDataError').innerText = '';
        }
    });
}

['x1', 'y1', 'x2', 'y2'].forEach(limitInput);
document.getElementById("saveData").addEventListener("click", updateRobotData);
function collectFormData() {
    return {
        vehicle_mode: document.getElementById('model').value || "0",
        navigation_mode: document.getElementById('navigationMode').value || "0",
        local_origin_longitude: document.getElementById('longitude').value || "0",
        local_origin_latitude: document.getElementById('latitude').value || "0",
        samplInte: document.getElementById('getRobotMsgmsg').value || "0",
        speed_run: document.getElementById('carRunSpeed').value || "0",
        speed_max: document.getElementById('maxSpeed').value || "0",
        speed_min: document.getElementById('minSpeed').value || "0",
        speed_down: document.getElementById('deceleration').value || "0",
        stop_set: document.getElementById('parkingCompensation').value || "0",
        remote_mode: document.getElementById('remoteAutoSwitch').value || "0",
        forwordDis: document.getElementById('lookaheadDistance').value || "0",
        upward: document.getElementById('forkliftRaisedWheelbase').value || "0",
        reduced: document.getElementById('forkliftLoweredWheelbase').value || "0",
        scandis_max: document.getElementById('lidarScanDistance').value || "0",
        scandis_min: document.getElementById('safetyParameters').value || "0",
        lidarinstallpara_x: document.getElementById('lidar-x').value || "0",
        lidarinstallpara_y: document.getElementById('lidar-y').value || "0",
        lidarinstallpara_z: document.getElementById('lidar-z').value || "0",
        lidarinstallpara_yaw: document.getElementById('lidar-yaw').value || "0",
        lidarinstallpara_pitch: document.getElementById('lidar-pitch').value || "0",
        lidarinstallpara_roll: document.getElementById('lidar-roll').value || "0",
        lidarinstallpara_roll: document.getElementById('initpropeller').value || "0",
        runmode : document.getElementById('runmode').value || "0",
        vvwk: document.getElementById('vvwk').value || "0.006",
       
    };
}

async function updateRobotData() {
    const paramRequest = {
        id: 1,
        vehicle_mode: String(document.getElementById('model').value) || "0",
        navigation_mode: String(document.getElementById('navigationMode').value) || "0",
        local_origin_longitude: String(document.getElementById('longitude').value) || "0",
        local_origin_latitude: String(document.getElementById('latitude').value) || "0",
        samplInte: String(document.getElementById('getRobotMsgmsg').value) || "0",
        speed_run: String(document.getElementById('carRunSpeed').value) || "0",
        speed_max: String(document.getElementById('maxSpeed').value) || "0",
        speed_min: String(document.getElementById('minSpeed').value) || "0", // 确保这个元素存在
        speed_down: String(document.getElementById('deceleration').value) || "0",
        stop_set: String(document.getElementById('parkingCompensation').value) || "0",
        remote_mode: String(document.getElementById('remoteAutoSwitch').value) || "0",
        forwordDis: String(document.getElementById('lookaheadDistance').value) || "0.5",
        upward: String(document.getElementById('forkliftRaisedWheelbase').value) || "0",
        reduced: String(document.getElementById('forkliftLoweredWheelbase').value) || "0",
        scandis_max: String(document.getElementById('lidarScanDistance').value) || "0",
        scandis_min: String(document.getElementById('safetyParameters').value) || "0",
        lidarinstallpara_x: String(document.getElementById('lidar-x').value) || "0",
        lidarinstallpara_y: String(document.getElementById('lidar-y').value) || "0",
        lidarinstallpara_z: String(document.getElementById('lidar-z').value) || "0",
        lidarinstallpara_yaw: String(document.getElementById('lidar-yaw').value) || "0",
        lidarinstallpara_pitch: String(document.getElementById('lidar-pitch').value) || "0",
        lidarinstallpara_roll: String(document.getElementById('lidar-roll').value) || "0",
        lpropeller: String(document.getElementById('leftPropulsion').value) || "0",
        rpropeller: String(document.getElementById('rightPropulsion').value) || "0",
        rotation:String(document.getElementById('rotation').value) || "20",
        dirpropeller:String(document.getElementById('dirpropeller').value) || "1",
        closetrack:String(document.getElementById('closetrack').value) ,
        iimtw:String(document.getElementById('iimtw').value) || "1",
        initpropeller:String(document.getElementById('initpropeller').value) || "1",
        runmode:String(document.getElementById('runmode').value) || "1",
        vvwk:String(document.getElementById('vvwk').value) || "1",
        wheelBase:String(document.getElementById('wheelBase').value) || "0.5",
        vehicle_width:"2"
    };
    try {
        const res = await axiosClient.post("param/update", paramRequest);
        let flag = res.data.code;
        if (!flag) {
            cocoMessage.success("更新成功");
         
        } else {
            cocoMessage.error("更新失败");
        }
    } catch (error) {
        console.error("Error updating data:", error); // 打印完整的错误信息
    }
}

let longitudePosi = document.getElementById("longitude")
let latitudePosi = document.getElementById("latitude")
document.getElementById("getMapLoading").addEventListener("click", getMapLocation)
function getMapLocation() {
    // 从positionData JSON对象中获取经纬度
    const positionDataStr = localStorage.getItem('positionData');
    let latitudeCurrent, longitudeCurrent;
    
    if (positionDataStr) {
        try {
            const positionData = JSON.parse(positionDataStr);
            latitudeCurrent = positionData.latitudeCurrent;
            longitudeCurrent = positionData.longitudeCurrent;
        } catch (e) {
            console.error("解析positionData失败:", e);
            latitudeCurrent = null;
            longitudeCurrent = null;
        }
    } else {
        latitudeCurrent = null;
        longitudeCurrent = null;
    }
    
    if (longitudeCurrent && latitudeCurrent) {
        longitudePosi.value = longitudeCurrent
        latitudePosi.value = latitudeCurrent
    } else {
        cocoMessage.error("机器未开机");
    }
}