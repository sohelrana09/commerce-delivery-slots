# Changelog

## v0.1.0 (2026-11-17)

The first release: delivery and pickup date and time slots at checkout for Adobe Commerce as a Cloud Service and PaaS, built as an App Builder app.

- **Calendar engine:** one dependency-free module (`storefront/scripts/delivery-slots-engine.js`) shared by the checkout kit, the Admin preview and the actions. Working days, holidays (one date or every year), blackout periods, date overrides (close a date, open a Sunday, change a slot's capacity), lead time, same-day and next-day cut-offs, and how far ahead shoppers can book, all in the profile's time zone and correct across daylight saving changes ([docs/profiles.md](docs/profiles.md)).
- **Profiles:** one calendar per shipping method (exact, `carrier_*` or carrier) and store view, with a priority, delivery or pickup wording, and whether a slot is required.
- **Capacity:** one counter per slot and date, taken with a single conditional increment, so a slot is never overbooked. Holds, pending and confirmed bookings count; cancelled, expired and released ones give the place back.
- **Checkout flow:** the public `availability` feed and `hold` action for the storefront; the place-order webhook checks and books the slot or stops the order with a clear message; the totals webhook adds the slot's fee as a custom fee; the order saved event confirms the booking, adds an order comment and releases the place when an order is cancelled; a sweep every 10 minutes expires old holds ([docs/webhooks.md](docs/webhooks.md)).
- **Admin page:** profiles with a tabbed editor and a preview of what shoppers are offered at any moment, and a bookings view with capacity per slot and a release action (Admin UI SDK, React Spectrum 2).
- **Settings:** a master switch, hold minutes, the feed's cache time, places left, fail open or closed, and the order comment, in App Management.
- **Profiles in code:** `SLOT_PROFILES` serves profiles from `.env` instead of the database.
- **Webhook signatures:** optional RSA-SHA256 check with `WEBHOOK_PUBLIC_KEY`, on top of the IMS token.
- **Checkout kit:** `mountDeliverySlots` for the Edge Delivery Services checkout drop-in: an accessible date and slot picker that follows the cart's shipping method, holds the slot, validates before placing the order and saves the choice as cart custom attributes ([storefront/README.md](storefront/README.md)).
- **Local previews:** `npm run demo` (a mock checkout) and `npm run admin:preview` (the Admin page with an in-browser store), no Adobe account needed.
