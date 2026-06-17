# EdgeOne AI API Gateway - 功能规划与优化建议

## 📊 当前状态分析

### ✅ 已实现的功能
1. **核心功能**
   - OpenAI 兼容 API 代理
   - 多渠道管理和负载均衡
   - 用户认证和权限控制
   - 模型映射和转发

2. **前端功能**
   - 深色模式支持
   - 聊天界面（支持流式输出）
   - 管理后台（渠道、用户、模型）
   - 批量导入导出
   - 模型参数配置
   - 停止生成功能

3. **基础设施**
   - EdgeOne KV 存储
   - EdgeOne Functions 运行时
   - 静态资源 CDN 加速

---

## 🚀 可以完善的功能（优先级排序）

### 🔥 高优先级（强烈建议）

#### 1. **用量统计和计费**
**价值**: 了解 API 使用情况，控制成本

**实现方案**:
```javascript
// 在 lib/shared.js 中添加
async function recordUsage(kv, userId, usage) {
  const key = `usage:${userId}:${Date.now()}`;
  await kv.put(key, JSON.stringify({
    model: usage.model,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    cost: calculateCost(usage),
    timestamp: Date.now()
  }), { expirationTtl: 86400 * 30 }); // 保留 30 天
}
```

**功能点**:
- 记录每次请求的 token 使用量
- 按用户/渠道统计
- 显示成本估算
- 每日/每月统计报表
- 导出为 CSV/Excel

**UI 界面**:
- 新增 `/m/analytics` 页面
- 展示图表（使用 Chart.js）
- 支持日期范围筛选

---

#### 2. **速率限制（Rate Limiting）**
**价值**: 防止滥用，保护上游 API

**实现方案**:
```javascript
// 利用 EdgeOne KV 的原子操作
async function checkRateLimit(kv, userId, limit = 60) {
  const key = `ratelimit:${userId}:${Math.floor(Date.now() / 60000)}`;
  const current = await kv.get(key);
  const count = current ? parseInt(current) : 0;
  
  if (count >= limit) {
    throw new RateLimitError("Rate limit exceeded");
  }
  
  await kv.put(key, String(count + 1), { expirationTtl: 120 });
  return { remaining: limit - count - 1, limit };
}
```

**功能点**:
- 按用户限制请求速率
- 按 IP 限制（防止未认证请求）
- 可配置的速率限制规则
- 返回 `X-RateLimit-*` 响应头

**配置界面**:
- 在用户编辑页面添加速率限制配置
- 支持按分钟/小时/天限制

---

#### 3. **请求日志和审计**
**价值**: 故障排查，安全审计

**实现方案**:
```javascript
async function logRequest(kv, log) {
  const key = `log:${Date.now()}:${randomId()}`;
  await kv.put(key, JSON.stringify({
    userId: log.userId,
    model: log.model,
    status: log.status,
    duration: log.duration,
    error: log.error,
    ip: log.ip,
    timestamp: Date.now()
  }), { expirationTtl: 86400 * 7 }); // 保留 7 天
}
```

**功能点**:
- 记录所有 API 请求
- 包含请求参数、响应状态、耗时
- 错误日志单独标记
- 支持搜索和筛选

**UI 界面**:
- 新增 `/m/logs` 页面
- 实时日志流（WebSocket/SSE）
- 日志搜索和导出

---

#### 4. **健康检查和监控**
**价值**: 及时发现问题，保证服务可用性

**实现方案**:
```javascript
// 新增 /api/health 端点
export async function handleHealth(context) {
  const kv = getKv(context.env);
  const channels = await listChannels(kv, { exposeSecrets: true });
  
  const health = {
    status: "healthy",
    timestamp: Date.now(),
    channels: await Promise.all(channels.map(async (ch) => {
      try {
        const response = await fetch(`${ch.base_url}/models`, {
          headers: { "Authorization": `Bearer ${ch.api_key}` },
          signal: AbortSignal.timeout(5000)
        });
        return { id: ch.id, name: ch.name, status: response.ok ? "up" : "down" };
      } catch {
        return { id: ch.id, name: ch.name, status: "down" };
      }
    }))
  };
  
  return json(health);
}
```

**功能点**:
- 检查所有渠道状态
- 检查 KV 存储可用性
- 响应时间统计
- 错误率统计

**UI 界面**:
- 新增 `/m/health` 页面
- 实时状态监控
- 告警通知（邮件/Webhook）

---

### ⚡ 中优先级（建议实现）

#### 5. **缓存机制**
**价值**: 减少重复请求，降低成本

**实现方案**:
- 使用 EdgeOne KV 缓存相同请求的响应
- 支持可配置的缓存时间
- 支持缓存失效策略

**注意**: 仅适用于确定性请求（temperature=0）

---

#### 6. **Webhook 通知**
**价值**: 集成到现有系统

**功能点**:
- 请求完成后触发 Webhook
- 错误发生时触发告警
- 配额用尽时触发通知

---

#### 7. **多租户支持**
**价值**: 支持 SaaS 模式

**功能点**:
- 租户隔离
- 独立的配额和计费
- 租户级别的统计

---

#### 8. **API Key 管理增强**
**价值**: 更安全的密钥管理

**功能点**:
- API Key 过期时间
- 只读 Key（仅查询统计）
- IP 白名单
- 最后使用时间显示

---

### 🎨 低优先级（可选功能）

#### 9. **高级聊天功能**
- 对话分享（生成公开链接）
- 对话模板
- 对话搜索
- 对话标签分类

#### 10. **多语言支持**
- 国际化（i18n）
- 支持中文、英文切换

#### 11. **插件系统**
- 支持自定义插件
- 函数调用（Function Calling）
- 工具使用（Tool Use）

#### 12. **更多上游支持**
- Anthropic Claude
- Google Gemini
- Azure OpenAI
- 本地模型（Ollama）

---

## 🛠️ EdgeOne Pages 特有的优化

### 1. **利用 Edge Functions**
```javascript
// 在边缘节点进行请求预处理
export async function onRequest(context) {
  // IP 限流
  // 请求验证
  // 缓存检查
  return await context.next();
}
```

### 2. **利用 EdgeOne Analytics**
- 内置的访问分析
- 流量统计
- 性能监控

### 3. **利用 EdgeOne KV 的特性**
- 原子操作（用于速率限制）
- TTL 自动过期（用于缓存和日志）
- 高性能读写

### 4. **利用 EdgeOne CDN**
- 静态资源加速
- 图片优化
- 压缩传输

---

## 📋 实施建议

### 第一阶段（核心增强）
1. ✅ 用量统计基础版
2. ✅ 速率限制
3. ✅ 请求日志
4. ✅ 健康检查

### 第二阶段（功能完善）
5. ✅ 统计报表界面
6. ✅ 日志查看界面
7. ✅ 告警通知
8. ✅ API Key 增强

### 第三阶段（高级功能）
9. ✅ 缓存机制
10. ✅ Webhook
11. ✅ 多租户
12. ✅ 更多上游支持

---

## 💡 技术方案建议

### 数据结构设计

#### 用量记录
```typescript
interface UsageRecord {
  userId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  duration: number;
  timestamp: number;
}
```

#### 日志记录
```typescript
interface LogRecord {
  id: string;
  userId: string;
  model: string;
  method: string;
  status: number;
  duration: number;
  error?: string;
  ip: string;
  userAgent: string;
  timestamp: number;
}
```

#### 速率限制
```typescript
interface RateLimit {
  userId: string;
  limit: number; // 每分钟请求数
  window: number; // 时间窗口（秒）
  burst: number; // 突发请求数
}
```

---

## 🎯 推荐优先实现的功能

如果时间有限，建议优先实现以下 **3 个功能**：

1. **用量统计** - 了解使用情况，控制成本
2. **速率限制** - 防止滥用，保护系统
3. **请求日志** - 故障排查，问题定位

这三个功能可以在现有代码基础上快速实现，不需要大的架构改动。

---

## 📚 相关资源

- [EdgeOne KV 文档](https://cloud.tencent.com/document/product/1552)
- [EdgeOne Functions 文档](https://cloud.tencent.com/document/product/1552)
- [EdgeOne Pages 文档](https://cloud.tencent.com/document/product/1552)

---

**需要我帮你实现哪些功能？我可以提供详细的代码实现。** 🚀
