# ROS地图坐标系转换指南

## 概述
本文档详细说明了ROS导航系统中地图坐标系、世界坐标系和Canvas像素坐标系之间的转换关系。

## 坐标系定义

### 1. 地图坐标系（Map Coordinate System）
- **原点**：地图左下角(0,0)
- **单位**：像素
- **X轴**：向右递增
- **Y轴**：向上递增

### 2. 世界坐标系（World Coordinate System）
- **原点**：由yaml文件中的origin参数定义
- **单位**：米
- **X轴**：向右递增
- **Y轴**：向上递增

### 3. Canvas像素坐标系（Canvas Coordinate System）
- **原点**：Canvas左上角(0,0)
- **单位**：像素
- **X轴**：向右递增
- **Y轴**：向下递增

## YAML文件参数说明

```yaml
image: map.pgm          # 地图图片文件
mode: trinary          # 地图模式
resolution: 0.05       # 分辨率（米/像素）
origin: [-7.46, -5.28, 0]  # 地图原点在世界坐标系中的位置[x,y,theta]
negate: 0              # 是否反转颜色
occupied_thresh: 0.65  # 占用阈值
free_thresh: 0.25      # 空闲阈值
```

## 坐标转换公式

### 1. 世界坐标 → 地图坐标（像素）
```
map_x = (world_x - origin_x) / resolution
map_y = (world_y - origin_y) / resolution
```

### 2. 地图坐标 → Canvas像素坐标
```
canvas_x = map_x * (canvas_width / map_width)
canvas_y = canvas_height - map_y * (canvas_height / map_height)
```

### 3. 世界坐标 → Canvas像素坐标（完整流程）
```javascript
function worldToPixel(worldX, worldY) {
    const { origin, resolution } = config;
    const { width: mapWidth, height: mapHeight } = pgmData;
    const { clientWidth: canvasWidth, clientHeight: canvasHeight } = canvas;
    
    // 世界坐标 → 地图坐标
    const mapX = (worldX - origin[0]) / resolution;
    const mapY = (worldY - origin[1]) / resolution;
    
    // 地图坐标 → Canvas像素坐标
    const pixelX = mapX * (canvasWidth / mapWidth);
    const pixelY = canvasHeight - mapY * (canvasHeight / mapHeight);
    
    return [pixelX, pixelY];
}
```

### 4. Canvas像素坐标 → 世界坐标（反向转换）
```javascript
function pixelToWorld(pixelX, pixelY) {
    const { origin, resolution } = config;
    const { width: mapWidth, height: mapHeight } = pgmData;
    const { clientWidth: canvasWidth, clientHeight: canvasHeight } = canvas;
    
    // Canvas像素坐标 → 地图坐标
    const mapX = pixelX / (canvasWidth / mapWidth);
    const mapY = (canvasHeight - pixelY) / (canvasHeight / mapHeight);
    
    // 地图坐标 → 世界坐标
    const worldX = origin[0] + mapX * resolution;
    const worldY = origin[1] + mapY * resolution;
    
    return { x: worldX, y: worldY };
}
```

## 实际计算示例

### 示例参数
- origin: [-7.46, -5.28, 0]
- resolution: 0.05 米/像素
- 地图尺寸: 400×300 像素
- Canvas尺寸: 800×600 像素

### 计算案例

#### 案例1：世界坐标(0, 0) → 像素坐标
1. 地图坐标：
   - map_x = (0 - (-7.46)) / 0.05 = 149.2 像素
   - map_y = (0 - (-5.28)) / 0.05 = 105.6 像素

2. Canvas像素坐标：
   - canvas_x = 149.2 × (800/400) = 298.4 像素
   - canvas_y = 600 - 105.6 × (600/300) = 388.8 像素

#### 案例2：像素坐标(400, 300) → 世界坐标
1. 地图坐标：
   - map_x = 400 / (800/400) = 200 像素
   - map_y = (600 - 300) / (600/300) = 150 像素

2. 世界坐标：
   - world_x = -7.46 + 200 × 0.05 = 2.54 米
   - world_y = -5.28 + 150 × 0.05 = 2.22 米

## 关键注意事项

### 1. 轴向问题
- Canvas的Y轴向下，而地图和世界的Y轴向上，需要进行翻转
- 翻转公式：`canvas_y = canvas_height - calculated_y`

### 2. 比例因子
- 使用实际Canvas尺寸与地图像素尺寸的比例进行缩放
- 确保地图不变形：保持宽高比例一致

### 3. 边界检查
- 转换后的坐标应在Canvas范围内：0 ≤ x ≤ canvas_width, 0 ≤ y ≤ canvas_height
- 世界坐标应在地图有效范围内：origin_x ≤ x ≤ origin_x + map_width×resolution

### 4. 精度控制
- 浮点计算可能存在精度误差，建议保留2-3位小数
- 对于关键位置点，建议进行四舍五入处理

## 应用场景

### 1. 机器人位姿显示
```javascript
// 将机器人世界坐标显示在Canvas上
const [robotPixelX, robotPixelY] = worldToPixel(robotWorldX, robotWorldY);
drawRobot(robotPixelX, robotPixelY, robotOrientation);
```

### 2. 用户点击事件
```javascript
// 将Canvas点击位置转换为ROS世界坐标
const worldPos = pixelToWorld(clickX, clickY);
publishGoalPose(worldPos.x, worldPos.y);
```

### 3. 路径规划
```javascript
// 将路径点从世界坐标映射到Canvas进行显示
pathPoints.forEach(point => {
    const [px, py] = worldToPixel(point.x, point.y);
    drawPathPoint(px, py);
});
```

## 调试建议

### 1. 验证转换正确性
- 使用已知的世界坐标点进行测试
- 检查转换后的像素位置是否符合预期

### 2. 可视化调试
- 在Canvas上绘制坐标网格
- 标记原点和关键参考点

### 3. 日志记录
- 记录转换前后的坐标值
- 监控转换过程中的中间变量

## 常见问题

### Q1: 转换后的坐标为负数或超出范围
**原因**：输入的世界坐标超出地图有效范围
**解决**：检查世界坐标是否在有效范围内

### Q2: 地图显示颠倒
**原因**：Y轴翻转处理不正确
**解决**：确认使用了正确的翻转公式

### Q3: 比例不正确
**原因**：比例因子计算错误
**解决**：检查Canvas和地图的实际尺寸

---

*最后更新：2024年*