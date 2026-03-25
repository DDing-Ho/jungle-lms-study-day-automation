import path from "node:path";

export const ROOT_DIR = process.cwd();
export const LOGIN_URL = "https://jungle-lms.krafton.com/login";
export const CHECKIN_URL = "https://jungle-lms.krafton.com/check-in";
export const GOOGLE_SSO_URL = "https://jungle-lms.krafton.com/api/v2/auth/google";
export const ARTIFACTS_DIR = path.join(ROOT_DIR, ".artifacts", "failed-login");
export const PROFILE_DIR = path.join(ROOT_DIR, ".local", "chrome-profile");
export const BACKGROUND_DIR = path.join(ROOT_DIR, ".local", "background");
export const STUDY_DAY_PID_PATH = path.join(BACKGROUND_DIR, "study-day.pid.json");
export const STUDY_DAY_STATUS_PATH = path.join(BACKGROUND_DIR, "study-day.status.json");
export const STUDY_DAY_LOG_PATH = path.join(BACKGROUND_DIR, "study-day.log");
export const STUDY_DAY_TRAY_PID_PATH = path.join(BACKGROUND_DIR, "study-day.tray.pid.json");
export const STUDY_DAY_TRAY_SCRIPT_PATH = path.join(ROOT_DIR, "scripts", "study-day-tray.ps1");
export const BROWSER_CHANNEL = "chrome";
export const NAVIGATION_TIMEOUT_MS = 45_000;
export const LOGIN_BUTTON_NAME = "Google\uB85C \uACC4\uC18D\uD558\uAE30";