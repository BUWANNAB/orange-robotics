"""Recover a selected work map from verified poses, never from browser coordinates."""
import asyncio
import hashlib
import json
import logging
import math
import os
from pathlib import Path
import tempfile
import time
import uuid

from app.config import settings

log = logging.getLogger(__name__)
BUSY_ROUTES = {"sending", "accepted", "running", "pausing", "paused", "resuming"}
IDENTITY_FIELDS = ("key", "asset_id", "map_id", "version", "fingerprint", "frame", "asset_revision")


def same_map(left, right):
    return bool(left and right and all(left.get(key) == right.get(key) for key in IDENTITY_FIELDS))


def file_fingerprint(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=path.name + ".", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, ensure_ascii=False, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


class LocalizationRecovery:
    def __init__(self, bridge, resolver, task_guard, service_guard, storage_path=None, poll_interval=2):
        self.bridge, self.resolver = bridge, resolver
        self.task_guard, self.service_guard = task_guard, service_guard
        self.storage_path = storage_path
        self.poll_interval = poll_interval
        self.admission = asyncio.Lock()
        self.task = self.supervisor = None
        self.generation = 0
        self.startup_pending = False
        self.selected = self.active_identity = None
        self.store = {"schema": 1, "selected": None, "poses": []}
        self.last_save = 0.0
        self.last_stamp = None
        self.hash_cache = {}
        self._state("idle", "请选择作业地图")

    @property
    def path(self):
        return self.storage_path or settings.RCS_DATA_DIR / "localization-recovery.json"

    @property
    def busy(self):
        return self.task is not None and not self.task.done()

    def _state(self, status, message, identity=None, phase=None):
        entry = identity or self.selected or {}
        self.bridge.recovery = {"status": status, "phase": phase or status, "message": str(message),
                                "asset_id": entry.get("asset_id"), "map_id": entry.get("map_id"),
                                "version": entry.get("version"), "key": entry.get("key")}

    def _load(self):
        try:
            if self.path.stat().st_size > 512 * 1024:
                raise ValueError("定位恢复记录过大")
            value = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(value, dict) or value.get("schema") != 1:
                raise ValueError("定位恢复记录版本无效")
            selected = value.get("selected")
            if selected is not None and (not isinstance(selected, dict) or not selected.get("key")):
                raise ValueError("定位恢复记录缺少地图身份")
            poses = value.get("poses", [])
            if not isinstance(poses, list) or any(not isinstance(item, dict) for item in poses):
                raise ValueError("定位恢复记录格式无效")
            self.store = {"schema": 1, "selected": selected, "poses": poses[-32:]}
            self.selected = selected
        except FileNotFoundError:
            pass
        except (OSError, ValueError, TypeError) as exc:
            self._state("manual_required", f"历史定位记录不可用，请重新选择地图：{exc}")

    async def identity(self, entry, force=False):
        identity = dict(entry)
        path = Path(entry["pcd"])
        stat = await asyncio.to_thread(path.stat)
        signature = (stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
        cached = self.hash_cache.get(str(path))
        if force or not cached or cached[0] != signature:
            digest = await asyncio.to_thread(file_fingerprint, path)
            after = await asyncio.to_thread(path.stat)
            if signature != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise RuntimeError("读取期间定位地图已变化，请重试")
            self.hash_cache[str(path)] = (signature, digest)
        identity["fingerprint"] = self.hash_cache[str(path)][1]
        identity["frame"] = os.getenv("ROS_MAP_FRAME", "map")
        identity["asset_revision"] = entry.get("asset_revision", "")
        return identity

    def seed(self, identity):
        max_age = float(os.getenv("ROS_RECOVERY_MAX_SEED_AGE", "86400"))
        for record in reversed(self.store["poses"]):
            if not same_map(record, identity):
                continue
            try:
                pose = [float(record[key]) for key in ("x", "y", "yaw")]
                age = time.time() - float(record["recorded_at"])
                fitness = float(record["fitness"])
                if (all(math.isfinite(value) for value in pose) and abs(pose[2]) <= math.pi
                        and 0 <= age <= max_age and math.isfinite(fitness)
                        and 0 <= fitness <= float(os.getenv("ROS_MAX_FITNESS", "0.5"))):
                    return pose
            except (KeyError, ValueError, TypeError):
                pass
        return None

    def _confirmed(self, identity):
        snapshot = self.bridge.snapshot()
        return (self.bridge.switch.get("status") == "ready"
                and same_map(self.bridge.switch, identity)
                and snapshot["localization"].get("valid") is True
                and snapshot["localization"].get("source") == "ros"
                and snapshot["localization"].get("frame_id") == identity["frame"])

    async def preflight(self, identity, mode="recover"):
        if self.bridge.control_lock.locked():
            raise RuntimeError("定位或控制正在执行")
        if self.bridge.navigation.get("status") in BUSY_ROUTES:
            raise RuntimeError("当前路线尚未结束，请先停止任务后切换作业地图")
        await self.task_guard()
        await self.service_guard()
        self.bridge.require_stationary()
        if not self.bridge.lidar_received or time.monotonic() - self.bridge.lidar_received >= 2:
            raise RuntimeError("等待新鲜雷达点云后才能自动定位")
        if ((mode == "auto" or mode == "recover" and not self.seed(identity))
                and not self.bridge.snapshot().get("auto_available")):
            raise RuntimeError("自动重定位节点尚未连接；可检查定位服务或手动指定大致位置")

    async def activate(self, criteria, mode="recover", pose=None, startup=False):
        async with self.admission:
            if not startup:
                self.startup_pending = False
            entry = await self.resolver(criteria)
            identity = await self.identity(entry)
            # A refresh or repeated selection is read-only while the same verified map tracks.
            if mode == "recover" and not self.busy and self._confirmed(identity):
                self.selected = self.active_identity = identity
                self._state("ready", "当前作业地图定位正常", identity)
                return {"status": "ready", "recovery": dict(self.bridge.recovery)}
            if self.busy or self.bridge.control_lock.locked():
                raise RuntimeError("定位或控制正在执行，请先取消当前定位")
            await self.preflight(identity, mode)
            # No await between this final check and setting the motion inhibit.
            # A worker that claims a queued task later will still be refused by ROS route().
            self.bridge.require_stationary()
            if self.bridge.control_lock.locked() or self.bridge.navigation.get("status") in BUSY_ROUTES:
                raise RuntimeError("路线状态已变化，请先结束任务")
            self.bridge.inhibited = True
            self.startup_pending = False
            self.generation += 1
            generation = self.generation
            self.selected = identity
            self.store["selected"] = identity
            await asyncio.to_thread(atomic_json, self.path, self.store)
            self._state("loading", "正在准备作业地图定位", identity, "pending")
            self.task = asyncio.create_task(self._run(identity, generation, mode, pose))
            return {"status": "pending", "recovery": dict(self.bridge.recovery)}

    async def _run(self, identity, generation, mode, pose):
        try:
            initial = pose if mode == "manual" else self.seed(identity) if mode == "recover" else None
            if initial is not None:
                self.bridge.relocalization = {"status": "idle"}
                self._state("loading", "正在用初始位置匹配新雷达数据", identity, "verifying")
                try:
                    await self.bridge.switch_map(identity["pcd"], *initial)
                except (RuntimeError, TimeoutError):
                    if mode == "manual":
                        raise
                    self.bridge.require_stationary()
                    initial = None
            if initial is None:
                self._state("searching", "正在所选地图内自动寻找位置", identity)
                await self.bridge.auto_localize(identity)
            if generation != self.generation:
                return
            latest = await self.identity(await self.resolver(identity), force=True)
            if not same_map(latest, identity):
                raise RuntimeError("定位过程中地图内容或版本已变化，请重新选择")
            loc = self.bridge.snapshot()["localization"]
            if (not loc.get("valid") or loc.get("source") != "ros" or loc.get("frame_id") != identity["frame"]
                    or self.bridge.switch.get("status") != "ready"):
                raise RuntimeError("未收到新地图的有效定位结果")
            self.bridge.switch.update(identity)
            self.active_identity = identity
            self.bridge.inhibited = True
            self._state("ready", "定位正常，车辆仍保持停止锁定", identity)
            try:
                await self.save_pose(force=True)
            except OSError as exc:
                self._state("ready", "定位正常，但历史位置暂未保存，请检查运行目录", identity)
                log.warning("Unable to save verified work-map pose: %s", exc)
        except asyncio.CancelledError:
            if generation == self.generation:
                self._invalidate("cancelled", "已取消定位，车辆保持停止锁定")
            raise
        except Exception as exc:
            if generation == self.generation:
                self._invalidate("manual_required", f"自动定位未完成，请在地图上指定大致位置和方向：{getattr(exc, 'detail', exc)}")
            log.warning("Work-map localization did not complete: %s", exc)

    def _invalidate(self, status, message):
        self.bridge.inhibited = True
        self.bridge.switch.update(id=uuid.uuid4().hex, status="failed", message=str(message))
        self._state(status, message)

    async def cancel(self):
        async with self.admission:
            self.startup_pending = False
            self.generation += 1
            task = self.task
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            self._invalidate("cancelled", "已取消定位，车辆保持停止锁定")

    async def save_pose(self, force=False):
        identity = self.active_identity
        if not identity or not self._confirmed(identity) or self.busy and not force:
            return
        snapshot = self.bridge.snapshot()
        loc, pose = snapshot["localization"], snapshot["position"]
        if not force and (time.monotonic() - self.last_save < 5 or loc.get("stamp") == self.last_stamp):
            return
        latest = await self.identity(await self.resolver(identity))
        if not same_map(latest, identity):
            self._invalidate("manual_required", "作业地图内容或版本已变化，请重新选择并验证定位")
            return
        values = [float(pose["LocalX"]), float(pose["LocalY"]), math.radians(float(pose["Heading"])), float(loc["fitness"])]
        if not all(math.isfinite(value) for value in values):
            return
        values[2] = math.atan2(math.sin(values[2]), math.cos(values[2]))
        record = {**identity, "x": values[0], "y": values[1], "yaw": values[2],
                  "fitness": values[3], "recorded_at": time.time()}
        self.store["poses"] = [item for item in self.store["poses"] if item.get("key") != identity["key"]][-31:] + [record]
        self.store["selected"] = self.selected
        await asyncio.to_thread(atomic_json, self.path, self.store)
        self.last_save, self.last_stamp = time.monotonic(), loc.get("stamp")

    def start(self):
        if self.supervisor and not self.supervisor.done():
            return
        self.store = {"schema": 1, "selected": None, "poses": []}
        self.selected = self.active_identity = None
        self.last_save, self.last_stamp = 0.0, None
        self._load()
        self.startup_pending = self.selected is not None
        if self.startup_pending:
            self.bridge.inhibited = True
            self._state("waiting", "等待定位服务、雷达和停车反馈后恢复作业地图")
        self.supervisor = asyncio.create_task(self._supervise())

    async def _supervise(self):
        while True:
            try:
                if self.startup_pending and not self.busy:
                    await self.activate(self.selected, startup=True)
                elif not self.busy:
                    await self.save_pose()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                if self.startup_pending:
                    # Missing dependencies may appear later; an actual localization failure
                    # is handled in _run and is never retried without another user request.
                    if isinstance(exc, FileNotFoundError) or getattr(exc, "status_code", None) in {404, 422}:
                        self.startup_pending = False
                        self._state("manual_required", f"历史作业地图不可用，请重新选择：{getattr(exc, 'detail', exc)}")
                    else:
                        self._state("waiting", f"等待恢复定位：{getattr(exc, 'detail', exc)}")
                else:
                    log.warning("Unable to persist verified localization: %s", exc)
            await asyncio.sleep(self.poll_interval)

    async def close(self):
        if self.supervisor:
            self.supervisor.cancel()
            try:
                await self.supervisor
            except asyncio.CancelledError:
                pass
            self.supervisor = None
        if self.busy:
            await self.cancel()
