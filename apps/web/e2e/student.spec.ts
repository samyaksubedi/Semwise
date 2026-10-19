import { expect, test } from "@playwright/test";
import { dialog, fakeAiCalls, signIn } from "./support/helpers";

test("student asks a question and opens its source", async ({ page }) => {
  await signIn(page, "student");
  await page.goto("/chat");
  const before = (await fakeAiCalls()).filter((c) => c === "chat_answer").length;

  await page
    .getByLabel("Ask a question…")
    .fill("How does pointer arithmetic work with arrays and pointers in C?");
  await page.getByRole("button", { name: "Send" }).click();

  // The answer comes from the (fake) model through the real API, with labels and a source chip.
  const answer = page.getByRole("article", { name: "Semwise" });
  await expect(answer.getByText("Here is what your class material says about it")).toBeVisible({
    timeout: 30_000,
  });
  await expect(answer.getByText("General explanation", { exact: true }).first()).toBeVisible();
  await page.waitForURL(/\/chat\/.+/);
  expect((await fakeAiCalls()).filter((c) => c === "chat_answer").length).toBe(before + 1);

  // Screen readers hear the answer, and keyboard focus is back in the question box.
  await expect(page.locator(".sr-only[aria-live=polite]")).toContainText("Answer: Here is what");
  await expect(page.getByLabel("Ask a question…")).toBeFocused();

  // Open a source by keyboard; Escape closes it and focus returns to the chip.
  const chip = answer.getByRole("button", { name: /^Source 1:/ });
  await chip.focus();
  await page.keyboard.press("Enter");
  const source = dialog(page, "Source");
  await expect(source).toBeVisible();
  await expect(source.getByText(/Programming in C|Mathematics I/).first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(source).toBeHidden();
  await expect(chip).toBeFocused();
});

test("student reads a catch-up range and narrows it", async ({ page }) => {
  await signIn(page, "student");
  await page.goto("/catchup");
  await page.getByRole("tab", { name: "Pick a range" }).click();

  // The default range is the last seven days: both subjects, several classes.
  await expect(page.getByRole("heading", { name: "Programming in C" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mathematics I" })).toBeVisible();

  // Narrow to one day five days ago: only the limits class (maths) is left.
  const day = await page.evaluate(() => {
    const d = new Date(Date.now() - 5 * 86_400_000);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu" }).format(d);
  });
  await page.getByLabel("From").fill(day);
  await page.getByLabel("To").fill(day);
  await expect(page.getByRole("heading", { name: "Programming in C" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Mathematics I" })).toBeVisible();
  await expect(page.getByText("Limits of functions").first()).toBeVisible();

  // The follow-up link fills the chat box; it never sends by itself.
  await page.getByRole("link", { name: "Ask a follow-up" }).click();
  await page.waitForURL(/\/chat\?/);
  await expect(page.getByLabel("Ask a question…")).toHaveValue(
    /Explain what was taught in Mathematics I/,
  );
});
