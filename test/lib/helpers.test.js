import { createSign, generateKeyPairSync } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import { validateProfile } from "#engine";

import {
  CartNotFoundError,
  isMaskedCartId,
  resolveCart,
} from "../../src/common/slots/cart.js";
import { addOrderComment } from "../../src/common/slots/commerce.js";
import {
  clean,
  isDuplicateKey,
  orNull,
  withDb,
} from "../../src/common/slots/db.js";
import { DEFAULT_PROFILES } from "../../src/common/slots/default-profiles.js";
import {
  orderFromEvent,
  orderFromWebhook,
  quoteIdFromTotals,
  readCustomAttributes,
} from "../../src/common/slots/order.js";
import {
  clearProfilesCache,
  deleteProfile,
  listProfiles,
  loadProfiles,
  profilesFromInput,
  saveProfile,
  ValidationError,
} from "../../src/common/slots/profiles-repo.js";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  parseSettings,
} from "../../src/common/slots/settings.js";
import {
  SIGNATURE_HEADER,
  verifyWebhookSignature,
} from "../../src/common/slots/signature.js";
import { createFakeDb } from "../fixtures/fake-db.js";

const MASKED = "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6";

describe("payload readers", () => {
  test("reads custom attributes in every shape Commerce sends", () => {
    const list = [
      { attribute_code: "delivery_date", value: "2026-11-18" },
      { value: "x" },
    ];
    expect(readCustomAttributes({ custom_attributes: list })).toEqual({
      delivery_date: "2026-11-18",
    });
    expect(
      readCustomAttributes({
        custom_attributes_serializable: '{"delivery_slot":"am"}',
      }),
    ).toEqual({ delivery_slot: "am" });
    expect(
      readCustomAttributes({ custom_attributes_serializable: "{bad" }),
    ).toEqual({});
    expect(
      readCustomAttributes({
        extension_attributes: { custom_attributes: { a: 1 } },
      }),
    ).toEqual({ a: 1 });
    expect(readCustomAttributes({})).toEqual({});
  });

  test("reads the place-order webhook (plugin and observer)", () => {
    const plugin = orderFromWebhook({
      order: {
        custom_attributes: [
          { attribute_code: "delivery_date", value: "2026-11-18" },
          { attribute_code: "delivery_slot", value: "am" },
          { attribute_code: "delivery_profile", value: "home" },
        ],
        quote_id: 12,
        shipping_method: "flatrate_flatrate",
      },
    });
    expect(plugin).toEqual({
      quoteId: "12",
      selection: { date: "2026-11-18", profile: "home", slot: "am" },
      shippingMethod: "flatrate_flatrate",
      storeView: "",
    });
    const observer = orderFromWebhook({
      data: {
        order: {
          custom_attributes_serializable:
            '{"delivery_date":"2026-11-18","delivery_slot":"pm"}',
          extension_attributes: {
            shipping_assignments: [{ shipping: { method: "ups_GND" } }],
          },
          quote_id: "7",
          store_code: "fr",
        },
      },
    });
    expect(observer).toMatchObject({
      quoteId: "7",
      selection: { slot: "pm" },
      shippingMethod: "ups_GND",
      storeView: "fr",
    });
    expect(orderFromWebhook({}).quoteId).toBeUndefined();
    expect(
      orderFromWebhook({
        order: {
          custom_attributes: [{ attribute_code: "delivery_date", value: "x" }],
        },
      }).selection,
    ).toBeNull();
  });

  test("reads the order event and the totals payload", () => {
    expect(
      orderFromEvent({
        data: {
          value: {
            entity_id: 5,
            increment_id: "000000005",
            quote_id: 9,
            state: "Canceled",
          },
        },
      }),
    ).toEqual({
      incrementId: "000000005",
      orderId: "5",
      quoteId: "9",
      state: "canceled",
    });
    expect(orderFromEvent({ id: 1 })).toEqual({
      incrementId: undefined,
      orderId: "1",
      quoteId: undefined,
      state: "",
    });
    expect(quoteIdFromTotals({ quote: { entity_id: 3 } })).toBe("3");
    expect(quoteIdFromTotals({ data: { quote: { entity_id: 4 } } })).toBe("4");
    expect(quoteIdFromTotals({})).toBeUndefined();
  });
});

describe("cart lookup", () => {
  const commerce = (result) => ({ get: () => ({ json: result }) });

  test("resolves an active cart", async () => {
    expect(isMaskedCartId("short")).toBe(false);
    expect(
      await resolveCart(
        commerce(async () => ({ id: 42, store_id: 1 })),
        MASKED,
      ),
    ).toEqual({ quoteId: "42", storeId: 1 });
  });

  test("rejects bad, missing and ordered carts", async () => {
    await expect(
      resolveCart(
        commerce(async () => ({})),
        "bad id",
      ),
    ).rejects.toBeInstanceOf(CartNotFoundError);
    const missing = Object.assign(new Error("nope"), {
      response: { status: 404 },
    });
    await expect(
      resolveCart(
        commerce(async () => {
          throw missing;
        }),
        MASKED,
      ),
    ).rejects.toBeInstanceOf(CartNotFoundError);
    await expect(
      resolveCart(
        commerce(async () => ({ id: 1, is_active: false })),
        MASKED,
      ),
    ).rejects.toBeInstanceOf(CartNotFoundError);
    await expect(
      resolveCart(
        commerce(async () => {
          throw new Error("down");
        }),
        MASKED,
      ),
    ).rejects.toThrow("down");
  });

  test("posts an order comment", async () => {
    const post = vi.fn(() => ({ json: async () => ({}) }));
    await addOrderComment({ post }, "42", "Delivery slot: x");
    expect(post).toHaveBeenCalledWith("orders/42/comments", {
      json: {
        statusHistory: {
          comment: "Delivery slot: x",
          is_customer_notified: 0,
          is_visible_on_front: 0,
        },
      },
    });
  });
});

describe("webhook signatures", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const pem = publicKey.export({ format: "pem", type: "spki" });
  const body = JSON.stringify({ order: { quote_id: 1 } });
  const sign = (text) =>
    createSign("SHA256").update(text).sign(privateKey, "base64");

  test("is skipped without a public key", () => {
    expect(verifyWebhookSignature({})).toEqual({ checked: false });
    expect(verifyWebhookSignature({ WEBHOOK_PUBLIC_KEY: " " })).toEqual({
      checked: false,
    });
  });

  test("accepts a valid signature over a plain or base64 body, and PEM or bare keys", () => {
    const headers = { [SIGNATURE_HEADER]: sign(body) };
    expect(
      verifyWebhookSignature({
        __ow_body: body,
        __ow_headers: headers,
        WEBHOOK_PUBLIC_KEY: pem,
      }),
    ).toEqual({
      body: { order: { quote_id: 1 } },
      checked: true,
      valid: true,
    });
    const bare = pem.replace(/-----[A-Z ]+-----/gu, "").replaceAll("\n", "");
    const encoded = Buffer.from(body).toString("base64");
    expect(
      verifyWebhookSignature({
        __ow_body: encoded,
        __ow_headers: headers,
        WEBHOOK_PUBLIC_KEY: bare,
      }).valid,
    ).toBe(true);
    const escaped = pem.replaceAll("\n", "\\n");
    expect(
      verifyWebhookSignature({
        __ow_body: body,
        __ow_headers: headers,
        WEBHOOK_PUBLIC_KEY: escaped,
      }).valid,
    ).toBe(true);
  });

  test("rejects tampered, unsigned and unreadable requests", () => {
    const headers = { [SIGNATURE_HEADER]: sign(body) };
    expect(
      verifyWebhookSignature({
        __ow_body: `${body} `,
        __ow_headers: headers,
        WEBHOOK_PUBLIC_KEY: pem,
      }).valid,
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        __ow_body: body,
        __ow_headers: {},
        WEBHOOK_PUBLIC_KEY: pem,
      }).valid,
    ).toBe(false);
    expect(
      verifyWebhookSignature({ __ow_headers: headers, WEBHOOK_PUBLIC_KEY: pem })
        .valid,
    ).toBe(false);
    expect(
      verifyWebhookSignature({
        __ow_body: body,
        __ow_headers: headers,
        WEBHOOK_PUBLIC_KEY: "not a key",
      }).valid,
    ).toBe(false);
  });
});

describe("database helpers", () => {
  test("closes the client and maps misses to null", async () => {
    const db = createFakeDb();
    expect(await withDb({}, async () => "done", db.connect)).toBe("done");
    expect(db.calls.closed).toBe(1);
    expect(
      await orNull(
        Promise.reject(Object.assign(new Error("x"), { httpStatusCode: 404 })),
      ),
    ).toBeNull();
    expect(await orNull(Promise.resolve(undefined))).toBeNull();
    await expect(orNull(Promise.reject(new Error("boom")))).rejects.toThrow(
      "boom",
    );
    expect(clean(null)).toBeNull();
    expect(clean({ _id: 1, a: 2 })).toEqual({ a: 2 });
    expect(isDuplicateKey({ code: 11_000 })).toBe(true);
    expect(isDuplicateKey(new Error("other"))).toBe(false);
  });
});

describe("profiles repository", () => {
  const profile = { ...DEFAULT_PROFILES[0], enabled: true };

  test("saves, lists, renames and deletes", async () => {
    const db = createFakeDb();
    clearProfilesCache();
    await saveProfile(profile, {}, { connect: db.connect });
    await expect(
      saveProfile(profile, {}, { connect: db.connect }),
    ).rejects.toBeInstanceOf(ValidationError);
    await saveProfile(
      { ...profile, name: "Renamed" },
      {},
      { connect: db.connect, previousCode: profile.code },
    );
    await saveProfile(
      { ...profile, code: "moved" },
      {},
      { connect: db.connect, previousCode: profile.code },
    );
    expect((await listProfiles({}, db.connect)).map((p) => p.code)).toEqual([
      "moved",
    ]);
    expect(await deleteProfile("moved", {}, db.connect)).toBe(true);
    expect(await deleteProfile("moved", {}, db.connect)).toBe(false);
  });

  test("refuses invalid profiles", async () => {
    await expect(saveProfile({ code: "x" }, {})).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("caches stored profiles and prefers SLOT_PROFILES", async () => {
    const db = createFakeDb();
    db.seed("slot_profiles", [profile]);
    clearProfilesCache();
    expect(await loadProfiles({}, db.connect, 0)).toHaveLength(1);
    db.seed("slot_profiles", [{ ...profile, code: "two" }]);
    expect(await loadProfiles({}, db.connect, 1000)).toHaveLength(1);
    expect(await loadProfiles({}, db.connect, 60_000)).toHaveLength(2);
    expect(
      await loadProfiles(
        { SLOT_PROFILES: JSON.stringify([profile]) },
        db.connect,
      ),
    ).toHaveLength(1);
  });

  test("parses SLOT_PROFILES", () => {
    expect(profilesFromInput({})).toBeNull();
    expect(profilesFromInput({ SLOT_PROFILES: "  " })).toBeNull();
    expect(
      profilesFromInput({ SLOT_PROFILES: { profiles: [profile] } }),
    ).toHaveLength(1);
    expect(() => profilesFromInput({ SLOT_PROFILES: "{" })).toThrow(
      "not valid JSON",
    );
    expect(() => profilesFromInput({ SLOT_PROFILES: "{}" })).toThrow(
      "must be an array",
    );
  });

  test("ships valid, switched-off examples", () => {
    for (const example of DEFAULT_PROFILES) {
      expect(validateProfile(example)).toEqual([]);
      expect(example.enabled).toBe(false);
    }
  });
});

describe("settings", () => {
  test("parses and clamps values", () => {
    expect(parseSettings()).toEqual(DEFAULT_SETTINGS);
    expect(
      parseSettings([
        { name: "slotsEnabled", value: "false" },
        { name: "holdMinutes", value: "1" },
        { name: "cacheSeconds", value: "99999" },
        { name: "showRemaining", value: true },
        { name: "failOpen", value: "no" },
        { name: "orderComment", value: 0 },
        { name: "ignored", value: null },
      ]),
    ).toEqual({
      cacheSeconds: 3600,
      failOpen: false,
      holdMinutes: 5,
      orderComment: true,
      showRemaining: true,
      slotsEnabled: false,
    });
    expect(
      parseSettings([{ name: "holdMinutes", value: "abc" }]).holdMinutes,
    ).toBe(20);
  });

  test("falls back to defaults outside App Builder", async () => {
    expect(await loadSettings({ warn: vi.fn() })).toEqual(DEFAULT_SETTINGS);
  });
});
