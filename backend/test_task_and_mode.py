import unittest
import asyncio
from fastapi.testclient import TestClient

from app.main import app
from app.database import init_db

class TestTaskAndMode(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        asyncio.run(init_db())
        cls.client = TestClient(app)

    def test_01_task_lifecycle(self):
        """测试任务创建、查询、更新与删除"""
        # 1. 创建任务
        add_res = self.client.post("/task/add", json={
            "description": "车间巡检任务001",
            "routeId": "1",
            "routeName": "Test_Route_Alpha",
            "priority": "high",
            "executionType": "loop"
        })
        self.assertEqual(add_res.status_code, 200)
        task_data = add_res.json()["data"]
        task_id = task_data["id"]
        print(f"[PASS] POST /task/add: 成功创建任务 ID={task_id}, 描述={task_data['description']}")

        # 2. 查询列表
        list_res = self.client.get("/task/queryall")
        self.assertEqual(list_res.status_code, 200)
        tasks = list_res.json()["data"]
        self.assertTrue(any(t["id"] == task_id for t in tasks))
        print(f"[PASS] GET /task/queryall: 任务总数={len(tasks)}")

        # 3. 更新任务
        up_res = self.client.post("/task/update", json={
            "id": task_id,
            "description": "车间巡检任务001(已加急)",
            "priority": "urgent"
        })
        self.assertEqual(up_res.status_code, 200)
        self.assertEqual(up_res.json()["code"], 0)
        print(f"[PASS] POST /task/update: 成功更新任务为 urgent")

    def test_02_order_creation_and_query(self):
        """测试工单调度与历史查询"""
        order_res = self.client.post("/order/add", json={
            "routeId": 1,
            "stationIds": "1,2,3",
            "userAccount": "dispatcher_01"
        })
        self.assertEqual(order_res.status_code, 200)
        order_data = order_res.json()["data"]
        self.assertIn("orderNo", order_data)
        print(f"[PASS] POST /order/add: 工单创建成功 -> 订单号={order_data['orderNo']}")

        list_res = self.client.get("/order/queryall")
        self.assertEqual(list_res.status_code, 200)
        self.assertGreater(len(list_res.json()["data"]), 0)
        print(f"[PASS] GET /order/queryall: 成功获取工单列表，数量={len(list_res.json()['data'])}")

    def test_03_real_mode_actions_fail_closed_without_ros(self):
        login=self.client.post("/user/login",json={"userAccount":"admin","userPassword":"admin"}).json()
        headers={"Authorization":login["data"]}
        self.assertEqual(self.client.post("/api/v1/system/emergency_stop").status_code,401)
        for endpoint,payload in [("mode/switch",{"mode":"NAVIGATION"}),
                                 ("mode/switch",{"mode":"MAPPING"}),
                                 ("emergency_stop",{}),("resume",{})]:
            response=self.client.post("/api/v1/system/"+endpoint,json=payload,headers=headers)
            self.assertEqual(response.status_code,409,response.text)
        self.assertFalse(self.client.get("/api/v1/system/mode").json()["data"]["can_navigate"])

if __name__ == "__main__":
    unittest.main()
