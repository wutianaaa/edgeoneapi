# 项目结构说明

> 最后更新：2026-06-17

## 📁 目录结构

```
edgeoneapi/
├── docs/                           # 📚 项目文档
│   ├── API.md                      # API 参考文档
│   ├── CHANGELOG.md                # 版本变更历史
│   ├── CIRCUIT_BREAKER.md          # 熔断器设计文档
│   ├── DEPLOY_GUIDE.md             # 部署指南
│   ├── FEATURES.md                 # 功能说明
│   ├── QUICKSTART.md               # 快速开始
│   └── ROADMAP.md                  # 开发路线图
│
├── edge-functions/                 # 🔥 EdgeOne 后端代码
│   ├── api/
│   │   └── [[default]].js          # 管理API路由
│   └── v1/
│       ├── chat/
│       │   └── completions.js      # 聊天完成端点
│       └── models.js               # 模型列表端点
│
├── lib/                            # 📦 共享库
│   └── shared.js                   # 核心业务逻辑（熔断器、负载均衡等）
│
├── src/                            # 🎨 前端源码（Vue 3）
│   ├── pages/                      # 页面组件
│   │   ├── ChatPage.vue            # 聊天界面
│   │   └── admin/                  # 管理后台
│   │       ├── AdminLayout.vue     # 后台布局
│   │       ├── ChannelsPage.vue    # 渠道管理
│   │       ├── HealthPage.vue      # 健康监控
│   │       └── UsersPage.vue       # 用户管理
│   ├── services/                   # 服务层
│   │   └── api.js                  # API 调用封装
│   ├── App.vue                     # 根组件
│   ├── main.js                     # 入口文件
│   ├── router.js                   # 路由配置
│   └── styles.css                  # 全局样式
│
├── tests/                          # 🧪 测试文件
│   ├── api-service.test.js         # API服务测试
│   ├── shared.test.js              # 共享库测试
│   └── helpers/                    # 测试辅助工具
│       └── kv.js                   # KV模拟
│
├── public/                         # 🌐 静态资源
│   └── _redirects                  # 路由重定向规则
│
├── .env.example                    # 环境变量示例
├── .gitignore                      # Git忽略规则
├── index.html                      # HTML入口
├── package.json                    # 项目依赖
├── vite.config.js                  # Vite配置
├── version.json                    # 版本信息
├── LICENSE                         # MIT许可证
└── README.md                       # 主文档
```

## 🎯 核心模块说明

### 1. 后端（edge-functions/）

EdgeOne Pages 运行时，基于 Cloudflare Workers 兼容的 edge-functions：

```
edge-functions/
├── api/[[default]].js       管理API（需ADMIN_TOKEN）
│   ├── GET /api/admin/health        健康状态
│   ├── GET /api/admin/performance   性能指标
│   ├── GET /api/admin/usage         使用统计
│   └── GET /api/admin/logs          请求日志
│
└── v1/                      OpenAI兼容API（需用户API Key）
    ├── chat/completions.js  POST /v1/chat/completions
    └── models.js            GET /v1/models
```

**核心特性**：
- ✅ 多渠道负载均衡
- ✅ 智能熔断器（按模型粒度）
- ✅ 自动故障转移
- ✅ 性能监控与统计

### 2. 共享库（lib/shared.js）

所有业务逻辑的核心，包含：

- `handleChatRequest()` - 聊天请求处理
- `handleModelsRequest()` - 模型列表
- `handleAdminRequest()` - 管理接口路由
- `selectChannel()` - 负载均衡算法
- `checkCircuitBreaker()` - 熔断器检查
- `recordPerformance()` - 性能记录
- `rateLimit()` - 速率限制

### 3. 前端（src/）

Vue 3 单页应用：

```
/              聊天界面
/m/chat        管理后台聊天
/m/channels    渠道管理
/m/users       用户管理
/m/health      健康监控
```

**技术栈**：
- Vue 3 + Composition API
- Vue Router 4
- Vite 6
- Lucide Icons
- Markdown-it

### 4. 文档（docs/）

所有项目文档集中管理：

- **API.md** - 完整的 API 接口文档
- **DEPLOY_GUIDE.md** - EdgeOne Pages 部署步骤
- **CIRCUIT_BREAKER.md** - 熔断器实现细节
- **FEATURES.md** - 所有功能列表
- **QUICKSTART.md** - 5分钟快速开始
- **ROADMAP.md** - 未来规划
- **CHANGELOG.md** - 版本历史

## 🔄 请求处理流程

```
用户请求
  ↓
[edge-functions/v1/chat/completions.js]
  ↓
[lib/shared.js: handleChatRequest()]
  ├─ 验证 API Key
  ├─ 速率限制检查
  ├─ 选择可用渠道（负载均衡）
  ├─ 检查熔断器状态
  ├─ 发送请求到上游
  ├─ 记录性能指标
  └─ 返回结果 / 故障转移
```

## 📦 构建与部署

### 本地开发
```bash
npm run dev         # 启动开发服务器（http://localhost:5173）
npm run build       # 构建生产版本
npm run preview     # 预览构建结果
npm test            # 运行测试
npm run check       # 语法检查 + 构建
```

### 部署到 EdgeOne Pages

1. **构建输出**：`npm run build` → `dist/`
2. **后端代码**：`edge-functions/` → EdgeOne自动识别
3. **KV存储**：绑定命名空间 `AIAPI_KV`
4. **环境变量**：`ADMIN_TOKEN=your-secret`

详见 [docs/DEPLOY_GUIDE.md](docs/DEPLOY_GUIDE.md)

## 🗄️ 数据存储（EdgeOne KV）

```
KV 命名空间：AIAPI_KV

数据结构：
├── channels:{id}              渠道配置
├── users:{id}                 用户配置
├── circuitbreaker:{key}       熔断器状态
├── performance:{key}          性能指标
└── ratelimit:{key}            速率限制计数
```

## 🔧 配置文件

- **package.json** - 依赖和脚本
- **vite.config.js** - 前端构建配置
- **version.json** - 版本号
- **.env.example** - 环境变量模板
- **.gitignore** - Git忽略规则

## 📝 代码风格

- **ES Modules** - `import/export`
- **Async/Await** - 异步处理
- **Vue 3 Composition API** - 前端组件
- **JSDoc** - 函数注释（推荐）

## 🚀 快速导航

| 需求 | 文档 |
|------|------|
| 快速开始 | [docs/QUICKSTART.md](docs/QUICKSTART.md) |
| API 接口 | [docs/API.md](docs/API.md) |
| 部署上线 | [docs/DEPLOY_GUIDE.md](docs/DEPLOY_GUIDE.md) |
| 功能列表 | [docs/FEATURES.md](docs/FEATURES.md) |
| 架构设计 | [docs/CIRCUIT_BREAKER.md](docs/CIRCUIT_BREAKER.md) |
| 修改后端 | [edge-functions/](edge-functions/) + [lib/shared.js](lib/shared.js) |
| 修改前端 | [src/](src/) |
| 运行测试 | [tests/](tests/) |

## 📊 项目统计

- **代码行数**：~3000+ 行（不含依赖）
- **文档**：~2000+ 行
- **构建产物**：~280 KB (gzip: ~100 KB)
- **测试覆盖**：核心模块

## 🔗 相关链接

- **EdgeOne Pages**: https://www.tencentcloud.com/products/teo
- **Cloudflare Workers Docs**: https://developers.cloudflare.com/workers/
- **Vue 3 Docs**: https://vuejs.org/
- **Vite Docs**: https://vitejs.dev/

---

**EdgeOne AI API Gateway** - 企业级 OpenAI 兼容网关 🚀
