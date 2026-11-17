/** The Commerce REST client, with the action's IMS credentials. */

import { getCommerceClient } from "@adobe/aio-commerce-lib-app";
import { resolveImsAuthParams } from "@adobe/aio-commerce-lib-auth";

export function getCommerce(params) {
  return getCommerceClient(resolveImsAuthParams(params));
}

/** Adds an internal comment to an order (Admin order view, Comments History). */
export async function addOrderComment(commerce, orderId, comment) {
  await commerce
    .post(`orders/${orderId}/comments`, {
      json: {
        statusHistory: {
          comment,
          is_customer_notified: 0,
          is_visible_on_front: 0,
        },
      },
    })
    .json();
}
