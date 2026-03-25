"""Plugin: Notification Center — 通知中心"""

from fastapi import FastAPI


def register(app: FastAPI, manifest: dict):
    from app.routers.notifications import router
    app.include_router(router)
    print(f"[PLUGIN] {manifest['display_name']} v{manifest['version']} loaded")
