/**
 * Screenshots for the UI check in docs/ui-ux.md: each page at 360, 768 and 1280 px, light and
 * dark, signed in as a demo account (run `pnpm --filter @semwise/api seed:demo` first, with the
 * API and web dev servers running).
 *
 *   node scripts/screens.mjs <out-dir> <account>:<path>[,<path>...] ...
 *   node scripts/screens.mjs ./shots student:/chat,/catchup program:/admin
 *
 * Accounts are the demo names (admin, program, teacher, cr, student ...); "anon" takes pages
 * signed out. It reports any page that scrolls sideways at 360 px.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const PASSWORD = "semwise demo 2026";
const WIDTHS = (process.env.WIDTHS ?? "360,768,1280").split(",").map(Number);
const THEMES = (process.env.THEMES ?? "light,dark").split(",");

const [outDir, ...specs] = process.argv.slice(2);
if (!outDir || specs.length === 0) {
  console.error("Usage: node scripts/screens.mjs <out-dir> <account>:<path>[,<path>...] ...");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const problems = [];

for (const spec of specs) {
  const [account, paths] = spec.split(":");
  for (const theme of THEMES) {
    const context = await browser.newContext({ colorScheme: theme, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on("pageerror", (err) => problems.push(`${account} ${theme}: page error ${err.message}`));
    if (account !== "anon") {
      await page.goto(`${WEB}/login`);
      await page.getByLabel("Email").fill(`${account}@demo.semwise.local`);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
    }
    for (const path of paths.split(",")) {
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: width < 768 ? 780 : 900 });
        await page.goto(`${WEB}${path}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);
        // Runs in the page, where the browser globals exist.
        const overflow = await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
        );
        if (width === 360 && overflow > 0)
          problems.push(`${account} ${path} ${theme}: ${overflow}px sideways scroll at 360`);
        const name = `${account}${path.replace(/[^a-z0-9]+/gi, "_")}_${width}_${theme}.png`;
        await page.screenshot({ path: join(outDir, name), fullPage: true });
      }
    }
    await context.close();
  }
}
await browser.close();
console.log(problems.length ? `Problems:\n${problems.join("\n")}` : "No problems found.");
