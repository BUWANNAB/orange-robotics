import sys
from fastapi.testclient import TestClient
from app.main import app

def test_health():
    with TestClient(app) as client:
        response = client.get("/health")
        print("Status code:", response.status_code)
        data = response.json()
        print("Response data:", data)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert data["database"]["connected"] is True, "Database should be connected"
        print("Health test PASSED!")

        info_resp = client.get("/api/v1/system/info")
        print("Info response:", info_resp.json())
        assert info_resp.status_code == 200, f"Expected 200, got {info_resp.status_code}"
        print("System info test PASSED!")

if __name__ == "__main__":
    test_health()
