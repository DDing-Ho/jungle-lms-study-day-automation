import {
  getStudyDayBackgroundStatus,
  runStudyDayBackground,
  startStudyDayBackground,
  stopStudyDayBackground,
} from "./background.js";
import { END_STUDY_TIME_GUIDE_TEXT, parseEndStudyTimeInput } from "./end-time.js";
import { bootstrapManualSession, endStudy, inspectCheckInButtons, login, startStudy, studyDay, verifyExistingSession } from "./login.js";
import { promptForEndStudyTime } from "./prompt.js";
import { getStudyDayTrayStatus, startStudyDayTray, stopStudyDayTray } from "./tray.js";

function printUsage() {
  console.error("Usage: node ./src/cli.js <login|verify|login:fresh|bootstrap|bootstrap:fresh|inspect:checkin|start-study|end-study [--end-time HH:MM]|study-day [--end-time HH:MM]|study-day:run --end-time HH:MM|study-day:status|study-day:stop|study-day:foreground [--end-time HH:MM]|study-day:tray|study-day:tray:status|study-day:tray:stop>");
}

function getOptionValue(name) {
  const args = process.argv.slice(3);
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === name) {
      return args[index + 1] ?? "";
    }

    if (current.startsWith(`${name}=`)) {
      return current.slice(name.length + 1);
    }
  }

  return null;
}

async function resolveEndTime({ promptIfMissing = false, required = false } = {}) {
  const value = getOptionValue("--end-time");
  if (value !== null) {
    const parsed = parseEndStudyTimeInput(value);
    if (!parsed) {
      throw new Error(`Invalid --end-time value. ${END_STUDY_TIME_GUIDE_TEXT}`);
    }

    return parsed;
  }

  if (promptIfMissing) {
    return promptForEndStudyTime();
  }

  if (required) {
    throw new Error(`Missing --end-time. ${END_STUDY_TIME_GUIDE_TEXT}`);
  }

  return null;
}

function printBackgroundStatus(status) {
  console.log(`[study-day] state: ${status.state}`);
  console.log(`[study-day] running: ${status.running ? "yes" : "no"}`);
  if (status.pid) {
    console.log(`[study-day] pid: ${status.pid}`);
  }
  if (status.startedAt) {
    console.log(`[study-day] startedAt: ${status.startedAt}`);
  }
  if (status.updatedAt) {
    console.log(`[study-day] updatedAt: ${status.updatedAt}`);
  }
  if (status.endTimeInput) {
    console.log(`[study-day] endTime: ${status.endTimeInput}`);
  }
  if (status.endTimeTarget) {
    console.log(`[study-day] endTarget: ${status.endTimeTarget}`);
  }
  if (status.message) {
    console.log(`[study-day] message: ${status.message}`);
  }
  console.log(`[study-day] log: ${status.logPath}`);
  console.log(`[study-day] status: ${status.statusPath}`);

  if (status.recentLogs?.length) {
    console.log("[study-day] recent logs:");
    for (const line of status.recentLogs.slice(-10)) {
      console.log(line);
    }
  }
}

function printTrayStatus(status) {
  console.log(`[study-day:tray] running: ${status.running ? "yes" : "no"}`);
  if (status.pid) {
    console.log(`[study-day:tray] pid: ${status.pid}`);
  }
  if (status.startedAt) {
    console.log(`[study-day:tray] startedAt: ${status.startedAt}`);
  }
  console.log(`[study-day:tray] tray pid: ${status.trayPidPath}`);
  console.log(`[study-day:tray] tray script: ${status.trayScriptPath}`);
  console.log(`[study-day:tray] background state: ${status.backgroundState}`);
  if (status.backgroundEndTimeInput) {
    console.log(`[study-day:tray] background endTime: ${status.backgroundEndTimeInput}`);
  }
  if (status.backgroundEndTimeTarget) {
    console.log(`[study-day:tray] background endTarget: ${status.backgroundEndTimeTarget}`);
  }
  if (status.backgroundMessage) {
    console.log(`[study-day:tray] background message: ${status.backgroundMessage}`);
  }
  console.log(`[study-day:tray] background log: ${status.backgroundLogPath}`);
  console.log(`[study-day:tray] background status: ${status.backgroundStatusPath}`);
}

async function main() {
  const command = process.argv[2];

  switch (command) {
    case "login": {
      const ok = await login();
      process.exitCode = ok ? 0 : 1;
      return;
    }
    case "verify": {
      const ok = await verifyExistingSession();
      process.exitCode = ok ? 0 : 1;
      return;
    }
    case "login:fresh": {
      const ok = await login({ fresh: true });
      process.exitCode = ok ? 0 : 1;
      return;
    }
    case "bootstrap": {
      const ok = await bootstrapManualSession();
      process.exitCode = ok ? 0 : 1;
      return;
    }
    case "bootstrap:fresh": {
      const ok = await bootstrapManualSession({ fresh: true });
      process.exitCode = ok ? 0 : 1;
      return;
    }
    case "inspect:checkin": {
      const ok = await inspectCheckInButtons();
      process.exitCode = ok ? 0 : 1;
      return;
    }
    case "start-study": {
      const ok = await startStudy();
      process.exitCode = ok ? 0 : 1;
      return;
    }
    case "end-study": {
      const endTime = await resolveEndTime({ promptIfMissing: true });
      const ok = await endStudy({ endTime });
      process.exitCode = ok ? 0 : 1;
      return;
    }
    case "study-day": {
      const existing = await getStudyDayBackgroundStatus();
      if (existing.running) {
        const trayResult = await startStudyDayTray();
        console.log(`[study-day] already running in background. pid: ${existing.pid}`);
        console.log(`[study-day] log: ${existing.logPath}`);
        console.log(`[study-day] status: ${existing.statusPath}`);
        if (existing.endTimeInput) {
          console.log(`[study-day] endTime: ${existing.endTimeInput}`);
        }
        if (trayResult.alreadyRunning) {
          console.log(`[study-day:tray] already running. pid: ${trayResult.pid}`);
        } else {
          console.log(`[study-day:tray] started. pid: ${trayResult.pid}`);
        }
        process.exitCode = 0;
        return;
      }

      const endTime = await resolveEndTime({ promptIfMissing: true });
      const result = await startStudyDayBackground({ endTimeInput: endTime.input });
      const trayResult = await startStudyDayTray();
      console.log(`[study-day] started in background. pid: ${result.pid}`);
      console.log(`[study-day] endTime: ${result.endTimeInput}`);
      console.log(`[study-day] endTarget: ${result.endTimeTarget}`);
      console.log(`[study-day] log: ${result.logPath}`);
      console.log(`[study-day] status: ${result.statusPath}`);
      if (trayResult.alreadyRunning) {
        console.log(`[study-day:tray] already running. pid: ${trayResult.pid}`);
      } else {
        console.log(`[study-day:tray] started. pid: ${trayResult.pid}`);
      }
      process.exitCode = 0;
      return;
    }
    case "study-day:run": {
      const endTime = await resolveEndTime({ required: true });
      const ok = await runStudyDayBackground({ endTimeInput: endTime.input });
      process.exitCode = ok ? 0 : 1;
      return;
    }
    case "study-day:status": {
      const status = await getStudyDayBackgroundStatus();
      printBackgroundStatus(status);
      process.exitCode = status.running || ["completed", "stopped"].includes(status.state) ? 0 : 1;
      return;
    }
    case "study-day:stop": {
      const result = await stopStudyDayBackground();
      console.log(`[study-day] ${result.message}`);
      if (result.pid) {
        console.log(`[study-day] pid: ${result.pid}`);
      }
      process.exitCode = result.stopped ? 0 : 1;
      return;
    }
    case "study-day:foreground": {
      const endTime = await resolveEndTime({ promptIfMissing: true });
      const ok = await studyDay({ endTime });
      process.exitCode = ok ? 0 : 1;
      return;
    }
    case "study-day:tray": {
      const result = await startStudyDayTray();
      if (result.alreadyRunning) {
        console.log(`[study-day:tray] already running. pid: ${result.pid}`);
      } else {
        console.log(`[study-day:tray] started. pid: ${result.pid}`);
      }
      console.log(`[study-day:tray] script: ${result.scriptPath}`);
      process.exitCode = 0;
      return;
    }
    case "study-day:tray:status": {
      const status = await getStudyDayTrayStatus();
      printTrayStatus(status);
      process.exitCode = status.running ? 0 : 1;
      return;
    }
    case "study-day:tray:stop": {
      const result = await stopStudyDayTray();
      console.log(`[study-day:tray] ${result.message}`);
      if (result.pid) {
        console.log(`[study-day:tray] pid: ${result.pid}`);
      }
      process.exitCode = result.stopped ? 0 : 1;
      return;
    }
    default:
      printUsage();
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  if (error instanceof Error && error.cause instanceof Error) {
    console.error(error.cause.stack);
  }
  process.exitCode = 1;
});
