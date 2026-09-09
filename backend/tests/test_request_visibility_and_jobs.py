from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import Part, StockRequest, StockRequestLine, StockRequestStatus, StockTransaction, StockTransactionType, User
from app.routers.reports_v2 import get_my_stock_usage, get_stock_usage_by_technician
from app.routers.requests import _request_read


def _user(*, user_id: int, role: str, email: str, full_name: str) -> User:
    now = datetime.now(UTC)
    return User(
        id=user_id,
        tenant_id=1,
        email=email,
        full_name=full_name,
        role=role,
        password_hash="test",
        is_active=True,
        created_at=now,
        updated_at=now,
    )


def test_request_read_redacts_values_for_technicians_and_includes_requester() -> None:
    now = datetime.now(UTC)
    requester = _user(user_id=501, role="technician", email="requester@example.com", full_name="Requesting Tech")
    technician_viewer = _user(user_id=502, role="technician", email="viewer@example.com", full_name="Viewing Tech")
    manager_viewer = _user(user_id=503, role="store_manager", email="manager@example.com", full_name="Store Manager")
    request = StockRequest(
        id=901,
        tenant_id=1,
        requested_by_user_id=requester.id,
        requested_by=requester,
        status=StockRequestStatus.PENDING,
        total_value=123.45,
        required_approval_role="manager",
        created_at=now,
        updated_at=now,
    )
    request.lines = [
        StockRequestLine(
            id=902,
            tenant_id=1,
            request_id=request.id,
            part_id=77,
            quantity=2,
            unit_cost=61.72,
            tracking_type="BATCH",
            created_at=now,
            updated_at=now,
        )
    ]

    technician_read = _request_read(request, technician_viewer)
    manager_read = _request_read(request, manager_viewer)

    assert technician_read.requested_by_name == "Requesting Tech"
    assert technician_read.requested_by_email == "requester@example.com"
    assert technician_read.total_value is None
    assert technician_read.lines[0].unit_cost is None
    assert manager_read.total_value == 123.45
    assert manager_read.lines[0].unit_cost == 61.72


def test_job_creation_accepts_site_name_without_coordinates() -> None:
    suffix = uuid4().hex[:8]
    with TestClient(app) as client:
        customer_resp = client.post("/customers", json={"name": f"Site Customer {suffix}"})
        assert customer_resp.status_code in {200, 201}, customer_resp.text
        customer_id = customer_resp.json()["id"]

        job_resp = client.post(
            "/jobs",
            json={
                "customer_id": customer_id,
                "title": f"Pump inspection {suffix}",
                "status": "open",
                "priority": "medium",
                "site_location_label": "Pump station A",
            },
        )
        assert job_resp.status_code in {200, 201}, job_resp.text
        payload = job_resp.json()
        assert payload["site_location_label"] == "Pump station A"
        assert payload["site_latitude"] is None
        assert payload["site_longitude"] is None

        missing_site_resp = client.post(
            "/jobs",
            json={
                "customer_id": customer_id,
                "title": f"Missing site {suffix}",
                "status": "open",
                "priority": "medium",
            },
        )
        assert missing_site_resp.status_code == 400, missing_site_resp.text
        assert "site name" in missing_site_resp.json()["detail"].lower()


def test_approved_request_can_be_marked_not_issued_with_remark() -> None:
    suffix = uuid4().hex[:8]
    with TestClient(app) as client:
        item_resp = client.post(
            "/api/items",
            json={
                "name": f"Not Issued Item {suffix}",
                "quantity_on_hand": 4,
                "min_quantity": 1,
                "unit_price": 12.5,
                "tracking_type": "BATCH",
            },
        )
        assert item_resp.status_code in {200, 201}, item_resp.text
        item_id = item_resp.json()["id"]

        db = SessionLocal()
        try:
            requester = User(
                tenant_id=1,
                email=f"not-issued-tech-{suffix}@example.com",
                full_name="Not Issued Tech",
                role="technician",
                password_hash="test",
                is_active=True,
            )
            request = StockRequest(
                tenant_id=1,
                requested_by=requester,
                status=StockRequestStatus.APPROVED,
                total_value=25,
                required_approval_role="manager",
            )
            request.lines = [
                StockRequestLine(
                    tenant_id=1,
                    part_id=item_id,
                    quantity=2,
                    unit_cost=12.5,
                    tracking_type="BATCH",
                )
            ]
            db.add(requester)
            db.add(request)
            db.commit()
            request_id = request.id
        finally:
            db.close()

        resp = client.post(f"/api/requests/{request_id}/not-issued", json={"reason": "Wrong item requested"})
        assert resp.status_code == 200, resp.text
        payload = resp.json()
        assert payload["status"] == "NOT_ISSUED"
        assert payload["not_issued_reason"] == "Wrong item requested"
        assert payload["requested_by_name"] == "Not Issued Tech"


def test_usage_report_values_are_redacted_for_technician_roles() -> None:
    suffix = uuid4().hex[:8]
    with TestClient(app):
        db = SessionLocal()
        try:
            tech = User(
                tenant_id=1,
                email=f"report-tech-{suffix}@example.com",
                full_name="Report Tech",
                role="technician",
                password_hash="test",
                is_active=True,
            )
            lead = User(
                tenant_id=1,
                email=f"report-lead-{suffix}@example.com",
                full_name="Report Lead",
                role="lead_technician",
                password_hash="test",
                is_active=True,
            )
            manager = User(
                tenant_id=1,
                email=f"report-manager-{suffix}@example.com",
                full_name="Report Manager",
                role="manager",
                password_hash="test",
                is_active=True,
            )
            item = Part(
                tenant_id=1,
                sku=f"RPT-{suffix}",
                barcode_value=f"RPT-{suffix}",
                name=f"Report Item {suffix}",
                quantity_on_hand=10,
                min_quantity=1,
                unit_price=99,
                tracking_type="BATCH",
                is_active=True,
            )
            db.add_all([tech, lead, manager, item])
            db.flush()
            db.add(
                StockTransaction(
                    tenant_id=1,
                    part_id=item.id,
                    technician_id=tech.id,
                    created_by_user_id=manager.id,
                    transaction_type=StockTransactionType.OUT,
                    quantity_delta=-2,
                    movement_type="ISSUE",
                )
            )
            db.commit()

            lead_view = get_stock_usage_by_technician(db=db, current_user=lead, technician_limit=100, parts_limit=50)
            manager_view = get_stock_usage_by_technician(db=db, current_user=manager, technician_limit=100, parts_limit=50)
            technician_view = get_my_stock_usage(db=db, current_user=tech)

            lead_row = next(row for row in lead_view if row["technician_id"] == tech.id)
            manager_row = next(row for row in manager_view if row["technician_id"] == tech.id)
            assert lead_row["total_value"] is None
            assert lead_row["parts_list"][0]["value"] is None
            assert manager_row["total_value"] == 198
            assert manager_row["parts_list"][0]["value"] == 198
            assert technician_view["total_value"] is None
            assert technician_view["parts_list"][0]["value"] is None
        finally:
            db.close()
