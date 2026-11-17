/**
 * Slot capacity counters. Each profile, date and slot has one counter document; a booking is a
 * conditional increment on it, so two shoppers can't both take the last place:
 *
 *   updateOne({ key, booked: { $lt: capacity } }, { $inc: { booked: 1 } })
 *
 * matches only while there is room, and a single-document update is atomic in App Builder
 * Database Storage (DocumentDB), so no transaction is needed. Releasing never goes below zero.
 */

import { isDuplicateKey, USAGE } from "./db.js";

function parseKey(key) {
  const [profile, date, slot] = key.split("|");
  return { date, profile, slot };
}

/** Creates the counter at zero if it doesn't exist yet. Safe to race: the key is unique. */
async function ensureCounter(usage, key) {
  try {
    await usage.updateOne(
      { key },
      { $setOnInsert: { booked: 0, key, ...parseKey(key) } },
      { upsert: true },
    );
  } catch (error) {
    if (!isDuplicateKey(error)) {
      throw error;
    }
  }
}

function changed(result) {
  return (result?.modifiedCount ?? result?.matchedCount ?? 0) > 0;
}

/**
 * Takes one place in a slot. `capacity` null means unlimited. `force` books even when the slot
 * is full (an order that already exists must keep its slot). Returns true when booked.
 */
export async function reserveCapacity(
  client,
  key,
  capacity,
  { force = false } = {},
) {
  const usage = client.collection(USAGE);
  await ensureCounter(usage, key);
  const filter =
    capacity === null || force ? { key } : { booked: { $lt: capacity }, key };
  const result = await usage.updateOne(filter, {
    $inc: { booked: 1 },
    $set: { updatedAt: new Date().toISOString() },
  });
  return changed(result);
}

/** Gives one place back. Returns true when a place was released. */
export async function releaseCapacity(client, key) {
  const result = await client.collection(USAGE).updateOne(
    { booked: { $gt: 0 }, key },
    {
      $inc: { booked: -1 },
      $set: { updatedAt: new Date().toISOString() },
    },
  );
  return changed(result);
}

/** Bookings per slot key for a profile between two dates (inclusive). */
export async function usageFor(client, profile, from, to) {
  const docs = await client
    .collection(USAGE)
    .find({ date: { $gte: from, $lte: to }, profile })
    .toArray();
  return Object.fromEntries(docs.map((doc) => [doc.key, doc.booked ?? 0]));
}
