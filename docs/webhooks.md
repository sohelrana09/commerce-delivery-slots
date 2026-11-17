# Webhooks and events

Delivery Slots talks to Commerce in four ways. App Management registers all of them when you install the app, from [`app.commerce.config.ts`](../app.commerce.config.ts), with the SaaS and PaaS method names.

| What | Commerce calls | Action | Does |
|---|---|---|---|
| Place-order check | `plugin.sales.api.order_management.place` (SaaS), `plugin.magento.sales.api.order_management.place` (PaaS), `before`, required | `delivery-slots/validate-order` | Checks the order's slot and books it, or stops the order with a message. |
| Slot fee | `plugin.out_of_process_totals_collector.api.get_total_modifications.custom_fees` (SaaS), `plugin.magento.out_of_process_totals_collector.api.get_total_modifications.custom_fees` (PaaS), `after` | `delivery-slots/slot-fee` | Adds the held slot's fee to the cart totals. |
| Order saved | the `observer.sales_order_save_commit_after` event | `delivery-slots/order-events` | Confirms the booking and adds an order comment, or releases the place when the order is cancelled. |
| Sweep | an I/O Runtime alarm, every 10 minutes | `delivery-slots/cleanup` | Expires holds and pending bookings whose time ran out. |

The storefront calls two public actions, `availability` and `hold`; they are described in the [storefront guide](../storefront/README.md).

## Place-order check

Commerce sends the order before it is saved, with these fields:

```text
order.quote_id, order.shipping_method, order.store_id, order.increment_id,
order.custom_attributes, order.extension_attributes
```

The action:

1. Verifies the signature, when `WEBHOOK_PUBLIC_KEY` is set (see [Signatures](#signatures)).
2. Does nothing when **Offer delivery date and time slots at checkout** is off.
3. Reads the slot from the order's custom attributes `delivery_date`, `delivery_slot` and `delivery_profile`, which the storefront kit saved on the cart. Without them, it uses the cart's hold.
4. Picks the profile: the one named in `delivery_profile` if it is still enabled, otherwise the best match for the shipping method and store view. No profile: the order goes through.
5. If the cart holds this slot, the hold becomes a pending booking, even if the cut-off has passed since: the shopper took it in time. Otherwise the slot is checked now (cut-offs, lead time, holidays, capacity) and a place is taken.
6. Answers `{"op": "success"}`, or `{"op": "exception", "message": "..."}` with a message the shopper sees, such as "That time slot has just filled up. Please choose another."

A pending booking lasts 60 minutes. The order event turns it into a confirmed one; if no event arrives, the sweep gives the place back.

### Failure policy

| Situation | Result |
|---|---|
| A required slot wasn't chosen, the slot is full, its cut-off passed, the date is closed | The order is stopped with the reason. Always. |
| The app's own check fails (database outage, bad profile JSON) | The order goes through and the error is logged, unless **Allow orders when the slot check fails unexpectedly** is off. The place held at checkout is still confirmed by the order event. |
| The action can't be reached at all (I/O Runtime down, timeout after 5 seconds) | Commerce stops the order with the webhook's `fallback_error_message`, because the webhook is registered with `required: true`. |
| The signature is set and doesn't verify | The order is stopped with "We couldn't confirm your delivery slot. Please try again." |

To let orders through when App Builder can't be reached, set `required: false` on `placeOrderWebhook` in `app.commerce.config.ts` and update the app in App Management. Orders placed then have no booking until the order event confirms the shopper's hold.

## Slot fee

The custom-fees webhook of the out-of-process totals collector receives the `quote` and answers with fee lines. When the cart has a held, pending or confirmed booking with a fee, it answers one line:

```json
[{ "code": "delivery_slot", "label": "Delivery slot: Evening", "base_fee": 3.5 }]
```

Otherwise it answers `[]`. It never stops a cart: an error answers no fee.

## Order saved

The event carries `entity_id`, `increment_id`, `quote_id`, `state` and `status`. The action finds the booking by `quote_id` and:

- on state `canceled` or `closed`, marks it cancelled and gives the place back;
- otherwise, confirms a hold or pending booking, and adds an internal order comment such as "Delivery slot: Wed 18 Nov 2026, 17:00–21:00 (Evening)" when **Add the chosen slot to the order as an internal comment** is on;
- confirms an expired booking too, because the order exists, even if the slot filled up meanwhile.

Every change is filtered on the booking's current state, so a redelivered event does nothing twice. Errors are rethrown, so Adobe I/O Events retries the delivery.

## Signatures

All three Commerce calls use `require-adobe-auth`, so only callers with an Adobe IMS token from your organization reach them. You can also check Commerce's own webhook signature on the place-order call:

1. In the Commerce Admin, open **Stores → Settings → Configuration → Adobe Services → Webhooks**, turn on **Digital Signature Configuration** and choose **Regenerate Key Pair**.
2. Put the public key in `.env`, on one line with `\n` for the line breaks, or as the bare base64 body:

   ```bash
   WEBHOOK_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMIIBIjAN...\n-----END PUBLIC KEY-----"
   ```

3. Run `aio app deploy`.

`validate-order` is a `raw-http` action, so it receives the exact bytes Commerce signed in `__ow_body` and checks the base64 RSA-SHA256 signature in `x-adobe-commerce-webhook-signature` against them. With the key set, an unsigned or wrongly signed request is refused.

## What needs a live instance

There was no Commerce instance to test on while the app was built. These points follow Adobe's documentation and starter kits, and are covered by unit tests with the payload shapes below, but still need checking on a Stage instance:

| Question | What the app does | How to check | If it's different |
|---|---|---|---|
| Do the cart's custom attributes reach the place-order payload, and where? | Reads `order.custom_attributes` as a list or a map, `custom_attributes_serializable` as JSON, and `extension_attributes.custom_attributes`. Falls back to the cart's hold. | Set `LOG_LEVEL=debug`, place an order with a slot, and read `aio app logs` for `validate-order`. | Add the path to `readCustomAttributes` in `src/common/slots/order.js`, with a test. |
| Does `observer.sales_order_save_commit_after` carry `state`, so a cancellation releases the place? | Reads `data.value.state`, `value.state` or `state`. | Cancel a test order and look for "cancelled" in the `order-events` logs, and on the Bookings page. | Change `orderFromEvent` in `src/common/slots/order.js`, or subscribe to a cancel event as well. |
| Does the slot fee sit well next to other apps that add custom fees (such as Extra Fees)? | Answers its own fee line with the code `delivery_slot`. | Install both and check the cart totals show both lines. | Rename `FEE_CODE` in `actions/slot-fee/handler.js` if codes clash. |
| Does `require-adobe-auth` together with `raw-http` pass Commerce's IMS token through? | Expects App Management's IMS check and the raw body together, as Checkout Fields does. | Place an order with `WEBHOOK_PUBLIC_KEY` set; a 401 in the logs means the token isn't accepted. | Register the webhook with `requireAdobeAuth: false` and rely on the signature. |
| Does App Builder Database Storage keep the conditional increment and unique indexes atomic under real load? | Takes a place with one `findOneAndUpdate` filtered on `count < capacity`. | Book the last place of a slot from two browsers at once: one gets "full". | Report it as an issue. |
| Does `GET /V1/guest-carts/{maskedId}` answer for signed-in shoppers' masked IDs? | `hold` uses it to turn the masked cart ID into the quote ID. | Hold a slot while signed in and check the booking's cart ID on the Bookings page. | Resolve the cart through GraphQL `cart(cart_id)` instead in `src/common/slots/cart.js`. |
