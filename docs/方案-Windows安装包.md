# Windows 安装包方案

> 产出人：Claude Lead
> 日期：2026-03-29
> 状态：待用户确认

---

## 一、目标

用户下载一个 exe 安装包 → 安装到自选目录 → 启动后有窗口承载页面 → 异常时可用浏览器打开。

## 二、整体架构

```
安装包（Inno Setup 打包）
  └── 安装到用户选择的目录
        ├── DataOpsWorkbench.exe     ← 主入口（pywebview 窗口）
        ├── server/app.exe           ← 后端服务（Nuitka 编译）
        ├── web/                     ← 前端静态文件
        ├── data/                    ← SQLite + 配置
        ├── logs/                    ← 运行日志
        ├── tray.exe                 ← 运行状态面板（可选独立进程）
        └── version.txt              ← 当前版本号
```

## 三、组件设计

### 3.1 主入口：DataOpsWorkbench.exe（pywebview）

基于现有 `launcher.py` 改造：

1. **启动后端服务** — 启动 `server/app.exe`，等待端口 9590 就绪
2. **打开 pywebview 窗口** — 加载 `http://localhost:9590`，使用 WebView2 引擎（Win10/11 自带）
3. **窗口配置**：
   - 标题：数据运维工作台
   - 图标：自定义 ico
   - 默认尺寸：1280x800，可调整
   - 最小化到系统托盘（pystray）
4. **异常降级**：
   - pywebview 启动失败 → 自动调用 `webbrowser.open("http://localhost:9590")`
   - 后端启动超时（60s）→ 弹窗提示 + 打开浏览器按钮

### 3.2 运行状态面板

当 pywebview 窗口无法打开或用户从托盘选择"控制面板"时显示：

```
┌─────────────────────────────────┐
│  数据运维工作台 v5.0            │
├─────────────────────────────────┤
│  运行状态：● 运行中             │
│  服务端口：9590                 │
│  启动时间：2026-03-29 15:30     │
│  当前版本：v5.0.0               │
├─────────────────────────────────┤
│  [在浏览器中打开]  [检查更新]   │
│  [重启服务]        [退出程序]   │
└─────────────────────────────────┘
```

实现方式：tkinter 小窗口（复用现有 launcher.py 的 GUI 代码），独立于 pywebview。

### 3.3 系统托盘

使用 pystray 库：
- 右键菜单：打开窗口 / 在浏览器中打开 / 控制面板 / 退出
- 托盘图标状态：运行中（绿色）/ 启动中（黄色）/ 异常（红色）

### 3.4 安装包：Inno Setup

基于现有 `setup.iss` 改造：

1. **安装向导** — 选择安装路径、创建桌面快捷方式、创建开始菜单
2. **注册表写入**：
   - `HKCU\Software\DataOpsWorkbench` — 安装路径、版本号
   - `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\DataOpsWorkbench` — 卸载信息
3. **文件关联** — 可选，暂不做
4. **卸载** — 清理安装文件、注册表、可选保留 data/ 目录

## 四、启动流程

```
用户双击桌面快捷方式
  → DataOpsWorkbench.exe 启动
  → 检查端口 9590 是否被占用
  → 启动 server/app.exe（后台进程）
  → 等待 http://localhost:9590 就绪（轮询，最多60s）
  → 就绪后打开 pywebview 窗口加载页面
  → 同时创建系统托盘图标
  → 用户关闭窗口 → 最小化到托盘（不退出）
  → 用户从托盘选择退出 → 关闭后端服务 → 退出
```

## 五、构建流程

```bash
# 1. 前端构建
cd frontend && pnpm build

# 2. 后端 Nuitka 编译
cd backend && nuitka --standalone --onefile app/main.py -o server/app.exe

# 3. 打包 pywebview 入口
pyinstaller --onefile --windowed --icon=icon.ico launcher.py -n DataOpsWorkbench.exe

# 4. Inno Setup 打包安装包
iscc setup.iss
# 输出：DataOpsWorkbench-v5.0-Setup.exe
```

## 六、依赖

| 组件 | 用途 | 备注 |
|------|------|------|
| pywebview | 桌面窗口 | WebView2 引擎，Win10/11 自带 |
| pystray | 系统托盘 | 纯 Python |
| Pillow | 托盘图标 | pystray 依赖 |
| Nuitka | 后端编译 | 已验证可用 |
| Inno Setup | 安装包 | 已有 setup.iss 基础 |

## 七、分阶段可选

如果一步到位有问题，可以分：
- **Phase 1**：pywebview 窗口 + 浏览器降级（不做安装包，直接文件夹运行）
- **Phase 2**：Inno Setup 安装包 + 注册表 + 卸载
- **Phase 3**：系统托盘 + 运行状态面板

## 八、待确认

1. 端口是否固定 9590？还是需要自动检测空闲端口？
2. 是否需要开机自启选项？
3. 安装包是否需要数字签名？（政企场景可能被拦截）
4. pywebview 窗口关闭行为：最小化到托盘还是直接退出？
5. data/ 目录卸载时是否保留？
