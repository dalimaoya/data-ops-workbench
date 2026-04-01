#!/usr/bin/env python3
"""
数据运维工作台 - Windows 桌面启动器
纯 pywebview 窗口 + pystray 系统托盘（无 tkinter）

v5.1 架构：
  主线程：pywebview 窗口（WebView2）
  后台线程1：server 进程管理 + 健康检查
  后台线程2：pystray 系统托盘

  pywebview 不可用时降级到 webbrowser + 主线程阻塞保持运行
"""

import os
import sys
import subprocess
import threading
import webbrowser
import time
import json
import logging

# ── 日志 ──────────────────────────────────────────────────────────
def _setup_logging():
    if getattr(sys, 'frozen', False):
        base = os.path.dirname(sys.executable)
        release_root = os.path.abspath(os.path.join(base, '..', '..'))
        if not os.path.isdir(os.path.join(release_root, 'server')):
            release_root = base
        log_dir = os.path.join(release_root, 'logs')
    else:
        base = os.path.dirname(os.path.abspath(__file__))
        log_dir = os.path.join(base, 'logs')
    os.makedirs(log_dir, exist_ok=True)
    log_file = os.path.join(log_dir, 'launcher.log')
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        handlers=[
            logging.FileHandler(log_file, encoding='utf-8'),
            logging.StreamHandler(sys.stdout),
        ],
    )
    return logging.getLogger('launcher')

log = _setup_logging()
log.info("launcher starting, frozen=%s", getattr(sys, 'frozen', False))

from urllib.request import urlopen, Request
from datetime import datetime

# ── 版本号读取 ────────────────────────────────────────────────────
def _read_version():
    _fallback = "5.0.0"
    base = os.path.dirname(os.path.abspath(__file__))
    if getattr(sys, "frozen", False):
        base = os.path.dirname(sys.executable)
    for name in ("version.txt",):
        p = os.path.join(base, name)
        if os.path.isfile(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    v = f.read().strip().lstrip("vV")
                    if v:
                        return v
            except Exception:
                pass
    pkg = os.path.join(base, "package.json")
    if os.path.isfile(pkg):
        try:
            with open(pkg, "r", encoding="utf-8") as f:
                return json.load(f).get("version", _fallback)
        except Exception:
            pass
    return _fallback

CURRENT_VERSION = _read_version()
PORT = 9590
URL = f"http://localhost:{PORT}"

# ── pystray 可选 ──────────────────────────────────────────────────
try:
    import pystray
    from PIL import Image, ImageDraw, ImageFont
    HAS_TRAY = True
    log.info("pystray OK")
except ImportError as e:
    HAS_TRAY = False
    log.warning("pystray not available: %s", e)

# ── pywebview 禁用（v5.0 使用浏览器 + 托盘模式，pywebview 留待 v6.0）
HAS_WEBVIEW = False


# ── 定位可执行文件 ────────────────────────────────────────────────
def _find_server_bin():
    if getattr(sys, "frozen", False):
        base = os.path.dirname(sys.executable)
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(base, "server", "app", "app_entry.exe"),
        os.path.join(base, "server", "app", "app_entry"),
        os.path.join(base, "server", "app", "app.exe"),
        os.path.join(base, "server", "app", "app"),
        os.path.join(base, "server", "app.exe"),
        os.path.join(base, "server", "app"),
        os.path.join(base, "server", "dataops-server.exe"),
        os.path.join(base, "server", "dataops-server"),
    ]
    for p in candidates:
        if os.path.isfile(p):
            return p
    return None


# ── 托盘图标生成 ──────────────────────────────────────────────────
def _create_icon_image(size=64, color=(52, 120, 246)):
    if not HAS_TRAY:
        return None
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([2, 2, size - 2, size - 2], fill=color,
                 outline=tuple(max(0, c - 30) for c in color), width=2)
    try:
        font = ImageFont.truetype("arial.ttf", size // 2)
    except Exception:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), "D", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - tw) / 2 - bbox[0], (size - th) / 2 - bbox[1]),
              "D", fill="white", font=font)
    return img


# ── 等待页面 HTML ─────────────────────────────────────────────────
_LOADING_HTML = """<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body { margin:0; display:flex; justify-content:center; align-items:center;
         height:100vh; background:#f5f7fa; font-family:'Microsoft YaHei',sans-serif; }
  .box { text-align:center; }
  .spinner { width:48px; height:48px; border:4px solid #e0e0e0;
             border-top-color:#3478f6; border-radius:50%;
             animation:spin 1s linear infinite; margin:0 auto 20px; }
  @keyframes spin { to { transform:rotate(360deg); } }
  h2 { color:#333; font-weight:500; margin:0 0 8px; }
  p  { color:#888; font-size:14px; margin:0; }
</style></head><body>
<div class="box">
  <div class="spinner"></div>
  <h2>正在启动服务...</h2>
  <p>数据运维工作台 v""" + CURRENT_VERSION + """</p>
</div>
</body></html>"""


# ══════════════════════════════════════════════════════════════════
class LauncherApp:
    """纯 pywebview + pystray 启动器（无 tkinter）"""

    def __init__(self):
        self.process = None
        self.tray_icon = None
        self.webview_window = None
        self.server_state = "stopped"  # stopped / starting / running
        self.server_bin = _find_server_bin()
        log.info("server_bin=%s", self.server_bin)
        log.info("HAS_WEBVIEW=%s HAS_TRAY=%s", HAS_WEBVIEW, HAS_TRAY)
        self.start_time = None
        self._quitting = False
        self._server_ready = threading.Event()

    # ── 端口占用清理 ─────────────────────────────────────────────
    def _kill_port_occupier(self):
        if sys.platform != "win32":
            return
        try:
            result = subprocess.run(
                ["netstat", "-aon"],
                capture_output=True, text=True, timeout=5,
            )
            for line in result.stdout.splitlines():
                if f":{PORT} " in line and "LISTENING" in line:
                    parts = line.strip().split()
                    pid = parts[-1]
                    if pid.isdigit() and int(pid) > 0:
                        try:
                            subprocess.run(["taskkill", "/F", "/PID", pid],
                                           capture_output=True, timeout=5)
                        except Exception:
                            pass
        except Exception:
            pass

    # ── 服务启动（后台线程调用）──────────────────────────────────
    def _start_server(self):
        if not self.server_bin:
            log.error("server binary not found")
            return
        self.server_state = "starting"

        base_dir = os.path.dirname(self.server_bin)
        release_root = os.path.abspath(os.path.join(base_dir, "..", ".."))
        env = os.environ.copy()
        env["DATA_OPS_BASE_DIR"] = release_root
        env["DATA_OPS_DATA_DIR"] = os.path.join(release_root, "data")
        log.info("release_root=%s", release_root)

        for d in ("data", "backups", "logs"):
            os.makedirs(os.path.join(release_root, d), exist_ok=True)

        creation_flags = 0
        if sys.platform == "win32":
            creation_flags = subprocess.CREATE_NO_WINDOW

        self._kill_port_occupier()

        try:
            log.info("starting server process: %s --port %s", self.server_bin, PORT)
            self.process = subprocess.Popen(
                [self.server_bin, "--port", str(PORT)],
                env=env,
                creationflags=creation_flags,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            log.info("server process started, pid=%s", self.process.pid)
            self.start_time = datetime.now()
        except Exception as e:
            log.error("server start failed: %s", e, exc_info=True)
            self.server_state = "stopped"
            return

        # 健康检查轮询
        self._wait_for_ready()

    def _wait_for_ready(self):
        """轮询 /api/health，通过后设置 _server_ready 事件"""
        log.info("health check loop starting")
        max_wait = 60
        waited = 0
        while waited < max_wait and self.server_state == "starting":
            if self.process and self.process.poll() is not None:
                log.warning("server process exited with code %s", self.process.returncode)
                self.server_state = "stopped"
                return
            try:
                req = Request(f"{URL}/api/health",
                              headers={"User-Agent": "DataOpsLauncher"})
                with urlopen(req, timeout=2) as resp:
                    if resp.status == 200:
                        log.info("health check passed after %ds", waited)
                        self.server_state = "running"
                        self._server_ready.set()
                        self._update_tray_color("running")
                        return
            except Exception:
                pass
            time.sleep(2)
            waited += 2

        log.warning("health check timed out after %ds", waited)
        self.server_state = "stopped"

    # ── 服务停止 ─────────────────────────────────────────────────
    def _stop_service(self):
        if self.process:
            try:
                self.process.terminate()
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
            except Exception:
                pass
            self.process = None
        self.server_state = "stopped"
        self._server_ready.clear()
        self._update_tray_color("stopped")

    # ── 重启服务 ─────────────────────────────────────────────────
    def _restart_service(self):
        def _do():
            self._stop_service()
            time.sleep(1)
            self._start_server()
            # 服务就绪后尝试打开窗口
            if self.server_state == "running":
                self._tray_open_window()
        threading.Thread(target=_do, daemon=True).start()

    # ── 系统托盘 ─────────────────────────────────────────────────
    def _start_tray(self):
        if not HAS_TRAY:
            return
        try:
            icon_image = _create_icon_image(color=(230, 126, 34))  # orange = starting
            menu = pystray.Menu(
                pystray.MenuItem("打开窗口", self._tray_open_window, default=True),
                pystray.MenuItem("在浏览器中打开", lambda: webbrowser.open(URL)),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("重启服务", lambda: self._restart_service()),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("退出", self._quit_app),
            )
            self.tray_icon = pystray.Icon("dataops", icon_image,
                                          "数据运维工作台", menu)
            threading.Thread(target=self.tray_icon.run, daemon=True).start()
            log.info("tray started")
        except Exception as e:
            log.warning("tray start failed: %s", e)

    def _update_tray_color(self, state):
        if not self.tray_icon or not HAS_TRAY:
            return
        color_map = {
            "running": (39, 174, 96),
            "starting": (230, 126, 34),
            "stopped": (231, 76, 60),
        }
        try:
            self.tray_icon.icon = _create_icon_image(
                color=color_map.get(state, (136, 136, 136)))
        except Exception:
            pass

    def _tray_open_window(self, *_args):
        """托盘 "打开窗口" — 优先恢复 pywebview，否则浏览器"""
        if HAS_WEBVIEW and self.webview_window:
            try:
                self.webview_window.show()
                return
            except Exception:
                pass
        webbrowser.open(URL)

    # ── pywebview 窗口关闭行为 ───────────────────────────────────
    def _on_webview_closing(self):
        """关闭按钮 → 隐藏窗口到托盘（不退出）"""
        if self._quitting:
            return True
        if self.webview_window:
            try:
                self.webview_window.hide()
            except Exception:
                pass
        return False

    # ── 退出 ─────────────────────────────────────────────────────
    def _quit_app(self, *_args):
        self._quitting = True
        self._stop_service()

        if self.webview_window:
            try:
                self.webview_window.destroy()
            except Exception:
                pass

        if self.tray_icon:
            try:
                self.tray_icon.stop()
            except Exception:
                pass

        os._exit(0)

    # ── 后台线程：等待服务就绪后切换 webview URL ─────────────────
    def _bg_start_and_navigate(self):
        """后台线程：启动 server，健康检查通过后让 webview 导航到首页"""
        self._start_server()
        if self.server_state == "running" and self.webview_window:
            try:
                self.webview_window.load_url(URL)
            except Exception as e:
                log.warning("load_url failed: %s", e)

    # ── 主入口 ───────────────────────────────────────────────────
    def run(self):
        # 启动系统托盘（后台线程）
        self._start_tray()

        if HAS_WEBVIEW:
            self._run_with_webview()
        else:
            self._run_without_webview()

    def _run_with_webview(self):
        """主线程运行 pywebview，后台线程管理 server"""
        # 先创建窗口，显示等待页
        self.webview_window = webview.create_window(
            f"数据运维工作台 v{CURRENT_VERSION}",
            html=_LOADING_HTML,
            width=1280,
            height=800,
            min_size=(800, 600),
            resizable=True,
            text_select=True,
            confirm_close=True,
        )
        self.webview_window.events.closing += self._on_webview_closing

        # 后台线程：启动 server + 健康检查 + 导航
        threading.Thread(target=self._bg_start_and_navigate, daemon=True).start()

        log.info("starting webview on main thread")
        try:
            webview.start(gui="edgechromium", debug=False)
        except Exception as e:
            log.error("webview.start failed: %s", e, exc_info=True)
            # 降级
            self.webview_window = None
            self._run_without_webview()
            return

        # webview.start() 返回 = 窗口被 destroy
        log.info("webview.start() returned")
        if not self._quitting:
            self._quit_app()

    def _run_without_webview(self):
        """无 pywebview：启动 server，浏览器打开，主线程阻塞"""
        log.info("no webview, fallback to browser mode")

        # 后台启动 server
        threading.Thread(target=self._start_server, daemon=True).start()

        # 等待就绪后打开浏览器
        self._server_ready.wait(timeout=65)
        if self.server_state == "running":
            webbrowser.open(URL)
        else:
            log.error("server failed to start, not opening browser")

        # 主线程保持运行（托盘需要进程存活）
        try:
            while not self._quitting:
                time.sleep(1)
        except KeyboardInterrupt:
            self._quit_app()


if __name__ == "__main__":
    app = LauncherApp()
    app.run()
