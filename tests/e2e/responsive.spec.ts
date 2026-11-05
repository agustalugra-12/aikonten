import { test } from "@playwright/test";
import fs from "node:fs";

// Screenshot before/after utk HP & tablet. SHOT_DIR=before|after memilih folder output;
// SESSION_TOKEN (cookie aikonten_session) utk halaman ber-auth. Lebar sesuai permintaan:
// 360/390 (HP), 768/820/1024 (tablet), masing-masing portrait + landscape.
const DIR = `responsive-shots/${process.env.SHOT_DIR || "after"}`;
const TOKEN = process.env.SESSION_TOKEN || "";
const WIDTHS = [360, 390, 768, 820, 1024];

const viewports: { tag: string; width: number; height: number }[] = [];
for (const w of WIDTHS) {
  const tall = Math.max(Math.round((w * 16) / 9), 780);
  viewports.push({ tag: `${w}-portrait`, width: w, height: tall });
  viewports.push({ tag: `${w}-landscape`, width: tall, height: w });
}

type Shot = {
  name: string;
  path: string;
  full?: boolean;
  action?: (page: import("@playwright/test").Page) => Promise<void>;
};
const shots: Shot[] = [
  { name: "login", path: "/login", full: true },
  { name: "signup", path: "/signup", full: true },
  { name: "pilih-paket", path: "/pilih-paket", full: true },
  { name: "dashboard-overview", path: "/", full: true },
  {
    name: "konten-list",
    path: "/",
    full: true,
    action: async (page) => {
      const menu = page.locator('[aria-label="Buka menu"]');
      if (await menu.isVisible().catch(() => false)) { await menu.click(); await page.waitForTimeout(350); }
      const btn = page.getByRole("button", { name: "Konten", exact: true }).first();
      if (await btn.isVisible().catch(() => false)) { await btn.click(); await page.waitForTimeout(700); }
    },
  },
  {
    name: "mobile-drawer",
    path: "/",
    full: false,
    action: async (page) => {
      const menu = page.locator('[aria-label="Buka menu"]');
      if (await menu.isVisible().catch(() => false)) { await menu.click(); await page.waitForTimeout(400); }
    },
  },
];

test("responsive screenshots", async ({ browser }) => {
  fs.mkdirSync(DIR, { recursive: true });
  for (const vp of viewports) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    if (TOKEN) {
      await context.addCookies([{ name: "aikonten_session", value: TOKEN, domain: "127.0.0.1", path: "/" }]);
    }
    const page = await context.newPage();
    for (const s of shots) {
      try {
        await page.goto(s.path, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1000);
        if (s.path === "/") {
          // Dashboard client-rendered: tunggu lewat state "Memuat..." sampai konten brand muncul.
          await page.getByText(/Memuat/).first().waitFor({ state: "detached", timeout: 25000 }).catch(() => {});
          await page.waitForTimeout(700);
        }
        if (s.action) await s.action(page);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${DIR}/${s.name}__${vp.tag}.png`, fullPage: !!s.full });
      } catch (e) {
        console.log("SHOT_FAIL", s.name, vp.tag, (e as Error).message.slice(0, 90));
      }
    }
    await context.close();
  }
});
