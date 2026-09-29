// 最简单的传统方式 - 直接暴露全局变量
// 适合快速开发和简单项目

(function() {
    // 检查axios是否已加载
    if (typeof axios === 'undefined') {
        console.error('错误：请先加载axios.min.js');
        return;
    }

    // 创建axios实例
    const axiosClient = axios.create({
        baseURL: window.location.origin,
        headers: {
            'Content-Type': 'application/json'
        }
    });

    // Token过期时长
    const TOKEN_EXPIRE_DURATION = 72000 * 1000; // 2小时
    const TEMP_SKIP_LOGIN_KEY = "robot.tempSkipLogin";

    function isTemporaryLoginBypassEnabled() {
        return localStorage.getItem(TEMP_SKIP_LOGIN_KEY) === "true";
    }

    // 请求拦截器
    axiosClient.interceptors.request.use(
        function(config) {
            if (config.url === "user/login") {
                return config;
            }

            // 家里临时测试模式：允许匿名调用接口，不触发登录页跳转。
            if (isTemporaryLoginBypassEnabled()) {
                return config;
            }

            const token = localStorage.getItem("token") || "";
            const tokenCreateTime = localStorage.getItem("tokenCreateTime");

            if (!token) {
                window.parent.postMessage({ type: "TOKEN_MISSING", data: "/login.html" }, "*");
                return Promise.reject(new Error("No token found"));
            }

            if (!tokenCreateTime || (Date.now() - Number(tokenCreateTime) > TOKEN_EXPIRE_DURATION)) {
                localStorage.removeItem("token");
                localStorage.removeItem("tokenCreateTime");
                window.parent.postMessage({ type: "TOKEN_MISSING", data: "/login.html" }, "*");
                return Promise.reject(new Error("Token expired (frontend check)"));
            }

            config.headers.Authorization = token;
            return config;
        },
        function(error) {
            return Promise.reject(error);
        }
    );

    // 响应拦截器
    axiosClient.interceptors.response.use(
        function(response) {
            if ((response.data.code === 20001 || response.data.code === 20002)
                && !isTemporaryLoginBypassEnabled()) {
                localStorage.removeItem("token");
                localStorage.removeItem("tokenCreateTime");
                window.parent.postMessage({ type: "TOKEN_MISSING", data: "/login.html" }, "*");
            }
            return response;
        },
        function(error) {
            return Promise.reject(error);
        }
    );

    // 暴露到全局
    window.axiosClient = axiosClient;
    
    // 为了更好的代码组织，也可以暴露一个API对象
    window.API = {
        get: function(url, config) {
            return axiosClient.get(url, config);
        },
        post: function(url, data, config) {
            return axiosClient.post(url, data, config);
        },
        put: function(url, data, config) {
            return axiosClient.put(url, data, config);
        },
        delete: function(url, config) {
            return axiosClient.delete(url, config);
        },
        // 原始axios实例
        client: axiosClient
    };

    console.log('API客户端已初始化');
})();

/*
使用说明：

1. HTML文件中的加载顺序：
   <script src="../libs/axios.min.js"></script>
   <script src="./api/api-simple.js"></script>
   <script src="你的业务代码.js"></script>

2. 使用方式：
   
   // 方式1：直接使用axiosClient（与原模块化方式完全兼容）
   axiosClient.get('api/user/info')
       .then(response => console.log(response.data))
       .catch(error => console.error(error));
   
   // 方式2：使用API对象（更清晰的语义）
   API.get('api/user/info')
       .then(response => console.log(response.data))
       .catch(error => console.error(error));
   
   // 方式3：使用Promise语法
   API.post('api/user/create', { name: '张三', age: 25 })
       .then(function(response) {
           console.log('创建成功:', response.data);
       })
       .catch(function(error) {
           console.error('创建失败:', error);
       });
   
   // 方式4：使用async/await语法
   async function getUserInfo() {
       try {
           const response = await API.get('api/user/info');
           return response.data;
       } catch (error) {
           console.error('获取用户信息失败:', error);
           throw error;
       }
   }

3. 优势：
   - 极简实现，易于理解和维护
   - 完全兼容现有代码
   - 无需修改业务逻辑
   - 支持所有现代浏览器
   - 便于分离开发和调试

4. 迁移成本：
   - 只需修改HTML中的script标签
   - 业务代码无需任何改动
   - 保持原有的axiosClient变量名
*/
