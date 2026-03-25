"""Plugin: Scheduler — 定时任务"""

from fastapi import FastAPI


def register(app: FastAPI, manifest: dict):
    from app.routers.scheduler import router
    app.include_router(router)
    print(f"[PLUGIN] {manifest['display_name']} v{manifest['version']} loaded")
