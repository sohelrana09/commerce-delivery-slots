/**
 * Delivery Slots availability engine.
 *
 * One dependency-free module shared by the storefront kit (it runs in the shopper's browser), the
 * Admin page (calendar preview and validation) and the App Builder actions (the availability
 * feed, holds and the place-order webhook). Keep it free of DOM and Node APIs so it runs in all
 * three.
 *
 * Every calendar rule is evaluated in the profile's IANA time zone, not the server's or the
 * shopper's, and every slot also gets exact UTC instants (`startsAt`, `endsAt`), so cut-offs and
 * lead times stay correct across daylight saving changes.
 *
 * A profile is one delivery or pickup calendar:
 *
 *   {
 *     code: "standard",                 unique id: lowercase letters, digits, - and _
 *     name: "Standard delivery",        Admin name
 *     enabled: true,
 *     priority: 10,                     lower wins when several profiles match
 *     type: "delivery",                 delivery | pickup
 *     required: true,                   the shopper must pick a slot to place the order
 *     shippingMethods: ["flatrate_flatrate"],   carrier_method, carrier_* or carrier; empty = all
 *     storeViews: [],                   store view codes; empty = all
 *     timezone: "Europe/London",
 *     workingDays: [1, 2, 3, 4, 5],     0 = Sunday ... 6 = Saturday
 *     holidays: [{ date: "12-25", name: "Christmas" }],            YYYY-MM-DD, or MM-DD every year
 *     blackouts: [{ from: "2026-08-01", to: "2026-08-14", name: "Summer shutdown" }],
 *     leadTimeMinutes: 120,             a slot must start at least this long after the order
 *     sameDayEnabled: true,
 *     sameDayCutoff: "10:00",           after this local time, today is closed ("" = no cut-off)
 *     nextDayCutoff: "16:00",           after this, the next open day is closed too ("" = none)
 *     maxDaysAhead: 14,                 the last bookable date is today + maxDaysAhead
 *     slots: [{ code: "am", label: "Morning", start: "09:00", end: "12:00",
 *               days: [], capacity: 20, fee: 0 }],   days empty = every working day;
 *                                                   capacity null = unlimited, 0 = closed
 *     overrides: [{ date: "2026-12-24", closed: false, capacity: { am: 5 }, name: "Xmas Eve" }]
 *   }
 */

export const TYPES = ['delivery', 'pickup'];
export const MAX_SLOTS = 48;
export const MAX_DAYS_AHEAD = 365;
export const MAX_LEAD_MINUTES = 60 * 24 * 60;

/** Why a date or slot can't be booked. The storefront maps these to shopper-facing text. */
export const REASONS = {
  blackout: 'blackout',
  closed: 'closed',
  cutoff: 'cutoff',
  full: 'full',
  holiday: 'holiday',
  leadTime: 'lead-time',
  noSlots: 'no-slots',
  outOfRange: 'out-of-range',
  past: 'past',
  sameDayOff: 'same-day-off',
  unknownSlot: 'unknown-slot',
};

const CODE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_DAY = /^(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 86400000;

/* ------------------------------------------------------------------------------------------ */
/* Plain calendar dates (YYYY-MM-DD). Arithmetic runs in UTC, so it never sees a DST change.   */
/* ------------------------------------------------------------------------------------------ */

function pad(number) {
  return String(number).padStart(2, '0');
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isDate(value) {
  const match = typeof value === 'string' ? DATE.exec(value) : null;
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** True for HH:MM on a 24-hour clock. */
export function isTime(value) {
  return typeof value === 'string' && TIME.test(value);
}

/** Minutes after midnight for HH:MM. */
export function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function dateToUtcMs(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcMsToDate(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(date, days) {
  return utcMsToDate(dateToUtcMs(date) + days * DAY_MS);
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a, b) {
  return Math.round((dateToUtcMs(b) - dateToUtcMs(a)) / DAY_MS);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(date) {
  return new Date(dateToUtcMs(date)).getUTCDay();
}

/* ------------------------------------------------------------------------------------------ */
/* Time zones. Intl does the IANA lookups, so this works in browsers, Node and the Admin.     */
/* ------------------------------------------------------------------------------------------ */

const formatters = new Map();

function formatter(timeZone) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      second: '2-digit',
      timeZone,
      year: 'numeric',
    });
    formatters.set(timeZone, format);
  }
  return format;
}

export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

function wallClock(instant, timeZone) {
  const fields = {};
  formatter(timeZone).formatToParts(new Date(instant)).forEach((part) => {
    fields[part.type] = part.value;
  });
  return {
    day: Number(fields.day),
    hour: Number(fields.hour) % 24,
    minute: Number(fields.minute),
    month: Number(fields.month),
    second: Number(fields.second),
    year: Number(fields.year),
  };
}

/** The zone's UTC offset in minutes at an instant (for example 60 for London in summer). */
export function offsetMinutes(instant, timeZone) {
  const c = wallClock(instant, timeZone);
  const asUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60000);
}

/** The local date, time and weekday in a zone at an instant. */
export function zonedParts(instant, timeZone) {
  const c = wallClock(instant, timeZone);
  const date = `${c.year}-${pad(c.month)}-${pad(c.day)}`;
  return {
    date,
    minutes: c.hour * 60 + c.minute,
    time: `${pad(c.hour)}:${pad(c.minute)}`,
    weekday: weekdayOf(date),
  };
}

/**
 * The UTC instant (ms) of a local date and time in a zone.
 *
 * - A time skipped by a spring-forward change (02:30 in New York in March) moves forward by the
 *   gap (03:30), like Temporal's "compatible" disambiguation.
 * - A time that occurs twice in the autumn (01:30 in New York in November) resolves to the
 *   first occurrence.
 */
export function zonedTimeToInstant(date, time, timeZone) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const local = Date.UTC(y, m - 1, d, h, mi);
  const before = offsetMinutes(local - DAY_MS, timeZone);
  const after = offsetMinutes(local + DAY_MS, timeZone);
  const valid = [...new Set([before, after])]
    .map((offset) => local - offset * 60000)
    .filter((instant) => {
      const c = wallClock(instant, timeZone);
      return c.hour === h && c.minute === mi && c.day === d;
    });
  if (valid.length) return Math.min(...valid);
  // In a gap: read the wall clock with the offset from before the change.
  return local - before * 60000;
}

/* ------------------------------------------------------------------------------------------ */
/* Profiles                                                                                   */
/* ------------------------------------------------------------------------------------------ */

function list(value) {
  return Array.isArray(value) ? value : [];
}

function finiteOr(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Capacity as a number, or null for unlimited. */
export function capacityOf(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

/** Fills in defaults so the rest of the engine can rely on every field. */
export function normalizeProfile(profile = {}) {
  return {
    ...profile,
    blackouts: list(profile.blackouts),
    enabled: profile.enabled !== false,
    holidays: list(profile.holidays),
    leadTimeMinutes: Math.max(0, finiteOr(profile.leadTimeMinutes, 0)),
    maxDaysAhead: Math.max(0, Math.floor(finiteOr(profile.maxDaysAhead, 14))),
    nextDayCutoff: profile.nextDayCutoff || '',
    overrides: list(profile.overrides),
    priority: finiteOr(profile.priority, 0),
    required: profile.required !== false,
    sameDayCutoff: profile.sameDayCutoff || '',
    sameDayEnabled: profile.sameDayEnabled !== false,
    shippingMethods: list(profile.shippingMethods),
    slots: list(profile.slots),
    storeViews: list(profile.storeViews),
    timezone: profile.timezone || 'UTC',
    type: TYPES.includes(profile.type) ? profile.type : 'delivery',
    workingDays: Array.isArray(profile.workingDays) ? profile.workingDays : [1, 2, 3, 4, 5],
  };
}

function validateDateRule(entry, label, errors) {
  if (!entry || typeof entry !== 'object') {
    errors.push(`${label} must be an object`);
    return false;
  }
  return true;
}

function isWeekdayList(days) {
  return Array.isArray(days) && days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}

function validateSlots(slots, errors) {
  const codes = new Set();
  if (!Array.isArray(slots) || slots.length === 0) {
    errors.push('add at least one time slot');
    return;
  }
  if (slots.length > MAX_SLOTS) errors.push(`no more than ${MAX_SLOTS} time slots`);
  slots.forEach((slot, index) => {
    const label = `slot ${index + 1}`;
    if (!slot || typeof slot !== 'object') {
      errors.push(`${label} must be an object`);
      return;
    }
    if (!CODE.test(slot.code ?? '')) {
      errors.push(`${label}: code must use lowercase letters, digits, - or _`);
    } else if (codes.has(slot.code)) {
      errors.push(`${label}: code "${slot.code}" is used twice`);
    } else {
      codes.add(slot.code);
    }
    if (!isTime(slot.start) || !isTime(slot.end)) {
      errors.push(`${label}: start and end must be HH:MM`);
    } else if (toMinutes(slot.end) <= toMinutes(slot.start)) {
      errors.push(`${label}: end must be after start`);
    }
    if (slot.days !== undefined && !isWeekdayList(slot.days)) {
      errors.push(`${label}: days must be weekday numbers from 0 (Sunday) to 6`);
    }
    if (slot.capacity !== undefined && slot.capacity !== null && slot.capacity !== '' && capacityOf(slot.capacity) === null) {
      errors.push(`${label}: capacity must be a whole number of 0 or more, or empty for unlimited`);
    }
    if (slot.fee !== undefined && slot.fee !== '' && slot.fee !== null && !(Number(slot.fee) >= 0)) {
      errors.push(`${label}: fee must be 0 or more`);
    }
  });
}

/** Problems with a profile, as readable messages. An empty list means it's valid. */
export function validateProfile(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return ['profile must be an object'];
  const p = normalizeProfile(input);
  if (!CODE.test(p.code ?? '')) errors.push('code must use lowercase letters, digits, - or _ (up to 64)');
  if (typeof p.name !== 'string' || !p.name.trim()) errors.push('name is required');
  if (!isValidTimeZone(p.timezone)) errors.push(`"${p.timezone}" is not a known time zone`);
  if (!isWeekdayList(p.workingDays)) {
    errors.push('working days must be weekday numbers from 0 (Sunday) to 6');
  }
  if (p.maxDaysAhead > MAX_DAYS_AHEAD) errors.push(`max days ahead must be ${MAX_DAYS_AHEAD} or less`);
  if (p.leadTimeMinutes > MAX_LEAD_MINUTES) errors.push('lead time is too long (60 days at most)');
  if (p.sameDayCutoff && !isTime(p.sameDayCutoff)) errors.push('same-day cut-off must be HH:MM');
  if (p.nextDayCutoff && !isTime(p.nextDayCutoff)) errors.push('next-day cut-off must be HH:MM');
  if (!p.shippingMethods.every((m) => typeof m === 'string' && /^[A-Za-z0-9_*-]{1,128}$/.test(m))) {
    errors.push('shipping methods must be codes such as flatrate_flatrate, flatrate_* or flatrate');
  }
  if (!p.storeViews.every((s) => typeof s === 'string' && /^[a-z0-9_]{1,64}$/i.test(s))) {
    errors.push('store views must be store view codes');
  }
  p.holidays.forEach((h, i) => {
    if (validateDateRule(h, `holiday ${i + 1}`, errors) && !(isDate(h.date) || MONTH_DAY.test(h.date ?? ''))) {
      errors.push(`holiday ${i + 1}: date must be YYYY-MM-DD, or MM-DD for every year`);
    }
  });
  p.blackouts.forEach((b, i) => {
    if (!validateDateRule(b, `blackout ${i + 1}`, errors)) return;
    if (!isDate(b.from) || !isDate(b.to)) errors.push(`blackout ${i + 1}: from and to must be YYYY-MM-DD`);
    else if (b.to < b.from) errors.push(`blackout ${i + 1}: to must be on or after from`);
  });
  p.overrides.forEach((o, i) => {
    if (validateDateRule(o, `date override ${i + 1}`, errors) && !isDate(o.date)) {
      errors.push(`date override ${i + 1}: date must be YYYY-MM-DD`);
    }
  });
  validateSlots(input.slots, errors);
  return errors;
}

function methodMatches(pattern, method) {
  if (!method) return false;
  if (pattern === method) return true;
  if (pattern.endsWith('*')) return method.startsWith(pattern.slice(0, -1));
  return method.startsWith(`${pattern}_`);
}

/**
 * The profile for a shipping method and store view: the enabled profile with the lowest
 * priority whose methods and store views match. Null when none applies, so no slot is needed.
 * Without a store view (the webhook may not know it), store view limits are not checked.
 */
export function selectProfile(profiles, { shippingMethod = '', storeView = '' } = {}) {
  const candidates = list(profiles)
    .map(normalizeProfile)
    .filter((p) => p.enabled)
    .filter((p) => !storeView || !p.storeViews.length || p.storeViews.includes(storeView))
    .filter((p) => !p.shippingMethods.length
      || p.shippingMethods.some((m) => methodMatches(m, shippingMethod)))
    .sort((a, b) => a.priority - b.priority || String(a.code).localeCompare(String(b.code)));
  return candidates[0] ?? null;
}

/** Identifies one slot on one date for capacity counting. */
export function slotKey(profileCode, date, slotCode) {
  return `${profileCode}|${date}|${slotCode}`;
}

/* ------------------------------------------------------------------------------------------ */
/* Availability                                                                               */
/* ------------------------------------------------------------------------------------------ */

function holidayOn(profile, date) {
  const monthDay = date.slice(5);
  return profile.holidays.find((h) => h?.date === date || h?.date === monthDay) ?? null;
}

function blackoutOn(profile, date) {
  return profile.blackouts
    .find((b) => b && isDate(b.from) && isDate(b.to) && date >= b.from && date <= b.to) ?? null;
}

function overrideOn(profile, date) {
  return profile.overrides.find((o) => o?.date === date) ?? null;
}

function slotsOn(profile, date) {
  const weekday = weekdayOf(date);
  return profile.slots.filter((slot) => (Array.isArray(slot.days) && slot.days.length
    ? slot.days.includes(weekday)
    : profile.workingDays.includes(weekday)));
}

/** Whether the calendar opens a date at all, before cut-offs and capacity. */
function calendarStatus(profile, date) {
  const override = overrideOn(profile, date);
  if (override?.closed) return { open: false, reason: REASONS.closed, name: override.name };
  const holiday = holidayOn(profile, date);
  if (holiday && !override) return { open: false, reason: REASONS.holiday, name: holiday.name };
  const blackout = blackoutOn(profile, date);
  if (blackout && !override) return { open: false, reason: REASONS.blackout, name: blackout.name };
  const weekday = weekdayOf(date);
  const hasSlots = slotsOn(profile, date).length > 0;
  // An override (for example a Sunday opening) opens the date with all slots.
  if (override && !hasSlots) return { open: true, name: override.name, allSlots: true };
  if (!hasSlots || (!profile.workingDays.includes(weekday) && !override)) {
    // A slot can name a non-working day explicitly, which opens that day for that slot only.
    return hasSlots ? { open: true } : { open: false, reason: REASONS.closed };
  }
  return { open: true, name: override?.name };
}

function nextOpenDate(profile, today) {
  for (let i = 1; i <= Math.max(profile.maxDaysAhead, 1) + 31; i += 1) {
    const date = addDays(today, i);
    if (calendarStatus(profile, date).open) return date;
  }
  return null;
}

function dateCutoff(profile, date, clock) {
  if (date === clock.today) {
    if (!profile.sameDayEnabled) return REASONS.sameDayOff;
    if (profile.sameDayCutoff && clock.minutes >= toMinutes(profile.sameDayCutoff)) {
      return REASONS.cutoff;
    }
  }
  const afterNextDayCutoff = profile.nextDayCutoff
    && clock.minutes >= toMinutes(profile.nextDayCutoff);
  if (afterNextDayCutoff && date === clock.nextOpen) {
    return REASONS.cutoff;
  }
  return null;
}

function bookedFor(booked, key) {
  if (booked instanceof Map) return Number(booked.get(key) ?? 0);
  return Number(booked?.[key] ?? 0);
}

function evaluateSlot(profile, date, slot, ctx, dateReason) {
  const tz = profile.timezone;
  const startsAt = zonedTimeToInstant(date, slot.start, tz);
  const endsAt = zonedTimeToInstant(date, slot.end, tz);
  const override = overrideOn(profile, date);
  const overrideCapacity = override?.capacity && Object.hasOwn(override.capacity, slot.code)
    ? override.capacity[slot.code]
    : undefined;
  const capacity = capacityOf(overrideCapacity !== undefined ? overrideCapacity : slot.capacity);
  const key = slotKey(profile.code, date, slot.code);
  const booked = bookedFor(ctx.booked, key);
  const remaining = capacity === null ? null : Math.max(0, capacity - booked);
  let reason = dateReason;
  if (!reason && startsAt < ctx.now + profile.leadTimeMinutes * 60000) {
    reason = startsAt <= ctx.now ? REASONS.past : REASONS.leadTime;
  }
  if (!reason && capacity === 0) reason = REASONS.closed;
  if (!reason && remaining === 0) reason = REASONS.full;
  const fee = Number(slot.fee) > 0 ? Number(slot.fee) : 0;
  return {
    available: !reason,
    booked,
    capacity,
    code: slot.code,
    end: slot.end,
    endsAt: new Date(endsAt).toISOString(),
    fee,
    key,
    label: slot.label || `${slot.start}–${slot.end}`,
    ...(reason ? { reason } : {}),
    remaining,
    start: slot.start,
    startsAt: new Date(startsAt).toISOString(),
  };
}

function evaluateDate(profile, date, ctx) {
  const weekday = weekdayOf(date);
  const day = { date, weekday };
  if (date < ctx.clock.today) {
    return {
      ...day, available: false, reason: REASONS.past, slots: [],
    };
  }
  if (daysBetween(ctx.clock.today, date) > profile.maxDaysAhead) {
    return {
      ...day, available: false, reason: REASONS.outOfRange, slots: [],
    };
  }
  const status = calendarStatus(profile, date);
  if (!status.open) {
    return {
      ...day,
      available: false,
      ...(status.name ? { name: status.name } : {}),
      reason: status.reason,
      slots: [],
    };
  }
  const daySlots = status.allSlots ? profile.slots : slotsOn(profile, date);
  const dateReason = dateCutoff(profile, date, ctx.clock);
  const slots = daySlots
    .slice()
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
    .map((slot) => evaluateSlot(profile, date, slot, ctx, dateReason));
  const available = slots.some((slot) => slot.available);
  let reason;
  if (!available) {
    const allFull = slots.every((s) => s.reason === REASONS.full);
    reason = dateReason ?? (allFull ? REASONS.full : slots[0]?.reason ?? REASONS.noSlots);
  }
  return {
    ...day,
    available,
    ...(status.name ? { name: status.name } : {}),
    ...(reason ? { reason } : {}),
    slots,
  };
}

function context(input, options) {
  const profile = normalizeProfile(input);
  const now = options.now ?? Date.now();
  const local = zonedParts(now, profile.timezone);
  const clock = { minutes: local.minutes, today: local.date };
  clock.nextOpen = nextOpenDate(profile, clock.today);
  return { profile, ctx: { booked: options.booked ?? {}, clock, now } };
}

/**
 * Every date from today (in the profile's zone) to today + maxDaysAhead, with its slots.
 * Closed dates are included with `available: false` and a `reason`, so a calendar can show them.
 *
 * @param {object} profile
 * @param {object} [options]
 * @param {number} [options.now] the current instant (ms), for tests and previews
 * @param {object|Map} [options.booked] bookings per slotKey()
 * @param {string} [options.from] first date to return (YYYY-MM-DD), not before today
 * @param {number} [options.days] how many dates to return at most
 */
export function availability(input, options = {}) {
  const { profile, ctx } = context(input, options);
  const { today } = ctx.clock;
  const first = isDate(options.from) && options.from > today ? options.from : today;
  const last = addDays(ctx.clock.today, profile.maxDaysAhead);
  const limit = Number.isInteger(options.days) && options.days > 0 ? options.days : Infinity;
  const dates = [];
  for (let date = first; date <= last && dates.length < limit; date = addDays(date, 1)) {
    dates.push(evaluateDate(profile, date, ctx));
  }
  return {
    dates,
    profile: publicProfile(profile),
    today: ctx.clock.today,
  };
}

/**
 * Checks a shopper's choice right now. Returns `{ ok: true, slot }` or `{ ok: false, reason }`.
 * Pass `ignoreTime: true` to skip cut-offs and lead time (for a hold taken before a cut-off).
 */
export function checkSelection(input, { date, slot } = {}, options = {}) {
  if (!isDate(date)) return { ok: false, reason: REASONS.outOfRange };
  const { profile, ctx } = context(input, options);
  const day = evaluateDate(profile, date, ctx);
  const found = day.slots.find((s) => s.code === slot);
  if (!found) {
    const reason = day.slots.length || day.available ? REASONS.unknownSlot : day.reason;
    return { ok: false, reason };
  }
  if (found.available) return { ok: true, slot: found };
  const timeReasons = [REASONS.cutoff, REASONS.leadTime, REASONS.sameDayOff];
  if (options.ignoreTime && timeReasons.includes(found.reason)) {
    return { ok: true, slot: { ...found, available: true, reason: undefined } };
  }
  return { ok: false, reason: found.reason, slot: found };
}

/** The first bookable date and slot, or null. */
export function firstAvailable(input, options = {}) {
  const { dates } = availability(input, options);
  const day = dates.find((d) => d.slots.some((s) => s.available));
  return day ? { date: day.date, slot: day.slots.find((s) => s.available) } : null;
}

/** The fields shoppers may see: no capacities, priorities or internal rules. */
export function publicProfile(input) {
  const p = normalizeProfile(input);
  return {
    code: p.code,
    name: p.name,
    required: p.required,
    timezone: p.timezone,
    type: p.type,
  };
}

/** Strips booking counts from availability for the public feed when capacity is hidden. */
export function publicAvailability(result, { showRemaining = false } = {}) {
  return {
    ...result,
    dates: result.dates.map((day) => ({
      ...day,
      slots: day.slots.map(({
        booked: _booked, capacity: _capacity, key: _key, ...slot
      }) => (showRemaining
        ? slot
        : { ...slot, remaining: undefined })),
    })),
  };
}

/** "Tue 18 Nov 2026, 09:00–12:00 (Morning)" for order comments, emails and the Admin. */
export function describeSelection({
  date, start, end, label,
}, locale = 'en-GB') {
  if (!isDate(date)) return '';
  const day = new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'short', timeZone: 'UTC', weekday: 'short', year: 'numeric',
  }).format(new Date(dateToUtcMs(date)));
  const window = isTime(start) && isTime(end) ? `, ${start}–${end}` : '';
  const name = label && label !== `${start}–${end}` ? ` (${label})` : '';
  return `${day}${window}${name}`;
}
