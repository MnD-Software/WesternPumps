"""Job service - business logic for job operations."""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from app.event_stream import emit_domain_event
from app.models import Customer, Job, User
from app.notifications import dispatch_alert
from app.schemas import JobCreate, JobUpdate
from app.audit import log_audit

if TYPE_CHECKING:
    from app.models import User as UserModel


class JobServiceError(Exception):
    """Base exception for job service errors."""
    pass


class JobNotFoundError(JobServiceError):
    """Raised when job is not found."""
    pass


class InvalidCustomerError(JobServiceError):
    """Raised when customer is invalid."""
    pass


class InvalidAssigneeError(JobServiceError):
    """Raised when assignee is invalid."""
    pass


def validate_job_payload(
    payload: JobCreate,
    db: Session,
    current_user: "UserModel",
) -> tuple[Customer, User | None]:
    """
    Validate job creation payload.
    
    Returns tuple of (customer, assignee).
    """
    customer = db.get(Customer, payload.customer_id)
    if not customer:
        raise InvalidCustomerError("Invalid customer_id")
    
    if not (payload.site_location_label or "").strip():
        raise ValueError("Job site name is required")
    if (payload.site_latitude is None) ^ (payload.site_longitude is None):
        raise ValueError("Provide both site_latitude and site_longitude together")
    
    assignee = None
    if payload.assigned_to_user_id:
        assignee = db.get(User, payload.assigned_to_user_id)
        if not assignee:
            raise InvalidAssigneeError("Invalid assigned_to_user_id")
        
        if current_user.role == "lead_technician" and assignee.role not in {"technician", "staff"}:
            raise InvalidAssigneeError("Lead technician can only assign technician users")
    
    return customer, assignee


def create_job(
    payload: JobCreate,
    db: Session,
    current_user: "UserModel",
) -> Job:
    """Create a new job."""
    customer, assignee = validate_job_payload(payload, db, current_user)
    
    job = Job(**payload.model_dump(), created_by_user_id=current_user.id)
    db.add(job)
    log_audit(db, current_user, "create", "job", detail=payload.model_dump())
    db.commit()
    db.refresh(job)
    
    emit_domain_event(
        db,
        event_type="job.created",
        actor_user_id=current_user.id,
        payload={
            "job_id": job.id,
            "title": job.title,
            "status": job.status,
            "assigned_to_user_id": job.assigned_to_user_id
        },
    )
    
    # Send notification to assignee
    if assignee and assignee.email:
        recipients = [assignee.email]
        if assignee.phone:
            recipients.append(assignee.phone)
        dispatch_alert(
            db,
            actor=current_user,
            event="job_assigned",
            subject=f"Job #{job.id} assigned to you",
            body=f"You have been assigned job #{job.id}: {job.title}",
            extra_recipients=recipients,
        )
    
    return job


def validate_update_payload(
    job: Job,
    payload: JobUpdate,
    db: Session,
    current_user: "UserModel",
) -> tuple[dict, User | None]:
    """Validate job update payload."""
    if payload.customer_id is not None and not db.get(Customer, payload.customer_id):
        raise InvalidCustomerError("Invalid customer_id")
    
    changes = payload.model_dump(exclude_unset=True)
    
    if "site_location_label" in changes and not (changes.get("site_location_label") or "").strip():
        raise ValueError("Job site name is required")

    # Validate coordinates are provided together
    if ("site_latitude" in changes) ^ ("site_longitude" in changes):
        raise ValueError("Provide both site_latitude and site_longitude together")
    
    # Validate assignee
    assignee = None
    if "assigned_to_user_id" in changes:
        assigned_to_user_id = changes["assigned_to_user_id"]
        if assigned_to_user_id is not None:
            assignee = db.get(User, assigned_to_user_id)
            if not assignee:
                raise InvalidAssigneeError("Invalid assigned_to_user_id")
            if current_user.role == "lead_technician" and assignee.role not in {"technician", "staff"}:
                raise InvalidAssigneeError("Lead technician can only assign technician users")
    elif job.assigned_to_user_id:
        assignee = db.get(User, job.assigned_to_user_id)
    
    return changes, assignee


def update_job(
    job: Job,
    payload: JobUpdate,
    db: Session,
    current_user: "UserModel",
) -> Job:
    """Update an existing job."""
    previous_assignee_id = job.assigned_to_user_id
    previous_status = (job.status or "open").lower()
    
    changes, assignee = validate_update_payload(job, payload, db, current_user)
    
    # Apply changes
    for k, v in changes.items():
        setattr(job, k, v)
    
    log_audit(db, current_user, "update", "job", entity_id=job.id, detail=changes)
    db.commit()
    db.refresh(job)
    
    emit_domain_event(
        db,
        event_type="job.updated",
        actor_user_id=current_user.id,
        payload={
            "job_id": job.id,
            "status": job.status,
            "priority": job.priority,
            "assigned_to_user_id": job.assigned_to_user_id
        },
    )
    
    # Notify on reassignment
    if job.assigned_to_user_id and job.assigned_to_user_id != previous_assignee_id and assignee and assignee.email:
        recipients = [assignee.email]
        if assignee.phone:
            recipients.append(assignee.phone)
        dispatch_alert(
            db,
            actor=current_user,
            event="job_reassigned",
            subject=f"Job #{job.id} assigned to you",
            body=f"You have been assigned job #{job.id}: {job.title}",
            extra_recipients=recipients,
        )
    
    # Notify on completion
    next_status = (job.status or "open").lower()
    if previous_status != "completed" and next_status == "completed":
        recipients: list[str] = []
        if job.created_by and job.created_by.email:
            recipients.append(job.created_by.email)
            if job.created_by.phone:
                recipients.append(job.created_by.phone)
        if assignee and assignee.email:
            recipients.append(assignee.email)
            if assignee.phone:
                recipients.append(assignee.phone)
        dispatch_alert(
            db,
            actor=current_user,
            event="job_completed",
            subject=f"Job #{job.id} completed",
            body=f"Job #{job.id} ({job.title}) was marked completed by {current_user.email}.",
            extra_recipients=recipients or None,
        )
        emit_domain_event(
            db,
            event_type="job.completed",
            actor_user_id=current_user.id,
            payload={"job_id": job.id, "status": job.status},
        )
    
    return job
