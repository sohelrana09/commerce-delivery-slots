# Storefront kit: Edge Delivery Services checkout

The kit adds a delivery or pickup date and time picker to the `commerce-checkout` block of an Edge Delivery Services storefront (the [AEM boilerplate with Commerce drop-ins](https://github.com/hlxsites/aem-boilerplate-commerce), checkout drop-in 3.x). It has no dependencies and no build step.

| File | What it does |
|---|---|
| `scripts/delivery-slots-engine.js` | The calendar engine. The same file runs in the App Builder actions, so the dates the picker shows are the dates the server accepts. |
| `scripts/delivery-slots.js` | Loads availability for the cart's shipping method, draws the picker, holds the chosen slot, checks it before **Place order** and saves it on the cart. |
| `styles/delivery-slots.css` | Picker layout, using the drop-in design tokens (`--color-*`, `--spacing-*`, `--type-*`) with fallbacks. |

The picker follows the cart through the drop-in event bus: it appears when the selected shipping method has a profile, and disappears when it hasn't. It takes about 25 lines.

## 1. Copy the files

```text
storefront/scripts/delivery-slots-engine.js  →  scripts/delivery-slots-engine.js
storefront/scripts/delivery-slots.js         →  scripts/delivery-slots.js
storefront/styles/delivery-slots.css         →  styles/delivery-slots.css
```

The `.d.ts` file is only for this repository's type check; storefronts don't need it. The scripts follow the boilerplate's ESLint (Airbnb) and Stylelint rules.

## 2. Configure the action URLs

Add the two URLs that `aio app deploy` printed to your storefront configuration (`config.json`, or the configuration service), for example:

```json
"commerce-delivery-slots-availability": "https://<namespace>.adobeio-static.net/api/v1/web/delivery-slots/availability",
"commerce-delivery-slots-hold": "https://<namespace>.adobeio-static.net/api/v1/web/delivery-slots/hold"
```

Without an availability URL, don't mount the picker: checkout then works as before.

## 3. Add a container to the checkout layout

In `blocks/commerce-checkout/fragments.js`, add a container right after the shipping methods, and its selector:

```js
// selectors.checkout
deliverySlots: '.checkout__delivery-slots',
```

```html
<div class="checkout__delivery ${CHECKOUT_BLOCK}"></div>
<div class="checkout__delivery-slots ${CHECKOUT_BLOCK}"></div>
<div class="checkout__payment-methods ${CHECKOUT_BLOCK}"></div>
```

## 4. Mount, check and save the slot

In `blocks/commerce-checkout/commerce-checkout.js`:

```js
import { events } from '@dropins/tools/event-bus.js';
import { fetchGraphQl } from '@dropins/storefront-checkout/api.js';
import { getConfigValue, getHeaders } from '@dropins/tools/lib/aem/configs.js';
import { mountDeliverySlots } from '../../scripts/delivery-slots.js';
import { loadCSS } from '../../scripts/aem.js';

// in decorate(), once the layout is in place
loadCSS(`${window.hlx.codeBasePath}/styles/delivery-slots.css`);
const availabilityEndpoint = getConfigValue('commerce-delivery-slots-availability');
const deliverySlots = availabilityEndpoint
  ? mountDeliverySlots(getElement(selectors.checkout.deliverySlots), {
    availabilityEndpoint,
    holdEndpoint: getConfigValue('commerce-delivery-slots-hold'),
    storeView: getHeaders('cs')?.['Magento-Store-View-Code'],
    currency: 'GBP', // the store's currency, for slot fees
    events,
    graphql: fetchGraphQl,
  })
  : null;
```

Add the picker's check to `handleValidation`, and save the slot on the cart right before the order is placed:

```js
const handleValidation = () => validateForms([
  // ...the existing forms
]) && (deliverySlots?.validate() ?? true);

const handlePlaceOrder = async ({ cartId, code }) => {
  await displayOverlaySpinner(loaderRef, $loader, $loaderStatus);
  try {
    // ...the existing Payment Services code
    await deliverySlots?.saveToCart(cartId);
    await orderApi.placeOrder(cartId);
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    removeOverlaySpinner(loaderRef, $loader, $loaderStatus);
  }
};
```

`validate()` returns `false` when the profile requires a slot and none is chosen: it shows a message, moves focus to the first free time and scrolls the picker into view. `saveToCart(cartId)` sends `delivery_date`, `delivery_slot` and `delivery_profile` with `setCustomAttributesOnCart`, so Commerce copies them to the order. It returns `false` and logs a warning instead of throwing: the cart's hold still lets the place-order check book the slot.

## Options

`mountDeliverySlots(container, options)` returns a controller.

| Option | Default | What it does |
|---|---|---|
| `availabilityEndpoint` | required | URL of the `delivery-slots/availability` action. |
| `holdEndpoint` | none | URL of the `delivery-slots/hold` action. Without it, choices aren't held and are only checked when the order is placed. |
| `storeView` | `''` | Store view code, sent to both actions. |
| `locale` | `<html lang>` | Locale for dates, times and prices. |
| `currency` | none | Currency code for slot fees, for example `'GBP'`. Without it, fees show as plain numbers. |
| `events` | none | The drop-in event bus. The picker then follows `checkout/initialized`, `checkout/updated` and `checkout/values`. Without it, call `update()` yourself. |
| `graphql` | none | `(query, { variables }) => Promise`, for `saveToCart`. Use the checkout drop-in's `fetchGraphQl`. |
| `onChange` | none | Called with the selection, or `null`, when it changes. |
| `maxDates` | `14` | Dates shown before **Show later dates**. |
| `text` | `DEFAULT_TEXT` | Replaces any of the picker's strings, for translations. `{when}`, `{minutes}`, `{count}`, `{fee}`, `{date}` and `{zone}` are filled in. |

| Controller method | What it does |
|---|---|
| `update(cartOrInput)` | Follows a checkout drop-in Cart, or `{ cartId, shippingMethod }`. Reloads when the shipping method changes, and lets go of the old hold. |
| `refresh()` | Reloads availability, for example after a long pause. |
| `getSelection()` | `{ date, slot, profile, held }`, or `null`. |
| `validate()` | For `handleValidation`, see above. |
| `saveToCart(cartId)` | For `handlePlaceOrder`, see above. |
| `destroy()` | Removes the picker and its event listeners. |

The module also exports `ATTRIBUTES`, `DEFAULT_TEXT`, `SET_ATTRIBUTES_MUTATION`, `selectionAttributes`, `shippingMethodCode` and `methodFromCart`, for storefronts that build their own picker.

## Behaviour

- **Holds:** picking a time posts the masked cart ID with the date and slot to `hold`. The slot is checked and held for the cart for **Minutes a chosen slot is held** (20 by default). One cart holds one place; picking another time moves the hold. If the slot has gone, the picker says why and reloads.
- **Time zones:** times are the store's local times. When the shopper's browser is in a different zone, the picker says so.
- **Failures:** if availability can't be loaded, the picker shows a message with **Try again**, and checkout carries on; the place-order check still applies.
- **Accessibility:** dates and times are two native radio groups in `fieldset`s with legends, so they work with Tab, the arrow keys and Space, and with screen readers. Unavailable dates and times stay in the list, disabled, with the reason as text. Status changes go to a polite live region, and errors to an alert linked with `aria-describedby`.
- **Security:** labels, reasons and messages are set with `textContent`, never as HTML. The kit sends only the masked cart ID, the shipping method, the store view and the chosen slot.

## Styling

`delivery-slots.css` uses the drop-in tokens, so the picker matches the rest of checkout. The root is `section.delivery-slots`; dates and times are the fieldsets `.delivery-slots__dates` and `.delivery-slots__slots`, and each choice is a `label.delivery-slots__date` or `label.delivery-slots__slot` around its radio button, so you can restyle them, for example:

```css
.delivery-slots__slot:has(input:checked) { border-color: var(--color-brand-500); }
```

## Other storefronts

The actions are plain HTTP, so any storefront can use them:

```text
GET  .../delivery-slots/availability?method=flatrate_flatrate&store=default
POST .../delivery-slots/hold  { "cartId": "<masked cart ID>", "date": "2026-11-18", "slot": "evening",
                                "shippingMethod": "flatrate_flatrate", "store": "default" }
POST .../delivery-slots/hold  { "cartId": "<masked cart ID>", "release": true }
```

Then save `delivery_date`, `delivery_slot` and `delivery_profile` on the cart with `setCustomAttributesOnCart` before placing the order. The engine (`delivery-slots-engine.js`) has no dependencies if you want to draw the calendar yourself.

## Trying it

`npm run demo` in this repository runs the kit in a mock checkout at http://localhost:4371, with an in-browser backend running the same engine.
