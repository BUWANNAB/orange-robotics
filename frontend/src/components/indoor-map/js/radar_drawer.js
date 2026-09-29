/**
 * ==========================================================================
 * 单台 Livox MID-360 或 Mid-360S 的维护配置抽屉。
 * ==========================================================================
 */

(function () {
    const API_BASE = window.location.origin;

    // 默认参数模板
    const MODEL_TEMPLATES = {
        "MID-360S": {
            name: "Livox Mid-360S (新型号)",
            defaultIp: "192.168.2.190",
            pointRate: 10.0,
            pclDataType: 1,
            patternMode: 0,
            desc: "新型号；须使用支持 Mid-360S 的驱动和专用配置"
        },
        "MID-360": {
            name: "Livox MID-360 (经典款)",
            defaultIp: "192.168.2.190",
            pointRate: 10.0,
            pclDataType: 1,
            patternMode: 0,
            desc: "经典 360° 半球形非重复扫描激光雷达"
        }
    };

    let currentConfig = null;

    // 创建 DOM 结构
    function initRadarDrawerDOM() {
        if (document.getElementById("radarDrawerContainer")) return;

        const container = document.createElement("div");
        container.id = "radarDrawerContainer";
        container.innerHTML = `
            <!-- 悬浮触发按钮 -->
            <button class="radar-float-trigger-btn" id="radarTriggerBtn" title="打开雷达高级配置与外参微调">
                <svg class="radar-icon" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"/>
                    <circle cx="12" cy="12" r="6" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.6"/>
                    <circle cx="12" cy="12" r="2" fill="currentColor"/>
                    <line x1="12" y1="2" x2="12" y2="12" stroke="currentColor" stroke-width="2"/>
                </svg>
                <span>雷达配置</span>
                <span class="badge-model" id="radarBadgeModel">MID-360</span>
            </button>

            <!-- 抽屉遮罩 -->
            <div class="radar-drawer-overlay" id="radarDrawerOverlay"></div>

            <!-- 抽屉面板 -->
            <div class="radar-drawer-panel" id="radarDrawerPanel">
                <div class="radar-drawer-header">
                    <div class="radar-drawer-title">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="#00f0ff">
                            <circle cx="12" cy="12" r="10" stroke="#00f0ff" stroke-width="2" fill="none"/>
                            <circle cx="12" cy="12" r="5" stroke="#00f0ff" stroke-width="1.5" fill="none" opacity="0.6"/>
                            <circle cx="12" cy="12" r="2" fill="#00f0ff"/>
                            <path d="M12 2 A10 10 0 0 1 22 12" stroke="#38bdf8" stroke-width="2" fill="none"/>
                        </svg>
                        <div>
                            <h3>激光雷达控制中心</h3>
                            <small style="color: #64748b; font-size: 11px;">单台 Livox Mid-360 / Mid-360S 配置</small>
                        </div>
                    </div>
                    <button class="radar-close-btn" id="radarCloseBtn">&times;</button>
                </div>

                <div class="radar-drawer-body">
                    <!-- 1. 型号选择 -->
                    <div class="radar-section-card">
                        <div class="radar-section-title">
                            <span>1. 雷达型号切换</span>
                            <span style="font-size: 10px; color: #f59e0b;">切换前确认现场实际安装的型号</span>
                        </div>
                        <div class="radar-model-selector">
                            <label class="model-radio-card" id="cardModel360s">
                                <span class="tag-badge">NEW</span>
                                <input type="radio" name="radarModelRadio" value="MID-360S">
                                <span class="model-title">Mid-360S</span>
                                <span class="model-desc">独立新型号</span>
                            </label>
                            <label class="model-radio-card active" id="cardModel360">
                                <input type="radio" name="radarModelRadio" value="MID-360" checked>
                                <span class="model-title">MID-360</span>
                                <span class="model-desc">经典标准款</span>
                            </label>
                        </div>
                        <label class="radar-model-confirm"><input type="checkbox" id="radarModelConfirmed"> 我已核对雷达铭牌型号；切换后将使用对应驱动配置，需停车重启验证</label>
                    </div>

                    <!-- 2. 网络参数联动 -->
                    <div class="radar-section-card">
                        <div class="radar-section-title">
                            <span>2. 网络与通信 IP</span>
                        </div>
                        <div class="radar-input-row">
                            <div class="radar-input-group">
                                <label>工控机雷达网口 IP（不会修改系统网卡）</label>
                                <input type="text" id="radarHostIp" value="192.168.2.5" placeholder="192.168.2.5">
                            </div>
                            <div class="radar-input-group">
                                <label>雷达当前 IP（只修改连接目标，不会修改设备本身地址）</label>
                                <input type="text" id="radarDeviceIp" value="192.168.2.190" placeholder="192.168.2.190">
                            </div>
                        </div>
                        <div class="radar-input-row">
                            <div class="radar-input-group">
                                <label>雷达点云发送端口（固定）</label>
                                <input type="number" id="radarPointPort" value="56300" disabled>
                            </div>
                            <div class="radar-input-group">
                                <label>雷达控制接收端口（固定）</label>
                                <input type="number" id="radarCmdPort" value="56100" disabled>
                            </div>
                        </div>
                    </div>

                    <!-- 3. 外参 2D 联动微调 -->
                    <div class="radar-section-card">
                        <div class="radar-section-title">
                            <span>3. 车体到雷达安装外参（生成唯一静态 TF；须现场测量）</span>
                        </div>

                        <!-- 2D 俯视微缩联动图 -->
                        <div class="radar-vehicle-preview-box">
                            <div class="vehicle-chassis-shape">
                                <span class="vehicle-front-arrow">▲ 车头</span>
                                <div class="radar-marker-dot" id="radarMarkerVisual">
                                    <div class="radar-fov-beam" id="radarFovBeam"></div>
                                </div>
                            </div>
                        </div>

                        <div class="radar-input-row">
                            <div class="radar-input-group">
                                <label>前后偏移 X (mm)</label>
                                <input type="number" id="radarExtX" value="-500" step="10">
                            </div>
                            <div class="radar-input-group">
                                <label>左右偏移 Y (mm)</label>
                                <input type="number" id="radarExtY" value="0" step="10">
                            </div>
                        </div>
                        <div class="radar-input-row">
                            <div class="radar-input-group">
                                <label>离地高度 Z (mm)</label>
                                <input type="number" id="radarExtZ" value="650" step="10">
                            </div>
                            <div class="radar-input-group">
                                <label>偏航角 Yaw (°)</label>
                                <input type="number" id="radarExtYaw" value="90" step="1">
                            </div>
                        </div>
                        <div class="radar-input-row">
                            <div class="radar-input-group">
                                <label>俯仰 Pitch (°)</label>
                                <input type="number" id="radarExtPitch" value="0" step="0.5">
                            </div>
                            <div class="radar-input-group">
                                <label>翻滚 Roll (°)</label>
                                <input type="number" id="radarExtRoll" value="0" step="0.5">
                            </div>
                        </div>
                        <label class="radar-model-confirm"><input type="checkbox" id="radarMountConfirmed"> 我已按车体 base_link 坐标系测量并核对本次安装外参</label>
                    </div>

                    <!-- 4. 感知盲区与滤波 -->
                    <div class="radar-section-card">
                        <div class="radar-section-title">
                            <span>4. 感知阈值（当前仅显示数据库值，未接入 ROS 避障；不可在此修改）</span>
                        </div>
                        <div class="radar-input-row">
                            <div class="radar-input-group">
                                <label>车壳盲区裁剪 (m)</label>
                                <input type="number" id="radarFilterMin" value="0.15" step="0.05" disabled>
                            </div>
                            <div class="radar-input-group">
                                <label>最大探测距离 (m)</label>
                                <input type="number" id="radarFilterMax" value="25.0" step="1.0" disabled>
                            </div>
                        </div>
                    </div>

                    <!-- 5. 实时诊断 -->
                    <div class="radar-section-card">
                        <div class="radar-section-title">
                            <span>5. 雷达运行状态诊断</span>
                        </div>
                        <div class="radar-diag-grid">
                            <div class="radar-diag-item">
                                <span class="label">连接状态</span>
                                <span class="val" id="diagStatus">未检测</span>
                            </div>
                            <div class="radar-diag-item">
                                <span class="label">内部温度</span>
                                <span class="val" id="diagTemp">未检测</span>
                            </div>
                            <div class="radar-diag-item">
                                <span class="label">PTP时钟同步</span>
                                <span class="val" id="diagPtp">未检测</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 抽屉底部操作栏 -->
                <div class="radar-drawer-footer">
                    <div class="radar-deployment-status" id="radarDeploymentStatus">正在读取运行配置…</div>
                    <button class="btn-radar-action btn-radar-reload" id="btnRadarReload" disabled title="当前版本不支持网页热重载；停车后由维护流程重启并核对点云和 TF">
                        重启后生效
                    </button>
                    <button class="btn-radar-action btn-radar-verify" id="btnRadarVerify" disabled>验证生效</button>
                    <button class="btn-radar-action btn-radar-save" id="btnRadarSave" disabled>
                        💾 保存配置
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        bindEvents();
    }

    // 绑定抽屉交互事件
    function bindEvents() {
        const triggerBtn = document.getElementById("radarTriggerBtn");
        const overlay = document.getElementById("radarDrawerOverlay");
        const panel = document.getElementById("radarDrawerPanel");
        const closeBtn = document.getElementById("radarCloseBtn");
        const btnSave = document.getElementById("btnRadarSave");
        const btnVerify = document.getElementById("btnRadarVerify");

        // 打开/关闭抽屉
        triggerBtn.addEventListener("click", () => {
            openDrawer();
        });
        overlay.addEventListener("click", () => {
            closeDrawer();
        });
        closeBtn.addEventListener("click", () => {
            closeDrawer();
        });

        // 型号单选切换
        const radios = document.querySelectorAll("input[name='radarModelRadio']");
        radios.forEach(radio => {
            radio.addEventListener("change", (e) => {
                const model = e.target.value;
                document.getElementById("cardModel360s").classList.toggle("active", model === "MID-360S");
                document.getElementById("cardModel360").classList.toggle("active", model === "MID-360");
                document.getElementById("radarBadgeModel").innerText = model;
                document.getElementById("radarModelConfirmed").checked = false;
                showNotification(`已选择 ${MODEL_TEMPLATES[model].name}；请核对实物型号并在保存后停车重启验证`, "info");
            });
        });

        // 外参输入框联动 2D 示意图
        ["radarExtX", "radarExtY", "radarExtYaw"].forEach(id => {
            document.getElementById(id).addEventListener("input", updateVisualPreview);
        });

        // 保存配置
        btnSave.addEventListener("click", saveConfig);
        btnVerify.addEventListener("click", verifyConfig);

        // 热重载
        // Current ROS driver/static TF do not support a verified live reload.
    }

    // 更新 2D 俯视车体示意图
    function updateVisualPreview() {
        const x_mm = parseFloat(document.getElementById("radarExtX").value) || 0;
        const y_mm = parseFloat(document.getElementById("radarExtY").value) || 0;
        const yaw_deg = parseFloat(document.getElementById("radarExtYaw").value) || 0;

        const marker = document.getElementById("radarMarkerVisual");
        const beam = document.getElementById("radarFovBeam");

        // 车体中心在 50%, 50%
        // x 对应前后 (mm): 前为正 (向上即 top - delta)
        // y 对应左右 (mm): 左为正 (向左即 left - delta)
        const scale = 0.05; // 缩放比例
        const topOffset = 50 - (x_mm * scale);
        const leftOffset = 50 - (y_mm * scale);

        marker.style.top = `${Math.min(Math.max(topOffset, 15), 85)}%`;
        marker.style.left = `${Math.min(Math.max(leftOffset, 15), 85)}%`;

        // 旋转光束 (ROS 2 中 yaw=0 为前向，顺时针/逆时针自适应)
        beam.style.transform = `rotate(${yaw_deg}deg)`;
    }

    function openDrawer() {
        document.getElementById("radarDrawerOverlay").classList.add("active");
        document.getElementById("radarDrawerPanel").classList.add("active");
        loadConfig();
    }

    function closeDrawer() {
        document.getElementById("radarDrawerOverlay").classList.remove("active");
        document.getElementById("radarDrawerPanel").classList.remove("active");
    }

    // 从后端拉取配置
    async function loadConfig() {
        currentConfig = null;
        document.getElementById("btnRadarSave").disabled = true;
        document.getElementById("btnRadarVerify").disabled = true;
        try {
            const res = await fetch(`${API_BASE}/api/v1/lidar/config`, {
                headers: { "Authorization": localStorage.getItem("token") || "" }
            });
            const json = await res.json();
            if (json.code === 0 && json.data) {
                currentConfig = json.data;
                applyConfigToUI(currentConfig);
                document.getElementById("btnRadarSave").disabled = !currentConfig.deployment?.shared_configured;
                document.getElementById("btnRadarVerify").disabled = !currentConfig.deployment?.pending_verification;
            } else {
                document.getElementById("radarDeploymentStatus").textContent = "读取失败；请检查登录和后端服务。";
                showNotification(`读取雷达配置失败：${json.message || json.detail || "未配置"}`, "error");
            }
        } catch (e) {
            document.getElementById("radarDeploymentStatus").textContent = "无法连接后端；保存已禁用。";
            showNotification("加载雷达配置失败: " + e.message, "error");
        }
    }

    function applyConfigToUI(cfg) {
        // 型号
        const model = cfg.lidar_model || "MID-360";
        const radio = document.querySelector(`input[name='radarModelRadio'][value='${model}']`);
        if (radio) {
            radio.checked = true;
            document.getElementById("cardModel360s").classList.toggle("active", model === "MID-360S");
            document.getElementById("cardModel360").classList.toggle("active", model === "MID-360");
            document.getElementById("radarBadgeModel").innerText = model;
        }
        document.getElementById("radarModelConfirmed").checked = false;
        document.getElementById("radarMountConfirmed").checked = false;

        // 网络
        if (cfg.host_ip) document.getElementById("radarHostIp").value = cfg.host_ip;

        // 雷达外参 (取第 1 个主雷达)
        if (cfg.lidars && cfg.lidars.length > 0) {
            const mainLidar = cfg.lidars[0];
            document.getElementById("radarDeviceIp").value = mainLidar.ip || "192.168.2.190";
            const ext = mainLidar.extrinsics || {};
            document.getElementById("radarExtX").value = cfg.deployment?.mount_configured ? ext.x_mm : "";
            document.getElementById("radarExtY").value = cfg.deployment?.mount_configured ? ext.y_mm : "";
            document.getElementById("radarExtZ").value = cfg.deployment?.mount_configured ? ext.z_mm : "";
            document.getElementById("radarExtYaw").value = cfg.deployment?.mount_configured ? ext.yaw : "";
            document.getElementById("radarExtPitch").value = cfg.deployment?.mount_configured ? ext.pitch : "";
            document.getElementById("radarExtRoll").value = cfg.deployment?.mount_configured ? ext.roll : "";
        }

        // 滤波参数
        if (cfg.filter) {
            document.getElementById("radarFilterMin").value = cfg.filter.scandis_min || 0.15;
            document.getElementById("radarFilterMax").value = cfg.filter.scandis_max || 25.0;
        }

        // 诊断数据
        document.getElementById("diagStatus").innerText = cfg.status?.online === true ? "在线" : "未检测";
        document.getElementById("diagTemp").innerText = cfg.status?.temperature == null ? "未检测" : `${cfg.status.temperature} °C`;
        document.getElementById("diagPtp").innerText = cfg.status?.ptp_sync === true ? "已锁定" : "未检测";

        const deployment = cfg.deployment || {};
        const state = deployment.shared_configured
            ? (deployment.pending_verification ? "配置已保存，等待停车重启 ROS 核心服务并验证" : "配置已读取；实机状态仍需核对点云和 TF")
            : "未配置共享 MID360_CONFIG_FILE；请先完成 Web/ROS 部署，保存已禁用";
        const mountState = deployment.mount_configured ? "" : "；尚未录入车体到雷达的安装外参，核心 ROS 服务会拒绝启动";
        document.getElementById("radarDeploymentStatus").textContent = `${state}${mountState}。配置文件：${deployment.config_path || "未设置"}`;

        updateVisualPreview();
    }

    // 保存配置
    async function saveConfig() {
        const btnSave = document.getElementById("btnRadarSave");
        btnSave.disabled = true;
        btnSave.innerText = "保存中...";

        const selectedRadio = document.querySelector("input[name='radarModelRadio']:checked");
        const model = selectedRadio ? selectedRadio.value : "MID-360";
        if (model !== currentConfig?.lidar_model && !document.getElementById("radarModelConfirmed").checked) {
            showNotification("请先确认现场雷达铭牌型号", "error");
            btnSave.disabled = false;
            btnSave.innerText = "💾 保存配置";
            return;
        }
        const extIds = ["radarExtX", "radarExtY", "radarExtZ", "radarExtYaw", "radarExtPitch", "radarExtRoll"];
        if (extIds.some(id => document.getElementById(id).value.trim() === "" ||
                              !Number.isFinite(Number(document.getElementById(id).value)))) {
            showNotification("请填写所有实测安装外参，包括值为 0 的项", "error");
            btnSave.disabled = false;
            btnSave.innerText = "💾 保存配置";
            return;
        }

        const payload = {
            lidar_model: model,
            model_change_confirmed: document.getElementById("radarModelConfirmed").checked,
            mount_confirmed: document.getElementById("radarMountConfirmed").checked,
            host_ip: document.getElementById("radarHostIp").value.trim(),
            device_ip: document.getElementById("radarDeviceIp").value.trim(),
            extrinsics: {
                x_mm: Number(document.getElementById("radarExtX").value),
                y_mm: Number(document.getElementById("radarExtY").value),
                z_mm: Number(document.getElementById("radarExtZ").value),
                yaw: Number(document.getElementById("radarExtYaw").value),
                pitch: Number(document.getElementById("radarExtPitch").value),
                roll: Number(document.getElementById("radarExtRoll").value)
            }
        };

        try {
            const res = await fetch(`${API_BASE}/api/v1/lidar/config`, {
                method: "POST",
                headers: { "Content-Type": "application/json",
                           "Authorization": localStorage.getItem("token") || "" },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (json.code === 0) {
                showNotification("配置已保存；停车后重启 ROS 核心服务，再点“验证生效”", "success");
                await loadConfig();
            } else {
                showNotification("保存失败: " + (json.message || json.detail || res.status), "error");
            }
        } catch (e) {
            showNotification("请求出错: " + e.message, "error");
        } finally {
            btnSave.disabled = !currentConfig?.deployment?.shared_configured;
            btnSave.innerText = "💾 保存配置";
        }
    }

    async function verifyConfig() {
        const button = document.getElementById("btnRadarVerify");
        button.disabled = true;
        try {
            const res = await fetch(`${API_BASE}/api/v1/lidar/verify`, {
                method: "POST",
                headers: { "Authorization": localStorage.getItem("token") || "" }
            });
            const json = await res.json();
            if (json.code !== 0) throw new Error(json.message || json.detail || "验证失败");
            showNotification(json.data?.message || "雷达配置已验证", "success");
            await loadConfig();
        } catch (e) {
            showNotification(`尚未生效：${e.message}`, "error");
            button.disabled = false;
        }
    }

    // 简单轻量消息通知
    function showNotification(msg, type = "info") {
        if (window.cocoMessage) {
            if (type === "success") window.cocoMessage.success(msg);
            else if (type === "error") window.cocoMessage.error(msg);
            else window.cocoMessage.info(msg);
            return;
        }
        alert(msg);
    }

    // 页面加载就绪时初始化
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initRadarDrawerDOM);
    } else {
        initRadarDrawerDOM();
    }
})();
