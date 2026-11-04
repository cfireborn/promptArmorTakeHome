import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const env = await readFile("backend/.dev.vars", "utf8");
const code = env
  .match(/^DEMO_SETUP_KEY=(.+)$/m)?.[1]
  .trim()
  .replace(/^['"]|['"]$/g, "");
if (!code) throw Error("Missing private setup.");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
const demoUrl = new URL(process.env.DEMO_URL || "http://127.0.0.1:5174/");
demoUrl.searchParams.set("workspace", "");
await page.goto(demoUrl.href);
await page.getByRole("button", { name: /CP-1041/ }).click();
await page.getByRole("button", { name: "Try an example fix" }).click();
await page
  .getByRole("button", { name: "Use this as my starting point" })
  .click();
await page.getByRole("button", { name: "Pre-approve & hand off" }).click();
await page
  .getByPlaceholder("Give creative the context they need to say yes…")
  .fill(
    "Corrected the prequalification claim and gave the qualification a readable panel. Please confirm this treatment works for the affiliate placement.",
  );
await page.getByLabel("I reviewed this exact version").check();
await page
  .getByRole("button", { name: "Pre-approve this version", exact: true })
  .click();
await page.getByText("Connect live Slack", { exact: true }).click();
await page.getByLabel("Private setup code", { exact: true }).fill(code);
await page.getByRole("button", { name: "Connect this browser" }).click();
await page.getByRole("button", { name: "Send pre-approved fix" }).click();
await page
  .getByRole("link", { name: "Open actual Slack message" })
  .waitFor({ timeout: 25000 });
console.log(
  JSON.stringify({
    readyForSlackFeedback: true,
    title: "Room for your next chapter",
    link: await page
      .getByRole("link", { name: "Open actual Slack message" })
      .getAttribute("href"),
  }),
);
await page.waitForFunction(
  () =>
    JSON.parse(localStorage.getItem("clearpath-relay-v1") || "[]").find(
      (s) => s.id === "CP-1041",
    )?.status === "Changes requested",
  {},
  { timeout: 180000 },
);
let result = await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("clearpath-relay-v1")).find(
    (s) => s.id === "CP-1041",
  );
  return {
    status: s.status,
    comment: s.comments.at(-1),
    event: s.events.at(-1),
  };
});
console.log(JSON.stringify({ feedbackVerified: result }));
await page.getByRole("button", { name: "Back to workspace" }).click();
await page.getByRole("button", { name: "Pre-approve & hand off" }).click();
await page
  .getByPlaceholder("Give creative the context they need to say yes…")
  .fill(
    "Second handoff to verify that an edit retires the prior Slack buttons.",
  );
await page.getByLabel("I reviewed this exact version").check();
await page
  .getByRole("button", { name: "Pre-approve this version", exact: true })
  .click();
const sendButton = page.getByRole("button", { name: "Send pre-approved fix" });
if (await sendButton.count()) {
  await sendButton.click();
  await page.getByRole("link", { name: "Open actual Slack message" }).waitFor();
}
await page.getByRole("button", { name: "Back to workspace" }).click();
await page.getByRole("button", { name: "Edit copy", exact: true }).click();
await page
  .getByRole("textbox", { name: "headline", exact: true })
  .fill("A new chapter, on your terms.");
await page.getByRole("button", { name: "Save new version" }).click();
await page.waitForTimeout(5500);
const supersede = await page.evaluate(async () => {
  const store = JSON.parse(sessionStorage.getItem("clearpath-live-slack-v1"));
  const link = store.links["CP-1041"];
  if (!link?.proposal) return { skipped: true };
  const response = await fetch(
    `${store.endpoint}/v1/proposals/${link.proposal.id}`,
    { headers: { Authorization: `Bearer ${store.session.token}` } },
  );
  const proposal = await response.json();
  return {
    status: proposal.status,
    version: proposal.sourceSnapshot?.assetVersion.id,
  };
});
console.log(JSON.stringify({ supersedeVerified: supersede }));
await page.screenshot({ path: ".capture/live-feedback-result.png" });
await writeFile(
  ".capture/live-feedback-evidence.json",
  JSON.stringify({ feedback: result, supersede }, null, 2),
);
await browser.close();
