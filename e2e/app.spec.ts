import { expect, test } from "@playwright/test";

test("boots to the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Lanjutkan dengan Google" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Zee");
});

test("guest can browse the archive without horizontal scroll", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Masuk sebagai Tamu" }).click();
  await expect(page).toHaveURL(/\/b\//);
  await expect(page.locator(".filelist")).toBeVisible({ timeout: 30_000 });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("mobile viewport: folder drawer opens and navigation closes it", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Masuk sebagai Tamu" }).click();
  await expect(page).toHaveURL(/\/b\//);
  await expect(page.locator(".filelist")).toBeVisible({ timeout: 30_000 });

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);

  await page.getByRole("button", { name: "Tampilkan atau sembunyikan" }).click();
  const treebar = page.locator(".treebar");
  await expect(treebar).toHaveClass(/open/);

  await treebar.getByRole("button", { name: "Home", exact: true }).click();
  await expect(treebar).not.toHaveClass(/open/);
});