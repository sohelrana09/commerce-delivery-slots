/**
 * Slot reservations: one document per cart (quote), moving through these states:
 *
 *   hold       the shopper picked a slot at checkout; it holds a place for `holdMinutes`
 *   pending    the place-order webhook accepted it; waiting for the order-placed event
 *   confirmed  the order exists
 *   cancelled  the order was cancelled; the place went back
 *   expired    a hold or pending reservation timed out; the place went back
 *   released   an admin released it from the bookings view; the place went back
 *
 * While a reservation is hold, pending or confirmed it counts towards the slot's capacity
 * (capacity.js). Every state change is a find-and-modify filtered on the current state, so a
 * retried webhook or a redelivered event can't count or release a place twice.
 */

import {
  checkSelection,
  describeSelection,
  selectProfile,
  slotKey,
} from "#engine";

import { releaseCapacity, reserveCapacity } from "./capacity.js";
import { clean, orNull, RESERVATIONS } from "./db.js";

export const COUNTED = ["hold", "pending", "confirmed"];
export const PENDING_MINUTES = 60;

const iso = (ms) => new Date(ms).toISOString();

export class SlotError extends Error {
  // biome-ignore lint/style/useConsistentMemberAccessibility: plain JavaScript has no access modifiers
  constructor(reason, message) {
    super(message ?? reason);
    this.name = "SlotError";
    this.reason = reason;
  }
}

/** What shoppers read when a slot can't be booked. */
export const SHOPPER_MESSAGES = {
  "already-placed": "An order has already been placed for this cart.",
  blackout: "We can't deliver on that date. Please choose another date.",
  closed: "That date or time isn't available. Please choose another.",
  cutoff:
    "The cut-off time for that date has passed. Please choose a later date.",
  full: "That time slot has just filled up. Please choose another.",
  holiday: "We're closed on that date. Please choose another date.",
  "lead-time": "That time slot is too soon. Please choose a later one.",
  "no-profile": "Delivery slots aren't available for this shipping method.",
  "no-slots": "That date has no time slots. Please choose another date.",
  "out-of-range": "That date can't be booked. Please choose another date.",
  past: "That time has passed. Please choose a later slot.",
  required: "Please choose a delivery date and time slot.",
  "same-day-off":
    "Same-day delivery isn't available. Please choose a later date.",
  "unknown-slot": "That time slot doesn't exist. Please choose another.",
};

export function shopperMessage(reason) {
  return SHOPPER_MESSAGES[reason] ?? SHOPPER_MESSAGES.closed;
}

function reservations(client) {
  return client.collection(RESERVATIONS);
}

export function findReservation(client, quoteId) {
  return orNull(
    reservations(client).findOne({ quoteId: String(quoteId) }),
  ).then(clean);
}

/** The reservation document for a profile, a checked slot and a cart. */
function reservationDoc(profile, slot, input, status, expiresAt, nowMs) {
  return {
    date: input.date,
    end: slot.end,
    expiresAt,
    fee: slot.fee ?? 0,
    key: slot.key,
    label: slot.label,
    profile: profile.code,
    profileName: profile.name,
    quoteId: String(input.quoteId),
    shippingMethod: input.shippingMethod ?? "",
    slot: slot.code,
    start: slot.start,
    startsAt: slot.startsAt,
    status,
    storeView: input.storeView ?? "",
    type: profile.type,
    updatedAt: iso(nowMs),
  };
}

/**
 * Takes a place in `key` and swaps the cart's reservation to `doc`, releasing the place the cart
 * held before. Works when two requests for the same cart race: each releases what it replaced.
 */
async function bookAndSwap(client, doc, capacity, { nowMs, force = false }) {
  let booked = await reserveCapacity(client, doc.key, capacity, { force });
  if (!booked) {
    // Expired holds may still count: give them back, then try once more.
    const freed = await expireStale(client, { key: doc.key, nowMs });
    booked = freed > 0 && (await reserveCapacity(client, doc.key, capacity));
  }
  if (!booked) {
    throw new SlotError("full", shopperMessage("full"));
  }
  const previous = await orNull(
    reservations(client).findOneAndUpdate(
      { quoteId: doc.quoteId },
      { $set: doc, $setOnInsert: { createdAt: iso(nowMs) } },
      { returnDocument: "before", upsert: true },
    ),
  );
  if (previous && COUNTED.includes(previous.status)) {
    await releaseCapacity(client, previous.key);
  }
  return doc;
}

function checkedSlot(profile, input, nowMs, options = {}) {
  const result = checkSelection(profile, input, { now: nowMs, ...options });
  if (!result.ok) {
    throw new SlotError(result.reason, shopperMessage(result.reason));
  }
  return result.slot;
}

/**
 * The storefront hold: the shopper picked `date` and `slot` for a cart. Re-picking the same slot
 * extends the hold; picking another moves it.
 *
 * @param {object} client database client
 * @param {object[]} profiles
 * @param {{quoteId: string, date: string, slot: string, shippingMethod?: string, storeView?: string}} input
 * @param {{now?: number, holdMinutes?: number}} [options]
 */
export async function placeHold(client, profiles, input, options = {}) {
  const nowMs = options.now ?? Date.now();
  const holdMs = (options.holdMinutes ?? 20) * 60_000;
  const profile = selectProfile(profiles, input);
  if (!profile) {
    throw new SlotError("no-profile", shopperMessage("no-profile"));
  }
  const slot = checkedSlot(profile, input, nowMs);
  const existing = await findReservation(client, input.quoteId);
  if (existing?.status === "confirmed") {
    throw new SlotError("already-placed", shopperMessage("already-placed"));
  }
  const expiresAt = iso(nowMs + holdMs);
  if (
    existing &&
    COUNTED.includes(existing.status) &&
    existing.key === slot.key
  ) {
    const extended = await orNull(
      reservations(client).findOneAndUpdate(
        { quoteId: existing.quoteId, status: existing.status },
        { $set: { expiresAt, updatedAt: iso(nowMs) } },
        { returnDocument: "after" },
      ),
    );
    if (extended) {
      return clean(extended);
    }
  }
  const doc = reservationDoc(profile, slot, input, "hold", expiresAt, nowMs);
  return bookAndSwap(client, doc, slot.capacity, { nowMs });
}

/** Lets a cart's hold go (the shopper cleared the picker or chose a method without slots). */
export async function releaseHold(client, quoteId, { now = Date.now() } = {}) {
  const released = await orNull(
    reservations(client).findOneAndUpdate(
      { quoteId: String(quoteId), status: { $in: ["hold", "pending"] } },
      { $set: { status: "released", updatedAt: iso(now) } },
      { returnDocument: "before" },
    ),
  );
  if (released) {
    await releaseCapacity(client, released.key);
    return true;
  }
  return false;
}

/**
 * The place-order webhook. Returns `{ ok: true, reservation }`, `{ ok: true, skipped }` when the
 * order needs no slot, or throws a SlotError whose message the shopper sees.
 *
 * The slot comes from the order's custom attributes (`selection`) when Commerce sends them, or
 * from the cart's hold. A held slot is honoured even after its cut-off: the shopper took it in
 * time. A slot without a hold is checked and booked now.
 */
export async function acceptAtCheckout(client, profiles, order, options = {}) {
  const nowMs = options.now ?? Date.now();
  const existing = order.quoteId
    ? await findReservation(client, order.quoteId)
    : null;
  const live = existing && COUNTED.includes(existing.status) ? existing : null;
  const selection = order.selection?.date ? order.selection : live;
  const storeView = order.storeView || live?.storeView || "";

  const profile =
    (selection?.profile &&
      profiles.find(
        (p) => p.code === selection.profile && p.enabled !== false,
      )) ||
    selectProfile(profiles, {
      shippingMethod: order.shippingMethod,
      storeView,
    });
  if (!profile) {
    return { ok: true, skipped: "no-profile" };
  }
  if (!selection?.date) {
    if (profile.required === false) {
      return { ok: true, skipped: "not-chosen" };
    }
    throw new SlotError("required", shopperMessage("required"));
  }

  const key = slotKey(profile.code, selection.date, selection.slot);
  const pendingUntil = iso(nowMs + PENDING_MINUTES * 60_000);
  if (live && live.key === key) {
    if (live.status === "confirmed") {
      return { ok: true, reservation: live };
    }
    const accepted = await orNull(
      reservations(client).findOneAndUpdate(
        { key, quoteId: live.quoteId, status: { $in: ["hold", "pending"] } },
        {
          $set: {
            expiresAt: pendingUntil,
            shippingMethod: order.shippingMethod ?? live.shippingMethod,
            status: "pending",
            updatedAt: iso(nowMs),
          },
        },
        { returnDocument: "after" },
      ),
    );
    if (accepted) {
      return { ok: true, reservation: clean(accepted) };
    }
  }

  if (!order.quoteId) {
    // Without a cart ID there is nothing to book against; only check the slot.
    checkedSlot(profile, selection, nowMs);
    return { ok: true, skipped: "no-quote" };
  }
  const slot = checkedSlot(profile, selection, nowMs);
  const doc = reservationDoc(
    profile,
    slot,
    {
      ...selection,
      quoteId: order.quoteId,
      shippingMethod: order.shippingMethod,
      storeView,
    },
    "pending",
    pendingUntil,
    nowMs,
  );
  return {
    ok: true,
    reservation: await bookAndSwap(client, doc, slot.capacity, { nowMs }),
  };
}

/**
 * The order-saved event. Confirms the cart's reservation against the order, or releases it when
 * the order is cancelled. Returns what happened, for the logs:
 * "confirmed", "cancelled", "unchanged" or "none".
 */
export async function applyOrderEvent(client, order, options = {}) {
  const nowMs = options.now ?? Date.now();
  if (!order.quoteId) {
    return { result: "none" };
  }
  const existing = await findReservation(client, order.quoteId);
  if (!existing) {
    return { result: "none" };
  }
  const col = reservations(client);
  const orderFields = {
    incrementId: order.incrementId ?? existing.incrementId ?? null,
    orderId: order.orderId ?? existing.orderId ?? null,
    updatedAt: iso(nowMs),
  };

  if (order.state === "canceled" || order.state === "closed") {
    const cancelled = await orNull(
      col.findOneAndUpdate(
        { quoteId: existing.quoteId, status: { $in: COUNTED } },
        { $set: { ...orderFields, status: "cancelled" } },
        { returnDocument: "before" },
      ),
    );
    if (cancelled) {
      await releaseCapacity(client, cancelled.key);
      return { reservation: clean(cancelled), result: "cancelled" };
    }
    return { reservation: existing, result: "unchanged" };
  }

  const confirmed = await orNull(
    col.findOneAndUpdate(
      { quoteId: existing.quoteId, status: { $in: ["hold", "pending"] } },
      { $set: { ...orderFields, expiresAt: null, status: "confirmed" } },
      { returnDocument: "after" },
    ),
  );
  if (confirmed) {
    return { reservation: clean(confirmed), result: "confirmed" };
  }
  if (existing.status === "expired") {
    // The order exists, so it keeps its slot even if the slot filled up meanwhile.
    const revived = await orNull(
      col.findOneAndUpdate(
        { quoteId: existing.quoteId, status: "expired" },
        { $set: { ...orderFields, expiresAt: null, status: "confirmed" } },
        { returnDocument: "after" },
      ),
    );
    if (revived) {
      await reserveCapacity(client, revived.key, null, { force: true });
      return { reservation: clean(revived), result: "confirmed" };
    }
  }
  return { reservation: existing, result: "unchanged" };
}

/**
 * Expires holds and pending reservations whose time ran out and gives their places back.
 * Pass `key` to sweep one slot only. Returns how many were expired.
 */
export async function expireStale(
  client,
  { key, nowMs = Date.now(), limit = 500 } = {},
) {
  const col = reservations(client);
  const filter = {
    expiresAt: { $lt: iso(nowMs) },
    status: { $in: ["hold", "pending"] },
    ...(key ? { key } : {}),
  };
  const stale = (await col.find(filter).toArray()).slice(0, limit);
  let expired = 0;
  for (const doc of stale) {
    // biome-ignore lint/performance/noAwaitInLoops: each change is filtered on its own state
    const taken = await orNull(
      col.findOneAndUpdate(
        { expiresAt: doc.expiresAt, quoteId: doc.quoteId, status: doc.status },
        { $set: { status: "expired", updatedAt: iso(nowMs) } },
        { returnDocument: "before" },
      ),
    );
    if (taken) {
      await releaseCapacity(client, taken.key);
      expired += 1;
    }
  }
  return expired;
}

/** An admin releases a booking from the bookings view. */
export async function adminRelease(client, quoteId, { now = Date.now() } = {}) {
  const released = await orNull(
    reservations(client).findOneAndUpdate(
      { quoteId: String(quoteId), status: { $in: COUNTED } },
      { $set: { status: "released", updatedAt: iso(now) } },
      { returnDocument: "before" },
    ),
  );
  if (!released) {
    return false;
  }
  await releaseCapacity(client, released.key);
  return true;
}

/** Bookings between two dates, for the Admin bookings view. */
export async function listBookings(
  client,
  { from, to, profile, statuses } = {},
) {
  const filter = {
    date: { $gte: from, $lte: to },
    ...(profile ? { profile } : {}),
    ...(statuses?.length ? { status: { $in: statuses } } : {}),
  };
  const docs = await reservations(client)
    .find(filter)
    .sort({ date: 1, start: 1, updatedAt: 1 })
    .toArray();
  return docs.map(clean);
}

/** "Delivery: Tue 18 Nov 2026, 09:00–12:00 (Morning)" for the order comment. */
export function orderComment(reservation, locale = "en-GB") {
  const kind = reservation.type === "pickup" ? "Pickup" : "Delivery";
  return `${kind} slot: ${describeSelection(reservation, locale)}`;
}
