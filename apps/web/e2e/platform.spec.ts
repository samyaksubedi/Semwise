import { expect, test } from "@playwright/test";
import { dialog, expectToast, signIn } from "./support/helpers";

test("Super Admin creates a college, suspends and reactivates it", async ({ page }) => {
  await signIn(page, "platform");
  await expect(page).toHaveURL(/\/platform\/colleges$/);
  await expect(page.getByText("You see college accounts, not college content")).toBeVisible();

  // Slugs starting with e2e- are removed by the next seed.
  const slug = `e2e-${Date.now().toString(36)}`;
  await page.getByRole("button", { name: "Add college" }).first().click();
  const create = dialog(page, "Add college");
  await create.getByLabel("College name").fill("Himalaya Test College");
  await create.getByLabel("Short name in links").fill(slug);
  await expect(create.getByLabel("Timezone")).toHaveValue("Asia/Kathmandu");
  await create.getByLabel("Admin email").fill(`${slug}@demo.semwise.local`);
  await create.getByRole("button", { name: "Create and send invite" }).click();
  await expectToast(page, "Himalaya Test College created. Invite sent.");

  // The new college opens with its pending invite.
  const sheet = dialog(page, "Himalaya Test College");
  await expect(sheet.getByText("1 invite is waiting to be accepted.")).toBeVisible();

  await sheet.getByRole("button", { name: "Suspend college" }).click();
  await dialog(page, "Suspend Himalaya Test College?")
    .getByRole("button", { name: "Suspend college" })
    .click();
  await expectToast(page, "Himalaya Test College is suspended.");
  await expect(sheet.getByText("Suspended: its members cannot use Semwise.")).toBeVisible();

  await sheet.getByRole("button", { name: "Reactivate college" }).click();
  await dialog(page, "Reactivate Himalaya Test College?")
    .getByRole("button", { name: "Reactivate college" })
    .click();
  await expectToast(page, "Himalaya Test College is active again.");

  await sheet.getByRole("button", { name: "Close" }).first().click();
  const row = page.getByRole("button", { name: new RegExp(slug) });
  await expect(row.getByText("Active")).toBeVisible();
  await expect(row.getByText("1 pending invite").filter({ visible: true })).toBeVisible();
});
