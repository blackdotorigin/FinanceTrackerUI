# Deploy the frontend to Cloudflare Pages

The frontend is prepared for Cloudflare Pages, but adding a GitHub Actions
workflow does not itself mean the site has been deployed. The workflow deploys
when it runs successfully on `main` and the Cloudflare project and GitHub
settings below are configured.

## One-time setup

### 1. Create a Cloudflare Pages project

In the Cloudflare dashboard, open **Workers & Pages**, create a Pages project
using **Direct Upload**, and choose a project name. The GitHub Actions workflow
will upload the built site to this project. Do not also enable a separate
Cloudflare Git build for the same project; this repository's workflow handles
building and uploading.

### 2. Add GitHub repository settings

In the GitHub repository, open **Settings → Secrets and variables → Actions**.
Add:

**Repository secrets**

- `CLOUDFLARE_API_TOKEN` — a Cloudflare API token with permission to edit
  Cloudflare Pages.
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account ID that owns the Pages
  project.

**Repository variables**

- `CLOUDFLARE_PAGES_PROJECT_NAME` — the exact project name created in
  Cloudflare.
- `VITE_API_BASE_URL` is optional. If omitted, the workflow uses
  `https://financetracker-iulg.onrender.com`. Set it only if you want to
  override that backend URL.

Do not put the API token or account ID in repository variables, source files,
or committed `.env` files.

## Deploy

The workflow is [`.github/workflows/deploy-and-build.yml`](./.github/workflows/deploy-and-build.yml).

- A push to `main` builds the frontend, deploys it to Cloudflare Pages, and
  also runs the Android APK build.
- A pull request targeting `main` runs the builds but does not deploy.
- To deploy without a new code change, go to the repository's **Actions** tab,
  select **Build and deploy**, choose **Run workflow**, select `main`, and
  start it.

The Pages build uses `WebApp` as its project root, runs `npm ci` and
`npm run build`, then uploads `WebApp/dist`. The frontend API URL is embedded
at build time. The `WebApp/public/_redirects` file enables direct navigation
to frontend routes such as `/auth/callback`.

## Check whether it deployed

1. Open the repository's **Actions** tab and select the latest **Build and
   deploy** run for `main`.
2. In the run summary, confirm the **deploy-pages** job completed successfully.
   A successful build alone is not proof of deployment.
3. In Cloudflare, open **Workers & Pages → your Pages project → Deployments**
   and confirm a recent **Production** deployment completed successfully.
4. Open the `*.pages.dev` URL shown for the production deployment. Confirm the
   app loads, then refresh a frontend route directly to check SPA routing.
5. Try signing in or loading data to check the API integration. The Render API
   must allow requests from the Pages origin with the appropriate CORS and
   credentials settings.

If there is no workflow run, push or merge a change to `main` or manually run
the workflow. If `build-web` succeeds but `deploy-pages` fails, check that the
Cloudflare secrets and project-name variable exist, the project already
exists, and it belongs to the account identified by `CLOUDFLARE_ACCOUNT_ID`.
If a `main` run reports missing secrets or variables, configure them and
re-run it.
