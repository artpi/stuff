# stuff

Mobile-first home inventory app backed by a user-owned Google Sheet and Google
Drive folder. The app is intentionally static: there is no production build step
and no backend.

Production URL: `https://stuff.piszek.com`

## Local development

Requirements:

- Node.js 20 or newer

Start the local dev server:

```bash
npm start
```

The app runs at:

```text
http://localhost:4173
```

To use a different port:

```bash
PORT=5000 npm start
```

The dev server serves files directly from the repository root and falls back to
`index.html` for app routes.

## Project layout

- `index.html` - main app shell.
- `privacy.html` - privacy page required by Google OAuth configuration.
- `SKILL.md` - public agent instructions for operating an authorized inventory directly through Google Sheets and Drive.
- `llms.txt` - lightweight machine-readable discovery pointer to the agent instructions.
- `manifest.webmanifest` - PWA manifest.
- `sw.js` - service worker for same-origin shell assets.
- `CNAME` - GitHub Pages custom domain.
- `assets/icons/` - PWA, maskable, and Apple touch icons.
- `styles/` - global CSS.
- `src/config.js` - public app config, including Google OAuth client ID, Picker
  API key, project number, app version, and allowed origins.
- `src/services/` - Google auth, Google REST API helpers, and local storage.
- `src/data/` - Sheet database schema and migration registry.
- `src/search/` - local inventory search index.
- `tests/` - Node test files.
- `scripts/dev-server.mjs` - local static dev server.
- `scripts/check.mjs` - static and security checks.
- `docs/prd.md` - product requirements and implementation contract.

## Google Cloud setup

The Google Cloud project is:

```text
Project ID: piszek-stuff
Project number: 1564650092
```

The browser-visible Google configuration lives in `src/config.js`:

```js
export const GOOGLE_CONFIG = Object.freeze({
  clientId: '...',
  pickerApiKey: '...',
  projectNumber: '...',
});
```

These values identify the public browser client and are not server secrets. Do
not commit or use an OAuth client secret in this app.

Required Google Cloud configuration:

- Enable Google Drive API, Google Sheets API, and Google Picker API.
- Configure Google Auth Platform as an external app named `stuff`.
- Homepage: `https://stuff.piszek.com`.
- Privacy page: `https://stuff.piszek.com/privacy.html`.
- Authorized domain: `piszek.com`.
- OAuth scope: `https://www.googleapis.com/auth/drive.file` only.
- OAuth application type: Web application.
- Authorized JavaScript origins:
  - `https://stuff.piszek.com`
  - `http://localhost:4173`
- Authorized redirect URIs: leave empty.
- Picker API key restrictions:
  - API restriction: Google Picker API only.
  - Website referrers:
    - `https://stuff.piszek.com/*`
    - `http://localhost:4173/*`

During OAuth testing, add the household Google accounts as test users.

## Checks

Run the test suite:

```bash
npm test
```

Run static and security checks:

```bash
npm run check
```

## Deployment

The app is designed for GitHub Pages. Production serves the static files in this
repository directly, using `CNAME` for `stuff.piszek.com`.
