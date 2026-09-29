"""Run a 500 MiB firmware upload against an isolated in-process test service."""
import hashlib
import os
import sys
import tempfile
import time
import tracemalloc
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
root=Path(os.environ.get("RCS_TEST_TMP",tempfile.gettempdir()))
root.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix="rcs-large-",dir=root,ignore_cleanup_errors=True) as work:
    os.environ.update(RCS_DATABASE_URL="sqlite+aiosqlite:///"+str(Path(work)/"check.db").replace("\\","/"),
        RCS_DATA_DIR=str(Path(work)/"data"),RCS_WORKER_ENABLED="false",USE_SQLITE_DEV="true",ENVIRONMENT="development")
    from fastapi.testclient import TestClient
    from app.main import app
    from app.api.ota import package_dir
    import logging
    logging.getLogger("httpx").setLevel(logging.WARNING)
    chunk=b"firmware-validation-"*(5*1024*1024//20)
    assert len(chunk)==5*1024*1024
    digest=hashlib.sha256()
    for _ in range(100): digest.update(chunk)
    started=time.perf_counter();tracemalloc.start()
    with patch('app.main.ros2_service.start'),patch('app.main.ros2_service.stop'),TestClient(app) as client:
        login=client.post('/user/login',json={"userAccount":"admin","userPassword":"admin"}).json()
        headers={"Authorization":login['data']}
        package=client.post('/api/firmware/upload',headers=headers,json={"name":"500MiB verification","version":"9.0.0","model":"TEST-ONLY","size":len(chunk)*100,"sha256":digest.hexdigest()}).json()['data']
        for index in range(100):
            result=client.put(f"/api/firmware/{package['id']}/chunks/{index}",headers=headers,content=chunk)
            assert result.status_code==200,result.text
        result=client.post(f"/api/firmware/{package['id']}/complete",headers=headers)
        assert result.status_code==200,result.text
        assert result.json()['data']['status']=='review'
        assert (package_dir(package['id'])/'package.bin').stat().st_size==500*1024*1024
    _,peak=tracemalloc.get_traced_memory();tracemalloc.stop()
    print(f"PASS: 500 MiB / 100 chunks / SHA256 verified; elapsed={time.perf_counter()-started:.2f}s; Python traced peak={peak/1024/1024:.1f} MiB")
