/**
 * The place-order webhook ("before" order placement). It checks the order's delivery slot and
 * books it, or answers with an exception so Commerce stops the order and shows the shopper why.
 *
 * Failure policy: a full slot, a passed cut-off or a missing required slot always blocks the
 * order. An unexpected error (database outage, bad configuration) blocks it only when the
 * "Allow orders when the slot check fails" setting is off; by default the order goes through and
 * the error is logged, so an outage costs a booking check, not a sale.
 */

import {
  exceptionOperation,
  successOperation,
} from "@adobe/aio-commerce-sdk/webhooks/responses";

import { withDb } from "../../../common/slots/db.js";
import { orderFromWebhook } from "../../../common/slots/order.js";
import { loadProfiles } from "../../../common/slots/profiles-repo.js";
import {
  acceptAtCheckout,
  SlotError,
} from "../../../common/slots/reservations.js";
import { loadSettings } from "../../../common/slots/settings.js";
import {
  verifyWebhookSignature,
  webhookPayload,
} from "../../../common/slots/signature.js";

export const UNAVAILABLE_MESSAGE =
  "We couldn't confirm your delivery slot. Please try again.";

export function createValidateOrder(overrides = {}) {
  const deps = {
    db: (params, fn) => withDb(params, fn),
    loadProfiles,
    loadSettings,
    now: () => Date.now(),
    ...overrides,
  };

  return async (params = {}, logger = console) => {
    const signature = verifyWebhookSignature(params);
    if (signature.checked && !signature.valid) {
      logger.warn("Rejected a place-order webhook with a bad signature");
      return exceptionOperation(UNAVAILABLE_MESSAGE);
    }
    const payload = signature.body ?? webhookPayload(params);
    const settings = await deps.loadSettings(logger);
    if (!settings.slotsEnabled) {
      return successOperation();
    }
    const order = orderFromWebhook(payload);
    try {
      const profiles = await deps.loadProfiles(params);
      const result = await deps.db(params, (client) =>
        acceptAtCheckout(client, profiles, order, { now: deps.now() }),
      );
      if (result.reservation) {
        logger.info(
          `Cart ${order.quoteId}: slot ${result.reservation.key} accepted`,
        );
      }
      return successOperation();
    } catch (error) {
      if (error instanceof SlotError) {
        logger.info(`Cart ${order.quoteId}: blocked (${error.reason})`);
        return exceptionOperation(error.message);
      }
      logger.error(
        `Slot check failed for cart ${order.quoteId}: ${error.message}`,
      );
      return settings.failOpen
        ? successOperation()
        : exceptionOperation(UNAVAILABLE_MESSAGE);
    }
  };
}
