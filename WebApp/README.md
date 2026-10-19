# FinanceFlow web

Responsive React + TypeScript authentication app for the FinanceTracker API.

## Run locally

From `WebApp`, install dependencies and start the Vite development server:

```sh
npm install
npm run dev
```

The frontend defaults to `http://localhost:8080` when
`VITE_API_BASE_URL` is not set, so sign-in and dashboard requests use the same
local backend. To use another API locally, copy `.env.example` to `.env` and
set `VITE_API_BASE_URL`; Vite does not load `.env.example` automatically.

## Transaction filtering and reports

Advanced Transactions sends the supported type, payment-mode, date-range,
category, and subcategory filters to `GET /api/v1/transactions`, then loads all
pages of the filtered result. Date ranges must include both dates and span no
more than 366 days. The documented endpoint has no description/text-search
parameter, so the text box searches the API results in the browser; choose a
date range to search older transactions. Reports request their selected six
months directly from the same paginated endpoint. Graphs request all pages for
their selected week, month, or year using explicit `from` and `to` dates, so
historical chart totals are based on the selected period rather than a recent
transaction subset.

Reports > Budgets loads and saves category-wide monthly limits through the
authenticated `/api/v1/budget-limits` endpoints. Budget usage is calculated
from the selected report month's transactions and visualized with green,
yellow, orange, and red progress levels.

Navigation and data-fetching screens use a shared animated loading transition
to smooth page changes while their data is prepared. Loading indicators remain
visible for at least 750 ms for a consistent transition, and session restoration
uses its own 3D animation. Currency choices in signup, profile, and account administration cover the runtime's supported ISO 4217
currencies; monetary amounts display the currency's localized symbol. Changing
the account currency labels amounts but does not convert them.

Reports also includes the transaction graphs. Due reminders are kept in their
own feature module and use the authenticated
`GET /api/v1/users/dues/template`,
`GET|POST /api/v1/user/{useruuid}/dues`, and
`PUT|DELETE /api/v1/user/{useruuid}/dues/{duesuuid}` endpoints. Due categories
and subcategories (including their display names and IDs) are loaded from the
server template; create and update requests send `categoryId` and optional
`subCategoryId`. Due amounts use the account currency and the form does not
allow changing it. The form keeps title,
category, amount, and next due date up front; recurrence, reminder timing,
autopay, and optional details are grouped under extra options. Reminders are
shown in due-date order under a compact category filter as clickable
glass-effect cards with a compact summary and detail view. Completed reminders
are separated into a cleared-dues section. Deadlines use red dots when overdue
or within 7 days, yellow dots at 8–30 days, and purple dots beyond 30 days.
In the Android app, users can optionally grant contact access from the due form;
only a selected contact's name and number are saved to a reminder.

Android due details offer **Pay with UPI** for INR reminders with either a UPI
ID or a phone number. The Android system chooser opens a compatible installed
payment app with the recipient, amount, and reminder title prefilled. A phone
number is passed as the UPI payment address when no UPI ID is available; number
resolution depends on the selected UPI app and is best-effort. The app's
`SUCCESS` response is not treated as proof of settlement. Users can submit a
PNG, JPEG, or WebP payment screenshot (up to 10 MB) for review; a submitted
screenshot does not clear the due. Users can mark a due cleared through the
existing full `PUT /api/v1/user/{useruuid}/dues/{duesuuid}` endpoint only after
the recipient confirms receipt. The existing template must expose `COMPLETED`
in its status choices. Desktop and non-Android web views display a UPI QR
payment intent; scanning and recipient resolution depend on the installed UPI
app. A UPI ID is recommended for interoperable QR scanning.

The dues API must accept, persist, and return the optional `payeePhoneNumber`
property in addition to `payeeUpiId`. Add `payeePhoneNumber` to the due request
schema/template and allow it in `POST` and full-replacement `PUT` payloads;
without this backend schema support, contact phone numbers will not survive a
reload.

To persist screenshot proof, add this authenticated endpoint:

```http
POST /api/v1/user/{useruuid}/dues/{duesuuid}/payment-proof
Content-Type: multipart/form-data
```

The multipart field is `file`. The server must verify due ownership, accept
only PNG/JPEG/WebP image files up to 10 MB, store them privately, and return
`201 Created` with `{"status":"PENDING_REVIEW","submittedAt":"<ISO-8601>"}`.
The due-list response should include `paymentProofStatus` and
`paymentProofSubmittedAt` so pending proof remains visible after refresh.
Reject repeat submissions while a proof is pending, or define a replacement
policy explicitly. A screenshot is unverified evidence; it must never cause
the API to change the due status to `COMPLETED`. Payment transfers are
recipient-to-recipient through the selected UPI app; this flow does not use
Razorpay or PayU and does not incur a payment-gateway charge.

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
- In the Android APK, provider sign-in opens the system browser and uses the
  app deep link `com.blackdotorigin.financeflow://auth/callback`. The backend
  must implement the allowlisted redirect and one-time PKCE code exchange
  described in [`../Auth.md`](../Auth.md); the browser-cookie web callback
  alone cannot return a usable session to the Capacitor WebView.
- The access token stays in React memory only. It is not written to local
  storage, session storage, a cookie, or a URL.
- On startup, the app restores its session from the API's persistent refresh
  cookie on both web and Android. The API must allow credentialed requests from
  the frontend origin and issue the cookie as `SameSite=None; Secure` for
  cross-site requests; the refresh-token lifetime is configured by the backend,
  not this frontend. Android also requires the API to allow the Capacitor
  WebView origin and the WebView to allow third-party cookies. The Android
  host explicitly enables cookie acceptance and flushes the WebView cookie
  store when the app is paused, so the refresh cookie is persisted across
  process restarts.

For OAuth and cross-origin password sign-in to work, the API must allow the
frontend origin with credentials, and its refresh cookie/CORS settings must
match the deployment.
