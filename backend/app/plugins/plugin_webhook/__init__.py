"""Plugin: Webhook Integration — Webhook 集成"""

from fastapi import FastAPI


def register(app: FastAPI, manifest: dict):
    from .routers import router
    app.include_router(router)
    print(f"[PLUGIN] {manifest['display_name']} v{manifest['version']} loaded")
