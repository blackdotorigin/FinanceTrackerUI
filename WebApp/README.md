# FinanceFlow web

Responsive React + TypeScript authentication app for the FinanceTracker API.

## Run locally

From `WebApp`, install dependencies and start the Vite development server:

```sh
npm install
npm run dev
```

To use the configured API URL locally, copy `.env.example` to `.env`. Vite does
not load `.env.example` automatically. The frontend defaults to the configured
Render API URL when `VITE_API_BASE_URL` is not set.

## Deploy to Cloudflare Pages

Connect the GitHub repository from **Cloudflare → Workers & Pages → Create
application → Continue to Pages → Import an existing Git repository**. Use
these build settings:

- Framework preset: `React (Vite)`
- Root directory: `WebApp` (case-sensitive)
- Build command: `npm run build`
- Build output directory: `dist`
- Production environment variable: `VITE_API_BASE_URL` =
  `https://financetracker-iulg.onrender.com`

Cloudflare's Git integration deploys the frontend on pushes to its configured
production branch. The GitHub Actions workflow only builds the frontend as a
check and builds the Android APK; it does not deploy the frontend. No
Cloudflare API token or Pages project-name GitHub setting is needed for this
Git-connected deployment. The `public/_redirects` rule is copied into the
build output so direct requests to frontend paths, including `/auth/callback`,
are served by the React app.

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
