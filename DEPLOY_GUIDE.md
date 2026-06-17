# 🚀 部署指南 - v1.2.0

EdgeOne AI API Gateway 完整部署教程

---

## 📋 部署前准备

### 1. Git 仓库
- GitHub: https://github.com
- GitLab: https://gitlab.com
- Gitee: https://gitee.com

### 2. EdgeOne Pages 账号
- 访问：https://console.cloud.tencent.com/edgeone
- 注册并登录腾讯云账号

---

## 🔥 快速部署（3 步）

### 步骤 1：推送代码到 Git

#### 新仓库
```bash
cd C:/code/edgeone/aiapi

# 在 GitHub/GitLab/Gitee 创建新仓库后
git remote add origin https://github.com/你的用户名/aiapi.git

# 推送代码和标签
git push -u origin master
git push --tags
```

#### 现有仓库
```bash
cd C:/code/edgeone/aiapi

# 推送最新代码
git push

# 推送所有标签
git push --tags
```

### 步骤 2：创建 EdgeOne Pages 项目

1. **登录 EdgeOne 控制台**
   - 访问：https://console.cloud.tencent.com/edgeone

2. **创建 Pages 项目**
   - 点击"创建项目"
   - 连接你的 Git 仓库
   - 选择仓库和分支（master）

3. **配置构建设置**
   ```
   构建命令: npm run build
   输出目录: dist
   Node 版本: 18.x 或更高
   ```

### 步骤 3：配置环境和 KV

1. **创建 KV 命名空间**
   - 在 EdgeOne 控制台创建 KV 命名空间
   - 命名空间名称：`AIAPI_KV`

2. **绑定 KV**
   - 项目设置 → KV 绑定
   - 变量名：`AIAPI_KV`
   - 选择刚创建的 KV 命名空间

3. **设置环境变量**
   - 项目设置 → 环境变量
   - 添加变量：
     ```
     ADMIN_TOKEN=你的管理员密码
     ```

4. **部署**
   - 点击"部署"按钮
   - 等待构建完成（约 2-3 分钟）

---

## ✅ 部署后验证

### 1. 访问前端
```
https://你的域名.pages.dev
```

应该看到聊天界面

### 2. 访问管理后台
```
https://你的域名.pages.dev/m
```

使用你设置的 `ADMIN_TOKEN` 登录

### 3. 测试 API
```bash
# 列出模型
curl https://你的域名.pages.dev/v1/models

# 健康检查
curl https://你的域名.pages.dev/api/admin/health \
  -H "Authorization: Bearer 你的ADMIN_TOKEN"
```

---

## 🔧 初始配置

### 1. 添加渠道

访问 `/m/channels`，添加上游 API：

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

### 2. 创建用户

访问 `/m/users`，创建 API Key：

```json
{
  "name": "测试用户",
  "api_key": "sk-test-xxx",
  "enabled": true,
  "allowed_models": []
}
```

### 3. 测试聊天

```bash
curl https://你的域名.pages.dev/v1/chat/completions \
  -H "Authorization: Bearer sk-test-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## 🌐 自定义域名（可选）

### 1. 添加自定义域名
- EdgeOne Pages 控制台 → 自定义域名
- 添加你的域名（如 api.example.com）

### 2. 配置 DNS
- 添加 CNAME 记录指向 EdgeOne Pages 域名

### 3. 启用 HTTPS
- EdgeOne 自动提供免费 SSL 证书

---

## 📊 监控和维护

### 健康检查
```bash
curl https://你的域名.pages.dev/api/admin/health \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

### 查看日志
```bash
# 请求日志
curl https://你的域名.pages.dev/api/admin/logs?limit=100 \
  -H "Authorization: Bearer ADMIN_TOKEN"

# 使用统计
curl https://你的域名.pages.dev/api/admin/usage?user=user-123 \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

### 性能监控
访问 `/m/health` 查看：
- 渠道状态
- 熔断器状态
- 性能指标
- 成功率统计

---

## 🔄 更新部署

### 自动部署
推送代码到 Git 自动触发部署：
```bash
git push
```

### 回滚版本
在 EdgeOne 控制台选择历史部署版本回滚

---

## 🐛 故障排查

### 问题 1：构建失败
**解决**：
- 检查 Node 版本（需要 18.x+）
- 查看构建日志
- 确认 package.json 正确

### 问题 2：KV 访问失败
**解决**：
- 确认 KV 命名空间已创建
- 检查绑定变量名为 `AIAPI_KV`
- 重新部署项目

### 问题 3：管理后台无法登录
**解决**：
- 检查环境变量 `ADMIN_TOKEN` 是否设置
- 确认使用正确的密码
- 清除浏览器缓存

### 问题 4：API 返回 502
**解决**：
- 检查上游渠道配置
- 确认渠道 API Key 正确
- 查看熔断器状态（可能已打开）

---

## 📈 性能优化建议

### 1. 启用缓存
EdgeOne Pages 自动启用边缘缓存

### 2. 使用 CDN
EdgeOne 全球分布，自动选择最近节点

### 3. 监控性能
定期查看 `/m/health` 页面

### 4. 优化渠道权重
根据实际性能调整渠道权重

---

## 🔐 安全建议

### 1. 保护 ADMIN_TOKEN
- 使用强密码
- 定期更换
- 不要提交到代码仓库

### 2. API Key 管理
- 为不同用户创建独立 Key
- 定期审计使用情况
- 及时禁用异常 Key

### 3. 速率限制
- 根据实际需求调整限制
- 监控异常请求

### 4. 日志审计
- 定期检查请求日志
- 发现异常及时处理

---

## 📞 获取帮助

### 文档
- [快速开始](./QUICKSTART.md)
- [API 文档](./API.md)
- [功能列表](./FEATURES.md)

### 问题反馈
- GitHub Issues: https://github.com/你的用户名/aiapi/issues

---

## 🎉 部署完成！

现在你有了一个高性能的 API 网关：
- ✅ 速率限制
- ✅ 使用统计
- ✅ 请求日志
- ✅ 熔断器保护
- ✅ 性能监控
- ⚡ 64% 性能提升

**EdgeOne AI API Gateway v1.2.0 部署成功！** 🚀
