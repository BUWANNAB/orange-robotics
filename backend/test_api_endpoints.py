import json
import asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.main import app
from app.database import engine, Base, AsyncSessionLocal
from app.models.route import Route, Station, RouteDetail, Param

async def seed_data():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
    async with AsyncSessionLocal() as session:
        # 清理旧测试数据，避免重复运行主键冲突
        await session.execute(text("DELETE FROM t_route WHERE id=1"))
        await session.execute(text("DELETE FROM t_station WHERE id IN (1, 2)"))
        await session.execute(text("DELETE FROM t_route_detail WHERE routeId=1"))
        await session.commit()

        # 插入参数
        p = Param(speed_run="0.25")
        session.add(p)

        
        # 插入站点
        s1 = Station(id=1, stationName="Point_A", positionX="2.0", positionY="3.0", positionZ="0.0")
        s2 = Station(id=2, stationName="Point_B", positionX="5.0", positionY="7.0", positionZ="0.0")
        session.add_all([s1, s2])
        
        # 插入路线
        r = Route(id=1, routeName="Test_Route_Alpha", mapCoverage="map_factory", mapName="factory_1", stationIds=json.dumps([1, 2]), speed="0.4")
        session.add(r)
        
        # 插入路线明细
        d1 = RouteDetail(routeId=1, stationId=1, speed="0.3", direction="0.785", runmode="0", position="0", stopTime="0")
        d2 = RouteDetail(routeId=1, stationId=2, speed="0.4", direction="1.57", runmode="1", position="1", stopTime="5.0")
        session.add_all([d1, d2])
        
        await session.commit()

def test_endpoints():
    asyncio.run(seed_data())
    
    with TestClient(app) as client:
        # 1. 健康检查
        h_res = client.get("/health")
        assert h_res.status_code == 200
        print("[PASS] GET /health:", h_res.json()["status"])
        
        # 2. 地图路线列表 (旧端契约 /route/map-coverage/{mapName})
        map_res = client.get("/route/map-coverage/factory_1")
        assert map_res.status_code == 200
        map_data = map_res.json()
        print("[PASS] GET /route/map-coverage/factory_1:", map_data)
        assert map_data["code"] == 0
        assert len(map_data["data"]) == 1
        assert map_data["data"][0]["routeName"] == "Test_Route_Alpha"
        
        # 3. 路线详情点数据 (旧端契约 /route/detail/{id})
        detail_res = client.get("/route/detail/1")
        assert detail_res.status_code == 200
        detail_data = detail_res.json()
        print("[PASS] GET /route/detail/1:", detail_data)
        assert detail_data["code"] == 0
        payload = detail_data["data"]
        assert len(payload) == 18
        assert payload[0:2] == [2.0, 3.0]
        assert payload[9:11] == [5.0, 7.0]
        assert payload[14] == 1.0
        assert payload[17] == 5.0
        assert client.post("/ros2/publishpathpoint/1").status_code == 401
        login=client.post("/user/login",json={"userAccount":"admin","userPassword":"admin"}).json()
        pub_res=client.post("/ros2/publishpathpoint/1",headers={"Authorization":login["data"]})
        assert pub_res.status_code == 409, pub_res.text
        print("\n==========================================")
        print(" ALL END-TO-END API TESTS PASSED! ")
        print("==========================================")

if __name__ == "__main__":
    test_endpoints()
