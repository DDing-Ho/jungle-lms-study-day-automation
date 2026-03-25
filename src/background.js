import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import {
  ROOT_DIR,
  BACKGROUND_DIR,
  STUDY_DAY_LOG_PATH,
  STUDY_DAY_PID_PATH,
  STUDY_DAY_STATUS_PATH,
} from "./config.js";
import { buildEndStudyTargetDate, parseEndStudyTimeInput } from "./end-time.js";
import { studyDay } from "./login.js";

function nowIso() {
  return new Date().toISOString();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireEndTime(endTimeInput) {
  const parsed = parseEndStudyTimeInput(endTimeInput);
  if (!parsed) {
    throw new Error("A valid end-study time is required for study-day background execution.");
  }

  return parsed;
}

async function ensureBackgroundDirectory() {
  await fs.mkdir(BACKGROUND_DIR, { recursive: true });
}

async function readJson(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function writeJson(filePath, value) {
  await ensureBackgroundDirectory();
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function removeFile(filePath) {
  await fs.rm(filePath, { force: true });
}

function isProcessRunning(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      return true;
    }

    return false;
  }
}

async function readLogTail(maxLines = 20) {
  try {
    const log = await fs.readFile(STUDY_DAY_LOG_PATH, "utf8");
    return log.split(/\r?\n/).filter(Boolean).slice(-maxLines);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function cleanupStalePidFile(pidInfo) {
  if (!pidInfo?.pid) {
    return;
  }

  if (!isProcessRunning(pidInfo.pid)) {
    await removeFile(STUDY_DAY_PID_PATH);
  }
}

async function writeBackgroundStatus(state, extra = {}) {
  const current = (await readJson(STUDY_DAY_STATUS_PATH)) ?? {};
  const next = {
    ...current,
    mode: "study-day",
    pid: process.pid,
    state,
    logPath: STUDY_DAY_LOG_PATH,
    updatedAt: nowIso(),
    ...extra,
  };

  await writeJson(STUDY_DAY_STATUS_PATH, next);
}

async function removeCurrentPidFile() {
  const current = await readJson(STUDY_DAY_PID_PATH);
  if (current?.pid === process.pid) {
    await removeFile(STUDY_DAY_PID_PATH);
  }
}

async function killProcessTree(pid) {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EPERM")) {
      return false;
    }
  }

  await delay(1_000);
  if (!isProcessRunning(pid)) {
    return true;
  }

  await new Promise((resolve, reject) => {
    const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0 || code === 128) {
        resolve();
        return;
      }

      reject(new Error(`taskkill exited with code ${code}`));
    });
  });

  return !isProcessRunning(pid);
}

export async function startStudyDayBackground({ endTimeInput } = {}) {
  const endTime = requireEndTime(endTimeInput);
  const endTarget = buildEndStudyTargetDate(endTime);
  await ensureBackgroundDirectory();

  const pidInfo = await readJson(STUDY_DAY_PID_PATH);
  if (pidInfo?.pid && isProcessRunning(pidInfo.pid)) {
    const status = await readJson(STUDY_DAY_STATUS_PATH);
    return {
      started: false,
      alreadyRunning: true,
      pid: pidInfo.pid,
      logPath: STUDY_DAY_LOG_PATH,
      statusPath: STUDY_DAY_STATUS_PATH,
      state: status?.state ?? "running",
      endTimeInput: status?.endTimeInput ?? endTime.input,
      endTimeTarget: status?.endTimeTarget ?? endTarget.toISOString(),
    };
  }

  await cleanupStalePidFile(pidInfo);

  const outFd = fsSync.openSync(STUDY_DAY_LOG_PATH, "a");
  const child = spawn(process.execPath, [path.join(ROOT_DIR, "src", "cli.js"), "study-day:run", "--end-time", endTime.input], {
    cwd: ROOT_DIR,
    detached: true,
    stdio: ["ignore", outFd, outFd],
    windowsHide: true,
  });

  fsSync.closeSync(outFd);
  child.unref();

  const startedAt = nowIso();
  await writeJson(STUDY_DAY_PID_PATH, {
    pid: child.pid,
    mode: "study-day",
    startedAt,
    logPath: STUDY_DAY_LOG_PATH,
  });

  await writeJson(STUDY_DAY_STATUS_PATH, {
    mode: "study-day",
    pid: child.pid,
    state: "starting",
    startedAt,
    updatedAt: startedAt,
    logPath: STUDY_DAY_LOG_PATH,
    endTimeInput: endTime.input,
    endTimeTarget: endTarget.toISOString(),
    message: `Background study-day process was launched. Scheduled end-study time: ${endTime.input}.`,
  });

  return {
    started: true,
    alreadyRunning: false,
    pid: child.pid,
    logPath: STUDY_DAY_LOG_PATH,
    statusPath: STUDY_DAY_STATUS_PATH,
    endTimeInput: endTime.input,
    endTimeTarget: endTarget.toISOString(),
  };
}

export async function getStudyDayBackgroundStatus() {
  await ensureBackgroundDirectory();

  const pidInfo = await readJson(STUDY_DAY_PID_PATH);
  const status = await readJson(STUDY_DAY_STATUS_PATH);
  const running = Boolean(pidInfo?.pid && isProcessRunning(pidInfo.pid));
  if (!running) {
    await cleanupStalePidFile(pidInfo);
  }

  return {
    running,
    pid: running ? pidInfo.pid : status?.pid ?? pidInfo?.pid ?? null,
    state: running ? status?.state ?? "running" : status?.state ?? "not_running",
    startedAt: status?.startedAt ?? pidInfo?.startedAt ?? null,
    updatedAt: status?.updatedAt ?? null,
    message: status?.message ?? null,
    logPath: STUDY_DAY_LOG_PATH,
    statusPath: STUDY_DAY_STATUS_PATH,
    endTimeInput: status?.endTimeInput ?? null,
    endTimeTarget: status?.endTimeTarget ?? null,
    recentLogs: await readLogTail(20),
  };
}

export async function stopStudyDayBackground() {
  const pidInfo = await readJson(STUDY_DAY_PID_PATH);
  const currentStatus = (await readJson(STUDY_DAY_STATUS_PATH)) ?? {};
  if (!pidInfo?.pid) {
    return {
      stopped: false,
      running: false,
      pid: null,
      state: currentStatus.state ?? "not_running",
      message: "No background study-day process is running.",
    };
  }

  if (!isProcessRunning(pidInfo.pid)) {
    await removeFile(STUDY_DAY_PID_PATH);
    return {
      stopped: false,
      running: false,
      pid: pidInfo.pid,
      state: currentStatus.state ?? "not_running",
      message: "The saved study-day PID was stale and has been cleared.",
    };
  }

  const stopped = await killProcessTree(pidInfo.pid);
  await removeFile(STUDY_DAY_PID_PATH);

  const stoppedAt = nowIso();
  await writeJson(STUDY_DAY_STATUS_PATH, {
    ...currentStatus,
    mode: "study-day",
    pid: pidInfo.pid,
    state: stopped ? "stopped" : "stop_failed",
    startedAt: pidInfo.startedAt ?? currentStatus.startedAt ?? null,
    updatedAt: stoppedAt,
    stoppedAt,
    logPath: STUDY_DAY_LOG_PATH,
    message: stopped ? "Background study-day process was stopped by the user." : "Failed to stop the background study-day process cleanly.",
  });

  return {
    stopped,
    running: false,
    pid: pidInfo.pid,
    state: stopped ? "stopped" : "stop_failed",
    message: stopped ? "Background study-day process was stopped." : "Failed to stop the background study-day process.",
  };
}

export async function runStudyDayBackground({ endTimeInput } = {}) {
  const endTime = requireEndTime(endTimeInput);
  const endTarget = buildEndStudyTargetDate(endTime);
  const startedAt = nowIso();
  await ensureBackgroundDirectory();
  await writeJson(STUDY_DAY_PID_PATH, {
    pid: process.pid,
    mode: "study-day",
    startedAt,
    logPath: STUDY_DAY_LOG_PATH,
  });
  await writeBackgroundStatus("running", {
    startedAt,
    endTimeInput: endTime.input,
    endTimeTarget: endTarget.toISOString(),
    message: `Background study-day process is running. Scheduled end-study time: ${endTime.input}.`,
  });

  const handleSignal = async (signal) => {
    await writeBackgroundStatus("stopped", {
      stoppedAt: nowIso(),
      message: `Background study-day process received ${signal}.`,
    });
    await removeCurrentPidFile();
    process.exit(1);
  };

  process.once("SIGINT", () => void handleSignal("SIGINT"));
  process.once("SIGTERM", () => void handleSignal("SIGTERM"));
  process.once("SIGBREAK", () => void handleSignal("SIGBREAK"));

  try {
    const ok = await studyDay({ endTime });
    await writeBackgroundStatus(ok ? "completed" : "failed", {
      completedAt: nowIso(),
      message: ok ? "Background study-day finished successfully." : "Background study-day returned a failure status.",
    });
    return ok;
  } catch (error) {
    await writeBackgroundStatus("failed", {
      failedAt: nowIso(),
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    throw error;
  } finally {
    await removeCurrentPidFile();
  }
}
