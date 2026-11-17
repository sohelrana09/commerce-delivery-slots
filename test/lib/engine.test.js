import { describe, expect, test } from "vitest";

import {
  addDays,
  availability,
  capacityOf,
  checkSelection,
  daysBetween,
  describeSelection,
  firstAvailable,
  isDate,
  isTime,
  isValidTimeZone,
  normalizeProfile,
  offsetMinutes,
  publicAvailability,
  publicProfile,
  selectProfile,
  slotKey,
  validateProfile,
  weekdayOf,
  zonedParts,
  zonedTimeToInstant,
} from "#engine";

const at = (iso) => Date.parse(iso);

/** Tue 17 Nov 2026 is the reference "today". London is on GMT (UTC+0) then. */
const london = {
  code: "home",
  holidays: [{ date: "12-25", name: "Christmas" }],
  leadTimeMinutes: 60,
  maxDaysAhead: 10,
  name: "Home delivery",
  nextDayCutoff: "18:00",
  sameDayCutoff: "10:00",
  slots: [
    {
      capacity: 2,
      code: "pm",
      end: "17:00",
      label: "Afternoon",
      start: "12:00",
    },
    { capacity: 2, code: "am", end: "12:00", label: "Morning", start: "08:00" },
    { code: "sat", days: [6], end: "13:00", fee: 5, start: "09:00" },
  ],
  timezone: "Europe/London",
  workingDays: [1, 2, 3, 4, 5],
};

function day(result, date) {
  return result.dates.find((d) => d.date === date);
}

describe("plain dates and times", () => {
  test("validates dates and times", () => {
    expect(isDate("2026-02-28")).toBe(true);
    expect(isDate("2026-02-29")).toBe(false);
    expect(isDate("2028-02-29")).toBe(true);
    expect(isDate("2026-2-1")).toBe(false);
    expect(isDate(20_260_101)).toBe(false);
    expect(isTime("23:59")).toBe(true);
    expect(isTime("24:00")).toBe(false);
    expect(isTime("9:00")).toBe(false);
  });

  test("adds days across months, years and DST changes", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(weekdayOf("2026-11-17")).toBe(2);
  });

  test("reads capacities", () => {
    expect(capacityOf("")).toBeNull();
    expect(capacityOf(undefined)).toBeNull();
    expect(capacityOf("5")).toBe(5);
    expect(capacityOf(0)).toBe(0);
    expect(capacityOf(-1)).toBeNull();
    expect(capacityOf(2.7)).toBe(2);
  });
});

describe("time zones", () => {
  test("knows valid zones", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  test("converts local times in summer and winter", () => {
    expect(
      new Date(
        zonedTimeToInstant("2026-07-01", "09:00", "Europe/London"),
      ).toISOString(),
    ).toBe("2026-07-01T08:00:00.000Z");
    expect(
      new Date(
        zonedTimeToInstant("2026-12-01", "09:00", "Europe/London"),
      ).toISOString(),
    ).toBe("2026-12-01T09:00:00.000Z");
    expect(offsetMinutes(at("2026-07-01T12:00:00Z"), "America/New_York")).toBe(
      -240,
    );
    expect(
      new Date(
        zonedTimeToInstant("2026-07-01", "00:30", "Asia/Kolkata"),
      ).toISOString(),
    ).toBe("2026-06-30T19:00:00.000Z");
  });

  test("moves a time skipped by spring-forward to after the gap", () => {
    // New York jumps from 02:00 EST to 03:00 EDT on 8 March 2026.
    expect(
      new Date(
        zonedTimeToInstant("2026-03-08", "02:30", "America/New_York"),
      ).toISOString(),
    ).toBe("2026-03-08T07:30:00.000Z");
    expect(
      zonedParts(at("2026-03-08T07:30:00Z"), "America/New_York").time,
    ).toBe("03:30");
  });

  test("picks the first of a repeated autumn time", () => {
    // New York falls back from 02:00 EDT to 01:00 EST on 1 November 2026.
    expect(
      new Date(
        zonedTimeToInstant("2026-11-01", "01:30", "America/New_York"),
      ).toISOString(),
    ).toBe("2026-11-01T05:30:00.000Z");
    const start = zonedTimeToInstant("2026-11-01", "00:00", "America/New_York");
    const end = zonedTimeToInstant("2026-11-01", "04:00", "America/New_York");
    expect((end - start) / 3_600_000).toBe(5);
  });

  test("reads the local date across midnight", () => {
    expect(zonedParts(at("2026-06-30T23:30:00Z"), "Europe/London")).toEqual({
      date: "2026-07-01",
      minutes: 30,
      time: "00:30",
      weekday: 3,
    });
    expect(
      zonedParts(at("2026-07-01T02:00:00Z"), "America/Los_Angeles").date,
    ).toBe("2026-06-30");
  });
});

describe("availability", () => {
  test("lists today and the next days with slots in time order", () => {
    const result = availability(london, { now: at("2026-11-17T07:30:00Z") });
    expect(result.today).toBe("2026-11-17");
    expect(result.dates).toHaveLength(11);
    const today = day(result, "2026-11-17");
    expect(today.available).toBe(true);
    expect(today.slots.map((s) => s.code)).toEqual(["am", "pm"]);
    // 08:00 starts within the 60-minute lead time; 12:00 is fine.
    expect(today.slots[0]).toMatchObject({
      available: false,
      reason: "lead-time",
    });
    expect(today.slots[1]).toMatchObject({
      available: true,
      capacity: 2,
      key: "home|2026-11-17|pm",
      remaining: 2,
      startsAt: "2026-11-17T12:00:00.000Z",
    });
    expect(result.profile).toEqual({
      code: "home",
      name: "Home delivery",
      required: true,
      timezone: "Europe/London",
      type: "delivery",
    });
  });

  test("closes today after the same-day cut-off, and the next open day after the next-day cut-off", () => {
    const morning = availability(london, { now: at("2026-11-17T10:30:00Z") });
    expect(day(morning, "2026-11-17")).toMatchObject({
      available: false,
      reason: "cutoff",
    });
    expect(day(morning, "2026-11-18").available).toBe(true);

    const evening = availability(london, { now: at("2026-11-17T18:05:00Z") });
    expect(day(evening, "2026-11-18")).toMatchObject({
      available: false,
      reason: "cutoff",
    });
    expect(day(evening, "2026-11-19").available).toBe(true);
  });

  test("applies the next-day cut-off to the next open day, over a weekend", () => {
    // Friday 20 Nov after 18:00: Saturday has a slot, so Saturday is the next open day.
    const friday = availability(london, { now: at("2026-11-20T18:30:00Z") });
    expect(day(friday, "2026-11-21")).toMatchObject({
      available: false,
      reason: "cutoff",
    });
    expect(day(friday, "2026-11-22")).toMatchObject({
      available: false,
      reason: "closed",
    });
    expect(day(friday, "2026-11-23").available).toBe(true);
  });

  test("opens a non-working day for a slot that names it", () => {
    const result = availability(london, { now: at("2026-11-17T07:00:00Z") });
    const saturday = day(result, "2026-11-21");
    expect(saturday.slots.map((s) => s.code)).toEqual(["sat"]);
    expect(saturday.slots[0]).toMatchObject({
      capacity: null,
      fee: 5,
      remaining: null,
    });
  });

  test("can switch same-day off", () => {
    const result = availability(
      { ...london, sameDayEnabled: false },
      { now: at("2026-11-17T07:00:00Z") },
    );
    expect(day(result, "2026-11-17")).toMatchObject({
      available: false,
      reason: "same-day-off",
    });
  });

  test("closes holidays, blackouts and overridden dates, and lets overrides reopen", () => {
    const profile = {
      ...london,
      blackouts: [{ from: "2026-11-24", name: "Stocktake", to: "2026-11-25" }],
      maxDaysAhead: 45,
      overrides: [
        { closed: true, date: "2026-11-19", name: "Strike" },
        { capacity: { am: 1 }, date: "2026-11-26" },
        { date: "2026-11-29", name: "Sunday opening" },
        { date: "2026-12-25", name: "Christmas special" },
      ],
    };
    const result = availability(profile, { now: at("2026-11-17T07:00:00Z") });
    expect(day(result, "2026-11-19")).toMatchObject({
      available: false,
      name: "Strike",
      reason: "closed",
    });
    expect(day(result, "2026-11-24")).toMatchObject({
      name: "Stocktake",
      reason: "blackout",
    });
    expect(
      day(result, "2026-11-26").slots.find((s) => s.code === "am").capacity,
    ).toBe(1);
    expect(day(result, "2026-11-29")).toMatchObject({
      available: true,
      name: "Sunday opening",
    });
    expect(day(result, "2026-11-29").slots).toHaveLength(3);
    expect(day(result, "2026-12-25")).toMatchObject({
      available: true,
      name: "Christmas special",
    });

    const noOverride = availability(
      { ...profile, overrides: [] },
      { now: at("2026-11-17T07:00:00Z") },
    );
    expect(day(noOverride, "2026-12-25")).toMatchObject({
      name: "Christmas",
      reason: "holiday",
    });
    expect(day(noOverride, "2026-11-29").reason).toBe("closed");
  });

  test("counts bookings and marks full slots and days", () => {
    const booked = { "home|2026-11-18|am": 2, "home|2026-11-18|pm": 5 };
    const result = availability(london, {
      booked,
      now: at("2026-11-17T07:00:00Z"),
    });
    const wednesday = day(result, "2026-11-18");
    expect(wednesday).toMatchObject({ available: false, reason: "full" });
    expect(wednesday.slots[1]).toMatchObject({
      booked: 5,
      reason: "full",
      remaining: 0,
    });
    const map = new Map([["home|2026-11-19|am", 1]]);
    expect(
      day(
        availability(london, { booked: map, now: at("2026-11-17T07:00:00Z") }),
        "2026-11-19",
      ).slots[0].remaining,
    ).toBe(1);
  });

  test("closes a slot with zero capacity", () => {
    const profile = {
      ...london,
      overrides: [{ capacity: { am: 0, pm: 0 }, date: "2026-11-18" }],
    };
    expect(
      day(
        availability(profile, { now: at("2026-11-17T07:00:00Z") }),
        "2026-11-18",
      ),
    ).toMatchObject({
      available: false,
      reason: "closed",
    });
  });

  test("pages with from and days, and never goes past maxDaysAhead", () => {
    const result = availability(london, {
      days: 3,
      from: "2026-11-20",
      now: at("2026-11-17T07:00:00Z"),
    });
    expect(result.dates.map((d) => d.date)).toEqual([
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ]);
    const tail = availability(london, {
      from: "2026-11-26",
      now: at("2026-11-17T07:00:00Z"),
    });
    expect(tail.dates.map((d) => d.date)).toEqual(["2026-11-26", "2026-11-27"]);
    const before = availability(london, {
      from: "2026-01-01",
      now: at("2026-11-17T07:00:00Z"),
    });
    expect(before.dates[0].date).toBe("2026-11-17");
  });

  test("uses the profile's zone, not UTC, for today", () => {
    const tokyo = { ...london, sameDayCutoff: "", timezone: "Asia/Tokyo" };
    // 16:00 UTC Tuesday is 01:00 Wednesday in Tokyo.
    expect(availability(tokyo, { now: at("2026-11-17T16:00:00Z") }).today).toBe(
      "2026-11-18",
    );
  });

  test("keeps slot instants right on a DST change day", () => {
    const ny = {
      ...london,
      leadTimeMinutes: 0,
      maxDaysAhead: 3,
      nextDayCutoff: "",
      slots: [{ code: "early", end: "04:00", start: "01:00" }],
      timezone: "America/New_York",
      workingDays: [0, 1, 2, 3, 4, 5, 6],
    };
    const result = availability(ny, { now: at("2026-10-31T12:00:00Z") });
    const sunday = day(result, "2026-11-01").slots[0];
    expect(sunday.startsAt).toBe("2026-11-01T05:00:00.000Z");
    expect(sunday.endsAt).toBe("2026-11-01T09:00:00.000Z");
  });

  test("defaults missing fields", () => {
    const bare = normalizeProfile({
      code: "x",
      slots: [{ code: "a", end: "10:00", start: "09:00" }],
    });
    expect(bare).toMatchObject({
      enabled: true,
      maxDaysAhead: 14,
      required: true,
      timezone: "UTC",
      type: "delivery",
      workingDays: [1, 2, 3, 4, 5],
    });
    expect(normalizeProfile({ maxDaysAhead: "x", type: "boat" })).toMatchObject(
      { maxDaysAhead: 14, type: "delivery" },
    );
    expect(
      availability(bare, { now: at("2026-11-17T07:00:00Z") }).dates,
    ).toHaveLength(15);
    expect(
      day(availability(bare, { now: at("2026-11-17T07:00:00Z") }), "2026-11-17")
        .slots[0].label,
    ).toBe("09:00–10:00");
  });

  test("marks a profile without slots on a working day as closed", () => {
    const result = availability(
      { ...london, slots: [] },
      { now: at("2026-11-17T07:00:00Z") },
    );
    expect(result.dates.every((d) => d.reason === "closed")).toBe(true);
  });
});

describe("checkSelection", () => {
  const now = at("2026-11-17T10:30:00Z");

  test("accepts an open slot and explains a refusal", () => {
    expect(
      checkSelection(london, { date: "2026-11-18", slot: "am" }, { now }).ok,
    ).toBe(true);
    expect(
      checkSelection(london, { date: "2026-11-17", slot: "pm" }, { now }),
    ).toMatchObject({ ok: false, reason: "cutoff" });
    expect(
      checkSelection(london, { date: "2026-11-18", slot: "nope" }, { now }),
    ).toEqual({ ok: false, reason: "unknown-slot" });
    expect(
      checkSelection(london, { date: "2026-11-22", slot: "am" }, { now }),
    ).toEqual({ ok: false, reason: "closed" });
    expect(
      checkSelection(london, { date: "2026-11-16", slot: "am" }, { now }),
    ).toEqual({ ok: false, reason: "past" });
    expect(
      checkSelection(london, { date: "2027-01-01", slot: "am" }, { now }),
    ).toEqual({ ok: false, reason: "out-of-range" });
    expect(
      checkSelection(london, { date: "bad", slot: "am" }, { now }),
    ).toEqual({ ok: false, reason: "out-of-range" });
    expect(checkSelection(london, {}, { now }).ok).toBe(false);
  });

  test("honours a hold taken before the cut-off with ignoreTime, but not a full slot", () => {
    expect(
      checkSelection(
        london,
        { date: "2026-11-17", slot: "pm" },
        { ignoreTime: true, now },
      ).ok,
    ).toBe(true);
    expect(
      checkSelection(
        london,
        { date: "2026-11-18", slot: "am" },
        { booked: { "home|2026-11-18|am": 2 }, ignoreTime: true, now },
      ),
    ).toMatchObject({ ok: false, reason: "full" });
    expect(
      checkSelection(
        london,
        { date: "2026-11-17", slot: "am" },
        { now: at("2026-11-17T09:00:00Z") },
      ),
    ).toMatchObject({
      reason: "past",
    });
  });

  test("finds the first available slot", () => {
    expect(firstAvailable(london, { now })).toMatchObject({
      date: "2026-11-18",
      slot: { code: "am" },
    });
    expect(firstAvailable({ ...london, slots: [] }, { now })).toBeNull();
  });
});

describe("profiles", () => {
  const base = { ...london, enabled: true };

  test("selects by method, store view and priority", () => {
    const profiles = [
      { ...base, code: "all", priority: 50, shippingMethods: [] },
      {
        ...base,
        code: "flat",
        priority: 10,
        shippingMethods: ["flatrate_flatrate"],
      },
      { ...base, code: "ups", priority: 5, shippingMethods: ["ups_*"] },
      { ...base, code: "fedex", priority: 1, shippingMethods: ["fedex"] },
      { ...base, code: "fr", priority: 0, storeViews: ["fr"] },
      { ...base, code: "off", enabled: false, priority: -1 },
    ];
    const pick = (shippingMethod, storeView = "default") =>
      selectProfile(profiles, { shippingMethod, storeView })?.code;
    expect(pick("flatrate_flatrate")).toBe("flat");
    expect(pick("ups_GND")).toBe("ups");
    expect(pick("fedex_ground")).toBe("fedex");
    expect(pick("fedexx_ground")).toBe("all");
    expect(pick("tablerate_bestway", "fr")).toBe("fr");
    expect(pick("")).toBe("all");
    expect(
      selectProfile([{ ...base, shippingMethods: ["flatrate"] }], {
        shippingMethod: "",
      }),
    ).toBeNull();
    expect(selectProfile(null, {})).toBeNull();
    expect(
      selectProfile([{ ...base, storeViews: ["fr"] }], { shippingMethod: "x" })
        ?.code,
    ).toBe("home");
  });

  test("validates a good profile and reports problems", () => {
    expect(validateProfile(london)).toEqual([]);
    expect(validateProfile(null)).toEqual(["profile must be an object"]);
    const errors = validateProfile({
      blackouts: [
        { from: "2026-12-10", to: "2026-12-01" },
        { from: "x" },
        "bad",
      ],
      code: "Bad Code",
      holidays: [{ date: "25/12" }],
      leadTimeMinutes: 1e9,
      maxDaysAhead: 999,
      name: " ",
      nextDayCutoff: "6pm",
      overrides: [{ date: "x" }],
      sameDayCutoff: "25:00",
      shippingMethods: ["bad method"],
      slots: [
        { code: "a", end: "09:00", start: "10:00" },
        {
          capacity: -2,
          code: "a",
          days: [9],
          end: "11:00",
          fee: -1,
          start: "10:00",
        },
        { code: "", end: "x", start: "y" },
        null,
      ],
      storeViews: ["b@d"],
      timezone: "Nowhere/Here",
      workingDays: [7],
    });
    for (const fragment of [
      "code must use",
      "name is required",
      "not a known time zone",
      "working days",
      "max days ahead",
      "lead time",
      "same-day cut-off",
      "next-day cut-off",
      "shipping methods",
      "store views",
      "holiday 1",
      "blackout 1: to must be",
      "blackout 2: from and to",
      "blackout 3 must be an object",
      "date override 1",
      "slot 1: end must be after start",
      'slot 2: code "a" is used twice',
      "slot 2: days",
      "slot 2: capacity",
      "slot 2: fee",
      "slot 3: code",
      "slot 3: start and end",
      "slot 4 must be an object",
    ]) {
      expect(errors.join("\n")).toContain(fragment);
    }
    expect(validateProfile({ ...london, slots: [] })).toContain(
      "add at least one time slot",
    );
    const many = Array.from({ length: 49 }, (_, i) => ({
      code: `s${i}`,
      end: "10:00",
      start: "09:00",
    }));
    expect(validateProfile({ ...london, slots: many }).join()).toContain(
      "no more than 48",
    );
  });

  test("exposes only public fields", () => {
    const result = availability(london, {
      booked: { "home|2026-11-18|am": 1 },
      now: at("2026-11-17T07:00:00Z"),
    });
    const hidden = publicAvailability(result);
    const slot = day(hidden, "2026-11-18").slots[0];
    expect(slot).not.toHaveProperty("booked");
    expect(slot).not.toHaveProperty("capacity");
    expect(slot).not.toHaveProperty("key");
    expect(slot.remaining).toBeUndefined();
    expect(
      day(publicAvailability(result, { showRemaining: true }), "2026-11-18")
        .slots[0].remaining,
    ).toBe(1);
    expect(
      publicProfile({ code: "x", name: "X", priority: 3 }),
    ).not.toHaveProperty("priority");
  });

  test("describes a selection and builds keys", () => {
    // ICU decides the punctuation of the date part, so check the pieces this module adds.
    const named = describeSelection({
      date: "2026-11-18",
      end: "12:00",
      label: "Morning",
      start: "08:00",
    });
    expect(named).toMatch(/^Wed,? 18 Nov 2026, 08:00–12:00 \(Morning\)$/u);
    const plain = describeSelection({
      date: "2026-11-18",
      end: "12:00",
      label: "08:00–12:00",
      start: "08:00",
    });
    expect(plain).toMatch(/18 Nov 2026, 08:00–12:00$/u);
    expect(describeSelection({ date: "nope" })).toBe("");
    expect(describeSelection({ date: "2026-11-18" }, "en-US")).toBe(
      "Wed, Nov 18, 2026",
    );
    expect(slotKey("a", "2026-01-01", "b")).toBe("a|2026-01-01|b");
  });
});
