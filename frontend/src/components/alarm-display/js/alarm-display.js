/**
 * 报警信息展示组件
 * 功能：显示和管理系统报警信息，支持按时间、级别筛选
 */

class AlarmDisplay {
    constructor() {
        this.alarms = [];
        this.filteredAlarms = [];
        this.currentPage = 1;
        this.itemsPerPage = 20;
        this.selectedAlarm = null;
        
        // DOM元素缓存
        this.elements = {};
        
        // 初始化组件
        this.init();
    }

    /**
     * 初始化组件
     */
    async init() {
        this.cacheElements();
        this.bindEvents();
        this.setDefaultTimeFilter();
        await this.loadAlarms();
        this.startAutoRefresh();
        
        // 初始化时更新侧边栏小气泡
        this.updateSidebarBadge();
    }

    /**
     * 缓存DOM元素
     */
    cacheElements() {
        this.elements = {
            alarmList: document.getElementById('alarmList'),
            emptyState: document.getElementById('emptyState'),
            errorCount: document.getElementById('errorCount'),
            warningCount: document.getElementById('warningCount'),
            infoCount: document.getElementById('infoCount'),
            totalCount: document.getElementById('totalCount'),
            levelFilter: document.getElementById('levelFilter'),
            startTimeFilter: document.getElementById('startTimeFilter'),
            endTimeFilter: document.getElementById('endTimeFilter'),
            applyFilters: document.getElementById('applyFilters'),
            refreshAlarms: document.getElementById('refreshAlarms'),
            clearAllAlarms: document.getElementById('clearAllAlarms'),
            alarmDetailModal: document.getElementById('alarmDetailModal'),
            alarmDetailContent: document.getElementById('alarmDetailContent'),
            acknowledgeAlarm: document.getElementById('acknowledgeAlarm')
        };
    }

    /**
     * 绑定事件监听器
     */
    bindEvents() {
        // 筛选器事件
        this.elements.applyFilters.addEventListener('click', () => this.applyFilters());
        this.elements.refreshAlarms.addEventListener('click', () => this.refreshAlarms());
        this.elements.clearAllAlarms.addEventListener('click', () => this.clearAllAlarms());

        // 模态框事件
        this.elements.acknowledgeAlarm.addEventListener('click', () => this.acknowledgeSelectedAlarm());
        
        // 键盘事件
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeModal();
            }
        });

        // 实时筛选
        this.elements.levelFilter.addEventListener('change', () => this.debounce(this.applyFilters, 300)());
        this.elements.startTimeFilter.addEventListener('change', () => this.debounce(this.applyFilters, 300)());
        this.elements.endTimeFilter.addEventListener('change', () => this.debounce(this.applyFilters, 300)());
    }

    /**
     * 设置默认时间筛选器
     */
    setDefaultTimeFilter() {
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        
        this.elements.startTimeFilter.value = this.formatDateTimeLocal(yesterday);
        this.elements.endTimeFilter.value = this.formatDateTimeLocal(now);
    }

    /**
     * 格式化日期时间为本地输入格式
     */
    formatDateTimeLocal(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    /**
     * 防抖函数
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * 加载报警数据
     */
    async loadAlarms() {
        try {
            this.showLoading(true);
            
            // 模拟API调用 - 实际使用时替换为真实API
            // const response = await axiosClient.get('/api/alarms');
            // this.alarms = response.data;
            
            // 模拟数据
            this.alarms = this.generateMockAlarms();
            
            this.applyFilters();
            this.updateStatistics();
            this.renderAlarms();
            
        } catch (error) {
            console.error('加载报警数据失败:', error);
            this.showError('加载报警数据失败，请稍后重试');
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * 生成模拟报警数据
     */
    generateMockAlarms() {
        const mockAlarms = [];
        const levels = ['error', 'warning', 'info'];
        const sources = ['机器人系统', '传感器', '导航系统', '电池管理', '通信模块', '安全系统'];
        const messages = {
            error: [
                '机器人导航失败，无法定位当前位置',
                '传感器数据异常，激光雷达信号丢失',
                '电池电量过低，需要立即充电',
                '通信中断，与主控系统失去连接',
                '安全系统触发，紧急停止激活'
            ],
            warning: [
                '电池电量低于20%，建议及时充电',
                '传感器检测到障碍物，路径规划调整中',
                '通信信号弱，数据传输延迟增加',
                '机器人速度过快，建议降低移动速度',
                '环境温度过高，可能影响设备性能'
            ],
            info: [
                '任务执行完成，返回充电站',
                '地图更新成功，新增障碍物标记',
                '系统自检完成，所有模块运行正常',
                '开始执行巡逻任务，路径规划成功',
                '充电完成，电池状态良好'
            ]
        };

        // 生成过去24小时的报警数据
        for (let i = 0; i < 50; i++) {
            const level = levels[Math.floor(Math.random() * levels.length)];
            const source = sources[Math.floor(Math.random() * sources.length)];
            const messageList = messages[level];
            const message = messageList[Math.floor(Math.random() * messageList.length)];
            
            // 随机生成过去24小时内的时间
            const randomTime = new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000);
            
            mockAlarms.push({
                id: `alarm_${Date.now()}_${i}`,
                level: level,
                title: `${source} - ${level === 'error' ? '错误' : level === 'warning' ? '警告' : '信息'}`,
                description: message,
                source: source,
                timestamp: randomTime,
                acknowledged: Math.random() > 0.7, // 30%的报警已确认
                details: {
                    errorCode: `ERR_${Math.floor(Math.random() * 1000)}`,
                    location: `区域${Math.floor(Math.random() * 10) + 1}`,
                    deviceId: `ROBOT_${Math.floor(Math.random() * 5) + 1}`,
                    severity: level === 'error' ? '高' : level === 'warning' ? '中' : '低',
                    suggestedAction: this.getSuggestedAction(level, source)
                }
            });
        }

        // 按时间倒序排列
        return mockAlarms.sort((a, b) => b.timestamp - a.timestamp);
    }

    /**
     * 获取建议操作
     */
    getSuggestedAction(level, source) {
        const actions = {
            error: {
                '机器人系统': '立即检查机器人状态，重启系统',
                '传感器': '检查传感器连接，清洁传感器表面',
                '导航系统': '重新校准导航参数，检查地图数据',
                '电池管理': '立即充电，检查电池健康状况',
                '通信模块': '检查网络连接，重启通信模块',
                '安全系统': '检查安全系统状态，确认无安全隐患'
            },
            warning: {
                '机器人系统': '监控系统状态，准备维护计划',
                '传感器': '定期检查传感器，准备清洁维护',
                '导航系统': '监控导航精度，考虑重新校准',
                '电池管理': '安排充电计划，监控电池状态',
                '通信模块': '检查信号强度，考虑调整位置',
                '安全系统': '定期检查安全系统功能'
            },
            info: {
                '机器人系统': '正常运行，继续监控',
                '传感器': '正常运行，定期维护',
                '导航系统': '正常运行，保持地图更新',
                '电池管理': '正常运行，按计划充电',
                '通信模块': '正常运行，保持信号稳定',
                '安全系统': '正常运行，定期检查'
            }
        };
        
        return actions[level][source] || '请联系技术支持';
    }

    /**
     * 应用筛选器
     */
    applyFilters() {
        const levelFilter = this.elements.levelFilter.value;
        const startTime = new Date(this.elements.startTimeFilter.value);
        const endTime = new Date(this.elements.endTimeFilter.value);

        this.filteredAlarms = this.alarms.filter(alarm => {
            // 级别筛选
            if (levelFilter && alarm.level !== levelFilter) {
                return false;
            }

            // 时间筛选
            const alarmTime = new Date(alarm.timestamp);
            if (alarmTime < startTime || alarmTime > endTime) {
                return false;
            }

            return true;
        });

        this.currentPage = 1;
        this.renderAlarms();
    }

    /**
     * 更新统计信息
     */
    updateStatistics() {
        const stats = {
            error: 0,
            warning: 0,
            info: 0,
            total: this.filteredAlarms.length
        };

        this.filteredAlarms.forEach(alarm => {
            stats[alarm.level]++;
        });

        this.elements.errorCount.textContent = stats.error;
        this.elements.warningCount.textContent = stats.warning;
        this.elements.infoCount.textContent = stats.info;
        this.elements.totalCount.textContent = stats.total;
        
        // 更新侧边栏小气泡
        this.updateSidebarBadge();
    }

    /**
     * 获取未确认的报警统计
     */
    getUnacknowledgedCounts() {
        const unacknowledgedAlarms = this.alarms.filter(alarm => !alarm.acknowledged);
        return {
            error: unacknowledgedAlarms.filter(alarm => alarm.level === 'error').length,
            warning: unacknowledgedAlarms.filter(alarm => alarm.level === 'warning').length,
            total: unacknowledgedAlarms.length
        };
    }

    /**
     * 更新侧边栏小气泡
     */
    updateSidebarBadge() {
        const unackCounts = this.getUnacknowledgedCounts();
        
        // 调用全局函数更新侧边栏
        if (typeof window.updateAlarmSidebarBadge === 'function') {
            window.updateAlarmSidebarBadge(unackCounts);
        }
        
        // 触发自定义事件，供其他组件监听
        window.dispatchEvent(new CustomEvent('alarmBadgeUpdate', {
            detail: unackCounts
        }));
    }

    /**
     * 渲染报警列表
     */
    renderAlarms() {
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const pageAlarms = this.filteredAlarms.slice(startIndex, endIndex);

        if (pageAlarms.length === 0) {
            this.elements.alarmList.innerHTML = '';
            this.elements.emptyState.classList.add('show');
            return;
        }

        this.elements.emptyState.classList.remove('show');
        this.elements.alarmList.innerHTML = pageAlarms.map(alarm => this.createAlarmItem(alarm)).join('');

        // 绑定事件
        pageAlarms.forEach(alarm => {
            const element = document.getElementById(`alarm-${alarm.id}`);
            if (element) {
                // 绑定详情按钮事件
                const detailBtn = element.querySelector('.detail-btn');
                if (detailBtn) {
                    detailBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.showAlarmDetail(alarm);
                    });
                }
                
                // 绑定确认按钮事件
                const acknowledgeBtn = element.querySelector('.acknowledge-btn');
                if (acknowledgeBtn && !acknowledgeBtn.disabled) {
                    acknowledgeBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.acknowledgeAlarm(alarm.id);
                    });
                }
            }
        });
    }

    /**
     * 创建报警项目HTML
     */
    createAlarmItem(alarm) {
        const timeStr = this.formatTime(alarm.timestamp);
        const levelClass = alarm.level;
        const levelText = alarm.level === 'error' ? '错误' : alarm.level === 'warning' ? '警告' : '信息';
        const acknowledgedClass = alarm.acknowledged ? 'acknowledged' : '';
        
        return `
            <div class="alarm-item ${levelClass} ${acknowledgedClass}" id="alarm-${alarm.id}">
                <div class="alarm-header-info">
                    <div>
                        <div class="alarm-title">${alarm.title}</div>
                        <div class="alarm-time">${timeStr}</div>
                    </div>
                    <div>
                        <span class="alarm-level ${levelClass}">${levelText}</span>
                    </div>
                </div>
                <div class="alarm-description">${alarm.description}</div>
                <div class="alarm-source">
                    <i class="bi bi-cpu"></i> ${alarm.source}
                </div>
                <div class="alarm-actions">
                    <button class="btn btn-sm btn-outline-info detail-btn" title="查看详情">
                        <i class="bi bi-info-circle"></i>
                    </button>
                    ${!alarm.acknowledged ? 
                        `<button class="btn btn-sm btn-outline-primary acknowledge-btn" title="确认报警">
                            <i class="bi bi-check-circle"></i>
                        </button>` : 
                        `<button class="btn btn-sm btn-outline-secondary disabled" title="已确认" disabled>
                            <i class="bi bi-check-circle-fill"></i>
                        </button>`
                    }
                </div>
            </div>
        `;
    }

    /**
     * 格式化时间
     */
    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) {
            return '刚刚';
        } else if (diffMins < 60) {
            return `${diffMins}分钟前`;
        } else if (diffHours < 24) {
            return `${diffHours}小时前`;
        } else if (diffDays < 7) {
            return `${diffDays}天前`;
        } else {
            return date.toLocaleString('zh-CN');
        }
    }

    /**
     * 显示报警详情
     */
    showAlarmDetail(alarm) {
        this.selectedAlarm = alarm;
        
        const detailHtml = `
            <div class="alarm-detail-item">
                <div class="alarm-detail-label">报警标题</div>
                <div class="alarm-detail-value">${alarm.title}</div>
            </div>
            <div class="alarm-detail-item">
                <div class="alarm-detail-label">报警级别</div>
                <div class="alarm-detail-value">
                    <span class="alarm-level ${alarm.level}">
                        ${alarm.level === 'error' ? '错误' : alarm.level === 'warning' ? '警告' : '信息'}
                    </span>
                </div>
            </div>
            <div class="alarm-detail-item">
                <div class="alarm-detail-label">报警时间</div>
                <div class="alarm-detail-value">${new Date(alarm.timestamp).toLocaleString('zh-CN')}</div>
            </div>
            <div class="alarm-detail-item">
                <div class="alarm-detail-label">报警描述</div>
                <div class="alarm-detail-value">${alarm.description}</div>
            </div>
            <div class="alarm-detail-item">
                <div class="alarm-detail-label">报警源</div>
                <div class="alarm-detail-value">${alarm.source}</div>
            </div>
            <div class="alarm-detail-item">
                <div class="alarm-detail-label">错误代码</div>
                <div class="alarm-detail-value">${alarm.details.errorCode}</div>
            </div>
            <div class="alarm-detail-item">
                <div class="alarm-detail-label">位置</div>
                <div class="alarm-detail-value">${alarm.details.location}</div>
            </div>
            <div class="alarm-detail-item">
                <div class="alarm-detail-label">设备ID</div>
                <div class="alarm-detail-value">${alarm.details.deviceId}</div>
            </div>
            <div class="alarm-detail-item">
                <div class="alarm-detail-label">严重程度</div>
                <div class="alarm-detail-value">${alarm.details.severity}</div>
            </div>
            <div class="alarm-detail-item">
                <div class="alarm-detail-label">建议操作</div>
                <div class="alarm-detail-value pre-formatted">${alarm.details.suggestedAction}</div>
            </div>
            <div class="alarm-detail-item">
                <div class="alarm-detail-label">确认状态</div>
                <div class="alarm-detail-value">
                    ${alarm.acknowledged ? 
                        '<span class="text-success"><i class="bi bi-check-circle-fill"></i> 已确认</span>' : 
                        '<span class="text-warning"><i class="bi bi-exclamation-circle-fill"></i> 未确认</span>'
                    }
                </div>
            </div>
        `;

        this.elements.alarmDetailContent.innerHTML = detailHtml;
        
        // 更新确认按钮状态
        if (alarm.acknowledged) {
            this.elements.acknowledgeAlarm.style.display = 'none';
        } else {
            this.elements.acknowledgeAlarm.style.display = 'inline-block';
        }

        // 显示模态框
        const modal = new bootstrap.Modal(this.elements.alarmDetailModal);
        modal.show();
    }

    /**
     * 确认选中的报警
     */
    acknowledgeSelectedAlarm() {
        if (this.selectedAlarm) {
            this.acknowledgeAlarm(this.selectedAlarm.id);
        }
    }

    /**
     * 确认报警
     */
    async acknowledgeAlarm(alarmId) {
        try {
            // 模拟API调用 - 实际使用时替换为真实API
            // await axiosClient.post(`/api/alarms/${alarmId}/acknowledge`);
            
            // 更新本地数据
            const alarm = this.alarms.find(a => a.id === alarmId);
            if (alarm) {
                alarm.acknowledged = true;
                alarm.acknowledgedTime = new Date();
            }

            this.applyFilters();
            this.closeModal();
            
            this.showSuccess('报警已确认');
            
        } catch (error) {
            console.error('确认报警失败:', error);
            this.showError('确认报警失败，请稍后重试');
        }
    }

    /**
     * 关闭模态框
     */
    closeModal() {
        const modal = bootstrap.Modal.getInstance(this.elements.alarmDetailModal);
        if (modal) {
            modal.hide();
        }
    }

    /**
     * 刷新报警数据
     */
    async refreshAlarms() {
        await this.loadAlarms();
        this.showSuccess('报警数据已刷新');
    }

    /**
     * 清除所有报警
     */
    clearAllAlarms() {
        if (confirm('确定要清除所有报警信息吗？此操作不可恢复。')) {
            this.alarms = [];
            this.filteredAlarms = [];
            this.renderAlarms();
            this.updateStatistics();
            this.showSuccess('所有报警已清除');
        }
    }

    /**
     * 开始自动刷新
     */
    startAutoRefresh() {
        // 每30秒自动刷新一次
        setInterval(() => {
            this.loadAlarms();
        }, 30000);
    }

    /**
     * 显示加载状态
     */
    showLoading(show) {
        const container = document.querySelector('.alarm-container');
        if (show) {
            container.classList.add('loading');
        } else {
            container.classList.remove('loading');
        }
    }

    /**
     * 显示成功消息
     */
    showSuccess(message) {
        // 使用cocoMessage或自定义消息组件
        if (typeof cocoMessage !== 'undefined') {
            cocoMessage.success(message);
        } else {
            console.log(`[成功] ${message}`);
        }
    }

    /**
     * 显示错误消息
     */
    showError(message) {
        // 使用cocoMessage或自定义消息组件
        if (typeof cocoMessage !== 'undefined') {
            cocoMessage.error(message);
        } else {
            console.error(`[错误] ${message}`);
        }
    }
}

// 初始化组件
document.addEventListener('DOMContentLoaded', () => {
    new AlarmDisplay();
});