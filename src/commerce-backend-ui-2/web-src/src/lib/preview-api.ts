import { addDays, availability, validateProfile } from "#engine";

import { DEFAULT_PROFILES } from "../../../../common/slots/default-profiles.js";
import { ApiError } from "../hooks/use-slots-api.ts";

import type { SlotsApi } from "../hooks/use-slots-api.ts";
import type { Booking, BookingStatus, Profile } from "./types.ts";

const PROFILES_KEY = "delivery-slots-preview:profiles";
const BOOKINGS_KEY = "delivery-slots-preview:bookings";
const COUNTED: BookingStatus[] = ["hold", "pending", "confirmed"];

/** The examples, switched on, so the preview opens with something to look at. */
export function seedProfiles(): Profile[] {
  return (DEFAULT_PROFILES as Profile[]).map((profile) => ({
    ...structuredClone(profile),
    enabled: true,
  }));
}

/** Made-up bookings over the next days for the first example, so the bookings view has data. */
export function seedBookings(now = Date.now()): Booking[] {
  const [profile] = seedProfiles();
  const { dates } = availability(profile, { now });
  const statuses: BookingStatus[] = [
    "confirmed",
    "confirmed",
    "pending",
    "hold",
    "cancelled",
  ];
  const bookings: Booking[] = [];
  let order = 1000;
  for (const day of dates) {
    for (const slot of day.slots.filter((s) => s.available)) {
      const count = (order % 5) + (slot.code === "evening" ? 6 : 1);
      for (let i = 0; i < count; i += 1) {
        order += 1;
        const status = statuses[order % statuses.length];
        bookings.push({
          date: day.date,
          end: slot.end,
          fee: slot.fee,
          incrementId:
            status === "confirmed" || status === "cancelled"
              ? `00000${order}`
              : null,
          label: slot.label,
          orderId:
            status === "confirmed" || status === "cancelled"
              ? String(order)
              : null,
          profile: profile.code,
          profileName: profile.name,
          quoteId: String(order * 7),
          shippingMethod: "flatrate_flatrate",
          slot: slot.code,
          start: slot.start,
          status,
          storeView: "default",
          type: "delivery",
          updatedAt: new Date(now - order * 60_000).toISOString(),
        });
      }
    }
  }
  return bookings;
}

function read<T>(key: string, seed: () => T): T {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored) as T;
    }
  } catch {
    // Storage blocked or corrupt: start from the examples.
  }
  return seed();
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: changes last until the page reloads.
  }
}

function sorted(profiles: Profile[]): Profile[] {
  return [...profiles].sort(
    (a, b) =>
      (a.priority ?? 0) - (b.priority ?? 0) || a.code.localeCompare(b.code),
  );
}

const wait = () => new Promise((resolve) => setTimeout(resolve, 150));

/**
 * The Admin API without App Builder: profiles and made-up bookings live in this browser's
 * localStorage, and profiles are checked with the same validateProfile as the profile-save
 * action. For local preview only.
 */
export function createPreviewApi(): SlotsApi {
  let profiles = read(PROFILES_KEY, seedProfiles);
  let bookings = read(BOOKINGS_KEY, () => seedBookings());

  return {
    async bookings({ profile: code, from, to }) {
      await wait();
      const profile = profiles.find((p) => p.code === code);
      if (!profile) {
        throw new ApiError("Profile not found");
      }
      const { today } = availability(profile, { days: 1 });
      const start = from || today;
      const end = to || addDays(start, 13);
      const inRange = bookings.filter(
        (b) => b.profile === code && b.date >= start && b.date <= end,
      );
      const booked: Record<string, number> = {};
      for (const b of inRange.filter((x) => COUNTED.includes(x.status))) {
        const key = `${b.profile}|${b.date}|${b.slot}`;
        booked[key] = (booked[key] ?? 0) + 1;
      }
      const calendar = availability(
        { ...profile, maxDaysAhead: 400 },
        { booked, from: start },
      ).dates.filter((day) => day.date <= end);
      return {
        bookings: structuredClone(inRange).sort(
          (a, b) =>
            a.date.localeCompare(b.date) || a.start.localeCompare(b.start),
        ),
        calendar,
        from: start,
        to: end,
      };
    },

    async deleteProfile(code) {
      await wait();
      const before = profiles.length;
      profiles = profiles.filter((profile) => profile.code !== code);
      write(PROFILES_KEY, profiles);
      return { deleted: profiles.length < before };
    },

    async listProfiles() {
      await wait();
      return {
        examples: structuredClone(DEFAULT_PROFILES as Profile[]),
        profiles: sorted(structuredClone(profiles)),
      };
    },

    async lookups() {
      await wait();
      return {
        storeViews: [
          { code: "default", id: 1, label: "Default Store View" },
          { code: "fr", id: 2, label: "French Store View" },
        ],
      };
    },

    async releaseBooking(quoteId) {
      await wait();
      const booking = bookings.find(
        (b) => b.quoteId === quoteId && COUNTED.includes(b.status),
      );
      if (!booking) {
        throw new ApiError("No active booking for that cart");
      }
      booking.status = "released";
      booking.updatedAt = new Date().toISOString();
      write(BOOKINGS_KEY, bookings);
      bookings = [...bookings];
      return { released: true };
    },

    async saveProfile(profile, previousCode) {
      await wait();
      const errors = validateProfile(profile);
      if (errors.length) {
        throw new ApiError(
          `Invalid delivery profile: ${errors.join("; ")}`,
          errors,
        );
      }
      const renamed = previousCode && previousCode !== profile.code;
      if (
        (renamed || !previousCode) &&
        profiles.some((existing) => existing.code === profile.code)
      ) {
        throw new ApiError("Invalid delivery profile", [
          `a profile with code "${profile.code}" already exists`,
        ]);
      }
      const saved = { ...profile, updatedAt: new Date().toISOString() };
      profiles = [
        ...profiles.filter(
          (existing) =>
            existing.code !== profile.code && existing.code !== previousCode,
        ),
        saved,
      ];
      write(PROFILES_KEY, profiles);
      return { profile: saved };
    },
  };
}

/** Puts the examples back and forgets the preview's changes. */
export function resetPreview() {
  try {
    localStorage.removeItem(PROFILES_KEY);
    localStorage.removeItem(BOOKINGS_KEY);
  } catch {
    // Nothing stored.
  }
}
