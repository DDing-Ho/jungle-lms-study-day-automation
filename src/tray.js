import fs from "node:fs/promises";
import process from "node:process";
import { spawn } from "node:child_process";
import {
  ROOT_DIR,
  STUDY_DAY_LOG_PATH,
  STUDY_DAY_STATUS_PATH,
  STUDY_DAY_TRAY_PID_PATH,
  STUDY_DAY_TRAY_SCRIPT_PATH,
} from "./config.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function getPowerShellExecutable() {
  const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
  return `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

async function cleanupStalePidFile(pidInfo) {
  if (!pidInfo?.pid) {
    return;
  }

  if (!isProcessRunning(pidInfo.pid)) {
    await removeFile(STUDY_DAY_TRAY_PID_PATH);
  }
}

async function waitForTrayPid(timeoutMs = 5_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const pidInfo = await readJson(STUDY_DAY_TRAY_PID_PATH);
    if (pidInfo?.pid) {
      return pidInfo;
    }

    await delay(200);
  }

  return null;
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

export async function startStudyDayTray() {
  const pidInfo = await readJson(STUDY_DAY_TRAY_PID_PATH);
  if (pidInfo?.pid && isProcessRunning(pidInfo.pid)) {
    return {
      started: false,
      alreadyRunning: true,
      pid: pidInfo.pid,
      scriptPath: STUDY_DAY_TRAY_SCRIPT_PATH,
    };
  }

  await cleanupStalePidFile(pidInfo);

  const child = spawn(
    getPowerShellExecutable(),
    [
      "-NoProfile",
      "-Sta",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-File",
      STUDY_DAY_TRAY_SCRIPT_PATH,
      "-RootDir",
      ROOT_DIR,
    ],
    {
      cwd: ROOT_DIR,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }
  );

  child.unref();

  const startedInfo = await waitForTrayPid();
  return {
    started: true,
    alreadyRunning: false,
    pid: startedInfo?.pid ?? child.pid,
    scriptPath: STUDY_DAY_TRAY_SCRIPT_PATH,
  };
}

export async function getStudyDayTrayStatus() {
  const pidInfo = await readJson(STUDY_DAY_TRAY_PID_PATH);
  const running = Boolean(pidInfo?.pid && isProcessRunning(pidInfo.pid));
  if (!running) {
    await cleanupStalePidFile(pidInfo);
  }

  const backgroundStatus = await readJson(STUDY_DAY_STATUS_PATH);
  return {
    running,
    pid: running ? pidInfo.pid : pidInfo?.pid ?? null,
    startedAt: pidInfo?.startedAt ?? null,
    trayPidPath: STUDY_DAY_TRAY_PID_PATH,
    trayScriptPath: STUDY_DAY_TRAY_SCRIPT_PATH,
    backgroundState: backgroundStatus?.state ?? "unknown",
    backgroundEndTimeInput: backgroundStatus?.endTimeInput ?? null,
    backgroundEndTimeTarget: backgroundStatus?.endTimeTarget ?? null,
    backgroundMessage: backgroundStatus?.message ?? null,
    backgroundLogPath: STUDY_DAY_LOG_PATH,
    backgroundStatusPath: STUDY_DAY_STATUS_PATH,
  };
}

export async function stopStudyDayTray() {
  const pidInfo = await readJson(STUDY_DAY_TRAY_PID_PATH);
  if (!pidInfo?.pid) {
    return {
      stopped: false,
      running: false,
      pid: null,
      message: "No study-day tray process is running.",
    };
  }

  if (!isProcessRunning(pidInfo.pid)) {
    await removeFile(STUDY_DAY_TRAY_PID_PATH);
    return {
      stopped: false,
      running: false,
      pid: pidInfo.pid,
      message: "The saved study-day tray PID was stale and has been cleared.",
    };
  }

  const stopped = await killProcessTree(pidInfo.pid);
  await removeFile(STUDY_DAY_TRAY_PID_PATH);

  return {
    stopped,
    running: false,
    pid: pidInfo.pid,
    message: stopped ? "Study-day tray process was stopped." : "Failed to stop the study-day tray process.",
  };
}
