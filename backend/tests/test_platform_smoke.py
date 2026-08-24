from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app, create_app


def test_health_and_metrics_endpoints() -> None:
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json().get("status") == "ok"
        assert health.json().get("database", {}).get("status") == "ok"

        metrics = client.get("/metrics")
        assert metrics.status_code == 200
        assert "westernpumps_requests_total" in metrics.text


def test_cors_headers_are_present_on_handled_500_responses() -> None:
    test_app = create_app()

    @test_app.get("/boom")
    def boom() -> None:
        raise RuntimeError("boom")

    with TestClient(test_app, raise_server_exceptions=False) as client:
        response = client.get(
            "/boom",
            headers={"Origin": "https://western-pumps-np2i.vercel.app"},
        )

    assert response.status_code == 500
    assert response.headers.get("access-control-allow-origin") == "*"

