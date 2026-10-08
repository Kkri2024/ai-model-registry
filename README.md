# ai-model-registry


## 源码与发布维护（2026-10-08）

- 本地目录：`项目源码目录（克隆仓库后使用）`。源码需完整下载，不能只保留云端占位文件。
- GitHub： https://github.com/Kkri2024/ai-model-registry ，生产分支 `main`。
- 正式入口： https://ai-model-registry.pages.dev
- 发布方式：Cloudflare Pages Git 集成。检查失败不发布；推送 `main` 后检查 GitHub 和 Cloudflare 结果。
- 本地安装：`npm ci`；检查：`npm test`；构建：`npm run build`。
- 本地预览：构建后用 HTTP 服务访问产物；不要双击 HTML。原有开发命令继续可用。
- 回滚：对发布提交执行 `git revert` 并推送 `main`；紧急情况下先在 Cloudflare 恢复上一有效部署，随后同步 GitHub，避免下一次推送覆盖回退。
- 密钥与环境文件不提交。部署凭据仅保存在 GitHub Secrets；不要将浏览器 API Key 写入模型目录。

### 统一模型目录

模型名单从 `https://ai-model-registry.pages.dev/models.json` 读取。页面启动或刷新时检查；返回前台超过 5 分钟再次检查。3 秒超时后回退到最近有效缓存，再回退到内置目录。供应商请求地址由本地代码固定；API Key 和业务数据继续留在各网页原有存储中。

日常模型维护只修改 `Kkri2024/ai-model-registry` 中的 `models.json`，核对官方资料、递增 `version`、运行测试和构建后推送 `main`。不要在各业务项目重复改名单。保留仍有效的用户选择；已停用型号只能通过明确迁移映射替换，并提示用户。未知型号保留为待确认选项，不擅自换到收费等级不同的默认型号。

目录接口：`schemaVersion: 1`、`version`、`providers.deepseek` 与 `providers.gemini`。各供应商包含 `defaultModel`、`models: [{id,label,status}]` 和 `migrations: {旧ID: 新ID}`。默认值和迁移目标必须指向 active 模型，已有 active 模型不得被强制迁移。端点必须返回 `Access-Control-Allow-Origin: *` 与 `Cache-Control: no-store`。

`modelRegistry.js` 是客户端加载器参考实现，`modelCatalog.js` 是离线快照。修改模型名单不需要更新客户端副本；修改加载协议或接口调用方式则需分别发布受影响项目。验证与回退以 `models.json` 为唯一在线配置来源。
