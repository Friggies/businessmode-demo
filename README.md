# BusinessMode · Next.js Todo demo

A small, public reference app showing how to integrate BusinessMode from your
backend. Visitors start a temporary guest session, redeem an access code, and
unlock a Todo list. Every task write checks access on the server.

The app is independent of the private BusinessMode monorepo. It uses the actual
packaged `@businessmode/sdk`, not workspace imports. The intended hosted address
is `demo.businessmode.io`; deployment is separate from publishing this source.

## Run locally

Use Node.js 24 or 26 and npm.

```sh
git clone https://github.com/Friggies/businessmode-demo.git
cd businessmode-demo
npm ci
cp .env.example .env.local
# Fill in the server environment described below.
npm run dev
```

Open `http://localhost:3000`. Without configuration the UI renders an honest
setup state; it does not simulate successful access or redemption.

## Prepare a dedicated BusinessMode project

1. Create a Project used only for this demo, and an entitlement with key
   `todo:write`.
2. Create a demo Organization and an active License that includes `todo:write`.
   Give the License sufficient seats for the expected visitors. The app bounds
   retained guest sessions to 250, including those waiting for cleanup.
3. Create an Access Code for that License with a readable promo value such as
   `TRY_BUSINESSMODE`. Make it reusable by multiple visitors and choose an
   expiry/redemption limit appropriate to the demo. Released seats do not undo
   historical redemptions or refill a code's redemption allowance.
4. Create a machine API key for this dedicated Project. The server needs access
   checks, Access Code redemption, and assignment release. Configure the key only
   on the server. Do not reuse a customer Project or key.

The platform API must support promo redemption before visitors use the public
code. Keep staging and production credentials, resources and URLs separate.

| Variable | Purpose |
| --- | --- |
| `BUSINESSMODE_API_URL` | API URL including `/v1`; e.g. `https://staging-api.businessmode.io/v1` |
| `BUSINESSMODE_API_KEY` | Dedicated Project's machine API key; server secret |
| `BUSINESSMODE_ENTITLEMENT_KEY` | Entitlement checked on writes; defaults to `todo:write` |
| `DEMO_ORIGIN` | Exact browser origin, e.g. `http://localhost:3000` or `https://demo.businessmode.io` |
| `DEMO_DATABASE_PATH` | SQLite file; defaults to `./data/demo.sqlite` |
| `DEMO_PUBLIC_ACCESS_CODE` | Optional, intentionally public value for “Use demo code” |

Never prefix the machine key with `NEXT_PUBLIC_`. No secret is required during
the build. HTTPS is required outside localhost. Changing runtime configuration
requires restarting the app.

## Follow the integration

- [`lib/businessmode.ts`](lib/businessmode.ts): the three actual SDK calls.
- [`lib/handler.ts`](lib/handler.ts): derive visitor identity, redeem, check
  access before writing tasks, and handle errors.
- [`lib/store.ts`](lib/store.ts): this app's guest sessions and task storage.
- [`app/todo-demo.tsx`](app/todo-demo.tsx): the client UI; it has no machine key.

```ts
import { createMachineClient } from "@businessmode/sdk";

const businessmode = createMachineClient({
  baseUrl: process.env.BUSINESSMODE_API_URL!,
  apiKey: process.env.BUSINESSMODE_API_KEY!,
});

// Derive this ID from YOUR authenticated server session, never a request body.
const externalUserId = "your-app-user-id";

const redemption = await businessmode.POST("/access-codes/redeem", {
  body: { code: submittedCode, externalUserId },
});
if (redemption.error !== undefined) {
  // Handle the HTTP error. Network failures throw instead.
}

const access = await businessmode.GET("/access", {
  params: { query: { externalUserId, entitlementKey: "todo:write" } },
  cache: "no-store",
});
if (access.error !== undefined || !access.data?.hasAccess) {
  // Do not perform the protected operation.
}
```

BusinessMode handles entitlements, seats and code rules. Your application owns
identity and task data. This demo supplies a random guest ID through a one-hour,
HttpOnly, SameSite cookie; the database stores only a hash of its 256-bit token.
For a real product, replace this guest adapter with your existing authentication
system. No BusinessMode account is created for a visitor.

Code strings retain their exact case and whitespace. The example code is a
published demo credential, not a secret. API errors do not become successful
access decisions. Mutations are not retried automatically; after an uncertain
redemption, retry the same code in the same guest session. Redemption is
domain-idempotent for that code/user pair. Resetting creates a fresh identity
on the next start, since replaying an old redemption is not a new assignment.

Guest expiry is stored as an absolute instant and checked on the server. The UI
reacts to server expiry responses instead of making access decisions from the
browser's clock. BusinessMode remains authoritative for License and Access Code
time windows.

## SDK release status

The dependency currently points to a reviewed archive of
`@businessmode/sdk@0.1.0-preview.0` in `vendor/`. This lets anyone install the
repository before the first npm publication. The archive contains compiled
SDK files, types and its own license; no private workspace dependency is needed.
See [third-party notices](THIRD_PARTY_NOTICES.md) for provenance and integrity.

After that exact preview is available publicly on npm:

```sh
npm install --save-exact @businessmode/sdk@0.1.0-preview.0
```

Commit both package files, remove the vendored archive and its `COPY vendor`
Dockerfile line, and update these notices. Pin preview versions. The initial SDK
support scope is server-side ESM on Node 24/26; this demo does not add another
framework wrapper or browser SDK support promise.

## Test

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The integration tests use the **real installed SDK** against a local test HTTP
server. They exercise identity isolation, exact promo strings, redemption,
write checks, revocation, unavailable API behavior, expiry and cleanup retries.
Browser tests run the production Next.js build with a separate test API server.
They do not prove live BusinessMode provisioning, DNS or deployment; those need
the acceptance checks below. No mock-access mode exists in production code.

## Deploy to Coolify

Use one container replica built with the root `Dockerfile`, port `3000`.
Mount persistent storage at `/app/data`, writable by the container's `node`
user (UID 1000). Set the environment variables above as runtime values and set
`DEMO_ORIGIN=https://demo.businessmode.io`. Keep `.env.local` out of Git and
container build context. Use `/api/demo/state` as an HTTP liveness check; it
does not prove that a machine key can redeem or release assignments.

Connect the hostname and TLS to the running Coolify application before adding
its DNS record. The SQLite implementation assumes a single instance on
persistent local storage. Multi-instance/serverless deployments need a shared
session/task store; do not give each replica its own SQLite database.

The demo limits new sessions globally (15/minute), session API requests
(60/minute), redemption attempts (5/minute), task count (30/session), task length
and JSON body size. Use host-level traffic limits for a public launch; these
small in-app limits are not a DDoS service.

### Lifecycle and operational limits

Reset or one-hour expiry ends local access immediately. After API responses,
the server attempts a bounded batch of expired assignment releases and prunes
expired tasks. Failed releases remain in SQLite for retry on later requests.
Cleanup is traffic-driven, so quiet periods can leave expired seats assigned
until the next request. Retain the persistent volume across deployments.

A redemption that reached BusinessMode but lost its response can leave an
unknown assignment if the visitor abandons the session before retrying. A lost
database volume has a similar effect. Inspect the dedicated demo License's
assignments periodically and release abandoned `todo_demo:` users through
BusinessMode. This demo deliberately does not add a distributed reconciliation
service. Keep this bounded operational tradeoff in mind when allocating seats.
Code redemption allowances and retained external users also need occasional
review; releasing assignments does not delete historical users/redemptions.

Before calling the hosted demo ready:

- Confirm the new API version is deployed and accepts promo codes.
- Use the live dedicated Project/key to start, redeem, add, complete and delete.
- Use a second browser session to confirm task isolation.
- Revoke access and confirm direct task writes are denied.
- Reset a session and confirm the assignment is released; restart the container
  and confirm the remaining session/task state persists.
- Check HTTPS, hostname, runtime key secrecy and configured capacity.

## License

Demo source: MIT. SDK: ISC. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
