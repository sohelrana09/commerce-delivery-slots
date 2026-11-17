import { defineConfig } from "@adobe/aio-commerce-lib-app/config";

// "before" order placement: the app checks and books the slot, or stops the order with a message.
const placeOrderWebhook = {
  batch_name: "delivery_slots",
  fallback_error_message:
    "We couldn't confirm your delivery slot. Please try again or contact the store.",
  fields: [
    { name: "order.quote_id" },
    { name: "order.shipping_method" },
    { name: "order.store_id" },
    { name: "order.increment_id" },
    { name: "order.custom_attributes" },
    { name: "order.extension_attributes" },
  ],
  hook_name: "delivery_slot_validation",
  method: "POST",
  required: true,
  soft_timeout: 1000,
  timeout: 5000,
  webhook_type: "before",
};

const slotFeeWebhook = {
  batch_name: "delivery_slots_fee",
  fallback_error_message:
    "We couldn't add the delivery slot fee. Please try again or contact the store.",
  fields: [{ name: "quote" }],
  hook_name: "delivery_slot_fee",
  method: "POST",
  soft_timeout: 1000,
  timeout: 5000,
  webhook_type: "after",
};

// The reservation is found by cart ID; the state tells a cancellation from any other save.
const orderEventFields = [
  { name: "entity_id" },
  { name: "increment_id" },
  { name: "quote_id" },
  { name: "state" },
  { name: "status" },
];

export default defineConfig({
  adminUi: {
    menu: {
      aclProtected: true,
      description:
        "Set up delivery and pickup calendars, time slots and capacity, and see bookings.",
      id: "delivery_slots",
      label: "Delivery Slots",
    },
  },

  businessConfig: {
    schema: [
      {
        default: true,
        label: "Offer delivery date and time slots at checkout",
        name: "slotsEnabled",
        type: "boolean",
      },
      {
        default: "20",
        label:
          "Minutes a chosen slot is held for the shopper before checkout (5 to 240)",
        name: "holdMinutes",
        type: "text",
      },
      {
        default: "30",
        label:
          "Seconds browsers and the CDN may cache slot availability (0 to 3600)",
        name: "cacheSeconds",
        type: "text",
      },
      {
        default: false,
        label: "Show shoppers how many places are left in each slot",
        name: "showRemaining",
        type: "boolean",
      },
      {
        default: true,
        label:
          "Allow orders when the slot check fails unexpectedly (a full slot still blocks the order)",
        name: "failOpen",
        type: "boolean",
      },
      {
        default: true,
        label: "Add the chosen slot to the order as an internal comment",
        name: "orderComment",
        type: "boolean",
      },
    ],
  },

  eventing: {
    commerce: [
      {
        events: [
          {
            description:
              "Confirms the delivery slot when an order is saved, and releases it when the order is cancelled.",
            fields: orderEventFields,
            label: "Order saved",
            name: "observer.sales_order_save_commit_after",
            runtimeActions: ["delivery-slots/order-events"],
          },
        ],
        provider: {
          description:
            "Order events used by Delivery Slots to confirm and release bookings.",
          label: "Delivery Slots",
        },
      },
    ],
  },

  installation: {
    customInstallationSteps: [
      {
        description:
          "Provision App Builder Database Storage and create the collections for profiles, slot capacity and reservations.",
        name: "Set up database",
        script: "./scripts/setup-database.js",
      },
    ],
    messages: {
      postInstallation:
        "Delivery Slots is installed. Open Delivery Slots in the Commerce Admin to set up your first delivery or pickup calendar, then add the checkout kit to your Edge Delivery Services storefront. No slots are offered until you enable a profile.",
      preInstallation:
        "Delivery Slots stores calendars and bookings in App Builder Database Storage. Make sure App Builder Data Services and Adobe Commerce eventing are added to your workspace.",
    },
  },

  metadata: {
    description:
      "Let shoppers pick a delivery or pickup date and time slot at checkout: working days, holidays, cut-offs, lead times, capacity per slot, slot fees, and rules per shipping method and store view.",
    displayName: "Delivery Slots",
    id: "delivery-slots",
    version: "0.1.0",
  },

  webhooks: [
    {
      category: "validation",
      description:
        "Checks and books the delivery slot before an order is placed (Adobe Commerce as a Cloud Service).",
      env: ["saas"],
      label: "Delivery slot check (SaaS)",
      requireAdobeAuth: true,
      runtimeAction: "delivery-slots/validate-order",
      webhook: {
        ...placeOrderWebhook,
        webhook_method: "plugin.sales.api.order_management.place",
      },
    },
    {
      category: "validation",
      description:
        "Checks and books the delivery slot before an order is placed (Adobe Commerce on cloud infrastructure and on-premises).",
      env: ["paas"],
      label: "Delivery slot check (PaaS)",
      requireAdobeAuth: true,
      runtimeAction: "delivery-slots/validate-order",
      webhook: {
        ...placeOrderWebhook,
        webhook_method: "plugin.magento.sales.api.order_management.place",
      },
    },
    {
      category: "modification",
      description:
        "Adds the chosen slot's fee to cart totals (Adobe Commerce as a Cloud Service).",
      env: ["saas"],
      label: "Delivery slot fee (SaaS)",
      requireAdobeAuth: true,
      runtimeAction: "delivery-slots/slot-fee",
      webhook: {
        ...slotFeeWebhook,
        webhook_method:
          "plugin.out_of_process_totals_collector.api.get_total_modifications.custom_fees",
      },
    },
    {
      category: "modification",
      description:
        "Adds the chosen slot's fee to cart totals (Adobe Commerce on cloud infrastructure and on-premises).",
      env: ["paas"],
      label: "Delivery slot fee (PaaS)",
      requireAdobeAuth: true,
      runtimeAction: "delivery-slots/slot-fee",
      webhook: {
        ...slotFeeWebhook,
        webhook_method:
          "plugin.magento.out_of_process_totals_collector.api.get_total_modifications.custom_fees",
      },
    },
  ],
});
