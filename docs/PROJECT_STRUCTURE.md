# Project Structure

This repository keeps the Git tree small and aligned with EdgeOne Pages conventions. Runtime output, local credentials, IDE files, and temporary notes are ignored.

## Top Level

```text
edgeoneapi/
├── edge-functions/   # EdgeOne Pages Functions
├── lib/              # Shared backend logic
├── src/              # Vue frontend
├── public/           # Static assets and SPA redirects
├── tests/            # Vitest tests
├── docs/             # Documentation
├── index.html        # Vite entry
├── package.json      # Scripts and dependencies
├── vite.config.js    # Vite/Vitest config
└── README.md         # Project entry document
```

## Backend

```text
edge-functions/
├── api/
│   └── [[default]].js          # /api/admin/* routes
└── v1/
    ├── chat/
    │   └── completions.js      # POST /v1/chat/completions
    └── models.js               # GET /v1/models
```

Shared behavior lives in `lib/shared.js`, including API key validation, channel selection, failover, circuit breaker state, rate limiting, usage logging, and admin routing.

## Frontend

```text
src/
├── pages/
│   ├── ChatPage.vue
│   └── admin/
│       ├── AdminLayout.vue
│       ├── ChannelsPage.vue
│       ├── HealthPage.vue
│       └── UsersPage.vue
├── services/
│   └── api.js
├── App.vue
├── main.js
├── router.js
└── styles.css
```

## Tests

```text
tests/
├── api-service.test.js
├── shared.test.js
└── helpers/
    └── kv.js
```

## Git Ignore Policy

Keep these out of Git:

```text
.env
.edgeone/
dist/
node_modules/
.idea/
.vscode/
*.log
qa-screenshots/
*SUMMARY*.md
*TODO*.md
```

The committed tree should contain source code, tests, essential documentation, and deploy configuration only.
