"""Read-only inventory of the existing MySQL data before Java cutover.

Uses the same DB settings as the Python app. Never creates or changes tables.
"""

import asyncio
import json
from sqlalchemy import inspect, text

from app.main import app  # noqa: F401 - registers all model metadata
from app.database import Base, engine


LEGACY_TABLES = (
    "t_d270_data", "t_files", "t_log", "t_map_file_mapping", "t_order", "t_param",
    "t_parameter", "t_route", "t_route_detail", "t_run_log", "t_sensor",
    "t_sidebar_config", "t_station", "t_system_config", "t_task", "t_test_log", "t_user",
)


async def inventory():
    if not engine.url.drivername.startswith("mysql+"):
        raise RuntimeError("只读盘点必须连接原 MySQL；当前配置指向非 MySQL 数据库")
    result = {}
    async with engine.connect() as conn:
        def schema(sync_conn):
            inspector = inspect(sync_conn)
            existing = set(inspector.get_table_names())
            return {name: {column["name"] for column in inspector.get_columns(name)}
                    for name in LEGACY_TABLES if name in existing}
        columns = await conn.run_sync(schema)
        for name in LEGACY_TABLES:
            if name not in columns:
                result[name] = {"exists": False}
                continue
            # Names come only from the constant above; no user input enters SQL.
            count = await conn.scalar(text(f"SELECT COUNT(*) FROM `{name}`"))
            mapped = Base.metadata.tables.get(name)
            model_columns = set(mapped.columns.keys()) if mapped is not None else set()
            result[name] = {"exists": True, "rows": count,
                            "model_missing_columns": sorted(model_columns - columns[name]),
                            "unmapped_columns": sorted(columns[name] - model_columns)}
    await engine.dispose()
    return result


if __name__ == "__main__":
    print(json.dumps(asyncio.run(inventory()), ensure_ascii=False, indent=2))
