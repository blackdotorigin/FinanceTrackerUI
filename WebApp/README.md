# FinanceFlow web

Responsive React + TypeScript authentication app for the FinanceTracker API.

## Run locally

From `WebApp`, install dependencies and start the Vite development server:

```sh
npm install
npm run dev
```

Set `VITE_API_BASE_URL` in a local `.env` file if the API is not running at
`http://localhost:8080`. See `.env.example`.

## Deploy to Cloudflare Pages

Create a Cloudflare Pages project with the project name you intend to use, then
configure these GitHub repository settings under **Settings → Secrets and
variables → Actions**:

- Secret `CLOUDFLARE_API_TOKEN` with the Cloudflare Pages **Edit** permission.
- Secret `CLOUDFLARE_ACCOUNT_ID`.
- Variable `CLOUDFLARE_PAGES_PROJECT_NAME` matching the Pages project name.
- Optionally, variable `VITE_API_BASE_URL` to override the default backend
  `https://financetracker-iulg.onrender.com`.

The workflow in `.github/workflows/deploy-and-build.yml` builds the Vite app
and deploys it on pushes to `main`. Pull requests run the builds but do not
deploy. Vite embeds `VITE_API_BASE_URL` in the production build; do not commit a
production `.env` file. The `public/_redirects` rule is copied into the build
output so direct requests to frontend paths, including `/auth/callback`, are
served by the React app.

The same workflow builds a debug Android APK and uploads it as the
`financeflow-debug-apk` workflow artifact. To download it, open the successful
workflow run in the repository's **Actions** tab and download that artifact.
Extract the downloaded ZIP to get `app-debug.apk`, then transfer it to the
phone and open it to install. Android may ask you to allow installs from the
browser or file manager you used. The APK is debug-signed for direct testing;
publishing through Google Play requires a properly signed release build.

Cloudflare Pages hosts the static web build directly; it does not require a
Docker image. Both the web build and APK use the Render backend by default.
`VITE_API_BASE_URL` can override it; use a publicly reachable URL, since
`localhost` on an Android phone refers to the phone itself.

## Authentication behavior

- Sign-in sends `POST /api/v1/auth/login` with JSON and `credentials: "include"`.
- Account creation sends `POST /api/v1/users`. Signup does not sign users in;
  after success, sign in with the new username and password.
- Google and GitHub sign-in use full-page redirects to the API's OAuth
  authorization endpoints. The API should redirect successful OAuth logins to
  the frontend route `/auth/callback`; the callback exchanges the HttpOnly
  refresh cookie for an access token through `POST /api/v1/auth/refresh`.
- The access token stays in React memory only. It is not written to local
  storage, session storage, a cookie, or a URL.

For OAuth and cross-origin password sign-in to work, the API must allow the
frontend origin with credentials, and its refresh cookie/CORS settings must
match the deployment.
