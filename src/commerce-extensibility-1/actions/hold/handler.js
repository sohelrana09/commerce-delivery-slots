/**
 * The storefront hold: when the shopper picks a slot, the kit posts the masked cart ID with the
 * date and slot. The slot is checked and a place is held for the cart for `holdMinutes`, so it
 * can't fill up while the shopper pays. `{ release: true }` lets the hold go.
 *
 * The masked cart ID is the credential: it must name an active cart (cart.js). One cart holds
 * at most one place at a time, so a script can't drain capacity without creating real carts.
 */

import { json } from "../../../common/http.js";
import { CartNotFoundError, resolveCart } from "../../../common/slots/cart.js";
import { getCommerce } from "../../../common/slots/commerce.js";
import { withDb } from "../../../common/slots/db.js";
import { loadProfiles } from "../../../common/slots/profiles-repo.js";
import {
  placeHold,
  releaseHold,
  SlotError,
} from "../../../common/slots/reservations.js";
import { loadSettings } from "../../../common/slots/settings.js";

const CODE = /^[a-z0-9_]{1,64}$/iu;
const METHOD = /^[A-Za-z0-9_-]{1,128}$/u;

function text(value, pattern) {
  return typeof value === "string" && pattern.test(value) ? value : "";
}

/** The shopper's choice from the request body, with anything unexpected dropped. */
function holdInput(body, quoteId) {
  return {
    date: typeof body.date === "string" ? body.date : "",
    quoteId,
    shippingMethod: text(body.shippingMethod, METHOD),
    slot: typeof body.slot === "string" ? body.slot.slice(0, 64) : "",
    storeView: text(body.store, CODE),
  };
}

function publicHold(hold) {
  return {
    date: hold.date,
    end: hold.end,
    expiresAt: hold.expiresAt,
    fee: hold.fee,
    label: hold.label,
    profile: hold.profile,
    slot: hold.slot,
    start: hold.start,
  };
}

export function createHold(overrides = {}) {
  const deps = {
    db: (params, fn) => withDb(params, fn),
    getCommerce,
    loadProfiles,
    loadSettings,
    now: () => Date.now(),
    resolveCart,
    ...overrides,
  };

  return async (body = {}, params = {}, logger = console) => {
    if (params.__ow_method && params.__ow_method.toLowerCase() !== "post") {
      return json(405, { error: "Use POST" });
    }
    const settings = await deps.loadSettings(logger);
    if (!settings.slotsEnabled) {
      return json(409, {
        error: "Delivery slots are switched off.",
        reason: "disabled",
      });
    }
    let cart;
    try {
      cart = await deps.resolveCart(
        await deps.getCommerce(params),
        body.cartId,
      );
    } catch (error) {
      if (error instanceof CartNotFoundError) {
        return json(404, { error: "Cart not found.", reason: "cart" });
      }
      throw error;
    }

    if (body.release === true) {
      const released = await deps.db(params, (client) =>
        releaseHold(client, cart.quoteId, { now: deps.now() }),
      );
      return json(200, { released });
    }

    const input = holdInput(body, cart.quoteId);
    const profiles = await deps.loadProfiles(params);
    try {
      const hold = await deps.db(params, (client) =>
        placeHold(client, profiles, input, {
          holdMinutes: settings.holdMinutes,
          now: deps.now(),
        }),
      );
      return json(200, { hold: publicHold(hold) });
    } catch (error) {
      if (error instanceof SlotError) {
        return json(409, { error: error.message, reason: error.reason });
      }
      throw error;
    }
  };
}
