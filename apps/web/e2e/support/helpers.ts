import { expect, type Page } from "@playwright/test";
import { FAKE_OPENAI_PORT } from "./fake-openai";

export const PASSWORD = "semwise demo 2026";

/** Signs in as a demo account (admin, program, teacher, cr, student, platform ...). */
export async function signIn(page: Page, account: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${account}@demo.semwise.local`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** A dialog by its title (sheets and confirmations are <dialog> elements). */
export function dialog(page: Page, title: string | RegExp) {
  return page.getByRole("dialog", { name: title });
}

/** The toast region announces confirmations politely. */
export async function expectToast(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.locator("[aria-live=polite]").getByText(text).last()).toBeVisible();
}

/** Schema names the fake OpenAI server was asked for so far in this run. */
export async function fakeAiCalls(): Promise<string[]> {
  const res = await fetch(`http://127.0.0.1:${FAKE_OPENAI_PORT}/__calls`);
  return (await res.json()) as string[];
}

/** A small text PDF (one line per entry), enough for the upload checks and the text reader. */
export function makePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = `BT /F1 12 Tf 14 TL 72 720 Td ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
