import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright";
import {
  ARTIFACTS_DIR,
  BROWSER_CHANNEL,
  CHECKIN_URL,
  GOOGLE_SSO_URL,
  LOGIN_BUTTON_NAME,
  LOGIN_URL,
  NAVIGATION_TIMEOUT_MS,
  PROFILE_DIR,
} from "./config.js";
import { saveFailureArtifacts } from "./artifacts.js";
import { buildEndStudyTargetDate } from "./end-time.js";
import { promptForGoogleEmail, promptForGooglePassword } from "./prompt.js";

const ACCOUNT_CHOOSER_PATTERN = /(\uACC4\uC815 \uC120\uD0DD|Choose an account)/i;
const NEXT_BUTTON_PATTERN = /^(\uB2E4\uC74C|Next)$/i;
const START_BUTTON_PATTERN = /^(\uC2DC\uC791\uD558\uAE30|Get started)$/i;
const CONSENT_BUTTON_PATTERN = /^(\uACC4\uC18D|Continue|\uD5C8\uC6A9|Allow)$/i;
const LOGIN_FLOW_TIMEOUT_MS = 600_000;
const START_STUDY_BUTTON_NAME = "\uD559\uC2B5 \uC2DC\uC791";
const END_STUDY_BUTTON_NAME = "\uD559\uC2B5 \uC885\uB8CC";
const STUDY_COMPLETED_BUTTON_NAME = "\uD559\uC2B5 \uC644\uB8CC";
const CHECKIN_REFRESH_INTERVAL_MS = 30_000;
const START_STUDY_ENABLE_TIMEOUT_MS = 120 * 60_000;
const END_STUDY_ENABLE_TIMEOUT_MS = 120 * 60_000;
const START_STUDY_CONFIRM_TIMEOUT_MS = 20_000;
const END_STUDY_CONFIRM_TIMEOUT_MS = 20_000;

function logStep(message) {
  console.log(`[login] ${message}`);
}

function inspectLog(message) {
  console.log(`[inspect] ${message}`);
}

function startStudyLog(message) {
  console.log(`[start-study] ${message}`);
}

function studyDayLog(message) {
  console.log(`[study-day] ${message}`);
}

function endStudyLog(message) {
  console.log(`[end-study] ${message}`);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatLocalDateTime(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

async function ensureDirectories() {
  await fs.mkdir(PROFILE_DIR, { recursive: true });
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findChromeExecutable() {
  const roots = [
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA,
  ].filter(Boolean);

  for (const root of roots) {
    const candidate = path.join(root, "Google", "Chrome", "Application", "chrome.exe");
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error("Chrome executable was not found. Install Chrome or update the launcher path.");
}

async function isVisible(locator, timeout = 500) {
  return locator.isVisible({ timeout }).catch(() => false);
}

async function isLocatorDisabled(locator) {
  const nativeDisabled = await locator.isDisabled().catch(() => false);
  const ariaDisabled = await locator.getAttribute("aria-disabled").catch(() => null);
  return nativeDisabled || ariaDisabled === "true";
}

function getStartStudyButton(page) {
  return page.getByRole("button", { name: START_STUDY_BUTTON_NAME });
}

function getEndStudyButton(page) {
  return page.getByRole("button", { name: END_STUDY_BUTTON_NAME });
}

function getCompletedStudyButton(page) {
  return page.getByRole("button", { name: STUDY_COMPLETED_BUTTON_NAME });
}

async function launchContext() {
  await ensureDirectories();
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: BROWSER_CHANNEL,
    headless: false,
    viewport: { width: 1440, height: 960 },
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled"],
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });

    Object.defineProperty(navigator, "languages", {
      get: () => ["ko-KR", "ko", "en-US", "en"],
    });

    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });

    window.chrome = window.chrome || { runtime: {} };
  });

  return context;
}

async function gotoWithTimeout(page, url, waitUntil = "domcontentloaded") {
  return page.goto(url, { timeout: NAVIGATION_TIMEOUT_MS, waitUntil });
}

async function isLoginButtonVisible(page) {
  const button = page.getByRole("button", { name: LOGIN_BUTTON_NAME });

  try {
    return await button.isVisible({ timeout: 2_000 });
  } catch {
    return false;
  }
}

async function hasJungleCookie(context) {
  const cookies = await context.cookies("https://jungle-lms.krafton.com");
  return cookies.length > 0;
}

async function isLoggedIn(page, context) {
  const loginVisible = await isLoginButtonVisible(page);
  const cookiePresent = await hasJungleCookie(context);
  const currentUrl = page.url();
  const onLoginPage = currentUrl.startsWith(LOGIN_URL);

  return !loginVisible && cookiePresent && !onLoginPage;
}

async function clickGoogleContinue(page) {
  logStep("Clicking Google SSO button.");
  await page.getByRole("button", { name: LOGIN_BUTTON_NAME }).click();
}

async function clickVisibleNext(page) {
  const nextButton = page.getByRole("button", { name: NEXT_BUTTON_PATTERN }).first();
  if (await isVisible(nextButton)) {
    await nextButton.click();
    return true;
  }

  return false;
}

async function maybeSelectGoogleAccount(page, emailHint) {
  const chooserTitle = page.getByText(ACCOUNT_CHOOSER_PATTERN);

  try {
    await chooserTitle.waitFor({ timeout: 3_000 });
  } catch {
    return false;
  }

  logStep("Google account chooser detected.");

  if (emailHint) {
    const emailOption = page.getByText(emailHint, { exact: false }).first();
    if (await isVisible(emailOption, 2_000)) {
      await emailOption.click();
      return true;
    }
  }

  const knownAccount = page.locator('[data-identifier], div[role="link"], li').filter({
    hasText: "@",
  }).first();

  if (await isVisible(knownAccount, 2_000)) {
    await knownAccount.click();
    return true;
  }

  return false;
}

async function maybeFillGoogleEmail(page, state) {
  const emailInput = page.locator('input[type="email"]:visible').first();

  if (!(await isVisible(emailInput, 3_000))) {
    return false;
  }

  if (!state.email) {
    state.email = await promptForGoogleEmail();
  }

  logStep("Filling Google email.");
  await emailInput.fill(state.email);

  if (!(await clickVisibleNext(page))) {
    await page.keyboard.press("Enter");
  }

  return true;
}

async function maybeFillGooglePassword(page, state) {
  const passwordInput = page.locator('input[type="password"]:visible').first();

  if (!(await isVisible(passwordInput, 3_000))) {
    return false;
  }

  if (!state.password) {
    state.password = await promptForGooglePassword();
  }

  logStep("Filling Google password.");
  await passwordInput.fill(state.password);

  if (!(await clickVisibleNext(page))) {
    await page.keyboard.press("Enter");
  }

  return true;
}

async function maybeApproveOAuthConsent(page) {
  const consentButton = page.getByRole("button", { name: CONSENT_BUTTON_PATTERN }).first();
  const hasConsentCopy = await isVisible(
    page.getByText(/KRAFTON Jungle|has asked for access|\uC561\uC138\uC2A4|\uAD8C\uD55C/i).first()
  );

  if (!hasConsentCopy) {
    return false;
  }

  if (!(await isVisible(consentButton))) {
    return false;
  }

  logStep("Approving Google OAuth consent.");
  await consentButton.click();
  return true;
}

async function maybeHandleGoogleDevicePrompt(page, state) {
  const currentUrl = new URL(page.url());
  if (currentUrl.pathname !== "/v3/signin/challenge/dp") {
    return false;
  }

  const startButton = page.getByRole("button", { name: START_BUTTON_PATTERN }).first();
  if (await isVisible(startButton)) {
    logStep("Starting Google device approval challenge.");
    await startButton.click();
    return true;
  }

  const hasPromptText = await isVisible(
    page
      .getByText(/YouTube|Apple iPhone|\uC54C\uB9BC\uC744 \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4|\uBA54\uC2DC\uC9C0\uC5D0\uC11C \uC608|Open the YouTube app|Check your phone/i)
      .first()
  );

  if (!hasPromptText) {
    const nextButton = page.getByRole("button", { name: NEXT_BUTTON_PATTERN }).first();
    if (await isVisible(nextButton)) {
      logStep("Advancing Google device approval challenge.");
      await nextButton.click();
      return true;
    }

    return false;
  }

  if (!state.devicePromptAnnounced) {
    logStep("Approve the Google verification prompt on your phone. This window will continue automatically after approval.");
    state.devicePromptAnnounced = true;
  }

  await page.waitForTimeout(5_000);
  return true;
}

async function detectRejectedGooglePage(page) {
  const currentUrl = new URL(page.url());
  if (currentUrl.pathname !== "/v3/signin/rejected") {
    return null;
  }

  const body = (await page.textContent("body").catch(() => "")) ?? "";
  if (/\uB85C\uADF8\uC778\uD560 \uC218 \uC5C6\uC74C|couldn'?t sign you in|browser or app may not be secure|\uC548\uC804\uD558\uC9C0 \uC54A\uC744 \uC218 \uC788\uC2B5\uB2C8\uB2E4/i.test(body)) {
    return "Google rejected the sign-in because the browser/app was treated as insecure.";
  }

  return `Google rejected the sign-in flow. Current URL: ${page.url()}`;
}

async function maybeWaitForManualGoogleChallenge(page, state) {
  const currentUrl = new URL(page.url());
  if (!currentUrl.pathname.startsWith("/v3/signin/challenge/")) {
    return false;
  }

  const hasVisibleEmail = await isVisible(page.locator('input[type="email"]:visible').first());
  const hasVisiblePassword = await isVisible(page.locator('input[type="password"]:visible').first());
  if (hasVisibleEmail || hasVisiblePassword) {
    return false;
  }

  const manualIndicators = [
    page.locator("#captchaimg"),
    page.getByRole("textbox", { name: /\uB4E4\uB9AC\uAC70\uB098 \uD45C\uC2DC\uB41C \uD14D\uC2A4\uD2B8 \uC785\uB825|Enter the text/i }),
    page.getByText(/2-step verification|\u0032\uB2E8\uACC4 \uC778\uC99D/i).first(),
    page.getByText(/Try another way|\uB2E4\uB978 \uBC29\uBC95 \uC2DC\uB3C4/i).first(),
    page.getByText(/Recovery email|\uBCF5\uAD6C \uC774\uBA54\uC77C/i).first(),
    page.getByText(/Enter the code|\uBCF4\uC548 \uCF54\uB4DC\uB97C \uC785\uB825/i).first(),
    page.getByText(/YouTube|Apple iPhone|\uC54C\uB9BC\uC744 \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4|\uBA54\uC2DC\uC9C0\uC5D0\uC11C \uC608/i).first(),
  ];

  let requiresManualAction = false;
  for (const locator of manualIndicators) {
    if (await isVisible(locator)) {
      requiresManualAction = true;
      break;
    }
  }

  if (!requiresManualAction) {
    return false;
  }

  const challengeKey = `${currentUrl.pathname}${currentUrl.search}`;
  if (state.manualChallengeKey !== challengeKey) {
    logStep("Manual Google verification is required in the open browser. Complete the CAPTCHA or approval there; the script will resume automatically.");
    state.manualChallengeKey = challengeKey;
  }

  await page.waitForTimeout(5_000);
  return true;
}

async function probeReusableGoogleSession(page, context) {
  if (await isLoginButtonVisible(page)) {
    logStep("Probing stored Google SSO session.");
    await clickGoogleContinue(page);
  } else if (page.url() !== GOOGLE_SSO_URL) {
    logStep("Probing Google SSO endpoint.");
    await gotoWithTimeout(page, GOOGLE_SSO_URL);
  }

  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    if (page.isClosed()) {
      return false;
    }

    const currentUrl = page.url();
    const { host, pathname } = new URL(currentUrl);

    if (host === "jungle-lms.krafton.com") {
      if (await isLoggedIn(page, context)) {
        return true;
      }
    } else if (host === "accounts.google.com") {
      const emailInput = page.locator('input[type="email"]:visible').first();
      const passwordInput = page.locator('input[type="password"]:visible').first();
      const accountChooser = page.getByText(ACCOUNT_CHOOSER_PATTERN).first();
      const captchaImage = page.locator("#captchaimg");

      if (
        pathname.startsWith("/v3/signin/challenge/") ||
        (await isVisible(emailInput)) ||
        (await isVisible(passwordInput)) ||
        (await isVisible(accountChooser)) ||
        (await isVisible(captchaImage))
      ) {
        return false;
      }
    }

    await page.waitForTimeout(500);
  }

  return isLoggedIn(page, context);
}

async function completeGoogleSso(page) {
  const state = {
    email: "",
    password: "",
    devicePromptAnnounced: false,
    manualChallengeKey: "",
  };
  const deadline = Date.now() + LOGIN_FLOW_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (page.isClosed()) {
      throw new Error("Browser window was closed during Google verification.");
    }

    const currentUrl = page.url();
    const host = new URL(currentUrl).host;
    logStep(`Current host: ${host}`);

    if (host === "jungle-lms.krafton.com") {
      const loginVisible = await isLoginButtonVisible(page);
      if (!currentUrl.startsWith(LOGIN_URL) && !loginVisible) {
        return;
      }

      await page.waitForTimeout(1_000);
      continue;
    }

    if (host !== "accounts.google.com") {
      await page.waitForTimeout(500);
      continue;
    }

    const rejectedReason = await detectRejectedGooglePage(page);
    if (rejectedReason) {
      throw new Error(rejectedReason);
    }

    const handledDevicePrompt = await maybeHandleGoogleDevicePrompt(page, state);
    if (handledDevicePrompt) {
      await page.waitForLoadState("domcontentloaded", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
      continue;
    }

    const selected = await maybeSelectGoogleAccount(page, state.email);
    if (selected) {
      await page.waitForLoadState("domcontentloaded", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
      continue;
    }

    const filledEmail = await maybeFillGoogleEmail(page, state);
    if (filledEmail) {
      await page.waitForLoadState("domcontentloaded", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
      continue;
    }

    const filledPassword = await maybeFillGooglePassword(page, state);
    if (filledPassword) {
      await page.waitForLoadState("domcontentloaded", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
      continue;
    }

    const approvedConsent = await maybeApproveOAuthConsent(page);
    if (approvedConsent) {
      await page.waitForLoadState("domcontentloaded", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
      continue;
    }

    const waitingForManualChallenge = await maybeWaitForManualGoogleChallenge(page, state);
    if (waitingForManualChallenge) {
      await page.waitForLoadState("domcontentloaded", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
      continue;
    }

    await page.waitForTimeout(1_000);
  }

  throw new Error("Timed out while completing Google SSO.");
}

async function openLoginPage(page) {
  logStep(`Opening ${LOGIN_URL}`);
  await gotoWithTimeout(page, LOGIN_URL);
  await page.waitForLoadState("networkidle", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
}

async function openCheckInPage(page, context) {
  inspectLog(`Opening ${CHECKIN_URL}`);
  await gotoWithTimeout(page, CHECKIN_URL);
  await page.waitForLoadState("networkidle", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});

  if (await isLoggedIn(page, context)) {
    return;
  }

  const reusable = await probeReusableGoogleSession(page, context);
  if (!reusable) {
    throw new Error("No reusable session found for check-in inspection. Run `npm.cmd run login` first.");
  }

  if (!page.url().startsWith(CHECKIN_URL)) {
    await gotoWithTimeout(page, CHECKIN_URL);
    await page.waitForLoadState("networkidle", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
  }
}

async function collectCheckInButtonSnapshot(page) {
  await page.waitForTimeout(2_000);

  return page.evaluate(() => {
    const normalize = (value) => value.replace(/\s+/g, " ").trim();
    const quote = (value) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const cssEscape = (value) => {
      if (window.CSS && typeof window.CSS.escape === "function") {
        return window.CSS.escape(value);
      }

      return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
    };

    const buttonLike = Array.from(document.querySelectorAll("button, [role='button']"));
    const candidates = buttonLike
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const text = normalize(element.innerText || element.textContent || "");
        const ariaLabel = normalize(element.getAttribute("aria-label") || "");
        const visible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        const disabled = element.matches(":disabled") || element.getAttribute("aria-disabled") === "true";
        const tag = element.tagName.toLowerCase();
        const role = element.getAttribute("role") || "";
        const id = element.id || "";
        const name = element.getAttribute("name") || "";
        const className = normalize(typeof element.className === "string" ? element.className : "");
        const dataAttributes = Object.fromEntries(
          Array.from(element.attributes)
            .filter((attr) => attr.name.startsWith("data-"))
            .map((attr) => [attr.name, attr.value])
        );
        const selectorCandidates = [];

        if (id) {
          selectorCandidates.push(`#${cssEscape(id)}`);
        }

        for (const attrName of ["data-testid", "data-testid", "data-test", "data-qa", "data-cy"]) {
          const value = dataAttributes[attrName];
          if (value) {
            selectorCandidates.push(`[${attrName}="${quote(value)}"]`);
          }
        }

        if (name) {
          selectorCandidates.push(`[name="${quote(name)}"]`);
        }

        if (ariaLabel) {
          selectorCandidates.push(`[aria-label="${quote(ariaLabel)}"]`);
        }

        if (text) {
          selectorCandidates.push(`${tag}:has-text("${quote(text)}")`);
          if (tag === "button" || role === "button") {
            selectorCandidates.push(`page.getByRole("button", { name: "${quote(text)}" })`);
          }
        }

        return {
          index,
          tag,
          role,
          text,
          ariaLabel,
          disabled,
          visible,
          id,
          name,
          className,
          dataAttributes,
          selectorCandidates,
          outerHTML: element.outerHTML.slice(0, 500),
        };
      })
      .filter((item) => item.visible && (item.text || item.ariaLabel));

    const likelyCandidates = candidates.filter((item) => /\uD559\uC2B5|\uC2DC\uC791|\uC885\uB8CC|\uCD9C\uC11D|check|start|end/i.test(`${item.text} ${item.ariaLabel}`));

    return {
      title: document.title,
      url: window.location.href,
      visibleButtonCount: candidates.length,
      likelyCandidates,
      candidates,
    };
  });
}

async function saveCheckInInspectionArtifacts(page, snapshot) {
  const dir = path.join(path.dirname(ARTIFACTS_DIR), "check-in-inspection", timestamp());
  await fs.mkdir(dir, { recursive: true });

  await Promise.allSettled([
    page.screenshot({ path: path.join(dir, "page.png"), fullPage: true }),
    page.content().then((html) => fs.writeFile(path.join(dir, "page.html"), html, "utf8")),
    fs.writeFile(path.join(dir, "buttons.json"), JSON.stringify(snapshot, null, 2), "utf8"),
  ]);

  return dir;
}

async function saveCheckInActionArtifacts(page, label, payload) {
  const dir = path.join(path.dirname(ARTIFACTS_DIR), "check-in-actions", `${timestamp()}-${label}`);
  await fs.mkdir(dir, { recursive: true });

  await Promise.allSettled([
    page.screenshot({ path: path.join(dir, "page.png"), fullPage: true }),
    page.content().then((html) => fs.writeFile(path.join(dir, "page.html"), html, "utf8")),
    fs.writeFile(path.join(dir, "result.json"), JSON.stringify(payload, null, 2), "utf8"),
  ]);

  return dir;
}

async function waitUntilTargetDate(label, target, log) {
  const now = new Date();

  if (now >= target) {
    log(`Current time ${formatLocalDateTime(now)} is already at or after the target ${formatLocalDateTime(target)}. Proceeding now.`);
    return target;
  }

  log(`Waiting until ${formatLocalDateTime(target)} before attempting ${label}.`);
  let lastAnnouncedBucket = "";

  while (Date.now() < target.getTime()) {
    const remainingMs = target.getTime() - Date.now();
    const remainingMinutes = Math.ceil(remainingMs / 60_000);
    const bucket = remainingMinutes <= 5 ? `last-${remainingMinutes}` : remainingMinutes % 30 === 0 ? `m${remainingMinutes}` : "";

    if (bucket && bucket !== lastAnnouncedBucket) {
      log(`Remaining until target time: ${remainingMinutes} minute(s).`);
      lastAnnouncedBucket = bucket;
    }

    await delay(Math.min(remainingMs, 60_000));
  }

  log(`Reached target time ${formatLocalDateTime(new Date())}.`);
  return target;
}

async function getImmediateStartStudyTarget() {
  const target = new Date();
  startStudyLog(`Checking ${START_STUDY_BUTTON_NAME} immediately based on the current page state. Current time: ${formatLocalDateTime(target)}.`);
  return target;
}

async function waitUntilEndStudyWindow(endTime) {
  const target = buildEndStudyTargetDate(endTime);
  endStudyLog(`Configured end-study time: ${endTime.input}. Target: ${formatLocalDateTime(target)}.`);
  return waitUntilTargetDate(END_STUDY_BUTTON_NAME, target, endStudyLog);
}

async function detectCurrentStudyState(page, context) {
  await openCheckInPage(page, context);

  const completedButton = getCompletedStudyButton(page);
  if (await isVisible(completedButton, 2_000)) {
    return "completed";
  }

  const endButton = getEndStudyButton(page);
  if (await isVisible(endButton, 2_000)) {
    const disabled = await isLocatorDisabled(endButton);
    return disabled ? "started_waiting_end" : "ready_to_end";
  }

  const startButton = getStartStudyButton(page);
  if (await isVisible(startButton, 2_000)) {
    const disabled = await isLocatorDisabled(startButton);
    return disabled ? "waiting_start_window" : "ready_to_start";
  }

  return "unknown";
}

async function getCurrentStudyState() {
  const context = await launchContext();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    const state = await detectCurrentStudyState(page, context);
    return { state, url: page.url() };
  } finally {
    await context.close();
  }
}

async function waitForStartStudyButtonEnabled(page, context) {
  const deadline = Date.now() + START_STUDY_ENABLE_TIMEOUT_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    await openCheckInPage(page, context);

    const endButton = getEndStudyButton(page);
    if (await isVisible(endButton, 2_000)) {
      return { status: "already_started", button: endButton };
    }

    const startButton = getStartStudyButton(page);
    if (await isVisible(startButton, 5_000)) {
      const disabled = await isLocatorDisabled(startButton);
      if (!disabled) {
        startStudyLog(`${START_STUDY_BUTTON_NAME} button is enabled.`);
        return { status: "ready", button: startButton };
      }
    }

    const completedButton = getCompletedStudyButton(page);
    if ((await isVisible(completedButton, 2_000)) && (await isLocatorDisabled(completedButton))) {
      return { status: "already_completed", button: completedButton };
    }

    startStudyLog(`${START_STUDY_BUTTON_NAME} button is not ready yet. Refreshing again in 30 seconds. Attempt ${attempt}.`);
    await page.waitForTimeout(CHECKIN_REFRESH_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for the ${START_STUDY_BUTTON_NAME} button to become enabled.`);
}

async function waitForEndStudyButtonEnabled(page, context) {
  const deadline = Date.now() + END_STUDY_ENABLE_TIMEOUT_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    await openCheckInPage(page, context);

    const button = getEndStudyButton(page);
    const visible = await isVisible(button, 5_000);
    if (visible) {
      const disabled = await isLocatorDisabled(button);
      if (!disabled) {
        endStudyLog(`${END_STUDY_BUTTON_NAME} button is enabled.`);
        return button;
      }
    }

    endStudyLog(`${END_STUDY_BUTTON_NAME} button is still disabled. Refreshing again in 30 seconds. Attempt ${attempt}.`);
    await page.waitForTimeout(CHECKIN_REFRESH_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for the ${END_STUDY_BUTTON_NAME} button to become enabled.`);
}

async function maybeConfirmActionDialog(page, titlePattern, log) {
  const dialog = page.locator('[role="dialog"], [role="alertdialog"]').first();
  if (!(await isVisible(dialog, 1_000))) {
    return false;
  }

  const dialogText = dialog.getByText(titlePattern).first();
  if (!(await isVisible(dialogText, 1_000))) {
    return false;
  }

  const actionButton = dialog.locator('[data-slot="alert-dialog-action"]').first();
  if (!(await isVisible(actionButton, 1_000))) {
    return false;
  }

  log("Confirming the study action dialog.");
  await actionButton.click();
  return true;
}

async function maybeConfirmStartStudy(page) {
  return maybeConfirmActionDialog(page, /\uD559\uC2B5 \uC2DC\uC791|\uC2DC\uC791\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C|start study|check in/i, startStudyLog);
}

async function maybeConfirmEndStudy(page) {
  return maybeConfirmActionDialog(page, /\uD559\uC2B5 \uC885\uB8CC|\uC885\uB8CC\uD558\uC2DC\uACA0\uC2B5\uB2C8\uAE4C|end study|check out/i, endStudyLog);
}

async function waitForStartStudyCompletion(page) {
  const deadline = Date.now() + START_STUDY_CONFIRM_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const dialog = page.locator('[role="dialog"], [role="alertdialog"]').first();
    if (await isVisible(dialog, 500)) {
      await page.waitForTimeout(500);
      continue;
    }

    const successCopy = page.getByText(/\uD559\uC2B5\uC774 \uC2DC\uC791\uB418\uC5C8\uC2B5\uB2C8\uB2E4|\uC815\uC0C1\uC801\uC73C\uB85C \uC2DC\uC791|\uCD9C\uC11D \uC2DC\uC791|check-in completed|study started/i).first();
    if (await isVisible(successCopy, 500)) {
      return true;
    }

    const endButton = getEndStudyButton(page);
    if (await isVisible(endButton, 500)) {
      return true;
    }

    await page.waitForTimeout(500);
  }

  return false;
}

async function waitForEndStudyCompletion(page) {
  const deadline = Date.now() + END_STUDY_CONFIRM_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const dialog = page.locator('[role="dialog"], [role="alertdialog"]').first();
    if (await isVisible(dialog, 500)) {
      await page.waitForTimeout(500);
      continue;
    }

    const successCopy = page.getByText(/\uC644\uB8CC\uB418\uC5C8\uC2B5\uB2C8\uB2E4|\uC815\uC0C1\uC801\uC73C\uB85C \uC885\uB8CC|\uCD9C\uC11D \uC885\uB8CC|check-out completed|study ended/i).first();
    if (await isVisible(successCopy, 500)) {
      return true;
    }

    const button = getEndStudyButton(page);
    if (!(await isVisible(button, 500))) {
      return true;
    }

    if (await isLocatorDisabled(button)) {
      return true;
    }

    await page.waitForTimeout(500);
  }

  return false;
}

export async function inspectCheckInButtons() {
  const context = await launchContext();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await openCheckInPage(page, context);
    const snapshot = await collectCheckInButtonSnapshot(page);
    const artifactDir = await saveCheckInInspectionArtifacts(page, snapshot);

    inspectLog(`Saved check-in inspection artifacts: ${artifactDir}`);
    const payload = snapshot.likelyCandidates.length > 0
      ? {
          url: snapshot.url,
          title: snapshot.title,
          visibleButtonCount: snapshot.visibleButtonCount,
          likelyCandidates: snapshot.likelyCandidates,
        }
      : snapshot;

    console.log(JSON.stringify(payload, null, 2));
    return true;
  } catch (error) {
    const artifactDir = await saveFailureArtifacts(page, "inspect-checkin", error);
    throw new Error(`Check-in inspection failed. Artifacts: ${artifactDir}`, { cause: error });
  } finally {
    await context.close();
  }
}

export async function verifyExistingSession() {
  const context = await launchContext();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await openLoginPage(page);
    let loggedIn = await isLoggedIn(page, context);

    if (loggedIn) {
      logStep(`Session is valid. Current URL: ${page.url()}`);
      return true;
    }

    loggedIn = await probeReusableGoogleSession(page, context);
    if (loggedIn) {
      logStep(`Session is valid after SSO probe. Current URL: ${page.url()}`);
      return true;
    }

    logStep("No valid session found.");
    return false;
  } catch (error) {
    const artifactDir = await saveFailureArtifacts(page, "verify", error);
    throw new Error(`Session verification failed. Artifacts: ${artifactDir}`, { cause: error });
  } finally {
    await context.close();
  }
}

export async function login({ fresh = false } = {}) {
  if (fresh) {
    logStep(`Resetting profile directory: ${PROFILE_DIR}`);
    await fs.rm(PROFILE_DIR, { recursive: true, force: true });
  }

  const context = await launchContext();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await openLoginPage(page);

    if (await isLoggedIn(page, context)) {
      logStep(`Already logged in. Current URL: ${page.url()}`);
      return true;
    }

    if (await isLoginButtonVisible(page)) {
      await clickGoogleContinue(page);
    } else if (page.url() !== GOOGLE_SSO_URL) {
      logStep("Login button not visible, forcing Google SSO endpoint.");
      await gotoWithTimeout(page, GOOGLE_SSO_URL);
    }

    await completeGoogleSso(page);
    await page.waitForLoadState("networkidle", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});

    if (!(await isLoggedIn(page, context))) {
      throw new Error(`Login flow finished but success could not be verified. Current URL: ${page.url()}`);
    }

    logStep(`Login completed successfully. Current URL: ${page.url()}`);
    return true;
  } catch (error) {
    const artifactDir = await saveFailureArtifacts(page, "login", error);
    throw new Error(`Login failed. Artifacts: ${artifactDir}`, { cause: error });
  } finally {
    await context.close();
  }
}

export async function startStudy() {
  const target = await getImmediateStartStudyTarget();
  const context = await launchContext();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    const result = await waitForStartStudyButtonEnabled(page, context);

    if (result.status === "already_started") {
      startStudyLog(`${END_STUDY_BUTTON_NAME} button is already visible. Today's study appears to have already started.`);
      const artifactDir = await saveCheckInActionArtifacts(page, "start-study-already-started", {
        targetTime: formatLocalDateTime(target),
        finishedAt: formatLocalDateTime(new Date()),
        url: page.url(),
        buttonName: END_STUDY_BUTTON_NAME,
        status: result.status,
      });

      startStudyLog(`No click was needed. Artifacts: ${artifactDir}`);
      return true;
    }

    if (result.status === "already_completed") {
      startStudyLog(`${STUDY_COMPLETED_BUTTON_NAME} state is already visible. Today's study appears to be completed, so no start click will be sent.`);
      const artifactDir = await saveCheckInActionArtifacts(page, "start-study-already-completed", {
        targetTime: formatLocalDateTime(target),
        finishedAt: formatLocalDateTime(new Date()),
        url: page.url(),
        buttonName: STUDY_COMPLETED_BUTTON_NAME,
        status: result.status,
      });

      startStudyLog(`No click was needed. Artifacts: ${artifactDir}`);
      return true;
    }

    const button = result.button;
    startStudyLog(`Clicking ${START_STUDY_BUTTON_NAME}.`);
    await button.click();
    await page.waitForLoadState("networkidle", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});

    const confirmed = await maybeConfirmStartStudy(page);
    if (confirmed) {
      await page.waitForLoadState("networkidle", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
    }

    const completed = await waitForStartStudyCompletion(page);
    if (!completed) {
      throw new Error(`${START_STUDY_BUTTON_NAME} was clicked, but completion could not be verified.`);
    }

    const artifactDir = await saveCheckInActionArtifacts(page, "start-study", {
      targetTime: formatLocalDateTime(target),
      finishedAt: formatLocalDateTime(new Date()),
      url: page.url(),
      buttonName: START_STUDY_BUTTON_NAME,
    });

    startStudyLog(`${START_STUDY_BUTTON_NAME} completed. Artifacts: ${artifactDir}`);
    return true;
  } catch (error) {
    const artifactDir = await saveFailureArtifacts(page, "start-study", error);
    throw new Error(`Start-study automation failed. Artifacts: ${artifactDir}`, { cause: error });
  } finally {
    await context.close();
  }
}

export async function studyDay({ endTime } = {}) {
  if (!endTime?.input) {
    throw new Error("studyDay requires a validated end-study time.");
  }

  const now = new Date();
  const endTarget = buildEndStudyTargetDate(endTime, now);
  const { state, url } = await getCurrentStudyState();
  studyDayLog(`Configured end-study time: ${endTime.input}. Target: ${formatLocalDateTime(endTarget)}.`);
  studyDayLog(`Current state: ${state}. URL: ${url}`);

  if (state === "completed") {
    studyDayLog("Today's study already appears to be completed. Nothing to do.");
    return true;
  }

  if (now >= endTarget && (state === "ready_to_start" || state === "waiting_start_window" || state === "unknown")) {
    studyDayLog("Current time is already after the configured end-study window, and there is no active study session to finish. Nothing will be clicked.");
    return true;
  }

  if (state === "ready_to_end" || state === "started_waiting_end") {
    studyDayLog("An active study session is already in progress. Waiting only for end-study automation.");
    return endStudy({ endTime });
  }

  studyDayLog("No active study session is detected. Attempting study-start immediately, then waiting for end-study.");
  const started = await startStudy();
  if (!started) {
    return false;
  }

  return endStudy({ endTime });
}

export async function endStudy({ endTime } = {}) {
  if (!endTime?.input) {
    throw new Error("endStudy requires a validated end-study time.");
  }

  const target = await waitUntilEndStudyWindow(endTime);
  const context = await launchContext();
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    const button = await waitForEndStudyButtonEnabled(page, context);

    endStudyLog(`Clicking ${END_STUDY_BUTTON_NAME}.`);
    await button.click();
    await page.waitForLoadState("networkidle", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});

    const confirmed = await maybeConfirmEndStudy(page);
    if (confirmed) {
      await page.waitForLoadState("networkidle", { timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
    }

    const completed = await waitForEndStudyCompletion(page);
    if (!completed) {
      throw new Error(`${END_STUDY_BUTTON_NAME} was clicked, but completion could not be verified.`);
    }

    const artifactDir = await saveCheckInActionArtifacts(page, "end-study", {
      targetTime: formatLocalDateTime(target),
      finishedAt: formatLocalDateTime(new Date()),
      url: page.url(),
      buttonName: END_STUDY_BUTTON_NAME,
    });

    endStudyLog(`${END_STUDY_BUTTON_NAME} completed. Artifacts: ${artifactDir}`);
    return true;
  } catch (error) {
    const artifactDir = await saveFailureArtifacts(page, "end-study", error);
    throw new Error(`End-study automation failed. Artifacts: ${artifactDir}`, { cause: error });
  } finally {
    await context.close();
  }
}

export async function bootstrapManualSession({ fresh = false } = {}) {
  if (fresh) {
    logStep(`Resetting profile directory: ${PROFILE_DIR}`);
    await fs.rm(PROFILE_DIR, { recursive: true, force: true });
  }

  await ensureDirectories();

  const chromePath = await findChromeExecutable();
  const child = spawn(
    chromePath,
    [
      `--user-data-dir=${PROFILE_DIR}`,
      "--new-window",
      LOGIN_URL,
    ],
    {
      detached: true,
      stdio: "ignore",
    }
  );

  child.unref();
  logStep("Opened regular Chrome with the automation profile.");
  logStep("Finish Google login, device approval, and CAPTCHA manually in that window. Then close that Chrome window and run npm.cmd run verify.");
  return true;
}