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
