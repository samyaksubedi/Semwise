import { expect, test } from "@playwright/test";
import { dialog, expectToast, signIn } from "./support/helpers";

test("CR edits a published entry, then withdraws the change", async ({ page }) => {
  await signIn(page, "cr");
  await page.goto("/entries");

  // The newest published entry (Programming in C, today).
  await page
    .getByRole("link", { name: /Programming in C/ })
    .first()
    .click();
  await expect(page.getByText("Live version")).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByLabel("Topics and notes")
    .fill("Pointer arithmetic with arrays, and pointers to pointers.");
  await page.getByRole("button", { name: "Send the change" }).click();

  // The worker organizes the new text; the live version stays meanwhile.
  await expect(page.getByText("Newer version")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Live version")).toBeVisible();
  const send = page.getByRole("button", { name: "Send to the teacher" });
  if (await send.isVisible()) {
    await send.click();
    await expectToast(page, "Sent");
  }

  await page.getByRole("button", { name: "Withdraw" }).click();
  await dialog(page, "Withdraw this entry?").getByRole("button", { name: "Withdraw" }).click();
  await expectToast(page, "Withdrawn");
  await expect(page.getByText("Newer version")).toHaveCount(0);
  await expect(page.getByText("Live version")).toBeVisible();
});
