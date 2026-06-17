# API 文档

EdgeOne AI API Gateway 完整 API 参考文档。

---

## 📋 目录

- [OpenAI 兼容 API](#openai-兼容-api)
- [管理 API](#管理-api)
- [错误处理](#错误处理)
- [认证方式](#认证方式)

---

## 🤖 OpenAI 兼容 API

EdgeOne AI API Gateway 完全兼容 OpenAI API 格式。

### 聊天完成

创建聊天完成请求。

**端点**: `POST /v1/chat/completions`

**认证**: 使用用户 API Key（Bearer Token）

**请求体**:
```json
{
  "model": "gpt-4o-mini",
  "messages": [
    {
      "role": "user",
      "content": "你好，介绍一下自己"
    }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 2000,
  "top_p": 1.0
}
```

**参数说明**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | ✅ | 模型名称（如 gpt-4o-mini、gpt-4o） |
| `messages` | array | ✅ | 对话消息数组 |
| `stream` | boolean | ❌ | 是否流式输出（默认 false） |
| `temperature` | number | ❌ | 温度参数 0-2（默认 0.7） |
| `max_tokens` | number | ❌ | 最大 token 数（默认 2000） |
| `top_p` | number | ❌ | Top P 参数 0-1（默认 1.0） |

**响应（非流式）**:
```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "gpt-4o-mini",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "你好！我是 AI 助手..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30
  }
}
```

**响应（流式）**:
```
data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","content":"你"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc123","object":"chat.completion.chunk","created":1677652288,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"content":"好"},"finish_reason":null}]}

data: [DONE]
```

---

### 列出模型

获取所有可用模型列表。

**端点**: `GET /v1/models`

**认证**: 不需要（公开接口）

**响应**:
```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-4o-mini",
      "object": "model",
      "owned_by": "aiapi"
    },
    {
      "id": "gpt-4o",
      "object": "model",
      "owned_by": "aiapi"
    }
  ]
}
```

---

## 🔧 管理 API

管理渠道、用户和系统健康状态。

### 认证

所有管理 API 需要管理员 Token 认证：

```
Authorization: Bearer <ADMIN_TOKEN>
```

Browser admin UI uses an HttpOnly session cookie instead of storing
`ADMIN_TOKEN` in `localStorage`.

Create a session:
```http
POST /api/admin/session
Content-Type: application/json

{ "token": "<ADMIN_TOKEN>" }
```

Response:
```json
{
  "ok": true,
  "expires_at": 1717401234
}
```

The response sets `Set-Cookie: aiapi_admin_session=...; HttpOnly; SameSite=Strict`.
Subsequent browser requests to `/api/admin/*` authenticate with that cookie.
Non-browser clients may continue to use `Authorization: Bearer <ADMIN_TOKEN>`.

---

### 渠道管理

#### 列出所有渠道

**端点**: `GET /api/admin/channels`

**响应**:
```json
[
  {
    "id": "channel-1",
    "name": "OpenAI Primary",
    "type": "openai",
    "base_url": "https://api.openai.com/v1",
    "enabled": true,
    "weight": 10,
    "has_api_key": true
  }
]
```

#### 创建渠道

**端点**: `POST /api/admin/channels`

**请求体**:
```json
{
  "name": "OpenAI Primary",
  "type": "openai",
  "base_url": "https://api.openai.com/v1",
  "api_key": "sk-...",
  "enabled": true,
  "weight": 10
}
```

**响应**:
```json
{
  "id": "channel-1",
  "name": "OpenAI Primary",
  "type": "openai",
  "base_url": "https://api.openai.com/v1",
  "enabled": true,
  "weight": 10,
  "has_api_key": true
}
```

#### 更新渠道

**端点**: `PUT /api/admin/channels/:id`

**请求体**: 同创建渠道

**响应**: 同创建渠道

#### 删除渠道

**端点**: `DELETE /api/admin/channels/:id`

**响应**:
```json
{
  "ok": true
}
```

---

### 用户管理

#### 列出所有用户

**端点**: `GET /api/admin/users`

**响应**:
```json
[
  {
    "id": "user-1",
    "name": "测试用户",
    "enabled": true,
    "allowed_models": ["gpt-4o-mini", "gpt-4o"],
    "is_default": false,
    "has_api_key": true
  }
]
```

#### 创建用户

**端点**: `POST /api/admin/users`

**请求体**:
```json
{
  "name": "测试用户",
  "api_key": "sk-test-xxx",
  "enabled": true,
  "allowed_models": ["gpt-4o-mini", "gpt-4o"],
  "is_default": false
}
```

**参数说明**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | ✅ | 用户名称 |
| `api_key` | string | ✅ | 用户的 API Key |
| `enabled` | boolean | ❌ | 是否启用（默认 true） |
| `allowed_models` | array | ❌ | 允许使用的模型（空数组=全部） |
| `is_default` | boolean | ❌ | 是否为默认用户（默认 false） |

**响应**: 同列出用户的单个对象

#### 更新用户

**端点**: `PUT /api/admin/users/:id`

**请求体**: 同创建用户

**响应**: 同创建用户

#### 删除用户

**端点**: `DELETE /api/admin/users/:id`

**响应**:
```json
{
  "ok": true
}
```

---

### 模型管理

#### 获取上游模型

从上游 API 获取可用模型列表。

**端点**: `POST /api/admin/models/fetch`

**请求体**:
```json
{
  "channel_ids": ["channel-1", "channel-2"]
}
```

**响应**:
```json
[
  {
    "id": "gpt-4o",
    "object": "model",
    "created": 1686935002,
    "owned_by": "openai"
  },
  {
    "id": "gpt-4o-mini",
    "object": "model",
    "created": 1686935002,
    "owned_by": "openai"
  }
]
```

---

### 健康检查

#### 系统健康状态

**端点**: `GET /api/admin/health`

**响应**:
```json
{
  "status": "ok",
  "timestamp": 1717401234567,
  "channels": [
    {
      "id": "channel-1",
      "name": "OpenAI Primary",
      "status": "enabled",
      "weight": 10,
      "models": [
        {
          "model": "gpt-4o",
          "circuitBreaker": {
            "state": "closed",
            "failures": 0,
            "openedAt": null,
            "lastFailure": null
          },
          "performance": {
            "totalRequests": 150,
            "successRequests": 148,
            "failedRequests": 2,
            "avgDuration": 1250,
            "minDuration": 800,
            "maxDuration": 3500,
            "successRate": 99
          }
        }
      ]
    }
  ]
}
```

**熔断器状态**:
- `closed`: 正常工作
- `open`: 熔断中（连续失败 5 次）
- `half_open`: 恢复中（60 秒后尝试恢复）

#### 性能统计

**端点**: `GET /api/admin/performance?channel=<channel_id>&model=<model_name>`

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `channel` | string | ✅ | 渠道 ID |
| `model` | string | ✅ | 模型名称 |

**响应**:
```json
{
  "channelId": "channel-1",
  "model": "gpt-4o",
  "totalRequests": 150,
  "successRequests": 148,
  "failedRequests": 2,
  "avgDuration": 1250,
  "minDuration": 800,
  "maxDuration": 3500,
  "successRate": 99
}
```

---

## ❌ 错误处理

所有错误响应遵循统一格式：

```json
{
  "error": {
    "type": "invalid_request_error",
    "message": "Body must include model and messages."
  }
}
```

### 错误类型

| 错误类型 | HTTP 状态码 | 说明 |
|---------|------------|------|
| `invalid_request_error` | 400 | 请求参数错误 |
| `authentication_error` | 401 | 认证失败 |
| `permission_denied_error` | 403 | 权限不足 |
| `not_found` | 404 | 资源不存在 |
| `method_not_allowed` | 405 | 不支持的 HTTP 方法 |
| `no_available_channel` | 503 | 没有可用的渠道 |
| `upstream_error` | 502 | 所有上游渠道失败 |
| `internal_error` | 500 | 内部服务器错误 |

### 常见错误示例

#### 认证失败
```json
{
  "error": {
    "type": "authentication_error",
    "message": "Invalid or missing API key."
  }
}
```

#### 所有渠道失败
```json
{
  "error": {
    "type": "upstream_error",
    "message": "All upstream channels failed.",
    "failures": [
      {
        "channel": "OpenAI Primary",
        "status": 429,
        "body": "Rate limit exceeded"
      },
      {
        "channel": "OpenAI Backup",
        "status": 500,
        "body": "Internal server error"
      }
    ]
  }
}
```

---

## 🔐 认证方式

### 用户 API 认证

用于访问 `/v1/*` 端点：

```bash
curl https://your-domain.com/v1/chat/completions \
  -H "Authorization: Bearer sk-your-user-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### 管理员认证

用于访问 `/api/admin/*` 端点：


Browser clients should first call `POST /api/admin/session` and then rely on
the HttpOnly `aiapi_admin_session` cookie. CLI and server-to-server clients can
still use a bearer token:

```bash
curl https://your-domain.com/api/admin/channels \
  -H "Authorization: Bearer your-admin-token"
```

---

## 📝 使用示例

### Python

```python
import openai

client = openai.OpenAI(
    api_key="sk-your-user-api-key",
    base_url="https://your-domain.com/v1"
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.choices[0].message.content)
```

### Node.js

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'sk-your-user-api-key',
  baseURL: 'https://your-domain.com/v1'
});

const response = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});

console.log(response.choices[0].message.content);
```

### cURL

```bash
curl https://your-domain.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-user-api-key" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {
        "role": "user",
        "content": "Hello!"
      }
    ]
  }'
```

---

## 🔗 相关文档

- [快速开始](./QUICKSTART.md)
- [部署指南](./DEPLOY_GUIDE.md)
- [熔断器文档](./CIRCUIT_BREAKER.md)
- [功能列表](./FEATURES.md)

---

**有问题？** 查看 [GitHub Issues](https://github.com/你的用户名/aiapi/issues) 或参考其他文档。
