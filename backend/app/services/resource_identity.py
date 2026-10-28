"""Stable map-object identities; no database or hardware access."""
from copy import deepcopy
import uuid


def object_key(kind, item):
    if kind == "points":
        return item.get("code", "")
    if kind == "paths":
        return (item.get("start"), item.get("end"))
    return (item.get("name"), item.get("type"))


def identify(document, previous=None, seed=None):
    result = deepcopy(document)
    for kind in ("points", "paths", "areas"):
        old = {}
        for item in (previous or {}).get(kind, []):
            old.setdefault(object_key(kind, item), []).append(item.get("uid", ""))
        seen = set()
        for index, item in enumerate(result.get(kind, [])):
            key = object_key(kind, item)
            candidates = old.get(key, [])
            inherited = candidates.pop(0) if candidates else ""
            item["uid"] = item.get("uid") or inherited or (
                uuid.uuid5(uuid.NAMESPACE_URL, f"orange:{seed}:{kind}:{key}:{index}").hex
                if seed else uuid.uuid4().hex)
            if item["uid"] in seen:
                raise ValueError("地图对象标识重复")
            seen.add(item["uid"])
    return result


def bind_steps(document, start, steps):
    points = {item["code"]: item for item in document.get("points", [])}
    result = deepcopy(steps)
    for step in result:
        step["point_uid"] = points[step["point"]].get("uid", "")
        step["start_point_uid"] = points[start].get("uid", "")
    return result


def identity_error(document, start, steps):
    points = {item["code"]: item for item in document.get("points", [])}
    for step in steps:
        for code, field in ((start, "start_point_uid"), (step.get("point"), "point_uid")):
            point = points.get(code)
            if point is None:
                return f"站点 {code} 已移除，请编辑并重新保存任务链"
            if point.get("uid") and step.get(field) != point["uid"]:
                return f"站点 {code} 的身份已变化，请核对目标并重新保存任务链"
    return ""
