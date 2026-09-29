from datetime import datetime
from sqlalchemy import Column, String, DateTime, BigInteger, Integer
from app.database import Base

PK_BIGINT = BigInteger().with_variant(Integer, "sqlite")

class MapFileMapping(Base):
    """地图点云文件映射表 (对应 t_map_file_mapping)"""
    __tablename__ = "t_map_file_mapping"

    id = Column(PK_BIGINT, primary_key=True, autoincrement=True)
    map_name = Column(String(255), nullable=True)
    file_name = Column(String(255), nullable=True)
    create_time = Column(DateTime, default=datetime.utcnow)
    update_time = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "map_name": self.map_name,
            "file_name": self.file_name,
            "create_time": self.create_time.strftime("%Y-%m-%d %H:%M:%S") if self.create_time else "",
            "update_time": self.update_time.strftime("%Y-%m-%d %H:%M:%S") if self.update_time else ""
        }
