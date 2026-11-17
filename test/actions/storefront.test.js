import { describe, expect, test, vi } from "vitest";

import { createAvailabilityFeed } from "../../src/commerce-extensibility-1/actions/availability/handler.js";
import { main as availabilityMain } from "../../src/commerce-extensibility-1/actions/availability/index.js";
import { createHold } from "../../src/commerce-extensibility-1/actions/hold/handler.js";
import { main as holdMain } from "../../src/commerce-extensibility-1/actions/hold/index.js";
import { CartNotFoundError } from "../../src/common/slots/cart.js";
import { DEFAULT_SETTINGS } from "../../src/common/slots/settings.js";
import { createFakeDb } from "../fixtures/fake-db.js";

const NOW = Date.parse("2026-11-17T07:30:00Z");
const profile = {
  code: "home",
  enabled: true,
  maxDaysAhead: 3,
  name: "Home delivery",
  shippingMethods: ["flatrate_flatrate"],
  slots: [{ capacity: 1, code: "am", end: "12:00", start: "08:00" }],
  timezone: "Europe/London",
};
const settings =
  (extra = {}) =>
  async () => ({ ...DEFAULT_SETTINGS, ...extra });
const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

describe("availability feed", () => {
  const feed = (extra = {}, overrides = {}) =>
    createAvailabilityFeed({
      loadProfiles: async () => [profile],
      loadSettings: settings(extra),
      now: () => NOW,
      usage: async () => ({ "home|2026-11-18|am": 1 }),
      ...overrides,
    });

  test("returns the matching profile's dates, without counts, and is cacheable", async () => {
    const response = await feed()(
      { method: "flatrate_flatrate", store: "default" },
      logger,
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers["Cache-Control"]).toBe("public, max-age=30");
    expect(response.body.profile.code).toBe("home");
    expect(response.body.dates).toHaveLength(4);
    const wednesday = response.body.dates[1];
    expect(wednesday).toMatchObject({
      available: false,
      date: "2026-11-18",
      reason: "full",
    });
    expect(wednesday.slots[0]).not.toHaveProperty("booked");
  });

  test("shows remaining places when the setting is on, and pages", async () => {
    const response = await feed({ showRemaining: true })(
      { days: "1", from: "2026-11-19", method: "flatrate_flatrate" },
      logger,
    );
    expect(response.body.dates.map((d) => d.date)).toEqual(["2026-11-19"]);
    expect(response.body.dates[0].slots[0].remaining).toBe(1);
  });

  test("answers no profile for other methods, bad input and when switched off", async () => {
    expect((await feed()({ method: "ups_GND" }, logger)).body).toEqual({
      enabled: true,
      profile: null,
    });
    expect(
      (await feed()({ method: "<script>" }, logger)).body.profile,
    ).toBeNull();
    expect(
      (
        await feed({ slotsEnabled: false })(
          { method: "flatrate_flatrate" },
          logger,
        )
      ).body,
    ).toEqual({
      enabled: false,
      profile: null,
    });
  });

  test("hides errors from shoppers", async () => {
    const response = await availabilityMain({ SLOT_PROFILES: "{" });
    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain("JSON");
  });
});

describe("hold", () => {
  const MASKED = "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6";
  const make = (db, overrides = {}) =>
    createHold({
      db: (_params, fn) => fn(db.client),
      getCommerce: async () => ({}),
      loadProfiles: async () => [profile],
      loadSettings: settings(),
      now: () => NOW,
      resolveCart: async (_commerce, id) => {
        if (id !== MASKED) {
          throw new CartNotFoundError();
        }
        return { quoteId: "42" };
      },
      ...overrides,
    });
  const body = {
    cartId: MASKED,
    date: "2026-11-18",
    shippingMethod: "flatrate_flatrate",
    slot: "am",
    store: "default",
  };

  test("holds a slot for a cart and returns only public fields", async () => {
    const db = createFakeDb();
    const response = await make(db)(body, { __ow_method: "post" }, logger);
    expect(response.statusCode).toBe(200);
    expect(response.body.hold).toEqual({
      date: "2026-11-18",
      end: "12:00",
      expiresAt: new Date(NOW + 20 * 60_000).toISOString(),
      fee: 0,
      label: "08:00–12:00",
      profile: "home",
      slot: "am",
      start: "08:00",
    });
  });

  test("answers 409 with a reason when the slot is full", async () => {
    const db = createFakeDb();
    await make(db)(body, {}, logger);
    const other = make(db, { resolveCart: async () => ({ quoteId: "43" }) });
    const response = await other(body, {}, logger);
    expect(response.statusCode).toBe(409);
    expect(response.body.reason).toBe("full");
  });

  test("releases a hold", async () => {
    const db = createFakeDb();
    await make(db)(body, {}, logger);
    expect(
      (await make(db)({ cartId: MASKED, release: true }, {}, logger)).body,
    ).toEqual({ released: true });
  });

  test("refuses unknown carts, GET and a disabled app", async () => {
    const db = createFakeDb();
    expect(
      (await make(db)({ ...body, cartId: "x".repeat(20) }, {}, logger))
        .statusCode,
    ).toBe(404);
    expect(
      (await make(db)(body, { __ow_method: "get" }, logger)).statusCode,
    ).toBe(405);
    expect(
      (
        await make(db, { loadSettings: settings({ slotsEnabled: false }) })(
          body,
          {},
          logger,
        )
      ).statusCode,
    ).toBe(409);
  });

  test("rethrows unexpected errors, which the action turns into a generic 500", async () => {
    const db = createFakeDb();
    await expect(
      make(db, {
        resolveCart: async () => {
          throw new Error("down");
        },
      })(body, {}, logger),
    ).rejects.toThrow("down");
    await expect(
      make(db, {
        db: async () => {
          throw new Error("db");
        },
      })(body, {}, logger),
    ).rejects.toThrow("db");
    const response = await holdMain({
      __ow_method: "post",
      body: JSON.stringify({ cartId: "bad" }),
    });
    expect(response.statusCode).toBe(500);
    expect(response.body.error).toBe(
      "Delivery slots are unavailable right now.",
    );
  });
});
