"""Plugin: Backup & Migration — 备份迁移"""

from fastapi import FastAPI


def register(app: FastAPI, manifest: dict):
    from app.routers.platform_backup import router
    app.include_router(router)
    print(f"[PLUGIN] {manifest['display_name']} v{manifest['version']} loaded")
