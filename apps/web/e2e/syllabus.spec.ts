import { expect, test } from "@playwright/test";
import { dialog, expectToast, makePdf, signIn } from "./support/helpers";

test("program admin uploads a syllabus, decides change requests and publishes", async ({
  page,
}) => {
  await signIn(page, "program");
  await page.goto("/admin/syllabus");

  // Digital Logic is the demo subject without a syllabus.
  const row = page
    .locator("div", { has: page.getByText("Digital Logic", { exact: true }) })
    .filter({
      has: page.getByRole("button", { name: "Upload PDF" }),
    });
  const chooser = page.waitForEvent("filechooser");
  await row.last().getByRole("button", { name: "Upload PDF" }).click();
  await (
    await chooser
  ).setFiles({
    name: "digital-logic.pdf",
    mimeType: "application/pdf",
    buffer: makePdf([
      "Digital Logic (CSC103), 3 credits",
      "Unit 1: Number systems. Binary and hexadecimal. Complements.",
      "Unit 2: Boolean algebra. Logic gates. Karnaugh maps.",
      "Reference: M. Morris Mano, Digital Design.",
    ]),
  });

  // The worker reads it (through the fake AI) and the draft tree appears.
  await page.waitForURL(/\/admin\/syllabus\/versions\//);
  await expect(page.getByText("Number systems").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Karnaugh maps").first()).toBeVisible();

  // A plain-language change request: accept the addition, reject the rename.
  await page.getByRole("tab", { name: "Changes" }).click();
  await page.getByLabel("Describe a change").fill("Add code converters to unit 1");
  await page.getByRole("button", { name: "Propose changes" }).click();
  await expect(page.getByText("2 changes proposed")).toBeVisible();
  await page.getByRole("group", { name: "Add" }).getByRole("button", { name: "Accept" }).click();
  await page.getByRole("group", { name: "Rename" }).getByRole("button", { name: "Reject" }).click();
  await page.getByRole("button", { name: "Apply decisions" }).click();
  await expectToast(page, "Changes applied");
  await expect(page.getByText("Partly accepted")).toBeVisible();

  await page.getByRole("tab", { name: /^Topics/ }).click();
  const tree = page.getByRole("region", { name: "Topics" });
  await expect(tree.getByText("Code converters")).toBeVisible();
  await expect(tree.getByText("Binary and hexadecimal", { exact: true })).toBeVisible();
  await expect(tree.getByText("(renamed)")).toHaveCount(0);

  // Publish, then the status follows the job until it is live.
  await page.getByRole("button", { name: "Publish" }).click();
  await dialog(page, "Publish this syllabus?").getByRole("button", { name: "Publish" }).click();
  await expectToast(page, "Publishing started");
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
});
