# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
# Python deps
uv sync

# Frontend
cd frontend && npm install && npm run build

# Run server (serves API + built frontend)
cd backend && uv run uvicorn app.main:app --reload

# Frontend dev with hot reload (proxies /api to localhost:8000)
cd frontend && npm run dev

# Tests (requires PostgreSQL running locally)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/porchsongs_test" uv run pytest  # backend
cd frontend && npx vitest run                                # frontend unit
cd e2e && npx playwright test                                # e2e (starts servers automatically)

# Lint & type check
uv run ruff check backend/
uv run ruff format backend/
cd frontend && npx eslint src/
cd frontend && npm run typecheck

# Database migrations
uv run alembic upgrade head
uv run alembic revision --autogenerate -m "description"
```

## Architecture

**FastAPI backend** (`backend/app/`) serves a **React 19 + TypeScript frontend** (`frontend/src/`) built with Vite. In production, FastAPI serves the built `frontend/dist/` as static files. In development, Vite proxies `/api` requests to the backend.

### Frontend Routing

React Router (`react-router-dom`) with `BrowserRouter`. App routes live under `/app/*`:

- `/app/rewrite`, `/app/library`, `/app/library/:id`, `/app/settings/:tab`, `/app/login`
- Premium marketing pages at root: `/`, `/pricing`, `/about`, `/how-to`, `/how-to/:slug`
- OSS mode: `/` redirects to `/app`

Key layers:
- **`AuthContext`** (`src/contexts/AuthContext.tsx`): Auth state, login/logout. Wraps entire app.
- **`AppShell`** (`src/layouts/AppShell.tsx`): Auth-gated layout for `/app/*`. Holds app state (profile, rewrite, LLM settings) and passes to children via `useOutletContext<AppShellContext>()`.
- **`MarketingLayout`** (`src/layouts/MarketingLayout.tsx`): Marketing nav/footer (premium only).

SEO meta injection (premium): `premium/porchsongs_premium/seo.py` injects route-specific meta tags into `index.html` server-side.

### Auth

Plugin architecture in `backend/app/auth/`. **OSS is auth-free**: `get_current_user` auto-creates and returns a single local user (`local@porchsongs.local`). No login required. Premium adds Google OAuth via `PREMIUM_PLUGIN` env var, overriding `get_current_user` with JWT validation. JWT tokens, refresh tokens, rate limiting, and login/logout endpoints all live in the premium layer. Every data endpoint uses `Depends(get_current_user)` with `user_id` filtering. The auth ABC (`AuthBackend`), token utilities, and rate limiter remain in OSS for premium to import.

### LLM Integration

All LLM calls go through `any-llm-sdk`. API keys from server env vars. Two modes: **Parse** (clean up + identify title/artist, SSE streaming) and **Chat** (multi-turn iterative edits, SSE streaming). All LLM functions must be `async` using `acompletion`/`alist_models`.

### SSE Streaming

Always add `Cache-Control: no-cache` and `X-Accel-Buffering: no` headers. Never use Starlette's `BaseHTTPMiddleware` for SSE. Use pure ASGI middleware instead.

### Data Model

PostgreSQL everywhere (production and tests). Alembic migrations in `alembic/`. Song lifecycle: paste → parse → auto-save draft → iterate via chat → completed. Songs organized into folders. PDF export via `fpdf2`.

## Frontend Development

### Playwright MCP Plugin

**All frontend development should use the Claude Playwright MCP plugin** to visually verify changes in a real browser. After making UI changes:

1. Start the dev server (`cd frontend && npm run dev`)
2. Use the Playwright MCP tools to navigate to the relevant page and take screenshots
3. Visually confirm the layout, styling, and interactions match expectations
4. Use this workflow for iterating on CSS, component structure, and responsive design

This is especially important for marketing pages, layout changes, and any visual work where unit tests alone cannot catch regressions. The Playwright plugin provides `browser_navigate`, `browser_screenshot`, `browser_click`, and other tools to interact with the running app.

#### Browser installation (sandbox)

The Playwright MCP plugin expects Chrome at `/opt/google/chrome/chrome`, which isn't present in the sandbox. Install Chromium manually:

```bash
# Install system dependencies first
apt-get update -qq && apt-get install -y -qq \
  libasound2t64 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 \
  libgbm1 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libx11-xcb1 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxshmfence1

# Install Playwright's Chromium (ARM64-compatible)
cd main && npx playwright install chromium

# Symlink to the location the MCP plugin expects
mkdir -p /opt/google
ln -sf /root/.cache/ms-playwright/chromium-1208/chrome-linux /opt/google/chrome
```

The chromium version number (`1208`) may change. Check `ls /root/.cache/ms-playwright/` after install.

#### Sandbox requires --no-sandbox

Running as root in the sandbox means Chromium refuses to launch with sandboxing enabled. The MCP plugin config needs `--no-sandbox` added to the args:

Edit both MCP config files under `/root/.claude/plugins/cache/claude-plugins-official/playwright/*/.mcp.json`:

```json
{
  "playwright": {
    "command": "npx",
    "args": ["@playwright/mcp@latest", "--no-sandbox"]
  }
}
```

**This config change requires restarting Claude Code** because the MCP server is already running. If you can't restart, use the direct Playwright API approach below instead.

#### Direct Playwright scripts (bypass MCP plugin entirely)

When the MCP plugin won't launch (sandbox, can't restart), drive Playwright directly via Node.js. This uses `playwright-core` which is already installed as a dependency of the e2e tests.

```js
node -e "
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: false,
    executablePath: '/root/.cache/ms-playwright/chromium-1208/chrome-linux/chrome'
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://localhost:5173/app');
  await page.waitForTimeout(2000);

  // Take screenshots
  await page.screenshot({ path: '/tmp/screenshot.png', fullPage: true });   // full page
  await page.screenshot({ path: '/tmp/viewport.png', fullPage: false });    // viewport only

  // Measure layout dimensions
  const dims = await page.evaluate(() => ({
    bodyScrollHeight: document.body.scrollHeight,
    windowInnerHeight: window.innerHeight,
    scrollableAmount: document.documentElement.scrollHeight - window.innerHeight,
    headerHeight: document.querySelector('header')?.offsetHeight,
  }));
  console.log(JSON.stringify(dims, null, 2));

  // Interact with elements
  await page.getByText('Edit in Rewrite').click();
  await page.getByRole('button', { name: 'Your Version' }).click();

  // Scroll and capture
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.screenshot({ path: '/tmp/scrolled.png', fullPage: false });

  await browser.close();
})();
"
```

Key options:
- `chromiumSandbox: false` is required when running as root
- `viewport: { width, height }` is set on `browser.newPage()`, not launch
- `fullPage: true` vs `false` on `screenshot()`: full-page captures the entire scrollable content; false captures only the viewport (useful for spotting overflow)
- Use `page.evaluate()` to measure DOM dimensions, scrollable amounts, element heights
- Read screenshots with the `Read` tool to visually inspect them (Claude can see images)

#### Layout debugging techniques

1. **Compare fullPage vs viewport screenshots**: if fullPage is taller, the page has scroll overflow
2. **Measure exact overflow**: `document.documentElement.scrollHeight - window.innerHeight`
3. **Measure individual elements**: `document.querySelector('header')?.offsetHeight`
4. **Test multiple viewports**: create separate browser instances for desktop (1280x900) and mobile (390x844)
5. **Use `page.setViewportSize()`** to resize without relaunching the browser
6. **Scroll and screenshot** to see what gets hidden: `page.evaluate(() => window.scrollTo(0, N))`

#### Starting the app for visual testing

```bash
# From the repo root, start backend (requires PostgreSQL running locally)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/porchsongs_test" uv run alembic upgrade head
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/porchsongs_test" uv run uvicorn app.main:app --host 0.0.0.0 --port 8000 &

# Start frontend dev server
cd frontend && npm run dev -- --host 0.0.0.0 --port 5173 &

# Create test data via API (no auth required in OSS mode without APP_SECRET)
curl -s http://localhost:8000/api/profiles  # get profile_id (usually 1)
curl -s -X POST http://localhost:8000/api/songs \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Song","artist":"Test","content":"[G]Hello [C]World","original_content":"Hello World","rewritten_content":"[G]Hello [C]World","profile_id":1}'
```

Then navigate to `/app/library/1` to view the song, and click "Edit in Rewrite" to enter the workshop two-pane view.

### E2E Tests

Playwright e2e tests live in `e2e/oss/` and `e2e/premium/`. The `playwright.config.ts` auto-starts backend servers on ports 8765 (OSS) and 8766 (premium). Run with `cd e2e && npx playwright test`.

### Design System

Tailwind CSS v4 with `@theme` tokens in `src/index.css`:
- **Colors**: Use `--color-*` tokens, never hardcode hex values
- **Fonts**: `font-mono` / `font-ui` from `@theme`
- **UI primitives**: Always use components from `src/components/ui/` (`Button`, `Input`, `Card`, etc.) instead of raw HTML
- **Class names**: Use `cn()` from `@/lib/utils` for conditional classes, not template literals
- **Cascade layers**: All custom CSS must be inside `@layer base { ... }`. Unlayered CSS silently overrides Tailwind utilities

### Content & Copy

- **Never use em dashes** (`—` or `&mdash;`) in user-facing content, comments, titles, or copy. They are a telltale sign of AI-generated text. Use periods, commas, colons, or pipes instead.

### Code Conventions

- `@/` path aliases for all imports. Types in `src/types.ts`.
- `STORAGE_KEYS` from `src/api.ts` for all localStorage keys
- `_fetch<T>()` for JSON endpoints, `_streamSse<T>()` for SSE streaming
- `aria-label` on all icon-only buttons
- `dvh` (not `vh`) for viewport height

## Testing

Backend: PostgreSQL with session-scoped engine, tables truncated between tests for isolation. Mock LLM calls via `AsyncMock` on `app.services.llm_service.acompletion`. Auth tests use `auth_client` fixture without `get_current_user` override.

Frontend: Vitest + React Testing Library. Use `renderWithRouter()` from `src/test/test-utils.tsx` for components using React Router.

## Definition of Done

### Test Requirements

**Bug fixes must include a test** that reproduces the bug and verifies the fix. Feature changes should include tests for new behavior. If an existing test file covers the component/module, add tests there; otherwise create a new `*.test.ts(x)` file following existing patterns.

### Checks

Every change must pass all checks before it's considered complete:

```bash
uv run ruff check backend/                    # backend lint
uv run ruff format --check backend/           # backend formatting
cd frontend && npx eslint src/                # frontend lint
cd frontend && npm run typecheck              # TypeScript type check
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/porchsongs_test" uv run pytest  # backend tests
cd frontend && npx vitest run                 # frontend tests
```

### PR Submissions with UI Changes

PRs that include frontend/UI changes must attach a **Playwright-recorded video** (`.webm`) in the PR description demonstrating the change. This ensures reviewers can visually verify layout, styling, and interactions without pulling the branch locally.

#### How to record

Use a short Playwright script to record a `.webm` video of the relevant workflow. This uses `playwright-core` which is already installed as a dependency of the e2e tests.

```bash
# Start the dev server first
cd frontend && npm run dev &
```

```js
node -e "
const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: false,
    executablePath: '/root/.cache/ms-playwright/chromium-1208/chrome-linux/chrome'
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    recordVideo: { dir: 'test-results/', size: { width: 1280, height: 900 } }
  });
  const page = await context.newPage();

  // Navigate and interact with the UI change you're demonstrating
  await page.goto('http://localhost:5173/app');
  await page.waitForTimeout(2000);

  // ... add interactions that demonstrate the change ...

  await context.close();  // video is saved on context close
  await browser.close();
  console.log('Video saved to test-results/');
})();
"
```

#### Where videos land

Videos are saved to `test-results/` as `.webm` files. The filename is auto-generated by Playwright.

#### Attaching to the PR

**Option A (inline playback):** Drag the `.webm` file into the PR description editor on GitHub. This is the only way to get inline video playback (GitHub reserves it for `user-attachments/assets/` URLs).

**Option B (download link):** Use the upload script to attach the video as a release asset and post a PR comment with a download link:

```bash
./scripts/upload-pr-video.sh <pr-number> <path-to-video.webm>
```

The script uploads the video to the `ci-assets` pre-release and posts a comment on the PR. The video renders as a download link (not inline player).

**For AI agents:** Always use Option B after creating a PR with UI changes. The script handles release asset upload and PR commenting automatically. Example workflow:

```bash
# 1. Record the video (see "How to record" above)
# 2. Find the video file
VIDEO_FILE=$(ls -t test-results/*.webm 2>/dev/null | head -1)
# 3. Upload and comment on the PR
./scripts/upload-pr-video.sh 123 "$VIDEO_FILE"
```

## Sandbox Tips

### Pre-commit hooks

`pre-commit` is not installed in the sandbox. Run hook commands directly instead:

```bash
# Ruff lint + format
uv run ruff check backend/
uv run ruff format --check backend/

# OpenAPI types freshness (regenerate and verify)
uv run python scripts/export_openapi.py frontend/openapi.json
cd frontend && npm run generate:api
cd frontend && npm run typecheck

# Frontend checks
cd frontend && npm run typecheck
cd frontend && npx eslint src/
cd frontend && npx vitest run

# Backend tests (requires PostgreSQL running locally)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/porchsongs_test" uv run pytest -x -q
```

### Git operations

Git works normally. Push access is configured via `gh` auth.

### Ephemeral directories

`target/`, `node_modules/`, and `.venv/` don't persist between sessions. Run `uv sync` and `npm install` at the start of each session if needed.

### Fixing broken git worktrees

Git worktrees store absolute paths. When a worktree is created on the host (e.g. `/Users/you/scm/porchsongs/...`) and the sandbox mounts the same tree at `/workspace/porchsongs/...`, the cross-references between the main repo and its worktrees break. Fix by rewriting the paths:

```bash
HOST_PREFIX="/Users/you/scm/porchsongs"   # adjust to match your host
SANDBOX_PREFIX="/workspace/porchsongs"

# Fix main repo -> worktree references
sed -i "s|$HOST_PREFIX|$SANDBOX_PREFIX|g" .git/worktrees/*/gitdir 2>/dev/null

# Fix worktree -> main repo back-references
find .claude/worktrees -maxdepth 2 -name ".git" -type f \
  -exec sed -i "s|$HOST_PREFIX|$SANDBOX_PREFIX|g" {} \; 2>/dev/null

# Verify
git worktree list   # should show /workspace/... paths
```

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

## Key Constraints

- **TypeScript** strict mode with `noUncheckedIndexedAccess`
- **Ruff rules**: `E, F, I, UP, B, SIM, ANN, RUF` with `B008` ignored. All backend code requires type annotations.
- **Config**: `Settings` uses `extra="ignore"` so arbitrary env vars don't crash startup
- **Auth**: Every data endpoint requires `Depends(get_current_user)`. Use `get_user_profile()` / `get_user_song()` for ownership checks.
