# EdgeOne AI API Gateway

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

企业级 OpenAI 兼容 API 网关，运行在 EdgeOne Pages，支持多渠道负载均衡、智能熔断器、性能监控和深色模式。

## ✨ 特性

### 核心功能
- 🌐 **OpenAI 完全兼容** - 支持所有 OpenAI API 格式
- 🔀 **多渠道管理** - 支持多个上游 API 渠道（OpenAI、Anthropic、Gemini）
- ⚖️ **智能负载均衡** - 按权重自动分配请求
- 🔥 **渠道熔断器** - 按模型粒度熔断，防止雪崩
- 🔄 **自动故障转移** - 失败自动切换备用渠道
- 📊 **性能监控** - 实时追踪响应时间和成功率
- 🏥 **健康检查** - 系统健康状态可视化
- 🔐 **API Key 认证** - 用户和管理员权限控制
- 🚦 **速率限制** - 按用户/IP 限流，支持自定义速率
- 📈 **使用统计** - Token 使用量、成本追踪
- 📝 **请求日志** - 完整审计日志，支持查询导出

### 前端界面
- 💬 **聊天界面** - 流式输出、停止生成、会话管理
- 🌓 **深色模式** - 全局适配、平滑过渡
- 📱 **移动端优化** - 响应式布局、触控友好
- 🎛️ **管理后台**
  - 渠道管理（CRUD、批量导入导出）
  - 用户管理（CRUD、批量导入导出）
  - 健康监控页面（实时状态、性能指标）
- ⚙️ **高级配置**
  - 模型参数配置（Temperature、Max Tokens、Top P）
  - 聊天导出（Markdown、JSON）
  - Thinking 内容折叠展示

## 🚀 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/你的用户名/aiapi.git
cd aiapi
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，设置管理员密码：

```
ADMIN_TOKEN=your-secret-admin-token
```

### 4. 本地开发

```bash
npm run dev
```

访问 http://localhost:5173

### 5. 构建

```bash
npm run build
```

## 📦 部署到 EdgeOne Pages

详细部署步骤请参考 [部署指南](docs/DEPLOY_GUIDE.md)。

### 快速部署

1. **创建 EdgeOne Pages 项目**
   - 连接你的 Git 仓库
   - 构建命令: `npm run build`
   - 输出目录: `dist`

2. **绑定 KV 命名空间**
   - 创建 KV 命名空间: `AIAPI_KV`
   - 绑定变量名: `AIAPI_KV`

3. **设置环境变量**
   ```
   ADMIN_TOKEN=your-admin-password
   ```

4. **部署完成** 🎉

## 📖 文档

- [项目结构](docs/PROJECT_STRUCTURE.md) - 完整的目录结构说明 ⭐
- [快速开始](docs/QUICKSTART.md) - 5 分钟快速上手
- [API 文档](docs/API.md) - 完整 API 参考
- [部署指南](docs/DEPLOY_GUIDE.md) - 详细部署步骤
- [功能列表](docs/FEATURES.md) - 所有功能说明
- [熔断器文档](docs/CIRCUIT_BREAKER.md) - 熔断器和性能监控
- [开发路线](docs/ROADMAP.md) - 功能规划
- [变更日志](docs/CHANGELOG.md) - 版本历史

## 🎯 使用示例

### Python

```python
import openai

client = openai.OpenAI(
    api_key="sk-your-user-api-key",
    base_url="https://your-domain.com/v1"
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello!"}]
)

print(response.choices[0].message.content)
```

### cURL

```bash
curl https://your-domain.com/v1/chat/completions \
  -H "Authorization: Bearer sk-your-user-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

更多示例请查看 [API 文档](docs/API.md)。

## 🖥️ 界面预览

### 页面路由

```
/              聊天界面
/m/chat        管理后台聊天
/m/channels    渠道管理
/m/users       用户管理
/m/health      健康监控 ⭐
```

### 管理监控接口

管理后台数据由以下接口提供（均需 `ADMIN_TOKEN` 鉴权）：

```
GET /api/admin/health        系统健康与熔断器状态
GET /api/admin/performance   性能指标（响应时间、成功率）
GET /api/admin/usage         使用统计（Token 用量，可按用户筛选）
GET /api/admin/logs          请求日志（支持 userId / limit 筛选）
```

### 速率限制

聊天接口默认按用户每分钟 60 次（可在用户配置中通过 `rate_limit` 自定义），并按 IP 每分钟 120 次兜底；`/api/health` 公共端点每分钟 20 次。超限返回 `429` 并携带 `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` 响应头。

### 主要功能

#### 1. 聊天界面
- 流式输出支持
- 停止生成按钮
- 会话管理
- 深色模式切换

#### 2. 渠道管理
- 添加/编辑/删除渠道
- 启用/禁用渠道
- 权重配置
- 批量导入导出

#### 3. 用户管理
- 创建用户和 API Key
- 模型权限控制
- 批量导入导出

#### 4. 健康监控 ⭐
- 渠道状态实时展示
- 熔断器状态可视化
- 性能指标统计
- 自动刷新（10 秒）

## 🔧 技术栈

### 后端
- **运行时**: EdgeOne Functions (Cloudflare Workers 兼容)
- **存储**: EdgeOne KV
- **API**: OpenAI 兼容接口

### 前端
- **框架**: Vue 3 + Vite
- **路由**: Vue Router
- **图标**: Lucide Vue
- **Markdown**: markdown-it

### 特性
- **熔断器**: 按模型粒度，三态管理
- **性能监控**: 5 分钟窗口，自动过期
- **深色模式**: CSS 变量，200ms 过渡
- **流式输出**: Server-Sent Events (SSE)

## 🎨 架构设计

### 请求流程

```
客户端请求
  ↓
API Key 认证
  ↓
选择候选渠道（按权重排序）
  ↓
遍历渠道
  ├─ 检查熔断器状态
  │  ├─ Open → 跳过
  │  └─ Closed/Half-Open → 继续
  ├─ 发送请求到上游
  ├─ 记录性能指标
  └─ 判断结果
     ├─ 成功 → 返回结果 ✅
     └─ 失败 → 记录失败，尝试下一个
  ↓
所有渠道都失败 → 返回 502 错误
```

### 熔断器工作原理

```
关闭（Closed）→ 正常工作
   ↓ 连续失败 5 次
打开（Open）→ 熔断状态，60 秒内跳过该渠道
   ↓ 等待 60 秒
半开（Half-Open）→ 允许 1 个请求测试
   ↓ 成功           ↓ 失败
关闭（Closed）   打开（Open）
```

**关键特性**：熔断仅针对特定模型，不影响同渠道的其他模型。

## 📊 性能指标

### 构建产物
- **HTML**: 0.40 KB (gzip: 0.27 KB)
- **CSS**: 23.54 KB (gzip: 5.26 KB)
- **JS**: 256.97 KB (gzip: 98.60 KB)

### 运行时性能
- **熔断器检查**: < 5ms
- **性能记录**: < 3ms
- **EdgeOne KV**: 全球分布，低延迟

## 🔐 安全

- ✅ API Key 认证
- ✅ 管理员 Token 验证
- ✅ 环境变量保护敏感信息
- ✅ 调试日志默认关闭（`AIAPI_DEBUG_LOGS` 显式开启）
- ✅ HTTPS 强制使用

## 🤝 贡献

欢迎贡献！请查看 [贡献指南](./CONTRIBUTING.md)（如果有）。
- [Linux do 社区](https://linux.do/)

## 📄 许可证

[MIT License](./LICENSE)

## 🙏 致谢

- [EdgeOne Pages](https://www.tencentcloud.com/products/teo) - 部署平台
- [Vue 3](https://vuejs.org/) - 前端框架
- [Vite](https://vitejs.dev/) - 构建工具
- [Lucide](https://lucide.dev/) - 图标库

## 📞 联系方式

- **问题反馈**: [GitHub Issues](https://github.com/你的用户名/aiapi/issues)
- **功能建议**: [GitHub Discussions](https://github.com/你的用户名/aiapi/discussions)

---

**EdgeOne AI API Gateway - 企业级 API 网关解决方案** 🚀
