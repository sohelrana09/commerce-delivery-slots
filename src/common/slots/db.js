/**
 * App Builder Database Storage access shared by the storefront actions, the webhooks, the order
 * event and the Admin actions.
 *
 * Collections:
 *   slot_profiles      one document per delivery or pickup profile, keyed by `code` (unique)
 *   slot_usage         one counter per profile, date and slot: { key, profile, date, slot, booked }
 *   slot_reservations  one document per cart (quote), keyed by `quoteId` (unique)
 *
 * Every function takes a `connect` function so tests can pass an in-memory client.
 */

import { generateAccessToken } from "@adobe/aio-lib-core-auth";
import libDb from "@adobe/aio-lib-db";

export const PROFILES = "slot_profiles";
export const USAGE = "slot_usage";
export const RESERVATIONS = "slot_reservations";

export const INDEXES = {
  [PROFILES]: [{ key: { code: 1 }, options: { unique: true } }],
  [RESERVATIONS]: [
    { key: { quoteId: 1 }, options: { unique: true } },
    { key: { date: 1, profile: 1 }, options: {} },
    { key: { status: 1, expiresAt: 1 }, options: {} },
  ],
  [USAGE]: [
    { key: { key: 1 }, options: { unique: true } },
    { key: { profile: 1, date: 1 }, options: {} },
  ],
};

/** Opens a database client with the action's IMS credentials (`include-ims-credentials`). */
export async function connectDb(params) {
  const token = await generateAccessToken(params);
  const dbBase = await libDb.init({ token: token.access_token });
  return dbBase.connect();
}

/** Runs `fn(client)` and always closes the client. */
export async function withDb(params, fn, connect = connectDb) {
  const client = await connect(params);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

const NOT_FOUND = /document not found/iu;
const DUPLICATE = /duplicate key|E11000/iu;

export function isNotFound(error) {
  return error?.httpStatusCode === 404 || NOT_FOUND.test(error?.message ?? "");
}

export function isDuplicateKey(error) {
  return error?.code === 11_000 || DUPLICATE.test(error?.message ?? "");
}

/**
 * Runs a single-document read or find-and-modify and returns null when nothing matches.
 * App Builder Database Storage can reject with "Document not found" (HTTP 404) where MongoDB
 * resolves to null.
 */
export async function orNull(promise) {
  try {
    return (await promise) ?? null;
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/** Strips database-only fields. */
export function clean(doc) {
  if (!doc) {
    return null;
  }
  const { _id: _dbId, ...rest } = doc;
  return rest;
}
