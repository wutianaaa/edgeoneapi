# EdgeOne AI API Gateway

OpenAI compatible API gateway for EdgeOne Pages. The project includes a Vue admin/chat UI, EdgeOne Functions routes, and shared gateway logic for channel routing, failover, rate limiting, usage logs, and health metrics.

## Directory

```text
edgeoneapi/
├── edge-functions/   # EdgeOne Pages Functions routes
├── lib/              # Shared gateway logic used by functions
├── src/              # Vue 3 frontend
├── public/           # Static files and SPA redirects
├── tests/            # Vitest tests
├── docs/             # Project documentation
├── index.html        # Vite HTML entry
├── package.json      # Scripts and dependencies
└── vite.config.js    # Vite and Vitest config
```

Generated or local-only files are ignored by Git: `.env`, `.edgeone/`, `dist/`, `node_modules/`, IDE files, logs, screenshots, and temporary notes.

## Requirements

- Node.js 18 or newer
- EdgeOne CLI for local Pages Functions development
- EdgeOne KV binding named `AIAPI_KV`
- Environment variable `ADMIN_TOKEN`

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

The Vite frontend runs at `http://127.0.0.1:5173`.

For EdgeOne Pages local development:

```bash
npm run edgeone:dev
```

If you need to sync cloud project environment variables, link the local folder first:

```bash
edgeone pages link
```

## Scripts

```bash
npm run dev          # Start Vite frontend
npm run edgeone:dev  # Start EdgeOne Pages dev server
npm run build        # Build frontend to dist/
npm run preview      # Preview built frontend
npm run check        # Syntax check functions and build frontend
npm test             # Run Vitest with coverage
```

## EdgeOne Deploy

In EdgeOne Pages, use:

```text
Build command: npm run build
Output directory: dist
Functions directory: edge-functions
KV binding: AIAPI_KV
Environment: ADMIN_TOKEN=<your-admin-token>
```

Do not commit `.env`; use `.env.example` as the template.

## Routes

Frontend:

```text
/              Chat UI
/m/chat        Admin chat
/m/channels    Channel management
/m/users       User management
/m/health      Health dashboard
```

API:

```text
POST /v1/chat/completions
GET  /v1/models
GET  /api/admin/health
GET  /api/admin/performance
GET  /api/admin/usage
GET  /api/admin/logs
```

## Documentation

- [Project structure](docs/PROJECT_STRUCTURE.md)
- [Quick start](docs/QUICKSTART.md)
- [API reference](docs/API.md)
- [Deploy guide](docs/DEPLOY_GUIDE.md)
- [Features](docs/FEATURES.md)
- [Circuit breaker](docs/CIRCUIT_BREAKER.md)
- [Roadmap](docs/ROADMAP.md)
- [Changelog](docs/CHANGELOG.md)

## License

[MIT](LICENSE)
