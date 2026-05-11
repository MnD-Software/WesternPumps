from __future__ import annotations

from datetime import datetime
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, require_roles
from app.audit import log_audit
from app.event_stream import emit_domain_event
from app.models import Customer, Job, JobPhoto, User
from app.notifications import dispatch_alert
from app.schemas import JobCreate, JobRead, JobUpdate


router = APIRouter(prefix="/jobs", tags=["jobs"])


def _can_access_job_assets(current_user: User, job: Job) -> bool:
    role = (current_user.role or "").strip().lower()
    if role in {"admin", "manager", "store_manager", "approver", "finance"}:
        return True
    return (
        (job.assigned_to_user_id is not None and job.assigned_to_user_id == current_user.id)
        or (job.created_by_user_id is not None and job.created_by_user_id == current_user.id)
    )


@router.get("", response_model=list[JobRead], dependencies=[Depends(get_current_user)])
def list_jobs(db: Session = Depends(get_db)) -> list[JobRead]:
    jobs = db.scalars(select(Job).order_by(Job.created_at.desc())).all()
    return [JobRead.model_validate(j, from_attributes=True) for j in jobs]


@router.post("", response_model=JobRead, dependencies=[Depends(require_roles("admin", "lead_technician", "store_manager", "manager"))])
def create_job(
    payload: JobCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobRead:
    customer = db.get(Customer, payload.customer_id)
    if not customer:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid customer_id")

    if payload.site_latitude is None or payload.site_longitude is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Job site latitude and longitude are required")

    if current_user.role == "lead_technician":
        if payload.assigned_to_user_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lead technician must assign a technician")
        assignee = db.get(User, payload.assigned_to_user_id)
        if not assignee or assignee.role not in {"technician", "staff"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lead technician can only assign technician users")
    else:
        assignee = db.get(User, payload.assigned_to_user_id) if payload.assigned_to_user_id else None
        if payload.assigned_to_user_id and not assignee:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assigned_to_user_id")

    job = Job(**payload.model_dump(), created_by_user_id=current_user.id)
    db.add(job)
    log_audit(db, current_user, "create", "job", detail=payload.model_dump())
    db.commit()
    db.refresh(job)
    emit_domain_event(
        db,
        event_type="job.created",
        actor_user_id=current_user.id,
        payload={"job_id": job.id, "title": job.title, "status": job.status, "assigned_to_user_id": job.assigned_to_user_id},
    )
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
    return JobRead.model_validate(job, from_attributes=True)


@router.get("/{job_id}", response_model=JobRead, dependencies=[Depends(get_current_user)])
def get_job(job_id: int, db: Session = Depends(get_db)) -> JobRead:
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return JobRead.model_validate(job, from_attributes=True)


@router.patch("/{job_id}", response_model=JobRead, dependencies=[Depends(require_roles("admin", "lead_technician", "store_manager", "manager"))])
def update_job(job_id: int, payload: JobUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> JobRead:
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    if payload.customer_id is not None and not db.get(Customer, payload.customer_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid customer_id")
    if ("site_latitude" in payload.model_dump(exclude_unset=True)) ^ ("site_longitude" in payload.model_dump(exclude_unset=True)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide both site_latitude and site_longitude together")

    previous_assignee_id = job.assigned_to_user_id
    previous_status = (job.status or "open").lower()
    changes = payload.model_dump(exclude_unset=True)
    assignee = db.get(User, job.assigned_to_user_id) if job.assigned_to_user_id else None
    if "assigned_to_user_id" in changes:
        assigned_to_user_id = changes["assigned_to_user_id"]
        if assigned_to_user_id is not None:
            assignee = db.get(User, assigned_to_user_id)
            if not assignee:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assigned_to_user_id")
            if current_user.role == "lead_technician" and assignee.role not in {"technician", "staff"}:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lead technician can only assign technician users")

    for k, v in changes.items():
        setattr(job, k, v)
    log_audit(db, current_user, "update", "job", entity_id=job_id, detail=changes)
    db.commit()
    db.refresh(job)
    emit_domain_event(
        db,
        event_type="job.updated",
        actor_user_id=current_user.id,
        payload={"job_id": job.id, "status": job.status, "priority": job.priority, "assigned_to_user_id": job.assigned_to_user_id},
    )
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
    return JobRead.model_validate(job, from_attributes=True)


@router.delete("/{job_id}", status_code=status.HTTP_200_OK, response_class=Response, dependencies=[Depends(require_roles("admin", "manager"))])
def delete_job(job_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)) -> None:
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    db.delete(job)
    log_audit(db, current_user, "delete", "job", entity_id=job_id)
    db.commit()
    return None


# ============================================
# Job Photo Upload Endpoints
# ============================================


@router.post(
    "/{job_id}/photos",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("admin", "technician", "lead_technician", "store_manager", "manager"))],
)
async def upload_job_photo(
    job_id: int,
    file: UploadFile = File(...),
    photo_type: str = "GENERAL",
    description: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a photo to a job card. Technicians can add BEFORE, AFTER, PROGRESS, or DEFECT photos."""
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    if not _can_access_job_assets(current_user, job):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only upload photos for jobs assigned to you")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Photo exceeds 10MB limit")

    # Validate photo_type
    valid_types = ["GENERAL", "BEFORE", "AFTER", "DEFECT", "PROGRESS"]
    if photo_type.upper() not in valid_types:
        photo_type = "GENERAL"

    photo = JobPhoto(
        job_id=job_id,
        uploaded_by_user_id=current_user.id,
        file_name=file.filename or "photo.jpg",
        content_type=file.content_type,
        file_size=len(content),
        file_data=content,
        description=description,
        photo_type=photo_type.upper(),
    )
    db.add(photo)
    log_audit(
        db, current_user, "create", "job_photo",
        entity_id=job_id, detail={"file_name": photo.file_name, "photo_type": photo_type}
    )
    db.commit()
    db.refresh(photo)

    return {
        "id": photo.id,
        "job_id": photo.job_id,
        "file_name": photo.file_name,
        "photo_type": photo.photo_type,
        "description": photo.description,
        "created_at": photo.created_at.isoformat(),
    }


@router.get("/{job_id}/photos", dependencies=[Depends(get_current_user)])
def list_job_photos(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all photos for a job card."""
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    if not _can_access_job_assets(current_user, job):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    photos = db.scalars(select(JobPhoto).where(JobPhoto.job_id == job_id).order_by(desc(JobPhoto.created_at))).all()

    return [
        {
            "id": p.id,
            "file_name": p.file_name,
            "photo_type": p.photo_type,
            "description": p.description,
            "content_type": p.content_type,
            "file_size": p.file_size,
            "uploaded_by": p.uploaded_by.email if p.uploaded_by else None,
            "created_at": p.created_at.isoformat(),
        }
        for p in photos
    ]


@router.get("/{job_id}/photos/{photo_id}/download", dependencies=[Depends(get_current_user)])
def download_job_photo(
    job_id: int,
    photo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download a job photo."""
    photo = db.get(JobPhoto, photo_id)
    if not photo or photo.job_id != job_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found")
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    if not _can_access_job_assets(current_user, job):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    headers = {"Content-Disposition": f'inline; filename="{photo.file_name}"'}
    return Response(
        content=photo.file_data,
        media_type=photo.content_type or "image/jpeg",
        headers=headers
    )


@router.delete(
    "/{job_id}/photos/{photo_id}",
    status_code=status.HTTP_200_OK,
    response_class=Response,
    dependencies=[Depends(require_roles("admin", "lead_technician", "store_manager", "manager"))],
)
def delete_job_photo(
    job_id: int,
    photo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a job photo."""
    photo = db.get(JobPhoto, photo_id)
    if not photo or photo.job_id != job_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found")
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    if not _can_access_job_assets(current_user, job):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    db.delete(photo)
    log_audit(db, current_user, "delete", "job_photo", entity_id=photo_id)
    db.commit()
    return None


# ============================================
# Job Approval Workflow Endpoints
# ============================================


@router.post(
    "/{job_id}/submit-for-approval",
    response_model=JobRead,
    dependencies=[Depends(require_roles("technician", "lead_technician"))],
)
def submit_job_for_approval(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobRead:
    """Submit a job for approval. Changes status to 'pending_approval'."""
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    if job.status not in ["in_progress"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Job must be in progress to submit for approval"
        )

    job.status = "pending_approval"
    log_audit(db, current_user, "submit_for_approval", "job", entity_id=job_id)
    db.commit()
    db.refresh(job)

    dispatch_alert(
        db,
        actor=current_user,
        event="job_pending_approval",
        subject=f"Job #{job.id} awaiting approval",
        body=f"Job '{job.title}' submitted for approval by {current_user.email}",
    )

    return JobRead.model_validate(job, from_attributes=True)


@router.post(
    "/{job_id}/approve",
    response_model=JobRead,
    dependencies=[Depends(require_roles("manager", "admin", "lead_technician"))],
)
def approve_job(
    job_id: int,
    notes: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobRead:
    """Approve a job. Changes status to 'completed'."""
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    if job.status != "pending_approval":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Job must be pending approval to be approved"
        )

    job.status = "completed"
    job.approved_by_user_id = current_user.id
    job.approved_at = datetime.now()
    job.approval_notes = notes

    log_audit(db, current_user, "approve", "job", entity_id=job_id, detail={"notes": notes})
    db.commit()
    db.refresh(job)

    if job.assigned_to and job.assigned_to.email:
        dispatch_alert(
            db,
            actor=current_user,
            event="job_approved",
            subject=f"Job #{job.id} approved",
            body=f"Your job '{job.title}' has been approved. Notes: {notes}",
            extra_recipients=[job.assigned_to.email],
        )

    return JobRead.model_validate(job, from_attributes=True)


@router.post(
    "/{job_id}/reject",
    response_model=JobRead,
    dependencies=[Depends(require_roles("manager", "admin", "lead_technician"))],
)
def reject_job(
    job_id: int,
    reason: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JobRead:
    """Reject a job. Changes status back to 'in_progress'."""
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")

    if job.status != "pending_approval":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Job must be pending approval to be rejected"
        )

    job.status = "in_progress"
    job.approval_notes = f"REJECTED: {reason}"

    log_audit(db, current_user, "reject", "job", entity_id=job_id, detail={"reason": reason})
    db.commit()
    db.refresh(job)

    if job.assigned_to and job.assigned_to.email:
        dispatch_alert(
            db,
            actor=current_user,
            event="job_rejected",
            subject=f"Job #{job.id} needs revision",
            body=f"Your job '{job.title}' was returned for revision. Reason: {reason}",
            extra_recipients=[job.assigned_to.email],
        )

    return JobRead.model_validate(job, from_attributes=True)
