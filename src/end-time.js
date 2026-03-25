export const END_STUDY_TIME_GUIDE_TEXT = "23:00 ~ 익일 03:00 사이의 값을 입력하세요. 예: 23:00, 01:00, 02:30";
export const END_STUDY_TIME_PROMPT = `학습 종료 시간을 입력하세요 (${END_STUDY_TIME_GUIDE_TEXT}): `;

function normalizeEndStudyTime(hour, minute) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseEndStudyTimeInput(value) {
  const trimmed = String(value ?? "").trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }

  const isSameDayWindow = hour === 23;
  const isNextDayWindow = hour >= 0 && hour <= 2;
  const isLastSupportedMinute = hour === 3 && minute === 0;
  if (!isSameDayWindow && !isNextDayWindow && !isLastSupportedMinute) {
    return null;
  }

  return {
    hour,
    minute,
    input: normalizeEndStudyTime(hour, minute),
    spansNextDay: hour < 23,
  };
}

export function buildEndStudyTargetDate(endTime, reference = new Date()) {
  const target = new Date(reference);
  const shouldUseNextDay = endTime.spansNextDay && reference.getHours() >= 4;
  if (shouldUseNextDay) {
    target.setDate(target.getDate() + 1);
  }

  target.setHours(endTime.hour, endTime.minute, 0, 0);
  return target;
}
