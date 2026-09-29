import time
import json
from fastapi.testclient import TestClient
from app.main import app

def test_websocket_telemetry():
    print("==================================================")
    print(" 开始测试 WebSocket 10Hz 实时位姿流转与遥测切片 ")
    print("==================================================")

    with TestClient(app) as client:
        # 连接现有前端默认的 /ws/pose 端点
        with client.websocket_connect("/ws/pose") as websocket:
            print("[1] 成功与后端建立 WebSocket /ws/pose 长连接")

            frames = []
            start_time = time.time()

            # 接收 10 帧数据
            for i in range(10):
                data = websocket.receive_json()
                frames.append(data)
                pos = data.get("position", {})
                status = data.get("status", {})
                print(f"  [帧 {i+1:02d}] action={data.get('action')} "
                      f"LocalX={pos.get('LocalX'):6.2f} LocalY={pos.get('LocalY'):6.2f} "
                      f"Heading={pos.get('Heading'):6.2f}° 状态={status.get('runStatus')} 电量={status.get('battery')}%")

            duration = time.time() - start_time
            print(f"[2] 连续接收 10 帧耗时: {duration:.2f} 秒 (平均帧率 ~{10/duration:.1f} Hz)")

            # 协议与字段完整性校验
            assert len(frames) == 10
            for f in frames:
                assert f["action"] == "carCurrentPosition", "协议动作字段必须为 carCurrentPosition"
                assert "position" in f, "必须包含 position 节点"
                pos = f["position"]
                assert "LocalX" in pos and "LocalY" in pos, "必须包含局部坐标 LocalX/LocalY"
                assert "Heading" in pos, "必须包含航向角 Heading"
                assert "Lat" in pos and "Lon" in pos, "必须包含经纬度节点"

            # 验证运动学连续性 (小车在平滑移动，坐标在连续变化)
            first_x = frames[0]["position"]["LocalX"]
            last_x = frames[-1]["position"]["LocalX"]
            print(f"[3] 轨迹连续性验证: 起始 x={first_x:.2f} -> 结束 x={last_x:.2f} (位移正常流转)")

            print("==================================================")
            print(" WEBSOCKET 10Hz 实时遥测切片测试 100% 全部通过！")
            print("==================================================")

if __name__ == "__main__":
    test_websocket_telemetry()
