# Installation

Delivery Slots is an App Builder app. You deploy it to an App Builder workspace, install it on a Commerce instance through App Management (which sets up the Admin menu, the settings, the place-order and slot-fee webhooks, the order event and the database), then add the checkout kit to your Edge Delivery Services storefront.

## Requirements

- **Commerce:** Adobe Commerce as a Cloud Service, or Adobe Commerce 2.4.7+ on cloud infrastructure or on-premises with the out-of-process extensibility modules: Adobe Commerce Webhooks, Adobe I/O Events for Adobe Commerce, the out-of-process totals collector (for slot fees), `magento/out-of-process-custom-attributes` (custom attributes on carts and orders) and the Admin UI SDK.
- **Storefront:** Edge Delivery Services with the Commerce checkout drop-in. Any other storefront can call the actions directly, see the [storefront guide](../storefront/README.md#other-storefronts).
- **App Builder:** a project in the **same Adobe organization** as the Commerce instance. App Management only lists apps from the instance's own organization.
- **Tools:** Node.js 24 (`.nvmrc`) and the Adobe I/O CLI: `npm install -g @adobe/aio-cli`.

## App Builder project

In the [Adobe Developer Console](https://developer.adobe.com/console), create a project from the **App Builder** template. In each workspace you deploy to (for example Stage and Production), add:

| Service | Why |
|---|---|
| I/O Management API | App Management. |
| Adobe I/O Events for Adobe Commerce | The order saved event. |
| App Builder Data Services | App Builder Database Storage for profiles, capacity counters and bookings. |
| OAuth Server-to-Server credential | Commerce REST (carts, order comments, store views) and database access. |

`install.yaml` lists the same APIs for the Adobe Commerce Marketplace.

## Deploy

```bash
git clone https://github.com/sohelrana09/commerce-delivery-slots.git
cd commerce-delivery-slots
npm install

aio login
aio console org select
aio console project select
aio console workspace select
aio app use --merge
cp env.dist .env

aio app deploy
```

`aio app deploy` prints the URL of each web action. Keep the ones for `delivery-slots/availability` and `delivery-slots/hold`: the storefront needs them. The deploy also creates the `delivery-slots-sweep` alarm that expires old holds every 10 minutes.

## Install in Commerce

1. In the Commerce Admin, open **Apps → App Management**, find **Delivery Slots** and choose **Install**. The install step creates the `slot_profiles`, `slot_usage` and `slot_reservations` collections and their indexes, and App Management registers the webhooks, the order event and the Admin menu.
2. Give the **Delivery Slots** ACL resource to the admin roles that should manage slots (**System → Permissions → User Roles**).
3. Optional: **Configure** the app to change the settings (see the [README](../README.md#configuration)).
4. Open **Delivery Slots** in the Admin menu, start from an example or a blank profile, set the shipping methods it applies to, check the **Preview** tab, and switch it on.

## Verify webhook signatures (recommended)

Set `WEBHOOK_PUBLIC_KEY` to Commerce's webhook public key and deploy again; the place-order check then refuses requests without a valid signature. [docs/webhooks.md](webhooks.md#signatures) has the steps.

## Storefront

Follow the [storefront guide](../storefront/README.md): copy three files, add the two action URLs to your configuration, and add a few lines to the `commerce-checkout` block. Test it on a branch preview before merging.

## Checking it works

1. Enable the **Home delivery** example for `flatrate_flatrate`, with the slot required.
2. Open the availability URL with `?method=flatrate_flatrate&store=default`: the feed lists dates and slots.
3. On the branch preview, start a checkout with Flat Rate. The picker shows dates and times; pick one and it says it is held for you.
4. In the Admin, **Delivery Slots → Bookings** shows the hold against the cart.
5. Leave the slot empty and press **Place order**: the picker asks for a date and time and the order isn't placed.
6. Place the order with a slot. The booking turns **Confirmed** with the order number, and the order has a "Delivery slot: ..." comment and the `delivery_date` and `delivery_slot` custom attributes.
7. Cancel the order: the booking turns **Cancelled** and the place is free again.
8. To check the server side, place an order through GraphQL without the custom attributes and without a hold: Commerce refuses it with "Please choose a delivery date and time slot."

## Troubleshooting

| Symptom | Check |
|---|---|
| No picker at checkout | The browser console and network tab for the availability call; the endpoints in the storefront config; **Offer delivery date and time slots** is on; a profile is enabled and matches the cart's shipping method and store view. The feed is cached for **Cache seconds**. |
| Picker shows "We couldn't load delivery times" | The availability URL is reachable from the browser (CORS errors usually mean a wrong URL); `aio app logs` for `availability`. |
| Picking a time says it will be confirmed later, instead of held | The kit has no `holdEndpoint`, or no cart ID yet; `hold` answered 404 (`aio app logs`): the OAuth credential can't read carts. |
| Orders aren't checked | The webhook is registered (**System → Webhooks**, or `aio app logs` for `validate-order`); the app is switched on. |
| Every order is stopped with "We couldn't confirm your delivery slot" | `WEBHOOK_PUBLIC_KEY` doesn't match the key Commerce signs with. Copy it again, or remove it and redeploy to confirm. |
| Bookings stay **Pending** | The order event isn't arriving: check the event registration in the Developer Console and `aio app logs` for `order-events`. The sweep frees pending places after 60 minutes. |
| No slot fee in the totals | The slot has a fee; the totals collector webhook is registered; the cart's hold exists (the Bookings page). |
| No order comment | **Add the chosen slot to the order as an internal comment** is on; the OAuth credential can write order comments. |

## Updating

Pull the new version, run `npm install` and `aio app deploy`. When the CHANGELOG says the app configuration changed (menu, webhooks, event, settings), update the app in App Management.

## Uninstalling

Uninstall the app in **Apps → App Management**. Orders keep their custom attributes and comments; the profiles and bookings go with the app's database. Remove the checkout kit from the storefront first, or it shows a retry message.
