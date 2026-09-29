
    let ros = null;
    let subscribedTopics = [];
    let publishedTopics = [];
    
    const connectBtn = document.getElementById('connectBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const connectionStatus = document.getElementById('connectionStatus');
    const rosUrlInput = document.getElementById('rosUrl');
    const fetchAllTopicsBtn = document.getElementById('fetchAllTopicsBtn');
    const allTopicsDiv = document.getElementById('allTopics');
    const subscribedTopicsDiv = document.getElementById('subscribedTopics');
    const publishedTopicsDiv = document.getElementById('publishedTopics');
    const messageLogDiv = document.getElementById('messageLog');

    const rosProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const configuredRosUrl = window.localStorage.getItem('rosbridgeUrl');
    rosUrlInput.value = configuredRosUrl && /^wss?:\/\//i.test(configuredRosUrl)
      ? configuredRosUrl
      : `${rosProtocol}//${window.location.hostname}:9090`;
    
    // 连接ROS2
    function connectToROS() {
      const url = rosUrlInput.value.trim();
      if (!url) {
        addMessage('请输入有效的ROS2 WebSocket URL', 'error');
        return;
      }
      
      // 如果已经连接，先断开
      if (ros) {
        ros.close();
      }
      
      // 创建新的ROS连接
      ros = new ROSLIB.Ros({
        url: url
      });
      
      // 设置连接事件监听器
      ros.on('connection', () => {
        updateConnectionStatus(true);
        addMessage('已连接到ROS2', 'success');
        disconnectBtn.disabled = false;
        connectBtn.disabled = true;
      });
      
      ros.on('error', (error) => {
        addMessage('连接ROS2出错: ' + error, 'error');
      });
      
      ros.on('close', () => {
        updateConnectionStatus(false);
        addMessage('与ROS2的连接已关闭', 'info');
        disconnectBtn.disabled = true;
        connectBtn.disabled = false;
      });
    }
    
    // 断开ROS2连接
    function disconnectFromROS() {
      if (ros) {
        ros.close();
        ros = null;
        // 清空话题列表
        subscribedTopics = [];
        publishedTopics = [];
        updateTopicsList();
      }
    }
    
    // 更新连接状态显示
    function updateConnectionStatus(isConnected) {
      if (isConnected) {
        connectionStatus.textContent = '已连接到ROS2';
        connectionStatus.className = 'status connected';
      } else {
        connectionStatus.textContent = '未连接';
        connectionStatus.className = 'status disconnected';
      }
    }
    
    // 添加消息到日志
    function addMessage(message, type = 'info') {
      const timestamp = new Date().toLocaleTimeString();
      const messageElement = document.createElement('div');
      messageElement.innerHTML = `<span style="color: #666;">[${timestamp}]</span> ${message}`;
      
      // 根据消息类型设置颜色
      if (type === 'error') {
        messageElement.style.color = 'red';
      } else if (type === 'success') {
        messageElement.style.color = 'green';
      }
      
      messageLogDiv.appendChild(messageElement);
      messageLogDiv.scrollTop = messageLogDiv.scrollHeight; // 滚动到底部
    }
    
    // 获取所有话题列表
    function fetchAllTopics() {
      if (!ros || !ros.isConnected) {
        addMessage('请先连接到ROS2', 'error');
        return;
      }
      
      addMessage('正在获取所有话题列表...', 'info');
      
      // 使用rosapi服务获取所有话题
      const topicsClient = new ROSLIB.Service({
        ros: ros,
        name: '/rosapi/topics',
        serviceType: 'rosapi/Topics'
      });
      
      const request = new ROSLIB.ServiceRequest({});
      
      topicsClient.callService(request, function(result) {
        addMessage(`成功获取 ${result.topics.length} 个话题`, 'success');
        displayAllTopics(result.topics);
      }, function(error) {
        addMessage('获取话题列表失败: ' + error, 'error');
      });
    }
    
    // 显示所有话题
    function displayAllTopics(topics) {
      allTopicsDiv.innerHTML = '';
      
      if (topics.length === 0) {
        allTopicsDiv.innerHTML = '<div class="topic-item">没有可用的话题</div>';
        return;
      }
      
      // 添加批量操作按钮
      const batchControls = document.createElement('div');
      batchControls.className = 'topic-item batch-controls';
      batchControls.innerHTML = `
        <div>
          <button onclick="subscribeSelectedTopics()">订阅选中话题</button>
          <button onclick="selectAllTopics()">全选</button>
          <button onclick="deselectAllTopics()">取消全选</button>
          <button onclick="recordSelectedTopics()">录制选定话题</button>
        </div>
      `;
      allTopicsDiv.appendChild(batchControls);
      
      // 创建话题容器，使用flex布局
      const topicsContainer = document.createElement('div');
      topicsContainer.className = 'topics-container';
      
      // 创建话题列表
      topics.forEach(topicName => {
        const topicElement = document.createElement('div');
        topicElement.className = 'topic-item';
        
        // 检查是否已经订阅了该话题
        const isSubscribed = subscribedTopics.some(t => t.name === topicName);
        
        topicElement.innerHTML = `
          <div class="topic-content">
            <div class="topic-checkbox">
              <input type="checkbox" id="topic-${topicName.replace(/\//g, '_')}" value="${topicName}" ${isSubscribed ? 'disabled' : ''}>
            </div>
            <div class="topic-name">
              <label for="topic-${topicName.replace(/\//g, '_')}">${topicName}</label>
            </div>
            <div class="topic-actions">
              <button onclick="getTopicTypeAndSubscribe('${topicName}')" ${isSubscribed ? 'disabled' : ''}>
                ${isSubscribed ? '已订阅' : '订阅'}
              </button>
              <button onclick="getTopicTypeAndShow('${topicName}')">查看类型</button>
            </div>
          </div>
        `;
        
        topicsContainer.appendChild(topicElement);
      });
      
      allTopicsDiv.appendChild(topicsContainer);
    }
    
    // 获取话题类型并订阅
    function getTopicTypeAndSubscribe(topicName) {
      getTopicType(topicName, function(messageType) {
        subscribeTopic(topicName, messageType);
      });
    }
    
    // 获取话题类型并显示
    function getTopicTypeAndShow(topicName) {
      getTopicType(topicName, function(messageType) {
        addMessage(`话题 ${topicName} 的类型是: ${messageType}`, 'info');
      });
    }
    
    // 获取话题类型
    function getTopicType(topicName, callback) {
      if (!ros || !ros.isConnected) {
        addMessage('请先连接到ROS2', 'error');
        return;
      }
      
      // 使用rosapi服务获取话题类型
      const topicTypeClient = new ROSLIB.Service({
        ros: ros,
        name: '/rosapi/topic_type',
        serviceType: 'rosapi/TopicType'
      });
      
      const request = new ROSLIB.ServiceRequest({
        topic: topicName
      });
      
      topicTypeClient.callService(request, function(result) {
        if (callback) callback(result.type);
      }, function(error) {
        addMessage(`获取话题 ${topicName} 类型失败: ` + error, 'error');
        if (callback) callback('std_msgs/String'); // 默认类型
      });
    }
    
    // 订阅选中的话题
    function subscribeSelectedTopics() {
      const checkboxes = allTopicsDiv.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)');
      if (checkboxes.length === 0) {
        addMessage('请选择要订阅的话题', 'warning');
        return;
      }
      
      addMessage(`正在订阅 ${checkboxes.length} 个选中话题...`, 'info');
      
      let processed = 0;
      checkboxes.forEach(checkbox => {
        const topicName = checkbox.value;
        getTopicType(topicName, function(messageType) {
          subscribeTopic(topicName, messageType);
          processed++;
          if (processed === checkboxes.length) {
            addMessage(`已完成订阅 ${processed} 个话题`, 'success');
          }
        });
      });
    }
    
    // 全选所有话题
    function selectAllTopics() {
      const checkboxes = allTopicsDiv.querySelectorAll('input[type="checkbox"]:not(:disabled)');
      checkboxes.forEach(checkbox => {
        checkbox.checked = true;
      });
    }
    
    // 取消全选所有话题
    function deselectAllTopics() {
      const checkboxes = allTopicsDiv.querySelectorAll('input[type="checkbox"]:not(:disabled)');
      checkboxes.forEach(checkbox => {
        checkbox.checked = false;
      });
    }
    
    // 录制选定话题
    function recordSelectedTopics() {
      const checkboxes = allTopicsDiv.querySelectorAll('input[type="checkbox"]:checked');
      if (checkboxes.length === 0) {
        addMessage('请选择要录制的话题', 'warning');
        return;
      }
      
      addMessage('开始录制选定话题...', 'info');
      
      // 打印所有选定的话题名
      let topicNames = [];
      checkboxes.forEach(checkbox => {
        topicNames.push(checkbox.value);
      });
      
      console.log('选定的话题列表:', topicNames);
      addMessage(`已选择 ${topicNames.length} 个话题进行录制: ${topicNames.join(', ')}`, 'success');
    }
    function updateTopicsList() {
      // 更新订阅的话题列表
      subscribedTopicsDiv.innerHTML = '';
      if (subscribedTopics.length === 0) {
        subscribedTopicsDiv.innerHTML = '<div class="topic-item">没有订阅的话题</div>';
      } else {
        subscribedTopics.forEach(topic => {
          const topicElement = document.createElement('div');
          topicElement.className = 'topic-item';
          topicElement.innerHTML = `
            <strong>${topic.name}</strong> (${topic.messageType})
            <button onclick="unsubscribeTopic('${topic.name}')">取消订阅</button>
          `;
          subscribedTopicsDiv.appendChild(topicElement);
        });
      }
      
      // 更新发布的话题列表
      publishedTopicsDiv.innerHTML = '';
      if (publishedTopics.length === 0) {
        publishedTopicsDiv.innerHTML = '<div class="topic-item">没有发布的话题</div>';
      } else {
        publishedTopics.forEach(topic => {
          const topicElement = document.createElement('div');
          topicElement.className = 'topic-item';
          topicElement.innerHTML = `
            <strong>${topic.name}</strong> (${topic.messageType})
            <button onclick="stopPublishingTopic('${topic.name}')">停止发布</button>
          `;
          publishedTopicsDiv.appendChild(topicElement);
        });
      }
    }
    
    // 订阅话题
    function subscribeTopic(topicName, messageType) {
      if (!ros || !ros.isConnected) {
        addMessage('请先连接到ROS2', 'error');
        return;
      }
      
      // 检查是否已经订阅了该话题
      if (subscribedTopics.some(t => t.name === topicName)) {
        addMessage('已经订阅了话题: ' + topicName, 'warning');
        return;
      }
      
      const topic = new ROSLIB.Topic({
        ros: ros,
        name: topicName,
        messageType: messageType
      });
      
      topic.subscribe((message) => {
        addMessage(`收到消息 [${topicName}]: ${JSON.stringify(message)}`, 'info');
      });
      
      subscribedTopics.push({
        name: topicName,
        messageType: messageType,
        topic: topic
      });
      
      addMessage(`已订阅话题: ${topicName} (${messageType})`, 'success');
      updateTopicsList();
      
      // 更新所有话题列表的显示，以反映订阅状态变化
      if (allTopicsDiv.children.length > 0) {
        // 获取当前所有话题
        const topicsClient = new ROSLIB.Service({
          ros: ros,
          name: '/rosapi/topics',
          serviceType: 'rosapi/Topics'
        });
        
        const request = new ROSLIB.ServiceRequest({});
        
        topicsClient.callService(request, function(result) {
          displayAllTopics(result.topics);
        }, function(error) {
          // 如果获取失败，至少刷新当前显示的话题
          const currentTopics = Array.from(allTopicsDiv.children).map(child => {
            const topicNameElement = child.querySelector('strong');
            return topicNameElement ? topicNameElement.textContent : null;
          }).filter(name => name);
          
          displayAllTopics(currentTopics);
        });
      }
    }
    
    // 取消订阅话题
    function unsubscribeTopic(topicName) {
      const index = subscribedTopics.findIndex(t => t.name === topicName);
      if (index !== -1) {
        subscribedTopics[index].topic.unsubscribe();
        subscribedTopics.splice(index, 1);
        addMessage(`已取消订阅话题: ${topicName}`, 'info');
        updateTopicsList();
        
        // 更新所有话题列表的显示，以反映订阅状态变化
        if (allTopicsDiv.children.length > 0) {
          // 获取当前所有话题
          const topicsClient = new ROSLIB.Service({
            ros: ros,
            name: '/rosapi/topics',
            serviceType: 'rosapi/Topics'
          });
          
          const request = new ROSLIB.ServiceRequest({});
          
          topicsClient.callService(request, function(result) {
            displayAllTopics(result.topics);
          }, function(error) {
            // 如果获取失败，至少刷新当前显示的话题
            const currentTopics = Array.from(allTopicsDiv.children).map(child => {
              const topicNameElement = child.querySelector('strong');
              return topicNameElement ? topicNameElement.textContent : null;
            }).filter(name => name);
            
            displayAllTopics(currentTopics);
          });
        }
      }
    }
    
    // 发布话题
    function publishTopic(topicName, messageType, message) {
      if (!ros || !ros.isConnected) {
        addMessage('请先连接到ROS2', 'error');
        return;
      }
      
      // 检查是否已经在发布该话题
      let topicObj = publishedTopics.find(t => t.name === topicName);
      
      if (!topicObj) {
        const topic = new ROSLIB.Topic({
          ros: ros,
          name: topicName,
          messageType: messageType
        });
        
        topicObj = {
          name: topicName,
          messageType: messageType,
          topic: topic
        };
        
        publishedTopics.push(topicObj);
        updateTopicsList();
      }
      
      const rosMessage = new ROSLIB.Message(message);
      topicObj.topic.publish(rosMessage);
      addMessage(`已发布消息到 [${topicName}]: ${JSON.stringify(message)}`, 'success');
    }
    
    // 停止发布话题
    function stopPublishingTopic(topicName) {
      const index = publishedTopics.findIndex(t => t.name === topicName);
      if (index !== -1) {
        publishedTopics.splice(index, 1);
        addMessage(`已停止发布话题: ${topicName}`, 'info');
        updateTopicsList();
      }
    }
    
    // 事件监听器
    connectBtn.addEventListener('click', connectToROS);
    disconnectBtn.addEventListener('click', disconnectFromROS);
    fetchAllTopicsBtn.addEventListener('click', fetchAllTopics);
    
    // 初始化页面
    disconnectBtn.disabled = true;
    updateTopicsList();
    
    // 示例：连接后自动订阅一些常用话题
    function setupDefaultTopics() {
      if (ros && ros.isConnected) {
        // 自动获取所有话题列表
        setTimeout(fetchAllTopics, 1000); // 延迟1秒执行，确保连接稳定
      }
    }
    
    // 监听连接状态变化，连接成功后设置默认话题
    const originalOnConnection = ROSLIB.Ros.prototype.on;
    ROSLIB.Ros.prototype.on = function(type, callback) {
      if (type === 'connection') {
        const originalCallback = callback;
        callback = function() {
          originalCallback.apply(this, arguments);
          setupDefaultTopics();
        };
      }
      return originalOnConnection.call(this, type, callback);
    };
