/**
 * Reads what the app needs from Commerce payloads: the place-order webhook, the order-saved
 * event and the totals-collector webhook. Field paths differ between SaaS and PaaS and between
 * plugin and observer payloads, so each reader tries the known shapes.
 */

/** The custom attribute codes the storefront kit writes with setCustomAttributesOnCart. */
export const ATTRIBUTES = {
  date: "delivery_date",
  profile: "delivery_profile",
  slot: "delivery_slot",
};

function firstDefined(...values) {
  return values.find(
    (value) => value !== undefined && value !== null && value !== "",
  );
}

/**
 * Custom attributes as a { code: value } map. Commerce sends them as a list of
 * { attribute_code, value }, as a map, or as a JSON string (`custom_attributes_serializable`).
 */
export function readCustomAttributes(order = {}) {
  let raw = firstDefined(
    order.custom_attributes,
    order.custom_attributes_serializable,
    order.extension_attributes?.custom_attributes,
  );
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (Array.isArray(raw)) {
    return Object.fromEntries(
      raw
        .filter((entry) => entry && typeof entry.attribute_code === "string")
        .map((entry) => [entry.attribute_code, entry.value]),
    );
  }
  return raw && typeof raw === "object" ? { ...raw } : {};
}

function selectionFrom(attributes) {
  const date = attributes[ATTRIBUTES.date];
  const slot = attributes[ATTRIBUTES.slot];
  if (!(date && slot)) {
    return null;
  }
  return {
    date: String(date),
    profile: attributes[ATTRIBUTES.profile]
      ? String(attributes[ATTRIBUTES.profile])
      : undefined,
    slot: String(slot),
  };
}

/** The order in a place-order webhook payload (plugin or observer). */
export function orderFromWebhook(params = {}) {
  const order = firstDefined(
    params.order,
    params.data?.order,
    params.result,
    {},
  );
  const attributes = {
    ...readCustomAttributes(order),
    ...readCustomAttributes(params),
  };
  return {
    quoteId: firstDefined(
      order.quote_id,
      params.quote_id,
      params.quote?.entity_id,
    )?.toString(),
    selection: selectionFrom(attributes),
    shippingMethod: String(
      firstDefined(
        order.shipping_method,
        order.extension_attributes?.shipping_assignments?.[0]?.shipping?.method,
        params.shipping_method,
        "",
      ),
    ),
    storeView: firstDefined(order.store_code, params.store_code) ?? "",
  };
}

/** The order in an order-saved event (`observer.sales_order_save_commit_after`). */
export function orderFromEvent(params = {}) {
  const value = firstDefined(
    params.data?.value,
    params.value,
    params.data,
    params,
  );
  return {
    incrementId: value.increment_id ? String(value.increment_id) : undefined,
    orderId: firstDefined(value.entity_id, value.id)?.toString(),
    quoteId: value.quote_id ? String(value.quote_id) : undefined,
    state: String(value.state ?? "").toLowerCase(),
  };
}

/** The cart ID in a totals-collector webhook payload. */
export function quoteIdFromTotals(params = {}) {
  return firstDefined(
    params.quote?.entity_id,
    params.quote?.id,
    params.data?.quote?.entity_id,
  )?.toString();
}
