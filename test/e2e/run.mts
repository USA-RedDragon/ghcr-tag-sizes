// Live end-to-end canary: loads the actual built extension into a real browser, opens
// a live GitHub container package page, and asserts the size badges render with real
// per-architecture numbers. The only full-stack check — manifest, background↔content
// messaging, ghcr.io, and DOM injection — against the real world. Runs nightly.
//
//   node --import tsx test/e2e/run.mts firefox|chrome
//
// Set E2E_HEADED=1 to watch it. Public image only — no login required.

import { Builder, By, until, type WebDriver } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import chrome from "selenium-webdriver/chrome.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const target = process.argv[2];
if (target !== "firefox" && target !== "chrome") {
  console.error("usage: node --import tsx test/e2e/run.mts firefox|chrome");
  process.exit(2);
}

const ROOT = process.cwd();
const EXT_DIR = path.join(ROOT, "dist", target); // assembled by `npm run build:dirs`
const PAGE = "https://github.com/USA-RedDragon/dockers/pkgs/container/alpine";
const headed = process.env.E2E_HEADED === "1";
const SIZE_RE = /\d+(\.\d+)?\s(B|KB|MB|GB|TB)/;

function buildFirefox(): WebDriver {
  const opts = new firefox.Options();
  if (!headed) opts.addArguments("-headless");
  return new Builder().forBrowser("firefox").setFirefoxOptions(opts).build();
}

async function installFirefoxAddon(driver: WebDriver): Promise<void> {
  // installAddon needs a packaged file; zip the unpacked build into an .xpi.
  const xpi = path.join(mkdtempSync(path.join(os.tmpdir(), "ghcr-xpi-")), "ext.xpi");
  execFileSync("zip", ["-r", "-X", xpi, "."], { cwd: EXT_DIR, stdio: "ignore" });
  await (driver as unknown as { installAddon(p: string, t: boolean): Promise<string> }).installAddon(xpi, true);
}

function buildChrome(): WebDriver {
  const opts = new chrome.Options();
  opts.addArguments(`--load-extension=${EXT_DIR}`);
  opts.addArguments(`--disable-extensions-except=${EXT_DIR}`);
  if (!headed) opts.addArguments("--headless=new"); // MV3 extensions need new headless
  return new Builder().forBrowser("chrome").setChromeOptions(opts).build();
}

/** Poll every badge until at least one shows a real size (or fail after timeout). */
async function waitForSizes(driver: WebDriver, timeoutMs = 45000): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  let texts: string[] = [];
  while (Date.now() < deadline) {
    const badges = await driver.findElements(By.css(".ghcr-size-badge"));
    texts = await Promise.all(badges.map((b) => b.getText().catch(() => "")));
    if (texts.some((t) => SIZE_RE.test(t))) return texts;
    await driver.sleep(500);
  }
  throw new Error(`No size badge rendered within ${timeoutMs}ms. Saw: ${JSON.stringify(texts)}`);
}

async function main(): Promise<void> {
  let driver: WebDriver;
  if (target === "firefox") {
    driver = buildFirefox();
    await installFirefoxAddon(driver);
  } else {
    driver = buildChrome();
  }

  try {
    await driver.get(PAGE);
    await driver.wait(until.elementLocated(By.css("li.Box-row")), 30000);

    const texts = await waitForSizes(driver);
    console.log(`[${target}] badges:\n  ${texts.filter(Boolean).join("\n  ")}`);

    const joined = texts.join("\n");
    if (!SIZE_RE.test(joined)) throw new Error("no rendered size unit");
    for (const arch of ["amd64", "arm64"]) {
      if (!joined.includes(arch)) throw new Error(`multi-arch check: missing ${arch}`);
    }
    console.log(`[${target}] PASS ✓ sizes rendered incl. amd64 + arm64`);
  } finally {
    await driver.quit();
  }
}

main().catch((err: unknown) => {
  console.error(`[${target}] FAIL ✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
