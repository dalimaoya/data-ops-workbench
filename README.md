# 数据运维工作台 Data Ops Workbench

<p align="center">
  <strong>开源数据运维管理平台 · 插件化架构 · 开箱即用</strong>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#插件列表">插件列表</a> •
  <a href="#技术栈">技术栈</a> •
  <a href="#文档">文档</a> •
  <a href="#贡献">贡献</a> •
  <a href="#许可证">许可证</a>
</p>

---

## 简介

**数据运维工作台**是一个面向数据库运维场景的一站式管理平台，采用插件化架构设计，支持多数据源纳管、数据维护、健康巡检、定时任务、审计导出、备份迁移等核心能力。

平台开箱即用，内置 10 个基础插件，覆盖日常数据运维的核心需求。通过插件机制，可以灵活扩展更多业务能力。

## 功能特性

- 🔌 **插件化架构** — 插件自动发现与加载，放入 `plugins/` 目录即可生效
- 🗄️ **多数据源管理** — 支持 MySQL、PostgreSQL、Oracle、SQL Server、SQLite 等主流数据库
- 📊 **仪表盘** — 数据源状态总览、操作趋势、告警信息
- 📋 **纳管表配置** — 灵活的表与字段管理，支持结构同步与变化检测
- 📝 **操作日志** — 完整的操作审计追踪，支持导出
- 👥 **用户管理** — 多角色权限体系（管理员 / 操作员 / 只读）
- 🔔 **通知中心** — 站内消息推送与未读管理
- 🌐 **国际化** — 中英文双语支持
- 🐳 **容器化部署** — Docker 一键启动

## 快速开始

### 方式一：Docker 部署（推荐）

```bash
git clone https://github.com/dalimaoya/data-ops-workbench.git
cd data-ops-workbench
docker-compose up -d
```

访问 http://localhost:8580，默认账号：`admin` / `dalimaoya`

### 方式二：源码启动

```bash
git clone https://github.com/dalimaoya/data-ops-workbench.git
cd data-ops-workbench

# 一键启动（自动安装依赖、构建前端、初始化数据库）
chmod +x start.sh
./start.sh
```

### 方式三：编译包部署

从 [Releases](https://github.com/dalimaoya/data-ops-workbench/releases) 下载编译好的独立包，解压后直接运行：

```bash
tar xzf data-ops-workbench-v*.tar.gz
cd data-ops-workbench
./start.sh
```

## 插件列表

开源版内置 **10 个基础运维插件**：

| # | 插件 | 说明 |
|---|------|------|
| 1 | **plugin_backup** | 平台备份与迁移，支持导出/导入/恢复 |
| 2 | **plugin_health_check** | 数据源健康巡检，表存在性与结构变化检测 |
| 3 | **plugin_audit_export** | 审计报告导出，含操作统计、回写明细、登录记录 |
| 4 | **plugin_db_manager** | 库表管理，可视化建表、编辑结构、SQL 生成 |
| 5 | **plugin_sql_console** | 轻量 SQL 控制台，只读查询，结果可导出 |
| 6 | **plugin_scheduler** | 定时任务引擎，支持定时巡检/备份/导出 |
| 7 | **plugin_notification** | 站内通知推送与未读管理 |
| 8 | **plugin_batch_ops** | 批量操作，数据库维护与多表变更对比 |
| 9 | **plugin_report** | 数据对比报告生成（Excel/PDF） |
| 10 | **plugin_webhook** | Webhook 集成，支持多事件类型推送 |

### 开发自定义插件

将插件目录放入 `backend/app/plugins/`，框架会自动扫描并加载。每个插件需包含 `__init__.py` 和插件描述文件。详见 [插件架构设计](docs/插件架构设计.md)。

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Python 3.9+ · FastAPI · SQLAlchemy · APScheduler |
| 前端 | React 18 · TypeScript · Ant Design · Vite |
| 数据库 | SQLite（默认） · 支持 PostgreSQL / MySQL |
| 部署 | Docker · Nuitka 编译 |

## 项目结构

```
data-ops-workbench/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI 入口
│   │   ├── database.py          # 数据库抽象层
│   │   ├── models.py            # 数据模型
│   │   ├── plugin_loader.py     # 插件加载框架
│   │   ├── routers/             # API 路由
│   │   ├── utils/               # 工具模块
│   │   ├── plugins/             # 插件目录
│   │   ├── schemas/             # Pydantic Schemas
│   │   ├── i18n/                # 国际化
│   │   └── scheduler/           # 调度引擎
│   └── requirements.txt
├── frontend/                    # React 前端
├── database/                    # 数据库脚本
├── docs/                        # 文档
├── docker-compose.yml
├── Dockerfile
├── start.sh / start.bat         # 启动脚本
└── build.sh                     # 构建脚本
```

## 文档

- [使用手册](docs/使用手册.md)
- [技术选型说明](docs/技术选型说明.md)
- [插件架构设计](docs/插件架构设计.md)
- [系统说明](docs/系统说明.md)
- [更新日志](docs/CHANGELOG.md)

## 贡献

欢迎提交 Issue 和 Pull Request！请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解贡献流程。

## 许可证

本项目采用 [AGPL-3.0](LICENSE) 许可证。
