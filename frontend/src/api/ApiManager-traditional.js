// 传统非模块化方式的ApiManager实现
// 方式1: 全局变量方式
(function(window) {
    // 首先确保axios已加载
    if (typeof axios === 'undefined') {
        console.error('axios未加载，请先加载axios.min.js');
        return;
    }

    // 创建axios实例
    const ApiManager = {
        client: null,
        TOKEN_EXPIRE_DURATION: 72000 * 1000, // 2小时
        TEMP_SKIP_LOGIN_KEY: "robot.tempSkipLogin",

        isTemporaryLoginBypassEnabled: function() {
            return localStorage.getItem(this.TEMP_SKIP_LOGIN_KEY) === "true";
        },
        
        init: function() {
            this.client = axios.create({
                baseURL: window.location.origin,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            this.setupInterceptors();
            return this.client;
        },
        
        setupInterceptors: function() {
            const self = this;
            
            // 请求拦截器
            this.client.interceptors.request.use(
                (config) => {
                    if (config.url === "user/login") {
                        return config;
                    }

                    // 家里临时测试模式：允许匿名调用接口，不触发登录页跳转。
                    if (self.isTemporaryLoginBypassEnabled()) {
                        return config;
                    }

                    const token = localStorage.getItem("token") || "";
                    const tokenCreateTime = localStorage.getItem("tokenCreateTime");

                    if (!token) {
                        window.parent.postMessage({ type: "TOKEN_MISSING", data: "/login.html" }, "*");
                        return Promise.reject(new Error("No token found"));
                    }

                    if (!tokenCreateTime || (Date.now() - Number(tokenCreateTime) > self.TOKEN_EXPIRE_DURATION)) {
                        localStorage.removeItem("token");
                        localStorage.removeItem("tokenCreateTime");
                        window.parent.postMessage({ type: "TOKEN_MISSING", data: "/login.html" }, "*");
                        return Promise.reject(new Error("Token expired (frontend check)"));
                    }

                    config.headers.Authorization = token;
                    return config;
                },
                (err) => {
                    return Promise.reject(err);
                }
            );

            // 响应拦截器
            this.client.interceptors.response.use(
                (res) => {
                    if ((res.data.code === 20001 || res.data.code === 20002)
                        && !self.isTemporaryLoginBypassEnabled()) {
                        localStorage.removeItem("token");
                        localStorage.removeItem("tokenCreateTime");
                        window.parent.postMessage({ type: "TOKEN_MISSING", data: "/login.html" }, "*");
                    }
                    return res;
                },
                (err) => {
                    return Promise.reject(err);
                }
            );
        },
        
        get: function(url, config) {
            return this.client.get(url, config);
        },
        
        post: function(url, data, config) {
            return this.client.post(url, data, config);
        },
        
        put: function(url, data, config) {
            return this.client.put(url, data, config);
        },
        
        delete: function(url, config) {
            return this.client.delete(url, config);
        }
    };
    
    // 将ApiManager挂载到全局对象
    window.ApiManager = ApiManager;
    
    // 自动初始化
    document.addEventListener('DOMContentLoaded', function() {
        ApiManager.init();
    });
    
})(window);

/*
使用方式：
1. 在HTML中先加载axios.min.js
2. 然后加载此文件
3. 在代码中直接使用：

   ApiManager.get('api/endpoint')
       .then(response => console.log(response.data))
       .catch(error => console.error(error));

   或者使用axiosClient变量（向后兼容）：
   const axiosClient = ApiManager.client;
*/

// 方式2: 传统函数封装方式（如果需要更简单的方式）
/*
(function(window) {
    if (typeof axios === 'undefined') {
        console.error('axios未加载');
        return;
    }
    
    const axiosClient = axios.create({
        baseURL: window.location.origin,
        headers: { 'Content-Type': 'application/json' }
    });
    
    // 设置拦截器...
    (拦截器代码同上)
    
    // 直接暴露到全局
    window.axiosClient = axiosClient;
    
})(window);

使用方式：直接使用全局变量 axiosClient
*/

// 方式3: UMD方式（兼容多种模块系统）
/*
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['axios'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('axios'));
    } else {
        root.ApiManager = factory(root.axios);
    }
}(typeof self !== 'undefined' ? self : this, function(axios) {
    // ApiManager实现代码
    return ApiManager;
}));
*/
