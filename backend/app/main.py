from __future__ import annotations

from collections import deque
from contextlib import asynccontextmanager
from datetime import UTC, datetime
import logging
import math
import threading
import time
import traceback
import uuid
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware import Middleware
from fastapi.middleware.cors import CORSMiddleware
from fastapi.requests import Request
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.config import settings
from app.db import Base, SessionLocal, engine, ensure_schema
from app.deps import require_roles
from app.models import User
from app.security import get_password_hash
from app.routers import admin_settings, ai_assistant, assistant, auth, audit, categories, customers, deliveries, imports, integrations, inventory_science, jobs, locations, operations, parts, platform_ops, realtime, reports, reports_v2, requests, stock, suppliers, users, workflow


class UptimeMetrics:
    def __init__(self) -> None:
        self.started_at = datetime.now(UTC)
        self.total_requests = 0
        self.error_5xx_count = 0
        self._latencies_ms: deque[float] = deque(maxlen=20000)
        self._lock = threading.Lock()

    def record(self, *, latency_ms: float, status_code: int) -> None:
        with self._lock:
            self.total_requests += 1
            if status_code >= 500:
                self.error_5xx_count += 1
            self._latencies_ms.append(latency_ms)

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            total = self.total_requests
            errors = self.error_5xx_count
            latencies = list(self._latencies_ms)
        availability = ((total - errors) / total * 100.0) if total > 0 else 100.0
        latencies_sorted = sorted(latencies)
        p95_ms = 0.0
        if latencies_sorted:
            idx = min(math.ceil(len(latencies_sorted) * 0.95) - 1, len(latencies_sorted) - 1)
            p95_ms = latencies_sorted[idx]
        uptime_seconds = int((datetime.now(UTC) - self.started_at).total_seconds())
        return {
            "started_at": self.started_at.isoformat(),
            "uptime_seconds": uptime_seconds,
            "total_requests": total,
            "error_5xx_count": errors,
            "availability_percent": round(availability, 3),
            "p95_latency_ms": round(p95_ms, 3),
            "target_availability_percent": 99.9,
            "target_p95_latency_ms": 1000.0,
            "slo_met": availability >= 99.9 and p95_ms <= 1000.0,
        }


uptime_metrics = UptimeMetrics()
startup_database_error: str | None = None


def _configure_error_logger() -> logging.Logger:
    log_dir = Path(__file__).resolve().parents[1] / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "backend_errors.log"

    logger = logging.getLogger("westernpumps.errors")
    logger.setLevel(logging.INFO)
    logger.propagate = False

    # Avoid duplicate handlers when reloader spawns multiple app instances.
    has_file_handler = any(
        isinstance(h, RotatingFileHandler) and Path(getattr(h, "baseFilename", "")) == log_file
        for h in logger.handlers
    )
    if not has_file_handler:
        handler = RotatingFileHandler(
            log_file,
            maxBytes=2_000_000,
            backupCount=3,
            encoding="utf-8",
        )
        formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)

    return logger


class RequestErrorLoggingMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, logger: logging.Logger) -> None:
        super().__init__(app)
        self.logger = logger

    async def dispatch(self, request: Request, call_next):
        try:
            response = await call_next(request)
        except Exception:
            self.logger.exception(
                "Unhandled exception during %s %s (origin=%s)",
                request.method,
                request.url.path,
                request.headers.get("origin", ""),
            )
            raise
        if response.status_code >= 400:
            self.logger.warning(
                "HTTP %s %s -> %s (origin=%s)",
                request.method,
                request.url.path,
                response.status_code,
                request.headers.get("origin", ""),
            )
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        if settings.security_headers_enabled:
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["X-Frame-Options"] = "DENY"
            response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
            response.headers["Permissions-Policy"] = settings.permissions_policy
            response.headers["Content-Security-Policy"] = settings.content_security_policy
            if request.url.scheme == "https":
                response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get(settings.request_id_header, "") or str(uuid.uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers[settings.request_id_header] = request_id
        return response


class HttpsEnforcementMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not settings.enforce_https:
            return await call_next(request)
        host = (request.headers.get("host") or "").split(":")[0].lower()
        scheme = request.headers.get("x-forwarded-proto", request.url.scheme).lower()
        if scheme != "https" and host not in {"127.0.0.1", "localhost"}:
            return JSONResponse(status_code=426, content={"detail": "HTTPS required"})
        return await call_next(request)


class RequestMetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        started = time.perf_counter()
        try:
            response = await call_next(request)
            status_code = response.status_code
        except Exception:
            status_code = 500
            latency_ms = (time.perf_counter() - started) * 1000.0
            uptime_metrics.record(latency_ms=latency_ms, status_code=status_code)
            raise
        latency_ms = (time.perf_counter() - started) * 1000.0
        uptime_metrics.record(latency_ms=latency_ms, status_code=status_code)
        return response


def create_app() -> FastAPI:
    error_logger = _configure_error_logger()

    def _on_startup() -> None:
        global startup_database_error
        if not settings.disable_auth:
            secret = (settings.jwt_secret or "").strip()
            forbidden = {"", "change-me", "MUST-BE-SET-VIA-ENV"}
            if not secret or secret in forbidden or len(secret) < 32:
                raise RuntimeError(
                    "JWT_SECRET must be set to a strong random value (≥32 chars) when auth is enabled."
                )
        if settings.auto_create_tables:
            try:
                ensure_schema(engine)
                startup_database_error = None
            except (OSError, SQLAlchemyError) as exc:
                startup_database_error = exc.__class__.__name__
                error_logger.exception("Database schema setup failed during startup; API will run in degraded mode.")
        if settings.seed_admin_email and settings.seed_admin_password:
            if startup_database_error is not None:
                error_logger.warning("Skipping seed admin setup because the database is unavailable.")
                return
            db = SessionLocal()
            try:
                email = settings.seed_admin_email.strip().lower()
                admin = db.query(User).filter(User.email == email).first()
                if admin is None:
                    admin = User(
                        tenant_id=settings.default_tenant_id,
                        email=email,
                        full_name=settings.seed_admin_full_name or "Seed Admin",
                        role="admin",
                        password_hash=get_password_hash(settings.seed_admin_password),
                        is_active=True,
                    )
                    db.add(admin)
                    db.commit()
                elif admin.role != "admin" or not admin.is_active:
                    admin.role = "admin"
                    admin.is_active = True
                    db.commit()
            finally:
                db.close()

    def _database_health() -> dict[str, str]:
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except (OSError, SQLAlchemyError) as exc:
            return {
                "status": "unavailable",
                "startup_error": startup_database_error or exc.__class__.__name__,
            }
        return {"status": "ok"}

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        _on_startup()
        yield

    app = FastAPI(
        title="WesternPumps API",
        middleware=[Middleware(RequestErrorLoggingMiddleware, logger=error_logger)],
        lifespan=lifespan,
    )

    # CORS configuration
    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]

    # If you need broader origins in production, set them explicitly via CORS_ORIGINS.
    # Avoid shipping wildcard lists like `https://*.vercel.app` in allow_origins (they are not supported).
    allow_origins = ["*"] if settings.disable_auth or "*" in origins else origins
    # This API uses bearer tokens (Authorization header), not cookies.
    # Keeping credentials disabled avoids invalid configurations like "*" + credentials.
    allow_credentials = False

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$" if settings.disable_auth else None,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Length", "Content-Type"],
    )
    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(HttpsEnforcementMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestMetricsMiddleware)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        error_logger.warning(
            "Validation error on %s %s req=%s: %s",
            request.method,
            request.url.path,
            getattr(request.state, "request_id", ""),
            exc.errors(),
        )
        return JSONResponse(
            status_code=422,
            content={"detail": exc.errors(), "request_id": getattr(request.state, "request_id", "")},
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            headers=getattr(exc, "headers", None),
            content={"detail": exc.detail, "request_id": getattr(request.state, "request_id", "")},
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        error_logger.error(
            "Unhandled error on %s %s req=%s (origin=%s): %s\n%s",
            request.method,
            request.url.path,
            getattr(request.state, "request_id", ""),
            request.headers.get("origin", ""),
            str(exc),
            traceback.format_exc(),
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error", "request_id": getattr(request.state, "request_id", "")},
        )

    @app.get("/")
    def root() -> dict[str, str]:
        return {"message": "WesternPumps API", "docs": "/docs", "health": "/health"}

    @app.get("/health")
    def health() -> dict[str, object]:
        return {"status": "ok", "database": _database_health()}

    @app.get("/health/slo")
    def health_slo() -> dict[str, object]:
        return uptime_metrics.snapshot()

    @app.get("/metrics", response_class=PlainTextResponse)
    def metrics(_: User = Depends(require_roles("admin", "manager", "finance"))) -> str:
        snap = uptime_metrics.snapshot()
        lines = [
            "# HELP westernpumps_requests_total Total number of API requests.",
            "# TYPE westernpumps_requests_total counter",
            f"westernpumps_requests_total {int(snap['total_requests'])}",
            "# HELP westernpumps_http_5xx_total Total number of 5xx responses.",
            "# TYPE westernpumps_http_5xx_total counter",
            f"westernpumps_http_5xx_total {int(snap['error_5xx_count'])}",
            "# HELP westernpumps_availability_percent Request availability percentage.",
            "# TYPE westernpumps_availability_percent gauge",
            f"westernpumps_availability_percent {float(snap['availability_percent'])}",
            "# HELP westernpumps_latency_p95_ms P95 latency in milliseconds.",
            "# TYPE westernpumps_latency_p95_ms gauge",
            f"westernpumps_latency_p95_ms {float(snap['p95_latency_ms'])}",
            "# HELP westernpumps_uptime_seconds Process uptime in seconds.",
            "# TYPE westernpumps_uptime_seconds gauge",
            f"westernpumps_uptime_seconds {int(snap['uptime_seconds'])}",
        ]
        return "\n".join(lines) + "\n"

    app.include_router(auth.router)
    app.include_router(users.router)
    app.include_router(categories.router)
    app.include_router(locations.router)
    app.include_router(customers.router)
    app.include_router(jobs.router)
    app.include_router(parts.router)
    app.include_router(parts.api_router)
    app.include_router(suppliers.router)
    app.include_router(stock.router)
    app.include_router(requests.router)
    app.include_router(deliveries.router)
    app.include_router(reports.router)
    app.include_router(reports_v2.router)
    app.include_router(assistant.router)
    app.include_router(admin_settings.router)
    app.include_router(imports.router)
    app.include_router(realtime.router)
    app.include_router(workflow.router)
    app.include_router(integrations.router)
    app.include_router(platform_ops.router)
    app.include_router(operations.router)
    app.include_router(inventory_science.router)
    app.include_router(ai_assistant.router)
    app.include_router(audit.router)

    return app


app = create_app()
