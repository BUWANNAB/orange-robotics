/**
 * 地图加载动画管理器
 * 用于在地图加载过程中显示加载动画
 */

class MapLoadingManager {
    constructor() {
        this.loadingOverlay = null;
        this.isLoading = false;
        this.loadingText = '地图加载中...';
        this.theme = 'dark'; // dark 或 light
        this.checkTimer = null; // 用于存储检查定时器ID
        this.hideTimer = null; // 用于存储隐藏定时器ID
        this.maxCheckAttempts = 50; // 最大检查次数，防止无限循环
        this.checkAttempts = 0; // 当前检查次数
        this.init();
    }

    /**
     * 初始化加载动画管理器
     */
    init() {
        this.createLoadingOverlay();
        this.bindEvents();
    }

    /**
     * 创建加载动画覆盖层
     */
    createLoadingOverlay() {
        // 检查是否已存在
        if (document.getElementById('mapLoadingOverlay')) {
            this.loadingOverlay = document.getElementById('mapLoadingOverlay');
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'mapLoadingOverlay';
        overlay.className = `map-loading-overlay ${this.theme}-theme`;
        overlay.style.display = 'none';
        
        overlay.innerHTML = `
            <div class="map-loading-spinner"></div>
            <div class="map-loading-text">${this.loadingText}</div>
            <div class="map-loading-progress">
                <div class="map-loading-progress-bar"></div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        this.loadingOverlay = overlay;
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        // 监听页面显示/隐藏事件
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.hide();
            }
        });

        // 监听页面卸载事件
        window.addEventListener('beforeunload', () => {
            this.clearAllTimers(); // 清除所有定时器
            this.hide();
        });
    }

    /**
     * 清除所有定时器
     */
    clearAllTimers() {
        if (this.checkTimer) {
            clearTimeout(this.checkTimer);
            this.checkTimer = null;
        }
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
    }

    /**
     * 显示加载动画
     * @param {string} text - 加载文本
     * @param {string} theme - 主题 ('dark' 或 'light')
     */
    show(text = null, theme = null) {
        if (this.isLoading) return;
        
        this.isLoading = true;
        
        // 更新加载文本
        if (text) {
            this.loadingText = text;
            const textElement = this.loadingOverlay.querySelector('.map-loading-text');
            if (textElement) {
                textElement.textContent = text;
            }
        }
        
        // 更新主题
        if (theme) {
            this.theme = theme;
            this.loadingOverlay.className = `map-loading-overlay ${this.theme}-theme`;
        }
        
        // 显示加载动画
        this.loadingOverlay.style.display = 'flex';
        this.loadingOverlay.classList.remove('fade-out');
        
        // 防止页面滚动
        document.body.style.overflow = 'hidden';
    }

    /**
     * 隐藏加载动画
     * @param {number} delay - 延迟隐藏时间（毫秒）
     */
    hide(delay = 0) {
        if (!this.isLoading) return;
        
        this.isLoading = false;
        this.checkAttempts = 0; // 重置检查次数
        
        // 清除之前的隐藏定时器
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
        
        if (delay > 0) {
            this.hideTimer = setTimeout(() => {
                this.hideInternal();
            }, delay);
        } else {
            this.hideInternal();
        }
    }

    /**
     * 内部隐藏方法
     */
    hideInternal() {
        // 添加淡出效果
        this.loadingOverlay.classList.add('fade-out');
        
        // 恢复页面滚动
        document.body.style.overflow = '';
        
        // 动画完成后隐藏
        setTimeout(() => {
            this.loadingOverlay.style.display = 'none';
            this.loadingOverlay.classList.remove('fade-out');
        }, 500);
    }

    /**
     * 更新加载文本
     * @param {string} text - 新的加载文本
     */
    updateText(text) {
        this.loadingText = text;
        const textElement = this.loadingOverlay.querySelector('.map-loading-text');
        if (textElement) {
            textElement.textContent = text;
        }
    }

    /**
     * 设置主题
     * @param {string} theme - 主题 ('dark' 或 'light')
     */
    setTheme(theme) {
        this.theme = theme;
        this.loadingOverlay.className = `map-loading-overlay ${this.theme}-theme`;
    }
    /**
     * 检查是否正在加载
     * @returns {boolean}
     */
    isLoadingState() {
        return this.isLoading;
    }

    /**
     * 优化的检查地图加载方法
     * @param {function} checkCallback - 检查地图是否加载完成的回调函数
     * @param {number} checkInterval - 检查间隔（毫秒），默认为200
     * @param {number} initialDelay - 初始延迟（毫秒），默认为500
     */
    checkMapLoaded(checkCallback, checkInterval = 200, initialDelay = 500) {
        // 清除之前的检查定时器
        if (this.checkTimer) {
            clearTimeout(this.checkTimer);
            this.checkTimer = null;
        }
        
        // 重置检查次数
        this.checkAttempts = 0;
        
        // 延迟开始检查
        this.checkTimer = setTimeout(() => {
            const checkStatus = () => {
                this.checkAttempts++;
                
                // 检查是否超过最大尝试次数
                if (this.checkAttempts > this.maxCheckAttempts) {
                    console.warn('地图加载检查超时，强制隐藏加载动画');
                    this.hide(0);
                    return;
                }
                
                // 执行检查回调
                const isLoaded = checkCallback();
                
                if (isLoaded) {
                    // 地图加载完成，隐藏加载动画
                    this.hide(0); // 移除不必要的延迟
                } else {
                    // 继续检查
                    this.checkTimer = setTimeout(checkStatus, checkInterval);
                }
            };
            
            checkStatus();
        }, initialDelay);
    }
}

// 创建全局实例
const mapLoadingManager = new MapLoadingManager();

// 提供全局访问接口
window.mapLoadingManager = mapLoadingManager;

// 页面加载完成后自动初始化
document.addEventListener('DOMContentLoaded', function() {
    // 检测当前页面是否需要地图加载动画
    const needsMapLoading = window.location.pathname.includes('leftmap.html') || 
                           window.location.pathname.includes('area_traversal_mode.html');
    
    if (needsMapLoading) {
        // 自动显示加载动画
        mapLoadingManager.show('地图加载中...', 'dark');
        
        // 监听地图加载完成事件
        window.addEventListener('load', function() {
            // 减少延迟时间，优化用户体验
            setTimeout(() => {
                mapLoadingManager.hide(0);
            }, 100); // 从200ms减少到100ms
        });
    }
});

// 导出模块（如果支持模块系统）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MapLoadingManager;
}

// 如果支持AMD
if (typeof define === 'function' && define.amd) {
    define([], function() {
        return MapLoadingManager;
    });
}