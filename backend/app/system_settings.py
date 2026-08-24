from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import settings as env_settings
from app.models import AppSetting


SETTING_APPROVAL_THRESHOLD_MANAGER = "approval_threshold_manager"
SETTING_APPROVAL_THRESHOLD_ADMIN = "approval_threshold_admin"
SETTING_APPROVAL_INDIVIDUAL_ROLE = "approval_individual_role"
SETTING_LOW_STOCK_DEFAULT_LIMIT = "low_stock_default_limit"
SETTING_NOTIFICATION_EMAIL_ENABLED = "notification_email_enabled"
SETTING_NOTIFICATION_SMS_ENABLED = "notification_sms_enabled"
SETTING_NOTIFICATION_RECIPIENTS = "notification_recipients"
SETTING_FAULTY_QUARANTINE_LOCATION_ID = "faulty_quarantine_location_id"
SETTING_BRANDING_LOGO_URL = "branding_logo_url"
SETTING_SMTP_HOST = "smtp_host"
SETTING_SMTP_PORT = "smtp_port"
SETTING_SMTP_USERNAME = "smtp_username"
SETTING_SMTP_PASSWORD = "smtp_password"
SETTING_SMTP_FROM_EMAIL = "smtp_from_email"
SETTING_SMTP_USE_TLS = "smtp_use_tls"


@dataclass
class EffectiveSettings:
    approval_threshold_manager: float
    approval_threshold_admin: float
    approval_individual_role: str
    low_stock_default_limit: int
    notification_email_enabled: bool
    notification_sms_enabled: bool
    notification_recipients: str
    faulty_quarantine_location_id: int | None
    branding_logo_url: str
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    smtp_from_email: str
    smtp_use_tls: bool


def _get_raw_setting(db: Session, key: str) -> str | None:
    try:
        return db.execute(
            text("SELECT value FROM app_settings WHERE key = :key LIMIT 1"),
            {"key": key},
        ).scalar_one_or_none()
    except SQLAlchemyError:
        db.rollback()
        return None


def _parse_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def get_effective_settings(db: Session) -> EffectiveSettings:
    manager_value = _get_raw_setting(db, SETTING_APPROVAL_THRESHOLD_MANAGER)
    admin_value = _get_raw_setting(db, SETTING_APPROVAL_THRESHOLD_ADMIN)
    individual_role_value = _get_raw_setting(db, SETTING_APPROVAL_INDIVIDUAL_ROLE)
    low_stock_limit_value = _get_raw_setting(db, SETTING_LOW_STOCK_DEFAULT_LIMIT)
    email_enabled_value = _get_raw_setting(db, SETTING_NOTIFICATION_EMAIL_ENABLED)
    sms_enabled_value = _get_raw_setting(db, SETTING_NOTIFICATION_SMS_ENABLED)
    recipients_value = _get_raw_setting(db, SETTING_NOTIFICATION_RECIPIENTS)
    quarantine_location_value = _get_raw_setting(db, SETTING_FAULTY_QUARANTINE_LOCATION_ID)
    branding_logo_url_value = _get_raw_setting(db, SETTING_BRANDING_LOGO_URL)
    smtp_host_value = _get_raw_setting(db, SETTING_SMTP_HOST)
    smtp_port_value = _get_raw_setting(db, SETTING_SMTP_PORT)
    smtp_username_value = _get_raw_setting(db, SETTING_SMTP_USERNAME)
    smtp_password_value = _get_raw_setting(db, SETTING_SMTP_PASSWORD)
    smtp_from_email_value = _get_raw_setting(db, SETTING_SMTP_FROM_EMAIL)
    smtp_use_tls_value = _get_raw_setting(db, SETTING_SMTP_USE_TLS)

    try:
        approval_threshold_manager = float(manager_value) if manager_value is not None else float(env_settings.approval_threshold_manager)
    except ValueError:
        approval_threshold_manager = float(env_settings.approval_threshold_manager)

    try:
        approval_threshold_admin = float(admin_value) if admin_value is not None else float(env_settings.approval_threshold_admin)
    except ValueError:
        approval_threshold_admin = float(env_settings.approval_threshold_admin)

    try:
        low_stock_default_limit = int(low_stock_limit_value) if low_stock_limit_value is not None else 200
    except ValueError:
        low_stock_default_limit = 200

    try:
        faulty_quarantine_location_id = int(quarantine_location_value) if quarantine_location_value else None
    except ValueError:
        faulty_quarantine_location_id = None

    try:
        smtp_port = int(smtp_port_value) if smtp_port_value is not None else int(env_settings.smtp_port)
    except ValueError:
        smtp_port = int(env_settings.smtp_port)

    approval_individual_role = (individual_role_value or "none").strip().lower()
    if approval_individual_role not in {"none", "manager", "admin"}:
        approval_individual_role = "none"

    return EffectiveSettings(
        approval_threshold_manager=approval_threshold_manager,
        approval_threshold_admin=approval_threshold_admin,
        approval_individual_role=approval_individual_role,
        low_stock_default_limit=low_stock_default_limit,
        notification_email_enabled=_parse_bool(email_enabled_value, False),
        notification_sms_enabled=_parse_bool(sms_enabled_value, False),
        notification_recipients=recipients_value or "",
        faulty_quarantine_location_id=faulty_quarantine_location_id,
        branding_logo_url=branding_logo_url_value or "",
        smtp_host=(smtp_host_value or env_settings.smtp_host or "").strip(),
        smtp_port=smtp_port,
        smtp_username=(smtp_username_value or env_settings.smtp_username or "").strip(),
        smtp_password=(smtp_password_value or env_settings.smtp_password or "").strip(),
        smtp_from_email=(smtp_from_email_value or env_settings.smtp_from_email or "").strip(),
        smtp_use_tls=_parse_bool(smtp_use_tls_value, bool(env_settings.smtp_use_tls)),
    )


def upsert_setting(db: Session, *, key: str, value: str, updated_by_user_id: int | None) -> AppSetting:
    from sqlalchemy import select

    row = db.scalar(select(AppSetting).where(AppSetting.key == key).limit(1))
    if row is None:
        row = AppSetting(key=key, value=value, updated_by_user_id=updated_by_user_id)
        db.add(row)
    else:
        row.value = value
        row.updated_by_user_id = updated_by_user_id
    return row
