"""
Startup progress state — tracks server boot stages for the loading page.

Stages:
  initializing_db  (0–20%)
  loading_plugins  (20–50%)
  starting_server  (50–80%)
  ready            (100%)
"""

from dataclasses import dataclass, field
from typing import Optional
import time

STAGES = {
    "initializing_db": (0, 20),
    "loading_plugins": (20, 50),
    "starting_server": (50, 80),
    "ready": (100, 100),
}

STAGE_LABELS = {
    "initializing_db": "正在初始化数据库...",
    "loading_plugins": "正在加载插件...",
    "starting_server": "正在启动服务...",
    "ready": "启动完成",
}


@dataclass
class _StartupState:
    stage: str = "initializing_db"
    percent: int = 0
    started_at: float = field(default_factory=time.time)

    def set_stage(self, stage: str, percent: Optional[int] = None):
        self.stage = stage
        if percent is not None:
            self.percent = percent
        else:
            self.percent = STAGES.get(stage, (0, 0))[0]

    def to_dict(self):
        return {
            "stage": self.stage,
            "stage_label": STAGE_LABELS.get(self.stage, self.stage),
            "percent": self.percent,
            "ready": self.stage == "ready",
        }


# Singleton
startup_state = _StartupState()
