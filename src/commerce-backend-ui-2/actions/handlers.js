/**
 * Admin action handlers: manage profiles, see bookings and capacity, release a booking, and load
 * the store views the profile editor offers. The calendar preview runs in the browser with the
 * same engine as the storefront. Dependencies are injectable for tests.
 */

import { addDays, availability, isDate } from "#engine";

import { json } from "../../common/http.js";
import { usageFor } from "../../common/slots/capacity.js";
import { getCommerce } from "../../common/slots/commerce.js";
import { withDb } from "../../common/slots/db.js";
import { DEFAULT_PROFILES } from "../../common/slots/default-profiles.js";
import {
  deleteProfile,
  listProfiles,
  saveProfile,
  ValidationError,
} from "../../common/slots/profiles-repo.js";
import { adminRelease, listBookings } from "../../common/slots/reservations.js";

const STATUSES = [
  "hold",
  "pending",
  "confirmed",
  "cancelled",
  "expired",
  "released",
];
const MAX_RANGE_DAYS = 92;

const realDeps = {
  db: (params, fn) => withDb(params, fn),
  deleteProfile,
  getCommerce,
  listProfiles,
  now: () => Date.now(),
  saveProfile,
};

function requireCode(code, what = "code") {
  if (typeof code !== "string" || !code) {
    throw new ValidationError([`${what} is required`], "Invalid request");
  }
  return code;
}

function range(body, today) {
  const from = isDate(body.from) ? body.from : today;
  const to = isDate(body.to) ? body.to : addDays(from, 13);
  if (to < from) {
    throw new ValidationError(
      ["to must be on or after from"],
      "Invalid request",
    );
  }
  if (to > addDays(from, MAX_RANGE_DAYS)) {
    throw new ValidationError(
      [`choose ${MAX_RANGE_DAYS} days or fewer`],
      "Invalid request",
    );
  }
  return { from, to };
}

export function createHandlers(overrides = {}) {
  const deps = { ...realDeps, ...overrides };

  return {
    async bookingRelease(body, params) {
      const quoteId = requireCode(body.quoteId, "quoteId");
      const released = await deps.db(params, (client) =>
        adminRelease(client, quoteId, { now: deps.now() }),
      );
      return released
        ? json(200, { released: true })
        : json(404, { error: "No active booking for that cart" });
    },

    /**
     * Bookings and capacity for one profile and date range: every reservation, plus each date's
     * slots with capacity, booked and remaining places.
     */
    async bookings(body, params) {
      const code = requireCode(body.profile, "profile");
      const profiles = await deps.listProfiles(params);
      const profile = profiles.find((p) => p.code === code);
      if (!profile) {
        return json(404, { error: "Profile not found" });
      }
      const now = deps.now();
      const { today } = availability(profile, { days: 1, now });
      const { from, to } = range(body, today);
      const statuses = (
        Array.isArray(body.statuses) ? body.statuses : []
      ).filter((s) => STATUSES.includes(s));
      const { bookings, booked } = await deps.db(params, async (client) => ({
        booked: await usageFor(client, code, from, to),
        bookings: await listBookings(client, {
          from,
          profile: code,
          statuses,
          to,
        }),
      }));
      // Show the whole range, including past and far-future dates, for capacity planning.
      const calendar = availability(
        { ...profile, maxDaysAhead: 400 },
        { booked, from, now },
      ).dates.filter((day) => day.date <= to);
      return json(200, { bookings, calendar, from, to });
    },

    async lookups(_body, params, logger) {
      try {
        const commerce = await deps.getCommerce(params);
        const storeViews = await commerce.get("store/storeViews").json();
        return json(200, {
          storeViews: (storeViews ?? [])
            .filter((s) => Number(s.id) !== 0)
            .map((s) => ({ code: s.code, id: s.id, label: s.name })),
        });
      } catch (error) {
        // The editor still works with typed store view codes when Commerce can't be reached.
        logger.warn(`lookups unavailable: ${error.message}`);
        return json(200, { storeViews: [], unavailable: true });
      }
    },

    async profileDelete(body, params) {
      const deleted = await deps.deleteProfile(requireCode(body.code), params);
      return deleted
        ? json(200, { deleted: true })
        : json(404, { error: "Profile not found" });
    },

    async profileSave(body, params) {
      if (!body.profile || typeof body.profile !== "object") {
        throw new ValidationError(["profile is required"]);
      }
      const saved = await deps.saveProfile(body.profile, params, {
        previousCode: body.previousCode,
      });
      return json(200, { profile: saved });
    },

    async profilesList(_body, params) {
      const profiles = await deps.listProfiles(params);
      return json(200, { examples: DEFAULT_PROFILES, profiles });
    },
  };
}

export const handlers = createHandlers();
