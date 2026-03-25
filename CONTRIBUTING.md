# 贡献指南 Contributing Guide

感谢你对数据运维工作台项目的关注！我们欢迎各种形式的贡献。

## 如何贡献

### 报告 Bug

1. 在 [Issues](https://github.com/dalimaoya/data-ops-workbench/issues) 中搜索是否已有相同问题
2. 如果没有，创建新 Issue，请包含：
   - 问题描述
   - 复现步骤
   - 期望行为
   - 实际行为
   - 环境信息（操作系统、Python 版本、浏览器）

### 提交功能建议

在 Issues 中创建 Feature Request，描述你期望的功能和使用场景。

### 提交代码

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交改动：`git commit -m 'feat: add your feature'`
4. 推送分支：`git push origin feature/your-feature`
5. 创建 Pull Request

### Commit 规范

请使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

- `feat:` 新功能
- `fix:` Bug 修复
- `docs:` 文档更新
- `style:` 代码格式（不影响逻辑）
- `refactor:` 重构
- `test:` 测试
- `chore:` 构建/工具变更

### 开发插件

如果你想为项目贡献新插件：

1. 在 `backend/app/plugins/` 下创建插件目录
2. 参考现有插件的结构（如 `plugin_webhook`）
3. 确保插件包含 `__init__.py` 和完整的描述信息
4. 编写必要的测试
5. 在 PR 中说明插件的功能和使用场景

## 开发环境搭建

```bash
# 克隆仓库
git clone https://github.com/dalimaoya/data-ops-workbench.git
cd data-ops-workbench

# 后端
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 前端
cd ../frontend
pnpm install
pnpm dev
```

## 代码规范

- Python：遵循 PEP 8
- TypeScript/React：遵循项目 ESLint 配置
- 所有 API 端点需要添加类型注解和文档字符串

## 许可证

提交代码即表示你同意将代码以 [AGPL-3.0](LICENSE) 许可证发布。
