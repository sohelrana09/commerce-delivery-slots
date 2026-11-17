import { describe, expect, test } from "vitest";

import {
  releaseCapacity,
  reserveCapacity,
  usageFor,
} from "../../src/common/slots/capacity.js";
import { RESERVATIONS, USAGE } from "../../src/common/slots/db.js";
import {
  acceptAtCheckout,
  adminRelease,
  applyOrderEvent,
  expireStale,
  findReservation,
  listBookings,
  orderComment,
  placeHold,
  releaseHold,
  SlotError,
  shopperMessage,
} from "../../src/common/slots/reservations.js";
import { createFakeDb } from "../fixtures/fake-db.js";

const NOW = Date.parse("2026-11-17T07:30:00Z");
const MIN = 60_000;

const profile = {
  code: "home",
  enabled: true,
  leadTimeMinutes: 60,
  maxDaysAhead: 10,
  name: "Home delivery",
  nextDayCutoff: "18:00",
  sameDayCutoff: "10:00",
  shippingMethods: ["flatrate_flatrate"],
  slots: [
    { capacity: 2, code: "am", end: "12:00", label: "Morning", start: "08:00" },
    {
      capacity: 1,
      code: "pm",
      end: "17:00",
      fee: 4.5,
      label: "Afternoon",
      start: "12:00",
    },
    { code: "eve", end: "21:00", start: "17:00" },
  ],
  timezone: "Europe/London",
  workingDays: [1, 2, 3, 4, 5],
};
const pickup = {
  ...profile,
  code: "pickup",
  required: false,
  shippingMethods: ["instore_pickup"],
  type: "pickup",
};
const PROFILES = [profile, pickup];

const hold = (quoteId, date, slot, extra = {}) => ({
  date,
  quoteId,
  shippingMethod: "flatrate_flatrate",
  slot,
  storeView: "default",
  ...extra,
});

function booked(db, key) {
  return db.docs(USAGE).find((d) => d.key === key)?.booked ?? 0;
}

async function rejects(promise, reason) {
  const error = await promise.catch((e) => e);
  expect(error).toBeInstanceOf(SlotError);
  expect(error.reason).toBe(reason);
}

describe("capacity counters", () => {
  test("never overbook when many shoppers take the last places at once", async () => {
    const db = createFakeDb();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        reserveCapacity(db.client, "k|2026-11-18|am", 3),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(booked(db, "k|2026-11-18|am")).toBe(3);
    expect(db.docs(USAGE)).toHaveLength(1);
  });

  test("books unlimited and forced places, and never releases below zero", async () => {
    const db = createFakeDb();
    expect(await reserveCapacity(db.client, "k|d|s", 0)).toBe(false);
    expect(await reserveCapacity(db.client, "k|d|s", 0, { force: true })).toBe(
      true,
    );
    expect(await reserveCapacity(db.client, "k|d|s", null)).toBe(true);
    expect(await releaseCapacity(db.client, "k|d|s")).toBe(true);
    expect(await releaseCapacity(db.client, "k|d|s")).toBe(true);
    expect(await releaseCapacity(db.client, "k|d|s")).toBe(false);
    expect(booked(db, "k|d|s")).toBe(0);
    expect(db.docs(USAGE)[0]).toMatchObject({
      date: "d",
      profile: "k",
      slot: "s",
    });
  });

  test("tolerates a counter created by a racing request", async () => {
    const db = createFakeDb();
    const usage = db.client.collection(USAGE);
    const original = usage.updateOne;
    let first = true;
    db.client.collection = () => ({
      ...usage,
      updateOne: async (query, change, options) => {
        if (first && options?.upsert) {
          first = false;
          await original({ key: query.key }, change, options);
          const error = new Error("E11000 duplicate key error");
          throw error;
        }
        return original(query, change, options);
      },
    });
    expect(await reserveCapacity(db.client, "a|b|c", 1)).toBe(true);
  });

  test("rethrows other database errors", async () => {
    const db = createFakeDb({
      failOn: (name, op) => name === USAGE && op === "updateOne",
    });
    await expect(reserveCapacity(db.client, "a|b|c", 1)).rejects.toThrow(
      "fake failure",
    );
  });

  test("reads usage for a profile and date range", async () => {
    const db = createFakeDb();
    db.seed(USAGE, [
      {
        booked: 2,
        date: "2026-11-18",
        key: "home|2026-11-18|am",
        profile: "home",
      },
      {
        booked: 1,
        date: "2026-12-30",
        key: "home|2026-12-30|am",
        profile: "home",
      },
      {
        booked: 4,
        date: "2026-11-18",
        key: "other|2026-11-18|am",
        profile: "other",
      },
      { date: "2026-11-19", key: "home|2026-11-19|am", profile: "home" },
    ]);
    expect(
      await usageFor(db.client, "home", "2026-11-17", "2026-11-30"),
    ).toEqual({
      "home|2026-11-18|am": 2,
      "home|2026-11-19|am": 0,
    });
  });
});

describe("holds", () => {
  test("holds a place, extends it, and moves it to another slot", async () => {
    const db = createFakeDb();
    const first = await placeHold(
      db.client,
      PROFILES,
      hold("q1", "2026-11-18", "am"),
      { holdMinutes: 15, now: NOW },
    );
    expect(first).toMatchObject({
      date: "2026-11-18",
      expiresAt: new Date(NOW + 15 * MIN).toISOString(),
      key: "home|2026-11-18|am",
      label: "Morning",
      profile: "home",
      quoteId: "q1",
      status: "hold",
      type: "delivery",
    });
    expect(booked(db, "home|2026-11-18|am")).toBe(1);

    const again = await placeHold(
      db.client,
      PROFILES,
      hold("q1", "2026-11-18", "am"),
      { now: NOW + 5 * MIN },
    );
    expect(again.expiresAt).toBe(new Date(NOW + 25 * MIN).toISOString());
    expect(booked(db, "home|2026-11-18|am")).toBe(1);

    await placeHold(db.client, PROFILES, hold("q1", "2026-11-18", "pm"), {
      now: NOW,
    });
    expect(booked(db, "home|2026-11-18|am")).toBe(0);
    expect(booked(db, "home|2026-11-18|pm")).toBe(1);
    expect(db.docs(RESERVATIONS)).toHaveLength(1);
  });

  test("refuses a full slot, a closed date and a method without a profile", async () => {
    const db = createFakeDb();
    await placeHold(db.client, PROFILES, hold("q1", "2026-11-18", "pm"), {
      now: NOW,
    });
    await rejects(
      placeHold(db.client, PROFILES, hold("q2", "2026-11-18", "pm"), {
        now: NOW,
      }),
      "full",
    );
    await rejects(
      placeHold(db.client, PROFILES, hold("q2", "2026-11-22", "am"), {
        now: NOW,
      }),
      "closed",
    );
    await rejects(
      placeHold(
        db.client,
        PROFILES,
        hold("q2", "2026-11-18", "am", { shippingMethod: "ups_GND" }),
        { now: NOW },
      ),
      "no-profile",
    );
    expect(booked(db, "home|2026-11-18|pm")).toBe(1);
    expect(await findReservation(db.client, "q2")).toBeNull();
  });

  test("frees expired holds when a slot looks full", async () => {
    const db = createFakeDb();
    await placeHold(db.client, PROFILES, hold("q1", "2026-11-18", "pm"), {
      holdMinutes: 10,
      now: NOW,
    });
    const later = NOW + 11 * MIN;
    const taken = await placeHold(
      db.client,
      PROFILES,
      hold("q2", "2026-11-18", "pm"),
      { now: later },
    );
    expect(taken.quoteId).toBe("q2");
    expect((await findReservation(db.client, "q1")).status).toBe("expired");
    expect(booked(db, "home|2026-11-18|pm")).toBe(1);
  });

  test("refuses a new hold once the cart's order is confirmed", async () => {
    const db = createFakeDb();
    await placeHold(db.client, PROFILES, hold("q1", "2026-11-18", "am"), {
      now: NOW,
    });
    await applyOrderEvent(
      db.client,
      { orderId: "1", quoteId: "q1", state: "new" },
      { now: NOW },
    );
    await rejects(
      placeHold(db.client, PROFILES, hold("q1", "2026-11-19", "am"), {
        now: NOW,
      }),
      "already-placed",
    );
  });

  test("releases a hold once", async () => {
    const db = createFakeDb();
    await placeHold(db.client, PROFILES, hold("q1", "2026-11-18", "am"), {
      now: NOW,
    });
    expect(await releaseHold(db.client, "q1", { now: NOW })).toBe(true);
    expect(await releaseHold(db.client, "q1", { now: NOW })).toBe(false);
    expect(booked(db, "home|2026-11-18|am")).toBe(0);
  });

  test("counts each place once when the same cart races two picks", async () => {
    const db = createFakeDb();
    await Promise.all([
      placeHold(db.client, PROFILES, hold("q1", "2026-11-18", "am"), {
        now: NOW,
      }),
      placeHold(db.client, PROFILES, hold("q1", "2026-11-19", "am"), {
        now: NOW,
      }),
      placeHold(db.client, PROFILES, hold("q1", "2026-11-20", "am"), {
        now: NOW,
      }),
    ]);
    const total = db.docs(USAGE).reduce((sum, d) => sum + d.booked, 0);
    expect(total).toBe(1);
    const live = await findReservation(db.client, "q1");
    expect(booked(db, live.key)).toBe(1);
  });
});

describe("place-order webhook", () => {
  test("accepts a held slot even after its cut-off, and moves it to pending", async () => {
    const db = createFakeDb();
    await placeHold(db.client, PROFILES, hold("q1", "2026-11-17", "pm"), {
      now: NOW,
    });
    const late = Date.parse("2026-11-17T10:45:00Z");
    const result = await acceptAtCheckout(
      db.client,
      PROFILES,
      { quoteId: "q1", selection: null, shippingMethod: "flatrate_flatrate" },
      { now: late },
    );
    expect(result.reservation).toMatchObject({ status: "pending" });
    expect(booked(db, "home|2026-11-17|pm")).toBe(1);
    // A retried webhook changes nothing.
    await acceptAtCheckout(
      db.client,
      PROFILES,
      { quoteId: "q1", shippingMethod: "flatrate_flatrate" },
      { now: late },
    );
    expect(booked(db, "home|2026-11-17|pm")).toBe(1);
  });

  test("books a slot from the order's custom attributes when there's no hold", async () => {
    const db = createFakeDb();
    const order = {
      quoteId: "q9",
      selection: { date: "2026-11-19", profile: "home", slot: "am" },
      shippingMethod: "flatrate_flatrate",
    };
    const result = await acceptAtCheckout(db.client, PROFILES, order, {
      now: NOW,
    });
    expect(result.reservation).toMatchObject({
      key: "home|2026-11-19|am",
      status: "pending",
    });
    expect(booked(db, "home|2026-11-19|am")).toBe(1);
  });

  test("replaces a hold with the different slot the order carries", async () => {
    const db = createFakeDb();
    await placeHold(db.client, PROFILES, hold("q1", "2026-11-18", "am"), {
      now: NOW,
    });
    await acceptAtCheckout(
      db.client,
      PROFILES,
      {
        quoteId: "q1",
        selection: { date: "2026-11-19", slot: "am" },
        shippingMethod: "flatrate_flatrate",
      },
      { now: NOW },
    );
    expect(booked(db, "home|2026-11-18|am")).toBe(0);
    expect(booked(db, "home|2026-11-19|am")).toBe(1);
  });

  test("blocks a missing required slot, a passed cut-off and a full slot", async () => {
    const db = createFakeDb();
    const flat = { quoteId: "q2", shippingMethod: "flatrate_flatrate" };
    await rejects(
      acceptAtCheckout(db.client, PROFILES, flat, { now: NOW }),
      "required",
    );
    await rejects(
      acceptAtCheckout(
        db.client,
        PROFILES,
        { ...flat, selection: { date: "2026-11-17", slot: "pm" } },
        {
          now: Date.parse("2026-11-17T10:45:00Z"),
        },
      ),
      "cutoff",
    );
    await placeHold(db.client, PROFILES, hold("q1", "2026-11-18", "pm"), {
      now: NOW,
    });
    await rejects(
      acceptAtCheckout(
        db.client,
        PROFILES,
        { ...flat, selection: { date: "2026-11-18", slot: "pm" } },
        { now: NOW },
      ),
      "full",
    );
  });

  test("lets orders through that need no slot", async () => {
    const db = createFakeDb();
    expect(
      await acceptAtCheckout(
        db.client,
        PROFILES,
        { quoteId: "q1", shippingMethod: "ups_GND" },
        { now: NOW },
      ),
    ).toEqual({ ok: true, skipped: "no-profile" });
    expect(
      await acceptAtCheckout(
        db.client,
        PROFILES,
        { quoteId: "q1", shippingMethod: "instore_pickup" },
        { now: NOW },
      ),
    ).toEqual({ ok: true, skipped: "not-chosen" });
    expect(
      await acceptAtCheckout(
        db.client,
        PROFILES,
        {
          selection: { date: "2026-11-18", slot: "am" },
          shippingMethod: "flatrate_flatrate",
        },
        { now: NOW },
      ),
    ).toEqual({ ok: true, skipped: "no-quote" });
  });

  test("returns a confirmed reservation unchanged", async () => {
    const db = createFakeDb();
    await placeHold(db.client, PROFILES, hold("q1", "2026-11-18", "am"), {
      now: NOW,
    });
    await applyOrderEvent(
      db.client,
      { orderId: "5", quoteId: "q1", state: "new" },
      { now: NOW },
    );
    const result = await acceptAtCheckout(
      db.client,
      PROFILES,
      { quoteId: "q1", shippingMethod: "flatrate_flatrate" },
      { now: NOW },
    );
    expect(result.reservation.status).toBe("confirmed");
  });
});

describe("order events", () => {
  test("confirms, then releases on cancellation, once", async () => {
    const db = createFakeDb();
    await placeHold(db.client, PROFILES, hold("q1", "2026-11-18", "am"), {
      now: NOW,
    });
    await acceptAtCheckout(
      db.client,
      PROFILES,
      { quoteId: "q1", shippingMethod: "flatrate_flatrate" },
      { now: NOW },
    );
    const placed = await applyOrderEvent(
      db.client,
      { incrementId: "000000042", orderId: "42", quoteId: "q1", state: "new" },
      { now: NOW },
    );
    expect(placed.result).toBe("confirmed");
    expect(placed.reservation).toMatchObject({
      expiresAt: null,
      incrementId: "000000042",
      orderId: "42",
    });
    expect(
      (await applyOrderEvent(db.client, { quoteId: "q1", state: "processing" }))
        .result,
    ).toBe("unchanged");

    const cancelled = await applyOrderEvent(
      db.client,
      { quoteId: "q1", state: "canceled" },
      { now: NOW },
    );
    expect(cancelled.result).toBe("cancelled");
    expect(booked(db, "home|2026-11-18|am")).toBe(0);
    expect(
      (await applyOrderEvent(db.client, { quoteId: "q1", state: "canceled" }))
        .result,
    ).toBe("unchanged");
    expect(booked(db, "home|2026-11-18|am")).toBe(0);
  });

  test("keeps the slot of an order whose reservation had expired", async () => {
    const db = createFakeDb();
    await placeHold(db.client, PROFILES, hold("q1", "2026-11-18", "pm"), {
      holdMinutes: 5,
      now: NOW,
    });
    await expireStale(db.client, { nowMs: NOW + 6 * MIN });
    await placeHold(db.client, PROFILES, hold("q2", "2026-11-18", "pm"), {
      now: NOW + 6 * MIN,
    });
    const revived = await applyOrderEvent(
      db.client,
      { orderId: "7", quoteId: "q1", state: "new" },
      { now: NOW + 7 * MIN },
    );
    expect(revived.result).toBe("confirmed");
    expect(booked(db, "home|2026-11-18|pm")).toBe(2);
  });

  test("ignores orders without a reservation or cart ID", async () => {
    const db = createFakeDb();
    expect(
      await applyOrderEvent(db.client, { quoteId: "nope", state: "new" }),
    ).toEqual({ result: "none" });
    expect(await applyOrderEvent(db.client, {})).toEqual({ result: "none" });
    db.seed(RESERVATIONS, [
      { key: "home|2026-11-18|am", quoteId: "q3", status: "released" },
    ]);
    expect(
      (await applyOrderEvent(db.client, { quoteId: "q3", state: "new" }))
        .result,
    ).toBe("unchanged");
  });
});

describe("housekeeping and Admin", () => {
  test("expires stale holds and pending reservations only", async () => {
    const db = createFakeDb();
    await placeHold(db.client, PROFILES, hold("q1", "2026-11-18", "am"), {
      holdMinutes: 10,
      now: NOW,
    });
    await placeHold(db.client, PROFILES, hold("q2", "2026-11-18", "am"), {
      holdMinutes: 30,
      now: NOW,
    });
    await placeHold(db.client, PROFILES, hold("q3", "2026-11-19", "am"), {
      holdMinutes: 10,
      now: NOW,
    });
    await applyOrderEvent(db.client, {
      orderId: "3",
      quoteId: "q3",
      state: "new",
    });
    expect(await expireStale(db.client, { nowMs: NOW + 20 * MIN })).toBe(1);
    expect(await expireStale(db.client, { nowMs: NOW + 20 * MIN })).toBe(0);
    expect(booked(db, "home|2026-11-18|am")).toBe(1);
    expect(booked(db, "home|2026-11-19|am")).toBe(1);
  });

  test("lists bookings and lets an admin release one", async () => {
    const db = createFakeDb();
    await placeHold(db.client, PROFILES, hold("q1", "2026-11-19", "am"), {
      now: NOW,
    });
    await placeHold(db.client, PROFILES, hold("q2", "2026-11-18", "pm"), {
      now: NOW,
    });
    const all = await listBookings(db.client, {
      from: "2026-11-17",
      profile: "home",
      to: "2026-11-30",
    });
    expect(all.map((b) => b.quoteId)).toEqual(["q2", "q1"]);
    expect(
      await listBookings(db.client, {
        from: "2026-11-17",
        statuses: ["confirmed"],
        to: "2026-11-30",
      }),
    ).toEqual([]);
    expect(await adminRelease(db.client, "q2")).toBe(true);
    expect(await adminRelease(db.client, "q2")).toBe(false);
    expect(booked(db, "home|2026-11-18|pm")).toBe(0);
  });

  test("words comments and messages", () => {
    expect(
      orderComment({
        date: "2026-11-18",
        end: "12:00",
        label: "Morning",
        start: "08:00",
        type: "delivery",
      }),
    ).toMatch(/^Delivery slot: Wed,? 18 Nov 2026, 08:00–12:00 \(Morning\)$/u);
    expect(orderComment({ date: "2026-11-18", type: "pickup" })).toMatch(
      /^Pickup slot: /u,
    );
    expect(shopperMessage("full")).toContain("filled up");
    expect(shopperMessage("whatever")).toBe(shopperMessage("closed"));
  });
});
