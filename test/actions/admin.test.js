import { describe, expect, test, vi } from "vitest";

import { createHandlers } from "../../src/commerce-backend-ui-2/actions/handlers.js";
import { adminAction } from "../../src/commerce-backend-ui-2/actions/http.js";
import { ValidationError } from "../../src/common/slots/profiles-repo.js";
import { placeHold } from "../../src/common/slots/reservations.js";
import { createFakeDb } from "../fixtures/fake-db.js";

const NOW = Date.parse("2026-11-17T07:30:00Z");
const logger = { error: vi.fn(), warn: vi.fn() };
const profile = {
  code: "home",
  enabled: true,
  name: "Home delivery",
  slots: [{ capacity: 2, code: "am", end: "12:00", start: "08:00" }],
  timezone: "Europe/London",
};

describe("admin handlers", () => {
  test("profilesList returns profiles and switched-off examples", async () => {
    const handlers = createHandlers({ listProfiles: async () => [profile] });
    const response = await handlers.profilesList({}, {});
    expect(response.body.profiles).toEqual([profile]);
    expect(response.body.examples.every((e) => e.enabled === false)).toBe(true);
  });

  test("profileSave validates input and passes the previous code", async () => {
    const saveProfile = vi.fn(async (p) => p);
    const handlers = createHandlers({ saveProfile });
    await expect(handlers.profileSave({}, {})).rejects.toBeInstanceOf(
      ValidationError,
    );
    const response = await handlers.profileSave(
      { previousCode: "old", profile: { code: "new" } },
      {},
    );
    expect(response.body.profile).toEqual({ code: "new" });
    expect(saveProfile).toHaveBeenCalledWith(
      { code: "new" },
      {},
      { previousCode: "old" },
    );
  });

  test("profileDelete answers 404 for a missing profile", async () => {
    const handlers = createHandlers({
      deleteProfile: async (code) => code === "a",
    });
    expect((await handlers.profileDelete({ code: "a" }, {})).statusCode).toBe(
      200,
    );
    expect((await handlers.profileDelete({ code: "b" }, {})).statusCode).toBe(
      404,
    );
    await expect(handlers.profileDelete({}, {})).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("bookings returns reservations and a capacity calendar", async () => {
    const db = createFakeDb();
    await placeHold(
      db.client,
      [profile],
      { date: "2026-11-18", quoteId: "q1", slot: "am" },
      { now: NOW },
    );
    const handlers = createHandlers({
      db: (_p, fn) => fn(db.client),
      listProfiles: async () => [profile],
      now: () => NOW,
    });
    const response = await handlers.bookings(
      {
        from: "2026-11-16",
        profile: "home",
        statuses: ["hold", "bogus"],
        to: "2026-11-20",
      },
      {},
    );
    expect(response.body.bookings.map((b) => b.quoteId)).toEqual(["q1"]);
    expect(response.body.calendar.map((d) => d.date)).toEqual([
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
    ]);
    expect(response.body.calendar[1].slots[0]).toMatchObject({
      booked: 1,
      capacity: 2,
      remaining: 1,
    });
    const defaults = await handlers.bookings({ profile: "home" }, {});
    expect(defaults.body).toMatchObject({
      from: "2026-11-17",
      to: "2026-11-30",
    });
    expect((await handlers.bookings({ profile: "nope" }, {})).statusCode).toBe(
      404,
    );
    await expect(
      handlers.bookings(
        { from: "2026-11-20", profile: "home", to: "2026-11-01" },
        {},
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      handlers.bookings(
        { from: "2026-01-01", profile: "home", to: "2026-12-31" },
        {},
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(handlers.bookings({}, {})).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("bookingRelease releases once", async () => {
    const db = createFakeDb();
    await placeHold(
      db.client,
      [profile],
      { date: "2026-11-18", quoteId: "q1", slot: "am" },
      { now: NOW },
    );
    const handlers = createHandlers({
      db: (_p, fn) => fn(db.client),
      now: () => NOW,
    });
    expect(
      (await handlers.bookingRelease({ quoteId: "q1" }, {})).statusCode,
    ).toBe(200);
    expect(
      (await handlers.bookingRelease({ quoteId: "q1" }, {})).statusCode,
    ).toBe(404);
  });

  test("lookups lists store views, and degrades when Commerce is unreachable", async () => {
    const ok = createHandlers({
      getCommerce: async () => ({
        get: () => ({
          json: async () => [
            { code: "admin", id: 0, name: "Admin" },
            { code: "default", id: 1, name: "Default" },
          ],
        }),
      }),
    });
    expect((await ok.lookups({}, {}, logger)).body).toEqual({
      storeViews: [{ code: "default", id: 1, label: "Default" }],
    });
    const down = createHandlers({
      getCommerce: async () => {
        throw new Error("no");
      },
    });
    expect((await down.lookups({}, {}, logger)).body).toEqual({
      storeViews: [],
      unavailable: true,
    });
  });
});

describe("adminAction", () => {
  test("maps validation errors to 400 and others to a generic 500", async () => {
    const invalid = adminAction("x", async () => {
      throw new ValidationError(["bad"]);
    });
    const broken = adminAction("x", async () => {
      throw new Error("secret detail");
    });
    const ok = adminAction("x", async (body) => ({ body, statusCode: 200 }));
    expect((await invalid({})).statusCode).toBe(400);
    const failed = await broken({});
    expect(failed.statusCode).toBe(500);
    expect(JSON.stringify(failed.body)).not.toContain("secret");
    expect((await ok({ body: '{"a":1}' })).body).toEqual({ a: 1 });
  });
});
