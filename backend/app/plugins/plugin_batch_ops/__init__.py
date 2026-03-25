"""Plugin: Batch Operations — 批量操作"""

from fastapi import FastAPI


def register(app: FastAPI, manifest: dict):
    from app.routers.batch_manage import router
    app.include_router(router)
    print(f"[PLUGIN] {manifest['display_name']} v{manifest['version']} loaded")
