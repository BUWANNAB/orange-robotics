class RosManager {
  constructor() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname;
    const configuredUrl = window.localStorage.getItem('rosbridgeUrl');
    let rosbridge_url;

    if (configuredUrl && /^wss?:\/\//i.test(configuredUrl)) {
      rosbridge_url = configuredUrl;
    } else if (hostname.includes('-web')) {
      rosbridge_url = `${protocol}//${hostname.replace('-web', '-rosbridge')}`;
    } else {
      const url = new URL(window.location.href);
      url.protocol = protocol;
      url.port = '9090';
      url.pathname = '/';
      url.search = '';
      url.hash = '';
      rosbridge_url = url.href;
    }

    this.ros = new ROSLIB.Ros({
      url: rosbridge_url,
    });
    this.connect();
    this.initTopics();
    this.initMsg();
  }

  connect() {
    this.ros.on("connection", () => {
      console.log("连接成功");
    });

    this.ros.on("error", (error) => {
      console.error("连接失败:", error);
    });

    this.ros.on("close", () => {
      console.log("连接关闭");
    });
  }

  initTopics() {
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
      messageType: "std_msgs/msg/UInt8",
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

        // 创建话题发布器
       this.chatterTopic = new ROSLIB.Topic({
        ros: this.ros,
            name: '/chatter',
            messageType: 'std_msgs/msg/String' // ROS2 消息类型格式
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
 
        this.pointStampedTopic = new ROSLIB.Topic({
             ros: this.ros,
            name: '/clicked_point', // 可自定义话题名
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
  }
  initMsg() {
    this.CAR_RUN_MSG = new ROSLIB.Message({
      data: 1,
    });
    this.CAR_STOP_MSG = new ROSLIB.Message({
      data: 0,
    });

  }

  // 新增：发布包含单个数字的数组
  publishNumberArray(number) {
      const message = new ROSLIB.Message({
          data: [number] // 将数字包装成数组
      });
      
      this.numberArrayPub.publish(message);
      console.log(`Published number array: [${number}]`);
  }
  // 新增：发布路线ID
  publishRouteId(routeId) {
    const message = new ROSLIB.Message({
      data: routeId
    });
    this.routeIdPub.publish(message);
  }
  publishRemoteSwitch(number) {
    const message = new ROSLIB.Message({
      data: number
    });
    this.remoteSwitch.publish(message);
  }


  subscribeGeneralTopic(topicName, callback, messageType) {
    const topic = new ROSLIB.Topic({
      ros: this.ros,
      name: topicName,
      messageType: messageType
      // messageType: "std_msgs/String",
    });
    topic.subscribe(callback);
  }
  publishGeneralTopic(topicName, messageType, message) {
    const topic = new ROSLIB.Topic({
      ros: this.ros,
      name: topicName,
      messageType: messageType
    })
    topic.publish(message);
  }
  subscribeToTopic(topicName, callback) {
    const topic = new ROSLIB.Topic({
      ros: this.ros,
      name: topicName,
      messageType: "std_msgs/String",
    });
    topic.subscribe(callback);
  }
  publishContorlTopic(topicName, message) {
    let topic;
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

  // 获取ROS2所有话题
  fetchAllTopics(successCallback, errorCallback) {
    this.ros.getTopics(
      (result) => {
        // 保存所有话题名称
        this.allROSTopics = result.topics;
        successCallback(result.topics);
      },
      (error) => {
        console.error('获取话题列表失败:', error);
        errorCallback(error);
      }
    );
  }

  // 获取话题类型
  getTopicType(topicName, successCallback, errorCallback) {
    this.ros.getTopicType(topicName, 
      (type) => {
        successCallback(type);
      },
      (error) => {
        console.error(`获取话题 ${topicName} 类型失败:`, error);
        errorCallback(error);
      }
    );
  }
}

export default RosManager;
