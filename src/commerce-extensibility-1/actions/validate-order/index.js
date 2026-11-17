/**
 * Place-order webhook (see app.commerce.config.ts): validates and books the delivery slot.
 * Runs with `require-adobe-auth: true`; App Management registers it, so only Commerce can call it.
 * It is a raw-http action, so the signed body arrives intact in `__ow_body` (see signature.js).
 */

import { successOperation } from "@adobe/aio-commerce-sdk/webhooks/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { createValidateOrder } from "./handler.js";

const validateOrder = createValidateOrder();

function respond(operation) {
  return { body: operation, statusCode: 200 };
}

export async function main(params = {}) {
  const logger = AioLogger("delivery-slots-validate-order", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    return respond(await validateOrder(params, logger));
  } catch (error) {
    // Settings or signature failures: never block a sale on the app's own bug.
    logger.error(`validate-order failed: ${error.message}`);
    return respond(successOperation());
  }
}
