# 快速启动指南

## 🚀 本地开发

### 1. 安装依赖
```bash
npm install
```

### 2. 启动开发服务器
```bash
npm run dev
```

访问 http://127.0.0.1:5173 查看界面。

### 3. 构建生产版本
```bash
npm run build
```

构建结果在 `dist/` 目录。

## 🎨 新功能快速体验

### 深色模式
1. 访问聊天页面
2. 点击右上角月亮图标切换到深色模式
3. 再次点击（太阳图标）切换回浅色模式

### 模型参数配置
1. 点击右上角滑块图标
2. 调节 Temperature、Max Tokens、Top P
3. 参数会自动保存并应用

### 停止生成
1. 在聊天输入框输入问题
2. AI 开始生成回复时，点击右下角方块按钮停止

### 导出对话
1. 点击右上角滑块图标
2. 选择 Markdown 或 JSON 格式导出

### 批量操作
1. 访问 `/m/channels` 或 `/m/users`
2. 点击"导出"按钮保存配置
3. 点击"导入"按钮上传 JSON 文件

## 📁 项目结构

```
aiapi/
├── src/
│   ├── pages/
│   │   ├── ChatPage.vue          # 聊天页面（新增深色模式、参数配置、导出、停止）
│   │   └── admin/
│   │       ├── ChannelsPage.vue  # 渠道管理（新增批量导入导出）
│   │       └── UsersPage.vue     # 用户管理（新增批量导入导出）
│   ├── services/
│   │   └── api.js                # API 服务（新增 AbortSignal 支持）
│   ├── styles.css                # 样式文件（新增深色模式变量）
│   ├── App.vue
│   ├── router.js
│   └── main.js
├── functions/                     # EdgeOne Functions（后端）
├── FEATURES.md                    # 新功能详细说明
├── README.md                      # 项目文档
└── package.json
```

## 🎯 功能对照表

| 功能 | 状态 | 说明 |
|------|------|------|
| 深色模式 | ✅ | 完整支持，一键切换 |
| 停止生成 | ✅ | 使用 AbortController |
| 模型参数 | ✅ | Temperature, Max Tokens, Top P |
| 对话导出 | ✅ | Markdown 和 JSON 格式 |
| 批量导入导出 | ✅ | 渠道和用户 |
| UI 动画优化 | ✅ | 按钮动画、悬停效果 |

## 📋 待实现功能（可选）

以下功能未实现，但已在 FEATURES.md 中说明：

- 速率限制（Rate Limiting）
- 用量统计和成本追踪
- 请求日志查看
- 统计报表和图表
- 单元测试
- CI/CD 部署

## 🔧 技术栈

- **前端**: Vue 3 + Vite
- **UI**: 自定义 CSS（支持深色模式）
- **图标**: Lucide Vue
- **Markdown**: markdown-it
- **后端**: EdgeOne Functions
- **存储**: EdgeOne KV

## 📦 构建和部署

### 本地构建
```bash
npm run build
```

### 检查语法
```bash
npm run check
```

### EdgeOne Pages 部署
1. 将项目推送到 Git 仓库
2. 在 EdgeOne Pages 控制台创建项目
3. 配置环境变量 `ADMIN_TOKEN`
4. 绑定 KV 命名空间 `AIAPI_KV`
5. 部署完成

## ⚡ 性能优化

- 使用 Vite 构建，构建速度快
- CSS 按需加载
- 图标按需引入
- 主题状态持久化到 localStorage
- 参数配置持久化到 localStorage

## 🐛 故障排查

### 深色模式不生效
- 检查浏览器控制台是否有错误
- 清除 localStorage 并刷新页面
- 确认 CSS 文件已正确加载

### 停止按钮不工作
- 确认浏览器支持 AbortController API
- 检查网络请求是否包含 signal 参数

### 导入失败
- 确认 JSON 文件格式正确
- 检查文件编码为 UTF-8
- 查看浏览器控制台错误信息

## 📞 支持

如有问题，请查看：
1. [FEATURES.md](./FEATURES.md) - 详细功能说明
2. [README.md](./README.md) - 项目文档
3. GitHub Issues（如果开源）

---

**享受使用 EdgeOne AI API Gateway！** 🎉
