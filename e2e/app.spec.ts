import { expect, test } from "@playwright/test";

test("boots to the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Lanjutkan dengan Google" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Zee");
});

// Mobile-specific flows are covered once the responsive access PR lands
// (the app still gates phones below 640px on this branch); keep this suite
// green on main and mobile coverage will be added after that merges.
test("guest can browse the archive without horizontal scroll", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Masuk sebagai Tamu" }).click();
  await expect(page).toHaveURL(/\/b\//);
  await expect(page.locator(".filelist")).toBeVisible({ timeout: 30_000 });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});