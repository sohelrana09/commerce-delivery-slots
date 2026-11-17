// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  methodFromCart,
  mountDeliverySlots,
  SET_ATTRIBUTES_MUTATION,
  selectionAttributes,
  shippingMethodCode,
} from "../../storefront/scripts/delivery-slots.js";
import {
  availability,
  publicAvailability,
} from "../../storefront/scripts/delivery-slots-engine.js";

const NOW = Date.parse("2026-11-17T07:30:00Z");
const profile = {
  code: "home",
  maxDaysAhead: 20,
  name: "Home delivery",
  sameDayCutoff: "10:00",
  slots: [
    { capacity: 2, code: "am", end: "12:00", label: "Morning", start: "08:00" },
    { capacity: 1, code: "pm", end: "17:00", fee: 4.5, start: "12:00" },
  ],
  timezone: "Asia/Tokyo",
};

function feed(overrides = {}, booked = {}) {
  return {
    enabled: true,
    ...publicAvailability(
      availability({ ...profile, ...overrides }, { booked, now: NOW }),
      { showRemaining: true },
    ),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function jsonResponse(body, status = 200) {
  return { json: async () => body, ok: status < 400, status };
}

function setup({ data = feed(), hold, ...options } = {}) {
  const calls = [];
  const fetch = vi.fn(async (url, init = {}) => {
    calls.push({
      body: init.body ? JSON.parse(init.body) : null,
      url: String(url),
    });
    if (String(url).includes("/hold")) {
      return hold
        ? hold(JSON.parse(init.body))
        : jsonResponse({
            hold: {
              expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
            },
          });
    }
    return typeof data === "function" ? data() : jsonResponse(data);
  });
  const container = document.createElement("div");
  document.body.append(container);
  const onChange = vi.fn();
  const picker = mountDeliverySlots(container, {
    availabilityEndpoint: "https://example.test/availability",
    fetch,
    holdEndpoint: "https://example.test/hold",
    locale: "en-GB",
    onChange,
    storeView: "default",
    ...options,
  });
  return { calls, container, fetch, onChange, picker };
}

const cart = (
  method = { carrier: { code: "flatrate" }, code: "flatrate" },
) => ({
  id: "masked-cart-id-0000000000",
  shippingAddresses: [{ selectedShippingMethod: method }],
});

function choose(input) {
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("helpers", () => {
  test("reads shipping method codes from every drop-in shape", () => {
    expect(shippingMethodCode("flatrate_flatrate")).toBe("flatrate_flatrate");
    expect(shippingMethodCode("bad method")).toBe("");
    expect(shippingMethodCode({ carrier: { code: "ups" }, code: "GND" })).toBe(
      "ups_GND",
    );
    expect(shippingMethodCode({ carrierCode: "a", methodCode: "b" })).toBe(
      "a_b",
    );
    expect(shippingMethodCode({ carrier_code: "a", method_code: "b" })).toBe(
      "a_b",
    );
    expect(shippingMethodCode({ code: "only" })).toBe("");
    expect(shippingMethodCode(null)).toBe("");
    expect(
      methodFromCart({
        shipping_addresses: [
          { selected_shipping_method: { carrier_code: "x", method_code: "y" } },
        ],
      }),
    ).toBe("x_y");
    expect(methodFromCart({})).toBe("");
  });

  test("builds cart custom attributes", () => {
    expect(selectionAttributes(null)).toEqual([]);
    expect(
      selectionAttributes({ date: "2026-11-18", profile: "home", slot: "am" }),
    ).toEqual([
      { attribute_code: "delivery_date", value: "2026-11-18" },
      { attribute_code: "delivery_slot", value: "am" },
      { attribute_code: "delivery_profile", value: "home" },
    ]);
  });
});

describe("picker", () => {
  test("stays hidden until a shipping method has a profile", async () => {
    const { container, picker, calls } = setup({
      data: { enabled: true, profile: null },
    });
    const section = container.querySelector(".delivery-slots");
    expect(section.hidden).toBe(true);
    await picker.update(cart());
    expect(calls[0].url).toBe(
      "https://example.test/availability?method=flatrate_flatrate&store=default",
    );
    expect(section.hidden).toBe(true);
    expect(picker.validate()).toBe(true);
    await picker.update({ shippingMethod: "" });
    expect(section.hidden).toBe(true);
  });

  test("renders labelled radio groups with reasons for closed dates and times", async () => {
    const { container, picker } = setup({
      data: feed({}, { "home|2026-11-18|pm": 1 }),
    });
    await picker.update(cart());
    const section = container.querySelector(".delivery-slots");
    expect(section.hidden).toBe(false);
    expect(section.getAttribute("aria-labelledby")).toBe(
      section.querySelector("h3").id,
    );
    expect(section.querySelector("h3").textContent).toBe(
      "Delivery date and time",
    );
    expect(
      section.querySelector(".delivery-slots__hint").textContent,
    ).toContain("Asia/Tokyo");

    const dates = [...section.querySelectorAll(".delivery-slots__dates input")];
    // Up to 14 dates from the first open one, plus the closed day before it.
    expect(dates).toHaveLength(15);
    // Tokyo is already past 10:00 on the 17th, so today is closed by the cut-off.
    expect(dates[0].disabled).toBe(true);
    expect(dates[0].getAttribute("aria-label")).toMatch(
      /Tuesday.*17 November.*Cut-off passed/u,
    );
    expect(dates.find((d) => d.checked).value).toBe("2026-11-18");
    expect(section.querySelector(".delivery-slots__more")).not.toBeNull();

    const legend = section.querySelector(
      ".delivery-slots__slots legend",
    ).textContent;
    expect(legend).toMatch(/Wednesday.*18 November/u);
    const slots = [...section.querySelectorAll(".delivery-slots__slots label")];
    expect(slots.map((s) => s.textContent)).toEqual([
      "08:00–12:00Morning2 left",
      "12:00–17:00Full · +4.50",
    ]);
    expect(slots[1].querySelector("input").disabled).toBe(true);
  });

  test("holds a chosen time and tells the shopper", async () => {
    const { container, picker, calls, onChange } = setup();
    await picker.update(cart());
    choose(container.querySelector(".delivery-slots__slots input"));
    await flush();
    const holdCall = calls.find((c) => c.url.includes("/hold"));
    expect(holdCall.body).toEqual({
      cartId: "masked-cart-id-0000000000",
      date: "2026-11-18",
      shippingMethod: "flatrate_flatrate",
      slot: "am",
      store: "default",
    });
    expect(picker.getSelection()).toEqual({
      date: "2026-11-18",
      held: true,
      profile: "home",
      slot: "am",
    });
    expect(container.querySelector("[role=status]").textContent).toMatch(
      /18 Nov 2026, 08:00–12:00 \(Morning\) is held for you for 20 minutes\./u,
    );
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(picker.validate()).toBe(true);
  });

  test("keeps the shopper's own held slot chosen when it fills up", async () => {
    let round = 0;
    const { container, picker } = setup({
      data: () => {
        round += 1;
        return jsonResponse(
          feed({}, round > 1 ? { "home|2026-11-18|am": 2 } : {}),
        );
      },
    });
    await picker.update(cart());
    choose(container.querySelector(".delivery-slots__slots input"));
    await flush();
    await picker.refresh();
    const mine = container.querySelector(".delivery-slots__slots input");
    expect(mine.checked).toBe(true);
    expect(mine.disabled).toBe(false);
    expect(mine.closest("label").textContent).toContain("Held for you");
  });

  test("shows another date's times and keeps the keyboard flow", async () => {
    const { container, picker } = setup();
    await picker.update(cart());
    const thursday = container.querySelector(
      '.delivery-slots__dates input[value="2026-11-19"]',
    );
    choose(thursday);
    expect(
      container.querySelector(".delivery-slots__slots legend").textContent,
    ).toMatch(/Thursday/u);
    expect(
      [...container.querySelectorAll('input[name$="-date"]')].every(
        (i) => i.name === thursday.name,
      ),
    ).toBe(true);
  });

  test("reloads when a time was taken meanwhile", async () => {
    let round = 0;
    const { container, picker, onChange } = setup({
      data: () => {
        round += 1;
        return jsonResponse(
          feed({}, round > 1 ? { "home|2026-11-18|am": 2 } : {}),
        );
      },
      hold: () =>
        jsonResponse(
          { error: "That time slot has just filled up.", reason: "full" },
          409,
        ),
    });
    await picker.update(cart());
    choose(container.querySelector(".delivery-slots__slots input"));
    await flush();
    await flush();
    expect(container.querySelector("[role=alert]").textContent).toBe(
      "That time slot has just filled up.",
    );
    expect(container.querySelector("[role=alert]").hidden).toBe(false);
    expect(picker.getSelection()).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(
      container.querySelector(".delivery-slots__slots input").disabled,
    ).toBe(true);
    expect(
      container
        .querySelector(".delivery-slots__dates")
        .getAttribute("aria-describedby"),
    ).toContain("-error");
  });

  test("keeps the choice when the hold can't be reached", async () => {
    const { container, picker } = setup({
      hold: () => {
        throw new Error("offline");
      },
    });
    await picker.update(cart());
    choose(container.querySelector(".delivery-slots__slots input"));
    await flush();
    expect(picker.getSelection()).toMatchObject({ held: false, slot: "am" });
    expect(container.querySelector("[role=status]").textContent).toMatch(
      /when you place your order/u,
    );
    const noHold = setup({ hold: () => jsonResponse({}, 500) });
    await noHold.picker.update(cart());
    choose(noHold.container.querySelector(".delivery-slots__slots input"));
    await flush();
    expect(noHold.picker.getSelection().held).toBe(false);
  });

  test("works without a hold endpoint or cart ID", async () => {
    const { container, picker, calls } = setup({ holdEndpoint: "" });
    await picker.update({ shippingMethod: "flatrate_flatrate" });
    choose(container.querySelector(".delivery-slots__slots input"));
    await flush();
    expect(calls.some((c) => c.url.includes("/hold"))).toBe(false);
    expect(picker.getSelection().held).toBe(false);
  });

  test("blocks Place Order until a required time is chosen, and focuses the picker", async () => {
    const { container, picker } = setup();
    await picker.update(cart());
    expect(picker.validate()).toBe(false);
    const alert = container.querySelector("[role=alert]");
    expect(alert.textContent).toBe("Please choose a date and time.");
    expect(document.activeElement).toBe(
      container.querySelector(".delivery-slots__slots input"),
    );
    const optional = setup({
      data: { ...feed(), profile: { ...feed().profile, required: false } },
    });
    await optional.picker.update(cart());
    expect(optional.picker.validate()).toBe(true);
  });

  test("releases the hold when the shipping method changes", async () => {
    const { container, picker, calls } = setup();
    await picker.update(cart());
    choose(container.querySelector(".delivery-slots__slots input"));
    await flush();
    await picker.update(cart());
    expect(calls.filter((c) => c.url.includes("availability"))).toHaveLength(1);
    await picker.update(cart({ carrier: { code: "ups" }, code: "GND" }));
    expect(calls.find((c) => c.body?.release)).toMatchObject({
      body: { cartId: "masked-cart-id-0000000000", release: true },
    });
    expect(picker.getSelection()).toBeNull();
  });

  test("offers a retry when availability fails", async () => {
    let fail = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { container, picker } = setup({
      data: () => (fail ? jsonResponse({}, 503) : jsonResponse(feed())),
    });
    await picker.update(cart());
    const retry = container.querySelector(".delivery-slots__retry");
    expect(retry.textContent).toBe("Try again");
    fail = false;
    retry.click();
    await flush();
    expect(
      container.querySelectorAll(".delivery-slots__dates input").length,
    ).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("says so when nothing is bookable, and uses pickup wording", async () => {
    const closed = feed({
      slots: [{ capacity: 0, code: "x", end: "10:00", start: "09:00" }],
      type: "pickup",
    });
    const { container, picker } = setup({
      data: closed,
      text: { noDates: "Nothing left" },
    });
    await picker.update(cart());
    expect(container.querySelector("h3").textContent).toBe(
      "Pickup date and time",
    );
    expect(container.querySelector(".delivery-slots__empty").textContent).toBe(
      "Nothing left",
    );
  });

  test("shows later dates on request and moves focus to them", async () => {
    const { container, picker } = setup({ maxDates: 3 });
    await picker.update(cart());
    expect(
      container.querySelectorAll(".delivery-slots__dates input"),
    ).toHaveLength(4);
    container.querySelector(".delivery-slots__more").click();
    expect(
      container.querySelectorAll(".delivery-slots__dates input").length,
    ).toBe(feed().dates.length);
    // The 21st and 22nd are the weekend, so focus lands on Monday.
    expect(document.activeElement.value).toBe("2026-11-23");
  });

  test("saves the choice as cart custom attributes", async () => {
    const graphql = vi.fn(async () => ({ data: {} }));
    const { container, picker } = setup({ graphql });
    await picker.update(cart());
    choose(container.querySelector(".delivery-slots__slots input"));
    await flush();
    expect(await picker.saveToCart()).toBe(true);
    expect(graphql).toHaveBeenCalledWith(SET_ATTRIBUTES_MUTATION, {
      variables: {
        attributes: selectionAttributes({
          date: "2026-11-18",
          profile: "home",
          slot: "am",
        }),
        cartId: "masked-cart-id-0000000000",
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    graphql.mockResolvedValueOnce({
      errors: [{ message: "Unknown mutation" }],
    });
    expect(await picker.saveToCart()).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Unknown mutation"),
    );
    warn.mockRestore();
    expect(await setup().picker.saveToCart("x")).toBe(false);
  });

  test("follows the checkout drop-in events and cleans up", async () => {
    const handlers = {};
    const off = vi.fn();
    const events = {
      on: vi.fn((name, fn) => {
        handlers[name] = fn;
        return { off };
      }),
    };
    const { container, picker, calls } = setup({ events });
    expect(events.on).toHaveBeenCalledWith(
      "checkout/initialized",
      expect.any(Function),
      { eager: true },
    );
    await handlers["checkout/updated"](cart());
    expect(calls).toHaveLength(1);
    handlers["checkout/values"]({
      selectedShippingMethod: { carrier: { code: "ups" }, code: "GND" },
    });
    await flush();
    expect(calls.at(-1).url).toContain("method=ups_GND");
    handlers["checkout/values"]({});
    handlers["checkout/initialized"](null);
    picker.destroy();
    expect(off).toHaveBeenCalledTimes(3);
    expect(container.children).toHaveLength(0);
  });

  test("hides itself when the app is switched off and refreshes on demand", async () => {
    let enabled = true;
    const { container, picker } = setup({
      data: () => jsonResponse(enabled ? feed() : { enabled: false }),
    });
    await picker.update(cart());
    enabled = false;
    await picker.refresh();
    expect(container.querySelector(".delivery-slots").hidden).toBe(true);
  });
});
