# 部署指南

## 方式一：使用 EdgeOne Pages（推荐）

### 前提条件
- 已注册腾讯云账号
- 已开通 EdgeOne Pages 服务
- 已创建 EdgeOne KV 命名空间

### 步骤 1: 准备 Git 仓库

#### 1.1 创建 GitHub/GitLab 仓库
1. 访问 GitHub/GitLab 创建新仓库
2. 复制仓库 URL

#### 1.2 推送代码
```bash
# 添加远程仓库
git remote add origin <你的仓库URL>

# 推送代码
git push -u origin master
```

### 步骤 2: 在 EdgeOne Pages 创建项目

1. 登录 [EdgeOne 控制台](https://console.cloud.tencent.com/edgeone)
2. 进入 **Pages** 服务
3. 点击 **新建项目**
4. 选择 **连接 Git 仓库**
5. 授权并选择你的仓库

### 步骤 3: 配置构建设置

**构建配置：**
- **框架预设**: Vite
- **构建命令**: `npm run build`
- **构建输出目录**: `dist`
- **安装命令**: `npm install`
- **Node.js 版本**: 18.x 或更高

**环境变量：**
```
ADMIN_TOKEN=你的管理员密码
```

### 步骤 4: 绑定 KV 命名空间

1. 在项目设置中找到 **函数与 KV**
2. 点击 **绑定 KV 命名空间**
3. 选择或创建命名空间 `AIAPI_KV`
4. 绑定变量名: `AIAPI_KV`

### 步骤 5: 部署

1. 点击 **开始部署**
2. 等待构建完成（约 2-3 分钟）
3. 访问自动生成的 URL

### 步骤 6: 配置自定义域名（可选）

1. 在项目设置中找到 **自定义域名**
2. 添加你的域名
3. 配置 DNS 解析（CNAME 记录）
4. 等待 SSL 证书自动签发

---

## 方式二：手动部署

### 使用 EdgeOne CLI

#### 1. 安装 CLI
```bash
npm install -g @edgeone/cli
```

#### 2. 登录
```bash
edgeone login
```

#### 3. 初始化项目（如果未初始化）
```bash
edgeone init
```

#### 4. 构建项目
```bash
npm run build
```

#### 5. 部署
```bash
edgeone deploy
```

---

## 方式三：使用其他平台

### Vercel

1. 导入 GitHub 仓库
2. 构建设置：
   - Framework Preset: Vite
   - Build Command: `npm run build`
   - Output Directory: `dist`
3. 环境变量：
   - `ADMIN_TOKEN`: 管理员密码
4. 部署

**注意**: Vercel 需要额外配置 KV 存储（如 Vercel KV）

### Netlify

1. 导入 GitHub 仓库
2. 构建设置：
   - Build command: `npm run build`
   - Publish directory: `dist`
3. 环境变量：
   - `ADMIN_TOKEN`: 管理员密码
4. 部署

**注意**: Netlify 需要额外配置存储方案

### Cloudflare Pages

1. 连接 GitHub 仓库
2. 构建设置：
   - Build command: `npm run build`
   - Build output directory: `/dist`
3. 环境变量：
   - `ADMIN_TOKEN`: 管理员密码
4. 绑定 KV 命名空间
5. 部署

---

## 部署后配置

### 1. 首次登录管理后台

访问: `https://你的域名/m/channels`

- **用户名**: admin（或任意）
- **密码**: 你设置的 ADMIN_TOKEN

### 2. 添加渠道

1. 点击 **新建渠道**
2. 填写渠道信息：
   - 名称: 如 `OpenAI Primary`
   - 类型: `OpenAI Compatible`
   - Base URL: 如 `https://api.openai.com/v1`
   - API Key: 你的 OpenAI API Key
3. 点击 **保存**

### 3. 配置模型映射

在渠道详情中：
1. 点击 **抓取上游模型**
2. 选择要公开的模型
3. 点击 **添加到公开列表**
4. 配置模型映射（可选）

### 4. 创建用户

访问: `https://你的域名/m/users`

1. 点击 **新建用户**
2. 填写用户信息：
   - 名称: 如 `default-user`
   - API Key: 自动生成或手动输入
   - 允许的模型: 选择模型
3. 点击 **保存**
4. **重要**: 复制生成的 API Key

### 5. 测试 API

使用 curl 测试：
```bash
curl https://你的域名/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-aiapi-xxxxx" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

---

## 更新部署

### 自动更新（推荐）
推送代码到 Git 仓库，EdgeOne Pages 会自动重新部署：
```bash
git add .
git commit -m "更新说明"
git push
```

### 手动更新
```bash
npm run build
edgeone deploy
```

---

## 环境变量说明

| 变量名 | 必需 | 说明 | 示例 |
|--------|------|------|------|
| `ADMIN_TOKEN` | 是 | 管理后台密码 | `your-secret-password` |

---

## KV 命名空间

EdgeOne KV 存储以下数据：
- 渠道配置 (`channel:*`)
- 用户配置 (`user:*`)
- 模型映射 (`model:*`)

**命名空间名称**: `AIAPI_KV`  
**绑定变量名**: `AIAPI_KV`

---

## 故障排查

### 部署失败

**问题**: 构建失败  
**解决**: 检查 Node.js 版本是否 >= 18

**问题**: 找不到模块  
**解决**: 确认 `package.json` 中的依赖完整

### 运行时错误

**问题**: 500 错误  
**解决**: 检查 KV 命名空间是否正确绑定

**问题**: 401 错误  
**解决**: 检查 API Key 是否正确

**问题**: 404 错误  
**解决**: 检查路由配置和 `_redirects` 文件

### 功能问题

**问题**: 深色模式不生效  
**解决**: 清除浏览器缓存并刷新

**问题**: 主题切换后刷新丢失  
**解决**: 检查浏览器是否禁用 localStorage

---

## 性能优化建议

### 1. 启用 CDN 缓存
EdgeOne Pages 自动为静态资源启用 CDN

### 2. 配置缓存规则
- HTML: 不缓存
- JS/CSS: 长期缓存（带哈希）
- 图片: 长期缓存

### 3. 启用 HTTP/3
EdgeOne 默认支持 HTTP/3

---

## 安全建议

1. **定期更换 ADMIN_TOKEN**
2. **使用强密码作为用户 API Key**
3. **定期审查用户列表**
4. **监控 API 使用情况**
5. **限制管理后台访问 IP**（可选）

---

## 监控和日志

### EdgeOne Pages 日志
在 EdgeOne 控制台查看：
- 构建日志
- 函数日志
- 访问日志

### 自定义监控
可以集成：
- Sentry（错误监控）
- LogTail（日志聚合）
- Datadog（性能监控）

---

## 回滚部署

### EdgeOne Pages
1. 进入项目 **部署历史**
2. 选择之前的版本
3. 点击 **回滚**

### 手动部署
```bash
git revert HEAD
git push
```

---

## 备份和恢复

### 导出配置
1. 访问 `/m/channels` 点击 **导出**
2. 访问 `/m/users` 点击 **导出**
3. 保存 JSON 文件

### 恢复配置
1. 访问对应页面
2. 点击 **导入**
3. 选择之前导出的 JSON 文件

---

## 支持

- **文档**: 查看项目文档
- **问题反馈**: GitHub Issues
- **EdgeOne 支持**: [腾讯云工单系统](https://console.cloud.tencent.com/workorder)

---

**部署完成后，享受使用 EdgeOne AI API Gateway！** 🎉
