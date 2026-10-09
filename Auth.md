# Authentication guide for the frontend

This document describes the authentication behavior currently implemented by
the FinanceTracker API. The examples use `http://localhost:8080` as the API
base URL; replace it with the deployed API URL in each environment.

## Overview

- The API issues short-lived JWT access tokens and returns them in JSON.
- The API sets a long-lived refresh token in an `HttpOnly` cookie.
- Send the access token as `Authorization: Bearer <accessToken>` when calling
  protected API endpoints.
- Use the refresh endpoint to get a new access token when the current one
  expires.
- Password signup creates an account but does not log the user in. Call login
  after a successful signup.
- Google and GitHub use browser redirects through the API's OAuth endpoints.
  The frontend sends successful OAuth flows to `/auth/callback` and exchanges
  the refresh cookie for an access token.

The default access-token lifetime is 15 minutes and the default refresh-token
lifetime is 30 days. These values are configurable by the backend.

## Username and password

### Sign up

`POST /api/v1/users`

Request:

```json
{
  "email": "alex@example.com",
  "username": "alex",
  "password": "at-least-8-characters",
  "fullName": "Alex Example",
  "defaultCurrency": "USD"
}
```

Fields and validation:

| Field | Required | Validation |
| --- | --- | --- |
| `email` | Yes | Valid email address |
| `username` | Yes | 3–50 characters |
| `password` | Yes | 8–72 characters |
| `fullName` | Yes | Up to 150 characters |
| `defaultCurrency` | No | Three uppercase letters, e.g. `USD` |

Success: `201 Created`, with a user object:

```json
{
  "id": "user-uuid",
  "email": "alex@example.com",
  "username": "alex",
  "fullName": "Alex Example",
  "defaultCurrency": "USD",
  "createdAt": "2026-01-01T12:00:00Z"
}
```

Signup does not return tokens or set a refresh cookie. After success, send the
user to the login form or log in by calling the login endpoint.

### Log in

`POST /api/v1/auth/login`

Request:

```json
{
  "username": "alex",
  "password": "at-least-8-characters"
}
```

The `username` field must contain the account's username; email login is not
implemented. The server trims and lowercases the username before authentication.

Success: `200 OK`, an access-token response, and a `Set-Cookie` response header
for the refresh token:

```json
{
  "accessToken": "<jwt>",
  "tokenType": "Bearer",
  "expiresIn": 900
}
```

The refresh token is **not** included in the JSON response. It is set as an
`HttpOnly` cookie named `refresh_token`, scoped to `/api/v1/auth`. Frontend
JavaScript must not try to read or persist this cookie.

### Authenticated requests

Attach the access token to protected API requests:

```http
Authorization: Bearer <accessToken>
```

For example, load the current user's profile with:

```http
GET /api/v1/users/me
Authorization: Bearer <accessToken>
```

The response is the user object described above. Do not put access tokens in
URLs or log them.

### Refresh an access token

`POST /api/v1/auth/refresh`

The browser must send the refresh cookie. The API rotates the refresh token and
returns a new access token in the same JSON shape as login, along with a newly
set refresh cookie. Refresh tokens are single-use: replace the current
access-token value with the returned one.

### Log out

`POST /api/v1/auth/logout`

Send the refresh cookie. The API revokes that refresh token and clears the
cookie. A successful logout returns `204 No Content`. Clear the in-memory
access token in the UI as well.

## Google and GitHub sign-in

OAuth is a full-page browser redirect, not a JSON request from `fetch`.

Start the provider flow by navigating the browser to one of these API URLs:

```text
GET http://localhost:8080/oauth2/authorization/google
GET http://localhost:8080/oauth2/authorization/github
```

The backend handles the provider callback at:

```text
GET http://localhost:8080/login/oauth2/code/google
GET http://localhost:8080/login/oauth2/code/github
```

The callback is handled by the backend; the frontend should not implement it.
The backend requires a verified provider email. A first-time OAuth user is
created automatically. If a user account already exists with that email, the
provider identity is associated with it. OAuth-created accounts receive a
generated username, so the UI should not assume the provider login name is the
FinanceTracker username.

## OAuth frontend integration status (historical)

**The current OAuth success flow does not complete a usable frontend login.**
After a successful provider login, the backend:

1. Creates or finds the FinanceTracker user.
2. Sets the refresh-token cookie.
3. Redirects to a hard-coded `http://localhost:8080/api/v1/users/me` URL.

It does not return or otherwise provide the access JWT to the frontend, and
`/api/v1/users/me` requires a Bearer access token. Consequently, the UI cannot
reliably finish login or make authenticated API requests after OAuth. The
hard-coded redirect also does not use the configured frontend URL.

Before enabling Google/GitHub login in the UI, the backend OAuth success flow
needs a frontend-compatible completion mechanism. One option is to redirect to
a frontend callback route and have that route call
`POST /api/v1/auth/refresh` with credentials to exchange the refresh cookie for
an access token. The backend must redirect to the configured frontend URL, and
the deployed frontend/API cookie and CORS settings must allow that request.
Do not put the access or refresh token in a redirect URL.

OAuth failure redirects are also not currently a stable frontend contract:
the handler appends an error code to `/login` without an `error` query
parameter. Do not rely on parsing a specific error query string until the
backend failure redirect is corrected.

The frontend now expects the corrected backend success flow to redirect to the
configured frontend URL at `/auth/callback`, with the refresh cookie set. The
callback calls `POST /api/v1/auth/refresh` with credentials. This replaces the
earlier behavior described above; access and refresh tokens must not be placed
in redirect URLs.

## Frontend request and cookie handling

For login and signup, send JSON with `Content-Type: application/json`. Password
login must use `credentials: "include"` so the browser accepts the refresh
cookie when the frontend and API are cross-origin:

```js
fetch(`${API_BASE_URL}/api/v1/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
  credentials: "include"
});
```

Use `credentials: "include"` for refresh and logout too, so the browser sends
the refresh cookie:

```js
fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
  method: "POST",
  credentials: "include"
});
```

Use `credentials: "include"` for logout as well. The backend CORS configuration
allows the configured frontend origin, credentials, and the `Authorization` and
`Content-Type` headers. The frontend origin must exactly match the backend's
configured `FRONTEND_URL`.

The refresh cookie is `HttpOnly`, `SameSite=Lax`, and its `Secure` attribute is
controlled by backend configuration. Production deployments should use HTTPS
and enable secure cookies. Do not use the backend's local-only development
settings as production auth configuration.

## Common errors

- Invalid username or password: `401 Unauthorized`.
- Missing, invalid, expired, or revoked refresh token: `401 Unauthorized`.
- Login and refresh unauthorized responses use a Problem Details response with
  a `detail` message. The UI should show a generic authentication error rather
  than depend on exact server wording.
- Signup validation failures indicate invalid field values. Duplicate email or
  username is rejected; the exact duplicate-error response should not be treated
  as a stable frontend contract yet.

## Quick flow summary

```text
Sign up:
  POST /api/v1/users
  -> show login screen (signup does not issue tokens)

Password login:
  POST /api/v1/auth/login
  -> keep accessToken in app memory
  -> browser stores HttpOnly refresh_token cookie

Authenticated API call:
  Authorization: Bearer <accessToken>

Access token expired:
  POST /api/v1/auth/refresh with credentials: "include"
  -> replace accessToken with returned token

Log out:
  POST /api/v1/auth/logout with credentials: "include"
  -> clear app's accessToken

Google/GitHub:
  navigate to /oauth2/authorization/{google|github}
  -> backend callback sets refresh cookie and redirects to frontend /auth/callback
  -> frontend calls POST /api/v1/auth/refresh
```
