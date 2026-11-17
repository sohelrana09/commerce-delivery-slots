/**
 * Delivery and pickup profiles stored in App Builder Database Storage. Reads for the storefront
 * and the webhooks are cached per warm action container for PROFILES_CACHE_MS. The SLOT_PROFILES
 * action input, when set, replaces the stored profiles (handy for CI and scripted setups).
 */

import { validateProfile } from "#engine";

import { clean, orNull, PROFILES, withDb } from "./db.js";

export const PROFILES_CACHE_MS = 30_000;

let cache = null;

export function clearProfilesCache() {
  cache = null;
}

export class ValidationError extends Error {
  // biome-ignore lint/style/useConsistentMemberAccessibility: plain JavaScript has no access modifiers
  constructor(errors, message = "Invalid delivery profile") {
    super(`${message}: ${errors.join("; ")}`);
    this.name = "ValidationError";
    this.errors = errors;
  }
}

export function listProfiles(params, connect) {
  return withDb(
    params,
    async (client) => {
      const docs = await client
        .collection(PROFILES)
        .find({})
        .sort({ priority: 1, code: 1 })
        .toArray();
      return docs.map(clean);
    },
    connect,
  );
}

/** Profiles from the SLOT_PROFILES input, or null when it isn't set. */
export function profilesFromInput(params = {}) {
  const value = params.SLOT_PROFILES;
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  let raw = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch (error) {
      throw new Error("SLOT_PROFILES is not valid JSON", { cause: error });
    }
  }
  const profiles = Array.isArray(raw) ? raw : raw?.profiles;
  if (!Array.isArray(profiles)) {
    throw new Error(
      "SLOT_PROFILES must be an array of profiles or { profiles: [...] }",
    );
  }
  return profiles;
}

/** Profiles for the storefront and webhooks: the input override, or the cached stored ones. */
export async function loadProfiles(params, connect, now = Date.now()) {
  const fromInput = profilesFromInput(params);
  if (fromInput) {
    return fromInput;
  }
  if (cache && cache.expiresAt > now) {
    return cache.profiles;
  }
  const profiles = await listProfiles(params, connect);
  cache = { expiresAt: now + PROFILES_CACHE_MS, profiles };
  return profiles;
}

/**
 * Creates or replaces a profile. When `previousCode` differs from `profile.code` (a rename), the
 * old document is removed. Refuses to overwrite another profile's code.
 */
// Async so validation failures reject like database failures do.
// biome-ignore lint/suspicious/useAwait: see comment above
export async function saveProfile(
  profile,
  params,
  { previousCode, connect } = {},
) {
  const errors = validateProfile(profile);
  if (errors.length) {
    throw new ValidationError(errors);
  }
  const { _id: _ignored, ...rest } = profile;
  const doc = { ...rest, updatedAt: new Date().toISOString() };

  return withDb(
    params,
    async (client) => {
      const profiles = client.collection(PROFILES);
      const renamed = previousCode && previousCode !== profile.code;
      if (renamed || !previousCode) {
        const clash = await orNull(profiles.findOne({ code: profile.code }));
        if (clash) {
          throw new ValidationError([
            `a profile with code "${profile.code}" already exists`,
          ]);
        }
      }
      if (renamed) {
        await profiles.deleteOne({ code: previousCode });
      }
      await profiles.replaceOne({ code: profile.code }, doc, { upsert: true });
      clearProfilesCache();
      return doc;
    },
    connect,
  );
}

export function deleteProfile(code, params, connect) {
  return withDb(
    params,
    async (client) => {
      const result = await client.collection(PROFILES).deleteOne({ code });
      clearProfilesCache();
      return (result?.deletedCount ?? 0) > 0;
    },
    connect,
  );
}
