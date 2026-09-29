# 车辆安全区域配置保存 API 文档

## 1. 接口描述

该接口用于保存车辆安全区域的配置信息，包括高速直行、左转、右转三种状态下的参数配置。

## 2. API 端点

```
POST /api/obstacle-avoidance/save
```

## 3. 请求参数

| 参数名 | 类型 | 必填 | 描述 |
|--------|------|------|------|
| goStraight | string | 是 | 高速直行状态的配置，包含车辆参数和安全区域参数的JSON字符串，用于定义车辆在高速直行时的安全区域边界 |
| turnLeft | string | 是 | 左转状态的配置，包含车辆参数和安全区域参数的JSON字符串，用于定义车辆在左转时的安全区域边界 |
| turnRight | string | 是 | 右转状态的配置，包含车辆参数和安全区域参数的JSON字符串，用于定义车辆在右转时的安全区域边界 |
| routeWidth | number | 是 | 道路宽度（单位：cm），用于定义车辆行驶道路的总宽度，影响安全区域的横向范围 |

### 状态配置 JSON 结构

每个状态配置（goStraight/turnLeft/turnRight）包含以下参数，这些参数共同定义了车辆在特定状态下的安全区域：

| 参数名 | 类型 | 描述 |
|--------|------|------|
| vehicleLength | number | 车辆长度（单位：cm），用于计算车辆前端和后端的位置，影响安全区域的纵向范围 |
| vehicleWidth | number | 车辆宽度（单位：cm），用于计算车辆左侧和右侧的边界，影响安全区域的横向范围 |
| stopZoneLength | number | 停车区域长度（单位：cm），红色紧急停车区域的长度，当检测到障碍物时车辆需要立即停车 |
| zoneWidth | number | 统一区域宽度（单位：cm），用于同步所有安全区域的宽度参数，确保各区域宽度一致 |
| slowZoneLength | number | 二级减速区域长度（单位：cm），黄色二级减速区域的长度，车辆进入该区域时需要减速行驶 |
| slowZoneWidth | number | 二级减速区域宽度（单位：cm），黄色二级减速区域的宽度，通常与统一区域宽度保持一致 |
| leftTurnDistance | number | 左转检测距离（单位：cm），车辆左转时的障碍物检测距离，影响转向轨迹的规划 |
| rightTurnDistance | number | 右转检测距离（单位：cm），车辆右转时的障碍物检测距离，影响转向轨迹的规划 |
| secondarySlowZoneLength | number | 一级减速区域长度（单位：cm），橙色一级减速区域的长度，车辆进入该区域时需要进一步减速 |
| secondarySlowZoneWidth | number | 一级减速区域宽度（单位：cm），橙色一级减速区域的宽度，通常与统一区域宽度保持一致 |

## 4. 请求示例

### 详细注释版示例

```json
{
  "goStraight": "{\"vehicleLength\":100,\"vehicleWidth\":50,\"stopZoneLength\":80,\"zoneWidth\":50,\"slowZoneLength\":200,\"slowZoneWidth\":50,\"leftTurnDistance\":80,\"rightTurnDistance\":80,\"secondarySlowZoneLength\":150,\"secondarySlowZoneWidth\":50}",  // 高速直行状态配置
  "turnLeft": "{\"vehicleLength\":100,\"vehicleWidth\":50,\"stopZoneLength\":80,\"zoneWidth\":50,\"slowZoneLength\":200,\"slowZoneWidth\":50,\"leftTurnDistance\":80,\"rightTurnDistance\":80,\"secondarySlowZoneLength\":150,\"secondarySlowZoneWidth\":50}",  // 左转状态配置
  "turnRight": "{\"vehicleLength\":100,\"vehicleWidth\":50,\"stopZoneLength\":80,\"zoneWidth\":50,\"slowZoneLength\":200,\"slowZoneWidth\":50,\"leftTurnDistance\":80,\"rightTurnDistance\":80,\"secondarySlowZoneLength\":150,\"secondarySlowZoneWidth\":50}",  // 右转状态配置
  "routeWidth": 250  // 道路宽度，单位：cm
}
```

### 状态配置JSON字符串展开示例

以下是`goStraight`参数的JSON字符串展开形式，展示了内部各个参数的详细含义：

```json
{
  "vehicleLength": 100,  // 车辆长度：100cm
  "vehicleWidth": 50,     // 车辆宽度：50cm
  "stopZoneLength": 80,   // 红色停车区域长度：80cm
  "zoneWidth": 50,        // 统一区域宽度：50cm
  "slowZoneLength": 200,  // 黄色二级减速区域长度：200cm
  "slowZoneWidth": 50,    // 黄色二级减速区域宽度：50cm
  "leftTurnDistance": 80, // 左转检测距离：80cm
  "rightTurnDistance": 80,// 右转检测距离：80cm
  "secondarySlowZoneLength": 150,  // 橙色一级减速区域长度：150cm
  "secondarySlowZoneWidth": 50     // 橙色一级减速区域宽度：50cm
}
```

## 5. 响应格式

### 成功响应

```json
{
  "code": 0,
  "data": true,
  "message": "保存成功"
}
```

### 失败响应

```json
{
  "code": 非0,
  "message": "保存失败的具体原因"
}
```

## 6. 响应参数说明

| 参数名 | 类型 | 描述 |
|--------|------|------|
| code | number | 响应状态码，0表示请求成功，非0表示请求失败，不同的非0值对应不同的错误类型 |
| data | boolean | 保存操作的结果，true表示配置已成功保存到数据库，false表示保存失败 |
| message | string | 响应消息，详细描述请求的处理结果，成功时返回"保存成功"，失败时返回具体的错误原因 |

## 7. 功能流程

1. 前端收集车辆安全区域配置参数
2. 将配置转换为数据库格式（高速直行、左转、右转三个状态）
3. 将每个状态的配置转换为JSON字符串
4. 调用API保存配置到后端
5. 后端验证并保存配置
6. 返回保存结果给前端

## 8. 错误处理

- 网络连接失败：前端提示"保存配置失败，请检查网络连接或服务器状态"
- 服务器错误：返回具体错误消息
- 参数验证失败：返回相应的错误提示

## 9. 相关接口

- GET /api/obstacle-avoidance/current：获取当前配置

## 10. 数据存储

配置数据同时保存到：
1. 后端数据库
2. 前端localStorage（作为备份）

## 11. 使用场景

- 车辆安全区域参数调整后保存
- 系统启动时加载配置
- 不同车辆或场景配置切换

## 12. 注意事项

1. 所有参数值必须为正数
2. 车辆宽度不能超过区域宽度
3. 配置会立即生效，影响车辆安全区域的可视化和实际避障功能
4. 建议在调整配置后进行测试验证
