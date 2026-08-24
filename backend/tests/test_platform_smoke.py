from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.main import app, create_app
from app.system_settings import get_effective_settings


def test_health_and_metrics_endpoints() -> None:
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json().get("status") == "ok"
        assert health.json().get("database", {}).get("status") == "ok"

        metrics = client.get("/metrics")
        assert metrics.status_code == 200
        assert "westernpumps_requests_total" in metrics.text

        branding = client.get("/api/admin/settings/branding")
        assert branding.status_code == 200
        assert "branding_logo_url" in branding.json()


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


def test_settings_reader_tolerates_legacy_key_value_table() -> None:
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE app_settings (key VARCHAR(100) PRIMARY KEY, value TEXT)"))
        conn.execute(
            text("INSERT INTO app_settings (key, value) VALUES (:key, :value)"),
            {"key": "branding_logo_url", "value": "https://example.com/logo.png"},
        )

    with Session(engine) as db:
        effective = get_effective_settings(db)

    assert effective.branding_logo_url == "https://example.com/logo.png"

