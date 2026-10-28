import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export default defineConfig({
  testDir: "./test/browser", fullyParallel: false, workers: 1,
  reporter: "list", retries: process.env.CI ? 1 : 0,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1536, height: 1024 } } },
    { name: "mobile", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true } },
  ],
  webServer: [
    { command: "node --import tsx test/mock-api.ts", url: "http://127.0.0.1:4010/health", reuseExistingServer: false },
    { command: "npm run start", url: "http://localhost:3000", reuseExistingServer: false, timeout: 60_000,
      env: { BUSINESSMODE_API_URL: "http://127.0.0.1:4010/v1", BUSINESSMODE_API_KEY: "local-test-key",
        BUSINESSMODE_ENTITLEMENT_KEY: "todo:write", DEMO_ORIGIN: "http://localhost:3000",
        DEMO_DATABASE_PATH: join(tmpdir(), `businessmode-browser-${randomUUID()}.sqlite`), DEMO_PUBLIC_ACCESS_CODE: "TRY_BUSINESSMODE" } },
  ],
});
