"""Authenticated activation API checks against the established isolated SQLite fixture."""
import asyncio
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import test_operations as fixtures  # Establish the isolated database before app imports.
from app.api import localization
from app.config import settings
from app.database import AsyncSessionLocal
from app.models.operations import MapDocument, TaskRun
from app.services.localization_recovery import LocalizationRecovery
from test_localization_recovery import FakeBridge


class LocalizationActivationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixtures.OperationsTests.setUpClass()
        cls.client = fixtures.OperationsTests.client
        cls.headers = fixtures.OperationsTests.headers

    @classmethod
    def tearDownClass(cls):
        fixtures.OperationsTests.tearDownClass()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="localization-api-")
        root = Path(self.temp.name)
        pcd = root / "pcd" / "A"
        pcd.mkdir(parents=True)
        (pcd / "GlobalMap.pcd").write_bytes(b"fixture map cloud")
        self.patches = [patch.object(settings, "PCD_DIR", root / "pcd"),
                        patch.object(settings, "RCS_DATA_DIR", root / "state"),
                        patch.dict("os.environ", {"ROS_MAP_CATALOG": "", "RCS_LOCAL_ROBOT_ID": ""})]
        for item in self.patches:
            item.start()
        async def create_map():
            async with AsyncSessionLocal() as db:
                row = MapDocument(name="activation-" + root.name, draft={"asset_id": "A", "asset_revision": "a"*64},
                                  operator="fixture")
                db.add(row)
                await db.commit()
                return row.id
        self.map_id = asyncio.run(create_map())
        self.robot_id = 1000000 + self.map_id
        scoped_robot = patch.dict('os.environ', {'RCS_LOCAL_ROBOT_ID': str(self.robot_id)})
        scoped_robot.start()
        self.patches.append(scoped_robot)
        self.bridge = FakeBridge()
        self.manager = LocalizationRecovery(self.bridge, localization.resolve_work_map,
                                            localization.require_no_active_tasks, AsyncMock(),
                                            root / "state" / "recovery.json")
        self.override = [patch.object(localization, "bridge", self.bridge),
                         patch.object(localization, "recovery", self.manager),
                         patch.object(localization, "switch_task", None)]
        for item in self.override:
            item.start()

    def tearDown(self):
        # Every test awaits/polls a terminal result before removing temporary storage.
        for item in reversed(self.override + self.patches):
            item.stop()
        self.temp.cleanup()

    def activate(self, body):
        return self.client.post("/api/localization/activate", headers=self.headers, json=body)

    def terminal(self):
        for _ in range(100):
            if self.manager.task and self.manager.task.done():
                return
            time.sleep(.01)
        self.fail("activation did not complete")

    def test_authenticated_activation_resolves_map_and_repeat_is_noop(self):
        self.assertEqual(self.client.post("/api/localization/activate", json={"map_id": self.map_id}).status_code, 401)
        self.assertEqual(self.activate({}).status_code, 422)
        response = self.activate({"map_id": self.map_id, "asset_id": "A"})
        self.assertEqual(response.status_code, 200, response.text)
        self.terminal()
        self.assertEqual(self.manager.bridge.recovery["status"], "ready")
        self.assertEqual(self.bridge.switch["map_id"], self.map_id)
        self.assertEqual(self.bridge.calls[0][0], "global")
        response = self.activate({"map_id": self.map_id})
        self.assertEqual(response.json()["data"]["status"], "ready")
        self.assertEqual(len(self.bridge.calls), 1)
        self.assertTrue(self.manager.path.is_file())

    def test_wrong_map_asset_and_caller_supplied_path_are_rejected(self):
        self.assertEqual(self.activate({"map_id": self.map_id, "asset_id": "B"}).status_code, 409)
        self.assertEqual(self.activate({"asset_id": "missing"}).status_code, 404)
        self.assertEqual(self.activate({"map_id": self.map_id, "pcd": "C:/outside.pcd"}).status_code, 422)
        self.assertEqual(self.bridge.calls, [])

    def test_database_active_task_blocks_activation_without_touching_ros(self):
        async def task():
            async with AsyncSessionLocal() as db:
                row = TaskRun(name="active-fixture", map_id=self.map_id, robot_id=self.robot_id,
                              from_point="A", to_point="B", status="running")
                db.add(row)
                await db.commit()
                return row.id
        task_id = asyncio.run(task())
        try:
            response = self.activate({"map_id": self.map_id})
            self.assertEqual(response.status_code, 409, response.text)
            self.assertEqual(self.bridge.calls, [])
        finally:
            async def cleanup():
                async with AsyncSessionLocal() as db:
                    row = await db.get(TaskRun, task_id)
                    row.status = "cancelled"
                    await db.commit()
            asyncio.run(cleanup())


if __name__ == "__main__":
    unittest.main()
