# 项目完善清单

> 本文件只保留**真实待办**。已实现功能见 [README.md](./README.md) 与 [FEATURES.md](./FEATURES.md)。

## ✅ 已完成（不再列为待办）

- 速率限制（按用户/IP，`X-RateLimit-*` 响应头，429 处理）
- 使用统计（Token 用量记录与查询，`/api/admin/usage`）
- 请求日志（审计日志，`/api/admin/logs`，KV TTL）
- 渠道熔断器（按模型粒度，三态管理）
- 性能监控（5 分钟窗口）+ 健康监控页面（`/m/health`）
- Anthropic / Gemini 上游适配器
- 上游请求重试（指数退避，`UPSTREAM_RETRIES` 可配置）
- CORS 配置（`ALLOWED_ORIGINS`）
- Admin Token HMAC 校验 + HttpOnly 会话 Cookie
- 调试日志环境变量开关（`AIAPI_DEBUG_LOGS`）
- 单元测试（Vitest，`npm test`）

## 🎯 真实待办

### 中优先级
- 告警通知：熔断打开 / 成功率过低时 Webhook（钉钉、飞书、Slack）通知
- API Key 增强：过期时间、只读 Key、IP 白名单、一键轮换、最后使用时间
- 使用统计可视化：管理后台图表展示与 CSV 导出

### 低优先级
- 请求缓存：对确定性请求（temperature=0）缓存结果
- 更多上游：Azure OpenAI、Ollama、通义千问、文心一言
- 高级聊天：对话分享、模板、搜索、标签分类
- 国际化（i18n）：中英文切换
- 多租户：租户隔离、独立配额计费

## 📌 已知设计约束

- 熔断器与性能监控参数（`CIRCUIT_BREAKER_*`、`PERFORMANCE_WINDOW`）为代码内常量，**当前不读取环境变量**。如需可配置化，应改为从 `env` 读取后再补充到 `.env.example`。
