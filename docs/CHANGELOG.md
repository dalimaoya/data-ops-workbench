# CHANGELOG

---

## v3.3.0 — 2026-03-24 全插件版 + AI 增强

### 新增 9 个插件
- 数据脱敏导出（手机号/身份证/姓名脱敏规则）
- 外部通知推送（企业微信/钉钉/邮件 webhook）
- 数据变更趋势（行数变化图/修改频率/热门字段）
- 审计报告导出（PDF 操作审计报告）
- 跨库数据对比（同表跨库差异对比）
- 模板市场（预设指标表模板一键导入）
- AI 数据预填（历史趋势预测下期数据）
- Webhook 集成（关键操作触发外部系统）
- SQL 控制台（只读 SQL 查询，SELECT only）

### AI 增强
- AI 指标设计 + 批量建表（上传报表 → AI 设计指标 → 自动建表）

### 基础设施
- GitHub Actions CI 配置（三平台自动打包）
- 插件架构 v3.2 bug 修复

### 插件总数：19 个

---

## v3.2.0 — 2026-03-24 插件架构 + 库表管理

### 插件架构分拆
- 核心功能与插件完全解耦，10 个插件独立目录
- 每个插件有 manifest.json + __init__.py 注册函数
- 前端菜单通过 /api/plugins/loaded 动态加载
- 未加载插件显示「升级解锁」灰色状态

### 库表管理插件 (plugin-db-manager)
- 查看数据源下所有表结构（字段名、类型、主键、可空）
- 可视化建表（动态字段编辑器）
- 编辑表结构（新增/删除列）
- 删除表（二次确认）
- SQL DDL 自动生成与预览

### Bug 修复
- SPA catch-all 路由移到 lifespan startup 中插件加载之后，修复插件 GET 接口被拦截

---

## v3.1.0 — 2026-03-24 智能导入 + 定时任务 + 对比报告

### 智能数据导入中心
- 支持 Excel/Word/PDF/CSV 文件上传解析
- AI 指标表匹配（标题+列名+语义三层匹配）
- AI 字段映射（精确+同义词+AI 语义）
- 映射模板保存与复用

### 定时任务
- APScheduler 引擎，支持 cron 和 interval
- 三种任务类型：健康巡检、平台备份、数据导出
- 任务管理页面（CRUD + 立即执行 + 执行历史）

### 数据对比报告
- 差异预览页导出 Excel/PDF 对比报告
- Excel 带颜色标记、PDF 支持中文

### Bug 修复
- BUG-001: PDF 报告崩溃
- BUG-002: 定时任务状态误标
- BUG-003: 创建任务 next_run 为 null

---

## v3.0.0 — 2026-03-24 AI 智能化版本

### AI 智能助手
- AI 基础设施：9 个大模型平台预设（DeepSeek/通义/硅基/智谱/百度/Kimi/OpenAI/Claude/零一），OpenAI + Claude 双协议支持
- 智能字段配置：AI 根据字段名和采样数据自动推荐语义名、只读、枚举值
- 导入数据智能校验：异常值/格式/重复/跨字段 4 类智能检测
- 自然语言数据查询：用大白话描述筛选条件
- AI 批量修改：自然语言描述修改规则，自动应用
- 操作日志智能分析：操作摘要 + 异常检测 + 问题溯源
- 回写影响预评估：风险等级评估 + 敏感字段联动

### 数据库维护
- 批量纳管：一次选多张表 + AI 自动配置
- 批量导出：ZIP 或多 Sheet 格式
- 多表变更对比：逐表查看差异 + 逐表确认 + 进度指示

### 数据源健康巡检
- 连接测试 + 表存在性检查 + 结构变化检测
- 源表被删/源库不可达自动标记

### 备份迁移
- 一键备份/导入，敏感信息脱敏
- 导入前自动备份，失败自动回滚

### Bug 修复
- FieldConfigOut Schema 增加 sensitivity_level / sensitivity_note 字段

---

## v2.7.0 — 2026-03-24 安全加固版

### 安全加固（10项）
- SQL 注入防护：标识符白名单 + 参数化查询 + 输入检测
- 密码存储升级：SHA256 → bcrypt，旧密码自动迁移
- JWT 密钥管理：首次启动自动生成随机密钥
- CORS 加固：关闭通配符，支持配置白名单
- 安全响应头：X-Frame-Options/CSP/nosniff 等 6 个头
- API 限流：登录/导出/回写分级限流
- 登录失败锁定：5 次错误锁定 15 分钟
- 文件上传安全：类型白名单 + 大小限制
- XSS 防护：后端输出 HTML 转义
- 密码强度要求：8位+大小写+数字

### 文档更新
- 系统内嵌完整使用手册（14章节）和系统说明（10章节）
- README 全面重写
- 关于页面 Tabs 布局重构

### Bug 修复
- 修复 SQLite 数据源版本回退失败（BUG-001）

---

## v2.6.1 — 2026-03-23 文档增强 + Bug 修复

### 文档更新
- 系统内嵌完整使用手册（14章节）和系统说明（10章节）
- README 全面重写，覆盖功能概览、快速启动、架构说明
- 关于页面重构为 Tabs 布局（版本信息/使用手册/系统说明）

### Bug 修复
- 修复 SQLite 数据源版本回退失败问题（BUG-001）

---

## v2.6.0 — 2026-03-23 国际化 + 后端 i18n

### 新增
- 后端 i18n 多语言支持
- 数据库适配修复
- 全链路测试通过

---

## v2.5.0 — 2026-03-23 仪表盘增强 + Windows 打包

### 操作仪表盘增强

#### 趋势图
- 首页统计卡片下方新增"最近 7 天操作趋势"折线图
- 展示每天的导出、导入、回写次数，纯 Canvas 绘制无额外依赖
- 后端新增 `GET /api/dashboard/trends` — 按天聚合最近 7 天操作数

#### 数据源健康状态
- 快捷入口旁新增"数据源状态"卡片
- 每个数据源显示最近连接测试状态：正常（绿）/ 异常（红）/ 未测试（灰）
- 后端新增 `GET /api/dashboard/datasource-health` — 返回各数据源最近测试结果

#### 操作排行
- 新增"操作排行 Top 5"卡片（近 7 天操作最频繁的表）
- 金银铜排名样式，显示操作次数
- 后端新增 `GET /api/dashboard/top-tables` — 按操作次数排序

### Windows 独立打包

#### build.bat 完善
- 从占位脚本完善为完整构建流程（与 build.sh 功能对等）
- 5 步流程：检查 Python → 创建 venv 安装依赖 → 构建前端 → PyInstaller 打包 → 组装发布目录
- 每步增加错误检查和清晰的状态输出
- 支持 pnpm / npm 自动检测

#### app.spec 跨平台兼容
- 确认所有路径操作使用 `os.path.join`，Windows/Linux 通用
- pathex 使用 SPECPATH 确保一致性

#### README 补充
- README 新增"独立打包"章节
- 包含 Linux 和 Windows 打包完整说明
- 前置条件、步骤、产物结构、使用方法

---

## v2.1.1 — 2026-03-23 体验优化

### 首页布局重排
- 快捷入口模块移到统计卡片下方（第二行）
- 待处理提醒紧跟快捷入口（第三行），有提醒时才显示
- 最近操作模块放到最下方，占满整行宽度，不再左右分栏
- 最近操作展示数从 10 条增加到 20 条

### 最近操作详细化
- 后端 `/api/dashboard/recent-operations` 新增 `table_alias`、`readable_desc` 字段
- 回写操作 → "回写【表别名】表，更新 X 行，新增 Y 行"
- 导出操作 → "导出【表别名】模板，共 X 行"
- 导入操作 → "导入【表别名】模板，校验通过 X 行，失败 Y 行"
- 删除操作 → "删除【表别名】X 行数据"
- 在线编辑/在线新增也有可读描述
- 其他操作保持原始 message

### 待处理提醒完善
- 表结构变化提醒：清晰提示"请前往纳管表配置检查并更新字段"，点击"去处理"跳转纳管表详情页
- 导入校验失败提醒：新增失败行数信息，过滤已处理（confirmed）的导入任务，点击"去处理"跳转数据维护页
- 每条提醒增加"去处理"按钮和时间显示

### 数据维护页面增加搜索
- 新增数据源下拉筛选（按数据源过滤表）
- 保留表名/别名搜索框
- 新增"重置"按钮清空筛选条件
- 后端 `/api/data-maintenance/tables` 新增 `datasource_id` 查询参数

### 关于系统页面增强
- 版本号更新为 v2.1.0
- 新增"使用手册"折叠面板：管理员配置流程、用户操作流程、在线编辑、版本回退、常见问题
- 新增"系统说明"折叠面板：产品定位、痛点分析、目标用户、设计思路

---

## v2.1.0 — 2026-03-23 更多数据库 + 在线编辑

### 新增数据库支持
- Oracle — oracledb 纯 Python 驱动（thin 模式，无需 Oracle Client）
- 达梦 (DM) — pyodbc + DM8 ODBC DRIVER
- 人大金仓 (KingbaseES) — psycopg2 驱动（兼容 PostgreSQL 协议）
- 前端数据源表单新增三种选项，默认端口自动填充（1521/5236/54321）
- 全链路支持：连接测试、查表、查列、采样、回写、备份、回退

### 在线编辑模式
- 数据浏览页新增"编辑模式"按钮（admin/operator 可见）
- 可编辑字段变为 Input，主键和系统字段锁定不可编辑
- 修改的单元格黄色高亮标记，保存前差异预览确认
- 写前自动备份 + writeback_log + field_change_log

### 单行新增
- 数据浏览页新增"新增行"按钮，绿色卡片表单
- INSERT 到数据库 + 日志记录

### 技术重构
- 统一备份操作 _create_backup_table 支持全部 6 种数据库
- 统一占位符转换 _exec 适配各数据库方言

---

## v2.0.1 — 2026-03-23 体验优化

### 品牌与 UI
- 产品 logo 添加到侧边栏、登录页、浏览器 favicon
- 侧边栏文字加大占满导航栏宽度
- 登录页添加 GitHub/Gitee 图标链接和版权信息
- 浏览器标签页标题改为「数据运维工作台」
- 「关于」改为「关于系统」

### 功能优化
- 新增纳管表选表页面增加搜索框
- 系统字段默认不导出到模板
- 默认管理员密码改为 dalimaoya

### 修复
- start.bat 彻底清除非 ASCII 字符
- 启动脚本自动清理 pyc 缓存
- API 层面 readonly 用户权限加固

---

## v2.0.0 — 2026-03-23 功能扩展

### 新增行支持
- 模板中批量新增数据行，导入后回写执行 INSERT
- 差异预览区分更新行（蓝色）和新增行（绿色）

### 删除行支持
- 数据浏览页勾选删除，删除前自动备份

### 逐字段变更明细日志
- 新增 field_change_log 表，记录每个字段 old → new
- 回写日志增加变更明细弹窗

### 后端时间统一北京时间
- datetime.utcnow 全部替换为 _now_bjt()

---

## v1.4.0 — 2026-03-23 独立打包部署

### PyInstaller 打包
- 打包为独立可执行文件（Linux 79MB）
- 启动脚本双模式（打包模式/开发模式自动切换）
- 一键构建脚本 build.sh / build.bat

---

## v1.3.0 — 2026-03-23 权限与账户管理

### 用户管理页面（管理员专属）
- 新增"用户管理"页面，仅管理员可见和操作
- 用户列表展示：用户名、显示名、角色、状态、创建时间
- 新增用户：用户名、显示名、密码、角色（管理员/操作员/只读用户）
- 编辑用户：修改显示名、角色
- 禁用/启用用户：管理员可禁用账号，被禁用的用户无法登录（默认 admin 不可禁用）
- 重置密码：管理员可重置其他用户的密码
- API: GET/POST /api/users, PUT /api/users/{id}, PUT /api/users/{id}/status, PUT /api/users/{id}/reset-password

### 个人设置
- 所有用户可修改自己的密码（需验证旧密码）和显示名
- 页面右上角用户名下拉菜单新增"修改密码"、"修改显示名"选项
- API: PUT /api/me/password, PUT /api/me/profile

### 前端权限隔离
- 管理员：看到所有菜单（数据源管理、用户管理、版本回退等）
- 操作员：看不到数据源管理、用户管理、版本回退菜单
- 只读用户：同操作员，且数据维护页面不显示上传/回写按钮
- 路由级别角色保护：越权访问自动跳转首页

### 后端权限校验
- 数据源管理相关 API — 仅 admin
- 用户管理相关 API — 仅 admin
- 版本回退相关 API — 仅 admin
- 表配置 CUD — 仅 admin（读取所有角色可用）
- 字段配置 CUD — 仅 admin
- 上传/回写相关 API — admin + operator
- 查看/导出/日志 — 所有角色
- 越权调用返回 403

### 操作日志记录实际操作人
- 排查所有 `log_operation` 调用，改为传入当前登录用户
- 修复 `created_by` / `updated_by` 字段统一记录实际操作人
- 不再使用硬编码 "admin"

---

## v2.0.0 — 2026-03-23 功能扩展

### 新增行支持（刚需）
- 模板底部空白行区域可填写新数据（含主键）
- 导入时自动识别新增行（主键不在数据库中）
- 差异预览区分"更新行"和"新增行"，新增行绿色高亮
- 回写执行 INSERT，结果页显示更新数+新增数

### 删除行支持
- 数据浏览页增加行勾选框 + "删除选中行"按钮
- 删除前弹窗确认，显示待删除行数
- 删除前自动全表备份
- 仅 admin 和 operator 可操作，受 allow_delete_rows 配置控制

### 逐字段变更明细日志
- 新增 field_change_log 表，记录每次回写中每个字段的 old_value → new_value
- 回写日志列表增加更新/新增/删除数量列
- 回写日志详情增加"变更明细"弹窗，支持按字段名筛选
- 覆盖 UPDATE/INSERT/DELETE 三种变更类型

### 后端时间统一为北京时间
- 所有 datetime.utcnow 替换为 _now_bjt()（UTC+8 北京时间）
- 解决前端显示时间可能差 8 小时的问题

---

## v1.4.0 — 2026-03-23 独立打包部署

### PyInstaller 打包
- 新增 `backend/app.spec` — PyInstaller onedir 打包配置
- 新增 `backend/app_entry.py` — 打包入口，处理 frozen 环境路径
- 打包产物：`server/app/app`（Linux ELF 可执行文件，约 79MB）
- 包含前端静态资源、所有后端依赖、数据库驱动

### 一键构建脚本
- 新增 `build.sh` — Linux 一键构建发布包
- 新增 `build.bat` — Windows 构建占位

### 启动脚本双模式
- `start.sh` / `start.bat` 改造：检测到打包产物 → 独立模式；未检测到 → 开发模式
- 两种模式兼容，无需用户手动切换

### 注意
- pyodbc 因系统库依赖已从打包排除（SQL Server 用户需自行安装 ODBC 驱动）
- Windows 打包需在 Windows 环境下执行 build.bat

---

## v1.3.0 — 2026-03-23 权限与账户管理

### 用户管理（管理员专属）
- 新增用户管理页面：用户列表、新增用户、编辑用户、禁用/启用、重置密码
- 后端 7 个 API 端点（GET/POST/PUT /api/users 系列）

### 个人设置
- 修改密码：验证旧密码 + 设置新密码（右上角下拉菜单入口）
- 修改显示名：用户自行修改
- 后端 API：PUT /api/me/password、PUT /api/me/profile

### 前端权限隔离
- 管理员：看到所有菜单
- 操作员：隐藏数据源管理、用户管理、版本回退
- 只读用户：同操作员，且隐藏上传/回写按钮
- RequireRole 路由保护组件

### 后端权限校验
- 数据源管理/用户管理/版本回退 API — 仅 admin
- 上传/回写 API — admin + operator
- 查看/导出 — 所有角色
- 越权调用返回 403

### 操作日志记录真实操作人
- 所有调用 log_operation 的地方改为传入实际登录用户名
- 不再统一写 "admin"

---

## v1.2.0 — 2026-03-23 模板安全加固

### 模板 Excel 保护机制
- 表头行（第一行）锁定，不可修改不可删除
- 主键列已有数据单元格锁定只读
- 可编辑字段的数据区域正常可编辑
- 工作表保护启用：禁止删除行/列、禁止插入列
- 模板底部预留 50 行空白行（为将来新增行功能做准备）
- meta sheet 新增 field_aliases 供导入校验

### 导入校验增强
- 列数校验：上传文件列数与模板定义不一致时 400 阻断
- 列名校验：逐列比对列头名称，不匹配报错并指出具体哪列
- 主键不可变校验：上传数据的主键在数据库中不存在时标记错误

---

## v1.1.0 — 2026-03-23 体验修正与基础完善

### 时间显示全局修正
- 新建 `formatBeijingTime` 工具函数（dayjs + Asia/Shanghai 时区）
- 覆盖范围：数据维护更新时间、版本回退备份时间（列表+详情+回退确认）、日志中心四个 Tab 所有时间字段
- 统一输出格式：`YYYY-MM-DD HH:mm:ss`

### 结构状态中文化
- `normal` → 正常、`changed` → 已变化、`error` → 检查失败
- 修正位置：DataBrowse、MaintenanceList（全部覆盖）
- TableConfigList、TableConfigDetail 已确认正确

### 新增关于页面
- 新增 `/about` 路由 + 侧边栏「关于」入口
- 展示：系统名称、版本号 v1.0.0、功能简介、GitHub/Gitee 链接、技术栈

### 其他
- README 增加 GitHub/Gitee 仓库链接和徽章
- Windows start.bat 修复：去除 emoji 避免 CMD 编码问题、pip 权限修复、uvicorn 调用方式修复
- Python 3.8 兼容性：所有 `X | None` 语法改为 `Optional[X]`

---

## v1.0.0 — 2026-03-23 MVP 正式版

基于 2026-03-19 ~ 2026-03-20 开发的 P0~P4 全阶段成果，首次正式存档发布。

---

## 2026-03-19 — P4 收尾与验收（维克托）

### P4-1 登录认证-后端
- 新增 `user_account` 表（id/username/password_hash/role/display_name/status/created_at/updated_at）
- 新增 `POST /api/auth/login` — JWT 登录接口
- 新增 `GET /api/auth/me` — 获取当前用户信息
- 三角色权限控制：admin（管理员）、operator（操作员）、readonly（只读用户）
  - 管理员：所有操作
  - 操作员：查看数据、下载模板、上传模板、预览差异、提交写入
  - 只读用户：查看数据、下载模板，不允许上传写入
- 预置管理员账号：admin / dalimaoya
- 所有 API 接口加 JWT 校验中间件（HTTPBearer）
- `operator_user` 字段从 JWT token 中获取真实用户名（替代之前硬编码的 "admin"）
- JWT 有效期 24 小时

### P4-2 登录页-前端
- 登录页：用户名 + 密码 + 登录按钮，渐变背景样式
- 登录成功后跳转首页，失败显示错误信息
- 路由守卫（RequireAuth）：未登录自动跳转登录页
- 请求拦截器：自动携带 JWT token（Authorization: Bearer）
- 响应拦截器：401 自动清除 token 并跳转登录页
- Header 右侧显示用户名 + 角色 + 退出登录按钮
- AuthProvider 上下文管理登录状态

### P4-3 首页/总览-前端
- 工作台总览页，4 个卡片区：
  - 基础统计：数据源数量、已纳管表数量、今日导出/导入/回写次数（5 个统计卡片）
  - 最近操作：最近 10 条操作记录（列表展示，含模块/类型/状态/操作人/时间）
  - 待处理提醒：表结构变化提醒、导入失败提醒
  - 快捷入口：新建数据源、配置表、数据维护、查看日志、版本回退
- 欢迎语显示当前用户名和角色

### P4-4 首页数据-后端
- 新增 `GET /api/dashboard/stats` — 统计数据（数据源数/纳管表数/今日导出导入回写次数）
- 新增 `GET /api/dashboard/recent-operations` — 最近 10 条操作记录
- 新增 `GET /api/dashboard/alerts` — 待处理提醒（结构变化/导入失败）

### P4-5 全链路联调
- ✅ 登录→首页→数据源管理→表配置→数据维护→导出→导入→校验→差异→回写→日志→版本回退 全链路走通
- ✅ JWT 认证贯穿所有接口
- ✅ 前端请求自动携带 token
- ✅ 未登录自动跳转登录页
- ✅ 退出登录清除状态

### P4-8 启动脚本 + 文件夹交付形态
- `start.sh`（Linux/macOS）完善：
  - 自动检测 Python
  - 自动创建 venv
  - 自动安装后端依赖
  - 自动构建前端（如果 web/ 不存在或为空）
  - 自动初始化数据库和默认管理员账号
  - 启动后端服务
  - 输出访问地址 http://localhost:8580
- `start.bat`（Windows）同步更新
- `README.md` 创建完成：功能简介、启动方法、目录结构、技术栈、角色权限、API 文档入口

### 前端构建
- ✅ 前端构建成功，静态资源已更新至 backend/web/

---

## 2026-03-19 — P3 安全与日志（维克托）

### P3-1 版本回退-后端
- 新增 `GET /api/backup-versions` — 备份版本列表（支持按数据源/表名/时间范围/操作人筛选，分页）
- 新增 `GET /api/backup-versions/{id}` — 版本详情（含关联回写信息）
- 新增 `POST /api/backup-versions/{id}/rollback` — 执行回退
  - 回退前自动备份当前数据（trigger_type: triggered_by_rollback）
  - DELETE + INSERT FROM backup_table 方式恢复
  - 记录系统操作日志
  - 支持 MySQL/PostgreSQL/SQL Server

### P3-2 版本回退-前端
- 版本回退页：筛选区（数据源/表名/操作人/时间范围）+ 表格
- 表格字段：版本号/数据源/表名/备份时间/触发类型/关联批次/操作人/记录数/可回退状态
- 版本详情弹窗：完整备份信息 + 关联回写信息展示
- 回退确认弹窗：目标表、版本号、备份时间、风险提示（黄色警告框）
- 回退结果反馈（message 提示）

### P3-3 日志中心-后端
- 新增 `GET /api/logs/system` — 系统操作日志查询（按模块/类型/操作人/时间范围/状态筛选，分页）
- 新增 `GET /api/logs/export` — 模板导出日志查询（按数据源/表名/操作人/时间范围筛选，分页）
- 新增 `GET /api/logs/import` — 模板导入日志查询（按数据源/表名/操作人/校验状态/时间范围筛选，分页）
- 新增 `GET /api/logs/writeback` — 回写日志查询（按数据源/表名/操作人/状态/时间范围筛选，分页）

### P3-4 日志中心-前端
- 日志中心页，4 个页签：系统操作日志 / 模板导出日志 / 模板导入日志 / 回写日志
- 每个页签有独立筛选区 + 分页表格
- 系统日志：时间/模块/操作类型/目标/状态/操作人/详情
- 导出日志：批次号/数据源/表名/导出类型/行数/字段数/文件名/操作人/时间
- 导入日志：批次号/数据源/表名/文件名/总行数/通过/失败/校验状态/导入状态/操作人/时间
- 回写日志：批次号/数据源/表名/操作人/文件名/成功数/失败数/备份版本号/操作时间/状态

### P3-5 系统操作日志埋点-后端
- 新增 `app/utils/audit.py` — 统一审计日志工具函数
- 数据源管理埋点：创建/编辑/删除/测试连接
- 纳管表配置埋点：创建/编辑/删除/结构检测/字段同步
- 数据维护埋点：导出模板/导入模板/执行回写/执行回退

### Swagger 文档
- 新增 7 个 API 端点，tags: 版本回退、日志中心
- 全部接口自动生成 OpenAPI 文档

### 前端构建
- ✅ 前端构建成功，静态资源已更新至 backend/web/

---

## 2026-03-19 — P2 核心操作链路（维克托）

### P1 缺陷修复
- ✅ Bug#1: sync-fields 不再清除用户自定义字段配置，改为合并策略（保留 alias/max_length/enum 等用户自定义项，仅更新 db_data_type/order/pk/sample_value，新增字段自动生成，远程不存在的字段软删除）
- ✅ Bug#2: 创建纳管表时自动拉取 sample_value 填充到 field_config（通过 fetch_sample_data 获取前5行非空值）

### P2-1 数据浏览-后端
- 新增 `GET /api/data-maintenance/tables` — 可维护表列表（分页/搜索）
- 新增 `GET /api/data-maintenance/{table_config_id}/data` — 分页读取业务表数据，支持关键字筛选、按字段筛选
- 所有字段值统一按文本返回

### P2-2 数据浏览-前端
- 数据维护列表页：表别名/数据源/表名/字段数/配置版本/结构状态，点击"进入维护"
- 数据浏览页：顶部表信息栏、筛选区（全局关键字+按字段筛选）、动态表格、分页 20/50/100、横向滚动、主键固定左侧

### P2-3 模板导出-后端
- 新增 `POST /api/data-maintenance/{table_config_id}/export` — 生成含隐藏 _meta sheet 的 Excel 模板
- 模板元信息包含：datasource_id, table_config_id, config_version, export_time, export_batch_no, field_codes, primary_key_fields, structure_hash
- 新增 `GET /api/data-maintenance/{table_config_id}/export-info` — 导出前预估信息
- 记录 template_export_log
- 使用 openpyxl 生成

### P2-4 模板导出-前端
- 导出确认弹窗：导出类型选择（全量/当前筛选）、行数预估、配置版本展示
- 点击确认后自动下载 .xlsx 文件

### P2-5 模板导入-后端
- 新增 `POST /api/data-maintenance/{table_config_id}/import` — 上传平台模板
- 解析 _meta sheet 校验：模板合法性（非平台模板拒绝）、table_config_id 匹配、数据源匹配、版本匹配
- 逐行校验：必填校验、数据类型校验（int/decimal/float）、长度限制、枚举值、主键非空、重复行
- 不存在的主键行报错（首版不支持新增）
- 生成差异数据（原值 vs 新值），存入 diff JSON 文件
- 记录 import_task_log

### P2-6 模板导入-前端
- 模板导入页：拖拽上传 + 文件信息展示（文件名/大小）
- 点击"开始校验"上传文件

### P2-7 导入校验结果-前端
- 校验结果页：汇总卡片（总数/通过/失败/警告/差异项）
- 错误明细表格（行号/字段/类型/当前值/说明）
- 支持"查看差异预览"、"重新上传"操作

### P2-8 差异预览-后端
- 新增 `GET /api/data-maintenance/import-tasks/{task_id}/diff` — 返回原值/新值对比数据
- 新增 `GET /api/data-maintenance/import-tasks/{task_id}` — 导入任务详情

### P2-9 差异预览-前端
- 差异预览页：顶部表信息、汇总卡片（拟更新/差异项/失败数）
- 差异表格：行号/主键值/字段名/原值/新值/差异状态
- 确认写入（二次确认弹窗） / 取消按钮
- 仅当无失败项时允许写入

### P2-10 安全回写-后端
- 新增 `POST /api/data-maintenance/import-tasks/{task_id}/writeback` — 执行回写
- 写前全表备份（CREATE TABLE ... AS SELECT * FROM ...）
- 逐行执行 UPDATE，按主键定位
- 记录 writeback_log 和 table_backup_version
- 自动清理超出 backup_keep_count 的历史备份（DROP + 标记 expired）
- 支持 MySQL/PostgreSQL/SQL Server 三种数据库

### P2-11 写入结果反馈-前端
- 写入结果页：成功/失败状态展示、成功/失败数、备份版本号、备份表名、操作人、完成时间
- 失败明细展示
- 返回数据浏览 / 返回数据维护按钮

### Swagger 文档
- 新增 8 个 API 端点，tags: 数据维护
- 前端构建产物已更新至 backend/web/

### 全链路验证
- ✅ 浏览 → 导出 → 修改 → 导入 → 校验 → 差异预览 → 回写 全链路走通
- ✅ 备份表在业务库中创建成功
- ✅ 数据回写正确（UPDATE 按主键定位）

---

## 2026-03-19 — P0 缺陷修复 + P1 配置链路（维克托）

### P0 缺陷修复
- ✅ 补上"系统设置"占位菜单和路由（PRD 要求 7 个菜单，之前缺少第 7 个）
- 前端 MainLayout 菜单项增加 SettingOutlined 图标 + `/system-settings` 路由
- App.tsx 增加 `/system-settings` 路由映射到占位页

### P1-1 纳管表配置-后端
- 新增 `GET /api/table-config/remote-tables/{ds_id}` — 获取远程数据库库表清单
- 新增 `POST /api/table-config` — 创建纳管表配置（自动拉取字段+计算结构 hash）
- 新增 `GET /api/table-config` — 纳管表列表（分页/筛选，关联数据源名称+字段数）
- 新增 `GET /api/table-config/{id}` — 纳管表详情
- 新增 `PUT /api/table-config/{id}` — 更新纳管表配置（自动升版本号）
- 新增 `DELETE /api/table-config/{id}` — 删除纳管表（逻辑删除，连带字段）
- 新增 `GET /api/table-config/{id}/sample-data` — 样例数据预览

### P1-2 纳管表配置-前端
- 纳管表列表页：筛选（数据源/状态/关键字）、分页、结构检查/配置/字段/删除操作
- 新建纳管表页：两步式——选数据源→选表→配置基本信息→保存并自动拉取字段
- 表配置详情页：基础信息展示、维护规则（Switch 开关）、主键设置、样例数据预览

### P1-3 字段自动拉取-后端
- 新增 `remote_db.py` 工具模块：
  - `list_tables()` — 查询 MySQL/PostgreSQL/SQL Server 的 information_schema
  - `list_columns()` — 获取字段名/类型/是否主键/排序号
  - `fetch_sample_data()` — 读取前 N 条样例数据
  - `compute_structure_hash()` — 基于字段名+类型+主键+排序号生成 SHA256 hash
- 创建纳管表时自动调用 list_columns + fetch_sample_data，生成默认字段配置
- 新增 `POST /api/table-config/{id}/sync-fields` — 重新从远程数据库拉取字段

### P1-4 字段配置-前端
- 字段配置页：完整字段表格，支持逐字段编辑（别名/长度限制/枚举值）
- Switch 开关直接切换：展示/可编辑/必填/导出/导入
- 主键和系统字段 Tag 标识
- 批量操作栏：全部展示/隐藏、全部可编辑/只读、全部参与导出/导入
- Checkbox 多选 + 批量更新

### P1-5 字段配置-后端
- 新增 `GET /api/field-config/{table_config_id}` — 获取表的全部字段配置
- 新增 `GET /api/field-config/detail/{field_id}` — 获取单个字段详情
- 新增 `PUT /api/field-config/{field_id}` — 更新单个字段配置
- 新增 `PUT /api/field-config/batch/update` — 批量更新字段配置
- 新增 `DELETE /api/field-config/{field_id}` — 删除字段

### P1-6 表结构变化检测-后端
- 新增 `POST /api/table-config/{id}/check-structure` — 对比远程当前结构 hash 与已保存 hash
- 返回 normal/changed/error 三种状态
- 结构不一致时返回阻断信号，前端展示警告

### Swagger 文档
- 所有新增接口均带 tags 分组：纳管表配置、字段配置
- 前端构建产物已更新至 backend/web/

---

## 2026-03-19 — P0 完成验证（维克托）

### 验证结果
- ✅ 后端启动：`uvicorn app.main:app --port 8580` 正常运行，Swagger 文档可访问 `/docs`
- ✅ 8 张核心表自动建表：datasource_config, table_config, field_config, template_export_log, import_task_log, writeback_log, table_backup_version, system_operation_log
- ✅ 数据源 CRUD 接口全通：创建/列表/详情/更新/删除（逻辑删除）
- ✅ 测试连接接口正常：MySQL/PostgreSQL/SQL Server 驱动就绪
- ✅ 已有数据源一键测试 + 状态自动更新
- ✅ 密码 Fernet 加密存储正常
- ✅ 前端构建成功，静态资源由 FastAPI 托管，SPA fallback 正常
- ✅ `start.sh` 一键启动流程正常
- ✅ 前端菜单路由：首页/数据源管理/表配置管理/数据维护/日志中心/版本回退
- ✅ 数据源管理前端：列表页（筛选+分页）、新建/编辑页、测试连接交互

---

## 2026-03-19 — P0 项目骨架 + 基础管理（维克托）

### P0-1 前端项目初始化
- Vite + React 18 + TypeScript + Ant Design 5 + React Router v7
- 左侧菜单布局（首页/数据源管理/表配置管理/数据维护/日志中心/版本回退）
- 中文 locale 配置

### P0-2 后端项目初始化
- FastAPI + SQLAlchemy 2.0 + SQLite
- 项目结构：app/main.py, models.py, database.py, routers/, schemas/, utils/
- CORS 中间件、Swagger 文档自动生成
- FastAPI 托管前端静态资源（SPA fallback）

### P0-3 平台数据库建表
- 8 张核心表全部建好：datasource_config, table_config, field_config, template_export_log, import_task_log, writeback_log, table_backup_version, system_operation_log
- 审计字段统一（created_by/created_at/updated_by/updated_at/is_deleted）

### P0-4 启动脚本
- start.sh（Linux/macOS）：自动创建 venv、安装依赖、启动 uvicorn
- start.bat（Windows）：同上 Windows 版本
- 默认端口 8580

### P0-5 数据源管理-后端
- CRUD 接口：列表（分页/筛选）、详情、创建、更新、删除（逻辑删除）
- 测试连接接口：支持 MySQL/PostgreSQL/SQL Server
- 已有数据源一键测试 + 自动更新测试状态
- 密码 Fernet 加密存储
- 数据源编码自动生成（DS_YYYYMMDD_序号）

### P0-6 数据源管理-前端
- 列表页：筛选（名称/类型/状态）、分页、编辑/测试/删除操作
- 新建/编辑页：完整表单、测试连接按钮、数据库类型切换自动填充默认端口

### 技术选型确认
- 7 项决策点全部确认（详见技术选型说明.md）

---

## 2026-03-20
- 项目正式启动，斯维因接收李琪启动指令
- 李琪提供 3 份 v1 草稿文档，文件剪切至共享目录
- 斯维因完成 5 份正式文档收口：
  - `PRD.md` - 产品需求文档
  - `页面原型结构与字段设计.md` - 页面设计
  - `平台数据库表结构设计.md` - 表结构设计
  - `技术选型说明.md` - 技术选型建议
  - `开发任务拆解清单.md` - 开发任务拆解
- 更新 `决策记录.md`、`STATUS.md`、`TASKS.md`
- 当前状态：设计收口完成，待李琪确认
