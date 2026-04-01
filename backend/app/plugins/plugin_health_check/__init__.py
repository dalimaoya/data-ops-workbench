"""Plugin: Health Check — 健康巡检"""

from fastapi import FastAPI


def register(app: FastAPI, manifest: dict):
    from app.routers.health_check import router
    app.include_router(router)
    print(f"[PLUGIN] {manifest['display_name']} v{manifest['version']} loaded")
