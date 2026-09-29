import "../libs/axios.min.js";
// 创建axios实例
const axiosClient = axios.create({
  baseURL: window.location.origin,
 //: "http://192.168.1.254:8088",
//baseURL: "http://192.168.1.254:8088",
  headers: {
    'Content-Type': 'application/json'
  }
});

// 设定token过期时长（单位：毫秒，这里设为2小时，可自定义）
const TOKEN_EXPIRE_DURATION = 72000* 1000; // 7200秒 = 2小时
const TEMP_SKIP_LOGIN_KEY = "robot.tempSkipLogin";

function isTemporaryLoginBypassEnabled() {
  return localStorage.getItem(TEMP_SKIP_LOGIN_KEY) === "true";
}


// 请求拦截器（新增过期时间检查）
axiosClient.interceptors.request.use(
  (config) => {
    // 登录和注册接口不需要检查token
    if (config.url === "user/login" || config.url === "user/register") {
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
  (err) => {
    return Promise.reject(err);
  }
);


// 响应拦截器（保留原有服务器过期处理）
axiosClient.interceptors.response.use(
  (res) => {
    if ((res.data.code === 20001 || res.data.code === 20002) && !isTemporaryLoginBypassEnabled()) {
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


export default axiosClient;
