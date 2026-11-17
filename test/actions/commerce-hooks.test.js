import { describe, expect, test, vi } from "vitest";

import {
  main as cleanupMain,
  createCleanup,
} from "../../src/commerce-extensibility-1/actions/cleanup/index.js";
import { createOrderEvents } from "../../src/commerce-extensibility-1/actions/order-events/handler.js";
import { main as orderEventsMain } from "../../src/commerce-extensibility-1/actions/order-events/index.js";
import { createSlotFee } from "../../src/commerce-extensibility-1/actions/slot-fee/handler.js";
import { main as slotFeeMain } from "../../src/commerce-extensibility-1/actions/slot-fee/index.js";
import {
  createValidateOrder,
  UNAVAILABLE_MESSAGE,
} from "../../src/commerce-extensibility-1/actions/validate-order/handler.js";
import { main as validateMain } from "../../src/commerce-extensibility-1/actions/validate-order/index.js";
import { RESERVATIONS } from "../../src/common/slots/db.js";
import { placeHold } from "../../src/common/slots/reservations.js";
import { DEFAULT_SETTINGS } from "../../src/common/slots/settings.js";
import { createFakeDb } from "../fixtures/fake-db.js";

const NOW = Date.parse("2026-11-17T07:30:00Z");
const profile = {
  code: "home",
  enabled: true,
  name: "Home delivery",
  shippingMethods: ["flatrate_flatrate"],
  slots: [
    {
      capacity: 1,
      code: "am",
      end: "12:00",
      fee: 3.5,
      label: "Morning",
      start: "08:00",
    },
  ],
  timezone: "Europe/London",
};
const settings =
  (extra = {}) =>
  async () => ({ ...DEFAULT_SETTINGS, ...extra });
const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
const withClient = (db) => (_params, fn) => fn(db.client);

const orderPayload = (extra = {}) => ({
  order: { quote_id: "42", shipping_method: "flatrate_flatrate", ...extra },
});

describe("validate-order webhook", () => {
  const make = (db, overrides = {}) =>
    createValidateOrder({
      db: withClient(db),
      loadProfiles: async () => [profile],
      loadSettings: settings(),
      now: () => NOW,
      ...overrides,
    });

  test("accepts a held slot", async () => {
    const db = createFakeDb();
    await placeHold(
      db.client,
      [profile],
      {
        date: "2026-11-18",
        quoteId: "42",
        shippingMethod: "flatrate_flatrate",
        slot: "am",
      },
      { now: NOW },
    );
    expect(await make(db)(orderPayload(), logger)).toEqual({ op: "success" });
    expect(db.docs(RESERVATIONS)[0].status).toBe("pending");
  });

  test("blocks a missing or full slot with the shopper message", async () => {
    const db = createFakeDb();
    const missing = await make(db)(orderPayload(), logger);
    expect(missing).toMatchObject({
      message: "Please choose a delivery date and time slot.",
      op: "exception",
    });
    await placeHold(
      db.client,
      [profile],
      {
        date: "2026-11-18",
        quoteId: "41",
        shippingMethod: "flatrate_flatrate",
        slot: "am",
      },
      { now: NOW },
    );
    const full = await make(db)(
      orderPayload({
        custom_attributes: [
          { attribute_code: "delivery_date", value: "2026-11-18" },
          { attribute_code: "delivery_slot", value: "am" },
        ],
      }),
      logger,
    );
    expect(full.op).toBe("exception");
    expect(full.message).toContain("filled up");
  });

  test("fails open on unexpected errors unless told not to", async () => {
    const db = createFakeDb();
    const broken = {
      db: async () => {
        throw new Error("db down");
      },
    };
    expect(await make(db, broken)(orderPayload(), logger)).toEqual({
      op: "success",
    });
    expect(
      await make(db, {
        ...broken,
        loadSettings: settings({ failOpen: false }),
      })(orderPayload(), logger),
    ).toEqual({
      message: UNAVAILABLE_MESSAGE,
      op: "exception",
    });
  });

  test("does nothing when switched off, and rejects a bad signature", async () => {
    const db = createFakeDb();
    expect(
      await make(db, { loadSettings: settings({ slotsEnabled: false }) })(
        orderPayload(),
        logger,
      ),
    ).toEqual({ op: "success" });
    const signed = await make(db)(
      {
        ...orderPayload(),
        __ow_body: "{}",
        __ow_headers: {},
        WEBHOOK_PUBLIC_KEY: "key",
      },
      logger,
    );
    expect(signed.op).toBe("exception");
  });

  test("reads a raw-http body, plain or base64, without a signing key", async () => {
    const db = createFakeDb();
    const body = JSON.stringify(orderPayload());
    const results = await Promise.all(
      [body, Buffer.from(body).toString("base64")].map((raw) =>
        make(db)(
          { __ow_body: raw, __ow_headers: {}, __ow_method: "post" },
          logger,
        ),
      ),
    );
    // No slot on the order and the profile requires one: the order body was read.
    for (const result of results) {
      expect(result).toEqual({
        message: "Please choose a delivery date and time slot.",
        op: "exception",
      });
    }
  });

  test("the action always answers 200 with an operation", async () => {
    const response = await validateMain({
      ...orderPayload(),
      SLOT_PROFILES: "{",
    });
    expect(response.statusCode).toBe(200);
    expect(response.body.op).toBe("success");
  });
});

describe("slot-fee webhook", () => {
  const make = (reservation, extra = {}) =>
    createSlotFee({
      findReservation: async () => reservation,
      loadSettings: settings(extra),
    });

  test("adds the held slot's fee", async () => {
    const fees = await make({ fee: 3.456, label: "Morning", status: "hold" })(
      { quote: { entity_id: 42 } },
      logger,
    );
    expect(fees).toEqual([
      {
        base_fee: 3.46,
        code: "delivery_slot",
        label: "Delivery slot: Morning",
      },
    ]);
    const pickup = await make({
      fee: 1,
      label: "AM",
      status: "pending",
      type: "pickup",
    })({ quote: { entity_id: 1 } }, logger);
    expect(pickup[0].label).toBe("Pickup slot: AM");
  });

  test("charges nothing without a counted, paid slot", async () => {
    expect(await make(null)({ quote: { entity_id: 42 } }, logger)).toEqual([]);
    expect(
      await make({ fee: 2, status: "expired" })(
        { quote: { entity_id: 42 } },
        logger,
      ),
    ).toEqual([]);
    expect(
      await make({ fee: 0, status: "hold" })(
        { quote: { entity_id: 42 } },
        logger,
      ),
    ).toEqual([]);
    expect(
      await make({ fee: 2, status: "hold" }, { slotsEnabled: false })(
        { quote: { entity_id: 42 } },
        logger,
      ),
    ).toEqual([]);
    expect(await make({ fee: 2, status: "hold" })({}, logger)).toEqual([]);
  });

  test("the action never blocks a cart", async () => {
    const response = await slotFeeMain({ quote: { entity_id: 42 } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual([{ op: "success" }]);
  });
});

describe("order-events", () => {
  const event = (state) => ({
    data: {
      value: { entity_id: 7, increment_id: "000000007", quote_id: "42", state },
    },
  });

  test("confirms with an order comment, then releases on cancel", async () => {
    const db = createFakeDb();
    await placeHold(
      db.client,
      [profile],
      {
        date: "2026-11-18",
        quoteId: "42",
        shippingMethod: "flatrate_flatrate",
        slot: "am",
      },
      { now: NOW },
    );
    const addOrderComment = vi.fn(async () => undefined);
    const handle = createOrderEvents({
      addOrderComment,
      db: withClient(db),
      getCommerce: async () => ({}),
      loadSettings: settings(),
      now: () => NOW,
    });
    expect(await handle(event("new"), logger)).toEqual({ result: "confirmed" });
    expect(addOrderComment).toHaveBeenCalledWith(
      {},
      "7",
      expect.stringMatching(
        /^Delivery slot: .*18 Nov 2026, 08:00–12:00 \(Morning\)$/u,
      ),
    );
    expect(await handle(event("new"), logger)).toEqual({ result: "unchanged" });
    expect(await handle(event("canceled"), logger)).toEqual({
      result: "cancelled",
    });
    expect(addOrderComment).toHaveBeenCalledTimes(1);
  });

  test("keeps the booking when the comment fails, and skips it when switched off", async () => {
    const db = createFakeDb();
    await placeHold(
      db.client,
      [profile],
      {
        date: "2026-11-18",
        quoteId: "42",
        shippingMethod: "flatrate_flatrate",
        slot: "am",
      },
      { now: NOW },
    );
    const failing = createOrderEvents({
      addOrderComment: async () => {
        throw new Error("REST down");
      },
      db: withClient(db),
      getCommerce: async () => ({}),
      loadSettings: settings(),
    });
    expect(await failing(event("new"), logger)).toEqual({
      result: "confirmed",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("REST down"),
    );
    const quiet = vi.fn();
    const off = createOrderEvents({
      addOrderComment: quiet,
      db: withClient(db),
      loadSettings: settings({ orderComment: false }),
    });
    expect(await off(event("canceled"), logger)).toEqual({
      result: "cancelled",
    });
    expect(quiet).not.toHaveBeenCalled();
  });

  test("ignores events without a cart ID, and the action rethrows for redelivery", async () => {
    expect(await createOrderEvents()({ data: { value: {} } }, logger)).toEqual({
      result: "none",
      status: "no-quote-id",
    });
    await expect(orderEventsMain(event("new"))).rejects.toThrow();
  });
});

describe("cleanup", () => {
  test("expires stale reservations", async () => {
    const db = createFakeDb();
    await placeHold(
      db.client,
      [profile],
      {
        date: "2026-11-18",
        quoteId: "42",
        shippingMethod: "flatrate_flatrate",
        slot: "am",
      },
      { holdMinutes: 5, now: NOW },
    );
    expect(
      await createCleanup({ db: withClient(db), now: () => NOW + 10 * 60_000 })(
        {},
      ),
    ).toBe(1);
    await expect(cleanupMain({})).rejects.toThrow();
  });
});
