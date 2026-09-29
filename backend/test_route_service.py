import asyncio
import os
import json
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.database import Base
from app.models.route import Route, Station, RouteDetail, Param
from app.services.route_service import build_path_point_payload

async def test_route_payload():
    # 使用纯内存 SQLite 测试
    test_engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async_session = async_sessionmaker(bind=test_engine, class_=AsyncSession, expire_on_commit=False)

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as session:
        # 1. 插入全局参数
        param = Param(speed_run="0.35")
        session.add(param)

        # 2. 插入两个站点
        s1 = Station(id=101, stationName="StartPoint", positionX="1.23", positionY="4.56", positionZ="0.0")
        s2 = Station(id=102, stationName="EndPoint", positionX="7.89", positionY="10.11", positionZ="0.0")
        session.add_all([s1, s2])

        # 3. 插入路线
        route = Route(
            id=1,
            routeName="Line1",
            stationIds=json.dumps([101, 102]),
            speed="0.5"
        )
        session.add(route)

        # 4. 插入路线详情 (点1追踪，点2自转并停留3秒)
        rd1 = RouteDetail(routeId=1, stationId=101, speed="0.4", direction="1.57", runmode="0", position="0", stopTime="0")
        rd2 = RouteDetail(routeId=1, stationId=102, speed="0.2", direction="3.14", runmode="1", position="1", stopTime="3.0")
        session.add_all([rd1, rd2])

        await session.commit()

        # 5. 调用核心函数
        ok, msg, payload = await build_path_point_payload(1, session)
        print("Success:", ok)
        print("Message:", msg)
        print("Payload:", payload)
        print("Payload length:", len(payload))

        # 验证契约
        assert ok is True
        assert len(payload) == 9 * 2  # 18 floats, no count header
        
        # 点 1
        assert payload[0] == 1.23  # x
        assert payload[1] == 4.56  # y
        assert abs(payload[2] - 1.57) < 1e-4  # yaw
        assert payload[3] == 101.0  # id
        assert payload[4] == 0.4  # speed
        assert payload[5] == 0.0  # runmode (0=追踪)
        assert payload[6] == 0.0  # locationMode
        assert payload[7] == 0.0  # 预留
        assert payload[8] == 0.0  # duration

        # 点 2
        assert payload[9] == 7.89  # x
        assert payload[10] == 10.11  # y
        assert abs(payload[11] - 3.14) < 1e-4  # yaw
        assert payload[12] == 102.0  # id
        assert payload[13] == 0.2  # speed
        assert payload[14] == 1.0  # runmode (1=自转)
        assert payload[15] == 1.0  # locationMode
        assert payload[16] == 0.0  # 预留
        assert payload[17] == 3.0  # duration

        print("--> All payload contract assertions PASSED!")

if __name__ == "__main__":
    asyncio.run(test_route_payload())
