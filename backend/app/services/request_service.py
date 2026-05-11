from __future__ import annotations

import hashlib
import json
import math
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, unquote, urlparse

from jose import JWTError, jwt
from sqlalchemy import func, select

from app.audit import log_audit
from app.config import settings
from app.models import (
    BatchUsageRecord,
    Customer,
    IssuedBatchItem,
    ItemStatus,
    Job,
    Part,
    StockRequest,
    StockRequestLine,
    StockRequestStatus,
    StockTransaction,
    StockTransactionType,
    UsageRecord,
    User,
)
from app.notifications import dispatch_alert
from app.repositories import InventoryRepository
from app.services.errors import ServiceError
from app.system_settings import get_effective_settings


class RequestService:
    def __init__(self, repo: InventoryRepository) -> None:
        self.repo = repo

    def _max_role(self, left: str, right: str) -> str:
        rank = {"manager": 1, "admin": 2}
        left_rank = rank.get(left, 1)
        right_rank = rank.get(right, 1)
        return left if left_rank >= right_rank else right

    def get_required_role(self, total_value: float | None, *, has_individual_items: bool) -> str:
        effective = get_effective_settings(self.repo.db)
        required = "manager"
        if total_value is not None and total_value > effective.approval_threshold_manager:
            required = "admin"
        if has_individual_items and effective.approval_individual_role in {"manager", "admin"}:
            required = self._max_role(required, effective.approval_individual_role)
        return required

    def create_request(
        self,
        *,
        current_user: User,
        customer_id: int | None,
        job_id: int | None,
        customer_name: str | None,
        job_title: str | None,
        lines: list[dict[str, int]],
    ) -> StockRequest:
        if not lines:
            raise ServiceError("At least one line item is required", 400)

        total_value = 0.0
        has_individual_items = False
        request_lines: list[StockRequestLine] = []

        for line in lines:
            part = self.repo.get_part(line["part_id"])
            if not part:
                raise ServiceError(f"Invalid part_id {line['part_id']}", 400)
            if not part.is_active:
                raise ServiceError(f"Part {part.sku} is inactive", 400)
            quantity = line["quantity"]
            if quantity < 1:
                raise ServiceError("Quantity must be >= 1", 400)
            unit_cost = float(part.unit_price or 0)
            total_value += unit_cost * quantity
            if part.tracking_type == "INDIVIDUAL":
                has_individual_items = True
            request_lines.append(
                StockRequestLine(
                    part_id=part.id,
                    quantity=quantity,
                    unit_cost=unit_cost,
                    tracking_type=part.tracking_type,
                )
            )

        resolved_customer_id = customer_id
        if resolved_customer_id is None and customer_name and customer_name.strip():
            customer = Customer(name=customer_name.strip())
            self.repo.add(customer)
            self.repo.db.flush()
            resolved_customer_id = customer.id

        resolved_job_id = job_id
        if resolved_job_id is None and job_title and job_title.strip():
            if resolved_customer_id is None:
                raise ServiceError("customer_id or customer_name is required when creating a job in request", 400)
            job = Job(
                customer_id=resolved_customer_id,
                title=job_title.strip(),
                status="open",
                priority="medium",
                created_by_user_id=current_user.id,
            )
            self.repo.add(job)
            self.repo.db.flush()
            resolved_job_id = job.id

        request = StockRequest(
            requested_by_user_id=current_user.id,
            customer_id=resolved_customer_id,
            job_id=resolved_job_id,
            status=StockRequestStatus.PENDING,
            total_value=total_value,
            required_approval_role=self.get_required_role(total_value, has_individual_items=has_individual_items),
        )
        request.lines = request_lines
        self.repo.add(request)
        log_audit(
            self.repo.db,
            current_user,
            action="create",
            entity_type="stock_request",
            detail={
                "customer_id": resolved_customer_id,
                "job_id": resolved_job_id,
                "line_count": len(lines),
                "created_customer_inline": customer_id is None and resolved_customer_id is not None,
                "created_job_inline": job_id is None and resolved_job_id is not None,
            },
        )
        self.repo.commit()
        self.repo.refresh(request)
        dispatch_alert(
            self.repo.db,
            actor=current_user,
            event="request_created",
            subject=f"Stock Request #{request.id} Created",
            body=f"Request #{request.id} was created by {current_user.email}.",
        )
        return request

    def list_requests(self, *, status_value: str | None, mine: bool, current_user: User) -> list[StockRequest]:
        is_technician = current_user.role in {"technician", "staff"}
        requested_by_user_id = current_user.id if (mine or is_technician) else None
        return self.repo.list_requests(status_value=status_value, requested_by_user_id=requested_by_user_id)

    def approve_request(self, *, request_id: int, approver: User) -> StockRequest:
        request = self.repo.get_request(request_id)
        if not request:
            raise ServiceError("Request not found", 404)
        if request.status != StockRequestStatus.PENDING:
            raise ServiceError("Request is not pending", 400)

        if request.requested_by_user_id == approver.id:
            raise ServiceError("Approver cannot approve their own request", 403)

        if request.required_approval_role == "admin" and approver.role != "admin":
            raise ServiceError("Admin approval required", 403)

        request.status = StockRequestStatus.APPROVED
        request.approved_by_user_id = approver.id
        request.approved_at = datetime.now(UTC)

        log_audit(
            self.repo.db,
            approver,
            action="approve",
            entity_type="stock_request",
            entity_id=request.id,
        )
        self.repo.commit()
        self.repo.refresh(request)
        requester_recipients: list[str] = []
        if request.requested_by and request.requested_by.email:
            requester_recipients.append(request.requested_by.email)
        if request.requested_by and request.requested_by.phone:
            requester_recipients.append(request.requested_by.phone)
        dispatch_alert(
            self.repo.db,
            actor=approver,
            event="request_approved",
            subject=f"Stock Request #{request.id} Approved",
            body=f"Request #{request.id} has been approved by {approver.email}.",
            extra_recipients=requester_recipients or None,
        )
        return request

    def approve_request_with_comment(self, *, request_id: int, approver: User, comment: str | None) -> StockRequest:
        request = self.approve_request(request_id=request_id, approver=approver)
        cleaned_comment = (comment or "").strip() or None
        request.approved_comment = cleaned_comment
        log_audit(
            self.repo.db,
            approver,
            action="approve_comment",
            entity_type="stock_request",
            entity_id=request.id,
            detail={"has_comment": cleaned_comment is not None},
        )
        self.repo.commit()
        self.repo.refresh(request)
        return request

    def reject_request(self, *, request_id: int, approver: User, reason: str) -> StockRequest:
        request = self.repo.get_request(request_id)
        if not request:
            raise ServiceError("Request not found", 404)
        if request.status != StockRequestStatus.PENDING:
            raise ServiceError("Request is not pending", 400)
        if request.requested_by_user_id == approver.id:
            raise ServiceError("Approver cannot reject their own request", 403)

        if request.required_approval_role == "admin" and approver.role != "admin":
            raise ServiceError("Admin approval required", 403)

        request.status = StockRequestStatus.REJECTED
        request.rejected_reason = reason
        request.approved_by_user_id = approver.id
        request.approved_at = datetime.now(UTC)

        log_audit(
            self.repo.db,
            approver,
            action="reject",
            entity_type="stock_request",
            entity_id=request.id,
            detail={"reason": reason},
        )
        self.repo.commit()
        self.repo.refresh(request)
        requester_recipients: list[str] = []
        if request.requested_by and request.requested_by.email:
            requester_recipients.append(request.requested_by.email)
        if request.requested_by and request.requested_by.phone:
            requester_recipients.append(request.requested_by.phone)
        dispatch_alert(
            self.repo.db,
            actor=approver,
            event="request_rejected",
            subject=f"Stock Request #{request.id} Rejected",
            body=f"Request #{request.id} was rejected by {approver.email}. Reason: {reason}",
            extra_recipients=requester_recipients or None,
        )
        return request

    def issue_request(self, *, request_id: int, current_user: User, lines: list[dict]) -> StockRequest:
        request = self.repo.get_request(request_id)
        if not request:
            raise ServiceError("Request not found", 404)
        if request.status != StockRequestStatus.APPROVED:
            raise ServiceError("Request is not approved", 400)
        if not lines:
            raise ServiceError("At least one issue line is required", 400)

        technician_id = request.requested_by_user_id
        request_line_ids = {int(line.id) for line in request.lines}
        submitted_ids: list[int] = []
        for line in lines:
            raw_line_id = line.get("line_id")
            try:
                line_id = int(raw_line_id)
            except Exception:
                raise ServiceError("Each issue line must include a valid line_id", 400)
            submitted_ids.append(line_id)

        if len(set(submitted_ids)) != len(submitted_ids):
            raise ServiceError("Duplicate line_id submitted in issuance", 400)
        if set(submitted_ids) != request_line_ids:
            raise ServiceError("Issue payload must include each approved request line exactly once", 400)

        try:
            for line in lines:
                req_line = self.repo.get_request_line(line["line_id"])
                if not req_line or req_line.request_id != request.id:
                    raise ServiceError("Invalid request line", 400)

                part = self.repo.get_part(req_line.part_id)
                if not part:
                    raise ServiceError("Invalid part", 400)
                if not part.is_active:
                    raise ServiceError(f"Part {part.sku} is inactive", 400)

                if part.tracking_type == "INDIVIDUAL":
                    self._issue_individual_line(
                        request=request,
                        req_line=req_line,
                        part=part,
                        current_user=current_user,
                        technician_id=technician_id,
                        selected_instance_ids=line.get("item_instance_ids") or [],
                    )
                else:
                    quantity = int(line.get("quantity", 0))
                    self._issue_batch_line(
                        request=request,
                        req_line=req_line,
                        part=part,
                        current_user=current_user,
                        technician_id=technician_id,
                        quantity=quantity,
                    )

            request.status = StockRequestStatus.ISSUED
            if request.job_id is not None:
                job = self.repo.db.get(Job, request.job_id)
                if job and (job.status or "").lower() == "open":
                    job.status = "in_progress"
            log_audit(
                self.repo.db,
                current_user,
                action="issue",
                entity_type="stock_request",
                entity_id=request.id,
            )
            self.repo.commit()
        except Exception:
            self.repo.rollback()
            raise

        self.repo.refresh(request)
        requester_recipients: list[str] = []
        if request.requested_by and request.requested_by.email:
            requester_recipients.append(request.requested_by.email)
        if request.requested_by and request.requested_by.phone:
            requester_recipients.append(request.requested_by.phone)
        dispatch_alert(
            self.repo.db,
            actor=current_user,
            event="request_issued",
            subject=f"Stock Request #{request.id} Issued",
            body=f"Request #{request.id} has been issued by {current_user.email}.",
            extra_recipients=requester_recipients or None,
        )
        return request

    def record_usage(
        self,
        *,
        current_user: User,
        item_instance_id: int,
        scan_proof_token: str,
        request_id: int | None,
        customer_id: int | None,
        job_id: int | None,
        latitude: float | None,
        longitude: float | None,
    ) -> UsageRecord:
        if latitude is None or longitude is None:
            raise ServiceError("Geolocation is required for usage confirmation", 400)
        self.validate_usage_scan_proof_token(
            token=scan_proof_token,
            current_user=current_user,
            item_instance_id=item_instance_id,
        )
        instance = self.repo.get_item_instance(item_instance_id)
        if not instance:
            raise ServiceError("Invalid item_instance_id", 400)
        if instance.status != ItemStatus.ISSUED:
            raise ServiceError("Item must be in ISSUED state", 400)

        issued_tx = self.repo.get_latest_issue_transaction(item_instance_id, current_user.id)
        if not issued_tx:
            raise ServiceError("Item not issued to current user", 403)

        instance.status = ItemStatus.USED
        used_at = datetime.now(UTC)
        resolved_request_id = request_id or issued_tx.request_id
        resolved_customer_id = customer_id or issued_tx.customer_id
        resolved_job_id = job_id or issued_tx.job_id
        self._validate_usage_location(job_id=resolved_job_id, latitude=latitude, longitude=longitude)
        record_hash = self._build_usage_hash(
            item_instance_id=item_instance_id,
            request_id=resolved_request_id,
            technician_id=current_user.id,
            customer_id=resolved_customer_id,
            job_id=resolved_job_id,
            latitude=latitude,
            longitude=longitude,
            used_at=used_at,
        )

        usage = UsageRecord(
            item_instance_id=item_instance_id,
            request_id=resolved_request_id,
            technician_id=current_user.id,
            customer_id=resolved_customer_id,
            job_id=resolved_job_id,
            used_at=used_at,
            latitude=latitude,
            longitude=longitude,
            record_hash=record_hash,
        )
        self.repo.add(usage)
        self._sync_request_completion(resolved_request_id)
        log_audit(
            self.repo.db,
            current_user,
            action="record_usage",
            entity_type="item_instance",
            entity_id=item_instance_id,
        )
        self.repo.commit()
        self.repo.refresh(usage)
        dispatch_alert(
            self.repo.db,
            actor=current_user,
            event="usage_confirmed",
            subject=f"Usage Confirmed: Item #{item_instance_id}",
            body=f"{current_user.email} confirmed usage for serial {instance.serial_number} at ({latitude:.6f}, {longitude:.6f}).",
        )
        return usage

    def record_batch_usage(
        self,
        *,
        current_user: User,
        part_id: int,
        quantity: int,
        scan_code: str,
        request_id: int | None,
        customer_id: int | None,
        job_id: int | None,
        latitude: float | None,
        longitude: float | None,
    ) -> BatchUsageRecord:
        if latitude is None or longitude is None:
            raise ServiceError("Geolocation is required for usage confirmation", 400)
        part = self.repo.get_part(part_id)
        if not part:
            raise ServiceError("Invalid part_id", 400)
        normalized_scan = (scan_code or "").strip().upper()
        if not normalized_scan:
            raise ServiceError("scan_code is required", 400)
        scan_candidates = self._expand_scan_candidates(normalized_scan)
        accepted_tokens = {
            str(part.sku or "").strip().upper(),
            str(part.barcode_value or "").strip().upper(),
            str(part.name or "").strip().upper(),
            str(part.id),
        }
        accepted_tokens = {token for token in accepted_tokens if token}
        if accepted_tokens and accepted_tokens.isdisjoint(scan_candidates):
            raise ServiceError("Scanned code does not match the selected part", 400)

        if request_id:
            request = self.repo.get_request(request_id)
            if not request:
                raise ServiceError("Invalid request_id", 400)
            if request.requested_by_user_id != current_user.id:
                raise ServiceError("Request not owned by current user", 403)

        issued_batch = self.repo.get_latest_issued_batch(part_id, current_user.id, request_id=request_id)
        if not issued_batch:
            raise ServiceError("No issued batch quantity available for this item", 400)
        if quantity > issued_batch.quantity_remaining:
            raise ServiceError("Quantity exceeds issued balance", 400)

        issued_batch.quantity_remaining -= quantity
        resolved_job_id = job_id or issued_batch.job_id
        self._validate_usage_location(job_id=resolved_job_id, latitude=latitude, longitude=longitude)

        usage = BatchUsageRecord(
            part_id=part_id,
            quantity=quantity,
            request_id=request_id or issued_batch.request_id,
            technician_id=current_user.id,
            customer_id=customer_id or issued_batch.customer_id,
            job_id=resolved_job_id,
            latitude=latitude,
            longitude=longitude,
        )
        self.repo.add(usage)
        self._sync_request_completion(request_id or issued_batch.request_id)
        log_audit(
            self.repo.db,
            current_user,
            action="record_usage",
            entity_type="batch_item",
            entity_id=part_id,
            detail={"quantity": quantity},
        )
        self.repo.commit()
        self.repo.refresh(usage)
        dispatch_alert(
            self.repo.db,
            actor=current_user,
            event="usage_confirmed",
            subject=f"Batch Usage Confirmed: {part.sku}",
            body=f"{current_user.email} confirmed usage of {quantity} x {part.sku} at ({latitude:.6f}, {longitude:.6f}).",
        )
        return usage

    def list_issued_items_for_request(self, *, request_id: int, current_user: User) -> list[dict]:
        request = self.repo.get_request(request_id)
        if not request:
            raise ServiceError("Request not found", 404)
        if current_user.role == "technician" and request.requested_by_user_id != current_user.id:
            raise ServiceError("Access denied", 403)

        transactions = self.repo.list_outbound_instance_transactions_for_request(request_id)
        seen: set[int] = set()
        result: list[dict] = []
        for tx in transactions:
            if tx.item_instance_id is None:
                continue
            if tx.item_instance_id in seen:
                continue
            instance = self.repo.get_item_instance(tx.item_instance_id)
            part = self.repo.get_part(tx.part_id)
            if not instance or not part:
                continue
            if instance.status not in {ItemStatus.ISSUED, ItemStatus.USED}:
                continue
            seen.add(tx.item_instance_id)
            result.append(
                {
                    "item_instance_id": instance.id,
                    "serial_number": instance.serial_number,
                    "barcode_value": instance.barcode_value,
                    "part_id": part.id,
                    "part_sku": part.sku,
                    "part_name": part.name,
                    "request_id": tx.request_id,
                    "customer_id": tx.customer_id,
                    "job_id": tx.job_id,
                    "status": instance.status,
                }
            )
        return result

    def list_issued_items_for_technician(self, *, current_user: User) -> dict[str, list[dict]]:
        instance_transactions = self.repo.list_outbound_instance_transactions_for_technician(current_user.id)
        seen_instances: set[int] = set()
        instance_rows: list[dict] = []
        for tx in instance_transactions:
            if tx.item_instance_id is None or tx.item_instance_id in seen_instances:
                continue
            instance = self.repo.get_item_instance(tx.item_instance_id)
            part = self.repo.get_part(tx.part_id)
            if not instance or not part:
                continue
            if instance.status not in {ItemStatus.ISSUED, ItemStatus.USED}:
                continue
            seen_instances.add(tx.item_instance_id)
            instance_rows.append(
                {
                    "item_instance_id": instance.id,
                    "serial_number": instance.serial_number,
                    "barcode_value": instance.barcode_value,
                    "part_id": part.id,
                    "part_sku": part.sku,
                    "part_name": part.name,
                    "status": instance.status,
                    "request_id": tx.request_id,
                    "customer_id": tx.customer_id,
                    "job_id": tx.job_id,
                    "issued_at": tx.created_at,
                }
            )

        batch_rows: list[dict] = []
        for batch in self.repo.list_issued_batches_for_technician(current_user.id):
            part = self.repo.get_part(batch.part_id)
            if not part:
                continue
            batch_rows.append(
                {
                    "issued_batch_id": batch.id,
                    "part_id": part.id,
                    "part_sku": part.sku,
                    "part_name": part.name,
                    "quantity_remaining": batch.quantity_remaining,
                    "request_id": batch.request_id,
                    "customer_id": batch.customer_id,
                    "job_id": batch.job_id,
                    "issued_at": batch.created_at,
                }
            )
        return {"instances": instance_rows, "batches": batch_rows}

    def list_return_remarks_for_technician(self, *, current_user: User, limit: int = 20) -> list[dict]:
        stmt = (
            select(StockTransaction)
            .where(
                StockTransaction.technician_id == current_user.id,
                StockTransaction.notes.is_not(None),
                StockTransaction.notes != "",
                StockTransaction.movement_type.in_(["RETURN", "FAULTY_RETURN", "RETURN_APPROVED", "RETURN_REJECTED"]),
                StockTransaction.transaction_type.in_([StockTransactionType.IN, StockTransactionType.ADJUST]),
            )
            .order_by(StockTransaction.created_at.desc())
            .limit(limit)
        )
        rows = self.repo.db.scalars(stmt).all()
        result: list[dict] = []
        for tx in rows:
            part = self.repo.get_part(tx.part_id)
            author = self.repo.db.get(User, tx.created_by_user_id) if tx.created_by_user_id else None
            note_text = tx.notes or ""
            if note_text.startswith("RETURN_META:"):
                payload_text = note_text[len("RETURN_META:") :]
                try:
                    payload = json.loads(payload_text)
                except Exception:
                    payload = {}
                status = str(payload.get("status") or "").upper()
                if status == "REJECTED":
                    reason = str(payload.get("rejected_reason") or "No reason provided.")
                    note_text = f"Return rejected by manager. Reason: {reason}"
                elif status == "APPROVED":
                    manager_remark = str(payload.get("manager_remark") or "").strip()
                    note_text = "Return approved by manager." if not manager_remark else f"Return approved by manager. Remark: {manager_remark}"
            result.append(
                {
                    "id": tx.id,
                    "request_id": tx.request_id,
                    "part_id": tx.part_id,
                    "part_sku": part.sku if part else "",
                    "part_name": part.name if part else f"Part #{tx.part_id}",
                    "movement_type": tx.movement_type,
                    "notes": note_text,
                    "created_by_email": author.email if author else None,
                    "created_at": tx.created_at,
                }
            )
        return result

    def find_issued_item_for_technician_by_serial(self, *, current_user: User, serial: str) -> dict | None:
        rows = self.list_issued_items_for_technician(current_user=current_user)["instances"]
        needle = serial.strip().upper()
        if not needle:
            return None
        for row in rows:
            serial_value = str(row["serial_number"]).strip().upper()
            barcode_value = str(row.get("barcode_value") or "").strip().upper()
            sku_value = str(row.get("part_sku") or "").strip().upper()
            name_value = str(row.get("part_name") or "").strip().upper()
            request_id = row.get("request_id")
            request_ref = f"REQ-{request_id}".upper() if request_id else ""
            request_id_str = str(request_id).strip().upper() if request_id is not None else ""

            if serial_value == needle or (barcode_value and barcode_value == needle):
                return row
            if sku_value and (needle == sku_value or needle in sku_value):
                return row
            if name_value and needle in name_value:
                return row
            if request_ref and (needle == request_ref or needle == request_id_str):
                return row
        return None

    def build_usage_scan_proof_token(self, *, current_user: User, item_instance_id: int) -> str:
        now = datetime.now(UTC)
        payload = {
            "sub": "usage_scan",
            "uid": current_user.id,
            "iid": item_instance_id,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=15)).timestamp()),
        }
        return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

    def validate_usage_scan_proof_token(self, *, token: str, current_user: User, item_instance_id: int) -> None:
        try:
            payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        except JWTError as exc:
            raise ServiceError("Invalid or expired scan proof token", 400) from exc

        if payload.get("sub") != "usage_scan":
            raise ServiceError("Invalid scan proof token subject", 400)
        if int(payload.get("uid", 0) or 0) != current_user.id:
            raise ServiceError("Scan proof token user mismatch", 403)
        if int(payload.get("iid", 0) or 0) != item_instance_id:
            raise ServiceError("Scan proof token item mismatch", 400)

    def _validate_stock_availability(self, request: StockRequest) -> None:
        for line in request.lines:
            part = self.repo.get_part(line.part_id)
            if not part:
                raise ServiceError("Invalid part in request", 400)

            if part.tracking_type == "INDIVIDUAL":
                available_count = self.repo.count_available_instances(part.id)
                if available_count < line.quantity:
                    raise ServiceError(
                        f"Insufficient individual stock for part {part.sku}: requested {line.quantity}, available {available_count}",
                        400,
                    )
            else:
                if part.quantity_on_hand < line.quantity:
                    raise ServiceError(
                        f"Insufficient stock for part {part.sku}: requested {line.quantity}, available {part.quantity_on_hand}",
                        400,
                    )

    def _issue_individual_line(
        self,
        *,
        request: StockRequest,
        req_line: StockRequestLine,
        part: Part,
        current_user: User,
        technician_id: int,
        selected_instance_ids: list[int],
    ) -> None:
        instance_ids = selected_instance_ids
        if not instance_ids:
            instance_ids = [inst.id for inst in self.repo.list_available_instances(part.id, req_line.quantity)]

        if len(instance_ids) != req_line.quantity:
            raise ServiceError("Not enough available instances", 400)

        for instance_id in instance_ids:
            instance = self.repo.get_item_instance(instance_id)
            if not instance or instance.part_id != part.id:
                raise ServiceError("Invalid item instance", 400)
            if instance.status != ItemStatus.AVAILABLE:
                raise ServiceError("Item instance not available", 400)
            instance.status = ItemStatus.ISSUED
            part.quantity_on_hand -= 1
            self.repo.add(
                StockTransaction(
                    part_id=part.id,
                    created_by_user_id=current_user.id,
                    technician_id=technician_id,
                    customer_id=request.customer_id,
                    job_id=request.job_id,
                    request_id=request.id,
                    item_instance_id=instance.id,
                    transaction_type=StockTransactionType.OUT,
                    quantity_delta=-1,
                    movement_type="ISSUE",
                )
            )

    def _issue_batch_line(
        self,
        *,
        request: StockRequest,
        req_line: StockRequestLine,
        part: Part,
        current_user: User,
        technician_id: int,
        quantity: int,
    ) -> None:
        if quantity <= 0:
            raise ServiceError("Quantity must be positive", 400)
        if quantity > req_line.quantity:
            raise ServiceError("Quantity exceeds requested amount", 400)
        if part.quantity_on_hand < quantity:
            raise ServiceError("Insufficient stock", 400)

        part.quantity_on_hand -= quantity
        self.repo.add(
            StockTransaction(
                part_id=part.id,
                created_by_user_id=current_user.id,
                technician_id=technician_id,
                customer_id=request.customer_id,
                job_id=request.job_id,
                request_id=request.id,
                transaction_type=StockTransactionType.OUT,
                quantity_delta=-quantity,
                movement_type="ISSUE",
            )
        )
        self.repo.add(
            IssuedBatchItem(
                part_id=part.id,
                technician_id=technician_id,
                request_id=request.id,
                customer_id=request.customer_id,
                job_id=request.job_id,
                quantity_remaining=quantity,
            )
        )

    def _sync_request_completion(self, request_id: int | None) -> None:
        if request_id is None:
            return
        request = self.repo.get_request(request_id)
        if not request:
            return
        if request.status not in {StockRequestStatus.ISSUED, StockRequestStatus.CLOSED}:
            return

        pending_returns = int(
            self.repo.db.scalar(
                select(func.count(StockTransaction.id)).where(
                    StockTransaction.request_id == request_id,
                    StockTransaction.movement_type == "RETURN_PENDING",
                )
            )
            or 0
        )
        if pending_returns > 0:
            request.status = StockRequestStatus.ISSUED
            request.closure_type = None
            request.closed_at = None
            return

        issued_txs = self.repo.list_outbound_instance_transactions_for_request(request_id)
        instance_ids = {tx.item_instance_id for tx in issued_txs if tx.item_instance_id is not None}
        has_open_individual = False
        for instance_id in instance_ids:
            instance = self.repo.get_item_instance(int(instance_id))
            if instance and instance.status == ItemStatus.ISSUED:
                has_open_individual = True
                break

        batch_remaining = int(
            self.repo.db.scalar(
                select(func.coalesce(func.sum(IssuedBatchItem.quantity_remaining), 0)).where(
                    IssuedBatchItem.request_id == request_id,
                    IssuedBatchItem.quantity_remaining > 0,
                )
            )
            or 0
        )
        if has_open_individual or batch_remaining > 0:
            request.status = StockRequestStatus.ISSUED
            request.closure_type = None
            request.closed_at = None
            return

        has_return_activity = int(
            self.repo.db.scalar(
                select(func.count(StockTransaction.id)).where(
                    StockTransaction.request_id == request_id,
                    StockTransaction.movement_type.in_(["RETURN", "FAULTY_RETURN"]),
                )
            )
            or 0
        ) > 0

        request.status = StockRequestStatus.CLOSED
        request.closure_type = "RETURNED" if has_return_activity else "SOLD"
        request.closed_at = datetime.now(UTC)
        self._sync_job_completion(request.job_id)

    def _sync_job_completion(self, job_id: int | None) -> None:
        if job_id is None:
            return
        job = self.repo.db.get(Job, job_id)
        if not job:
            return
        active_requests = int(
            self.repo.db.scalar(
                select(func.count(StockRequest.id)).where(
                    StockRequest.job_id == job_id,
                    StockRequest.status.in_(
                        [
                            StockRequestStatus.PENDING,
                            StockRequestStatus.APPROVED,
                            StockRequestStatus.ISSUED,
                        ]
                    ),
                )
            )
            or 0
        )
        if active_requests == 0 and (job.status or "").lower() != "completed":
            job.status = "completed"

    def _validate_usage_location(self, *, job_id: int | None, latitude: float, longitude: float) -> None:
        if job_id is None:
            return
        job = self.repo.db.get(Job, job_id)
        if not job or job.site_latitude is None or job.site_longitude is None:
            return
        distance_m = self._haversine_meters(
            latitude,
            longitude,
            float(job.site_latitude),
            float(job.site_longitude),
        )
        # 300m radius tolerance for field GPS jitter.
        if distance_m > 300:
            raise ServiceError(
                f"GPS location does not match job site (distance {distance_m:.0f}m). Move to the job location and retry.",
                400,
            )

    def _haversine_meters(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        r = 6371000.0
        p1 = math.radians(lat1)
        p2 = math.radians(lat2)
        dp = math.radians(lat2 - lat1)
        dl = math.radians(lon2 - lon1)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    def _expand_scan_candidates(self, normalized_scan: str) -> set[str]:
        candidates: set[str] = {normalized_scan}
        decoded = unquote(normalized_scan).strip()
        if decoded:
            candidates.add(decoded.upper())
        if "://" not in decoded:
            return candidates

        try:
            parsed = urlparse(decoded)
        except Exception:
            return candidates

        part_id = (parsed.path or "").rstrip("/").split("/")[-1].strip()
        if part_id:
            candidates.add(part_id.upper())

        query = parse_qs(parsed.query or "")
        sku_values = query.get("sku") or []
        for sku in sku_values:
            token = (sku or "").strip().upper()
            if token:
                candidates.add(token)

        return candidates

    def _build_usage_hash(
        self,
        *,
        item_instance_id: int,
        request_id: int | None,
        technician_id: int,
        customer_id: int | None,
        job_id: int | None,
        latitude: float | None,
        longitude: float | None,
        used_at: datetime,
    ) -> str:
        payload = "|".join(
            [
                str(item_instance_id),
                str(request_id or ""),
                str(technician_id),
                str(customer_id or ""),
                str(job_id or ""),
                str(latitude or ""),
                str(longitude or ""),
                used_at.isoformat(),
            ]
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()
