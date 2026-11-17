import { describeSelection, isDate, isTime } from "#engine";

import type { Profile, Reason, Slot } from "./types.ts";

export const WEEKDAYS = [
  { id: 1, long: "Monday", short: "Mon" },
  { id: 2, long: "Tuesday", short: "Tue" },
  { id: 3, long: "Wednesday", short: "Wed" },
  { id: 4, long: "Thursday", short: "Thu" },
  { id: 5, long: "Friday", short: "Fri" },
  { id: 6, long: "Saturday", short: "Sat" },
  { id: 0, long: "Sunday", short: "Sun" },
];

/** How the Admin words each reason a date or slot is closed. */
export const REASON_LABELS: Record<Reason, string> = {
  blackout: "Blackout",
  closed: "Closed",
  cutoff: "After cut-off",
  full: "Full",
  holiday: "Holiday",
  "lead-time": "Within lead time",
  "no-slots": "No slots",
  "out-of-range": "Too far ahead",
  past: "Passed",
  "same-day-off": "No same-day",
  "unknown-slot": "Unknown slot",
};

/** Common IANA zones offered in the editor; any other valid zone can be typed. */
export const COMMON_TIME_ZONES = [
  "UTC",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Amsterdam",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function emptySlot(index = 0): Slot {
  return {
    capacity: 10,
    code: `slot-${index + 1}`,
    end: "12:00",
    fee: 0,
    label: "",
    start: "09:00",
  };
}

export function emptyProfile(): Profile {
  return {
    blackouts: [],
    code: "",
    enabled: false,
    holidays: [],
    leadTimeMinutes: 120,
    maxDaysAhead: 14,
    name: "",
    nextDayCutoff: "",
    overrides: [],
    priority: 10,
    required: true,
    sameDayCutoff: "",
    sameDayEnabled: false,
    shippingMethods: [],
    slots: [emptySlot()],
    storeViews: [],
    timezone: browserTimeZone(),
    type: "delivery",
    workingDays: [1, 2, 3, 4, 5],
  };
}

/** A deep copy without server-only fields, ready for the editor. */
export function editableCopy(profile: Profile): Profile {
  const { updatedAt: _updatedAt, ...rest } = structuredClone(profile);
  return { ...emptyProfile(), ...rest };
}

/** "Home delivery" -> "home-delivery". */
export function toCode(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 64);
}

function numberOrNull(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Trims text, drops empty rows and turns number fields into numbers before saving. */
export function cleanProfile(profile: Profile): Profile {
  return {
    ...profile,
    blackouts: (profile.blackouts ?? []).filter((b) => b.from || b.to),
    holidays: (profile.holidays ?? []).filter((h) => h.date),
    name: profile.name.trim(),
    overrides: (profile.overrides ?? []).filter((o) => o.date),
    shippingMethods: (profile.shippingMethods ?? [])
      .map((m) => m.trim())
      .filter(Boolean),
    slots: (profile.slots ?? []).map((slot) => ({
      ...slot,
      capacity: numberOrNull(slot.capacity),
      days: slot.days?.length ? slot.days : undefined,
      fee: numberOrNull(slot.fee) ?? 0,
      label: slot.label?.trim() ?? "",
    })),
    storeViews: (profile.storeViews ?? []).map((s) => s.trim()).filter(Boolean),
  };
}

export function describeDays(days: number[] | undefined): string {
  if (!days?.length) {
    return "No days";
  }
  const sorted = WEEKDAYS.filter((d) => days.includes(d.id));
  if (sorted.length === 7) {
    return "Every day";
  }
  const ids = sorted.map((d) => d.id).join(",");
  if (ids === "1,2,3,4,5") {
    return "Mon–Fri";
  }
  if (ids === "1,2,3,4,5,6") {
    return "Mon–Sat";
  }
  return sorted.map((d) => d.short).join(", ");
}

export function describeMethods(profile: Profile): string {
  return profile.shippingMethods?.length
    ? profile.shippingMethods.join(", ")
    : "All shipping methods";
}

export function describeCutoffs(profile: Profile): string {
  const parts: string[] = [];
  if (profile.sameDayEnabled === false) {
    parts.push("No same-day");
  } else if (profile.sameDayCutoff) {
    parts.push(`Same-day until ${profile.sameDayCutoff}`);
  } else {
    parts.push("Same-day");
  }
  if (profile.nextDayCutoff) {
    parts.push(`next-day until ${profile.nextDayCutoff}`);
  }
  return parts.join(", ");
}

export function slotWindow(slot: { start: string; end: string }): string {
  return `${slot.start}–${slot.end}`;
}

export function dateError(value?: string): string | undefined {
  return value && !isDate(value) ? "Use YYYY-MM-DD" : undefined;
}

export function timeError(value?: string): string | undefined {
  return value && !isTime(value) ? "Use HH:MM (24-hour)" : undefined;
}

export function formatDay(date: string, locale?: string): string {
  return describeSelection({ date }, locale);
}

export function money(amount: number | undefined): string {
  return amount && amount > 0 ? amount.toFixed(2) : "";
}
