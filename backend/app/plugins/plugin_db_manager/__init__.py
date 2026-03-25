"""Plugin: DB Table Manager — 库表管理（v3.2新增）"""

from fastapi import FastAPI


def register(app: FastAPI, manifest: dict):
    from .routers import router
    app.include_router(router)
    print(f"[PLUGIN] {manifest['display_name']} v{manifest['version']} loaded")
