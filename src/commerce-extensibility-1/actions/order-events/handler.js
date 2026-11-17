/**
 * The order-saved event (`observer.sales_order_save_commit_after`): confirms the cart's slot
 * reservation once the order exists, and gives the place back when the order is cancelled.
 * State changes are idempotent, so redelivered events are harmless. When a reservation is first
 * confirmed, an internal comment with the slot is added to the order for the Admin.
 * Errors are rethrown so Adobe I/O Events retries the delivery.
 */

import {
  addOrderComment,
  getCommerce,
} from "../../../common/slots/commerce.js";
import { withDb } from "../../../common/slots/db.js";
import { orderFromEvent } from "../../../common/slots/order.js";
import {
  applyOrderEvent,
  orderComment,
} from "../../../common/slots/reservations.js";
import { loadSettings } from "../../../common/slots/settings.js";

export function createOrderEvents(overrides = {}) {
  const deps = {
    addOrderComment,
    db: (params, fn) => withDb(params, fn),
    getCommerce,
    loadSettings,
    now: () => Date.now(),
    ...overrides,
  };

  return async (params = {}, logger = console) => {
    const order = orderFromEvent(params);
    if (!order.quoteId) {
      return { result: "none", status: "no-quote-id" };
    }
    const outcome = await deps.db(params, (client) =>
      applyOrderEvent(client, order, { now: deps.now() }),
    );
    const settings = await deps.loadSettings(logger);
    if (
      outcome.result === "confirmed" &&
      settings.orderComment &&
      order.orderId
    ) {
      try {
        await deps.addOrderComment(
          await deps.getCommerce(params),
          order.orderId,
          orderComment(outcome.reservation),
        );
      } catch (error) {
        // The booking is safe; a missing comment isn't worth a redelivery.
        logger.warn(
          `Couldn't comment on order ${order.orderId}: ${error.message}`,
        );
      }
    }
    logger.info(
      `Order ${order.incrementId ?? order.orderId} (${order.state || "?"}): ${outcome.result}`,
    );
    return { result: outcome.result };
  };
}
