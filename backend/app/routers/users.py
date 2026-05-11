from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.audit import log_audit
from app.db import get_db
from app.deps import get_current_user, require_admin, require_roles
from app.models import TechnicianZoneAssignment, User, UserPreference
from app.schemas import (
    TechnicianZoneCreate,
    TechnicianZoneRead,
    TechnicianZoneUpdate,
    UserAdminPasswordReset,
    UserCreate,
    UserPasswordChange,
    UserPreferencesRead,
    UserPreferencesUpdate,
    UserRead,
    UserUpdate,
)
from app.security import get_password_hash, verify_password


router = APIRouter(prefix="/users", tags=["users"])
ALLOWED_LANDING_PAGES = {
    "/console",
    "/dashboard",
    "/jobs",
    "/deliveries",
    "/requests",
    "/approvals",
    "/inventory",
    "/customers",
    "/guide",
    "/inventory-guide",
}


def _sanitize_email(email: str | None, fallback_user_id: int) -> str:
    safe_email = email or ""
    domain = safe_email.split("@")[-1].lower() if "@" in safe_email else ""
    reserved_tlds = {"local", "test", "example", "localhost", "invalid"}
    if domain.split(".")[-1] in reserved_tlds:
        return f"user{fallback_user_id}@example.com"
    return safe_email


def _to_user_read(user: User) -> UserRead:
    return UserRead(
        id=user.id,
        tenant_id=user.tenant_id,
        email=_sanitize_email(user.email, user.id),
        phone=user.phone,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        must_change_password=bool(user.must_change_password),
        region=user.region,
        area_code=user.area_code,
        zone_count=len(user.technician_zones or []),
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.get("", response_model=list[UserRead], dependencies=[Depends(require_admin)])
def list_users(db: Session = Depends(get_db)) -> list[UserRead]:
    users = db.scalars(select(User).order_by(User.id)).all()
    return [_to_user_read(user) for user in users]


@router.post("", response_model=UserRead, dependencies=[Depends(require_admin)])
def create_user(payload: UserCreate, db: Session = Depends(get_db)) -> UserRead:
    existing = db.scalar(select(User).where(User.email == str(payload.email).lower()))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")

    if payload.role not in {"admin", "technician", "lead_technician", "store_manager", "manager", "approver", "finance", "staff", "rider", "driver"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")

    try:
        password_hash = get_password_hash(payload.password)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    user = User(
        tenant_id=int(payload.tenant_id or 1),
        email=str(payload.email).lower(),
        phone=payload.phone.strip() if payload.phone else None,
        full_name=payload.full_name,
        role=payload.role,
        password_hash=password_hash,
        is_active=True,
        must_change_password=bool(payload.must_change_password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _to_user_read(user)


@router.patch("/{user_id}", response_model=UserRead, dependencies=[Depends(require_admin)])
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserRead:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    changes = payload.model_dump(exclude_unset=True)
    if "phone" in changes:
        changes["phone"] = (changes["phone"] or "").strip() or None
    if "role" in changes:
        role = changes["role"]
        if role not in {"admin", "technician", "lead_technician", "store_manager", "manager", "approver", "finance", "staff", "rider", "driver"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid role")
        if user.id == current_user.id and role != "admin":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot remove your own admin role")

    if "is_active" in changes and user.id == current_user.id and changes["is_active"] is False:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot deactivate your own account")
    if "must_change_password" in changes:
        changes["must_change_password"] = bool(changes["must_change_password"])

    for key, value in changes.items():
        setattr(user, key, value)

    log_audit(db, current_user, "update", "user", entity_id=user_id, detail=changes)
    db.commit()
    db.refresh(user)
    return _to_user_read(user)


@router.post("/me/password", status_code=status.HTTP_200_OK, response_class=Response)
def change_my_password(
    payload: UserPasswordChange,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New password must be different")
    try:
        current_user.password_hash = get_password_hash(payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    current_user.must_change_password = False
    log_audit(db, current_user, "password_change", "user", entity_id=current_user.id)
    db.commit()
    return None


@router.post("/{user_id}/password", status_code=status.HTTP_200_OK, response_class=Response, dependencies=[Depends(require_admin)])
def reset_user_password(
    user_id: int,
    payload: UserAdminPasswordReset,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    try:
        user.password_hash = get_password_hash(payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    user.must_change_password = bool(payload.must_change_password)
    log_audit(db, current_user, "password_reset", "user", entity_id=user_id)
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database write failed during password reset. Check DB path/permissions and try again.",
        )
    return None


@router.delete("/{user_id}", status_code=status.HTTP_200_OK, response_class=Response, dependencies=[Depends(require_roles("approver", "manager"))])
def deactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot deactivate your own account")
    user.is_active = False
    log_audit(db, current_user, "deactivate", "user", entity_id=user_id)
    db.commit()
    return None


@router.post("/{user_id}/reactivate", status_code=status.HTTP_200_OK, response_class=Response, dependencies=[Depends(require_roles("approver", "manager"))])
def reactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.is_active = True
    log_audit(db, current_user, "reactivate", "user", entity_id=user_id)
    db.commit()
    return None


@router.delete("/{user_id}/hard", status_code=status.HTTP_200_OK, response_class=Response, dependencies=[Depends(require_admin)])
def hard_delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete your own account")
    
    # Clear foreign key references to allow deletion
    # Since some columns are NOT NULL, we need to delete related records instead
    from sqlalchemy import text
    
    # Delete stock_requests where user was the requester or approver
    db.execute(text("DELETE FROM stock_requests WHERE requested_by_user_id = :uid"), {"uid": user_id})
    db.execute(text("DELETE FROM stock_requests WHERE approved_by_user_id = :uid"), {"uid": user_id})
    
    # Clear jobs references (these columns are nullable)
    db.execute(text("UPDATE jobs SET created_by_user_id = NULL WHERE created_by_user_id = :uid"), {"uid": user_id})
    db.execute(text("UPDATE jobs SET assigned_to_user_id = NULL WHERE assigned_to_user_id = :uid"), {"uid": user_id})
    
    db.delete(user)
    log_audit(db, current_user, "hard_delete", "user", entity_id=user_id)
    db.commit()
    return None


@router.get(
    "/assignable",
    response_model=list[UserRead],
    dependencies=[Depends(require_roles("lead_technician", "store_manager", "manager"))],
)
def list_assignable_users(db: Session = Depends(get_db)) -> list[UserRead]:
    users = db.scalars(
        select(User)
        .where(User.is_active.is_(True))
        .where(User.role.in_(["technician", "lead_technician", "staff"]))
        .order_by(User.full_name.asc(), User.email.asc())
    ).all()
    # Sanitize emails with reserved TLDs
    return [_to_user_read(user) for user in users]


@router.get("/me", response_model=UserRead)
def read_me(current_user: User = Depends(get_current_user)) -> UserRead:
    return _to_user_read(current_user)


@router.get("/me/zones", response_model=list[TechnicianZoneRead])
def list_my_zones(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[TechnicianZoneRead]:
    rows = db.scalars(
        select(TechnicianZoneAssignment)
        .where(TechnicianZoneAssignment.user_id == current_user.id)
        .order_by(TechnicianZoneAssignment.zone_order.asc(), TechnicianZoneAssignment.id.asc())
    ).all()
    return [TechnicianZoneRead.model_validate(row, from_attributes=True) for row in rows]


@router.get("/{user_id}/zones", response_model=list[TechnicianZoneRead], dependencies=[Depends(require_admin)])
def list_user_zones(user_id: int, db: Session = Depends(get_db)) -> list[TechnicianZoneRead]:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    rows = db.scalars(
        select(TechnicianZoneAssignment)
        .where(TechnicianZoneAssignment.user_id == user_id)
        .order_by(TechnicianZoneAssignment.zone_order.asc(), TechnicianZoneAssignment.id.asc())
    ).all()
    return [TechnicianZoneRead.model_validate(row, from_attributes=True) for row in rows]


@router.post("/{user_id}/zones", response_model=TechnicianZoneRead, dependencies=[Depends(require_admin)])
def create_user_zone(
    user_id: int,
    payload: TechnicianZoneCreate,
    db: Session = Depends(get_db),
) -> TechnicianZoneRead:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    row = TechnicianZoneAssignment(
        tenant_id=user.tenant_id,
        user_id=user.id,
        region_label=payload.region_label.strip(),
        station_name=payload.station_name.strip(),
        client_code=(payload.client_code or "").strip() or None,
        zone_order=int(payload.zone_order),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return TechnicianZoneRead.model_validate(row, from_attributes=True)


@router.patch("/{user_id}/zones/{zone_id}", response_model=TechnicianZoneRead, dependencies=[Depends(require_admin)])
def update_user_zone(
    user_id: int,
    zone_id: int,
    payload: TechnicianZoneUpdate,
    db: Session = Depends(get_db),
) -> TechnicianZoneRead:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    row = db.get(TechnicianZoneAssignment, zone_id)
    if not row or row.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zone not found")
    changes = payload.model_dump(exclude_unset=True)
    if "region_label" in changes:
        row.region_label = (changes["region_label"] or "").strip()
    if "station_name" in changes:
        row.station_name = (changes["station_name"] or "").strip()
    if "client_code" in changes:
        row.client_code = (changes["client_code"] or "").strip() or None
    if "zone_order" in changes:
        row.zone_order = int(changes["zone_order"])
    db.commit()
    db.refresh(row)
    return TechnicianZoneRead.model_validate(row, from_attributes=True)


@router.delete("/{user_id}/zones/{zone_id}", status_code=status.HTTP_200_OK, response_class=Response, dependencies=[Depends(require_admin)])
def delete_user_zone(
    user_id: int,
    zone_id: int,
    db: Session = Depends(get_db),
) -> None:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    row = db.get(TechnicianZoneAssignment, zone_id)
    if not row or row.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Zone not found")
    db.delete(row)
    db.commit()
    return None


@router.get("/me/preferences", response_model=UserPreferencesRead)
def read_my_preferences(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserPreferencesRead:
    prefs = db.scalar(select(UserPreference).where(UserPreference.user_id == current_user.id))
    if not prefs:
        return UserPreferencesRead()
    return UserPreferencesRead(
        default_landing_page=prefs.default_landing_page,
        dense_mode=bool(prefs.dense_mode),
        animations_enabled=bool(prefs.animations_enabled),
        show_email_in_header=bool(prefs.show_email_in_header),
        display_name_override=prefs.display_name_override,
    )


@router.put("/me/preferences", response_model=UserPreferencesRead)
def update_my_preferences(
    payload: UserPreferencesUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserPreferencesRead:
    changes = payload.model_dump(exclude_unset=True)
    if "default_landing_page" in changes:
        landing = (changes["default_landing_page"] or "").strip()
        if landing not in ALLOWED_LANDING_PAGES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid landing page")
        changes["default_landing_page"] = landing
    if "display_name_override" in changes:
        changes["display_name_override"] = (changes["display_name_override"] or "").strip() or None

    prefs = db.scalar(select(UserPreference).where(UserPreference.user_id == current_user.id))
    if not prefs:
        prefs = UserPreference(user_id=current_user.id)
        db.add(prefs)
        db.flush()
    for key, value in changes.items():
        setattr(prefs, key, value)

    log_audit(db, current_user, "update", "user_preferences", entity_id=current_user.id, detail=changes)
    db.commit()
    db.refresh(prefs)
    return UserPreferencesRead(
        default_landing_page=prefs.default_landing_page,
        dense_mode=bool(prefs.dense_mode),
        animations_enabled=bool(prefs.animations_enabled),
        show_email_in_header=bool(prefs.show_email_in_header),
        display_name_override=prefs.display_name_override,
    )
 
