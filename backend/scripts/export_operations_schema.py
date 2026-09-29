"""Generate additive MySQL DDL and explicit rollback without connecting to a database."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy.dialects import mysql
from sqlalchemy.schema import CreateTable, CreateIndex
from app.models.operations import TABLES

destination = Path(__file__).resolve().parents[1] / "migrations"
destination.mkdir(exist_ok=True)
dialect = mysql.dialect()
statements = ["-- RCS/RDS additive schema. Back up the database before applying.\nSET NAMES utf8mb4;"]
for table in TABLES:
    statements.append(str(CreateTable(table, if_not_exists=True).compile(dialect=dialect)).strip()+";")
    statements.extend(str(CreateIndex(index).compile(dialect=dialect))+";" for index in sorted(table.indexes,key=lambda i:i.name))
(destination/"001_operations_up.sql").write_text("\n\n".join(statements)+"\n",encoding="utf-8")
(destination/"001_operations_down.sql").write_text("-- DESTRUCTIVE: run only after backing up RCS/RDS data; legacy tables are not touched.\n"+"\n".join(f"DROP TABLE IF EXISTS {t.name};" for t in reversed(TABLES))+"\n",encoding="utf-8")
print("Generated",len(TABLES),"tables and rollback in",destination)
