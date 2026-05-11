from __future__ import annotations

from io import BytesIO

import openpyxl
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import PasswordResetToken, ProductAttachment, TechnicianZoneAssignment, User
from app.security import verify_password


def _xlsx_bytes(builder) -> bytes:
    wb = openpyxl.Workbook()
    builder(wb)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _build_store_workbook(wb) -> None:
    ws1 = wb.active
    ws1.title = "Sheet1"
    ws1.append(["ITEMS NOT AVAILABLE AND THOSE TO BE REPLENISHED"])
    ws1.append(["ITEM", "Actual stocks"])
    ws1.append(['1" ZVA nozzle', 0])
    ws1.append(["Diaphram Valve", 1])

    ws2 = wb.create_sheet("Sheet2")
    ws2.append(["ITEM"])
    ws2.append(["Motor relay"])
    ws2.append(["Motor relay"])
    ws2.append(['3/4" ZVA Breakaway'])


def _build_technician_workbook(wb) -> None:
    ws = wb.active
    ws.title = "MARCH 2026 ZONING"
    ws.append(["TECHNICIANS ZONING - 2026"])
    ws.append(["MSA MAINTENANCE AREA (86 sites)"])
    ws.append(["VICTOR MACHARIA", None, None, "JAMES WANJOHI", None, None, "JOHN MOMANYI", None, None, "MORRIS KILAMBO", None])
    ws.append(["STATION", "CLIENT", None, "STATION", "CLIENT", None, "STATION", "CLIENT", None, "STATION", "CLIENT"])
    ws.append(["WUNDANYI", "VEK", None, "TEZO", "TEMK", None, "MARIAKANI", "VEK", None, "MKOMANI", "TEMK"])
    ws.append(["22 SITES"])
    ws.append(["EASTERN REGION (27 sites)"])
    ws.append(["ALFRED OWINO", None, None, "STEPHEN MURAYA", None, None, "PATRICK KIPKURUI", None, None, "PETER GATA(Support)", None])
    ws.append(["STATION", "CLIENT", None, "STATION", "CLIENT", None, "STATION", "CLIENT", None, "STATION", "CLIENT"])
    ws.append(["NAMANGA", "VEK", None, "MTITO ANDEI", "VEK", None, "MISIKHU", "TEMK", None, "ELGON VIEW", "TEMK"])
    ws.append(["15 SITES"])
    ws.append(["NAIROBI/KIAMBU RGN(29 sites)"])
    ws.append(["ANTHONY GACHAGO", None, None, "WILSON GATERE", None, None, "PAUL KAMUYU", None, None, "ALEX MACHARIA", None])
    ws.append(["STATION", "CLIENT", None, "STATION", "CLIENT", None, "STATION", "CLIENT", None, "STATION", "CLIENT"])
    ws.append(["KANGUNDO RD", "TEMK", None, "GITHUNGURI", "TEMK", None, "BAHATI Road Service Station", "VEK", None, "MAI MAHIU SERVICE STATION", "VEK"])
    ws.append(["16 SITES"])
    ws.append(["THIKA RD/MT KENYA REGION (45 Sites)"])
    ws.append(["DANIEL MBUGUA", None, None, "BENSON CHEGE", None, None, "JOEL MAINA", None, None])
    ws.append(["STATION", "CLIENT", None, "STATION", "CLIENT", None, "STATION", "CLIENT"])
    ws.append(["SURVEY", "TEMK", None, "CHUKA SERVICE STATION", "VEK", None, "JUJA", "TEMK"])


def test_inventory_import_and_low_stock_listing() -> None:
    workbook = _xlsx_bytes(_build_store_workbook)

    with TestClient(app) as client:
        resp = client.post(
            "/api/import/inventory-xlsx",
            files={"file": ("Store A.xlsx", workbook, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert resp.status_code == 200, resp.text
        payload = resp.json()
        assert payload["created"] >= 4
        assert payload["failed"] == 0

        items_resp = client.get("/api/items", params={"page": 1, "page_size": 100})
        assert items_resp.status_code == 200, items_resp.text
        items = items_resp.json()["items"]
        names = [item["name"] for item in items]
        assert names.count("Motor relay") == 1

        relay = next(item for item in items if item["name"] == "Motor relay")
        assert relay["image_url"] is None
        assert relay["quantity_on_hand"] == 0
        assert relay["min_quantity"] == 1

        low_resp = client.get("/api/stock/low", params={"limit": 100})
        assert low_resp.status_code == 200, low_resp.text
        low_names = {item["name"] for item in low_resp.json()}
        assert '1" ZVA nozzle' in low_names
        assert "Diaphram Valve" in low_names
        assert "Motor relay" in low_names


def test_technician_import_password_flag_and_uploads() -> None:
    workbook = _xlsx_bytes(_build_technician_workbook)

    with TestClient(app) as client:
        import_resp = client.post(
            "/api/import/technicians-zones-xlsx",
            files={"file": ("Technicians Details and zones.xlsx", workbook, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert import_resp.status_code == 200, import_resp.text
        summary = import_resp.json()
        assert summary["created_users"] == 15
        assert summary["created_zones"] == 15

        users_resp = client.get("/users")
        assert users_resp.status_code == 200, users_resp.text
        imported_user = next(user for user in users_resp.json() if user["email"] == "victormacharia@gmail.com")
        assert imported_user["must_change_password"] is True
        assert imported_user["zone_count"] == 1

        zones_resp = client.get(f"/users/{imported_user['id']}/zones")
        assert zones_resp.status_code == 200, zones_resp.text
        assert zones_resp.json()[0]["station_name"] == "WUNDANYI"

        create_item_resp = client.post(
            "/api/items",
            json={"name": "Attachment Item", "quantity_on_hand": 2, "min_quantity": 5, "tracking_type": "BATCH"},
        )
        assert create_item_resp.status_code in {200, 201}, create_item_resp.text
        item_id = create_item_resp.json()["id"]

        attach_resp = client.post(
            f"/api/items/{item_id}/attachments",
            files={"file": ("manual.txt", b"manual body", "text/plain")},
        )
        assert attach_resp.status_code in {200, 201}, attach_resp.text
        attachment = attach_resp.json()

        list_attach_resp = client.get(f"/api/items/{item_id}/attachments")
        assert list_attach_resp.status_code == 200, list_attach_resp.text
        assert len(list_attach_resp.json()) == 1

        download_attach_resp = client.get(f"/api/items/{item_id}/attachments/{attachment['id']}/download")
        assert download_attach_resp.status_code == 200, download_attach_resp.text
        assert download_attach_resp.content == b"manual body"

        customer_resp = client.post("/customers", json={"name": "Upload Test Customer"})
        assert customer_resp.status_code in {200, 201}, customer_resp.text
        customer_id = customer_resp.json()["id"]

        job_resp = client.post(
            "/jobs",
            json={
                "customer_id": customer_id,
                "title": "Upload Test Job",
                "status": "open",
                "priority": "medium",
                "site_location_label": "HQ",
                "site_latitude": -1.28,
                "site_longitude": 36.82,
            },
        )
        assert job_resp.status_code in {200, 201}, job_resp.text
        job_id = job_resp.json()["id"]

        photo_resp = client.post(
            f"/jobs/{job_id}/photos",
            data={"photo_type": "BEFORE", "description": "before photo"},
            files={"file": ("photo.jpg", b"fake-image-data", "image/jpeg")},
        )
        assert photo_resp.status_code in {200, 201}, photo_resp.text
        photo_id = photo_resp.json()["id"]

        list_photo_resp = client.get(f"/jobs/{job_id}/photos")
        assert list_photo_resp.status_code == 200, list_photo_resp.text
        assert len(list_photo_resp.json()) == 1

        download_photo_resp = client.get(f"/jobs/{job_id}/photos/{photo_id}/download")
        assert download_photo_resp.status_code == 200, download_photo_resp.text
        assert download_photo_resp.content == b"fake-image-data"


def test_password_change_and_reset_clear_must_change_flag() -> None:
    with TestClient(app) as client:
        me_resp = client.get("/users/me")
        assert me_resp.status_code == 200, me_resp.text
        db = SessionLocal()
        try:
            user = db.query(User).filter(User.email == "dev@example.com").first()
            assert user is not None
            user.must_change_password = True
            db.commit()
        finally:
            db.close()


def test_bulk_password_reset_by_role_respects_active_only_and_forces_change() -> None:
    with TestClient(app) as client:
        create_active = client.post(
            "/users",
            json={
                "email": "bulk.active.tech@gmail.com",
                "password": "WesternPumps#26",
                "full_name": "Bulk Active Tech",
                "role": "technician",
                "must_change_password": False,
            },
        )
        assert create_active.status_code in {200, 201}, create_active.text
        active_user_id = create_active.json()["id"]

        create_inactive = client.post(
            "/users",
            json={
                "email": "bulk.inactive.tech@gmail.com",
                "password": "WesternPumps#26",
                "full_name": "Bulk Inactive Tech",
                "role": "technician",
                "must_change_password": False,
            },
        )
        assert create_inactive.status_code in {200, 201}, create_inactive.text
        inactive_user_id = create_inactive.json()["id"]

        deactivate_resp = client.delete(f"/users/{inactive_user_id}")
        assert deactivate_resp.status_code == 200, deactivate_resp.text

        reset_resp = client.post(
            "/users/password/by-role",
            json={
                "role": "technician",
                "new_password": "WesternPumps#29",
                "must_change_password": True,
                "active_only": True,
            },
        )
        assert reset_resp.status_code == 200, reset_resp.text
        assert reset_resp.json()["users_updated"] >= 1

        db = SessionLocal()
        try:
            active_user = db.query(User).filter(User.id == active_user_id).first()
            inactive_user = db.query(User).filter(User.id == inactive_user_id).first()
            assert active_user is not None
            assert inactive_user is not None
            assert verify_password("WesternPumps#29", active_user.password_hash)
            assert active_user.must_change_password is True
            assert not verify_password("WesternPumps#29", inactive_user.password_hash)
            assert inactive_user.must_change_password is False
        finally:
            db.close()


def test_bulk_password_reset_by_role_rejects_admin_role() -> None:
    with TestClient(app) as client:
        reset_resp = client.post(
            "/users/password/by-role",
            json={
                "role": "admin",
                "new_password": "WesternPumps#30",
                "must_change_password": True,
                "active_only": True,
            },
        )
        assert reset_resp.status_code == 400, reset_resp.text
        assert "not allowed" in reset_resp.json()["detail"].lower()


def test_admin_can_list_all_technician_zones() -> None:
    workbook = _xlsx_bytes(_build_technician_workbook)
    with TestClient(app) as client:
        import_resp = client.post(
            "/api/import/technicians-zones-xlsx",
            files={"file": ("Technicians Details and zones.xlsx", workbook, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert import_resp.status_code == 200, import_resp.text

        zones_resp = client.get("/users/technician-zones", params={"include_inactive": True})
        assert zones_resp.status_code == 200, zones_resp.text
        payload = zones_resp.json()
        assert len(payload) >= 1
        first = payload[0]
        assert "user_id" in first
        assert "user_email" in first
        assert "region_label" in first
        assert "station_name" in first

        change_resp = client.post(
            "/users/me/password",
            json={"current_password": "DevAdmin#123", "new_password": "WesternPumps#27"},
        )
        assert change_resp.status_code == 200, change_resp.text

        db = SessionLocal()
        try:
            user = db.query(User).filter(User.email == "dev@example.com").first()
            assert user is not None
            assert user.must_change_password is False
        finally:
            db.close()

        create_user_resp = client.post(
            "/users",
            json={
                "email": "resetuser@gmail.com",
                "password": "WesternPumps#26",
                "full_name": "Reset User",
                "role": "technician",
                "must_change_password": True,
            },
        )
        assert create_user_resp.status_code in {200, 201}, create_user_resp.text

        forgot_resp = client.post("/auth/forgot-password", json={"email": "resetuser@gmail.com"})
        assert forgot_resp.status_code == 200, forgot_resp.text

        db = SessionLocal()
        try:
            reset_user = db.query(User).filter(User.email == "resetuser@gmail.com").first()
            assert reset_user is not None
            token = db.query(PasswordResetToken).filter(PasswordResetToken.user_id == reset_user.id).first()
            assert token is not None
            reset_token = token.token
        finally:
            db.close()

        reset_resp = client.post(
            "/auth/reset-password",
            json={"token": reset_token, "new_password": "WesternPumps#28"},
        )
        assert reset_resp.status_code == 200, reset_resp.text

        db = SessionLocal()
        try:
            reset_user = db.query(User).filter(User.email == "resetuser@gmail.com").first()
            assert reset_user is not None
            assert reset_user.must_change_password is False
            assert db.query(PasswordResetToken).filter(PasswordResetToken.user_id == reset_user.id).first() is None
            assert db.query(TechnicianZoneAssignment).count() >= 1
            assert db.query(ProductAttachment).count() >= 1
        finally:
            db.close()
