# BusinessMode · Next.js Todo demo

A public, database-free reference app: start a guest session, redeem a real
BusinessMode access code, and edit a small to-do list stored in your browser.
The server installs `@businessmode/sdk@0.1.0-preview.2` from the public npm registry. There is no simulated
access mode in the deployed app.

## Try the hosted demo

Open [demo.businessmode.io](https://demo.businessmode.io/), select **Start demo**,
then **Redeem code** (the demo code is prefilled). Add a task, complete it, reload,
and reset. To see a rejection, edit the code before redeeming; **Restore demo code**
returns to the working value. Technical details are collapsed under “For developers”.

## Architecture

| Part | Responsibility |
| --- | --- |
| Browser | Renders the app and keeps up to 30 tasks in `localStorage` |
| Next.js server routes | Issues signed guest cookies; calls BusinessMode with a private machine key |
| Existing BusinessMode API | Redeems codes and evaluates entitlements, seats and license windows |

No separate application database, auth provider or persistent disk is required.
The hosted demo runs on Coolify against the BusinessMode staging API. You can
run the same Next.js app locally or on another Node.js host.

Before each task change the UI calls `/api/demo/authorize`, which checks
`todo:write` through BusinessMode. It then updates its own local list. **Local
tasks are not a protected server resource:** visitors can edit browser storage
or bypass the UI. This demonstrates the SDK and real access decisions, not
secure storage of shared application data. In a real product, perform the
protected operation on the server immediately after checking access.

Tasks do not sync across devices. Clearing site data removes them. If storage
is disabled, editing still works in memory with a notice that reload loses
changes. Multiple tabs may overwrite each other's edits; this is not a
collaborative task app.

## Run locally

Use Node.js 24 or 26 and npm.

```sh
git clone https://github.com/Friggies/businessmode-demo.git
cd businessmode-demo
npm ci
cp .env.example .env.local
# Fill the server environment below, then:
npm run dev
```

Open `http://localhost:3000`. Without configuration, the page shows a setup
notice and keeps redemption disabled; it does not pretend to grant access.

## Configure BusinessMode

Use a **dedicated demo Project**, separate from customer data:

1. Create the `todo:write` entitlement, a demo Organization, and an active
   License granting that entitlement. Set a finite seat allocation.
2. Create a reusable Access Code with a readable promo value such as
   `TRY_BUSINESSMODE`. Choose its expiry and redemption allowance deliberately;
   this code is public, and each new guest may consume an allowance.
3. Create a machine API key for that Project. The demo needs access checks,
   code redemption and assignment release.
4. Set the variables below. Keep staging and production URLs/resources separate.

| Variable | Purpose |
| --- | --- |
| `BUSINESSMODE_API_URL` | API URL ending in `/v1`; staging example is in `.env.example` |
| `BUSINESSMODE_API_KEY` | Dedicated Project's machine API key; server secret |
| `BUSINESSMODE_ENTITLEMENT_KEY` | Defaults to `todo:write` |
| `DEMO_ORIGIN` | Exact public origin; hosted demo: `https://demo.businessmode.io` |
| `DEMO_SESSION_SECRET` | Server secret: 32 random bytes encoded as 64 hex characters |
| `DEMO_PUBLIC_ACCESS_CODE` | Optional public value for the “Use demo code” button |

Generate a signing secret locally:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Use the same secret across the site's serverless instances. Rotating it ends
existing guest sessions and loses their cookie-held cleanup handles. Never
prefix either secret with `NEXT_PUBLIC_`, commit `.env.local`, or reuse a
production customer key. HTTPS is required outside localhost.

## Deploy

For a Node.js host such as Coolify, use Node 24 or 26, `npm ci`, `npm run build`,
and `npm start -- --hostname 0.0.0.0 --port 3000`. Set the server variables above
and route the public HTTPS domain to port 3000. Restart/redeploy after changing
runtime configuration. The hosted demo deploys this public repository
independently from the BusinessMode monorepo.

### Optional Netlify deployment

Import this repository into a Netlify project. `netlify.toml` defines
`npm run build`, `.next`, and Node 24. Netlify installs its Next.js adapter
without a pinned adapter dependency. Do not add a static SPA catch-all.

Set the variables above in Netlify for the **production** deploy context.
On the Free plan, use the default **All scopes**. On plans supporting specific
scopes, select **Builds and Functions** and use the secret-value flag when
available. Both credentials remain private server environment variables;
never expose them through client-prefixed names or public build output. The app can build without credentials, but real integration requires
them at runtime. Redeploy after any environment-variable change. `.netlify/`
is ignored so local linking metadata cannot be committed.

First verify the `netlify.app` URL. To use `demo.businessmode.io`, add the custom
domain in Netlify, configure its instructed DNS records and HTTPS, change
`DEMO_ORIGIN` to `https://demo.businessmode.io`, and redeploy. Only the configured
origin can send mutation requests; a preview URL needs its own environment
configuration and dedicated test credentials.

## Follow the code

- [`lib/businessmode.ts`](lib/businessmode.ts): SDK redemption, access and release calls.
- [`lib/session.ts`](lib/session.ts): server-issued guest identity and HMAC-signed cookie.
- [`lib/handler.ts`](lib/handler.ts): origin checks, code validation, access decisions and reset.
- [`lib/browser-tasks.ts`](lib/browser-tasks.ts): versioned, validated browser storage.
- [`app/todo-demo.tsx`](app/todo-demo.tsx): UI and local task edits; no machine key.

```ts
import { createMachineClient } from "@businessmode/sdk";

const businessmode = createMachineClient({
  baseUrl: process.env.BUSINESSMODE_API_URL!,
  apiKey: process.env.BUSINESSMODE_API_KEY!,
});

// Derive from YOUR authenticated server session, never a client-supplied ID.
const externalUserId = "your-app-user-id";
const redemption = await businessmode.POST("/access-codes/redeem", {
  body: { code: submittedCode, externalUserId },
});
if (redemption.error !== undefined) throw new Error("Redemption failed");

const access = await businessmode.GET("/access", {
  params: { query: { externalUserId, entitlementKey: "todo:write" } },
});
if (access.error !== undefined || !access.data?.hasAccess) {
  throw new Error("Access denied");
}
// Perform your protected server operation here.
```

HTTP failures return `error`; transport failures throw. Neither grants access.
Promo strings retain exact case and whitespace. No automatic mutation retry is
performed: after an uncertain redemption, retry the same code in the same guest
session. BusinessMode makes that pair domain-idempotent.

## Session lifetime and operating the public demo

Guest access lasts one hour, checked against server time as an absolute instant.
The browser clock does not decide expiry. BusinessMode remains authoritative
for license and code windows. An HttpOnly, SameSite=Strict cookie (Secure on
HTTPS) carries the signed guest ID and up to eight assignment cleanup handles.
The cookie contains no machine key, task data or raw access code. It remains
for seven days so returning visitors can release an expired guest's known
assignments before starting another session.

Reset releases known assignments before clearing the cookie and local tasks.
If release fails, reset reports an error and retains the handles for retry.
The next start gets a new guest ID: replaying an old redemption is not a new
assignment. Signed cookies have no central revocation list; a copied old cookie
can be replayed until its server expiry. Reset revokes known BusinessMode grants,
but is not a production authentication/sign-out system.

**Hosted demo cleanup:** the existing BusinessMode staging database runs
`businessmode-demo-staging-cleanup` every 10 minutes. It deletes abandoned demo
guest access records older than two hours and restores this disposable demo's seat
and redemption capacity. Guest sessions last one hour, leaving an extra hour of
grace. The job uses fixed account/project/license IDs and the `todo_demo:` guest
prefix; it preserves the project, license, code, key and normal audit history.
The dedicated account is excluded from public metrics. Production is unaffected.

The scheduler does not access browser task storage. Reset clears local tasks and
releases known assignments immediately. Reset does not itself replenish historical
redemption allowances; the hosted cleanup does that for this demo code only.

This is operational configuration on the hosted demo, not something that cloning
this repository installs. When hosting your own copy, arrange narrowly scoped
cleanup for abandoned guests or release their assignments through BusinessMode.
Closing a browser, deleting cookies or losing a redemption response can leave an
assignment behind. Do not apply the disposable demo cleanup policy to real users.

The stateless demo has no cross-instance application rate limiter. Keep finite
seat/redemption allowances, review usage, and configure hosting-level traffic
limits as appropriate before broad promotion. BusinessMode API errors and rate
limits are surfaced to the visitor. Do not reuse this guest setup for paid or
sensitive product access.

## SDK release and default cache

The dependency is pinned to the public `@businessmode/sdk@0.1.0-preview.2` npm
release. `npm ci` verifies the registry archive against `package-lock.json`;
there is no vendored SDK or private workspace dependency. See
[third-party notices](THIRD_PARTY_NOTICES.md) for its license and integrity.
Initial support is server-side ESM on Node 24/26.

`lib/runtime.ts` reuses one machine client per server process. The SDK caches
approvals for at most 60 seconds and denials for at most five seconds, shortened
by known expiry. Repeated matching checks in that window do not call the API.
Redemption and release through the same client invalidate its cached decisions.
Changes from another server, the dashboard or cleanup can take up to a minute
to appear. Guest session expiry is still checked on every request.

For an operation requiring fresh access, pass `headers: FRESH_ACCESS_HEADERS`
(imported from `@businessmode/sdk`) to `client.GET("/access", ...)`. The demo's
server wrapper also supports `hasAccess(sessionId, { fresh: true })`.
`accessCache: false` disables the decision cache for a client. HTTP responses
remain `no-store`; never add browser or CDN caching to authenticated decisions.
Errors are not cached, and expired approvals are not reused during an outage.

For an SDK update, run `npm install --save-exact @businessmode/sdk@<version>`,
review the release notes, run the checks below and commit both manifests before
deploying. Publishing a new SDK does not silently update this demo.

## Verify

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Integration tests use the installed SDK against a local HTTP test server. They
cover cross-instance sessions, signature tampering, exact codes, access denial,
revocation, default cache expiry/fresh bypass, mutation invalidation, upstream
failures, expiry, reset retries and browser-storage parsing.
Playwright tests run the production Next.js build on desktop and mobile against
a separate test API; this test service is never used in production.

Before calling a hosted deployment ready, use the **live** dedicated Project to
start, redeem, add/complete/delete, reload and reset. Verify the released
assignment in BusinessMode, independent browser storage, denied access after
revocation, HTTPS, environment secrecy and capacity. Passing CI alone does not
prove live provisioning or deployment.

## License

Demo source: MIT. SDK: ISC. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
