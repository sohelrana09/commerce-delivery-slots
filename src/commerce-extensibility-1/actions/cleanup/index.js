/**
 * Scheduled every 10 minutes (the delivery-slots-sweep trigger): expires holds and pending
 * reservations whose time ran out, so their places go back on sale.
 */

import AioLogger from "@adobe/aio-lib-core-logging";

import { withDb } from "../../../common/slots/db.js";
import { expireStale } from "../../../common/slots/reservations.js";

export function createCleanup(overrides = {}) {
  const deps = {
    db: (params, fn) => withDb(params, fn),
    now: () => Date.now(),
    ...overrides,
  };
  return (params = {}) =>
    deps.db(params, (client) => expireStale(client, { nowMs: deps.now() }));
}

const cleanup = createCleanup();

export async function main(params = {}) {
  const logger = AioLogger("delivery-slots-cleanup", {
    level: params.LOG_LEVEL || "info",
  });
  const expired = await cleanup(params);
  logger.info(`Expired ${expired} stale reservation(s)`);
  return { body: { expired }, statusCode: 200 };
}
