/**
 * ROS管理器 - 传统JavaScript版本
 * 不使用ES6模块导入导出
 */

// 全局ROS管理器对象
var RosManager = {
    ros: null,
    
    // 话题对象
    ndtPoseSub: null,
    gpsSub: null,
    ndtReliability: null,
    carRunFinsh: null,
    mapLoader: null,
    moveBaseGoalPub: null,
    pathPointPub: null,
    pathPointPub1: null,
    pathPointPub2: null,
    avoidanceSwitch: null,
    opstacleAvoidance: null,
    gnss_fix: null,
    vehicle_pose: null,
    gnssPointPub: null,
    initialPosePub: null,
    planTopic: null,
    carRunStarPub: null,
    carWaringPub: null,
    closeRoutePub: null,
    shutdownTopicPub: null,
    updateTopicPub: null,
    rosTestSub: null,
    rosModelSub: null,
    circlePositionsTopic: null,
    numberArrayPub: null,
    chatterTopic: null,
    pathTopic: null,
    numberTopic: null,
    publishModel: null,
    pointStampedTopic: null,
    goalPoseTopic: null,
    upDateRouteMsg: null,
    terminate_complete: null,
    terminate: null,
    remoteSwitch: null,
    routeIdPub: null,
    gnss_pose: null,
    slam_status: null,
    pathSaveRoute: null,
    mapCoverage: null,
    routeName: null,
    
    // 消息对象
    CAR_RUN_MSG: null,
    CAR_STOP_MSG: null,

    
    /**
     * 初始化ROS管理器
     */
    init: function() {
        var protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        var hostname = window.location.hostname;
        var configuredUrl = window.localStorage.getItem('rosbridgeUrl');
        var rosbridge_url;
        
        if (configuredUrl && /^wss?:\/\//i.test(configuredUrl)) {
            rosbridge_url = configuredUrl;
        } else if (hostname.includes('-web')) {
            var rosbridgeHostname = hostname.replace('-web', '-rosbridge');
            rosbridge_url = protocol + '//' + rosbridgeHostname;
        } else {
            rosbridge_url = protocol + '//' + hostname + ":9090";
        }

        console.log("ROS Bridge地址:", rosbridge_url);
        
        this.ros = new ROSLIB.Ros({
                url: rosbridge_url,
        });
        this.connect();
        this.initTopics();
        this.initMsg();
    },
    
    /**
     * 连接ROS
     */
    connect: function() {
        var self = this;
        
        this.ros.on("connection", function() {
            console.log("连接成功");
        });

        this.ros.on("error", function(error) {
            console.error("连接失败:", error);
        });

        this.ros.on("close", function() {
            console.log("连接关闭");
        });
    },
    
    /**
     * 初始化所有话题
     */
    initTopics: function() {
        this.ndtPoseSub = new ROSLIB.Topic({
            ros: this.ros,
            name: "/ndt_pose",
            messageType: "geometry_msgs/msg/PoseStamped",
        });

        this.gpsSub = new ROSLIB.Topic({
            ros: this.ros,
            name: "/carCurrentPosition",
            messageType: "std_msgs/msg/Float64MultiArray",
        });
        //slam和rtk状态
         this.gnss_pose = new ROSLIB.Topic({
            ros: this.ros,
            name: "/gnss_pos_type_raw",
            messageType: "std_msgs/msg/Float64MultiArray",
        });
        this.slam_status = new ROSLIB.Topic({
            ros: this.ros,
            name: "/slam_status",
            messageType: "std_msgs/msg/Float32MultiArray",
        });

        this.ndtReliability = new ROSLIB.Topic({
            ros: this.ros,
            name: "/ndt_reliability",
            messageType: "std_msgs/msg/Float32",
        });

        this.carRunFinsh = new ROSLIB.Topic({
            ros: this.ros,
            name: "car_Run_Finish",
            messageType: "std_msgs/msg/UInt8",
        });
        
        this.opstacleAvoidance = new ROSLIB.Topic({
            ros: this.ros,
            name: "obstacle_avoidance",
            messageType: "std_msgs/msg/UInt8",
        });

        this.mapLoader = new ROSLIB.Topic({
            ros: this.ros,
            name: "pmap_stat",
            messageType: "std_msgs/msg/Bool",
        });

        this.moveBaseGoalPub = new ROSLIB.Topic({
            ros: this.ros,
            name: "move_base_simple/goal",
            messageType: "geometry_msgs/msg/PoseStamped",
        });

        this.pathPointPub = new ROSLIB.Topic({
            ros: this.ros,
            name: "path_point",
            messageType: "std_msgs/msg/Float64MultiArray",
        });
        this.pathPointPub1 = new ROSLIB.Topic({
            ros: this.ros,
            name: "path_point_left",
            messageType: "std_msgs/msg/Float64MultiArray",
        });
        this.pathPointPub2 = new ROSLIB.Topic({
            ros: this.ros,
            name: "path_point_right",
            messageType: "std_msgs/msg/Float64MultiArray",
        });
        this.avoidanceSwitch = new ROSLIB.Topic({
            ros: this.ros,
            name: "Obstacle_avoidance_switch",
            messageType: "std_msgs/msg/UInt8",
        });
        
        this.gnss_fix = new ROSLIB.Topic({
            ros: this.ros,
            name: "gnss_fix",
            messageType: "sensor_msgs/msg/NavSatFix",
        });
        
        //经纬度。四元数，x，y
        this.vehicle_pose = new ROSLIB.Topic({
            ros: this.ros,
            name: "vehicle_pose",
            messageType: "geometry_msgs/msg/PoseStamped",
        });
        
        //经纬度
        this.gnssPointPub = new ROSLIB.Topic({
            ros: this.ros,
            name: "gnsspoint",
            messageType: "std_msgs/msg/Float64MultiArray",
        });

        this.initialPosePub = new ROSLIB.Topic({
            ros: this.ros,
            name: "initialpose",
            messageType: "geometry_msgs/msg/PoseWithCovarianceStamped",
        });

        this.planTopic = new ROSLIB.Topic({
            ros: this.ros,
            name: '/pcl_pose',
            messageType: "geometry_msgs/msg/PoseWithCovarianceStamped",
        });

        this.carRunStarPub = new ROSLIB.Topic({
            ros: this.ros,
            name: "/vehicle_run_star",
            messageType: "std_msgs/msg/UInt32",
        });

        this.carWaringPub = new ROSLIB.Topic({
            ros: this.ros,
            name: "car_waring",
            messageType: "std_msgs/msg/UInt32",
        });

        this.closeRoutePub = new ROSLIB.Topic({
            ros: this.ros,
            name: "close_route",
            messageType: "std_msgs/msg/UInt8",
        });
        
        this.carRunFinsh = new ROSLIB.Topic({
            ros: this.ros,
            name: "car_Run_Finish",
            messageType: "std_msgs/msg/UInt8",
        });
        
        this.shutdownTopicPub = new ROSLIB.Topic({
            ros: this.ros,
            name: "shutdown_topic",
            messageType: "std_msgs/msg/UInt8",
        });
        
        this.updateTopicPub = new ROSLIB.Topic({
            ros: this.ros,
            name: "update_topic",
            messageType: "std_msgs/msg/UInt8",
        });
        
        this.rosTestSub = new ROSLIB.Topic({
            ros: this.ros,
            name: "rossub",
            messageType: "std_msgs/msg/String",
        });

        this.rosModelSub = new ROSLIB.Topic({
            ros: this.ros,
            name: "RemoteCtrlAutomaticSwitch",
            messageType: "std_msgs/msg/UInt8",
        });
        
        // 新增的话题
        this.circlePositionsTopic = new ROSLIB.Topic({
            ros: this.ros,
            name: "WebRemoteCtrlData",
            messageType: "std_msgs/msg/Float32MultiArray"
        });

        // 新增：选择路线发布话题
        this.numberArrayPub = new ROSLIB.Topic({
            ros: this.ros,
            name: '/routesource',
            messageType: 'std_msgs/msg/Float32MultiArray'
        });
        this.routeIdPub = new ROSLIB.Topic({
            ros: this.ros,
            name: 'route_id',
            messageType: "std_msgs/msg/UInt32",
        });
        this.remoteSwitch = new ROSLIB.Topic({
            ros: this.ros,
            name: 'remote_switch',
            messageType: "std_msgs/msg/UInt32",
        });

        //室内的话题
        // 创建话题发布器
        this.chatterTopic = new ROSLIB.Topic({
            ros: this.ros,
            name: '/chatter',
            messageType: 'std_msgs/msg/String'
        });
        //全规划路线名
        this.mapCoverage = new ROSLIB.Topic({
            ros: this.ros,
            name: '/mapCoverage',
            messageType: 'std_msgs/msg/String'
        });
        //全规划地图名
        this.routeName = new ROSLIB.Topic({
            ros: this.ros,
            name: '/routeName',
            messageType: 'std_msgs/msg/String'
        });

        // 新增：路线发布器
        this.pathTopic = new ROSLIB.Topic({
            ros: this.ros,
            name: '/planned_path',
            messageType: 'nav_msgs/msg/Path'
        });

        // 新增：数字发布器（Int32类型）
        this.numberTopic = new ROSLIB.Topic({
            ros: this.ros,
            name: '/test_number',
            messageType: 'std_msgs/msg/Int32'
        });

        // 新增：数字发布器（Int32类型）
        this.publishModel = new ROSLIB.Topic({
            ros: this.ros,
            name: '/plan_start',
            messageType: 'std_msgs/msg/Int32'
        });

        this.pathSaveRoute = new ROSLIB.Topic({
            ros: this.ros,
            name: '/path_save',
            messageType: 'std_msgs/msg/Int32'
        });


        

        this.pointStampedTopic = new ROSLIB.Topic({
            ros: this.ros,
            name: '/clicked_point',
            messageType: 'geometry_msgs/msg/PointStamped'
        });
        
        this.goalPoseTopic = new ROSLIB.Topic({
            ros: this.ros,
            name: '/goal_pose',
            messageType: 'geometry_msgs/msg/PoseStamped'
        });
        
        // 订阅 /plan 话题
        this.planTopic = new ROSLIB.Topic({
            ros: this.ros,
            name: '/pcl_pose',
            messageType: 'geometry_msgs/msg/PoseWithCovarianceStamped'
        });

        this.upDateRouteMsg = new ROSLIB.Topic({
            ros: this.ros,
            name: '/update_route',
            messageType: "std_msgs/msg/Int8",
        });

        this.terminate_complete = new ROSLIB.Topic({
            ros: this.ros,
            name: '/terminate_complete',
            messageType: "std_msgs/msg/Int32",
        });
        
        this.terminate = new ROSLIB.Topic({
            ros: this.ros,
            name: '/terminate',
            messageType: "std_msgs/msg/Int32",
        });
    },
    
    /**
     * 初始化消息
     */
    initMsg: function() {
        this.CAR_RUN_MSG = new ROSLIB.Message({
            data: 1,
        });
        
        this.CAR_STOP_MSG = new ROSLIB.Message({
            data: 0,
        });
    },
    
    /**
     * 新增：发布包含单个数字的数组
     */
    publishNumberArray: function(number) {
        var message = new ROSLIB.Message({
            data: [number] // 将数字包装成数组
        });
        
        this.numberArrayPub.publish(message);
        console.log('Published number array: [' + number + ']');
    },
    
    // 新增：发布路线ID
    publishRouteId: function(routeId) {
        var message = new ROSLIB.Message({
            data: routeId
        });
        this.routeIdPub.publish(message);
    },
    
    // 新增：发布远程开关
    publishRemoteSwitch: function(number) {
        var message = new ROSLIB.Message({
            data: number
        });
        this.remoteSwitch.publish(message);
    },
    
    /**
     * 订阅通用话题
     */
    subscribeGeneralTopic: function(topicName, callback, messageType) {
        var topic = new ROSLIB.Topic({
            ros: this.ros,
            name: topicName,
            messageType: messageType
        });
        topic.subscribe(callback);
    },
    
    /**
     * 发布到通用话题
     */
    publishGeneralTopic: function(topicName, messageType, message) {
        var topic = new ROSLIB.Topic({
            ros: this.ros,
            name: topicName,
            messageType: messageType
        });
        topic.publish(message);
    },
    
    /**
     * 订阅话题
     */
    subscribeToTopic: function(topicName, callback) {
        var topic = new ROSLIB.Topic({
            ros: this.ros,
            name: topicName,
            messageType: "std_msgs/String",
        });
        topic.subscribe(callback);
    },
    
    /**
     * 发布控制话题
     */
    publishContorlTopic: function(topicName, message) {
        var topic;
        if (topicName === 'WebRemoteCtrlData') {
            if (!this.circlePositionsTopic) {
                this.circlePositionsTopic = new ROSLIB.Topic({
                    ros: this.ros,
                    name: 'WebRemoteCtrlData',
                    messageType: 'std_msgs/Float32MultiArray'
                });
            }
            topic = this.circlePositionsTopic;
        } else {
            topic = new ROSLIB.Topic({
                ros: this.ros,
                name: topicName,
                messageType: "std_msgs/String",
            });
        }
        topic.publish(message);
    }
};

// 自动初始化（可选）
// 如果页面加载时自动初始化，取消注释下面这行
// RosManager.init();

// 或者提供手动初始化函数
function initRosManager() {
    RosManager.init();
}
