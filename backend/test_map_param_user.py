import unittest
import asyncio
from fastapi.testclient import TestClient

from app.main import app
from app.database import init_db

class TestMapParamUser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 确保数据库表已初始化
        asyncio.run(init_db())
        cls.client = TestClient(app)

    def test_01_pgm_map_list(self):
        """测试 PGM 地图目录树获取"""
        res = self.client.get("/pgm/list")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["code"], 0)
        self.assertIsInstance(data["data"], list)
        print(f"[PASS] GET /pgm/list: 找到 {len(data['data'])} 个地图节点 -> {[m['name'] for m in data['data']]}")

    def test_02_pgm_file_download(self):
        """测试获取指定地图的 PGM 与 YAML 文件流"""
        # 取列表中第一个存在的地图
        list_res = self.client.get("/pgm/list").json()
        if list_res["data"]:
            map_name = list_res["data"][0]["name"]
            
            # PGM 二进制
            pgm_res = self.client.get(f"/pgm/file/pgm/{map_name}")
            self.assertEqual(pgm_res.status_code, 200)
            self.assertGreater(len(pgm_res.content), 0)
            print(f"[PASS] GET /pgm/file/pgm/{map_name}: 字节大小={len(pgm_res.content)}")

            # YAML 文本
            yaml_res = self.client.get(f"/pgm/file/yaml/{map_name}")
            self.assertEqual(yaml_res.status_code, 200)
            self.assertIn("resolution", yaml_res.text)
            print(f"[PASS] GET /pgm/file/yaml/{map_name}: 包含 resolution={yaml_res.text.strip().splitlines()[2]}")

    def test_03_pcd_list(self):
        """测试 PCD 点云列表"""
        res = self.client.get("/pcd/list")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["code"], 0)
        print(f"[PASS] GET /pcd/list: 成功获取，总数={len(data['data'])}")

    def test_04_param_query_and_update(self):
        """测试参数查询与高速缓存更新"""
        # 查询参数
        query_res = self.client.get("/param/queryalldata")
        self.assertEqual(query_res.status_code, 200)
        q_data = query_res.json()
        self.assertEqual(q_data["code"], 0)
        self.assertGreater(len(q_data["data"]), 0)
        param_item = q_data["data"][0]
        print(f"[PASS] GET /param/queryalldata: 当前速度限制={param_item.get('speed_run', 'N/A')}")

        # 更新参数
        update_payload = {"id": param_item["id"], "speed_run": "0.55"}
        up_res = self.client.post("/param/update", json=update_payload)
        self.assertEqual(up_res.status_code, 200)
        self.assertEqual(up_res.json()["code"], 0)

        # 再次查询验证缓存已同步刷新
        verify_res = self.client.get("/param/queryalldata").json()
        self.assertEqual(verify_res["data"][0]["speed_run"], "0.55")
        print(f"[PASS] POST /param/update: 成功修改为 0.55 并同步刷新内存缓存")

    def test_05_user_login(self):
        """测试管理员登录与令牌生成"""
        login_res = self.client.post("/user/login", json={"userAccount": "admin", "userPassword": "admin"})
        self.assertEqual(login_res.status_code, 200)
        data = login_res.json()
        self.assertEqual(data["code"], 0)
        token = data["data"]
        self.assertTrue(token.startswith("agv_admin_"))
        print(f"[PASS] POST /user/login: 成功登录并签发令牌 -> {token[:20]}...")

    def test_06_lidar_config(self):
        """测试已登录维护人员读取当前雷达型号。"""
        login = self.client.post("/user/login", json={"userAccount": "admin", "userPassword": "admin"})
        token = login.json()["data"]
        res = self.client.get("/api/v1/lidar/config", headers={"Authorization": token})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["code"], 0)
        cfg = data["data"]
        self.assertIn("lidar_model", cfg)
        print(f"[PASS] GET /api/v1/lidar/config: 型号={cfg['lidar_model']}, 雷达数量={cfg['lidar_count']}, 主机IP={cfg['host_ip']}")

    def test_07_license_status(self):
        """测试授权状态诊断 (已脱机放行)"""
        res = self.client.get("/api/v1/system/license/status")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["code"], 0)
        lic = data["data"]
        self.assertTrue(lic["is_authorized"])
        print(f"[PASS] GET /api/v1/system/license/status: 授权状态={lic['license_mode']}, 机器码={lic['hardware_id']}")

if __name__ == "__main__":
    unittest.main()
