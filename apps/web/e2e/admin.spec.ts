import { expect, test, type Page } from "@playwright/test";
import { dialog, expectToast, signIn } from "./support/helpers";

/** Fills a sheet's fields by label and submits it with its main button. */
async function submitSheet(
  page: Page,
  title: string,
  fields: Record<string, string>,
  submit: string,
) {
  const sheet = dialog(page, title);
  for (const [label, value] of Object.entries(fields)) await sheet.getByLabel(label).fill(value);
  await sheet.getByRole("button", { name: submit }).click();
  await expect(sheet).toBeHidden();
}

test("university admin creates a program, batch, semester, section and subject, then edits the semester", async ({
  page,
}) => {
  await signIn(page, "admin");
  await page.goto("/admin/structure");

  // A validation error comes back from the API and is shown on the field.
  await page.getByRole("button", { name: "New program" }).click();
  await dialog(page, "New program").getByRole("button", { name: "Create" }).click();
  await expect(dialog(page, "New program").getByRole("alert").first()).toBeVisible();
  await submitSheet(
    page,
    "New program",
    { "Program name": "Bachelor of Science in CSIT", Code: "CSIT" },
    "Create",
  );
  await page.getByRole("link", { name: /Bachelor of Science in CSIT/ }).click();

  await page.getByRole("button", { name: "New batch" }).click();
  await submitSheet(
    page,
    "New batch",
    { "Batch name": "CSIT 2026", "Intake year": "2026" },
    "Create",
  );
  await page.getByRole("link", { name: /CSIT 2026/ }).click();

  await page.getByRole("button", { name: "New semester" }).click();
  await submitSheet(page, "New semester", {}, "Create");
  await expectToast(page, "Semester 1 created");
  await expect(page.getByRole("heading", { name: "Semester 1" })).toBeVisible();

  await page.getByRole("button", { name: "Add section" }).click();
  await submitSheet(page, "Add section", { "Section name": "A" }, "Add");
  await page.getByRole("button", { name: "Add subject" }).click();
  await submitSheet(
    page,
    "Add subject",
    { "Subject name": "Discrete Structures", "Subject code": "CSC160" },
    "Add",
  );
  await expect(page.getByText("Discrete Structures", { exact: true })).toBeVisible();

  // Edit: the semester starts.
  await page.getByRole("button", { name: "Edit semester" }).click();
  const edit = dialog(page, "Edit semester");
  await edit.getByLabel("Status").selectOption("ACTIVE");
  await edit.getByRole("button", { name: "Save" }).click();
  await expectToast(page, "Saved");
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
});

test("program admin grants CR and replaces one when the section is full", async ({ page }) => {
  await signIn(page, "program");
  await page.goto("/admin/students");

  const makeCr = async (name: string) => {
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await dialog(page, name).getByRole("button", { name: "Make class representative" }).click();
  };

  // Section A already has one CR (Aarav); two more fill it.
  for (const name of ["Asha Bhandari", "Dipesh KC"]) {
    await makeCr(name);
    await expectToast(page, "Now a class representative");
    await expect(dialog(page, name)).toBeHidden();
  }

  // A fourth: the API refuses, and the sheet offers to replace one of the three.
  await makeCr("Manisha Rana");
  const sheet = dialog(page, "Manisha Rana");
  await expect(
    sheet.getByText("This section already has 3 CRs. Choose one to replace."),
  ).toBeVisible();
  await sheet.getByRole("button", { name: "Replace Asha Bhandari" }).click();
  await expectToast(page, "Now a class representative");

  const rowOf = (name: string) => page.getByRole("button", { name: new RegExp(name) });
  await expect(rowOf("Manisha Rana").getByText("CR", { exact: true })).toBeVisible();
  await expect(rowOf("Asha Bhandari").getByText("CR", { exact: true })).toHaveCount(0);
});
