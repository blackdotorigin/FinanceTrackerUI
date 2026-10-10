# Deploy the frontend to Cloudflare Pages

The frontend is prepared for Cloudflare Pages, but adding a GitHub Actions
workflow does not itself mean the site has been deployed. The workflow deploys
when it runs successfully on `main` and the Cloudflare project and GitHub
settings below are configured.

## One-time setup

### 1. Connect a Cloudflare Pages project to GitHub

In the Cloudflare dashboard, open **Workers & Pages → Create application →
Continue to Pages → Import an existing Git repository**. Connect
`blackdotorigin/FinanceTrackerUI` and select the branch to deploy (normally
`main`). This creates a Cloudflare Pages project connected to GitHub. Cloudflare
will build and deploy the frontend when changes are pushed to that branch.

Configure the build:

- Framework preset: **React (Vite)**
- Root directory: **`WebApp`** (case-sensitive)
- Build command: **`npm run build`**
- Build output directory: **`dist`**
- Production environment variable: `VITE_API_BASE_URL` =
  `https://financetracker-iulg.onrender.com`

The Pages project name is chosen during creation. It does not need to match the
existing `financetrackerui.blackdotorigin.workers.dev` Worker.

### 2. GitHub Actions settings

The GitHub Actions workflow still builds the frontend as a check and builds
the Android APK, but **does not deploy the frontend**. Cloudflare's Git
integration is the only frontend deployment path, so there are no Cloudflare
API token, account ID, or Pages project-name GitHub secrets/variables required
for this workflow. You can optionally add `VITE_API_BASE_URL` as a GitHub
Actions variable to override the backend URL when building the APK.

## Deploy

The workflow is [`.github/workflows/deploy-and-build.yml`](./.github/workflows/deploy-and-build.yml).

- Push or merge changes to the configured production branch. Cloudflare
  automatically builds and deploys the frontend.
- GitHub Actions independently runs the frontend build check and creates an
  Android APK; its status does not control the Cloudflare deployment.
- The frontend API URL is embedded at build time. The
  `WebApp/public/_redirects` file enables direct navigation to frontend routes
  such as `/auth/callback`.

## Check whether it deployed

1. In Cloudflare, open **Workers & Pages → your Pages project → Deployments**
   and confirm the latest **Production** deployment completed successfully.
2. Open the `*.pages.dev` URL shown for the production deployment. Confirm the
   app loads, then refresh a frontend route directly to check SPA routing.
3. Try signing in or loading data to check the API integration. The Render API
   must allow requests from the Pages origin with the appropriate CORS and
   credentials settings.

If no Cloudflare deployment appears, check that the Pages project is connected
to the correct repository and production branch, and that its root directory
is exactly `WebApp` (capitalization matters).
