/** Runtime action for the order-saved Commerce event (see app.commerce.config.ts). */

import AioLogger from "@adobe/aio-lib-core-logging";

import { createOrderEvents } from "./handler.js";

const orderEvents = createOrderEvents();

export async function main(params = {}) {
  const logger = AioLogger("delivery-slots-order-events", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    return { body: await orderEvents(params, logger), statusCode: 200 };
  } catch (error) {
    logger.error(`order-events failed: ${error.message}`);
    // Failing the activation makes Adobe I/O Events retry the delivery.
    throw error;
  }
}
