
// WebSocket工具：闭包单例 + 事件订阅/发布模式，适配多页面应用
const webSocketUtil = (() => {
    // 多实例存储：key为URL，value为WebSocket实例
    const instances = {};
    
    // 事件订阅者映射表：eventName => [callback1, callback2, ...]
    const subscribers = {
        open: [],
        error: [],
        close: [],
        message: {}, // 按action分组：action => [callback1, callback2, ...]
        rawMessage: [] // 未解析的原始消息订阅
    };
    
    /**
     * 触发事件
     * @param {string} eventType 事件类型
     * @param {any} data 事件数据
     * @param {string} action 可选的消息action
     */
    const triggerEvent = (eventType, data, action = null) => {
        if (eventType === 'message') {
            // 按action触发特定消息事件
            if (action && subscribers.message[action]) {
                subscribers.message[action].forEach(callback => {
                    try {
                        callback(data);
                    } catch (error) {
                        console.error(`[WebSocket] 事件回调执行错误 (${action}):`, error);
                    }
                });
            }
            // 触发订阅所有消息的事件
            if (subscribers.message['*']) {
                subscribers.message['*'].forEach(callback => {
                    try {
                        callback(data);
                    } catch (error) {
                        console.error(`[WebSocket] 事件回调执行错误 (message/*):`, error);
                    }
                });
            }
        } else if (subscribers[eventType]) {
            // 触发通用事件
            subscribers[eventType].forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`[WebSocket] 事件回调执行错误 (${eventType}):`, error);
                }
            });
        }
    };
    
    // WebSocket核心类
    class WebSocketCore {
        constructor(url) {
            this.url = url;
            this.websocket = null;
            this.heartbeatInterval = null;
            this.heartbeatTimeout = null;
            this.isReconnecting = false;
            this.errorStatus = 0;
            this.reconnectAttempts = 0;
            this.maxReconnectAttempts = 20;
            this.connectionId = Date.now() + Math.random();
            this.initWebSocket();
        }
    
        // 新增：彻底清理连接和定时器（复用逻辑）
        clearResources() {
            // 清理定时器
            clearInterval(this.heartbeatInterval);
            clearTimeout(this.heartbeatTimeout);
            this.heartbeatInterval = null;
            this.heartbeatTimeout = null;
    
            // 清理旧连接（移除事件监听，避免回调触发）
            if (this.websocket) {
                this.websocket.onopen = null;
                this.websocket.onerror = null;
                this.websocket.onmessage = null;
                this.websocket.onclose = null;
                // 仅当连接未关闭时主动关闭
                if ([WebSocket.OPEN, WebSocket.CONNECTING].includes(this.websocket.readyState)) {
                    this.websocket.close(1000, "resource cleanup");
                }
                this.websocket = null;
            }
        }
    
        initWebSocket() {
            // 初始化前先清理旧资源（关键：避免旧连接/定时器残留）
            this.clearResources();
    
            try {
                this.websocket = new WebSocket(this.url);
                this.bindEvents();
            } catch (error) {
                console.error(`[WebSocket ${this.connectionId}] 创建连接失败:`, error);
                this.isReconnecting = false; // 释放锁
                this.reconnect(); // 创建失败直接触发重连
            }
        }
    
        send(data) {
            if (this.websocket?.readyState === WebSocket.OPEN) {
                try {
                    this.websocket.send(data);
                } catch (error) {
                    console.error(`[WebSocket ${this.connectionId}] 发送消息失败:`, error);
                }
            } else {
                console.error(`[WebSocket ${this.connectionId}] 连接未打开（状态: ${this.websocket?.readyState}），无法发送消息`);
            }
        }
    
        // 添加subscribe方法，转发到全局subscribe函数
        subscribe(eventType, action, callback) {
            return subscribe(eventType, action, callback);
        }
    
        // 添加unsubscribe方法，转发到全局unsubscribe函数
        unsubscribe(eventType, action, callback) {
            return unsubscribe(eventType, action, callback);
        }
    
        bindEvents() {
            this.websocket.onopen = () => {
                this.reconnectAttempts = 0;
                this.isReconnecting = false; // 重连成功后释放锁
                this.startHeartbeat();
                this.resetHeartbeatTimeout();
                
                // 使用setTimeout确保事件循环中的状态更新完成
                // 避免在状态更新完成前触发事件，导致竞态条件
                setTimeout(() => {
                    // 再次确认连接状态为OPEN
                    if (this.websocket?.readyState === WebSocket.OPEN) {
                        // 触发全局open事件
                        triggerEvent('open', this);
                    }
                }, 0);
            };

            this.websocket.onerror = (error) => {
                console.error(`[WebSocket ${this.connectionId}] 连接错误:`, error);
                
                // 触发全局error事件
                triggerEvent('error', error);
            };

            this.websocket.onmessage = async (event) => {
                try {
                    // 更新最后消息时间
                    this.lastMessageTime = Date.now();
                    
                    // 检查event.data是否存在
                    if (!event.data) {
                        this.resetHeartbeatTimeout(); // 收到空消息也重置心跳
                        return;
                    }
                    
                    // 检查是否为undefined字符串
                    if (event.data === "undefined") {
                        this.resetHeartbeatTimeout(); // 收到undefined消息也重置心跳
                        return;
                    }

                    // 触发原始消息事件
                    triggerEvent('rawMessage', event);
                    
                    // 无论消息内容是什么，只要能收到就重置心跳超时
                    this.resetHeartbeatTimeout();
                    
                    // 检查是否为JSON格式的消息
                    let data;
                    if (typeof event.data === 'string' && event.data.trim().startsWith('{')) {
                        // 只有以'{'开头的字符串才尝试解析为JSON
                        data = JSON.parse(event.data);
                        
                        // 处理心跳响应（避免被其他逻辑阻塞）
                        if (data.action === 'heartbeatResponse') {
                            return; // 心跳响应无需后续处理
                        }

                        // 触发按action分类的消息事件
                        triggerEvent('message', data, data.action);
                        
                        // 保留原有业务逻辑
                        let needPoint = 0;
                        let already = 0;
                        let latitudeCurrent;
                        let longitudeCurrent;
                        let STANT;
                        let localX;
                        let localY;
                        let HEAD;
                        let Heading;

                        if (data.action === "PATHPOINT") {
                            needPoint = data.pointnum;
                            already = data.pointsendnum;
                        }
                    
                        if (data.action === "feedback") {
                            let outcome = data.outcome;
                            let request = data.request;
                            let status = data.status;
                            
                            if (status == 1) {
                                cocoMessage.success(`${request}${outcome}`);
                                let params = {
                                    routeMsg: "",
                                    carRun: `${request}${outcome}`,
                                    carStop: "",
                                    workCancel: ""
                                };
                                this.errorStatus = 0;
                             
                            } else if (status == 0) {
                                let params = {
                                    routeMsg: "",
                                    carRun: "",
                                    carStop: `${request}${outcome}`,
                                    workCancel: ""
                                };
                                if (this.errorStatus == 0) {
                                    this.errorStatus = 1;
                                }
                            }
                        }

                        if (data.action == "carCurrentPosition") {
                            latitudeCurrent = data.position.Lat;
                            longitudeCurrent = data.position.Lon;
                            STANT = data.position.STANT;
                            HEAD = data.position.HEAD;
                            Heading = data.position.Heading;
                            localX = data.position.LocalX;
                            localY = data.position.LocalY;
                            
                            const positionData = {
                                timestamp: Date.now(),
                                latitudeCurrent: latitudeCurrent,
                                longitudeCurrent: longitudeCurrent,
                                STANT: STANT,
                                HEAD: HEAD,
                                Heading: typeof Heading == "number" ? Heading.toFixed(3) : Heading,
                                localX: localX,
                                localY: localY,
                                localization: data.localization || {valid:false, source:"unknown"},
                                orientationW: data.position.W,
                                orientationX: data.position.X,
                                orientationY: data.position.Y,
                                orientationZ: data.position.Z
                            };
                            localStorage.setItem('positionData', JSON.stringify(positionData));
                        }

                        if (data.action === 'systemFeedback') {
                            if (data.Info?.locStant === 0) {
                              
                            } else if (data.Info?.locStant === 1) {
                                cocoMessage.error("定位解算错误");
                            }
                            
                            if (data.Info?.headStant === 0) {
                                // 航向正常
                            } else if (data.Info?.headStant === 1) {
                                cocoMessage.error("航向解算错误");
                            }
                            
                            if (data.Info?.Power === 0) {
                                // 电量正常
                            } else if (data.Info?.Power === 1) {
                                cocoMessage.error("机器电量低");
                            }
                        }
                    }
                } catch (error) {
                    console.error(`[WebSocket ${this.connectionId}] 消息处理失败:`, error);
                    console.error("原始消息:", event.data, "类型:", typeof event.data);
                }
            };

            this.websocket.onclose = (event) => {
                this.clearResources(); // 关闭后清理资源
                
                // 触发全局close事件
                triggerEvent('close', event);

                // 精准判定：仅异常关闭（排除主动/正常关闭码）且不在重连中，才触发重连
                const normalCloseCodes = [1000, 1001, 1005]; // 正常关闭、客户端离开、无状态码
                
                // 更宽松的异常判断：如果不是正常关闭码，或者不是干净关闭，都视为异常
                // 但要排除1005（无状态码）和1006（连接异常关闭）的特殊情况
                let isAbnormal = false;
                if (!normalCloseCodes.includes(event.code)) {
                    // 如果不是正常关闭码，视为异常
                    isAbnormal = true;
                } else if (!event.wasClean && event.code !== 1005) {
                    // 如果是正常关闭码但不是干净关闭，且不是无状态码，视为异常
                    isAbnormal = true;
                }
                
                if (isAbnormal && !this.isReconnecting) {
                    this.reconnect();
                }
            };
        }

        startHeartbeat() {
            this.heartbeatInterval = setInterval(() => {
                // 发送心跳前检查连接状态（避免给关闭中的连接发消息）
                if (this.websocket?.readyState !== WebSocket.OPEN) {
                    return;
                }
                this.send(JSON.stringify({ action: 'heartbeat' }));
            }, 5000);
        }

        resetHeartbeatTimeout() {
            clearTimeout(this.heartbeatTimeout);
            this.heartbeatTimeout = setTimeout(() => {
                // 增加额外检查，避免不必要的重连
                // 1. 检查连接状态
                if (this.websocket?.readyState !== WebSocket.OPEN) {
                    return;
                }
                
                // 2. 检查是否正在接收消息（通过检查最近是否有消息处理）
                const now = Date.now();
                const lastMessageTime = this.lastMessageTime || now;
                const timeSinceLastMessage = now - lastMessageTime;
                
                // 如果最近10秒内有消息（考虑到网络延迟），则不重连
                if (timeSinceLastMessage < 10000) {
                    this.resetHeartbeatTimeout(); // 重置心跳定时器
                    return;
                }
                
                this.reconnect();
            }, 12000); // 增加超时时间到12秒，减少误判
        }

        // 主动关闭（标记为正常关闭，避免重连）
        close() {
            this.clearResources(); // 主动关闭也清理资源
            // 从实例映射中移除当前实例
            const instanceUrl = this.url;
            if (instances[instanceUrl] === this) {
                delete instances[instanceUrl];
            }
        }

        reconnect() {
            // 双重校验：重连中/达到最大次数，直接返回
            if (this.isReconnecting) {
                return;
            }
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                console.error(`[WebSocket ${this.connectionId}] 重连次数达上限(${this.maxReconnectAttempts})，停止`);
                this.isReconnecting = false;
                return;
            }

            this.isReconnecting = true;
            this.reconnectAttempts++;

            // 退避策略：重连延迟递增（1s→2s→4s…最多10s），避免高频重连
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 10000);

            setTimeout(() => {
                try {
                    this.initWebSocket(); // 重连时走init（内部已清理旧连接）
                } catch (error) {
                    console.error(`[WebSocket ${this.connectionId}] 重连执行失败:`, error);
                } finally {
                    // 无论init成功/失败，都释放锁（避免死锁）
                    this.isReconnecting = false;
                }
            }, delay);
        }
    }
    
    /**
     * 订阅事件
     * @param {string} eventType 事件类型 (open, error, close, message, rawMessage)
     * @param {string} action 可选，消息的action类型（仅用于message事件）
     * @param {Function} callback 回调函数
     * @returns {Object} 包含unsubscribe方法的对象
     */
    const subscribe = (eventType, action, callback) => {
        // 处理参数重载：(eventType, callback) 或 (eventType, action, callback)
        if (typeof action === 'function') {
            callback = action;
            action = null;
        }
        
        if (eventType === 'message') {
            if (action) {
                // 订阅特定action的消息
                if (!subscribers.message[action]) {
                    subscribers.message[action] = [];
                }
                subscribers.message[action].push(callback);
            } else {
                // 订阅所有message事件
                if (!subscribers.message['*']) {
                    subscribers.message['*'] = [];
                }
                subscribers.message['*'].push(callback);
            }
        } else if (subscribers[eventType]) {
            // 订阅通用事件
            subscribers[eventType].push(callback);
        } else {
            console.error(`[WebSocket] 未知的事件类型: ${eventType}`);
        }
        
        // 返回取消订阅的方法
        return {
            unsubscribe: () => {
                if (eventType === 'message') {
                    if (action) {
                        // 取消订阅特定action的消息
                        if (subscribers.message[action]) {
                            subscribers.message[action] = subscribers.message[action].filter(cb => cb !== callback);
                        }
                    } else {
                        // 取消订阅所有message事件
                        if (subscribers.message['*']) {
                            subscribers.message['*'] = subscribers.message['*'].filter(cb => cb !== callback);
                        }
                    }
                } else if (subscribers[eventType]) {
                    // 取消订阅通用事件
                    subscribers[eventType] = subscribers[eventType].filter(cb => cb !== callback);
                }
            }
        };
    };
    
    /**
     * 取消订阅事件
     * @param {string} eventType 事件类型
     * @param {string} action 可选，消息的action类型
     * @param {Function} callback 回调函数
     */
    const unsubscribe = (eventType, action, callback) => {
        if (typeof action === 'function') {
            callback = action;
            action = null;
        }
        
        if (eventType === 'message' && action) {
            if (subscribers.message[action]) {
                subscribers.message[action] = subscribers.message[action].filter(cb => cb !== callback);
            }
        } else if (subscribers[eventType]) {
            subscribers[eventType] = subscribers[eventType].filter(cb => cb !== callback);
        }
    };
    
    /**
     * 发送消息（便捷方法） - 已废弃，建议使用 getInstance(url).send(message) 代替
     * @param {string|Object} message 要发送的消息
     * @returns {boolean} 是否发送成功
     */
    const send = (message) => {
        return false;
    };

    // 对外暴露的API
    return {
        /**
         * 获取WebSocket实例（单例模式）
         * @param {string} url WebSocket连接地址
         * @returns {WebSocketCore} WebSocket实例
         */
        getInstance(url) {
            if (!url) {
                console.error('[WebSocket] getInstance方法必须提供URL参数');
                return null;
            }
            
            if (instances[url]) {
                // 如果实例已存在，检查连接状态
                const instance = instances[url];
                const readyState = instance.websocket?.readyState;
                
                // 如果连接正常或正在连接中，直接返回现有实例
                if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) {
                    return instance;
                }
                
                // 如果连接已关闭或发生错误，清理旧实例
                try {
                    instance.clearResources();
                } catch (error) {
                    console.error(`[WebSocket] 清理旧实例资源失败:`, error);
                }
            }
            
            // 创建新实例
            const newInstance = new WebSocketCore(url);
            instances[url] = newInstance;
            return newInstance;
        },
        
        /**
         * 销毁WebSocket实例
         * @param {string} url 可选，要销毁的WebSocket URL，不提供则销毁所有实例
         */
        destroyInstance(url) {
            if (url) {
                // 销毁指定URL的实例
                if (instances[url]) {
                    instances[url].close();
                    delete instances[url];
                }
            } else {
                // 销毁所有实例
                Object.values(instances).forEach(instance => {
                    instance.close();
                });
                // 清空实例存储
                Object.keys(instances).forEach(key => delete instances[key]);
                // 清空所有订阅者
                Object.keys(subscribers).forEach(key => {
                    if (Array.isArray(subscribers[key])) {
                        subscribers[key] = [];
                    } else if (typeof subscribers[key] === 'object') {
                        subscribers[key] = {};
                    }
                });
            }
        },
        
        // 事件订阅/发布
        subscribe,
        unsubscribe,
        
        // 便捷方法
        send,
        
        /**
         * 获取连接状态
         * @param {string} url WebSocket连接地址
         * @returns {number|null} WebSocket连接状态
         */
        getReadyState(url) {
            if (!url) {
                console.error('[WebSocket] getReadyState方法必须提供URL参数');
                return null;
            }
            return instances[url]?.websocket?.readyState ?? null;
        }
    };
})();

export default webSocketUtil;