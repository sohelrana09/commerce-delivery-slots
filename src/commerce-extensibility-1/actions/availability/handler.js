/**
 * The storefront's availability feed: the dates and time slots a shopper can pick for one
 * shipping method and store view. Shoppers see whether a slot is free, never other carts or
 * orders. Responses are cacheable for a few seconds, since every shopper gets the same answer.
 */

import {
  addDays,
  availability,
  publicAvailability,
  selectProfile,
} from "#engine";

import { json } from "../../../common/http.js";
import { usageFor } from "../../../common/slots/capacity.js";
import { withDb } from "../../../common/slots/db.js";
import { loadProfiles } from "../../../common/slots/profiles-repo.js";
import { loadSettings } from "../../../common/slots/settings.js";

const CODE = /^[a-z0-9_]{1,64}$/iu;
const METHOD = /^[A-Za-z0-9_-]{1,128}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

function pick(value, pattern) {
  return typeof value === "string" && pattern.test(value) ? value : "";
}

export function createAvailabilityFeed(overrides = {}) {
  const deps = {
    loadProfiles,
    loadSettings,
    now: () => Date.now(),
    usage: (params, profile, from, to) =>
      withDb(params, (client) => usageFor(client, profile, from, to)),
    ...overrides,
  };

  return async (params = {}, logger = console) => {
    const storeView = pick(params.store, CODE);
    const shippingMethod = pick(params.method, METHOD);
    const settings = await deps.loadSettings(logger);
    const cache = (response) => {
      response.headers["Cache-Control"] =
        `public, max-age=${settings.cacheSeconds}`;
      return response;
    };
    if (!settings.slotsEnabled) {
      return cache(json(200, { enabled: false, profile: null }));
    }
    const profile = selectProfile(await deps.loadProfiles(params), {
      shippingMethod,
      storeView,
    });
    if (!profile) {
      return cache(json(200, { enabled: true, profile: null }));
    }
    const now = deps.now();
    const days = Math.min(Number.parseInt(params.days, 10) || 62, 366);
    const from = pick(params.from, DATE) || undefined;
    const first = availability(profile, { days: 1, now });
    const booked = await deps.usage(
      params,
      profile.code,
      first.today,
      addDays(first.today, profile.maxDaysAhead),
    );
    const result = availability(profile, { booked, days, from, now });
    return cache(
      json(200, {
        enabled: true,
        ...publicAvailability(result, {
          showRemaining: settings.showRemaining,
        }),
      }),
    );
  };
}
