import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const registeredExamples = {
  card: {
    title: "Everyday card · live upload",
    owner: "Sofia Patel",
    product: "Credit cards",
    channel: "Email",
    audience: "US adults · prospecting",
    placement: "Monthly newsletter · hero",
    copy: "Headline\nMake more of your everyday.\n\nBody copy\nExplore a credit card designed for your everyday purchases.\n\nDisclosure\nSubject to credit approval. See card agreement for rates, fees, and reward terms.\n\nCall to action\nExplore the card",
  },
  loan: {
    title: "Personal loan · live upload",
    owner: "Maya Chen",
    product: "Personal loans",
    channel: "Paid social",
    audience: "US adults · existing customers",
    placement: "Instagram feed · portrait creative",
    copy: "Headline\nBig plans. Guaranteed approval.\n\nBody copy\nGet the funds you need, whatever your credit score. Your next chapter starts today.\n\nDisclosure\nApply online. Terms apply.\n\nCall to action\nGet approved today",
  },
  mortgage: {
    title: "Homewise · November launch",
    owner: "Jordan Lee",
    product: "Mortgage prequalification",
    channel: "Affiliate partner",
    audience: "California adults · first-time homebuyers",
    placement: "Homewise · landing-page hero",
    copy: "Headline\nYour new home. Already approved.\n\nBody copy\nPrequalify today and start shopping with a guaranteed mortgage.\n\nClearPath FINANCIAL; Homewise · California\n\nDisclosure\nPrequalification is not a commitment to lend. Subject to verification and underwriting.\n\nCall to action\nFind your home",
  },
};

async function fillRegisteredDetails(
  page: Page,
  sample: keyof typeof registeredExamples,
  owner?: string,
) {
  const details = registeredExamples[sample];
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Campaign name").fill(details.title);
  await dialog
    .getByLabel("Creative owner")
    .selectOption(owner || details.owner);
  await dialog
    .getByRole("combobox", { name: "Product", exact: true })
    .selectOption(details.product);
  await dialog
    .getByRole("combobox", { name: "Channel", exact: true })
    .selectOption(details.channel);
  await dialog
    .getByRole("textbox", { name: "Audience", exact: true })
    .fill(details.audience);
  await dialog
    .getByRole("textbox", { name: "Placement", exact: true })
    .fill(details.placement);
  await dialog
    .getByRole("combobox", { name: "Affiliate partner", exact: true })
    .selectOption(sample === "mortgage" ? "Homewise" : "None");
  await dialog.getByLabel("Creative copy", { exact: true }).fill(details.copy);
}

async function expectRasterPreview(dataUrl: string, sourcePath: string) {
  const source = await readFile(sourcePath);
  const preview = Buffer.from(dataUrl.split(",")[1], "base64");
  expect([...preview.subarray(0, 8)]).toEqual([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);
  expect(preview.readUInt32BE(16)).toBe(345);
  const expectedHeight = Math.round(
    (345 * source.readUInt32BE(20)) / source.readUInt32BE(16),
  );
  // Upload normalization may round either dimension by one pixel.
  expect(
    Math.abs(preview.readUInt32BE(20) - expectedHeight),
  ).toBeLessThanOrEqual(1);
  expect(preview.length).toBeLessThanOrEqual(500 * 1024);
}

async function submitRegisteredExample(
  page: Page,
  sample: "card" | "loan" | "mortgage",
  owner?: string,
) {
  const prefix =
    sample === "card"
      ? "01-credit-card-clean"
      : sample === "loan"
        ? "02-personal-loan-needs-copy-fix"
        : "03-mortgage-needs-revision";
  await page.goto("./?prepared");
  await page
    .getByRole("button", { name: "New submission", exact: true })
    .click();
  await page
    .getByLabel("Creative image (optional)")
    .setInputFiles(
      sample === "mortgage"
        ? "public/creative/mortgage-original.png"
        : `tests/fixtures/${prefix}.png`,
    );
  await expect(page.getByAltText("Selected creative preview")).toBeVisible();
  await fillRegisteredDetails(page, sample, owner);
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check submission", exact: true })
    .click();
  return page.evaluate(
    (sample) =>
      JSON.parse(localStorage.getItem("clearpath-relay-v1")!).find(
        (item: { registeredUpload?: { sample: string } }) =>
          item.registeredUpload?.sample === sample,
      ),
    sample,
  );
}

async function mockOwnerSlack(page: Page) {
  const endpoint = "https://clearpath-relay-demo.cfireborn.workers.dev";
  const token = "a".repeat(64);
  const state = {
    proposals: [] as any[],
    notifications: [] as any[],
    accepted: false,
    acknowledged: false,
  };
  let proposal: any;
  const notices = new Map<string, any>();
  await page.addInitScript(
    ({ endpoint, token }) => {
      sessionStorage.setItem(
        "clearpath-live-slack-v1",
        JSON.stringify({
          endpoint,
          session: {
            token,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            channel: "owner channels",
          },
          links: {},
          notifications: {},
        }),
      );
    },
    { endpoint, token },
  );
  await page.route(`${endpoint}/v1/**`, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const now = new Date().toISOString();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204 });
    expect(request.headers().authorization).toBe(`Bearer ${token}`);
    if (request.method() === "POST" && path === "/v1/proposals") {
      const body = request.postDataJSON();
      state.proposals.push(body);
      proposal = {
        id: "11111111-2222-4333-8444-555555555555",
        status: "pending",
        delivery: "sent",
        sourceSnapshot: {
          submissionId: body.submissionId,
          assetVersion: body.assetVersion,
        },
        recipient: {
          owner: body.owner,
          slackUserId: "U123456789",
          displayName: "Charlie",
          isProxy: true,
        },
        slackMessageUrl: "https://app.slack.com/archives/C_MAYA/p123",
        createdAt: now,
        updatedAt: now,
        decidedAt: null,
        decidedBy: null,
        feedback: null,
      };
      return route.fulfill({ status: 201, json: proposal });
    }
    if (request.method() === "GET" && path.startsWith("/v1/proposals/"))
      return route.fulfill({
        json: state.accepted
          ? {
              ...proposal,
              status: "accepted",
              decidedAt: now,
              decidedBy: "U123456789",
            }
          : proposal,
      });
    if (request.method() === "POST" && path === "/v1/notifications") {
      const body = request.postDataJSON();
      state.notifications.push(body);
      const id =
        body.kind === "approved"
          ? "22222222-2222-4333-8444-555555555555"
          : "33333333-2222-4333-8444-555555555555";
      const notice = {
        id,
        kind: body.kind,
        status:
          body.kind === "revision_requested"
            ? "awaiting_acknowledgment"
            : "noted",
        delivery: "sent",
        sourceSnapshot: {
          submissionId: body.submissionId,
          assetVersion: body.assetVersion,
        },
        recipient: {
          owner: body.owner,
          slackUserId: "U123456789",
          displayName: "Charlie",
          isProxy: true,
        },
        slackMessageUrl: `https://app.slack.com/archives/C_OWNER/${id}`,
        createdAt: now,
        updatedAt: now,
        acknowledgedAt: null,
        acknowledgedBy: null,
      };
      notices.set(id, notice);
      return route.fulfill({ status: 201, json: notice });
    }
    if (request.method() === "GET" && path.startsWith("/v1/notifications/")) {
      const notice = notices.get(path.split("/").at(-1)!);
      return route.fulfill({
        json: state.acknowledged
          ? {
              ...notice,
              status: "acknowledged",
              acknowledgedAt: now,
              acknowledgedBy: "U123456789",
            }
          : notice,
      });
    }
    throw new Error(
      `Unexpected mocked Slack request ${request.method()} ${path}`,
    );
  });
  return state;
}

async function fillSubmission(page: Page) {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Campaign name").fill("Uploaded mortgage creative");
  await dialog
    .getByLabel("Creative copy", { exact: true })
    .fill(
      "Headline\nYour new home. Already approved.\n\nBody copy\nPrequalify today and start shopping with a guaranteed mortgage.\n\nDisclosure\nPrequalification is not a commitment to lend. Subject to verification and underwriting.\n\nCall to action\nFind your home",
    );
}

test("a real PNG upload creates a bound browser-local image, survives reload, and returns for revision", async ({
  page,
}) => {
  await page.goto("./?workspace&prepared");
  await page.getByRole("button", { name: "New submission" }).click();
  await page
    .getByLabel("Creative image (optional)")
    .setInputFiles("public/creative/mortgage-original.png");
  await expect(page.getByAltText("Selected creative preview")).toBeVisible();
  await fillSubmission(page);
  await page.screenshot({ path: ".capture/upload-form.png", fullPage: true });
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Personal loans · Instagram feed · portrait creative for review",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: ".capture/upload-review.png", fullPage: true });
  await expect(
    page.getByRole("heading", {
      name: "Uploaded image · visual review required",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Try an example fix" }),
  ).toHaveCount(0);
  const stored = await page.evaluate(() => {
    const item = JSON.parse(localStorage.getItem("clearpath-relay-v1")!).find(
      (value: { title: string }) =>
        value.title === "Uploaded mortgage creative",
    );
    const reference = item.versions[0].content.image;
    return {
      reference,
      data: localStorage.getItem(`clearpath-upload:${reference.slice(7)}`),
      version: item.versions[0],
    };
  });
  expect(stored.reference).toMatch(/^upload:[a-f0-9]{64}$/);
  expect(stored.reference.length).toBeLessThan(100);
  expect(stored.data).toMatch(/^data:image\/jpeg;base64,/);
  expect(stored.data!.length).toBeLessThan(410000);
  expect(stored.version.content.cta).toBe("Find your home");
  await page.reload();
  await page
    .getByRole("button", { name: /Uploaded mortgage creative CP-/ })
    .click();
  await expect(page.locator(".asset-canvas .asset img")).toHaveJSProperty(
    "naturalWidth",
    800,
  );
  await page.getByRole("button", { name: "Read transcribed copy" }).click();
  await expect(
    page.getByRole("textbox", { name: "Creative copy", exact: true }),
  ).toHaveAttribute("readonly", "");
  await expect(
    page.getByText("This copy is recorded with the image", {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Return for revision", exact: true })
    .click();
  await page
    .getByLabel("What needs to change?")
    .fill(
      "Remove the approval guarantee and provide affiliate review evidence.",
    );
  await page
    .getByRole("button", { name: "Return to Maya", exact: true })
    .click();
  await expect(
    page.getByText("Next action owner: Maya Chen.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Revision saved in this browser. No Slack message was sent.",
    ),
  ).toBeVisible();
  const result = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("clearpath-relay-v1")!).find(
      (value: { title: string }) =>
        value.title === "Uploaded mortgage creative",
    ),
  );
  expect(result.status).toBe("Revision requested");
  expect(result.approvedVersionId).toBeUndefined();
  expect(result.versions[0].content.image).toBe(stored.reference);
  expect(result.comments.at(-1).text).toContain("approval guarantee");
});

test("uploaded image reaches the mocked Slack handoff as a rendered PNG with its exact hash reference", async ({
  page,
}) => {
  const endpoint = "https://clearpath-relay-demo.cfireborn.workers.dev";
  await page.addInitScript(
    ({ endpoint }) => {
      sessionStorage.setItem(
        "clearpath-live-slack-v1",
        JSON.stringify({
          endpoint,
          session: {
            token: "a".repeat(64),
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
            channel: "#relay-demo",
          },
          links: {},
          notifications: {},
        }),
      );
    },
    { endpoint },
  );
  let sent: any;
  let notice: any;
  await page.route(`${endpoint}/v1/notifications**`, async (route) => {
    if (route.request().method() === "POST") {
      sent = route.request().postDataJSON();
      notice = {
        id: "118e8d10-0a3e-49de-8d47-f22771480df0",
        kind: "revision_requested",
        status: "awaiting_acknowledgment",
        delivery: "sent",
        sourceSnapshot: {
          submissionId: sent.submissionId,
          assetVersion: sent.assetVersion,
        },
        slackMessageUrl:
          "https://charlie-assistants.slack.com/archives/CDEMO/p123",
        recipient: {
          owner: sent.owner,
          slackUserId: "U12345678",
          displayName: "Charlie",
          isProxy: true,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        acknowledgedAt: null,
        acknowledgedBy: null,
      };
    }
    await route.fulfill({ json: notice });
  });
  await page.goto("./?workspace&prepared");
  await page.getByRole("button", { name: "New submission" }).click();
  await page
    .getByLabel("Creative image (optional)")
    .setInputFiles("public/creative/mortgage-original.png");
  await expect(page.getByAltText("Selected creative preview")).toBeVisible();
  await fillSubmission(page);
  await page.getByRole("button", { name: "Submit for review" }).click();
  await page
    .getByRole("button", { name: "Return for revision", exact: true })
    .click();
  await page
    .getByLabel("What needs to change?")
    .fill("Remove the approval guarantee from the artwork.");
  await page
    .getByRole("button", { name: "Return to Maya", exact: true })
    .click();
  await expect(
    page.getByText("Revision request delivered to Charlie", { exact: false }),
  ).toBeVisible();
  expect(sent.assetVersion.content.image).toMatch(/^upload:[a-f0-9]{64}$/);
  expect(sent.assetVersion.content.image.length).toBe(71);
  const png = Buffer.from(sent.assetImage.split(",")[1], "base64");
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.length).toBeLessThanOrEqual(500 * 1024);
  expect(sent.note).toBe("Remove the approval guarantee from the artwork.");
});

test("valid JPEG works while corrupt images and unavailable cached images fail clearly", async ({
  page,
}) => {
  await page.goto("./?workspace&prepared");
  await page.getByRole("button", { name: "New submission" }).click();
  await page.getByLabel("Creative image (optional)").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.getByRole("alert")).toContainText("valid PNG or JPEG");
  await expect(
    page.getByRole("button", { name: "Submit for review" }),
  ).toBeDisabled();
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 480;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#184f40";
    context.fillRect(0, 0, 320, 480);
    context.fillStyle = "#ffffff";
    context.font = "20px sans-serif";
    context.fillText("Review this creative", 20, 60);
    return canvas.toDataURL("image/jpeg").split(",")[1];
  });
  await page.getByLabel("Creative image (optional)").setInputFiles({
    name: "creative.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(jpeg, "base64"),
  });
  await expect(page.getByAltText("Selected creative preview")).toBeVisible();
  await fillSubmission(page);
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.locator(".asset-canvas .asset img")).toHaveJSProperty(
    "naturalWidth",
    320,
  );
  await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((key) => key.startsWith("clearpath-upload:"))
      .forEach((key) => localStorage.removeItem(key)),
  );
  await page.reload();
  await page
    .getByRole("button", { name: /Uploaded mortgage creative CP-/ })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Uploaded image unavailable",
  );
  await page
    .getByRole("button", { name: "Approve original as submitted" })
    .click();
  await page
    .getByLabel("Decision rationale")
    .fill("Reviewed the image manually.");
  await page
    .getByLabel("I reviewed this exact version and its intended use.")
    .check();
  await page
    .getByRole("button", { name: "Approve this version", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText(
        "The uploaded image is unavailable. Restore the image in a new submission before making a decision.",
      ),
  ).toBeVisible();
});

test("guided intake records form details and presents five findings with editable return comments", async ({
  page,
}) => {
  await page.goto("./?prepared");
  await page
    .getByRole("button", { name: "New submission", exact: true })
    .click();
  await page
    .getByLabel("Creative image (optional)")
    .setInputFiles("public/creative/mortgage-original.png");
  await expect(page.getByAltText("Selected creative preview")).toBeVisible();
  await page.getByLabel("Campaign name").fill("Form-entered creative");
  await page.getByLabel("Creative owner").selectOption("Jordan Lee");
  await page
    .getByRole("combobox", { name: "Product", exact: true })
    .selectOption("Mortgage prequalification");
  await page
    .getByRole("combobox", { name: "Channel", exact: true })
    .selectOption("Affiliate partner");
  await page
    .getByRole("textbox", { name: "Audience", exact: true })
    .fill("California adults");
  await page
    .getByRole("textbox", { name: "Placement", exact: true })
    .fill("Homewise hero");
  await page
    .getByRole("combobox", { name: "Jurisdiction", exact: true })
    .selectOption("California");
  await page
    .getByRole("combobox", { name: "Affiliate partner", exact: true })
    .selectOption("Homewise");
  await page
    .getByLabel("Creative copy", { exact: true })
    .fill(
      "Headline\nAlready approved\n\nBody copy\nA guaranteed mortgage\n\nDisclosure\nPrequalification is not a commitment to lend. Subject to verification and underwriting.\n\nCall to action\nExplore prequalification",
    );
  await expect(page.getByLabel("Creative owner")).toHaveValue("Jordan Lee");
  await expect(page.getByLabel("Creative copy", { exact: true })).toContainText(
    "Already approved",
  );
  await expect(
    page.getByRole("textbox", { name: "Headline", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check submission", exact: true })
    .click();
  await expect(
    page.getByLabel("Submission check results").locator("details"),
  ).toHaveCount(5);
  await expect(page.getByLabel("Submission check results")).toContainText(
    "Change required",
  );
  await expect(
    page.getByRole("button", { name: "Pre-approve & hand off" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Approve original as submitted" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Return for revision", exact: true })
    .click();
  await expect(page.getByLabel("What needs to change?")).toHaveValue(
    /Remove the approval guarantee/,
  );
  const item = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("clearpath-relay-v1")!).find(
      (row: { title: string }) => row.title === "Form-entered creative",
    ),
  );
  expect(item.checkReport.canApprove).toBe(false);
  expect(item.reviewEvidence).toBeUndefined();
  expect(item.approvedVersionId).toBeUndefined();
  expect(item.versions[0].scope).toMatchObject({
    product: "Mortgage prequalification",
    channel: "Affiliate partner",
    audience: "California adults",
    placement: "Homewise hero",
    jurisdiction: "California",
    affiliatePartner: "Homewise",
  });
});

test("intake marks required fields, keeps image-only submission valid, and offers no text-file import", async ({
  page,
}) => {
  await page.goto("./?workspace&prepared");
  await page
    .getByRole("button", { name: "New submission", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".ns-required-legend")).toHaveText("* Required");
  const requiredFields = [
    dialog.getByRole("textbox", { name: "Campaign name", exact: true }),
    dialog.getByRole("combobox", { name: "Creative owner", exact: true }),
    dialog.getByRole("combobox", { name: "Product", exact: true }),
    dialog.getByRole("combobox", { name: "Channel", exact: true }),
    dialog.getByRole("textbox", { name: "Audience", exact: true }),
    dialog.getByRole("textbox", { name: "Placement", exact: true }),
    dialog.getByRole("combobox", { name: "Jurisdiction", exact: true }),
    dialog.getByRole("combobox", { name: "Affiliate partner", exact: true }),
    dialog.getByRole("textbox", { name: "Creative copy", exact: true }),
  ];
  for (const field of requiredFields) {
    await expect(field).toHaveAttribute("required", "");
    await expect(field).toHaveAttribute("aria-required", "true");
    const marker = field.locator("..").locator(".ns-required");
    await expect(marker).toHaveText("*");
    await expect(marker).toHaveCSS("color", "rgb(180, 35, 24)");
    await expect(marker).toHaveAttribute("aria-hidden", "true");
  }
  await expect(
    dialog.getByLabel("Import submission details (.txt)"),
  ).toHaveCount(0);
  await expect(dialog.locator('input[type="file"]')).toHaveCount(1);
  await expect(dialog.locator('input[type="file"]')).toHaveAttribute(
    "accept",
    "image/png,image/jpeg",
  );
  await expect(dialog.locator('input[type="file"]')).not.toHaveAttribute(
    "required",
  );
  await expect(dialog.locator('input[type="file"]')).toHaveAttribute(
    "aria-required",
    "false",
  );
  await expect(
    dialog.locator('input[type="file"]').locator("..").locator(".ns-required"),
  ).toHaveCount(0);
  await dialog.getByLabel("Campaign name").fill("Image-only intake");
  await expect(
    dialog.getByRole("button", { name: "Submit for review", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Creative image (optional)")
    .setInputFiles("public/creative/mortgage-original.png");
  await expect(dialog.getByAltText("Selected creative preview")).toBeVisible();
  await dialog
    .getByRole("combobox", { name: "Jurisdiction", exact: true })
    .selectOption("California");
  await dialog
    .getByRole("combobox", { name: "Affiliate partner", exact: true })
    .selectOption("Homewise");
  await expect(
    dialog.getByRole("combobox", { name: "Channel", exact: true }),
  ).toHaveValue("Affiliate partner");
  await expect(dialog.getByLabel("Creative copy", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    dialog.getByLabel("Creative copy", { exact: true }),
  ).not.toHaveAttribute("required");
  await expect(
    dialog.getByLabel("Creative copy", { exact: true }),
  ).toHaveAttribute("aria-required", "false");
  await expect(
    dialog
      .getByLabel("Creative copy", { exact: true })
      .locator("..")
      .locator(".ns-required"),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Remove image", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Creative copy", { exact: true }),
  ).toHaveAttribute("required", "");
  await expect(
    dialog.getByLabel("Creative copy", { exact: true }),
  ).toHaveAttribute("aria-required", "true");
  await expect(
    dialog
      .getByLabel("Creative copy", { exact: true })
      .locator("..")
      .locator(".ns-required"),
  ).toHaveText("*");
  await expect(
    dialog.getByRole("button", { name: "Submit for review", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Creative image (optional)")
    .setInputFiles("public/creative/mortgage-original.png");
  await expect(dialog.getByAltText("Selected creative preview")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Submit for review", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  const submission = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("clearpath-relay-v1")!).find(
      (item: { title: string }) => item.title === "Image-only intake",
    ),
  );
  expect(submission.status).toBe("Needs review");
  expect(submission.versions[0].content).toMatchObject({
    headline: "",
    body: "",
    cta: "",
    disclosure: "",
  });
  expect(submission.versions[0].content.image).toMatch(/^upload:[a-f0-9]{64}$/);
  expect(submission.versions[0].scope).toMatchObject({
    jurisdiction: "California",
    affiliatePartner: "Homewise",
    channel: "Affiliate partner",
  });
  expect(submission.versions[0].note).toContain(
    "image submitted for visual assessment",
  );
});

test("unavailable OCR offers manual fallback and image changes cancel pending extraction on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.abort());
  await page.goto("./?workspace&prepared");
  await page
    .getByRole("button", { name: "New submission", exact: true })
    .click();
  await page
    .getByLabel("Creative image (optional)")
    .setInputFiles("public/creative/mortgage-original.png");
  await expect(page.getByAltText("Selected creative preview")).toBeVisible();
  await page
    .getByRole("button", { name: "Extract text from image", exact: true })
    .click();
  await expect(
    page.getByText("Text extraction could not finish.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Extract text from image", exact: true })
    .click();
  await page
    .getByLabel("Creative copy", { exact: true })
    .fill("Keep my manual correction");
  await page.getByRole("button", { name: "Remove image", exact: true }).click();
  await expect(page.getByLabel("Creative copy", { exact: true })).toHaveValue(
    "Keep my manual correction",
  );
  await expect(
    page.getByRole("button", { name: "Cancel extraction", exact: true }),
  ).toHaveCount(0);
  const dimensions = await page.getByRole("dialog").evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
});

test("failed English-model download offers fallback without waiting for the OCR timeout", async ({
  page,
}) => {
  let blockedModel = false;
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/eng.traineddata.gz", (route) => {
    blockedModel = true;
    return route.abort();
  });
  await page.goto("./?prepared");
  await page
    .getByRole("button", { name: "New submission", exact: true })
    .click();
  await page
    .getByLabel("Creative image (optional)")
    .setInputFiles("public/creative/mortgage-original.png");
  await expect(page.getByAltText("Selected creative preview")).toBeVisible();
  await page
    .getByRole("button", { name: "Extract text from image", exact: true })
    .click();
  await expect(
    page.getByText("Text extraction could not finish.", { exact: false }),
  ).toBeVisible({ timeout: 10_000 });
  expect(blockedModel).toBe(true);
  await expect(
    page.getByRole("button", { name: "Cancel extraction", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Campaign name").fill("Manual fallback");
  await page
    .getByLabel("Creative copy", { exact: true })
    .fill("Copy confirmed against the uploaded image.");
  await expect(
    page.getByRole("button", { name: "Submit for review", exact: true }),
  ).toBeEnabled();
  expect(pageErrors).toEqual([]);
});

test("new Sofia card upload clears registered checks and sends exact-v1 approval", async ({
  page,
}) => {
  const slack = await mockOwnerSlack(page);
  const item = await submitRegisteredExample(page, "card");
  expect(item.id).not.toBe("CP-1040");
  expect(item.owner).toBe("Sofia Patel");
  expect(item.checkReport.canApprove).toBe(true);
  expect(item.checkReport.checks).toHaveLength(5);
  await page
    .getByRole("button", { name: "Approve v1 & notify Sofia", exact: true })
    .click();
  await expect(
    page.getByText("Approval notice delivered to Charlie", { exact: false }),
  ).toBeVisible();
  const sent = slack.notifications.find((notice) => notice.kind === "approved");
  expect(sent).toMatchObject({
    submissionId: item.id,
    owner: "Sofia Patel",
    assetVersion: {
      id: 1,
      content: { image: item.versions[0].content.image },
      scope: item.versions[0].scope,
    },
  });
  expect(sent.assetImage).toMatch(/^data:image\/png;base64,/);
  await expectRasterPreview(
    sent.assetImage,
    "tests/fixtures/01-credit-card-clean.png",
  );
  const approved = await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("clearpath-relay-v1")!).find(
        (item: { id: string }) => item.id === id,
      ),
    item.id,
  );
  expect(approved.status).toBe("Approved");
  expect(approved.approvedVersionId).toBe(1);
  await page.screenshot({
    path: ".capture/intake-card-approved.png",
    fullPage: true,
  });
});

test("new Maya loan upload produces a real fixed image v2 and accepts only that Slack proposal", async ({
  page,
}) => {
  const slack = await mockOwnerSlack(page);
  const item = await submitRegisteredExample(page, "loan");
  expect(item.id).not.toBe("CP-1042");
  expect(item.checkReport.canApprove).toBe(false);
  expect(item.checkReport.canSuggestFix).toBe(true);
  await expect(page.getByLabel("Comments for creative")).toHaveValue(
    /Remove the guaranteed-approval claim/,
  );
  await page
    .getByRole("button", { name: "Submit feedback & draft a fix", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Compare versions", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.locator('.compare-assets img[src$="loan-fixed.png"]'),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pre-approve & hand off", exact: true })
    .click();
  const decision = page.getByRole("dialog");
  await decision
    .getByLabel("What changed, and why?")
    .fill(
      "Removed the approval guarantee and added the complete product qualifier in this corrected image.",
    );
  await decision
    .getByLabel("I reviewed this exact version and its intended use.")
    .check();
  await decision
    .getByRole("button", { name: "Pre-approve this version", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Send pre-approved fix", exact: true })
    .click();
  await expect(
    page.getByText("Sent to Slack. Waiting for creative’s decision", {
      exact: false,
    }),
  ).toBeVisible();
  expect(slack.proposals).toHaveLength(1);
  await expectRasterPreview(
    slack.proposals[0].assetImage,
    "public/creative/loan-fixed.png",
  );
  expect(slack.proposals[0]).toMatchObject({
    submissionId: item.id,
    owner: "Maya Chen",
    assetVersion: {
      id: 2,
      content: {
        image: "creative/loan-fixed.png",
        headline: "A little breathing room.",
      },
      scope: item.versions[0].scope,
    },
    originalContent: { image: item.versions[0].content.image },
  });
  slack.accepted = true;
  await expect(
    page
      .getByRole("dialog")
      .getByText("Accepted in Slack. This exact version is approved.", {
        exact: true,
      }),
  ).toBeVisible({ timeout: 10000 });
  const approved = await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("clearpath-relay-v1")!).find(
        (item: { id: string }) => item.id === id,
      ),
    item.id,
  );
  expect(approved.status).toBe("Approved");
  expect(approved.approvedVersionId).toBe(2);
  expect(approved.versions).toHaveLength(2);
  expect(approved.versions[0].content.image).toBe(
    item.versions[0].content.image,
  );
  expect(approved.versions[0].content.headline).toContain(
    "Guaranteed approval",
  );
  expect(approved.generationRequests).toHaveLength(1);
  expect(
    approved.comments.some(
      (comment: { field: string }) =>
        comment.field === "Spec · misleading-claim",
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".capture/intake-loan-accepted.png",
    fullPage: true,
  });
});

test("new Jordan mortgage upload returns unresolved evidence comments and acknowledgment cannot approve it", async ({
  page,
}) => {
  const slack = await mockOwnerSlack(page);
  const item = await submitRegisteredExample(page, "mortgage");
  expect(item.id).not.toBe("CP-1041");
  await page
    .getByRole("button", { name: "Submit feedback & draft a fix", exact: true })
    .click();
  await expect(
    page.locator('.compare-assets img[src$="mortgage-fixed.png"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pre-approve & hand off", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Return for revision", exact: true })
    .click();
  await expect(page.getByLabel("What needs to change?")).toHaveValue(
    /California targeting is explicit/,
  );
  await expect(page.getByLabel("What needs to change?")).toHaveValue(
    /verified affiliate entity/,
  );
  await page
    .getByRole("button", { name: "Return to Jordan", exact: true })
    .click();
  await expect(
    page.getByText("Revision request delivered to Charlie", { exact: false }),
  ).toBeVisible();
  const sent = slack.notifications.find(
    (notice) => notice.kind === "revision_requested",
  );
  expect(sent).toMatchObject({
    submissionId: item.id,
    owner: "Jordan Lee",
    assetVersion: {
      id: 2,
      content: { image: "creative/mortgage-fixed.png" },
      scope: item.versions[0].scope,
    },
  });
  expect(sent.note).toContain("State applicability");
  await expectRasterPreview(
    sent.assetImage,
    "public/creative/mortgage-fixed.png",
  );
  expect(sent.note).toContain("Affiliate identity");
  slack.acknowledged = true;
  await expect(
    page.getByText("Receipt acknowledged by Charlie", { exact: false }),
  ).toBeVisible({ timeout: 10000 });
  const returned = await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("clearpath-relay-v1")!).find(
        (item: { id: string }) => item.id === id,
      ),
    item.id,
  );
  expect(returned.status).toBe("Revision requested");
  expect(returned.approvedVersionId).toBeUndefined();
  expect(returned.proposalVersionId).toBeUndefined();
  expect(returned.versions[0].content.image).toBe(
    item.versions[0].content.image,
  );
  expect(slack.proposals).toHaveLength(0);
  await page.screenshot({
    path: ".capture/intake-mortgage-acknowledged.png",
    fullPage: true,
  });
});

test("a lookalike file with the sample filename cannot inherit its checks or prepared fix", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./?prepared");
  await page
    .getByRole("button", { name: "New submission", exact: true })
    .click();
  // The image decoder accepts trailing bytes, but the raw-file digest changes.
  await page.getByLabel("Creative image (optional)").setInputFiles({
    name: "01-credit-card-clean.png",
    mimeType: "image/png",
    buffer: Buffer.concat([
      await readFile("tests/fixtures/01-credit-card-clean.png"),
      Buffer.from([0]),
    ]),
  });
  await expect(page.getByAltText("Selected creative preview")).toBeVisible();
  await fillRegisteredDetails(page, "card", "Jordan Lee");
  await expect(page.getByLabel("Campaign name")).toHaveValue(
    "Everyday card · live upload",
  );
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check submission", exact: true })
    .click();
  const item = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("clearpath-relay-v1")!).find(
      (row: { title: string }) => row.title === "Everyday card · live upload",
    ),
  );
  expect(item.owner).toBe("Jordan Lee");
  expect(item.registeredUpload).toBeUndefined();
  expect(item.reviewEvidence).toBeUndefined();
  expect(item.checkReport.canApprove).toBe(false);
  expect(item.checkReport.canSuggestFix).toBe(false);
  await expect(page.getByRole("button", { name: /Approve v1/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Submit feedback & draft a fix",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("preparing a registered image correction locks scope until the new version is ready", async ({
  page,
}) => {
  const item = await submitRegisteredExample(page, "loan");
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page
    .getByRole("button", { name: "Submit feedback & draft a fix", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit scope", exact: true }),
  ).toBeDisabled();
  await page.clock.runFor(1000);
  await expect(
    page.getByRole("tab", { name: "Compare versions", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const updated = await page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("clearpath-relay-v1")!).find(
        (item: { id: string }) => item.id === id,
      ),
    item.id,
  );
  expect(updated.versions).toHaveLength(2);
  expect(updated.versions[1].scope).toEqual(item.versions[0].scope);
  await page.getByRole("tab", { name: "Asset & edits", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Edit scope", exact: true }),
  ).toBeEnabled();
});

test("an unregistered wide banner preserves its proportions and receives a manual approval without claiming automatic checks passed", async ({
  page,
}) => {
  const slack = await mockOwnerSlack(page);
  await page.goto("./?workspace&prepared");
  await page
    .getByRole("button", { name: "New submission", exact: true })
    .click();
  const banner = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1000;
    canvas.height = 200;
    const context = canvas.getContext("2d")!;
    const gradient = context.createLinearGradient(0, 0, 1000, 0);
    gradient.addColorStop(0, "#18493e");
    gradient.addColorStop(1, "#f5dfb5");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1000, 200);
    return canvas.toDataURL("image/png");
  });
  await page.getByLabel("Creative image (optional)").setInputFiles({
    name: "wide-banner.png",
    mimeType: "image/png",
    buffer: Buffer.from(banner.split(",")[1], "base64"),
  });
  await expect(page.getByAltText("Selected creative preview")).toBeVisible();
  await fillSubmission(page);
  await page
    .getByRole("button", { name: "Submit for review", exact: true })
    .click();
  const rendered = await page
    .locator(".asset-canvas .asset-image")
    .boundingBox();
  expect(rendered).not.toBeNull();
  expect(Math.abs(rendered!.height - rendered!.width / 5)).toBeLessThan(1);
  await page
    .getByRole("button", { name: "Approve original as submitted", exact: true })
    .click();
  await page
    .getByLabel("Decision rationale")
    .fill("Manual visual review and intended-use decision recorded by Alex.");
  await page
    .getByLabel("I reviewed this exact version and its intended use.")
    .check();
  await page
    .getByRole("button", { name: "Approve this version", exact: true })
    .click();
  await expect(
    page.getByText("Approval notice delivered to Charlie", { exact: false }),
  ).toBeVisible();
  const item = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("clearpath-relay-v1")!).find(
      (item: { title: string }) => item.title === "Uploaded mortgage creative",
    ),
  );
  expect(item.registeredUpload).toBeUndefined();
  expect(item.checkReport).toBeUndefined();
  expect(item.status).toBe("Approved");
  expect(item.approvedVersionId).toBe(1);
  const preview = Buffer.from(
    slack.notifications[0].assetImage.split(",")[1],
    "base64",
  );
  expect(preview.readUInt32BE(16)).toBe(345);
  expect(preview.readUInt32BE(20)).toBe(69);
  expect(
    slack.notifications.find((notice) => notice.kind === "approved").note,
  ).toBe("Manual visual review and intended-use decision recorded by Alex.");
});
