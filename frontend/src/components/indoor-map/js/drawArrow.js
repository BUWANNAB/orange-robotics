/**
 * 箭头绘制功能模块
 * 提供交互式箭头绘制功能：点击位置，再点击确定朝向
 */
RosManager.init();

// 声明全局变量，用于标识当前箭头模式

class ArrowDrawer {
    constructor(map) {
        this.map = map;
        this.isActive = false;
        this.startPoint = null;
        this.previewLine = null;
        this.finalArrow = null;
        this.clickHandler = null;
        this.mouseMoveHandler = null;
        this.arrows = []; // 存储所有绘制的箭头
    }

    /**
     * 开始箭头绘制模式
     */
    startDrawing() {
        if (this.isActive) return;
        
        this.isActive = true;
        this.startPoint = null;
        this.clearPreview();
        
        // 添加地图点击事件
        this.clickHandler = (e) => this.onMapClick(e);
        this.map.on('click', this.clickHandler);
        
        // 添加鼠标移动事件
        this.mouseMoveHandler = (e) => this.onMouseMove(e);
        this.map.on('mousemove', this.mouseMoveHandler);
        
        // 改变鼠标样式
        this.map.getContainer().style.cursor = 'crosshair';
        
        console.log('箭头绘制模式已开始，点击地图设置箭头位置');
    }

    /**
     * 停止箭头绘制模式
     */
    stopDrawing() {
        if (!this.isActive) return;
        this.arrowStatus = false
        this.isActive = false;
        this.startPoint = null;
        this.clearPreview();
        
        // 移除事件监听器
        if (this.clickHandler) {
            this.map.off('click', this.clickHandler);
            this.clickHandler = null;
        }
        
        if (this.mouseMoveHandler) {
            this.map.off('mousemove', this.mouseMoveHandler);
            this.mouseMoveHandler = null;
        }
        
        // 恢复鼠标样式
        this.map.getContainer().style.cursor = '';
        
        // 在停止箭头绘制后，显示之前隐藏的站点
        if (typeof window.toggleAllStations === 'function') {
            const toggleBtn = document.getElementById('toggleAllStationsBtn');
            if (toggleBtn && toggleBtn.textContent === '显示站点') {
                window.toggleAllStations(); // 这会将站点显示出来，并将按钮文本改为"隐藏站点"
            }
        }
        
        console.log('箭头绘制模式已停止');
    }

    /**
     * 处理地图点击事件
     * @param {Object} e - Leaflet事件对象
     */

    onMapClick(e) {
       
        if (!this.isActive) return;
        
        const point = e.latlng;
        
        if (!this.startPoint) {
            // 第一次点击：设置箭头位置
            this.startPoint = point;
            // 转换为世界坐标并打印
            const worldCoords = pixelToWorldMath(point.lng, point.lat);
            console.log('箭头第一个点世界坐标 - x:', worldCoords.x.toFixed(6), 'y:', worldCoords.y.toFixed(6));
            
            // 在起点添加一个临时标记
            this.startMarker = L.circleMarker(point, {
                radius: 6,
                fillColor: '#ff7800',
                color: '#000',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            }).addTo(this.map);
            
        } else {
            // 第二次点击：完成箭头绘制
            this.finishArrow(point);
        }
    }

    /**
     * 处理鼠标移动事件
     * @param {Object} e - Leaflet事件对象
     */
    onMouseMove(e) {
        if (!this.isActive || !this.startPoint) return;
        
        const currentPoint = e.latlng;
        this.updatePreview(currentPoint);
    }

    /**
     * 更新预览线
     * @param {Object} endPoint - 当前鼠标位置
     */
    updatePreview(endPoint) {
        this.clearPreview();
        
        // 创建预览线
        this.previewLine = L.polyline([this.startPoint, endPoint], {
            color: '#666',
            weight: 2,
            opacity: 0.6,
            dashArray: '5, 10'
        }).addTo(this.map);
    }

    /**
     * 清除预览元素
     */
    clearPreview() {
        if (this.previewLine) {
            this.map.removeLayer(this.previewLine);
            this.previewLine = null;
        }
    }

    /**
     * 完成箭头绘制
     * @param {Object} endPoint - 箭头终点
     */
    async finishArrow(endPoint) {
        // 清除预览
        this.clearPreview();
        
        // 移除起点标记
        if (this.startMarker) {
            this.map.removeLayer(this.startMarker);
            this.startMarker = null;
        }
        
        // 计算箭头角度（从第一个点指向第二个点的方向）
        const angle = this.calculateAngle(this.startPoint, endPoint);
        
        // 创建连接线
        const line = L.polyline([this.startPoint, endPoint], {
            color: '#ff0000',
            weight: 3,
            opacity: 0.8
        }).addTo(this.map);
        
        // 在终点创建三角形箭头符号（箭头指向从第一个点到第二个点的方向）
        // 直接使用世界坐标计算斜率确定方向
        const dx = endPoint.lng - this.startPoint.lng;
        const dy = this.startPoint.lat - endPoint.lat; // y坐标取反修正方向
        // 计算角度，使三角形顶点指向正确方向
        const angleDegrees = Math.atan2(dy, dx) * (180 / Math.PI);
        const arrowIcon = L.divIcon({
            className: 'arrow-end-marker',
            html: `<div style="
                width: 0; 
                height: 0; 
                border-top: 8px solid transparent; 
                border-bottom: 8px solid transparent; 
                border-left: 16px solid #ff0000; 
                transform: rotate(${angleDegrees}deg); 
                transform-origin: center center;
                filter: drop-shadow(2px 2px 2px rgba(0,0,0,0.3));
            "></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8]  // 调整锚点位置，使三角形重心位于连线上
        });
        
        const arrowMarker = L.marker(endPoint, { icon: arrowIcon }).addTo(this.map);
        
        // 存储箭头组件
        const arrowGroup = {
            position: this.startPoint,
            direction: endPoint,
            angle: angle,
            line: line,
            marker: arrowMarker
        };
        
        this.arrows.push(arrowGroup);
        
        // 计算并打印世界坐标和朝向
        const worldCoords = pixelToWorldMath(this.startPoint.lng, this.startPoint.lat);
        const endWorldCoords = pixelToWorldMath(endPoint.lng, endPoint.lat);
        
        // 使用atan2计算两个点形成的角度（弧度）
        const arrowDx = endWorldCoords.x - worldCoords.x;
        const arrowDy = endWorldCoords.y - worldCoords.y;
        const angleRadians = Math.atan2(arrowDy, arrowDx);
        const arrowAngleDegrees = angleRadians * (180 / Math.PI);
        // 显示角度信息给用户
        cocoMessage.info(`两点形成角度: ${arrowAngleDegrees.toFixed(2)}°`);
        
        // 使用与drag_move.js相同的方式获取station-direction元素
        const fixedStationInfoBox = document.getElementById('fixedStationInfoBox');
        if (fixedStationInfoBox) {
            const directionInput = fixedStationInfoBox.querySelector('#station-direction');
            if (directionInput) {
                directionInput.value = arrowAngleDegrees.toFixed(2);
            }
        }
        setInterval(()=>{
        // 立即清除刚绘制的箭头
        this.map.removeLayer(line);
        this.map.removeLayer(arrowMarker);
        this.arrows.pop();
        },2000)
        
        // 检查单选按钮状态并打印
        const option1 = document.getElementById('option1');
        const option2 = document.getElementById('option2');

        const rosPose = this.getArrowROSPose();
        if (rosPose) {
          
            // 这里可以将rosPose发送到ROS系统
        }
        // 将像素坐标转换为世界坐标
        const startWorldCoords = pixelToWorldMath(this.startPoint.lng, this.startPoint.lat);
        const position = {
            x: startWorldCoords.x,
            y: startWorldCoords.y
        };
        const covarianceMsg = [
                        0, 0.0, 0.0, 0.0, 0.0, 0.0,  // x
                        0.0, 0, 0.0, 0.0, 0.0, 0.0,  // y
                        0.0, 0.0, 0, 0.0, 0.0, 0.0,  // z
                        0.0, 0.0, 0.0, 0.0, 0.0, 0.0, // roll
                        0.0, 0.0, 0.0, 0.0, 0.0, 0.0, // pitch
                        0.0, 0.0, 0.0, 0.0, 0.0, 0.0  // yaw
                        ]
        const orientation = this.degreesToQuaternion(-arrowAngleDegrees);
        // 只有点击机器定位按钮时(window.currentArrow === 'machine')才发布ROS话题
        if (window.currentArrow === 'machine') {
            if (option1 && option1.checked) {
                const rosPoseMessage = this.createROSPoseMessage(position, orientation, 'map');
                const message = new ROSLIB.Message(rosPoseMessage);
                RosManager.goalPoseTopic.publish(message);
            } else if (option2 && option2.checked) {
                const rosPoseMessage = this.createROSPoseMessage(position, orientation, 'map', covarianceMsg);
                const message = new ROSLIB.Message(rosPoseMessage);
                RosManager.initialPosePub.publish(message);
            }
        } else {
            console.log("非机器定位模式，不发布ROS话题，window.currentArrow =", window.currentArrow);
        }         
       
        // 拼接成指定的ROS位姿消息格式
        const rosPoseData = {
            pose: {
                pose: {
                    position: {
                        x: position.x,      // 初始位置X坐标（世界坐标系）
                        y: position.y,      // 初始位置Y坐标（世界坐标系）
                        z: 0                // 固定为0
                    },
                    orientation: {
                        x: orientation.x,
                        y: orientation.y,
                        z: -orientation.z,   // 四元数Z分量
                        w: orientation.w    // 四元数W分量
                    }
                }
            }
        };


        if( window.currentArrow == "reposition"){
            console.log("280");
            console.log(window.currentArrow,":window.currentArrow");
            try {
            const response = await axiosClient.post(`ros2/initial_pose`, rosPoseData);
            if(response.code === 200){
                cocoMessage.success('初始位姿设置成功');
            }
                console.log('ROS位姿数据格式:', JSON.stringify(rosPoseData, null, 2));
            } catch (error) {
                console.error('POST请求失败:', error);
        }
        } else {
            console.log("条件不匹配，window.currentArrow =", window.currentArrow);
        }

        // 重置currentArrow，防止影响后续箭头绘制
        window.currentArrow = null;

        // 停止箭头绘制模式
        this.stopDrawing();
        // 重置状态
        this.startPoint = null;
    }

    degreesToQuaternion(angleDeg) {
                        // 移除原来的-90度调整
                        const angleRad = angleDeg * Math.PI / 180;
                        const halfAngle = angleRad / 2;
                        return {
                            x: 0,
                            y: 0,
                            z: Math.sin(halfAngle),
                            w: Math.cos(halfAngle)
                        };
    }
    /**
     * 计算两点之间的角度（从起点指向终点的方向）
     * 使用公式：arctan((y2-y1)/(x2-x1))，使用世界坐标计算
     * @param {Object} start - 起点坐标 (x1, y1)
     * @param {Object} end - 终点坐标 (x2, y2)
     * @returns {number} 角度（弧度）
     */
    calculateAngle(start, end) {
        // 将像素坐标转换为世界坐标
        const startWorld = pixelToWorldMath(start.lng, start.lat);
        const endWorld = pixelToWorldMath(end.lng, end.lat);
        
        // x1,y1是第一个点的世界坐标，x2,y2是第二个点的世界坐标
        const x1 = startWorld.x;
        const y1 = startWorld.y;
        const x2 = endWorld.x;
        const y2 = endWorld.y;
        
        // 使用公式：arctan((y2-y1)/(x2-x1))
        const dx = x2 - x1;
        const dy = y2 - y1;
        
        // 使用atan2计算角度，结果范围是[-π, π]
        // 0弧度表示正东方向，π/2表示正北方向
        return Math.atan2(dy, dx);
    }
    /**
     * 清除所有箭头
     */
    clearAllArrows() {
        this.arrows.forEach(arrowGroup => {
            if (arrowGroup.line) this.map.removeLayer(arrowGroup.line);
            if (arrowGroup.marker) this.map.removeLayer(arrowGroup.marker);
        });
        this.arrows = [];
        console.log('所有箭头已清除');
    }
    /**
     * 获取所有箭头数据
     * @returns {Array} 箭头数据数组
     */
    getArrowsData() {
        return this.arrows.map(arrowGroup => ({
            position: {
                lat: arrowGroup.position.lat,
                lng: arrowGroup.position.lng
            },
            direction: {
                lat: arrowGroup.direction.lat,
                lng: arrowGroup.direction.lng
            },
            angle: arrowGroup.angle
        }));
    }
    /**
     * 创建ROS标准格式的位姿消息
     * @param {Object} position - 位置对象 {x, y}
     * @param {Object} orientation - 方向对象 {x, y, z, w} 或角度
     * @param {string} frameId - 坐标系ID，默认为'map'
     * @returns {Object} ROS标准格式的位姿消息
     */

    createROSPoseMessage(position, orientation, frameId = 'map',covariance) {
        // 创建header
        const header = {
            frame_id: frameId,
            stamp: {
                secs: Math.floor(Date.now() / 1000),
                nsecs: (Date.now() % 1000) * 1000000
            }
        };

        // 处理位置信息（直接使用世界坐标）
        const pos = {
            x: position.x,  // 直接使用世界坐标x
            y: position.y,  // 直接使用世界坐标y
            z: 0
        };

        // 处理方向信息
        let orient;
        if (orientation && typeof orientation === 'object' && 'x' in orientation) {
            // 如果是四元数格式
            orient = {
                x: orientation.x || 0,
                y: orientation.y || 0,
                z: orientation.z || 0,
                w: orientation.w || 1
            };
        } else {
            // 如果是角度，转换为四元数
            const angle = orientation || 0;
            const halfAngle = angle / 2;
            orient = {
                x: 0,
                y: 0,
                z: Math.sin(halfAngle),
                w: Math.cos(halfAngle)
            };
        }

        // 创建完整的pose消息
        const pose = {
            position: pos,
            orientation: orient
        };
        // 返回完整的ROS标准格式位姿消息 
         return covariance ? { 
             header: header, 
             pose: { 
                 pose: pose, 
                 covariance: covariance 
             } 
         }:{ 
             header: header, 
             pose: pose, 
         };
    }
    /**
     * 获取箭头的ROS位姿消息
     * @param {number} index - 箭头索引，默认为最后一个箭头
     * @returns {Object} ROS位姿消息
     */
    getArrowROSPose(index = -1) {
        if (this.arrows.length === 0) {
            console.warn('没有可用的箭头数据');
            return null;
        }
        // 获取指定的箭头
        const arrowIndex = index < 0 ? this.arrows.length - 1 : index;
        const arrowGroup = this.arrows[arrowIndex];
       
        if (!arrowGroup) {
            console.warn('指定的箭头不存在');
            return null;
        }
        // 创建ROS位姿消息（使用箭头第一个点的位置作为位姿位置）
        return this.createROSPoseMessage(
            arrowGroup.position,  // 使用箭头的起始点位置
            arrowGroup.angle,     // 使用箭头的角度
            'map'
        );
    }
}
// 导出ArrowDrawer类
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ArrowDrawer;
} else if (typeof window !== 'undefined') {
    window.ArrowDrawer = ArrowDrawer;
}