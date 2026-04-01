# 数据运维工作台 Data Ops Workbench

一个轻量级的数据安全修订平台，让运维和业务人员在不直接接触数据库客户端的前提下，通过「平台模板 + 校验预览 + 安全回写」的标准流程，完成结果数据表的日常维护。

## 特性

- 支持 7 种数据库（MySQL / PostgreSQL / SQL Server / Oracle / 达梦 / 人大金仓 / SQLite）
- 模板导出导入 -> 校验预览 -> 安全回写，全程操作留痕
- 数据格式自适应引擎（日期/金额/百分比/布尔自动转换）
- 本地规则引擎（字段别名智能推荐）
- 中英文双语、四角色权限体系（超级管理员/管理员/操作员/只读）
- 插件化架构，按需启停
- Windows / Linux 一键部署

## 快速开始

### 下载安装包

前往 [Releases](https://github.com/dalimaoya/data-ops-workbench/releases) 下载最新版本。

### 从源码运行

```bash
# 后端
cd backend
pip install -r requirements.txt
python app_entry.py

# 前端
cd frontend
pnpm install
pnpm run dev
```

访问 `http://localhost:9590`，默认账号：admin / dalimaoya

## 技术栈

- 后端：Python 3.11 + FastAPI + SQLAlchemy + SQLite
- 前端：React 19 + TypeScript + Ant Design 6 + Vite
- 图表：Recharts
- 打包：PyInstaller

## 开源协议

[Apache License 2.0](LICENSE)

## Pro 版

[数据运维工作台 Pro](https://github.com/dalimaoya/data-ops-workbench-pro) 提供更多功能：
- AI 智能助手（7 大场景）
- 智能数据导入
- 跨库数据对比
- 审批流
- 微信扫码登录 + 统一认证
