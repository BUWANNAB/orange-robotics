import asyncio
import logging
from typing import Set
from fastapi import WebSocket

from app.services.ros2_service import ros2_service

logger = logging.getLogger("orange_agv.ws_manager")

class ConnectionManager:
    """高性能异步 WebSocket 连接管理器，带 10Hz 智能节流广播"""
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self._broadcast_task: asyncio.Task = None
        self._running = False

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info("WebSocket 客户端已连接，当前活跃连接数: %d", len(self.active_connections))
        
        # 立即推送首帧当前位姿
        try:
            await websocket.send_json(ros2_service.snapshot())
        except Exception:
            pass

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info("WebSocket 客户端已断开，剩余活跃连接数: %d", len(self.active_connections))

    async def broadcast_json(self, message: dict):
        if not self.active_connections:
            return

        dead_connections = set()
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                dead_connections.add(connection)

        for dead in dead_connections:
            self.active_connections.discard(dead)

    async def _broadcast_loop(self):
        """10Hz (100ms) 智能节流广播循环：无人连接时零消耗"""
        logger.info("WebSocket 10Hz 广播调度协程启动...")
        while self._running:
            if self.active_connections:
                payload = ros2_service.snapshot()
                await self.broadcast_json(payload)
            await asyncio.sleep(0.1)  # 严格 100ms 节流

    def start_broadcast_loop(self):
        if not self._running:
            self._running = True
            self._broadcast_task = asyncio.create_task(self._broadcast_loop())

    def stop_broadcast_loop(self):
        self._running = False
        if self._broadcast_task:
            self._broadcast_task.cancel()

ws_manager = ConnectionManager()
