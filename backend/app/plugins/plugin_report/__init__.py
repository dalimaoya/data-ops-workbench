"""Plugin: Data Comparison Report — 数据对比报告"""

from fastapi import FastAPI


def register(app: FastAPI, manifest: dict):
    from app.routers.writeback_multi import router
    app.include_router(router)
    print(f"[PLUGIN] {manifest['display_name']} v{manifest['version']} loaded")
