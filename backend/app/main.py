"""FastAPI application entry point."""

import os
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base, SessionLocal
from app.routers import datasource, table_config, field_config, data_maintenance, backup_version, logs
from app.routers import auth as auth_router
from app.routers import dashboard as dashboard_router
from app.routers import users as users_router
from app.utils.auth import init_default_admin
from app.utils.security_middleware import SecurityHeadersMiddleware, check_rate_limit
from app.i18n import parse_accept_language, set_lang
from app.plugin_loader import load_plugins, get_loaded_plugins, get_all_plugin_status


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create all tables on startup
    Base.metadata.create_all(bind=engine)
    # Init default admin account
    db = SessionLocal()
    try:
        init_default_admin(db)
    finally:
        db.close()
    # Load plugins
    _loaded = load_plugins(app)
    import logging
    logging.getLogger("startup").info("Loaded plugins: %s", _loaded)
    # Initialize scheduler (if scheduler plugin is loaded or built-in)
    try:
        from app.scheduler.engine import init_scheduler
        init_scheduler()
    except Exception as e:
        logging.getLogger("scheduler").error("Failed to start scheduler: %s", e)
    
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
    # For dev, set ALLOWED_ORIGINS=http://localhost:5173,http://localhost:8580
    _allowed_origins = []

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=bool(_allowed_origins),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security response headers middleware
app.add_middleware(SecurityHeadersMiddleware)

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

# Plugin routers are registered via plugin_loader during lifespan startup


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/plugins/loaded")
def list_loaded_plugins():
    """Return all known plugins with loaded/unloaded status for frontend menu rendering."""
    return {"plugins": get_all_plugin_status()}


# Mount frontend static files (production)
# When frozen by PyInstaller, look for web/ in the bundle's _MEIPASS directory
if getattr(sys, 'frozen', False):
    _bundle_dir = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
    STATIC_DIR = os.path.join(_bundle_dir, "web")
else:
    STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")
if os.path.isdir(STATIC_DIR):
    ASSETS_DIR = os.path.join(STATIC_DIR, "assets")
    if os.path.isdir(ASSETS_DIR):
        app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

    # SPA catch-all is registered in lifespan startup AFTER plugin routes
    # to avoid intercepting plugin GET endpoints
    pass
