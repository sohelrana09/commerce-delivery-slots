/**
 * Public web action for the storefront (no Adobe IMS login: shoppers call it from the browser).
 * It only returns which dates and slots are open. Errors return a generic message; details go to
 * the logs.
 */

import AioLogger from "@adobe/aio-lib-core-logging";

import { json } from "../../../common/http.js";
import { createAvailabilityFeed } from "./handler.js";

const feed = createAvailabilityFeed();

export async function main(params = {}) {
  const logger = AioLogger("delivery-slots-availability", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    return await feed(params, logger);
  } catch (error) {
    logger.error(`availability failed: ${error.message}`);
    return json(500, { error: "Delivery slots are unavailable right now." });
  }
}
