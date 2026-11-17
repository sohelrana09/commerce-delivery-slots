/**
 * Public web action for the storefront: holds or releases a slot for a cart. The masked cart ID
 * is the credential (see handler.js). Errors return a generic message; details go to the logs.
 */

import AioLogger from "@adobe/aio-lib-core-logging";

import { json, readBody } from "../../../common/http.js";
import { createHold } from "./handler.js";

const hold = createHold();

export async function main(params = {}) {
  const logger = AioLogger("delivery-slots-hold", {
    level: params.LOG_LEVEL || "info",
  });
  try {
    return await hold(readBody(params), params, logger);
  } catch (error) {
    logger.error(`hold failed: ${error.message}`);
    return json(500, { error: "Delivery slots are unavailable right now." });
  }
}
