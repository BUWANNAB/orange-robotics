/**
 * 参数说明弹出框组件
 * 用于显示参数的详细说明和图示
 */
class ParameterInfoModal {
    constructor() {
        this.modal = null;
        this.init();
    }

    /**
     * 初始化弹出框
     */
    init() {
        // 创建弹出框HTML结构
        const modalHTML = `
            <div class="modal fade" id="parameterInfoModal" tabindex="-1" aria-labelledby="parameterInfoModalLabel" aria-hidden="true">
                <div class="modal-dialog modal-lg">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title" id="parameterInfoModalLabel">参数说明</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <div class="row">
                                <div class="col-md-6">
                                    <h6>参数名称</h6>
                                    <p id="paramName" class="fw-bold"></p>
                                    
                                    <h6>参数描述</h6>
                                    <p id="paramDescription"></p>
                                    
                                    <h6>取值范围</h6>
                                    <p id="paramRange"></p>
                                    
                                    <h6>单位</h6>
                                    <p id="paramUnit"></p>
                                </div>
                                <div class="col-md-6">
                                    <h6>参数图示</h6>
                                    <div id="paramImageContainer" class="text-center">
                                        <img id="paramImage" src="" alt="参数图示" class="img-fluid">
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">关闭</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // 将弹出框添加到body
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // 获取弹出框实例
        this.modal = new bootstrap.Modal(document.getElementById('parameterInfoModal'));
        
        // 存储参数信息
        this.parameterData = this.loadParameterData();
    }

    /**
     * 加载参数信息数据
     */
    loadParameterData() {
        return {
            // 车型选择
            'model': {
                name: '车型选择',
                description: '选择机器人的车型类型，不同车型有不同的运动学模型和控制方式。',
                range: '阿克曼车型、舵轮车型、差速舵轮车型、麦克纳姆轮车型、差速履带型',
                unit: '无',
                image: '../../assets/imges/260.png'
            },
            // 控制模式
            'controlModel': {
                name: '控制模式',
                description: '设置机器人的控制模式，决定机器人的控制策略和算法。',
                range: '根据系统支持的选项选择',
                unit: '无',
                image: '../../assets/imges/parameter-images/controlModel.png'
            },
            // 导航模式
            'navigationMode': {
                name: '导航模式',
                description: '设置机器人的导航模式，决定机器人如何进行路径规划和导航。',
                range: '根据系统确定',
                unit: '无',
                image: '../../assets/imges/parameter-images/navigationMode.png'
            },
            // 车辆运动参数
            'vehicleMotionParams': {
                name: '车辆运动参数',
                description: '设置车辆的基本运动参数，包括加速度、减速度等。',
                range: '根据车辆型号确定',
                unit: '根据参数确定',
                image: '../../assets/imges/parameter-images/vehicleMotionParams.png'
            },
            // web遥控器数据
            'webRemoteData': {
                name: 'web遥控器数据',
                description: '设置web遥控器的相关参数，控制远程操作的行为。',
                range: '根据系统确定',
                unit: '根据参数确定',
                image: '../../assets/imges/parameter-images/webRemoteData.png'
            },
            // 减速度
            'deceleration': {
                name: '减速度',
                description: '设置机器人的减速度，控制机器人减速的快慢。',
                range: '根据机器人型号确定',
                unit: '米/秒²',
                image: '../../assets/imges/parameter-images/deceleration.png'
            },
            // 停车提前补偿值
            'parkingCompensation': {
                name: '停车提前补偿值',
                description: '设置机器人停车时的提前补偿值，提高停车精度。',
                range: '根据机器人型号确定',
                unit: '米',
                image: '../../assets/imges/parameter-images/parkingCompensation.png'
            },
            // web遥控器数据
            'x1': {
                name: 'web遥控器数据 X1',
                description: 'web遥控器的X1轴输入值，控制机器人的前进后退。',
                range: '-100 - 100',
                unit: '百分比',
                image: '../../assets/imges/parameter-images/webRemoteData.png'
            },
            'y1': {
                name: 'web遥控器数据 Y1',
                description: 'web遥控器的Y1轴输入值，控制机器人的左右移动。',
                range: '-100 - 100',
                unit: '百分比',
                image: '../../assets/imges/parameter-images/webRemoteData.png'
            },
            'x2': {
                name: 'web遥控器数据 X2',
                description: 'web遥控器的X2轴输入值，控制机器人的旋转。',
                range: '-100 - 100',
                unit: '百分比',
                image: '../../assets/imges/parameter-images/webRemoteData.png'
            },
            'y2': {
                name: 'web遥控器数据 Y2',
                description: 'web遥控器的Y2轴输入值，控制机器人的附加功能。',
                range: '-100 - 100',
                unit: '百分比',
                image: '../../assets/imges/parameter-images/webRemoteData.png'
            },
            // 遥控/自动切换
            'remoteAutoSwitch': {
                name: '遥控/自动切换',
                description: '切换机器人的控制模式，0为遥控模式，1为自动模式。',
                range: '0 或 1',
                unit: '无',
                image: '../../assets/imges/parameter-images/remoteAutoSwitch.png'
            },
            // 初始推进器增益
            'initpropeller': {
                name: '初始推进器增益',
                description: '设置推进器的初始增益值，影响机器人启动时的推进力。',
                range: '0 - 1',
                unit: '无',
                image: '../../assets/imges/parameter-images/initpropeller.png'
            },
            // 推进器增益方向
            'dirpropeller': {
                name: '推进器增益方向',
                description: '设置推进器增益的方向，1为正向，-1为反向。',
                range: '-1 或 1',
                unit: '无',
                image: '../../assets/imges/parameter-images/dirpropeller.png'
            },
            // 左推进器开关
            'leftPropulsion': {
                name: '左推进器开关',
                description: '设置左推进器的比例，控制左侧推进器的输出功率。',
                range: '0 - 100',
                unit: '百分比',
                image: '../../assets/imges/parameter-images/leftPropulsion.png'
            },
            // 右推进器开关
            'rightPropulsion': {
                name: '右推进器开关',
                description: '设置右推进器的比例，控制右侧推进器的输出功率。',
                range: '0 - 100',
                unit: '百分比',
                image: '../../assets/imges/parameter-images/rightPropulsion.png'
            },
            // 极限角速度
            'iimtw': {
                name: '极限角速度',
                description: '设置机器人的最大转弯速度，限制机器人的旋转速度。',
                range: '根据机器人型号确定',
                unit: '弧度/秒',
                image: '../../assets/imges/parameter-images/iimtw.png'
            },
            // 经度
            'latitude': {
                name: '纬度',
                description: '设置地图原点的纬度坐标。',
                range: '-90 - 90',
                unit: '度',
                image: '../../assets/imges/parameter-images/latitude.png'
            },
            // 地图默认载入原点
            'mapOrigin': {
                name: '地图默认载入原点',
                description: '设置地图默认载入时的原点坐标，确定地图的初始位置。',
                range: '根据实际地图确定',
                unit: '米',
                image: '../../assets/imges/parameter-images/mapOrigin.png'
            },
            'longitude': {
                name: '地图默认载入原点-经度',
                description: '设置地图默认载入位置的经度坐标。',
                range: '-180 - 180',
                unit: '度',
                image: '../../assets/imges/parameter-images/mapOrigin.png'
            },
            // 转角弧度阈值
            'rotation': {
                name: '转角弧度阈值',
                description: '设置机器人转动的最小角度阈值，小于此值的转动将被忽略。',
                range: '0.2 - 0.5',
                unit: '弧度',
                image: '../../assets/imges/parameter-images/rotation.png'
            },
            // 采样间隔
            'getRobotMsgmsg': {
                name: '采样间隔',
                description: '设置机器人数据采集的间隔距离，控制数据采集的频率。',
                range: '0.1 - 10',
                unit: '米',
                image: '../../assets/imges/parameter-images/samplingInterval.png'
            },
            // 运行速度
            'carRunSpeed': {
                name: '运行速度',
                description: '设置机器人的正常运行速度。',
                range: '根据机器人型号确定',
                unit: '米/秒',
                image: '../../assets/imges/parameter-images/carRunSpeed.png'
            },
            // 预瞄距离
            'lookaheadDistance': {
                name: '预瞄距离',
                description: '设置机器人路径跟踪时的预瞄距离，影响路径跟踪的平滑度。',
                range: '0.1 - 10',
                unit: '米',
                image: '../../assets/imges/parameter-images/lookaheadDistance.png'
            },
            // 自转角速度系数
            'vvwk': {
                name: '自转角速度系数',
                description: '设置机器人自转时的角速度系数，0表示关闭自转功能。',
                range: '0 - 2',
                unit: '无',
                image: '../../assets/imges/parameter-images/vvwk.png'
            },
            // 运行模式
            'runmode': {
                name: '运行模式',
                description: '设置机器人的运行模式，0为停止，1为运行。',
                range: '0 或 1',
                unit: '无',
                image: '../../assets/imges/parameter-images/runmode.png'
            },
            // 履带开关
            'closetrack': {
                name: '履带开关',
                description: '控制机器人履带的开关状态，0为关闭，1为开启。',
                range: '0 或 1',
                unit: '无',
                image: '../../assets/imges/parameter-images/closetrack.png'
            },
            // 叉车升起轴距
            'forkliftRaisedWheelbase': {
                name: '叉车升起轴距',
                description: '设置叉车升起时的轴距距离。',
                range: '根据叉车型号确定',
                unit: '米',
                image: '../../assets/imges/parameter-images/forkliftRaisedWheelbase.png'
            },
            // 叉车落下轴距
            'forkliftLoweredWheelbase': {
                name: '叉车落下轴距',
                description: '设置叉车落下时的轴距距离。',
                range: '根据叉车型号确定',
                unit: '米',
                image: '../../assets/imges/parameter-images/forkliftLoweredWheelbase.png'
            },
            // 激光雷达扫描距离
            'lidarScanDistance': {
                name: '激光雷达扫描距离',
                description: '设置激光雷达的最大扫描距离，控制激光雷达的探测范围。',
                range: '根据激光雷达型号确定',
                unit: '米',
                image: '../../assets/imges/parameter-images/lidarScanDistance.png'
            },
            // 激光雷达外参
            'lidar-x': {
                name: '激光雷达外参-X',
                description: '激光雷达相对于机器人坐标系的X轴偏移量。',
                range: '-100 - 100',
                unit: '米',
                image: '../../assets/imges/parameter-images/lidarExtrinsics.png'
            },
            'lidar-y': {
                name: '激光雷达外参-Y',
                description: '激光雷达相对于机器人坐标系的Y轴偏移量。',
                range: '-100 - 100',
                unit: '米',
                image: '../../assets/imges/parameter-images/lidarExtrinsics.png'
            },
            'lidar-z': {
                name: '激光雷达外参-Z',
                description: '激光雷达相对于机器人坐标系的Z轴偏移量。',
                range: '-100 - 100',
                unit: '米',
                image: '../../assets/imges/parameter-images/lidarExtrinsics.png'
            },
            'lidar-yaw': {
                name: '激光雷达外参-Yaw',
                description: '激光雷达相对于机器人坐标系的偏航角。',
                range: '-180 - 180',
                unit: '度',
                image: '../../assets/imges/parameter-images/lidarExtrinsics.png'
            },
            'lidar-pitch': {
                name: '激光雷达外参-Pitch',
                description: '激光雷达相对于机器人坐标系的俯仰角。',
                range: '-90 - 90',
                unit: '度',
                image: '../../assets/imges/parameter-images/lidarExtrinsics.png'
            },
            'lidar-roll': {
                name: '激光雷达外参-Roll',
                description: '激光雷达相对于机器人坐标系的翻滚角。',
                range: '-180 - 180',
                unit: '度',
                image: '../../assets/imges/parameter-images/lidarExtrinsics.png'
            },
            // 比例系数
            'proportion': {
                name: '比例系数',
                description: '控制系统的比例系数，影响系统的响应速度和稳定性。',
                range: '根据系统确定',
                unit: '无',
                image: '../../assets/imges/parameter-images/proportion.png'
            },
            // xy目标点容差
            'xygoaltolerance': {
                name: 'xy目标点容差',
                description: '设置机器人到达目标点的XY平面容差范围。',
                range: '根据系统确定',
                unit: '米',
                image: '../../assets/imges/parameter-images/xygoaltolerance.png'
            },
            // xy中间点容差
            'xymiddletolerance': {
                name: 'xy中间点容差',
                description: '设置机器人经过中间点的XY平面容差范围。',
                range: '根据系统确定',
                unit: '米',
                image: '../../assets/imges/parameter-images/xymiddletolerance.png'
            },
            // yaw目标点容差
            'yawgoaltolerance': {
                name: 'yaw目标点容差',
                description: '设置机器人到达目标点的角度容差范围。',
                range: '根据系统确定',
                unit: '度',
                image: '../../assets/imges/parameter-images/yawgoaltolerance.png'
            },
            // 最大速度
            'maxSpeed': {
                name: '最大速度',
                description: '设置机器人的最大运行速度限制。',
                range: '根据机器人型号确定',
                unit: '米/秒',
                image: '../../assets/imges/parameter-images/maxSpeed.png'
            },
            // 最小速度
            'minSpeed': {
                name: '最小速度',
                description: '设置机器人的最小运行速度限制。',
                range: '根据机器人型号确定',
                unit: '米/秒',
                image: '../../assets/imges/parameter-images/minSpeed.png'
            },
            // 轮距
            'wheelBase': {
                name: '轮距',
                description: '设置机器人左右轮之间的距离。',
                range: '根据机器人型号确定',
                unit: '米',
                image: '../../assets/imges/parameter-images/wheelBase.png'
            },
            // 左转检测距离
            'leftObstacleDistance': {
                name: '左转检测距离',
                description: '设置机器人左转时检测障碍物的距离。',
                range: '根据系统确定',
                unit: '米',
                image: '../../assets/imges/parameter-images/leftObstacleDistance.png'
            },
            // 右转检测距离
            'rightObstacleDistance': {
                name: '右转检测距离',
                description: '设置机器人右转时检测障碍物的距离。',
                range: '根据系统确定',
                unit: '米',
                image: '../../assets/imges/parameter-images/rightObstacleDistance.png'
            },
            // 激光雷达外参
            'lidarExtrinsics': {
                name: '激光雷达外参',
                description: '设置激光雷达相对于机器人坐标系的外部参数，包括位置和姿态。',
                range: '根据激光雷达型号确定',
                unit: '米/度',
                image: '../../assets/imges/parameter-images/lidarExtrinsics.png'
            },
            // 辅助安全防护参数
            'safetyParameters': {
                name: '辅助安全防护参数',
                description: '设置机器人的辅助安全防护参数，提高机器人运行的安全性。',
                range: '根据系统确定',
                unit: '米',
                image: '../../assets/imges/parameter-images/safetyParameters.png'
            }
        };
    }

    /**
     * 显示参数信息
     * @param {string} paramId 参数ID
     */
    show(paramId) {
        // 确保模态框已经初始化
        if (!this.modal) {
            console.error('模态框未初始化');
            return;
        }

        const data = this.parameterData[paramId];
        if (!data) {
            console.warn(`未找到参数 ${paramId} 的信息`);
            return;
        }

        // 确保DOM元素存在
        const nameElement = document.getElementById('paramName');
        const descElement = document.getElementById('paramDescription');
        const rangeElement = document.getElementById('paramRange');
        const unitElement = document.getElementById('paramUnit');
        const imgElement = document.getElementById('paramImage');

        if (!nameElement || !descElement || !rangeElement || !unitElement || !imgElement) {
            console.error('模态框DOM元素未找到，尝试重新初始化');
            this.init(); // 尝试重新初始化
            
            // 重新获取元素
            const newNameElement = document.getElementById('paramName');
            const newDescElement = document.getElementById('paramDescription');
            const newRangeElement = document.getElementById('paramRange');
            const newUnitElement = document.getElementById('paramUnit');
            const newImgElement = document.getElementById('paramImage');
            
            if (!newNameElement || !newDescElement || !newRangeElement || !newUnitElement || !newImgElement) {
                console.error('重新初始化后仍然找不到DOM元素');
                return;
            }
            
            // 使用新获取的元素，并添加默认值处理
            newNameElement.textContent = data.name || paramId;
            newDescElement.textContent = data.description || '暂无描述';
            newRangeElement.textContent = data.range || '未定义';
            newUnitElement.textContent = data.unit || '未知';
            
            // 设置图片
            if (data.image) {
                newImgElement.src = data.image;
                newImgElement.onerror = function() {
                    // 如果图片加载失败，显示默认图片或隐藏图片
                    this.style.display = 'none';
                    const container = document.getElementById('paramImageContainer');
                    if (container) {
                        container.innerHTML = '<p class="text-muted">暂无图示</p>';
                    }
                };
            } else {
                newImgElement.style.display = 'none';
                const container = document.getElementById('paramImageContainer');
                if (container) {
                    container.innerHTML = '<p class="text-muted">暂无图示</p>';
                }
            }
        } else {
            // 使用原有元素，并添加默认值处理
            nameElement.textContent = data.name || paramId;
            descElement.textContent = data.description || '暂无描述';
            rangeElement.textContent = data.range || '未定义';
            unitElement.textContent = data.unit || '未知';
            
            // 设置图片
            if (data.image) {
                imgElement.src = data.image;
                imgElement.onerror = function() {
                    // 如果图片加载失败，显示默认图片或隐藏图片
                    this.style.display = 'none';
                    const container = document.getElementById('paramImageContainer');
                    if (container) {
                        container.innerHTML = '<p class="text-muted">暂无图示</p>';
                    }
                };
            } else {
                imgElement.style.display = 'none';
                const container = document.getElementById('paramImageContainer');
                if (container) {
                    container.innerHTML = '<p class="text-muted">暂无图示</p>';
                }
            }
        }
        
        // 显示弹出框
        this.modal.show();
    }
}

export default ParameterInfoModal;