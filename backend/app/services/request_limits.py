"""Bound JSON ingestion before FastAPI allocates or parses the body."""
from starlette.responses import JSONResponse


class RequestLimits:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in {"POST", "PUT", "PATCH"}:
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        maximum = 1048576 if path.startswith("/openapi/") else 6*1048576
        if path == "/api/map-workbench/grid": maximum = 81*1048576
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect": return
            size += len(message.get("body", b""))
            if size > maximum:
                return await JSONResponse({"code":1001,"message":"请求体超过大小限制","data":None},status_code=413)(scope,receive,send)
            chunks.append(message)
            if not message.get("more_body", False): break
        position = 0
        async def bounded_receive():
            nonlocal position
            if position < len(chunks):
                message = chunks[position]; position += 1; return message
            return await receive()
        await self.app(scope, bounded_receive, send)
