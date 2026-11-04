import { chromium } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";

const privateEnv = await readFile("backend/.dev.vars", "utf8");
const setupCode = privateEnv
  .match(/^DEMO_SETUP_KEY=(.+)$/m)?.[1]
  ?.trim()
  .replace(/^['"]|['"]$/g, "");
if (!setupCode) throw Error("Missing private presenter setup.");
await mkdir(".capture", { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
try {
  const demoUrl = new URL(process.env.DEMO_URL || "http://127.0.0.1:5174/");
  demoUrl.searchParams.set("workspace", "");
  await page.goto(demoUrl.href);
  await page.locator(".nav-item").filter({ hasText: "With creative" }).click();
  await page.getByRole("button", { name: /CP-1039/ }).click();
  await page.getByRole("button", { name: /Open creative.*handoff/ }).click();
  await page.getByText("Connect live Slack", { exact: true }).click();
  await page.getByLabel("Private setup code", { exact: true }).fill(setupCode);
  await page.getByRole("button", { name: "Connect this browser" }).click();
  await page.getByRole("button", { name: "Send pre-approved fix" }).click();
  const slackLink = page.getByRole("link", {
    name: "Open actual Slack message",
  });
  await slackLink.waitFor({ timeout: 25000 });
  const link = await slackLink.getAttribute("href");
  console.log(
    JSON.stringify({ delivered: true, submissionId: "CP-1039", link }),
  );
  await page.getByRole("button", { name: "Back to workspace" }).click();
  await page.getByRole("button", { name: "Edit copy", exact: true }).click();
  await page
    .getByRole("textbox", { name: "headline", exact: true })
    .fill("Room for a different tomorrow.");
  await page.getByRole("button", { name: "Save new version" }).click();
  await page.waitForFunction(
    async () => {
      const store = JSON.parse(
        sessionStorage.getItem("clearpath-live-slack-v1") || "null",
      );
      const proposal = store?.links["CP-1039"]?.proposal;
      if (!proposal) return false;
      const response = await fetch(
        `${store.endpoint}/v1/proposals/${proposal.id}`,
        {
          headers: { Authorization: `Bearer ${store.session.token}` },
        },
      );
      return response.ok && (await response.json()).status === "superseded";
    },
    {},
    { timeout: 25000 },
  );
  const evidence = await page.evaluate(() => {
    const item = JSON.parse(localStorage.getItem("clearpath-relay-v1")).find(
      (s) => s.id === "CP-1039",
    );
    return {
      localStatus: item.status,
      latestVersion: item.versions.at(-1).id,
      slackStatus: "superseded",
    };
  });
  await writeFile(
    ".capture/live-supersede-evidence.json",
    JSON.stringify({ ...evidence, link }, null, 2),
  );
  console.log(JSON.stringify(evidence));
} catch (error) {
  await page.screenshot({ path: ".capture/live-supersede-failure.png" });
  throw error;
} finally {
  await browser.close();
}
