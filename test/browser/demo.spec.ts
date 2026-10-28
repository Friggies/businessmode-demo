import { expect, test } from "@playwright/test";

test("guest can redeem, edit tasks and reset", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle("Todo demo · BusinessMode");
  await expect(page.getByRole("heading", { name: "Today’s list" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start guest session" })).toBeEnabled();
  await expect(page.getByLabel("New task")).toBeDisabled();
  await page.getByRole("button", { name: "Start guest session" }).click();
  await expect(page.getByText("Guest session ready")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use demo code" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("locked.png"), fullPage: true });

  await page.getByLabel("Access code", { exact: true }).fill("invalid-code");
  await page.getByRole("button", { name: "Redeem code", exact: true }).click();
  await expect(page.getByText("This code could not grant access.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Use demo code" }).click();
  await expect(page.getByLabel("Access code", { exact: true })).toHaveValue("TRY_BUSINESSMODE");
  await page.getByRole("button", { name: "Redeem code", exact: true }).click();
  await expect(page.getByText("Access granted. Make this list your own.")).toBeVisible();
  await expect(page.getByLabel("New task")).toBeEnabled();
  await page.getByLabel("New task").fill("Try the BusinessMode SDK");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const task = page.getByRole("checkbox", { name: "Try the BusinessMode SDK" });
  await expect(task).toBeVisible();
  // The controlled checkbox waits for the server's access check and write.
  await task.click();
  await expect(task).toBeChecked();
  await page.reload();
  await expect(task).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath("unlocked.png"), fullPage: true });
  await page.getByRole("button", { name: "Delete Try the BusinessMode SDK" }).click();
  await expect(task).toHaveCount(0);
  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByRole("button", { name: "Start guest session" })).toBeEnabled();
  await expect(page.getByLabel("New task")).toBeDisabled();
  await page.getByRole("link", { name: "How it works" }).click();
  await expect(page.getByRole("heading", { name: "See the integration" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("an incorrect visitor clock does not expire the server session", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2040-01-01T00:00:00Z"));
  await page.goto("/");
  await page.getByRole("button", { name: "Start guest session" }).click();
  await expect(page.getByText("Guest session ready")).toBeVisible();
  await page.getByRole("button", { name: "Use demo code" }).click();
  await page.getByRole("button", { name: "Redeem code", exact: true }).click();
  await expect(page.getByLabel("New task")).toBeEnabled();
  await page.getByLabel("New task").fill("Works with a different client clock");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Works with a different client clock" })).toBeVisible();
});
