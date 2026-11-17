/**
 * Totals-collector custom fees webhook (see app.commerce.config.ts). Never blocks a cart: any
 * error is logged and answered with no fee.
 */

import {
  ok,
  replaceOperation,
  successOperation,
} from "@adobe/aio-commerce-sdk/webhooks/responses";
import AioLogger from "@adobe/aio-lib-core-logging";

import { createSlotFee } from "./handler.js";

const slotFee = createSlotFee();

export async function main(params = {}) {
  const logger = AioLogger("delivery-slots-slot-fee", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    const fees = await slotFee(params, logger);
    return fees.length
      ? ok([replaceOperation("result/fees", fees)])
      : ok([successOperation()]);
  } catch (error) {
    logger.error(`slot-fee failed, charging no slot fee: ${error.message}`);
    return ok([successOperation()]);
  }
}
