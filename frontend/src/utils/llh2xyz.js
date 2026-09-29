/**
 * 经纬度坐标转换工具类
 * 将Java的Llh2xyzController转换为JavaScript版本
 */

class Llh2xyz {
    constructor(lat = 0, lon = 0, height = 0, x = 0, y = 0, z = 0, east = 0, north = 0, up = 0) {
        this.lat = lat;    // 纬度
        this.lon = lon;    // 经度
        this.height = height; // 高度
        this.x = x;        // ECEF X坐标
        this.y = y;        // ECEF Y坐标
        this.z = z;        // ECEF Z坐标
        this.east = east;  // 东坐标
        this.north = north;// 北坐标
        this.up = up;      // 天坐标
    }
}

class Llh2xyzConverter {
    constructor() {
        // WGS84椭球参数
        this.a = 6378137.0;        // 长半轴（米）
        this.f = 1.0 / 298.257223563; // 扁率
        this.b = this.a * (1.0 - this.f); // 短半轴（米）
        this.e2 = 2 * this.f - this.f * this.f; // 第一偏心率平方
        this.epsilon = 1e-12;      // 迭代终止阈值
    }

    /**
     * 将目标经纬度点转换为相对于局部坐标原点的相对x和y坐标
     * @param {number} localLat - 局部坐标原点纬度
     * @param {number} localLon - 局部坐标原点经度
     * @param {number} targetLat - 目标点纬度
     * @param {number} targetLon - 目标点经度
     * @returns {number[]} [dx, dy, dz] 相对坐标
     */
    convertToLocalCoordinates(localLat, localLon, targetLat, targetLon) {
        const orig = new Llh2xyz(); // 原点
        orig.lon = localLon;
        orig.lat = localLat;
        orig.height = 0;
        
        const curr = new Llh2xyz(); // 目标点
        curr.lon = targetLon;
        curr.lat = targetLat;
        curr.height = 4.21;
        
        // 偏心率
        const origloc = this.geodeticToCartesian(curr);
        const enuloc = this.ecefToEnu(orig, origloc);
        
        // 修改坐标映射：y映射为北向，x映射为东向
        const dy = enuloc.north;  // y轴映射为北向
        const dx = enuloc.east;   // x轴映射为东向
        const dz = enuloc.up;
        
        return [dx, dy, dz];
    }

    /**
     * ECEF转ENU（东北天）坐标系
     * @param {Llh2xyz} ref - 参考点
     * @param {Llh2xyz} target - 目标点
     * @returns {Llh2xyz} ENU坐标
     */
    ecefToEnu(ref, target) {
        const ref_ = this.geodeticToCartesian(ref);
        const d = new Llh2xyz();
        
        // 计算相对位移
        d.x = target.x - ref_.x;
        d.y = target.y - ref_.y;
        d.z = target.z - ref_.z;
        
        // 转换为弧度
        const lat_rad = ref.lat * Math.PI / 180.0;
        const lon_rad = ref.lon * Math.PI / 180.0;
        
        const SIN_lon_rad = Math.sin(lon_rad);
        const SIN_lat_rad = Math.sin(lat_rad);
        const COS_lat_rad = Math.cos(lat_rad);
        const COS_lon_rad = Math.cos(lon_rad);
        
        const temp = new Llh2xyz();
        // ENU转换矩阵（方向余弦矩阵）
        temp.east = -SIN_lon_rad * d.x + COS_lon_rad * d.y;
        temp.north = -SIN_lat_rad * COS_lon_rad * d.x - SIN_lat_rad * SIN_lon_rad * d.y + COS_lat_rad * d.z;
        temp.up = COS_lat_rad * COS_lon_rad * d.x + COS_lat_rad * SIN_lon_rad * d.y + SIN_lat_rad * d.z;
        
        return temp;
    }

    /**
     * 大地坐标转ECEF直角坐标
     * @param {Llh2xyz} llh2xyz - 大地坐标
     * @returns {Llh2xyz} ECEF坐标
     */
    geodeticToCartesian(llh2xyz) {
        const loc = new Llh2xyz();
        const lat_rad = llh2xyz.lat * Math.PI / 180.0;
        const lon_rad = llh2xyz.lon * Math.PI / 180.0;
        const N = this.a / Math.sqrt(1 - this.e2 * Math.pow(Math.sin(lat_rad), 2));
        
        loc.x = (N + llh2xyz.height) * Math.cos(lat_rad) * Math.cos(lon_rad);
        loc.y = (N + llh2xyz.height) * Math.cos(lat_rad) * Math.sin(lon_rad);
        loc.z = (N * (1 - this.e2) + llh2xyz.height) * Math.sin(lat_rad);
        
        return loc;
    }

    /**
     * 将局部坐标反解为经纬度
     * @param {number} localLat - 局部坐标原点纬度
     * @param {number} localLon - 局部坐标原点经度
     * @param {number} dx - X方向位移
     * @param {number} dy - Y方向位移
     * @param {number} dz - Z方向位移
     * @returns {number[]} [lat, lon] 经纬度
     */
    convertFromLocalCoordinates(localLat, localLon, dx, dy, dz) {
        // 修改坐标映射：y映射为北向，x映射为东向
        const north = dy;     // y轴映射为北向
        const east = dx;      // x轴映射为东向
        const up = dz;
        const ref = new Llh2xyz();
        
        ref.lat = localLat;
        ref.lon = localLon;
        ref.height = 0;
        
        const llh2xyz = this.enuToGeodetic(ref, east, north, up);
        
        // 转换为度数并返回结果
        return [llh2xyz.lat, llh2xyz.lon];
    }

    /**
     * ENU（东北天）坐标系转ECEF再转大地坐标
     * @param {Llh2xyz} ref - 参考点
     * @param {number} east - 东坐标
     * @param {number} north - 北坐标
     * @param {number} up - 天坐标
     * @returns {Llh2xyz} 大地坐标
     */
    enuToGeodetic(ref, east, north, up) {
        // 1. 将参考点从大地坐标转换为ECEF坐标
        const refEcef = this.geodeticToCartesian(ref);
        
        // 2. 将ENU坐标转换为ECEF坐标
        const targetEcef = this.enuToEcef(ref, refEcef, east, north, up);
        
        // 3. 将ECEF坐标转换为大地坐标
        return this.cartesianToGeodetic(targetEcef);
    }

    /**
     * ENU坐标转ECEF坐标
     * @param {Llh2xyz} ref - 参考点
     * @param {Llh2xyz} refEcef - 参考点ECEF坐标
     * @param {number} east - 东坐标
     * @param {number} north - 北坐标
     * @param {number} up - 天坐标
     * @returns {Llh2xyz} ECEF坐标
     */
    enuToEcef(ref, refEcef, east, north, up) {
        // 转换为弧度
        const latRad = ref.lat * Math.PI / 180.0;
        const lonRad = ref.lon * Math.PI / 180.0;
        
        const N_ref = this.a / Math.sqrt(1 - this.e2 * Math.pow(Math.sin(latRad), 2));
        
        const sinLat = Math.sin(latRad);
        const cosLat = Math.cos(latRad);
        const sinLon = Math.sin(lonRad);
        const cosLon = Math.cos(lonRad);
        
        // ENU到ECEF的转换矩阵（方向余弦矩阵的转置）
        const dx = -sinLon * east - sinLat * cosLon * north + cosLat * cosLon * up;
        const dy = cosLon * east - sinLat * sinLon * north + cosLat * sinLon * up;
        const dz = cosLat * north + sinLat * up;
        
        // 计算目标点ECEF坐标
        const target = new Llh2xyz();
        target.x = refEcef.x + dx;
        target.y = refEcef.y + dy;
        target.z = refEcef.z + dz;
        
        return target;
    }

    /**
     * ECEF直角坐标转大地坐标
     * @param {Llh2xyz} ecef - ECEF坐标
     * @returns {Llh2xyz} 大地坐标
     */
    cartesianToGeodetic(ecef) {
        const llh = new Llh2xyz();
        
        const x = ecef.x;
        const y = ecef.y;
        const z = ecef.z;
        
        const p = Math.sqrt(x * x + y * y);
        let theta = Math.atan2(z, p * (1 - this.e2));
        
        let phi_prev;
        let iter = 0;
        do {
            phi_prev = theta;
            const sin_phi = Math.sin(theta);
            const N = this.a / Math.sqrt(1 - this.e2 * sin_phi * sin_phi);
            theta = Math.atan2(z + this.e2 * N * sin_phi, p);
            iter++;
        } while (Math.abs(theta - phi_prev) > this.epsilon && iter < 100);
        
        const sin_phi = Math.sin(theta);
        const N = this.a / Math.sqrt(1 - this.e2 * sin_phi * sin_phi);
        
        // 经度计算
        const lonRad = Math.atan2(y, x);
        
        // 高度计算
        const height = p / Math.cos(theta) - N;
        
        // 转换为度
        llh.lat = theta * 180.0 / Math.PI;
        llh.lon = lonRad * 180.0 / Math.PI;
        llh.height = height;
        
        return llh;
    }
}

// 创建全局实例，方便使用
const llh2xyzConverter = new Llh2xyzConverter();

// 导出类和实例（支持多种模块系统）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Llh2xyz, Llh2xyzConverter, llh2xyzConverter };
} else if (typeof window !== 'undefined') {
    window.Llh2xyz = Llh2xyz;
    window.Llh2xyzConverter = Llh2xyzConverter;
    window.llh2xyzConverter = llh2xyzConverter;
}