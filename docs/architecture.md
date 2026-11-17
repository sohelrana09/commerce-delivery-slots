# Architecture

```text
 Commerce Admin                     App Builder (I/O Runtime)                       Storefront (EDS checkout)
 ┌──────────────────────┐ IMS auth  ┌──────────────────────────────────┐            ┌────────────────────────────┐
 │ Delivery Slots page  ├──────────►│ DeliverySlotsAdmin/*             │            │ delivery-slots.js          │
 │ profiles, preview,   │           │ profiles-list, profile-save,     │            │  mountDeliverySlots()      │
 │ bookings, release    │           │ profile-delete, bookings,        │            │  follows checkout/updated  │
 └──────────────────────┘           │ booking-release, lookups         │            └──┬───────────┬─────────┬───┘
                                    └───────────────┬──────────────────┘               │ GET       │ POST    │ GraphQL
                                                    │                                  ▼           ▼         ▼
                                    ┌───────────────▼──────────────────┐     availability       hold    setCustomAttributesOnCart
 Commerce                           │ App Builder Database Storage     │◄────(public,        (public,        │
 ┌──────────────────────┐           │  slot_profiles                   │      cached)         cart ID)       │
 │ place order ─────────┼─webhook──►│  slot_usage   (one counter per   │                                     ▼
 │  validate-order      │           │                slot and date)    │                             cart custom attributes
 │ totals ──────────────┼─webhook──►│  slot_reservations (one per cart)│                             copied to the order
 │  slot-fee            │           │                                  │
 │ order saved ─────────┼─event────►│ order-events: confirm / release  │
 └──────────────────────┘           │ cleanup (every 10 min): expire   │
                                    └──────────────────────────────────┘

 delivery-slots-engine.js: one module, imported by the kit, the Admin page and every action
```

## The checkout flow

1. **Availability.** The kit reads the cart's shipping method from the checkout drop-in's `checkout/updated` event and calls `availability?method=…&store=…`. The action picks the matching profile (`selectProfile`), reads the slot counters for the date range, and answers with every date from today to `maxDaysAhead`: open or closed with a reason, and each slot's times, fee and whether it's free. The answer is the same for every shopper, so it's cacheable for a few seconds.
2. **Hold.** When the shopper picks a slot, the kit posts the masked cart ID, the date, the slot and the method to `hold`. The action resolves the cart through Commerce REST (an unknown or inactive cart is rejected), checks the slot with the engine, takes a place with the counter's conditional increment, and stores a `hold` reservation for the cart that expires after **Hold minutes**. Picking another slot swaps the reservation and gives the old place back; changing to a method without slots releases it.
3. **Save on the cart.** Before placing the order, the kit calls `setCustomAttributesOnCart` with `delivery_date`, `delivery_slot` and `delivery_profile`. Commerce copies cart custom attributes to the order, where they show in the Admin's order view.
4. **Place order.** The `before` place-order webhook (`validate-order`) reads the order's custom attributes and quote ID:
   - with a live hold for the same slot, it moves the reservation to `pending`, even if the cut-off passed while the shopper paid;
   - with no hold, or a different slot, it checks the slot now and takes a place;
   - with no slot on a profile that requires one, or a slot that is full, past the cut-off or closed, it answers with an exception, and Commerce stops the order and shows the message.
5. **Order saved.** `observer.sales_order_save_commit_after` (`order-events`) moves the reservation to `confirmed` and records the order number, and adds an order comment the first time. An order whose state is `canceled` or `closed` moves it to `cancelled` and gives the place back.
6. **Clean-up.** Every 10 minutes, `cleanup` expires holds past their time and `pending` reservations whose order never arrived (after 60 minutes), and gives their places back.

The slot's **fee** is added by the totals-collector webhook (`slot-fee`): whenever Commerce collects totals for a cart that holds a slot with a fee, it answers with one custom fee line, `delivery_slot`.

## Capacity

Each slot on each date has one counter document in `slot_usage`, keyed `profile|date|slot`, with `booked`. A place is taken with one operation:

```js
updateOne({ key, booked: { $lt: capacity } }, { $inc: { booked: 1 } })
```

It matches only while there's room, and a single-document update is atomic, so two shoppers can't both take the last place. The counter is created on first use with an upsert (`$setOnInsert`); two requests racing to create it are safe, because the key is unique and the duplicate-key error is ignored. A place is given back with `{ key, booked: { $gt: 0 } }` and `$inc: -1`, so the counter never goes negative.

Capacity is read when the slot is booked, so lowering a slot's capacity never cancels existing bookings; it only stops new ones until enough are released.

## Reservations

One document per cart (quote) in `slot_reservations`, unique on `quoteId`:

| Status | Counts towards capacity | Moves to |
|---|---|---|
| `hold` | Yes | `pending` (order placed), `expired`, or replaced by another slot |
| `pending` | Yes | `confirmed` (order saved), `expired` (no order after 60 minutes) |
| `confirmed` | Yes | `cancelled` (order cancelled), `released` (by an admin) |
| `cancelled`, `expired`, `released` | No | `confirmed` again if an order event arrives for an expired one |

Every change is a find-and-modify filtered on the current status. A retried webhook or a redelivered event finds nothing to change and does nothing, so a place is never counted or released twice.

## Time zones

Each profile has an IANA time zone. The engine works out "today" and the time of day in that zone with `Intl.DateTimeFormat`, does date arithmetic on plain `YYYY-MM-DD` dates in UTC, and converts each slot's local start and end to exact instants (`startsAt`, `endsAt`). On a spring-forward day, a local time in the gap moves forward to the first valid time; in the autumn overlap, the first occurrence is used. Lead times and the "past" check compare instants, so they're right on daylight saving days, and the server's or shopper's own zone never matters.

## One engine

`storefront/scripts/delivery-slots-engine.js` is plain ES2022 with no imports. The actions and the Admin page import it as `#engine` (a `package.json` subpath import), and the kit imports it as a sibling file. So the Admin preview, the storefront and the webhook always agree on what's available.

## Safety

- The public `availability` feed returns only what a shopper sees: dates, slot times, labels and fees, and places left only if the merchant shows them. Never bookings, carts or orders.
- `hold` needs the masked ID of an active cart, checked against Commerce, and one cart holds at most one place.
- The webhooks and the event action need an IMS token (`require-adobe-auth`). Setting `WEBHOOK_PUBLIC_KEY` also checks Commerce's webhook signature.
- The Admin actions need the Admin's IMS token; the Admin page is behind the app's ACL resource.
- Slot labels and reasons are rendered as text (`textContent`), never HTML.
- Errors are logged on the server with details and answered with generic messages.
