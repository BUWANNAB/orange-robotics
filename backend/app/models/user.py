from datetime import datetime
from sqlalchemy import Column, String, DateTime, BigInteger, Integer, SmallInteger
from app.database import Base

PK_BIGINT = BigInteger().with_variant(Integer, "sqlite")

class User(Base):
    """用户表 (对应 t_user)"""
    __tablename__ = "t_user"

    id = Column(PK_BIGINT, primary_key=True, autoincrement=True)
    userAccount = Column(String(255), nullable=False)
    userPassword = Column(String(255), nullable=False)
    createTime = Column(DateTime, default=datetime.utcnow)
    updateTime = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    isDelete = Column(SmallInteger, default=0)

    def to_dict(self):
        return {
            "id": self.id,
            "userAccount": self.userAccount,
            "createTime": self.createTime.strftime("%Y-%m-%d %H:%M:%S") if self.createTime else "",
            "updateTime": self.updateTime.strftime("%Y-%m-%d %H:%M:%S") if self.updateTime else "",
            "isDelete": self.isDelete
        }
