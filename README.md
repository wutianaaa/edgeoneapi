# EdgeOne AI API Gateway

OpenAI compatible API gateway for EdgeOne Pages. The project includes a Vue admin/chat UI, EdgeOne Functions routes, and shared gateway logic for channel routing, failover, rate limiting, usage logs, and health metrics.

## Directory

```text
edgeoneapi/
|-- edge-functions/   # EdgeOne Pages Functions routes
|-- lib/              # Shared gateway logic used by functions
|-- src/              # Vue 3 frontend
|-- public/           # Static files and SPA redirects
|-- tests/            # Vitest tests
|-- docs/             # Project documentation
|-- index.html        # Vite HTML entry
|-- package.json      # Scripts and dependencies
`-- vite.config.js    # Vite and Vitest config
```

Generated or local-only files are ignored by Git: `.env`, `.edgeone/`, `dist/`, `node_modules/`, IDE files, logs, screenshots, and temporary notes.

## Requirements

- Node.js 18 or newer
- EdgeOne CLI for local Pages Functions development and deployment
- EdgeOne KV binding named `AIAPI_KV`
- Environment variable `ADMIN_TOKEN`

## Install

```bash
npm install
cp .env.example .env
```

Edit `.env` and set `ADMIN_TOKEN`.

## Start

Start the Vite frontend:

```bash
npm run dev
```

The frontend runs at `http://127.0.0.1:5173`.

Start with EdgeOne Pages Functions:

```bash
edgeone pages env pull
npm run edgeone:dev
```

If you need to sync cloud project environment variables, link the local folder first:

```bash
edgeone pages link
```

## Test

Run unit tests:

```bash
npm test
```

Run syntax checks and production build:

```bash
npm run check
```

## Build

```bash
npm run build
```

The frontend build output is written to `dist/`.

## Deploy

Deploy from the project root so EdgeOne can package both `dist/` and `edge-functions/`:

```bash
edgeone pages env set ADMIN_TOKEN <your-admin-token>
npm run check
edgeone pages deploy --name aiapi --env production
```

Do not deploy only `dist/`; that uploads the static frontend without EdgeOne Functions, so API routes and KV access will not work correctly.

If you are deploying through the EdgeOne Pages console, use:

```text
Build command: npm run build
Output directory: dist
Functions directory: edge-functions
KV binding: AIAPI_KV
Environment: ADMIN_TOKEN=<your-admin-token>
```

Do not commit `.env`; use `.env.example` as the template.

## Scripts

```bash
npm run dev          # Start Vite frontend
npm run edgeone:dev  # Start EdgeOne Pages dev server
npm run build        # Build frontend to dist/
npm run preview      # Preview built frontend
npm run check        # Syntax check functions and build frontend
npm test             # Run Vitest with coverage
```

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
