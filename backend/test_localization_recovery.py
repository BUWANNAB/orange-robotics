"""Recovery orchestration tests use temporary files and fake ROS, without a database."""
import asyncio
import json
import math
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from app.services.localization_recovery import LocalizationRecovery, atomic_json


class FakeBridge:
    def __init__(self):
        self.switch = {"status": "idle"}
        self.navigation = {"status": "idle"}
        self.relocalization = {"status": "idle"}
        self.control_lock = asyncio.Lock()
        self.inhibited = False
        self.lidar_received = time.monotonic()
        self.valid = False
        self.stationary = True
        self.auto_available = True
        self.calls = []
        self.stamp = 1

    def require_stationary(self):
        if not self.stationary:
            raise RuntimeError("停车反馈未就绪")

    def snapshot(self):
        return {"localization": {"valid": self.valid, "source": "ros", "frame_id": "map",
                                  "fitness": .1, "stamp": self.stamp},
                "position": {"LocalX": 12.35, "LocalY": 4.2, "Heading": 90},
                "auto_available": self.auto_available}

    async def switch_map(self, path, x, y, yaw):
        self.calls.append(("local", path, x, y, yaw))
        self.switch = {"status": "ready"}
        self.valid = True

    async def auto_localize(self, entry):
        self.calls.append(("global", entry["key"]))
        self.switch = {"status": "ready"}
        self.valid = True


class LocalizationRecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="localization-recovery-")
        self.root = Path(self.temp.name)
        self.pcd = self.root / "GlobalMap.pcd"
        self.pcd.write_bytes(b"map-a")
        self.entry = {"key": "A/GlobalMap.pcd", "asset_id": "A", "map_id": 7, "version": 2,
                      "pcd": str(self.pcd), "asset_revision": "revision-a"}
        self.bridge = FakeBridge()
        self.resolver = AsyncMock(side_effect=lambda criteria: dict(self.entry))
        self.guard = AsyncMock()
        self.service = AsyncMock()
        self.manager = LocalizationRecovery(self.bridge, self.resolver, self.guard, self.service,
                                            self.root / "recovery.json", poll_interval=.01)

    async def asyncTearDown(self):
        await self.manager.close()
        self.temp.cleanup()

    async def finish(self):
        await self.manager.task

    async def store_seed(self, **overrides):
        identity = await self.manager.identity(self.entry)
        record = {**identity, "x": 1., "y": 2., "yaw": .3, "fitness": .1,
                  "recorded_at": time.time(), **overrides}
        self.manager.store["poses"] = [record]
        return identity

    async def test_global_search_then_verified_pose_is_persisted_and_refresh_is_noop(self):
        result = await self.manager.activate({"map_id": 7})
        self.assertEqual(result["status"], "pending")
        await self.finish()
        self.assertEqual(self.bridge.calls, [("global", "A/GlobalMap.pcd")])
        stored = json.loads(self.manager.path.read_text())
        self.assertEqual(stored["selected"]["map_id"], 7)
        self.assertAlmostEqual(stored["poses"][0]["yaw"], math.pi / 2)
        self.assertEqual(self.bridge.recovery["status"], "ready")
        self.assertTrue(self.bridge.inhibited)
        self.bridge.navigation["status"] = "running"
        self.guard.side_effect = AssertionError("refresh must not inspect or interrupt tasks")
        result = await self.manager.activate({"map_id": 7})
        self.assertEqual(result["status"], "ready")
        self.assertEqual(len(self.bridge.calls), 1)

    async def test_same_map_seed_is_verified_with_new_scan_before_ready(self):
        await self.store_seed()
        await self.manager.activate({"map_id": 7})
        self.assertFalse(self.bridge.valid)
        await self.finish()
        self.assertEqual(self.bridge.calls, [("local", str(self.pcd), 1., 2., .3)])
        self.assertEqual(self.bridge.recovery["status"], "ready")

    async def test_persisted_compass_heading_is_normalized_for_recovery(self):
        await self.manager.activate({"map_id": 7})
        await self.finish()
        snapshot = self.bridge.snapshot()
        snapshot['position']['Heading'] = 270
        original = self.bridge.snapshot
        self.bridge.snapshot = lambda: snapshot
        try:
            await self.manager.save_pose(force=True)
            identity = await self.manager.identity(self.entry)
            self.assertAlmostEqual(self.manager.seed(identity)[2], -math.pi / 2)
        finally:
            self.bridge.snapshot = original

    async def test_failed_local_seed_falls_back_to_global_once(self):
        await self.store_seed()
        self.bridge.switch_map = AsyncMock(side_effect=RuntimeError("NDT did not converge"))
        await self.manager.activate({"map_id": 7})
        await self.finish()
        self.bridge.switch_map.assert_awaited_once_with(str(self.pcd), 1., 2., .3)
        self.assertEqual(self.bridge.calls, [("global", self.entry["key"])])

    async def test_changed_map_or_expired_seed_never_reuses_old_coordinates(self):
        await self.store_seed()
        self.pcd.write_bytes(b"map-b")
        self.entry.update(asset_id="B", key="B/GlobalMap.pcd", map_id=8)
        await self.manager.activate({"map_id": 8})
        await self.finish()
        self.assertEqual(self.bridge.calls, [("global", "B/GlobalMap.pcd")])
        self.bridge.valid = False
        self.bridge.switch = {"status": "idle"}
        await self.store_seed(recorded_at=time.time()-86401)
        await self.manager.activate({"map_id": 8})
        await self.finish()
        self.assertEqual([call[0] for call in self.bridge.calls], ["global", "global"])

    async def test_active_or_paused_route_refuses_switch_without_mutating_selection(self):
        self.bridge.navigation["status"] = "paused"
        with self.assertRaisesRegex(RuntimeError, "路线尚未结束"):
            await self.manager.activate({"map_id": 7})
        self.assertIsNone(self.manager.selected)
        self.assertFalse(self.manager.path.exists())
        self.assertFalse(self.bridge.inhibited)

    async def test_database_task_guard_prevents_cancellation_of_an_existing_mission(self):
        self.guard.side_effect = RuntimeError("任务执行中")
        with self.assertRaisesRegex(RuntimeError, "任务执行中"):
            await self.manager.activate({"map_id": 7})
        self.assertEqual(self.bridge.calls, [])

    async def test_cancellation_invalidates_result_and_new_selection_can_proceed(self):
        entered = asyncio.Event()
        async def searching(entry):
            entered.set()
            await asyncio.Event().wait()
        self.bridge.auto_localize = searching
        await self.manager.activate({"map_id": 7})
        await entered.wait()
        old = self.manager.task
        await self.manager.cancel()
        self.assertTrue(old.cancelled())
        self.assertEqual(self.bridge.switch["status"], "failed")
        self.assertEqual(self.bridge.recovery["status"], "cancelled")
        self.assertTrue(self.bridge.inhibited)
        self.assertEqual(self.manager.store["poses"], [])
        self.bridge.auto_localize = FakeBridge.auto_localize.__get__(self.bridge)
        self.entry.update(asset_id="B", key="B/GlobalMap.pcd", map_id=8)
        await self.manager.activate({"map_id": 8})
        await self.finish()
        self.assertEqual(self.bridge.switch["map_id"], 8)

    async def test_map_updated_during_search_does_not_become_ready_or_get_saved(self):
        async def changed(entry):
            await FakeBridge.auto_localize(self.bridge, entry)
            self.pcd.write_bytes(b"changed-during-search")
        self.bridge.auto_localize = changed
        await self.manager.activate({"map_id": 7})
        await self.finish()
        self.assertEqual(self.bridge.recovery["status"], "manual_required")
        self.assertEqual(self.bridge.switch["status"], "failed")
        self.assertEqual(self.manager.store["poses"], [])

    async def test_stale_or_invalid_localization_never_replaces_trusted_pose(self):
        identity = await self.store_seed()
        self.manager.active_identity = identity
        self.bridge.switch = {**identity, "status": "ready"}
        await self.manager.save_pose(force=True)
        self.assertFalse(self.manager.path.exists())
        self.bridge.valid = True
        await self.manager.save_pose(force=True)
        previous = self.manager.path.read_bytes()
        self.bridge.valid = False
        await self.manager.save_pose(force=True)
        self.assertEqual(self.manager.path.read_bytes(), previous)

    async def test_manual_relocalization_on_same_map_is_not_suppressed_as_refresh(self):
        await self.manager.activate({"map_id": 7})
        await self.finish()
        await self.manager.activate({"map_id": 7}, mode="manual", pose=[8., 9., -.5])
        await self.finish()
        self.assertEqual(self.bridge.calls[-1], ("local", str(self.pcd), 8., 9., -.5))

    async def test_startup_waits_for_dependencies_then_runs_once_and_stays_failed(self):
        identity = await self.manager.identity(self.entry)
        atomic_json(self.manager.path, {"schema": 1, "selected": identity, "poses": []})
        self.bridge.stationary = False
        self.manager.start()
        await asyncio.sleep(.035)
        self.assertEqual(self.bridge.recovery["status"], "waiting")
        self.assertEqual(self.bridge.calls, [])
        self.bridge.stationary = True
        self.bridge.auto_localize = AsyncMock(side_effect=RuntimeError("ambiguous shelves"))
        await asyncio.sleep(.08)
        self.assertEqual(self.bridge.recovery["status"], "manual_required")
        self.assertFalse(self.manager.startup_pending)
        self.bridge.auto_localize.assert_awaited_once()

    async def test_explicit_new_selection_cancels_pending_startup_even_if_not_ready(self):
        self.manager.startup_pending = True
        self.bridge.stationary = False
        with self.assertRaises(RuntimeError):
            await self.manager.activate({"map_id": 7})
        self.assertFalse(self.manager.startup_pending)

    async def test_bad_history_is_rejected_without_loading_untrusted_coordinates(self):
        self.manager.path.write_text('{"schema":1,"selected":{},"poses":[]}', encoding="utf-8")
        self.manager.start()
        await asyncio.sleep(.025)
        self.assertEqual(self.bridge.recovery["status"], "manual_required")
        self.assertEqual(self.bridge.calls, [])


if __name__ == "__main__":
    unittest.main()
