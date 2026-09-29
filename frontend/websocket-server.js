const WebSocket = require('ws');

// 创建 WebSocket 服务器，监听 8089 端口
const wss = new WebSocket.Server({ port: 8089 });

console.log('WebSocket 服务器已启动，监听端口 8089');

// 存储所有连接的客户端
const clients = new Set();

// 当有新的 WebSocket 连接时
wss.on('connection', (ws, req) => {
  const url = req.url;
  console.log(`新的连接: ${url}`);
  
  // 只处理 /ws/test2 路径的连接
//   if (url !== '/ws/robotPosition') {
//     console.log(`拒绝连接: 不支持的路径 ${url}`);
//     ws.close(1008, '不支持的路径');
//     return;
//   }
  
  // 将新连接的客户端添加到集合中
  clients.add(ws);
  
  // 当收到客户端消息时
  ws.on('message', (message) => {
    console.log('=== 客户端发送的数据 ===');
    console.log(`原始数据: ${message}`);
    
    try {
      const data = JSON.parse(message);
      console.log('解析后的JSON数据:');
      console.log(JSON.stringify(data, null, 2)); // 格式化输出JSON数据
      
      // 打印数据类型和大小
      console.log(`数据类型: ${typeof data}`);
      console.log(`数据大小: ${message.length} 字节`);
      
      // 如果是对象，打印其键值
      if (typeof data === 'object' && data !== null) {
        console.log('对象包含的键:');
        Object.keys(data).forEach(key => {
          console.log(`  - ${key}: ${typeof data[key]}`);
        });
      }
      
      console.log('========================');
      
      // 响应心跳请求
      if (data.action === 'heartbeat') {
        ws.send(JSON.stringify({ action: 'heartbeatResponse' }));
        console.log('发送心跳响应');
      }
    } catch (error) {
      console.error('解析消息失败:', error);
      console.log('原始消息内容:', message);
    }
  });
  
  // 当连接关闭时
  ws.on('close', () => {
    console.log('连接已关闭');
    clients.delete(ws);
  });
  
  // 当发生错误时
  ws.on('error', (error) => {
    console.error(`WebSocket 错误: ${error.message}`);
    clients.delete(ws);
  });
});

// 初始化经纬度变量
let lat = 22.54321;
let lon = 114.12345;

// 定时发送车辆位置数据
setInterval(() => {
  // 自增经纬度
  lat += 0.000001;
  lon += 0.000001;
  
  // 生成随机位置数据
  const positionData = {
    action: "carCurrentPosition",
    position: {
      Lat: lat,
      Lon: lon,
      High: 80.5 + (Math.random() - 0.5) * 0.1,
      X: 1.0 + (Math.random() - 0.5) * 0.1,
      Y: 2.0 + (Math.random() - 0.5) * 0.1,
      Z: 3.0 + (Math.random() - 0.5) * 0.1,
      W: 0.9 + (Math.random() - 0.5) * 0.1,
      Heading: 30.0 + (Math.random() - 0.5) * 10,
      LocalX: 2.5 + (Math.random() - 0.5) * 1,
      LocalY: 3.5 + (Math.random() - 0.5) * 1,
      STANT: 100.5 + (Math.random() - 0.5) * 10,
      HEAD: 0.5 + (Math.random() - 0.5) * 0.2,
      runStatus: Math.random() > 0.5 ? 1 : 0
    }
  };
  
  const message = JSON.stringify(positionData);
  
  // 向所有连接的客户端发送消息
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}, 1000); // 每秒发送一次

console.log('服务器正在每秒发送车辆位置数据...');