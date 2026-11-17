/**
 * Turns the storefront's masked cart ID into the cart's internal (quote) ID, which the
 * place-order webhook and the order event carry.
 *
 * The storefront only knows the masked cart ID (the one GraphQL uses, for guest and signed-in
 * carts alike). `GET /V1/guest-carts/{maskedId}` returns the cart. The masked ID is a long
 * random token, so knowing it is what proves the caller owns the cart, as it is for Commerce's
 * own guest cart APIs.
 */

const MASKED_ID = /^[A-Za-z0-9_-]{16,64}$/u;

export class CartNotFoundError extends Error {
  // biome-ignore lint/style/useConsistentMemberAccessibility: plain JavaScript has no access modifiers
  constructor(message, options) {
    super(message ?? "Cart not found", options);
    this.name = "CartNotFoundError";
  }
}

export function isMaskedCartId(value) {
  return typeof value === "string" && MASKED_ID.test(value);
}

function isNotFound(error) {
  const status = error?.response?.status ?? error?.status;
  return status === 404 || status === 400;
}

/** `{ quoteId, storeId }` for an active cart, or a CartNotFoundError. */
export async function resolveCart(commerce, maskedId) {
  if (!isMaskedCartId(maskedId)) {
    throw new CartNotFoundError("Invalid cart ID");
  }
  let cart;
  try {
    cart = await commerce.get(`guest-carts/${maskedId}`).json();
  } catch (error) {
    if (isNotFound(error)) {
      throw new CartNotFoundError("Cart not found", { cause: error });
    }
    throw error;
  }
  if (!cart?.id || cart.is_active === false) {
    throw new CartNotFoundError("Cart not found or already ordered");
  }
  return { quoteId: String(cart.id), storeId: cart.store_id };
}
