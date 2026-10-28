"""Explicit, backed-up SQLite migration of draft resource identities.

Published snapshots, running missions and legacy tables are never rewritten.
Dry-run is the default. MySQL uses the compatible lazy normalization on draft save;
do not pass a MySQL database or copy a live SQLite file with filesystem commands.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import sys
import uuid
from contextlib import closing

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.resource_identity import identify


def migrate(source, backup_dir=None, apply=False):
    source = Path(source).resolve(strict=True)
    connection = sqlite3.connect(source.as_uri() + "?mode=rw" if apply else source.as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    report = {"database": str(source), "applied": False, "changed_maps": [], "legacy_pending": {}, "backup": None}
    try:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if "rds_map" not in tables:
            raise ValueError("此数据库没有橙智地图表，未执行迁移")
        if apply:
            if backup_dir is None:
                raise ValueError("执行迁移必须指定备份目录")
            directory = Path(backup_dir).resolve()
            directory.mkdir(parents=True, exist_ok=True)
            backup = directory / f"{source.stem}-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:8]}.sqlite"
            with closing(sqlite3.connect(backup)) as destination:
                connection.backup(destination)
            report["backup"] = str(backup)
            connection.execute("BEGIN IMMEDIATE")
        for table in ("t_station", "t_route", "t_route_detail"):
            if table in tables:
                report["legacy_pending"][table] = connection.execute(f'SELECT count(*) FROM "{table}" WHERE isDelete=0').fetchone()[0]
        for row in connection.execute("SELECT id,draft,revision,lock_until FROM rds_map WHERE deleted=0").fetchall():
            old = json.loads(row["draft"])
            updated = identify(old, seed=row["id"])
            if updated == old:
                continue
            if apply and row["lock_until"] and str(row["lock_until"]) > datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"):
                raise ValueError(f"地图 #{row['id']} 正在编辑，请关闭编辑器并等待锁到期后重试")
            report["changed_maps"].append({"id": row["id"], "revision_before": row["revision"], "revision_after": row["revision"]+1})
            if apply:
                connection.execute("UPDATE rds_map SET draft=?,revision=revision+1 WHERE id=? AND revision=?",
                                   (json.dumps(updated, ensure_ascii=False), row["id"], row["revision"]))
        if apply:
            connection.commit()
            report["applied"] = True
        return report
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description="地图资源身份迁移：默认只读预检，执行时先生成数据库一致性备份")
    parser.add_argument("--sqlite", required=True, type=Path)
    parser.add_argument("--backup-dir", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(migrate(args.sqlite, args.backup_dir, args.apply), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
