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
    const DEFAULT_PROTECTION_CONFIG = {
        enabled: false,
        cloud_topic: "/livox/lidar",
        base_frame: "base_link",
        odom_frame: "odom",
        min_range: 0.20,
        max_range: 12.0,
        min_height: 0.08,
        max_height: 1.60,
        voxel_leaf: 0.12,
        voxel_min_points: 1,
        source_timeout: 0.50,
        regions: [
            { id: "front_slow", name: "前方减速区", enabled: false, x_min: 0.20, x_max: 1.80, y_min: -0.60, y_max: 0.60, max_points: 45, action: "slowdown", slowdown_ratio: 0.35 },
            { id: "front_stop", name: "前方停车区", enabled: false, x_min: 0.10, x_max: 0.75, y_min: -0.45, y_max: 0.45, max_points: 12, action: "stop", slowdown_ratio: 0.35 },
            { id: "rear_stop", name: "后方停车区", enabled: false, x_min: -0.80, x_max: -0.10, y_min: -0.45, y_max: 0.45, max_points: 12, action: "stop", slowdown_ratio: 0.35 },
            { id: "left_stop", name: "左侧停车区", enabled: false, x_min: -0.40, x_max: 0.40, y_min: 0.30, y_max: 1.00, max_points: 12, action: "stop", slowdown_ratio: 0.35 },
            { id: "right_stop", name: "右侧停车区", enabled: false, x_min: -0.40, x_max: 0.40, y_min: -1.00, y_max: -0.30, max_points: 12, action: "stop", slowdown_ratio: 0.35 }
        ]
    };

    // 创建 DOM 结构
    function initRadarDrawerDOM() {
        if (document.getElementById("radarDrawerContainer")) return;
        const standalonePage = document.body.dataset.radarSettingsPage === "true";

        const container = document.createElement("div");
        container.id = "radarDrawerContainer";
        if (standalonePage) container.classList.add("radar-settings-standalone");
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
                        <div class="radar-discovery-controls">
                            <button type="button" class="btn-radar-discover" id="btnRadarScan">⌕ 扫描雷达</button>
                            <span class="radar-discovery-status" id="radarDiscoveryStatus" role="status" aria-live="polite">扫描使用上方工控机雷达网口；只发现设备，不修改配置。</span>
                        </div>
                        <div class="radar-discovery-choice" id="radarDiscoveryChoice" hidden>
                            <label for="radarDiscoverySelect">发现多台支持的雷达，请选择本车安装的设备</label>
                            <select id="radarDiscoverySelect" aria-label="选择发现的雷达"></select>
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

                    <!-- 4. 点云分区与计算量控制 -->
                    <div class="radar-section-card" id="radarProtectionCard">
                        <div class="radar-section-title">
                            <span>4. 点云防护区域</span>
                            <span class="protection-mode-label">Humble · PCL · Nav2</span>
                        </div>
                        <p id="radarProtectionUnavailable" class="radar-discovery-status" hidden>避障共享运行配置路径未设置，本区暂不可编辑或保存；雷达安装外参仍可单独保存。</p>
                        <div class="protection-switch-row">
                            <label class="protection-switch"><input type="checkbox" id="protectionEnabled"><span>启用自动导航分区防护</span></label>
                            <span class="protection-state-pill" id="protectionStatePill">未启用</span>
                        </div>
                        <div class="protection-preview-card">
                            <svg id="protectionPreview" viewBox="0 0 320 250" role="img" aria-label="base_link 坐标系中的检测区域俯视图">
                                <defs><pattern id="protectionGrid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="rgba(56,189,248,.11)" stroke-width="1"/></pattern></defs>
                                <rect x="0" y="0" width="320" height="250" fill="url(#protectionGrid)"/>
                                <g id="protectionPreviewZones"></g>
                                <path d="M160 125V25" stroke="#8ba5b8" stroke-width="1" stroke-dasharray="4 4"/>
                                <path d="M160 24l-5 9h10z" fill="#8ba5b8"/>
                                <rect x="147" y="113" width="26" height="48" rx="6" fill="#213548" stroke="#d9e8ef" stroke-width="1.5"/>
                                <path d="M153 118h14" stroke="#00f0ff" stroke-width="2"/>
                                <text x="160" y="178" text-anchor="middle" class="protection-svg-caption">base_link</text>
                                <text x="160" y="15" text-anchor="middle" class="protection-svg-axis">前方 +X</text>
                                <text x="300" y="128" text-anchor="end" class="protection-svg-axis">右侧 −Y</text>
                                <text x="20" y="128" class="protection-svg-axis">左侧 +Y</text>
                            </svg>
                            <div class="protection-legend"><span><i class="legend-swatch legend-slow"></i>减速区</span><span><i class="legend-swatch legend-stop"></i>停车区</span></div>
                        </div>
                        <p class="protection-help">区域按 base_link 坐标设置：X 前正、Y 左正。图中车体和区域是编辑预览，初始范围需按实车尺寸、安装外参和制动距离校准。</p>
                        <div class="protection-global-grid">
                            <label>点云话题<input id="protectionCloudTopic" type="text" value="/livox/lidar" autocomplete="off"></label>
                            <label>检测盲区 (m)<input id="protectionMinRange" type="number" min="0" max="5" step="0.05"></label>
                            <label>最远检测 (m)<input id="protectionMaxRange" type="number" min="0.5" max="30" step="0.5"></label>
                            <label>最低高度 (m)<input id="protectionMinHeight" type="number" min="-1" max="3" step="0.05"></label>
                            <label>最高高度 (m)<input id="protectionMaxHeight" type="number" min="-1" max="5" step="0.05"></label>
                            <label>体素边长 (m)<input id="protectionVoxelLeaf" type="number" min="0.03" max="0.5" step="0.01"></label>
                            <label>体素最少点数<input id="protectionVoxelPoints" type="number" min="1" max="20" step="1"></label>
                            <label>点云超时 (s)<input id="protectionTimeout" type="number" min="0.1" max="2" step="0.05"></label>
                        </div>
                        <div class="protection-pipeline"><b>计算顺序</b><span>base_link 坐标变换</span><i>›</i><span>范围裁剪 CropBox</span><i>›</i><span>体素降采样 VoxelGrid</span><i>›</i><span>区域点数判断</span></div>
                        <p class="protection-help protection-count-note">阈值按“裁剪并体素降采样后的点数”计算；Humble 中该区域点数超过阈值才触发。减速和停车动作由 Collision Monitor 执行。</p>
                        <div class="protection-regions-heading"><b>检测区域</b><button type="button" class="protection-add-region" id="btnAddProtectionRegion">＋ 添加区域</button></div>
                        <div id="protectionRegions" class="protection-regions"></div>
                        <div class="protection-risk-note"><b>启用条件</b><span>至少启用一个停车区；配置保存后需重启导航服务。点云或监测速度超时会由看门狗把自动速度置零。该链路保护路径跟踪自动速度，网页遥控速度目前不经过此链路。此功能不是安全认证急停，也不会规划绕行路线。</span></div>
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
        const mount = standalonePage ? document.getElementById("radarSettingsMount") : document.body;
        (mount || document.body).appendChild(container);

        bindEvents();
        if (standalonePage) {
            document.querySelectorAll("input[name='radarModelRadio']").forEach(radio => { radio.checked = false; });
            document.getElementById("cardModel360s").classList.remove("active");
            document.getElementById("cardModel360").classList.remove("active");
            document.getElementById("radarBadgeModel").innerText = "未读取";
            ["radarHostIp", "radarDeviceIp", "radarExtX", "radarExtY", "radarExtZ", "radarExtYaw", "radarExtPitch", "radarExtRoll"]
                .forEach(id => { document.getElementById(id).value = ""; });
            updateVisualPreview();
            openDrawer();
        }
    }

    // 绑定抽屉交互事件
    function bindEvents() {
        const triggerBtn = document.getElementById("radarTriggerBtn");
        const overlay = document.getElementById("radarDrawerOverlay");
        const panel = document.getElementById("radarDrawerPanel");
        const closeBtn = document.getElementById("radarCloseBtn");
        const btnSave = document.getElementById("btnRadarSave");
        const btnVerify = document.getElementById("btnRadarVerify");
        const btnScan = document.getElementById("btnRadarScan");

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

        ["protectionCloudTopic", "protectionMinRange", "protectionMaxRange", "protectionMinHeight",
            "protectionMaxHeight", "protectionVoxelLeaf", "protectionVoxelPoints", "protectionTimeout"]
            .forEach(id => document.getElementById(id).addEventListener("input", updateProtectionPreview));
        document.getElementById("protectionEnabled").addEventListener("change", updateProtectionPreview);
        const protectionRegions = document.getElementById("protectionRegions");
        protectionRegions.addEventListener("input", updateProtectionPreview);
        protectionRegions.addEventListener("change", (event) => {
            if (event.target.matches("[data-region-action]")) {
                const card = event.target.closest(".protection-region-card");
                card.querySelector("[data-slowdown-ratio]").hidden = event.target.value !== "slowdown";
            }
            updateProtectionPreview();
        });
        protectionRegions.addEventListener("click", (event) => {
            const button = event.target.closest("[data-delete-region]");
            if (!button) return;
            const index = Number(button.dataset.deleteRegion);
            const config = collectProtectionConfig();
            config.regions.splice(index, 1);
            renderProtectionRegions(config.regions);
            updateProtectionPreview();
        });
        document.getElementById("btnAddProtectionRegion").addEventListener("click", () => {
            const config = collectProtectionConfig();
            if (config.regions.length >= 8) {
                showNotification("最多添加 8 个检测区域", "error");
                return;
            }
            const used = new Set(config.regions.map(region => region.id));
            let number = 1;
            while (used.has(`custom_${number}`)) number += 1;
            config.regions.push({ id: `custom_${number}`, name: `自定义区 ${number}`, enabled: false,
                x_min: -0.4, x_max: 0.8, y_min: -0.5, y_max: 0.5,
                max_points: 12, action: "stop", slowdown_ratio: 0.35 });
            renderProtectionRegions(config.regions);
            updateProtectionPreview();
        });

        // 保存配置
        btnSave.addEventListener("click", saveConfig);
        btnVerify.addEventListener("click", verifyConfig);
        btnScan.addEventListener("click", scanForLidar);
        document.getElementById("radarDiscoverySelect").addEventListener("change", (event) => {
            const device = lastDiscoveredLidars.find(item => item.ip === event.target.value);
            if (device) applyDiscoveredLidar(device);
        });

        // 热重载
        // Current ROS driver/static TF do not support a verified live reload.
    }

    let lastDiscoveredLidars = [];

    async function scanForLidar() {
        const button = document.getElementById("btnRadarScan");
        const status = document.getElementById("radarDiscoveryStatus");
        const hostIp = document.getElementById("radarHostIp").value.trim();
        const choice = document.getElementById("radarDiscoveryChoice");
        if (!hostIp) {
            status.textContent = "请先填写工控机连接雷达网口的 IPv4 地址。";
            return;
        }

        button.disabled = true;
        button.textContent = "正在扫描…";
        status.textContent = "正在选定网口发送 Livox 只读发现请求；最多等待 3 秒。";
        choice.hidden = true;
        lastDiscoveredLidars = [];
        try {
            const response = await fetch(`${API_BASE}/api/v1/lidar/scan`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": localStorage.getItem("token") || "" },
                body: JSON.stringify({ host_ip: hostIp, timeout_seconds: 3 })
            });
            const json = await response.json();
            if (!response.ok || json.code !== 0 || !json.data) {
                throw new Error(json.detail || json.message || `HTTP ${response.status}`);
            }
            lastDiscoveredLidars = Array.isArray(json.data.devices) ? json.data.devices : [];
            const supported = lastDiscoveredLidars.filter(device => device.supported === true);
            if (supported.length === 1) {
                applyDiscoveredLidar(supported[0]);
                status.textContent = `发现 ${supported[0].model}，IP ${supported[0].ip}；已回填，尚未保存。`;
            } else if (supported.length > 1) {
                const select = document.getElementById("radarDiscoverySelect");
                select.replaceChildren();
                supported.forEach(device => {
                    const option = document.createElement("option");
                    option.value = device.ip;
                    option.textContent = `${device.model} · ${device.ip}${device.serial_number ? ` · ${device.serial_number}` : ""}`;
                    select.append(option);
                });
                choice.hidden = false;
                applyDiscoveredLidar(supported[0]);
                status.textContent = `发现 ${supported.length} 台 MID-360 系列设备；请选择本车安装的雷达。`;
            } else {
                const unsupportedCount = lastDiscoveredLidars.length;
                status.textContent = unsupportedCount
                    ? `发现 ${unsupportedCount} 台其他 Livox 型号；本页面仅支持 MID-360 / MID-360S。`
                    : "未发现 MID-360 / MID-360S。确认网线、网口 IP/网段和防火墙；若 ROS 雷达驱动正在运行，请先停止后扫描。";
            }
        } catch (error) {
            status.textContent = `扫描失败：${error.message}`;
        } finally {
            button.disabled = false;
            button.textContent = "⌕ 扫描雷达";
        }
    }

    function applyDiscoveredLidar(device) {
        document.getElementById("radarDeviceIp").value = device.ip;
        const radio = document.querySelector(`input[name='radarModelRadio'][value='${device.model}']`);
        if (!radio) return;
        radio.checked = true;
        document.getElementById("cardModel360s").classList.toggle("active", device.model === "MID-360S");
        document.getElementById("cardModel360").classList.toggle("active", device.model === "MID-360");
        document.getElementById("radarBadgeModel").innerText = device.model;
        document.getElementById("radarModelConfirmed").checked = false;
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

    function setProtectionEditable(enabled) {
        const card = document.getElementById("radarProtectionCard");
        if (!card) return;
        card.querySelectorAll("input, select, button").forEach(control => {
            control.disabled = !enabled;
        });
        const notice = document.getElementById("radarProtectionUnavailable");
        if (notice) notice.hidden = enabled;
    }

    // 从后端拉取配置
    async function loadConfig() {
        currentConfig = null;
        document.getElementById("btnRadarSave").disabled = true;
        document.getElementById("btnRadarVerify").disabled = true;
        setProtectionEditable(false);
        try {
            const res = await fetch(`${API_BASE}/api/v1/lidar/config`, {
                headers: { "Authorization": localStorage.getItem("token") || "" }
            });
            const contentType = res.headers.get("content-type") || "";
            if (!/json/i.test(contentType)) {
                throw new Error(`配置接口返回非 JSON（HTTP ${res.status}），请检查后端服务和接口路由。`);
            }
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
            document.getElementById("radarDeploymentStatus").textContent = "无法读取配置；保存和验证已禁用。";
            showNotification(e.message.startsWith("配置接口返回非 JSON")
                ? e.message : `无法连接雷达配置接口：${e.message}`, "error");
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

        applyProtectionConfig(cfg.obstacle_protection || DEFAULT_PROTECTION_CONFIG);
        setProtectionEditable(cfg.deployment?.protection_shared_configured === true);

        // 诊断数据
        document.getElementById("diagStatus").innerText = cfg.status?.online === true ? "在线" : "未检测";
        document.getElementById("diagTemp").innerText = cfg.status?.temperature == null ? "未检测" : `${cfg.status.temperature} °C`;
        document.getElementById("diagPtp").innerText = cfg.status?.ptp_sync === true ? "已锁定" : "未检测";

        const deployment = cfg.deployment || {};
        const state = deployment.shared_configured
            ? (deployment.pending_verification ? "配置已保存，等待停车重启 ROS 核心服务并验证" : "配置已读取；实机状态仍需核对点云和 TF")
            : "未配置共享 MID360_CONFIG_FILE；请先完成 Web/ROS 部署，保存已禁用";
        const mountState = deployment.mount_configured ? "" : "；尚未录入车体到雷达的安装外参，核心 ROS 服务会拒绝启动";
        const protectionState = deployment.protection_shared_configured
            ? (deployment.protection_config_valid === false ? "；点云防护配置损坏，已禁止覆盖保存"
                : deployment.protection_pending_verification ? "；点云防护配置待重启导航服务验证"
                    : "；点云防护配置需实机验证")
            : "；未设置 ORANGE_OBSTACLE_CONFIG_FILE，共享保护配置保存已禁用";
        document.getElementById("radarDeploymentStatus").textContent = `${state}${mountState}${protectionState}。雷达配置：${deployment.config_path || "未设置"}；防护配置：${deployment.protection_config_path || "未设置"}`;

        updateVisualPreview();
    }

    function applyProtectionConfig(raw) {
        const cfg = JSON.parse(JSON.stringify(raw || DEFAULT_PROTECTION_CONFIG));
        document.getElementById("protectionEnabled").checked = cfg.enabled === true;
        document.getElementById("protectionCloudTopic").value = cfg.cloud_topic || "/livox/lidar";
        document.getElementById("protectionMinRange").value = cfg.min_range ?? 0.20;
        document.getElementById("protectionMaxRange").value = cfg.max_range ?? 12.0;
        document.getElementById("protectionMinHeight").value = cfg.min_height ?? 0.08;
        document.getElementById("protectionMaxHeight").value = cfg.max_height ?? 1.60;
        document.getElementById("protectionVoxelLeaf").value = cfg.voxel_leaf ?? 0.12;
        document.getElementById("protectionVoxelPoints").value = cfg.voxel_min_points ?? 1;
        document.getElementById("protectionTimeout").value = cfg.source_timeout ?? 0.50;
        renderProtectionRegions(Array.isArray(cfg.regions) ? cfg.regions : []);
        updateProtectionPreview();
    }

    function renderProtectionRegions(regions) {
        const container = document.getElementById("protectionRegions");
        container.replaceChildren();
        regions.forEach((region, index) => {
            const card = document.createElement("section");
            card.className = "protection-region-card";
            card.dataset.regionIndex = String(index);
            card.dataset.regionId = region.id || `zone_${index + 1}`;

            const heading = document.createElement("div");
            heading.className = "protection-region-heading";
            const enabledLabel = document.createElement("label");
            enabledLabel.className = "protection-region-enable";
            const toggle = document.createElement("input");
            toggle.type = "checkbox";
            toggle.checked = region.enabled === true;
            toggle.dataset.regionField = "enabled";
            const name = document.createElement("input");
            name.type = "text";
            name.maxLength = 24;
            name.value = region.name || `检测区 ${index + 1}`;
            name.dataset.regionField = "name";
            name.setAttribute("aria-label", "检测区域名称");
            enabledLabel.append(toggle, name);
            const action = document.createElement("select");
            action.dataset.regionField = "action";
            action.dataset.regionAction = "true";
            action.setAttribute("aria-label", "区域触发动作");
            [["slowdown", "减速"], ["stop", "停车"]].forEach(([value, label]) => {
                const option = document.createElement("option");
                option.value = value;
                option.textContent = label;
                option.selected = (region.action || "stop") === value;
                action.append(option);
            });
            const headingActions = document.createElement("div");
            headingActions.className = "protection-region-actions";
            headingActions.append(action);
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "protection-region-remove";
            remove.dataset.deleteRegion = String(index);
            remove.setAttribute("aria-label", `移除${region.name || "检测区域"}`);
            remove.textContent = "移除";
            headingActions.append(remove);
            heading.append(enabledLabel, headingActions);

            const bounds = document.createElement("div");
            bounds.className = "protection-region-bounds";
            [["x_min", "X 前后最小 (m)"], ["x_max", "X 前后最大 (m)"],
                ["y_min", "Y 左右最小 (m)"], ["y_max", "Y 左右最大 (m)"]].forEach(([key, label]) => {
                const wrapper = document.createElement("label");
                wrapper.textContent = label;
                const input = document.createElement("input");
                input.type = "number";
                input.step = "0.05";
                input.value = region[key] ?? 0;
                input.dataset.regionField = key;
                wrapper.append(input);
                bounds.append(wrapper);
            });

            const thresholdRow = document.createElement("div");
            thresholdRow.className = "protection-region-threshold";
            const countLabel = document.createElement("label");
            countLabel.textContent = "超出点数阈值触发";
            const countInput = document.createElement("input");
            countInput.type = "number";
            countInput.min = "0";
            countInput.max = "100000";
            countInput.step = "1";
            countInput.value = region.max_points ?? 12;
            countInput.dataset.regionField = "max_points";
            countLabel.append(countInput);
            const ratioLabel = document.createElement("label");
            ratioLabel.textContent = "减速比例 (0–1)";
            ratioLabel.dataset.slowdownRatio = "true";
            ratioLabel.hidden = (region.action || "stop") !== "slowdown";
            const ratioInput = document.createElement("input");
            ratioInput.type = "number";
            ratioInput.min = "0.05";
            ratioInput.max = "0.95";
            ratioInput.step = "0.05";
            ratioInput.value = region.slowdown_ratio ?? 0.35;
            ratioInput.dataset.regionField = "slowdown_ratio";
            ratioLabel.append(ratioInput);
            thresholdRow.append(countLabel, ratioLabel);

            card.append(heading, bounds, thresholdRow);
            container.append(card);
        });
    }

    function collectProtectionConfig() {
        const number = id => Number(document.getElementById(id).value);
        return {
            enabled: document.getElementById("protectionEnabled").checked,
            cloud_topic: document.getElementById("protectionCloudTopic").value.trim(),
            base_frame: "base_link",
            odom_frame: "odom",
            min_range: number("protectionMinRange"),
            max_range: number("protectionMaxRange"),
            min_height: number("protectionMinHeight"),
            max_height: number("protectionMaxHeight"),
            voxel_leaf: number("protectionVoxelLeaf"),
            voxel_min_points: number("protectionVoxelPoints"),
            source_timeout: number("protectionTimeout"),
            regions: Array.from(document.querySelectorAll(".protection-region-card"), card => {
                const get = field => card.querySelector(`[data-region-field='${field}']`);
                const region = {
                    id: card.dataset.regionId,
                    name: get("name").value.trim(),
                    enabled: get("enabled").checked,
                    action: get("action").value,
                    x_min: Number(get("x_min").value),
                    x_max: Number(get("x_max").value),
                    y_min: Number(get("y_min").value),
                    y_max: Number(get("y_max").value),
                    max_points: Number(get("max_points").value),
                    slowdown_ratio: Number(get("slowdown_ratio").value)
                };
                return region;
            })
        };
    }

    function validateProtectionConfig(cfg) {
        const numeric = [cfg.min_range, cfg.max_range, cfg.min_height, cfg.max_height,
            cfg.voxel_leaf, cfg.voxel_min_points, cfg.source_timeout];
        const enabledRegions = cfg.regions.filter(region => region.enabled);
        const invalidRegion = cfg.regions.some(region => !region.id ||
            !Number.isFinite(region.x_min) || !Number.isFinite(region.x_max) ||
            !Number.isFinite(region.y_min) || !Number.isFinite(region.y_max) ||
            region.x_min >= region.x_max || region.y_min >= region.y_max ||
            !Number.isInteger(region.max_points) || region.max_points < 0 ||
            (region.action === "slowdown" && (!Number.isFinite(region.slowdown_ratio) ||
                region.slowdown_ratio < 0.05 || region.slowdown_ratio > 0.95)));
        if (!cfg.cloud_topic.startsWith("/") || !numeric.every(Number.isFinite) ||
            cfg.min_range >= cfg.max_range || cfg.min_height >= cfg.max_height || invalidRegion) {
            showNotification("请检查点云话题、检测范围、点数阈值和体素参数", "error");
            return false;
        }
        if (cfg.enabled && (!enabledRegions.length || !enabledRegions.some(region => region.action === "stop"))) {
            showNotification("启用分区防护前，至少启用一个区域并保留一个停车区", "error");
            return false;
        }
        if (cfg.regions.length > 8) {
            showNotification("最多添加 8 个检测区域", "error");
            return false;
        }
        const ids = cfg.regions.map(region => region.id);
        if (new Set(ids).size !== ids.length) {
            showNotification("检测区域标识重复，请重新加载页面后再编辑", "error");
            return false;
        }
        return true;
    }

    function stableStringify(value) {
        if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
        if (value && typeof value === "object") {
            return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
        }
        return JSON.stringify(value);
    }

    function updateProtectionPreview() {
        const cfg = collectProtectionConfig();
        const group = document.getElementById("protectionPreviewZones");
        if (!group) return;
        group.replaceChildren();
        const ns = "http://www.w3.org/2000/svg";
        const scale = 42;
        const cx = 160;
        const cy = 125;
        cfg.regions.forEach(region => {
            if (![region.x_min, region.x_max, region.y_min, region.y_max].every(Number.isFinite)) return;
            const rect = document.createElementNS(ns, "rect");
            rect.setAttribute("x", String(cx - region.y_max * scale));
            rect.setAttribute("y", String(cy - region.x_max * scale));
            rect.setAttribute("width", String((region.y_max - region.y_min) * scale));
            rect.setAttribute("height", String((region.x_max - region.x_min) * scale));
            rect.setAttribute("rx", "3");
            rect.setAttribute("class", `protection-zone-shape ${region.action === "stop" ? "zone-stop" : "zone-slow"} ${region.enabled ? "zone-enabled" : "zone-disabled"}`);
            group.append(rect);
        });
        const pill = document.getElementById("protectionStatePill");
        pill.textContent = cfg.enabled ? "启用待验证" : "未启用";
        pill.classList.toggle("protection-state-active", cfg.enabled);
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

        const extrinsics = {
            x_mm: Number(document.getElementById("radarExtX").value),
            y_mm: Number(document.getElementById("radarExtY").value),
            z_mm: Number(document.getElementById("radarExtZ").value),
            yaw: Number(document.getElementById("radarExtYaw").value),
            pitch: Number(document.getElementById("radarExtPitch").value),
            roll: Number(document.getElementById("radarExtRoll").value)
        };
        const oldExtrinsics = currentConfig?.lidars?.[0]?.extrinsics || {};
        const mountChanged = currentConfig?.deployment?.mount_configured !== true ||
            Object.entries(extrinsics).some(([key, value]) => Number(oldExtrinsics[key]) !== value);
        if (mountChanged && !document.getElementById("radarMountConfirmed").checked) {
            showNotification("外参尚未写入：请勾选“已按车体 base_link 坐标系测量并核对本次安装外参”", "error");
            btnSave.disabled = false;
            btnSave.innerText = "💾 保存配置";
            document.getElementById("radarMountConfirmed").focus();
            return;
        }

        const payload = {
            lidar_model: model,
            model_change_confirmed: document.getElementById("radarModelConfirmed").checked,
            mount_confirmed: document.getElementById("radarMountConfirmed").checked,
            host_ip: document.getElementById("radarHostIp").value.trim(),
            device_ip: document.getElementById("radarDeviceIp").value.trim(),
            extrinsics
        };
        const obstacleProtection = collectProtectionConfig();
        if (!validateProtectionConfig(obstacleProtection)) {
            btnSave.disabled = false;
            btnSave.innerText = "💾 保存配置";
            return;
        }
        if (stableStringify(obstacleProtection) !== stableStringify(currentConfig?.obstacle_protection || DEFAULT_PROTECTION_CONFIG)) {
            payload.obstacle_protection = obstacleProtection;
        }

        try {
            const res = await fetch(`${API_BASE}/api/v1/lidar/config`, {
                method: "POST",
                headers: { "Content-Type": "application/json",
                           "Authorization": localStorage.getItem("token") || "" },
                body: JSON.stringify(payload)
            });
            const json = await res.json();
            if (json.code === 0) {
                showNotification("配置已保存；按配置变化停车后重启 ROS 核心/导航服务，再点“验证生效”", "success");
                await loadConfig();
            } else {
                showNotification(json.message || json.detail || `保存失败: ${res.status}`, "error");
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
        const inlineNotice = document.getElementById("radarNotification");
        if (inlineNotice) {
            inlineNotice.textContent = msg;
            inlineNotice.dataset.kind = type;
            inlineNotice.hidden = false;
            return;
        }
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
