# 项目结构重组方案

## 🎯 目标
简化项目结构，消除冗余，提高可维护性

## 📊 当前问题

### 1. 重复的后端目录 ❌
```
├── edge-functions/      # EdgeOne Pages部署用
│   ├── api/
│   └── v1/
├── functions/           # 完全相同的代码！
│   ├── api/
│   └── v1/
```
**问题**: 两个目录内容100%重复，维护时需要同步修改

### 2. 文档散乱 ❌
```
根目录下有8个MD文件：
- API.md
- CHANGELOG.md
- CIRCUIT_BREAKER.md
- DEPLOY_GUIDE.md
- FEATURES.md
- QUICKSTART.md
- README.md
- ROADMAP.md
```
**问题**: 文档太多，查找不便

### 3. 构建产物混乱 ❌
```
├── dist/           # Vite构建输出
├── public/         # 静态资源
└── .edgeone/       # EdgeOne部署临时目录（已删除）
```

## ✅ 优化方案

### 方案A: 最小改动（推荐）

#### 1. 删除 functions/ 目录
- 只保留 `edge-functions/`
- EdgeOne Pages 实际使用的是 edge-functions
- 更新 package.json 中的检查脚本

#### 2. 整合文档到 docs/ 目录
```
docs/
├── README.md          -> 移动到根目录保留
├── API.md             # API文档
├── FEATURES.md        # 功能说明
├── DEPLOY_GUIDE.md    # 部署指南
├── QUICKSTART.md      # 快速开始
├── CIRCUIT_BREAKER.md # 熔断器文档
├── ROADMAP.md         # 路线图
└── CHANGELOG.md       # 变更日志
```
**只在根目录保留 README.md + LICENSE**

#### 3. 清理后的项目结构
```
edgeoneapi/
├── docs/                    # 📚 所有文档
├── edge-functions/          # 🔥 EdgeOne后端代码（唯一）
│   ├── api/
│   └── v1/
├── lib/                     # 📦 共享库
│   └── shared.js
├── src/                     # 🎨 前端源码
│   ├── pages/
│   ├── services/
│   ├── App.vue
│   ├── main.js
│   ├── router.js
│   └── styles.css
├── tests/                   # 🧪 测试
├── public/                  # 🌐 静态资源
├── .gitignore
├── package.json
├── vite.config.js
├── README.md               # 主文档
└── LICENSE
```

### 方案B: 激进重组（可选）

进一步重组为标准的全栈项目结构：
```
edgeoneapi/
├── docs/                    # 所有文档
├── server/                  # 后端（重命名edge-functions）
│   ├── api/
│   ├── v1/
│   └── lib/                # 移入shared.js
├── client/                  # 前端（重命名src）
│   ├── components/
│   ├── pages/
│   ├── services/
│   ├── App.vue
│   ├── main.js
│   └── router.js
├── tests/
├── public/
├── package.json
└── README.md
```

## 🚀 执行步骤（方案A）

### 步骤1: 创建 docs 目录并移动文档
```bash
mkdir docs
git mv API.md CHANGELOG.md CIRCUIT_BREAKER.md DEPLOY_GUIDE.md FEATURES.md QUICKSTART.md ROADMAP.md docs/
```

### 步骤2: 更新 README.md 中的文档链接
```markdown
## 📚 文档

- [快速开始](docs/QUICKSTART.md)
- [API文档](docs/API.md)
- [部署指南](docs/DEPLOY_GUIDE.md)
- [功能说明](docs/FEATURES.md)
- [熔断器](docs/CIRCUIT_BREAKER.md)
- [路线图](docs/ROADMAP.md)
- [变更日志](docs/CHANGELOG.md)
```

### 步骤3: 删除 functions 目录
```bash
git rm -r functions/
```

### 步骤4: 更新 package.json
移除 functions/ 的检查脚本

### 步骤5: 更新 .gitignore
确保 dist/ 和 node_modules/ 被忽略

## 📈 预期效果

- ✅ 减少50%的目录数量
- ✅ 文档集中管理，查找方便
- ✅ 消除代码重复
- ✅ 结构更清晰，符合开源项目规范
- ✅ 减少维护成本

## 🤔 需要确认

1. 是否有其他地方引用了 functions/ 目录？
2. EdgeOne Pages 部署配置是否正确指向 edge-functions？
3. 是否有 CI/CD 脚本依赖当前结构？
