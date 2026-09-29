import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PCDLoader } from 'three/addons/loaders/PCDLoader.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import axiosClient from "../../../api/ApiManager.js";


const scene = new THREE.Scene();

// 添加坐标轴辅助工具，红色为X轴，绿色为Y轴，蓝色为Z轴
let axesHelper = new THREE.AxesHelper(10); // 初始设置为10，加载点云后会根据点云大小调整
axesHelper.renderOrder = 999; // 设置高渲染优先级，确保在最上层
// axesHelper.position.set(0, 0, 0); // 注释掉：坐标系位置将跟随点云移动，不固定为原点
// 注意：不在初始化时设置旋转角度，避免坐标轴瞬间旋转90度
// 旋转角度将在动画循环中统一处理
scene.add(axesHelper);

// 添加Z轴旋转方向指示器
const rotationIndicatorGeometry = new THREE.RingGeometry(4, 4.2, 32);
const rotationIndicatorMaterial = new THREE.MeshBasicMaterial({ 
    color: 0xffff00, 
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.7
});
const rotationIndicator = new THREE.Mesh(rotationIndicatorGeometry, rotationIndicatorMaterial);
rotationIndicator.rotation.x = Math.PI / 2; // 使圆环平行于XY平面
rotationIndicator.position.set(0, 0, 0); // 确保旋转指示器位于原始坐标系原点
scene.add(rotationIndicator);

// 添加旋转方向箭头
const arrowDirection = new THREE.Vector3(1, 0, 0);
const arrowOrigin = new THREE.Vector3(4.1, 0, 0);
const arrowHelper = new THREE.ArrowHelper(arrowDirection, arrowOrigin, 0.5, 0xffff00, 0.3, 0.2);
arrowHelper.rotation.z = Math.PI / 2; // 使箭头指向逆时针方向
arrowHelper.position.set(0, 0, 0); // 确保箭头指示器位于原始坐标系原点
scene.add(arrowHelper);

const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.01, 10000000);
camera.position.set(0, 0, 10);

const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);


const title2 = document.createElement('h5');
// title2.innerHTML = '点击右上角按钮选择文件<br>(看不见点云的话记得改改颜色或者缩放)<br>使用W/S键控制上下平移，A/D键控制左右平移<br>使用方向键控制前后移动和视角旋转<br>使用GUI中的Z轴旋转控制验证顺时针/逆时针旋转';
title2.style.position = 'absolute';
title2.style.top = '4%';
title2.style.left = '41%';
title2.style.color = 'white';
title2.style.textAlign = 'center';
document.body.appendChild(title2);


const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; // 启用阻尼（惯性）
controls.dampingFactor = 0.05; // 阻尼系数
controls.screenSpacePanning = false; // 禁用屏幕空间平移
controls.minDistance = 1; // 最小距离
controls.maxDistance = 10000000; // 最大距离
controls.maxPolarAngle = Math.PI; // 最大极角

const isRotation = { bool: false };

// 添加2D/3D视图切换变量
const viewMode = { is2D: false };

// 添加Z轴旋转控制变量
const zRotation = { angle: 0, speed: 0.01, isRotating: false, direction: 1 }; // direction: 1为逆时针，-1为顺时针

// 添加Z轴范围控制变量
const zRange = { min: -10, max: 10 };

// 机器位置相关变量
const machinePosition = { x: 0, y: 0, z: 0 };
let machineArrowHelper = null;
let machineMovementInterval = null;
let useRealPosition = true; // 是否使用真实位置数据

// 添加箭头绘制模式变量
const arrowDrawingMode = { 
    isActive: false, 
    isDrawing: false, 
    startPoint: null, 
    endPoint: null,
    arrowHelper: null,
    // 方向选择：x或y方向
    direction: 'x', // 默认x方向
    // 注意：坐标系原点始终保持在PCD文件的原始坐标系原点(0,0,0)
    // 箭头绘制仅用于确定切割方向和位置，不再改变坐标系原点
    newOrigin: { x: 0, y: 0, z: 0 },
    newYAxis: { x: 0, y: 1, z: 0 },
    isCompleted: false // 添加标记，表示箭头是否已经完成绘制
};

// 获取HTML中的输入框
const zMinInput = document.getElementById('z-min');
const zMaxInput = document.getElementById('z-max');

// 获取箭头按钮
const zMinDecreaseBtn = document.getElementById('z-min-decrease');
const zMinIncreaseBtn = document.getElementById('z-min-increase');
const zMaxDecreaseBtn = document.getElementById('z-max-decrease');
const zMaxIncreaseBtn = document.getElementById('z-max-increase');

// 添加输入框事件监听器
zMinInput.addEventListener('input', function() {
    zRange.min = parseFloat(this.value);
    updateZRange();
});

zMaxInput.addEventListener('input', function() {
    zRange.max = parseFloat(this.value);
    updateZRange();
});

// 添加箭头按钮事件监听器
zMinDecreaseBtn.addEventListener('click', function() {
    zRange.min -= 0.1;
    updateZRange();
    updateZRangeInputs();
});

zMinIncreaseBtn.addEventListener('click', function() {
    zRange.min += 0.1;
    updateZRange();
    updateZRangeInputs();
});

zMaxDecreaseBtn.addEventListener('click', function() {
    zRange.max -= 0.1;
    updateZRange();
    updateZRangeInputs();
});

zMaxIncreaseBtn.addEventListener('click', function() {
    zRange.max += 0.1;
    updateZRange();
    updateZRangeInputs();
});

// 更新HTML输入框的值
function updateZRangeInputs() {
    zMinInput.value = zRange.min;
    zMaxInput.value = zRange.max;
}

// 创建机器位置箭头
function createMachineArrow() {
    if (machineArrowHelper) {
        scene.remove(machineArrowHelper);
    }
    
    // 从localStorage获取真实的车辆位置数据作为初始位置
    const positionDataStr = localStorage.getItem('positionData');
    if (positionDataStr) {
        try {
            const positionData = JSON.parse(positionDataStr);
            machinePosition.x = positionData.localX || 0;
            machinePosition.y = positionData.localY || 0;
            machinePosition.z = 0; // 地面车辆通常Z坐标为0
        } catch (error) {
            console.error('解析初始位置数据失败:', error);
        }
    }
    
    // 根据航向角确定箭头方向
    let direction = new THREE.Vector3(0, 1, 0); // 默认指向Y轴正方向
    if (positionDataStr) {
        try {
            const positionData = JSON.parse(positionDataStr);
            if (positionData.Heading !== undefined) {
                const headingRad = (parseFloat(positionData.Heading) || 0) * Math.PI / 180;
                direction.set(Math.cos(headingRad), Math.sin(headingRad), 0);
            }
        } catch (error) {
            console.error('解析初始朝向数据失败:', error);
        }
    }
    
    const origin = new THREE.Vector3(machinePosition.x, machinePosition.y, machinePosition.z);
    const length = 0.5; // 箭头长度
    const color = 0xff0000; // 红色箭头
    
    machineArrowHelper = new THREE.ArrowHelper(direction, origin, length, color, 0.3, 0.2);
    scene.add(machineArrowHelper);
}

// 更新机器位置（始终使用真实位置）
function updateMachinePosition() {
    // 从localStorage获取真实的车辆位置数据
    const positionDataStr = localStorage.getItem('positionData');
    if (!positionDataStr) {
        console.warn('未获取到车辆位置数据');
        return; // 没有数据时不更新位置
    }
    
    try {
        const positionData = JSON.parse(positionDataStr);
        // 使用真实的车辆位置数据（localX, localY）
        machinePosition.x = positionData.localX || 0;
        machinePosition.y = positionData.localY || 0;
        machinePosition.z = 0; // 地面车辆通常Z坐标为0或可以根据需要调整
        
        // 如果有朝向数据，更新箭头方向
        if (positionData.Heading !== undefined) {
            const headingRad = (parseFloat(positionData.Heading) || 0) * Math.PI / 180; // 转换为弧度
            if (machineArrowHelper) {
                // 根据航向角调整箭头方向，并应用与点云相同的Z轴旋转
                const direction = new THREE.Vector3(Math.cos(headingRad), Math.sin(headingRad), 0);
                
                // 创建旋转矩阵，应用与点云相同的Z轴旋转
                const rotationMatrix = new THREE.Matrix4().makeRotationZ(zRotation.angle);
                direction.applyMatrix4(rotationMatrix);
                
                machineArrowHelper.setDirection(direction);
            }
        }
    } catch (error) {
        console.error('解析位置数据失败:', error);
        return; // 解析失败时不更新位置
    }
    
    // 更新箭头位置（基于移动后的坐标系相对位置，并考虑旋转）
    if (machineArrowHelper) {
        // 创建旋转矩阵，应用与点云相同的Z轴旋转
        const rotationMatrix = new THREE.Matrix4().makeRotationZ(zRotation.angle);
        
        // 将机器位置向量应用旋转
        const rotatedPosition = new THREE.Vector3(machinePosition.x, machinePosition.y, machinePosition.z);
        rotatedPosition.applyMatrix4(rotationMatrix);
        
        // 将旋转后的相对位置转换为世界坐标（相对坐标 + 坐标系原点位置）
        const worldPosition = new THREE.Vector3(
            rotatedPosition.x + axesHelper.position.x,
            rotatedPosition.y + axesHelper.position.y,
            rotatedPosition.z + axesHelper.position.z
        );
        machineArrowHelper.position.copy(worldPosition);
    }
}

// 开始机器位置更新（始终使用真实位置）
function startMachineMovement() {
    if (machineMovementInterval) {
        clearInterval(machineMovementInterval);
    }
    
    // 立即设置初始位置
    updateMachinePosition();
    
    // 真实位置模式每秒更新
    machineMovementInterval = setInterval(updateMachinePosition, 1000);
}

// 停止机器移动
function stopMachineMovement() {
    if (machineMovementInterval) {
        clearInterval(machineMovementInterval);
        machineMovementInterval = null;
    }
}

var gui = new GUI();
// gui.add(isRotation, 'bool').name('旋转');
gui.add(viewMode, 'is2D').name('2D/3D视图').onChange(toggleViewMode);
// 添加切割方向设置
const cuttingDirectionFolder = gui.addFolder('切割方向设置');
cuttingDirectionFolder.add(arrowDrawingMode, 'isActive').name('启用切割方向').onChange(toggleArrowDrawingMode);
cuttingDirectionFolder.add(arrowDrawingMode, 'direction', { 'X方向': 'x', 'Y方向': 'y' }).name('切割方向选择');

// 添加Z轴旋转控制文件夹
var zRotationFolder = gui.addFolder('Z轴旋转控制');
zRotationFolder.add(zRotation, 'isRotating').name('开始/停止旋转');
zRotationFolder.add(zRotation, 'direction', { '逆时针': 1, '顺时针': -1 }).name('旋转方向');
zRotationFolder.add(zRotation, 'speed', 0.001, 0.1).name('旋转速度');

// 机器位置控制 - 始终使用真实位置
useRealPosition = true; // 强制使用真实位置

var attributesFolder = gui.addFolder('点云设置');
// 移除GUI中的Z轴范围控制，因为已经有可视化的输入框和箭头按钮
gui.domElement.style.left = '0px';
gui.domElement.style.top = '130px';
function resetGUI() {
    // 删除之前的GUI
    gui.destroy();
    // 创建一个新的GUI实例
    gui = new GUI();
    // gui.add(isRotation, 'bool').name('旋转');
    gui.add(viewMode, 'is2D').name('2D/3D视图').onChange(toggleViewMode);
    
    // 添加切割方向设置
    const cuttingDirectionFolder = gui.addFolder('切割方向设置');
    cuttingDirectionFolder.add(arrowDrawingMode, 'isActive').name('启用切割方向').onChange(toggleArrowDrawingMode);
    cuttingDirectionFolder.add(arrowDrawingMode, 'direction', { 'X方向': 'x', 'Y方向': 'y' }).name('切割方向选择');
    
    // 添加Z轴旋转控制文件夹
    zRotationFolder = gui.addFolder('Z轴旋转控制');
    zRotationFolder.add(zRotation, 'isRotating').name('开始/停止旋转');
    zRotationFolder.add(zRotation, 'direction', { '逆时针': 1, '顺时针': -1 }).name('旋转方向');
    zRotationFolder.add(zRotation, 'speed', 0.001, 0.1).name('旋转速度');
    
    // 机器位置控制 - 始终使用真实位置
    useRealPosition = true; // 强制使用真实位置
    
    attributesFolder = gui.addFolder('点云设置');
    // 移除GUI中的Z轴范围控制，因为已经有可视化的输入框和箭头按钮
    gui.domElement.style.left = '0px';
    gui.domElement.style.top = '130px';
}

// 实现2D/3D视图切换函数
function toggleViewMode() {
    // 遍历场景中的所有点云
    scene.children.forEach(child => {
        if (child instanceof THREE.Points) {
            const geometry = child.geometry;
            const positions = geometry.attributes.position;
            const originalPositions = geometry.userData.originalPositions || positions.array.slice();
            
            // 如果还没有保存原始位置数据，则保存
            if (!geometry.userData.originalPositions) {
                geometry.userData.originalPositions = originalPositions;
            }

            // 创建新的位置数组
            const newPositions = new Float32Array(originalPositions.length);
            let visibleCount = 0;

            // 遍历所有点，根据视图模式调整Z坐标
            for (let i = 0; i < positions.count; i++) {
                const idx = i * 3;
                const z = originalPositions[idx + 2]; // Z坐标
                
                // 检查Z坐标是否在范围内
                const inRange = z >= zRange.min && z <= zRange.max;
                
                if (inRange) {
                    // 保留X和Y坐标不变
                    newPositions[idx] = originalPositions[idx];     // X
                    newPositions[idx + 1] = originalPositions[idx + 1]; // Y
                    
                    // 根据视图模式调整Z坐标
                    if (viewMode.is2D) {
                        // 2D模式：将Z坐标映射到0平面，但保留原始Z值用于颜色或其他处理
                        newPositions[idx + 2] = 0; // 将所有点压缩到Z=0平面
                    } else {
                        // 3D模式：恢复原始Z坐标
                        newPositions[idx + 2] = originalPositions[idx + 2]; // Z
                    }
                    visibleCount++;
                } else {
                    // 如果不在范围内，将该点移动到不可见的位置
                    newPositions[idx] = 0;
                    newPositions[idx + 1] = 0;
                    newPositions[idx + 2] = -99999; // 移动到很远的位置
                }
            }

            // 更新几何体的位置属性
            positions.array = newPositions;
            positions.needsUpdate = true;
            
            // 更新点云的可见点数
            geometry.setDrawRange(0, visibleCount);
        }
    });
}

// 实现箭头绘制模式切换函数
function toggleArrowDrawingMode() {
    // 注意：这个函数是由GUI控制器调用的，所以arrowDrawingMode.isActive的值已经被GUI更新了
    // 我们需要根据新的值来执行相应的操作
    
    // 如果箭头已经完成绘制，但用户再次点击复选框，则重置状态并允许再次绘制
    if (arrowDrawingMode.isCompleted && arrowDrawingMode.isActive) {
        console.log("重新启用箭头绘制模式");
        // 重置箭头绘制状态
        arrowDrawingMode.isCompleted = false;
        arrowDrawingMode.isDrawing = false;
        arrowDrawingMode.startPoint = null;
        arrowDrawingMode.endPoint = null;
        
        // 启用箭头绘制模式复选框
        gui.controllersRecursive().forEach(controller => {
            if (controller.property === 'isActive' && controller.name === '切割方向设置') {
                controller.enable();
                console.log("已启用切割方向设置复选框");
            }
        });
    }
    
    if (arrowDrawingMode.isActive) {
        // 启用箭头绘制模式
        viewMode.is2D = true; // 自动切换到2D视图
        toggleViewMode(); // 应用2D视图
        // 更新GUI显示
        gui.controllersRecursive().forEach(controller => {
            if (controller.property === 'is2D') {
                controller.updateDisplay();
            }
        });
        
        // 禁用OrbitControls，以便进行鼠标交互
        controls.enabled = false;
        // 更新鼠标样式
        renderer.domElement.style.cursor = 'crosshair';
        
        // 显示初始的箭头辅助对象
        if (arrowHelper) {
            arrowHelper.visible = true;
            console.log("已显示初始的箭头辅助对象");
        }
      
    } else {
        // 禁用箭头绘制模式
        
        // 如果正在绘制，则取消绘制
        if (arrowDrawingMode.isDrawing) {
            cancelArrowDrawing();
        }
        // 如果箭头已经完成绘制，则打印箭头的位置和姿态
        if (arrowDrawingMode.isCompleted && arrowDrawingMode.newOrigin && arrowDrawingMode.newYAxis) {
            // 计算方向向量
            const directionX = arrowDrawingMode.newYAxis.x;
            const directionY = arrowDrawingMode.newYAxis.y;
            const directionZ = 0;
            
            // 计算方向向量的长度
            const length = Math.sqrt(directionX * directionX + directionY * directionY + directionZ * directionZ);
            
            // 归一化方向向量
            const normalizedX = directionX / length;
            const normalizedY = directionY / length;
            const normalizedZ = directionZ / length;
            
            // 计算旋转角度（弧度）
            const angle = Math.atan2(normalizedY, normalizedX);
            
            // 计算四元数（绕Z轴旋转）
            const halfAngle = angle / 2;
            const w = Math.cos(halfAngle);
            const x = 0;
            const y = 0;
            const z = Math.sin(halfAngle);
            
            // 注意：arrowData的打印逻辑已移至onMouseUp函数中
            // 当箭头绘制完成时会立即打印，不再需要在这里打印
        }
        
        // 隐藏初始的箭头辅助对象
        if (arrowHelper) {
            arrowHelper.visible = false;
            console.log("已隐藏初始的箭头辅助对象");
        }
        
        // 启用OrbitControls
        controls.enabled = true;
        
        // 恢复鼠标样式
        renderer.domElement.style.cursor = 'default';
        
        console.log("箭头绘制模式已禁用，恢复到拖动改变视角模式");
    }
}

// 取消箭头绘制
function cancelArrowDrawing() {
    // 重置绘制状态
    arrowDrawingMode.isDrawing = false;
    arrowDrawingMode.startPoint = null;
    arrowDrawingMode.endPoint = null;
    
    // 移除箭头辅助对象
    if (arrowDrawingMode.arrowHelper) {
        scene.remove(arrowDrawingMode.arrowHelper);
        arrowDrawingMode.arrowHelper = null;
        console.log("已移除箭头辅助对象");
    }
    
    // 隐藏初始的箭头辅助对象
    if (arrowHelper) {
        arrowHelper.visible = false;
        console.log("已隐藏初始的箭头辅助对象");
    }
    
    console.log("已取消箭头绘制");
}

// 实现Z轴范围过滤函数
function updateZRange() {
    // 确保最小值不大于最大值
    if (zRange.min > zRange.max) {
        const temp = zRange.min;
        zRange.min = zRange.max;
        zRange.max = temp;
    }

    // 更新HTML输入框的值
    updateZRangeInputs();

    // 遍历场景中的所有点云
    scene.children.forEach(child => {
        if (child instanceof THREE.Points) {
            const geometry = child.geometry;
            const positions = geometry.attributes.position;
            const originalPositions = geometry.userData.originalPositions || positions.array.slice();
            
            // 如果还没有保存原始位置数据，则保存
            if (!geometry.userData.originalPositions) {
                geometry.userData.originalPositions = originalPositions;
            }

            // 创建新的位置数组
            const newPositions = new Float32Array(originalPositions.length);
            let visibleCount = 0;

            // 遍历所有点，根据Z轴范围过滤
            for (let i = 0; i < positions.count; i++) {
                const idx = i * 3;
                const z = originalPositions[idx + 2]; // Z坐标

                // 如果Z坐标在范围内，则保留该点
                if (z >= zRange.min && z <= zRange.max) {
                    newPositions[idx] = originalPositions[idx];     // X
                    newPositions[idx + 1] = originalPositions[idx + 1]; // Y
                    
                    // 根据视图模式设置Z坐标
                    if (viewMode.is2D) {
                        // 2D模式：将Z坐标设置为0
                        newPositions[idx + 2] = 0;
                    } else {
                        // 3D模式：保留原始Z坐标
                        newPositions[idx + 2] = originalPositions[idx + 2];
                    }
                    
                    visibleCount++;
                } else {
                    // 如果不在范围内，将该点移动到不可见的位置
                    newPositions[idx] = 0;
                    newPositions[idx + 1] = 0;
                    newPositions[idx + 2] = -99999; // 移动到很远的位置
                }
            }

            // 更新几何体的位置属性
            positions.array = newPositions;
            positions.needsUpdate = true;

            // 更新点云的可见点数
            geometry.setDrawRange(0, visibleCount);
        }
    });
}

// 计算点云的Z轴范围
function calculateZRange() {
    let minZ = Infinity;
    let maxZ = -Infinity;

    // 遍历场景中的所有点云
    scene.children.forEach(child => {
        if (child instanceof THREE.Points) {
            const geometry = child.geometry;
            const positions = geometry.attributes.position;
            const originalPositions = geometry.userData.originalPositions || positions.array;
            // 遍历所有点，找到Z轴的最小值和最大值
            for (let i = 0; i < positions.count; i++) {
                const idx = i * 3;
                const z = originalPositions[idx + 2]; // Z坐标
                if (z < minZ) minZ = z;
                if (z > maxZ) maxZ = z;
            }
        }
    });

    // 更新Z轴范围控制器
    if (minZ !== Infinity && maxZ !== -Infinity) {
        zRange.min = minZ;
        zRange.max = maxZ;
        
        // 更新HTML输入框的值
        updateZRangeInputs();
        // 更新GUI控制器
        for (let i in gui.__controllers) {
            const controller = gui.__controllers[i];
            if (controller.property === 'min' || controller.property === 'max') {
                controller.updateDisplay();
            }
        }
        for (let i in gui.__folders) {
            const folder = gui.__folders[i];
            if (folder.name === 'Z轴范围控制') {
                for (let j in folder.__controllers) {
                    const controller = folder.__controllers[j];
                    if (controller.property === 'min' || controller.property === 'max') {
                        controller.updateDisplay();
                    }
                }
            }
        }
    }
}
var helpCamera = [];
for (let i = 0; i < 4; i++) {
    helpCamera[i] = new THREE.PerspectiveCamera(60, 1, 0.1, 0.4);
    scene.add(helpCamera[i]);
}
const transformMatrix0 = new THREE.Matrix4();
transformMatrix0.set(
    0.9635227966591445, -0.0298251417806896, -0.2659591721221557, -3.1861460134378618,
    0.04168012934974072, 0.9983679551673119, 0.03904091331448917, -0.0658694912288581,
    0.264360714054735, -0.04870202267670474, 0.963193400024973, 1.701830863209624117,
    0, 0, 0, 1
);
helpCamera[0].applyMatrix4(transformMatrix0);

const transformMatrix1 = new THREE.Matrix4();
transformMatrix1.set(
    0.8671344194352608, -0.01285630331924969, -0.4979082386300075, -1.981515886805006,
    0.03166906549661311, 0.9990671872561505, 0.02935686697614572, -0.0212592897059282,
    0.4970663626933977, -0.04122463842227529, 0.8667326925100427, 2.75149718348900723,
    0, 0, 0, 1
);
helpCamera[1].applyMatrix4(transformMatrix1);

const transformMatrix2 = new THREE.Matrix4();
transformMatrix2.set(
    0.7024094659673048, -0.007144654873624021, -0.711737238049452, -2.685856668225444,
    0.09031055886130245, 0.9927625554048429, 0.07916130079909767, -0.0514197827631538,
    0.7060204990492023, -0.1198810347502172, 0.6979710541487608, 2.332535510893329,
    0, 0, 0, 1
);
helpCamera[2].applyMatrix4(transformMatrix2);

const transformMatrix3 = new THREE.Matrix4();
transformMatrix3.set(
    0.5308375671028522, 0.00925889315102485, -0.8474230054995811, -3.381832006499801,
    0.1320681431688673, 0.9868199683489367, 0.09351125936341173, -0.0917595736102196,
    0.8371197542241209, -0.1615568722321077, 0.5226183063406084, 1.036010012067961,
    0, 0, 0, 1
);
helpCamera[3].applyMatrix4(transformMatrix3);
const helpers = [];

// 创建PCD文件选择下拉框
const selectContainer = document.createElement('div');
selectContainer.style.position = 'absolute';
selectContainer.style.top = '10px';
selectContainer.style.left = '10px';
selectContainer.style.backgroundColor = 'white';
selectContainer.style.padding = '5px';
selectContainer.style.borderRadius = '4px';
selectContainer.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';

const label = document.createElement('label');
label.textContent = '地图预览: ';
label.style.marginRight = '5px';

const select = document.createElement('select');
select.id = 'pcd-file-select';
select.style.padding = '5px';
select.style.borderRadius = '3px';
select.style.border = '1px solid #ccc';

selectContainer.appendChild(label);
selectContainer.appendChild(select);

// 添加"设为导航地图"按钮
const navMapBtn = document.createElement('button');
navMapBtn.textContent = '设为导航地图';
navMapBtn.id = 'set-nav-map-btn';
navMapBtn.style.marginLeft = '10px';
navMapBtn.style.padding = '5px 10px';
navMapBtn.style.borderRadius = '3px';
navMapBtn.style.border = '1px solid #4CAF50';
navMapBtn.style.backgroundColor = '#4CAF50';
navMapBtn.style.color = 'white';
navMapBtn.style.cursor = 'pointer';
navMapBtn.style.fontSize = '12px';
navMapBtn.onclick = async function() {
    const selectedFile = select.options[select.selectedIndex].textContent;
    if (!selectedFile || selectedFile === '请选择PCD文件') {
        alert('请先选择一个PCD文件');
        return;
    }
    try {
        const response = await axiosClient.post('ros2/set_nav_map', {
            fileName: selectedFile
        });
        if (response.data.code === 0 || response.data.code === 200) {
            localStorage.setItem('lastMapName', selectedFile);
            cocoMessage.success("已设为导航地图，主界面将加载同名2D地图");
        } else {
            cocoMessage.error("设置失败: " + (response.data.message || '未知错误'));
        }
    } catch (error) {
        console.error('设置导航地图失败:', error);
        cocoMessage.error("设置失败，请检查后端服务");
    }
};
selectContainer.appendChild(navMapBtn);

document.body.appendChild(selectContainer);

// 加载PCD文件列表
// 手机端适配：检测移动设备
function isMobileDevice() {
    return (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) && window.innerWidth <= 768;
}

// 手机端适配：点云降采样（每 step 个点取 1 个，点数越多降采样越狠）
function downsampleGeometry(geometry) {
    const pos = geometry.attributes.position;
    if (!pos) return geometry;
    const count = pos.count;
    const step = count > 2000000 ? 8 : count > 500000 ? 4 : 2;
    const newCount = Math.ceil(count / step);
    const src = pos.array;
    const newPos = new Float32Array(newCount * 3);
    for (let i = 0, j = 0; i < count; i += step, j++) {
        newPos[j * 3] = src[i * 3];
        newPos[j * 3 + 1] = src[i * 3 + 1];
        newPos[j * 3 + 2] = src[i * 3 + 2];
    }
    const newGeo = new THREE.BufferGeometry();
    newGeo.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
    // 颜色属性同步降采样
    const colorAttr = geometry.attributes.color;
    if (colorAttr) {
        const csrc = colorAttr.array;
        const newColor = new Float32Array(newCount * 3);
        for (let i = 0, j = 0; i < count; i += step, j++) {
            newColor[j * 3] = csrc[i * 3];
            newColor[j * 3 + 1] = csrc[i * 3 + 1];
            newColor[j * 3 + 2] = csrc[i * 3 + 2];
        }
        newGeo.setAttribute('color', new THREE.BufferAttribute(newColor, 3));
    }
    return newGeo;
}

async function loadPCDFileList() {
    try {
        // 先获取导航地图PCD名称（跨设备同步）
        let navMapPcdName = null;
        try {
            const navMapRes = await axiosClient.get('ros2/get_nav_map');
            if (navMapRes.data.code === 0 && navMapRes.data.data) {
                navMapPcdName = navMapRes.data.data;
            }
        } catch (e) {
            console.warn('获取导航地图失败:', e);
        }

        const res = await axiosClient.get(`pcd/list`);
        // 清空现有选项
        select.innerHTML = '';
        // 添加默认选项
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '请选择PCD文件';
        select.appendChild(defaultOption);
        
        // 添加从接口获取的文件列表
        res.data.data.forEach(fileName => {
            const option = document.createElement('option');
            option.value = fileName;
            option.textContent = fileName;
            select.appendChild(option);
        });

        // 如果有导航地图PCD名称，自动选中
        if (navMapPcdName) {
            select.value = navMapPcdName;
            // 触发选择事件，加载对应的点云
            if (navMapPcdName) {
                select.dispatchEvent(new Event('change'));
            }
        }
    } catch (error) {
        console.error('加载PCD文件列表失败:', error);
    }
}

// 初始加载文件列表
loadPCDFileList();

// 监听选择变化事件
select.addEventListener('change', async function() {
    const selectedFileName = this.value;
    if (!selectedFileName) return;
    
    // 清除所有点云和相机辅助工具，但保留坐标轴
    for (let i = scene.children.length - 1; i >= 0; i--) {
        const object = scene.children[i];
        if (!(object instanceof THREE.AxesHelper)) {
            scene.remove(object);
        }
    }

    for (let i = 0; i < 4; i++) {
        scene.remove(helpers[i]);
    }
    
    try {
        // 通过接口获取PCD文件内容
        const params = {
            fileName: selectedFileName
        }
        const response = await axiosClient.get(`pcd/${selectedFileName}/GlobalMap`, {
            responseType: 'blob'
        });
        // 添加错误处理，确保ROS2接口调用失败不影响后续执行
        try {
            const resChoosePcd = await axiosClient.post(`ros2/pcdfolder/${selectedFileName}`);
            console.log('ROS2文件夹选择响应:', resChoosePcd.data);
        } catch (error) {
            console.error('ROS2文件夹选择失败:', error);
            // 继续执行后续代码，不中断
        }
        // 将Blob转换为DataURL
        const data = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(response.data);
        });
        
        // 使用PCDLoader加载文件
        const loader = new PCDLoader();
        loader.load(data, function (points) {
            // 注意：不再调用points.geometry.center()，保持PCD文件的原始坐标系

            // 手机端适配：移动设备自动降采样，降低渲染压力
            if (isMobileDevice()) {
                points.geometry = downsampleGeometry(points.geometry);
            }

            var material = new THREE.PointsMaterial({ color: 0xffffff, size: 0.01, vertexColors: false });
            
            const pointCloud = new THREE.Points(points.geometry, material);
            // 保存原始位置数据
            pointCloud.geometry.userData.originalPositions = points.geometry.attributes.position.array.slice();
            scene.add(pointCloud);
            
            // 重新添加坐标轴
            scene.add(axesHelper);
            
            // 计算并设置Z轴范围
            calculateZRange();
            
            // 创建机器位置箭头并开始真实位置更新
            createMachineArrow();
            // 立即更新位置，然后开始定时更新
            updateMachinePosition();
            startMachineMovement();
            
            resetGUI();

            
            // 为点云创建 GUI 控件
            const folder = attributesFolder.addFolder(`点云 ${selectedFileName}`);
            
            const text = { pointsNum: points.geometry.attributes.position.count, file: selectedFileName };
            folder.add(text, 'file').name('文件');
            folder.add(text, 'pointsNum').name('点数');
            
            folder.add(material, 'size', 0, 2).name('点大小');
            folder.addColor(material, 'color').name('点颜色');
            folder.add(material, 'vertexColors').name('显示顶点颜色').onChange(function () {
                material.needsUpdate = true; // 手动更新材质
            });
            
            // 计算点云的边界
            const box = new THREE.Box3().setFromObject(scene);
            // 计算点云的中心
            const center = box.getCenter(new THREE.Vector3());
            // 计算点云的大小
            const size = box.getSize(new THREE.Vector3());
            
            // 根据点云大小更新坐标系长度
            // 获取点云的最大尺寸（X、Y、Z中的最大值）
            const maxDimension = Math.max(size.x, size.y, size.z);
            // 设置坐标系长度为点云最大尺寸的1/3，确保坐标系可见且比例合适
            const axesLength = Math.max(maxDimension / 3, 1); // 最小长度为1，避免太小
            
            // 移除旧的坐标系
            scene.remove(axesHelper);
            // 创建新的坐标系，使用动态计算的长度
            axesHelper = new THREE.AxesHelper(axesLength);
            axesHelper.renderOrder = 999; // 设置高渲染优先级，确保在最上层
            scene.add(axesHelper);
            
            // 设置相机的位置为点云的中心，再向后移动一段距离
            camera.position.copy(center);
            camera.position.z += size.length();
            camera.lookAt(center);
        });
    } catch (error) {
        console.error('加载PCD文件失败:', error);
    }
});


// 添加触摸事件处理
renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: false });
renderer.domElement.addEventListener('touchmove', onTouchMove, { passive: false });
renderer.domElement.addEventListener('touchend', onTouchEnd, { passive: false });

// 触摸按下事件处理
function onTouchStart(event) {
    // 只有在箭头绘制模式激活时才处理
    if (!arrowDrawingMode.isActive) return;
    
    // 防止默认行为，避免页面滚动
    event.preventDefault();
    
    // 获取第一个触摸点
    const touch = event.touches[0];
    if (!touch) return;
    
    // 设置正在绘制状态
    arrowDrawingMode.isDrawing = true;
    
    // 获取触摸点在3D空间中的位置
    const mouse = new THREE.Vector2();
    mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;
    
    // 使用射线投射获取3D空间中的点
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    
    // 获取点云的平均Z坐标作为投射平面
    let avgZ = 0;
    let pointCount = 0;
    scene.children.forEach(child => {
        if (child instanceof THREE.Points) {
            const geometry = child.geometry;
            const positions = geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) {
                const z = positions.array[i * 3 + 2];
                if (z > -99999) { // 排除被隐藏的点
                    avgZ += z;
                    pointCount++;
                }
            }
        }
    });
    
    if (pointCount > 0) {
        avgZ /= pointCount;
    }
    
    // 在点云平均Z平面上投射（考虑点云移动后的位置）
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -avgZ);
    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersection);
    
    // 将世界坐标转换为相对于坐标系原点的相对坐标
    const relativeIntersection = intersection.clone().sub(axesHelper.position);
    
    // 设置起点（使用相对坐标）
    arrowDrawingMode.startPoint = relativeIntersection.clone();
    arrowDrawingMode.endPoint = relativeIntersection.clone();
    
    // 创建箭头辅助对象
    const direction = new THREE.Vector3(0, 1, 0);
    const arrowHelper = new THREE.ArrowHelper(direction, arrowDrawingMode.startPoint, 1, 0xff0000, 0.5, 0.3);
    arrowHelper.visible = false;
    scene.add(arrowHelper);
    arrowDrawingMode.arrowHelper = arrowHelper;
}

// 触摸移动事件处理
function onTouchMove(event) {
    // 只有在箭头绘制模式激活且正在绘制时才处理
    if (!arrowDrawingMode.isActive || !arrowDrawingMode.isDrawing) return;
    
    // 防止默认行为，避免页面滚动
    event.preventDefault();
    
    // 获取第一个触摸点
    const touch = event.touches[0];
    if (!touch) return;
    
    // 获取触摸点在3D空间中的位置
    const mouse = new THREE.Vector2();
    mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;
    
    // 使用射线投射获取3D空间中的点
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    
    // 获取点云的平均Z坐标作为投射平面
    let avgZ = 0;
    let pointCount = 0;
    scene.children.forEach(child => {
        if (child instanceof THREE.Points) {
            const geometry = child.geometry;
            const positions = geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) {
                const z = positions.array[i * 3 + 2];
                if (z > -99999) { // 排除被隐藏的点
                    avgZ += z;
                    pointCount++;
                }
            }
        }
    });
    
    if (pointCount > 0) {
        avgZ /= pointCount;
    }
    
    // 在点云平均Z平面上投射（考虑点云移动后的位置）
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -avgZ);
    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersection);
    
    // 将世界坐标转换为相对于坐标系原点的相对坐标
    const relativeIntersection = intersection.clone().sub(axesHelper.position);
    
    // 更新终点（使用相对坐标）
    arrowDrawingMode.endPoint = relativeIntersection.clone();
    
    // 更新箭头辅助对象
    if (arrowDrawingMode.arrowHelper) {
        const direction = new THREE.Vector3().subVectors(arrowDrawingMode.endPoint, arrowDrawingMode.startPoint);
        const length = direction.length();
        
        if (length > 0.1) { // 只有当长度足够时才显示箭头
            direction.normalize();
            
            // 将相对坐标转换为世界坐标用于显示箭头
            const worldPosition = arrowDrawingMode.startPoint.clone().add(axesHelper.position);
            arrowDrawingMode.arrowHelper.position.copy(worldPosition);
            arrowDrawingMode.arrowHelper.setDirection(direction);
            arrowDrawingMode.arrowHelper.setLength(length, 0.5, 0.3);
            arrowDrawingMode.arrowHelper.visible = true;
        } else {
            arrowDrawingMode.arrowHelper.visible = false;
        }
    }
}

// 触摸结束事件处理
async function onTouchEnd(event) {
    // 只有在箭头绘制模式激活且正在绘制时才处理
    if (!arrowDrawingMode.isActive || !arrowDrawingMode.isDrawing) return;
    
    // 防止默认行为
    event.preventDefault();
    
    // 结束绘制状态
    arrowDrawingMode.isDrawing = false;
    
    // 获取起点和终点（相对坐标）
        const startPoint = arrowDrawingMode.startPoint;
        const endPoint = arrowDrawingMode.endPoint;
        
        // 计算箭头方向和长度
        const direction = new THREE.Vector3().subVectors(endPoint, startPoint);
        const length = direction.length();
        
        if (length > 0.1) { // 只有当长度足够时才处理箭头
            direction.normalize();
            // 计算箭头指向的方位角（在XY平面上与X轴的夹角）
            const azimuth = Math.atan2(direction.y, direction.x);
            // 计算箭头在XY平面的长度
            const xyLength = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
            // 保存箭头信息（使用相对坐标）
            const arrowOrigin = {
                x: startPoint.x,
                y: startPoint.y,
                z: startPoint.z
            };
            // 设置新的Y轴方向
            const arrowDirection = {
                x: direction.x,
                y: direction.y,
                z: direction.z
            };
        
        console.log("触摸绘制箭头完成");
        
        // 移除箭头辅助对象
        if (arrowDrawingMode.arrowHelper) {
            scene.remove(arrowDrawingMode.arrowHelper);
            arrowDrawingMode.arrowHelper = null;
        }
        
        // 隐藏初始的箭头辅助对象
        if (arrowHelper) {
            arrowHelper.visible = false;
            console.log("已隐藏初始的箭头辅助对象");
        }
        
        // 完全禁用箭头绘制模式
        arrowDrawingMode.isActive = false;
        arrowDrawingMode.isDrawing = false;
        arrowDrawingMode.startPoint = null;
        arrowDrawingMode.endPoint = null;
        arrowDrawingMode.isCompleted = true;
        
        // 计算方向向量
        const directionX = arrowDirection.x;
        const directionY = arrowDirection.y;
        const directionZ = 0;
        
        // 计算方向向量的长度
        const length = Math.sqrt(directionX * directionX + directionY * directionY + directionZ * directionZ);
        
        // 归一化方向向量
        const normalizedX = directionX / length;
        const normalizedY = directionY / length;
        const normalizedZ = directionZ / length;
        
        // 计算旋转角度（弧度）
        const angle = Math.atan2(normalizedY, normalizedX);
        
        // 根据切割方向调整角度
        let adjustedAngle = angle;
        if (arrowDrawingMode.direction === 'x') {
            // X方向需要减少90度（π/2弧度）
            adjustedAngle += Math.PI / 2; // 直接从原始角度减去90度
        }
        
        // 计算四元数（绕Z轴旋转）
        const halfAngle = adjustedAngle / 2;
        const w = Math.cos(halfAngle);
        const x = 0;
        const y = 0;
        const z = Math.sin(halfAngle);
        // 构造JSON对象
        const selectedFileName = document.getElementById('pcd-file-select').options[document.getElementById('pcd-file-select').selectedIndex].textContent;
        const arrowData = {
            fileName: selectedFileName,
            mapName: selectedFileName,
            cuttingPlane: {
                zMin: zRange.min,
                zMax: zRange.max,
                direction: arrowDrawingMode.direction // 添加切割方向：x或y
            },
            pose: {
                orientation:{
                    quaternion: {
                        x: x,
                        y: y,
                        z: z,
                        w: w
                    },
                    target:{
                    x: arrowOrigin.x,
                    y: arrowOrigin.y,
                    z: 0.0
                    }
                },
                position: {
                    x: arrowOrigin.x,
                    y: arrowOrigin.y,
                    z: 0.0
                }
            }
        };
        try {
            const response = await axiosClient.post(`pcd/process-by-pose`, arrowData);
            if(response.data.code == 0){
                cocoMessage.success("切割发送成功");
                
                // 保存mapName和fileName的关联关系到数据库
                const mappingResponse = await axiosClient.post(`/api/map-file-mapping/save`, {
                    mapName: arrowData.mapName,
                    fileName: arrowData.fileName
                });
       
                if(mappingResponse.data.code == 0){
                    console.log("地图与文件关联关系保存成功");
                }

                // 提示并重新加载地图
                cocoMessage.info("重新加载地图中，请等待...", 3000);
                setTimeout(() => {
                    const selectElement = document.getElementById('pcd-file-select');
                    if (selectElement && selectElement.value) {
                        selectElement.dispatchEvent(new Event('change'));
                        console.log('重新加载地图:', selectElement.value);
                    }
                }, 3000); // 延迟3秒，等待切割完成
            }
            // 添加错误处理，确保ROS2接口调用失败不影响后续执行
            try {
                const resChoosePcd = await axiosClient.post(`ros2/pcdfolder/${arrowData.fileName}`);
                console.log('ROS2文件夹选择响应:', resChoosePcd.data);
            } catch (error) {
                console.error('ROS2文件夹选择失败:', error);
                // 继续执行后续代码，不中断
            }
        } catch (error) {
            console.error("请求失败:", error);
        }
        // 在箭头绘制完成后立即打印arrowData
        // 更新GUI控制器，确保箭头绘制模式复选框也被正确更新
        gui.controllersRecursive().forEach(controller => {
            if (controller.property === 'isActive') {
                controller.updateDisplay();
            }
            // 不再禁用箭头绘制模式复选框，允许用户再次启用
        });
        // 重新启用OrbitControls并更新
        controls.enabled = true;
        controls.update();
        // 恢复鼠标样式
        renderer.domElement.style.cursor = 'default';
    } else {
        // 如果箭头太短，则取消绘制
        cancelArrowDrawing();
        // 更新GUI控制器，确保箭头绘制模式复选框也被正确更新
        gui.controllersRecursive().forEach(controller => {
            if (controller.property === 'isActive') {
                controller.updateDisplay();
            }
        });
        // 重新启用OrbitControls并更新
        controls.enabled = true;
        controls.update();
        // 恢复鼠标样式
        renderer.domElement.style.cursor = 'default';
	}
}

// 触摸大屏视角控制功能
function setupTouchViewControls() {
    // 获取视角控制按钮
    const viewTop = document.getElementById('viewTop');
    const viewBottom = document.getElementById('viewBottom');
    const viewLeft = document.getElementById('viewLeft');
    const viewRight = document.getElementById('viewRight');
    const viewUp = document.getElementById('viewUp');
    const viewDown = document.getElementById('viewDown');
    const viewReset = document.getElementById('viewReset');
    
    // 移动速度（与键盘控制保持一致）
    const moveSpeed = 0.5;
    const cloudMoveSpeed = 0.2;
    
    // 上箭头：点云向上移动（Y轴正方向）- 对应Shift+上箭头
     viewTop.addEventListener('click', () => {
         scene.children.forEach(child => {
             if (child instanceof THREE.Points) {
                 child.position.y += cloudMoveSpeed;
             }
         });
         // 坐标系跟随点云移动
         axesHelper.position.y += cloudMoveSpeed;
         controls.update();
         console.log('点云向上移动');
     });
     
     // 下箭头：点云向下移动（Y轴负方向）- 对应Shift+下箭头
     viewBottom.addEventListener('click', () => {
         scene.children.forEach(child => {
             if (child instanceof THREE.Points) {
                 child.position.y -= cloudMoveSpeed;
             }
         });
         // 坐标系跟随点云移动
         axesHelper.position.y -= cloudMoveSpeed;
         controls.update();
         console.log('点云向下移动');
     });
     
     // 左箭头：点云向左移动（X轴负方向）- 对应Shift+左箭头
     viewLeft.addEventListener('click', () => {
         scene.children.forEach(child => {
             if (child instanceof THREE.Points) {
                 child.position.x -= cloudMoveSpeed;
             }
         });
         // 坐标系跟随点云移动
         axesHelper.position.x -= cloudMoveSpeed;
         controls.update();
         console.log('点云向左移动');
     });
     
     // 右箭头：点云向右移动（X轴正方向）- 对应Shift+右箭头
     viewRight.addEventListener('click', () => {
         scene.children.forEach(child => {
             if (child instanceof THREE.Points) {
                 child.position.x += cloudMoveSpeed;
             }
         });
         // 坐标系跟随点云移动
         axesHelper.position.x += cloudMoveSpeed;
         controls.update();
         console.log('点云向右移动');
     });
    
    // 上按钮：相机向上移动（Z轴正方向）- 对应W键
     viewUp.addEventListener('click', () => {
         camera.position.z += moveSpeed;
         controls.update();
         console.log('相机向上移动');
     });
     
     // 下按钮：相机向下移动（Z轴负方向）- 对应S键
     viewDown.addEventListener('click', () => {
         camera.position.z -= moveSpeed;
         controls.update();
         console.log('相机向下移动');
     });
    
    // 重置视角
    viewReset.addEventListener('click', () => {
        camera.position.set(0, 0, 10);
        camera.lookAt(0, 0, 0);
        controls.reset();
        console.log('重置视角');
    });
}

// 初始化触摸大屏视角控制
setupTouchViewControls();

// 更新坐标系
function updateCoordinateSystem() {
    // 不再移除和重新创建坐标系，而是直接更新现有坐标系的大小
    // 这样可以保持坐标系的位置信息不变
    
    // 计算点云的边界和大小，以确定合适的坐标系长度
    const box = new THREE.Box3();
    scene.children.forEach(child => {
        if (child instanceof THREE.Points) {
            box.expandByObject(child);
        }
    });
    
    // 计算点云的大小
    const size = box.getSize(new THREE.Vector3());
    // 获取点云的最大尺寸（X、Y、Z中的最大值）
    const maxDimension = Math.max(size.x, size.y, size.z);
    // 设置坐标系长度为点云最大尺寸的1/3，确保坐标系可见且比例合适
    const axesLength = Math.max(maxDimension / 3, 1); // 最小长度为1，避免太小
    
    // 如果坐标系不存在，则创建新的坐标系
    if (!axesHelper) {
        axesHelper = new THREE.AxesHelper(axesLength);
        axesHelper.renderOrder = 999; // 设置高渲染优先级，确保在最上层
        scene.add(axesHelper);
    } else {
        // 如果坐标系已存在，直接更新其大小
        // 通过重新设置线段的长度来更新坐标系大小
        axesHelper.children.forEach((child, index) => {
            if (child instanceof THREE.Line) {
                const geometry = child.geometry;
                const positions = geometry.attributes.position;
                
                // 更新坐标轴的长度
                positions.array[3] = axesLength;  // X轴终点
                positions.array[4] = 0;
                positions.array[5] = 0;
                
                positions.array[9] = 0;           // Y轴终点
                positions.array[10] = axesLength;
                positions.array[11] = 0;
                
                positions.array[15] = 0;          // Z轴终点
                positions.array[16] = 0;
                positions.array[17] = axesLength;
                
                positions.needsUpdate = true;
            }
        });
    }
    
    // 坐标系保持当前的实际位置，不重置为原点
    // 注意：axesHelper.position已经包含了平移后的位置信息
    
    // 更新旋转指示器位置和方向
    rotationIndicator.position.set(0, 0, 0); // 确保旋转指示器位于原始坐标系原点
    rotationIndicator.rotation.x = Math.PI / 2; // 使圆环平行于XY平面
    // 不再根据箭头方向旋转旋转指示器
    
    // 不更新箭头辅助对象，确保箭头绘制完成后不会在场景中留下任何箭头
}
document.addEventListener('keydown', (event) => {
    const moveSpeed = 0.5;
    const cloudMoveSpeed = 0.2; // 点云移动速度
    
    switch(event.key.toLowerCase()) {
        case 'w': // 向上移动（Y轴正方向）
            camera.position.y += moveSpeed;
            break;
        case 's': // 向下移动（Y轴负方向）
            camera.position.y -= moveSpeed;
            break;
        case 'a': // 向左移动（X轴负方向）
            camera.position.x -= moveSpeed;
            break;
        case 'd': // 向右移动（X轴正方向）
            camera.position.x += moveSpeed;
            break;
        case 'arrowup': // 向前移动（Z轴负方向）
            if (event.shiftKey) {
                // Shift+上箭头：点云向上移动（Y轴正方向）
                scene.children.forEach(child => {
                    if (child instanceof THREE.Points) {
                        child.position.y += cloudMoveSpeed;
                    }
                });
                // 坐标系跟随点云移动
                axesHelper.position.y += cloudMoveSpeed;
            } else {
                // 上箭头：相机向前移动（Z轴负方向）
                camera.position.z -= moveSpeed;
            }
            break;
        case 'arrowdown': // 向后移动（Z轴正方向）
            if (event.shiftKey) {
                // Shift+下箭头：点云向下移动（Y轴负方向）
                scene.children.forEach(child => {
                    if (child instanceof THREE.Points) {
                        child.position.y -= cloudMoveSpeed;
                    }
                });
                // 坐标系跟随点云移动
                axesHelper.position.y -= cloudMoveSpeed;
            } else {
                // 下箭头：相机向后移动（Z轴正方向）
                camera.position.z += moveSpeed;
            }
            break;
        case 'arrowleft': // 向左旋转视角
            if (event.shiftKey) {
                // Shift+左箭头：点云向左移动（X轴负方向）
                scene.children.forEach(child => {
                    if (child instanceof THREE.Points) {
                        child.position.x -= cloudMoveSpeed;
                    }
                });
                // 坐标系跟随点云移动
                axesHelper.position.x -= cloudMoveSpeed;
            } else {
                // 左箭头：场景向左旋转
                const currentRotation = scene.rotation.y;
                scene.rotation.y += 0.1;
                
                // 计算旋转差值
                const rotationDiff = scene.rotation.y - currentRotation;
                
                // 将坐标轴也旋转相同的角度
                // 注意：我们已经在初始化时设置了axesHelper.rotation.z = -Math.PI / 2
                // 所以这里需要在原始旋转基础上添加新的旋转角度
                axesHelper.rotation.y += rotationDiff;
                
                // 将旋转指示器也旋转相同的角度
                rotationIndicator.rotation.y += rotationDiff;
                // 不更新箭头辅助对象，确保箭头绘制完成后不会在场景中留下任何箭头
            }
            break;
        case 'arrowright': // 向右旋转视角
            if (event.shiftKey) {
                // Shift+右箭头：点云向右移动（X轴正方向）
                scene.children.forEach(child => {
                    if (child instanceof THREE.Points) {
                        child.position.x += cloudMoveSpeed;
                    }
                });
                // 坐标系跟随点云移动
                axesHelper.position.x += cloudMoveSpeed;
            } else {
                // 右箭头：场景向右旋转
                const currentRotation = scene.rotation.y;
                scene.rotation.y -= 0.1;
                
                // 计算旋转差值
                const rotationDiff = scene.rotation.y - currentRotation;
                
                // 将坐标轴也旋转相同的角度
                // 注意：我们已经在初始化时设置了axesHelper.rotation.z = -Math.PI / 2
                // 所以这里需要在原始旋转基础上添加新的旋转角度
                axesHelper.rotation.y += rotationDiff;
                
                // 将旋转指示器也旋转相同的角度
                rotationIndicator.rotation.y += rotationDiff;
                // 不更新箭头辅助对象，确保箭头绘制完成后不会在场景中留下任何箭头
            }
            break;
    }
});

// onresize 事件会在窗口被调整大小时发生
window.onresize = function () {
    // 重置渲染器输出画布，相机
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
};

// 页面卸载时销毁GUI实例，防止重复加载
window.addEventListener('beforeunload', function() {
    if (gui) {
        gui.destroy();
    }
});



function animate() {
    if (isRotation.bool) {
        // 保存当前场景旋转角度
        const currentRotation = scene.rotation.y;
        
        // 更新场景旋转
        scene.rotation.y += 0.005;
        
        // 计算旋转差值
        const rotationDiff = scene.rotation.y - currentRotation;
        
        // 将坐标轴也旋转相同的角度
        // 注意：我们已经在初始化时设置了axesHelper.rotation.z = -Math.PI / 2
        // 所以这里需要在原始旋转基础上添加新的旋转角度
        axesHelper.rotation.y += rotationDiff;
        
        // 将旋转指示器也旋转相同的角度
        rotationIndicator.rotation.y += rotationDiff;
        // 不更新箭头辅助对象，确保箭头绘制完成后不会在场景中留下任何箭头
    }
    
    // Z轴旋转逻辑
    if (zRotation.isRotating) {
        // 更新旋转角度
        zRotation.angle += zRotation.speed * zRotation.direction;
        
        // 应用旋转到点云
        scene.children.forEach(child => {
            if (child instanceof THREE.Points) {
                child.rotation.z = zRotation.angle;
            }
        });
        
        // 将坐标轴也旋转相同的角度
        // 修复：直接使用zRotation.angle，避免初始旋转偏移
        axesHelper.rotation.z = zRotation.angle;
        
        // 确保坐标轴始终可见且正确渲染
        axesHelper.visible = true;
        
        // 将旋转指示器也旋转相同的角度
        // 修复：只更新旋转指示器的Z轴旋转，避免影响坐标轴
        rotationIndicator.rotation.z = Math.PI / 2 + zRotation.angle;
        
        // 机器位置箭头跟随点云旋转，但朝向相对于点云坐标系保持不变
        // 注意：机器朝向已经在updateMachinePosition中设置，这里不需要额外旋转
        // 不更新箭头辅助对象，确保箭头绘制完成后不会在场景中留下任何箭头
    }

    controls.update(); // 更新控制器
    renderer.render(scene, camera);

    requestAnimationFrame(animate);
}
animate();


// 添加鼠标事件处理
renderer.domElement.addEventListener('mousedown', onMouseDown);
renderer.domElement.addEventListener('mousemove', onMouseMove);
renderer.domElement.addEventListener('mouseup', onMouseUp);

// 鼠标按下事件处理
function onMouseDown(event) {
    // 只有在箭头绘制模式激活时才处理
    if (!arrowDrawingMode.isActive) return;
    
    // 防止事件冒泡，避免触发OrbitControls
    event.preventDefault();
    event.stopPropagation();
    
    // 设置正在绘制状态
    arrowDrawingMode.isDrawing = true;
    
    // 获取鼠标在3D空间中的位置
    const mouse = new THREE.Vector2();
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    // 使用射线投射获取3D空间中的点
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    
    // 获取点云的平均Z坐标作为投射平面
    let avgZ = 0;
    let pointCount = 0;
    scene.children.forEach(child => {
        if (child instanceof THREE.Points) {
            const geometry = child.geometry;
            const positions = geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) {
                const z = positions.array[i * 3 + 2];
                if (z > -99999) { // 排除被隐藏的点
                    avgZ += z;
                    pointCount++;
                }
            }
        }
    });
    
    if (pointCount > 0) {
        avgZ /= pointCount;
    }
    
    // 在点云平均Z平面上投射（考虑点云移动后的位置）
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -avgZ);
    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersection);
    
    // 将世界坐标转换为相对于坐标系原点的相对坐标
    const relativeIntersection = intersection.clone().sub(axesHelper.position);
    
    // 设置起点（使用相对坐标）
    arrowDrawingMode.startPoint = relativeIntersection.clone();
    arrowDrawingMode.endPoint = relativeIntersection.clone();
    
    // 创建箭头辅助对象
    const direction = new THREE.Vector3(0, 1, 0);
    const arrowHelper = new THREE.ArrowHelper(direction, arrowDrawingMode.startPoint, 1, 0xff0000, 0.5, 0.3);
    arrowHelper.visible = false;
    scene.add(arrowHelper);
    arrowDrawingMode.arrowHelper = arrowHelper;
}

// 鼠标移动事件处理
function onMouseMove(event) {
    // 只有在箭头绘制模式激活且正在绘制时才处理
    if (!arrowDrawingMode.isActive || !arrowDrawingMode.isDrawing) return;
    
    // 防止事件冒泡，避免触发OrbitControls
    event.preventDefault();
    event.stopPropagation();
    
    // 获取鼠标在3D空间中的位置
    const mouse = new THREE.Vector2();
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    // 使用射线投射获取3D空间中的点
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    
    // 获取点云的平均Z坐标作为投射平面
    let avgZ = 0;
    let pointCount = 0;
    scene.children.forEach(child => {
        if (child instanceof THREE.Points) {
            const geometry = child.geometry;
            const positions = geometry.attributes.position;
            for (let i = 0; i < positions.count; i++) {
                const z = positions.array[i * 3 + 2];
                if (z > -99999) { // 排除被隐藏的点
                    avgZ += z;
                    pointCount++;
                }
            }
        }
    });
    
    if (pointCount > 0) {
        avgZ /= pointCount;
    }
    
    // 在点云平均Z平面上投射（考虑点云移动后的位置）
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -avgZ);
    const intersection = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, intersection);
    
    // 将世界坐标转换为相对于坐标系原点的相对坐标
    const relativeIntersection = intersection.clone().sub(axesHelper.position);
    
    // 更新终点（使用相对坐标）
    arrowDrawingMode.endPoint = relativeIntersection.clone();
    
    // 更新箭头辅助对象
    if (arrowDrawingMode.arrowHelper) {
        const direction = new THREE.Vector3().subVectors(arrowDrawingMode.endPoint, arrowDrawingMode.startPoint);
        const length = direction.length();
        
        if (length > 0.1) { // 只有当长度足够时才显示箭头
            direction.normalize();
            
            // 将相对坐标转换为世界坐标用于显示箭头
            const worldPosition = arrowDrawingMode.startPoint.clone().add(axesHelper.position);
            arrowDrawingMode.arrowHelper.position.copy(worldPosition);
            arrowDrawingMode.arrowHelper.setDirection(direction);
            arrowDrawingMode.arrowHelper.setLength(length, 0.5, 0.3);
            arrowDrawingMode.arrowHelper.visible = true;
        } else {
            arrowDrawingMode.arrowHelper.visible = false;
        }
    }
}

// 鼠标松开事件处理
async function onMouseUp(event) {
    // 只有在箭头绘制模式激活且正在绘制时才处理
    if (!arrowDrawingMode.isActive || !arrowDrawingMode.isDrawing) return;
    
    // 防止事件冒泡，避免触发OrbitControls
    event.preventDefault();
    event.stopPropagation();
    
    // 结束绘制状态
    arrowDrawingMode.isDrawing = false;
    
    // 获取起点和终点（相对坐标）
        const startPoint = arrowDrawingMode.startPoint;
        const endPoint = arrowDrawingMode.endPoint;
        
        // 计算箭头方向和长度
        const direction = new THREE.Vector3().subVectors(endPoint, startPoint);
        const length = direction.length();
        
        if (length > 0.1) { // 只有当长度足够时才处理箭头
            direction.normalize();
            // 计算箭头指向的方位角（在XY平面上与X轴的夹角）
            const azimuth = Math.atan2(direction.y, direction.x);
            // 计算箭头在XY平面的长度
            const xyLength = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
            // 保存箭头信息（使用相对坐标）
            const arrowOrigin = {
                x: startPoint.x,
                y: startPoint.y,
                z: startPoint.z
            };
            // 设置新的Y轴方向
            const arrowDirection = {
                x: direction.x,
                y: direction.y,
                z: direction.z
            };
        // 注意：不再调用updateCoordinateSystem()，保持原始坐标系
        console.log("箭头绘制完成，但保持原始坐标系不变");
        
        // 移除箭头辅助对象
        if (arrowDrawingMode.arrowHelper) {
            scene.remove(arrowDrawingMode.arrowHelper);
            arrowDrawingMode.arrowHelper = null;
            console.log("已移除箭头辅助对象");
        }
        
        // 隐藏初始的箭头辅助对象
        if (arrowHelper) {
            arrowHelper.visible = false;
            console.log("已隐藏初始的箭头辅助对象");
        }
        
        // 完全禁用箭头绘制模式
        arrowDrawingMode.isActive = false;
        arrowDrawingMode.isDrawing = false;
        arrowDrawingMode.startPoint = null;
        arrowDrawingMode.endPoint = null;
        arrowDrawingMode.isCompleted = true; // 添加标记，表示箭头绘制已完成
        
        // 计算方向向量
        const directionX = arrowDirection.x;
        const directionY = arrowDirection.y;
        const directionZ = 0;
        
        // 计算方向向量的长度
        const length = Math.sqrt(directionX * directionX + directionY * directionY + directionZ * directionZ);
        
        // 归一化方向向量
        const normalizedX = directionX / length;
        const normalizedY = directionY / length;
        const normalizedZ = directionZ / length;
        
        // 计算旋转角度（弧度）
        const angle = Math.atan2(normalizedY, normalizedX);
        
        // 根据切割方向调整角度
        let adjustedAngle = angle;
        if (arrowDrawingMode.direction === 'x') {
            // X方向需要减少90度（π/2弧度）
            adjustedAngle += Math.PI / 2; // 直接从原始角度减去90度
        }
        
        // 计算四元数（绕Z轴旋转）
        const halfAngle = adjustedAngle / 2;
        const w = Math.cos(halfAngle);
        const x = 0;
        const y = 0;
        const z = Math.sin(halfAngle);
        // 构造JSON对象
        const selectedFileName = document.getElementById('pcd-file-select').options[document.getElementById('pcd-file-select').selectedIndex].textContent;
        const arrowData = {
            fileName: selectedFileName,
            mapName: selectedFileName,
            cuttingPlane: {
                zMin: zRange.min,
                zMax: zRange.max,
                direction: arrowDrawingMode.direction // 添加切割方向：x或y
            },
            pose: {
                orientation:{
                    quaternion: {
                        x: x,
                        y: y,
                        z: z,
                        w: w
                    },
                    target:{
                    x: arrowOrigin.x,
                    y: arrowOrigin.y,
                    z: 0.0
                    }
                },
                position: {
                    x: arrowOrigin.x,
                    y: arrowOrigin.y,
                    z: 0.0
                }
            }
        };
        try {
            const response = await axiosClient.post(`pcd/process-by-pose`, arrowData);
            if(response.data.code == 0){
                cocoMessage.success("切割发送成功");
                
                // 保存mapName和fileName的关联关系到数据库
                const mappingResponse = await axiosClient.post(`/api/map-file-mapping/save`, {
                    mapName: arrowData.mapName,
                    fileName: arrowData.fileName
                });
                console.log(mappingResponse,"mappingResponse");
                
                if(mappingResponse.data.code == 0){
                    console.log("地图与文件关联关系保存成功");
                }

                // 提示并重新加载地图
                cocoMessage.info("重新加载地图中，请等待...", 3000);
                setTimeout(() => {
                    const selectElement = document.getElementById('pcd-file-select');
                    if (selectElement && selectElement.value) {
                        selectElement.dispatchEvent(new Event('change'));
                        console.log('重新加载地图:', selectElement.value);
                    }
                }, 3000); // 延迟3秒，等待切割完成
            }
        } catch (error) {
            console.error("请求失败:", error);
        }
        // 在箭头绘制完成后立即打印arrowData
        // 更新GUI控制器，确保箭头绘制模式复选框也被正确更新
        gui.controllersRecursive().forEach(controller => {
            if (controller.property === 'isActive') {
                controller.updateDisplay();
            }
            // 不再禁用箭头绘制模式复选框，允许用户再次启用
        });
        
        // 重新启用OrbitControls并更新
        controls.enabled = true;
        controls.update();
        
        // 恢复鼠标样式
        renderer.domElement.style.cursor = 'default';
        
        console.log("箭头绘制完成，坐标系已更新，箭头已消失，已完全退出箭头绘制模式，恢复到拖动改变视角模式");
    } else {
        // 如果箭头太短，则取消绘制
        cancelArrowDrawing();
        
        // 更新GUI控制器，确保箭头绘制模式复选框也被正确更新
        gui.controllersRecursive().forEach(controller => {
            if (controller.property === 'isActive') {
                controller.updateDisplay();
            }
        });
        
        // 重新启用OrbitControls并更新
        controls.enabled = true;
        controls.update();
        
        // 恢复鼠标样式
        renderer.domElement.style.cursor = 'default';
        
        console.log("箭头绘制已取消，已完全退出箭头绘制模式，恢复到拖动改变视角模式");
    }
}
