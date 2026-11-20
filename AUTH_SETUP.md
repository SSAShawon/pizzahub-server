# Authentication setup

This document records the environment and Google OAuth configuration required by the
PizzaHub auth flow. It does not change any deployed environment automatically.

## Server environment

Set these on the Express API (`.env` locally, hosting provider env vars in production):

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | yes | MongoDB connection string used by Better Auth and all protected routes. |
| `DB_NAME` | no | Database name; defaults to `pizzahub`. |
| `BETTER_AUTH_SECRET` | yes | Signs/verifies auth cookies and tokens. Use a long random value and keep it stable across restarts so sessions are not invalidated. |
| `BETTER_AUTH_URL` | yes | Public origin from which `/api/auth/*` is reached. In the current deployment the frontend rewrites `/api/auth/*` to the API, so this must match the public frontend origin used by the browser, not an internal-only host. |
| `CLIENT_URL` | yes in production | Comma-separated frontend origins allowed by CORS and registered as Better Auth trusted origins, e.g. `https://app.example.com,http://localhost:3000`. |
| `GOOGLE_CLIENT_ID` | for Google | Google OAuth client ID. Google sign-in is disabled when this is absent. |
| `GOOGLE_CLIENT_SECRET` | for Google | Google OAuth client secret. Never place this in frontend code or commit it. |
| `PORT` | no | API port; defaults to `5000`. |
| `NODE_ENV` | no | When `production`, auth cookies get the `Secure` attribute and CORS/trusted origins do not fall back to localhost. |

Example development values (no real secrets):

```env
MONGODB_URI=mongodb://127.0.0.1:27017
DB_NAME=pizzahub
BETTER_AUTH_SECRET=replace-with-a-long-random-secret
BETTER_AUTH_URL=http://localhost:3000
CLIENT_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
PORT=5000
```

For local development, the frontend's `next.config.ts` rewrites `/api/auth/*` to
`http://localhost:5000`, so `BETTER_AUTH_URL` should remain the browser-facing
`http://localhost:3000`. In production, replace these with the real public origins.

## Google Console

1. Create/choose an OAuth client of type **Web application**.
2. Add this authorized redirect URI, using the exact public value of `BETTER_AUTH_URL`:
   `BETTER_AUTH_URL/api/auth/callback/google`
   - Local example: `http://localhost:3000/api/auth/callback/google`
   - Production example: `https://your-frontend-domain/api/auth/callback/google`
3. Add every browser-facing frontend origin to **Authorized JavaScript origins**. These
   should match the comma-separated values in `CLIENT_URL`.
4. Keep `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` only in server-side environment
   variables. Do not add them to `NEXT_PUBLIC_*` variables, frontend code, or Git.

After changing OAuth redirect URIs or trusted origins, wait for the Google Console change
to propagate before retesting Google sign-in.

## Cookie and session behavior

- Auth cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` when `NODE_ENV=production`.
- Browser requests use `credentials: "include"`; the API enables CORS credentials and
  allows only the origins in `CLIENT_URL`.
- Better Auth's cookie cache is disabled. Protected API requests re-read the session and
  re-check the current Mongo user's `role` and `isBlocked`, so a live block affects active
  sessions without waiting for a stale role snapshot.
- Sign-out clears the session cookie and the server-side session record. The client signs
  out blocked users before redirecting them to `/login?blocked=1`.
- New Better Auth users are forced to `role: "customer"` and `isBlocked: false`. Vendor
  promotion happens only in the authenticated vendor restaurant-registration route.
  There is no public admin registration path; admin accounts must be provisioned directly
  in MongoDB.

## Tests

```bash
# from pizzahub-server
npm test                 # password policy unit tests
npm run test:auth        # integration tests; requires the API running locally
```

`npm run test:auth` refuses to run when `NODE_ENV=production` and creates/deletes its own
temporary users.
