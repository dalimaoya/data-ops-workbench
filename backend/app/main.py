"""FastAPI application entry point."""

import os
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.database import engine, Base, SessionLocal
from app.routers import datasource, table_config, field_config, data_maintenance, backup_version, logs
from app.routers import auth as auth_router
from app.routers import dashboard as dashboard_router
from app.routers import users as users_router
from app.routers import plugins as plugins_router
from app.utils.auth import init_default_admin
from app.utils.security_middleware import SecurityHeadersMiddleware, check_rate_limit
from app.i18n import parse_accept_language, set_lang
from app.plugin_loader import load_plugins, get_loaded_plugins, get_all_plugin_status
from app.startup_state import startup_state
from app.routers import network_status as network_status_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Stage: initializing_db (0-20%) ──
    startup_state.set_stage("initializing_db", 0)

    # Create all tables on startup
    Base.metadata.create_all(bind=engine)
    startup_state.set_stage("initializing_db", 15)

    # Run v3.6 migration (idempotent) — add last_login_at, rename readonly→viewer
    try:
        import sqlite3 as _sqlite3
        _db_path = os.path.join(
            os.environ.get('DATA_OPS_DATA_DIR',
                os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")),
            "platform.db",
        )
        if os.path.exists(_db_path):
            _conn = _sqlite3.connect(_db_path)
            _cur = _conn.cursor()
            _cur.execute("PRAGMA table_info(user_account)")
            _cols = [r[1] for r in _cur.fetchall()]
            if "last_login_at" not in _cols:
                _cur.execute("ALTER TABLE user_account ADD COLUMN last_login_at DATETIME")
            _cur.execute("UPDATE user_account SET role = 'viewer' WHERE role = 'readonly'")
            _cur.execute("UPDATE user_account SET role = 'superadmin' WHERE username = 'admin' AND role = 'admin'")
            _conn.commit()
            _conn.close()
    except Exception as _e:
        import logging
        logging.getLogger("startup").warning("v3.6 migration: %s", _e)
    startup_state.set_stage("initializing_db", 20)

    # Init default admin account
    db = SessionLocal()
    try:
        init_default_admin(db)
    finally:
        db.close()

    # ── Stage: loading_plugins (20-50%) ──
    startup_state.set_stage("loading_plugins", 20)

    # Load plugins
    _loaded = load_plugins(app)
    import logging
    logging.getLogger("startup").info("Loaded plugins: %s", _loaded)
    startup_state.set_stage("loading_plugins", 50)

    # ── Stage: starting_server (50-80%) ──
    startup_state.set_stage("starting_server", 50)

    # Initialize scheduler (if scheduler plugin is loaded or built-in)
    try:
        from app.scheduler.engine import init_scheduler
        init_scheduler()
    except Exception as e:
        logging.getLogger("scheduler").error("Failed to start scheduler: %s", e)

    startup_state.set_stage("starting_server", 80)
    
    # Register SPA catch-all AFTER all plugin routes to avoid intercepting plugin GET endpoints
    if os.path.isdir(STATIC_DIR):
        @app.get("/{full_path:path}")
        async def spa_fallback(request: Request, full_path: str):
            if full_path.startswith("api/"):
                return {"detail": "Not Found"}
            file_path = os.path.join(STATIC_DIR, full_path)
            if full_path and os.path.isfile(file_path):
                return FileResponse(file_path)
            index = os.path.join(STATIC_DIR, "index.html")
            if os.path.isfile(index):
                return FileResponse(index)
            return {"detail": "Frontend not built yet"}

    # ── Stage: ready (100%) ──
    startup_state.set_stage("ready", 100)
    logging.getLogger("startup").info("Server ready")

    yield
    # Shutdown scheduler
    try:
        from app.scheduler.engine import shutdown_scheduler
        shutdown_scheduler()
    except Exception:
        pass


app = FastAPI(
    title="数据运维工作台",
    description="Data Ops Workbench API",
    version="0.1.0",
    lifespan=lifespan,
)

# ─────────────────────────────────────────────
# CORS Configuration (configurable, no more wildcard)
# ─────────────────────────────────────────────
_allowed_origins_env = os.environ.get("ALLOWED_ORIGINS", "")
if _allowed_origins_env:
    _allowed_origins = [o.strip() for o in _allowed_origins_env.split(",") if o.strip()]
else:
    # Default: allow same-origin only (empty list with allow_credentials=False)
    # For dev, set ALLOWED_ORIGINS=http://localhost:5173,http://localhost:9590
    _allowed_origins = []

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=bool(_allowed_origins),
    allow_methods=["*"],
    allow_headers=["*"],
)

# GZip compression for faster page loads (2.1MB JS → ~600KB)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Security response headers middleware
app.add_middleware(SecurityHeadersMiddleware)

# Cache static assets (hashed filenames, safe to cache forever)
@app.middleware("http")
async def cache_static_middleware(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response

# i18n middleware: parse Accept-Language header and set current language
@app.middleware("http")
async def i18n_middleware(request: Request, call_next):
    lang = parse_accept_language(request.headers.get("accept-language"))
    set_lang(lang)
    response = await call_next(request)
    return response


# General API rate limiting middleware
@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """Apply general rate limiting to API endpoints."""
    path = request.url.path
    
    # Only rate-limit API endpoints (not static files)
    if path.startswith("/api/"):
        client_ip = request.client.host if request.client else "unknown"
        
        # Determine rate limit category
        if path in ("/api/auth/login",):
            category = "login"
            identifier = client_ip
        elif path in ("/api/auth/captcha",):
            category = "captcha"
            identifier = client_ip
        elif "export" in path:
            category = "export"
            identifier = client_ip  # Will use user-level once auth is parsed
        elif "writeback" in path or "inline-update" in path or "inline-insert" in path:
            category = "writeback"
            identifier = client_ip
        else:
            category = "general"
            identifier = client_ip
        
        if not check_rate_limit(category, identifier):
            return JSONResponse(
                status_code=429,
                content={"detail": "请求过于频繁，请稍后再试"},
            )
    
    response = await call_next(request)
    return response


# Register CORE API routers (always available)
app.include_router(auth_router.router)
app.include_router(dashboard_router.router)
app.include_router(datasource.router)
app.include_router(table_config.router)
app.include_router(field_config.router)
app.include_router(data_maintenance.router)
app.include_router(backup_version.router)
app.include_router(logs.router)
app.include_router(users_router.router)
app.include_router(plugins_router.router)
app.include_router(network_status_router.router)

# Plugin routers are registered via plugin_loader during lifespan startup


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/startup-progress")
def get_startup_progress():
    """Return current startup stage and progress percentage.
    This endpoint is registered outside lifespan so it responds during boot."""
    return startup_state.to_dict()


@app.get("/api/plugins/loaded")
def list_loaded_plugins(request: Request):
    """Return all known plugins with loaded/unloaded status for frontend menu rendering.
    Authorization is per-user: superadmin sees all, others see based on permissions + trial."""
    from app.models import TrialActivation, UserPluginPermission, UserAccount, _now_bjt
    from app.utils.auth import get_current_user_optional
    plugins = get_all_plugin_status()

    db = SessionLocal()
    try:
        now = _now_bjt()
        # Check trial activation
        has_active_trial = False
        try:
            trial = db.query(TrialActivation).filter(
                TrialActivation.expires_at > now.replace(tzinfo=None)
            ).first()
            has_active_trial = trial is not None
        except Exception:
            pass

        # Try to identify the current user (optional — unauthenticated gets trial-only logic)
        current_user = get_current_user_optional(request, db)
        is_superadmin = current_user and current_user.role == "superadmin"

        # Get user's plugin permissions if not superadmin
        user_plugin_names: set = set()
        if current_user and not is_superadmin:
            perms = db.query(UserPluginPermission.plugin_name).filter(
                UserPluginPermission.user_id == current_user.id
            ).all()
            user_plugin_names = {r[0] for r in perms}

        for p in plugins:
            if p.get("layer") == "builtin":
                p["authorized"] = True
            elif is_superadmin:
                p["authorized"] = True
            elif has_active_trial:
                p["authorized"] = True
            elif current_user and p.get("name") in user_plugin_names:
                p["authorized"] = True
            else:
                p["authorized"] = False
    finally:
        db.close()

    return {"plugins": plugins}


# Mount frontend static files (production)
# When frozen by PyInstaller, look for web/ in the bundle's _MEIPASS directory
if getattr(sys, 'frozen', False):
    # In packaged mode, web/ is at the release root (set by app_entry.py)
    _base = os.environ.get('DATA_OPS_BASE_DIR', os.path.dirname(sys.executable))
    STATIC_DIR = os.path.join(_base, "web")
else:
    STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")
if os.path.isdir(STATIC_DIR):
    ASSETS_DIR = os.path.join(STATIC_DIR, "assets")
    if os.path.isdir(ASSETS_DIR):
        app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

    # SPA catch-all is registered in lifespan startup AFTER plugin routes
    # to avoid intercepting plugin GET endpoints
    pass
