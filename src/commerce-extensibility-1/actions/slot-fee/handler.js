/**
 * Custom fees webhook for the out-of-process totals collector: adds the fee of the cart's held
 * slot (for example an evening or Saturday surcharge) to the cart totals, as one fee line.
 * Answers with no fee when the cart has no counted reservation or the slot is free.
 */

import { withDb } from "../../../common/slots/db.js";
import { quoteIdFromTotals } from "../../../common/slots/order.js";
import {
  COUNTED,
  findReservation,
} from "../../../common/slots/reservations.js";
import { loadSettings } from "../../../common/slots/settings.js";

export const FEE_CODE = "delivery_slot";

export function createSlotFee(overrides = {}) {
  const deps = {
    findReservation: (params, quoteId) =>
      withDb(params, (client) => findReservation(client, quoteId)),
    loadSettings,
    ...overrides,
  };

  /** The fee lines for a totals-collector payload: [] or one { code, label, base_fee }. */
  return async (params = {}, logger = console) => {
    const quoteId = quoteIdFromTotals(params);
    if (!quoteId) {
      return [];
    }
    const settings = await deps.loadSettings(logger);
    if (!settings.slotsEnabled) {
      return [];
    }
    const reservation = await deps.findReservation(params, quoteId);
    if (!(reservation && COUNTED.includes(reservation.status))) {
      return [];
    }
    const fee = Number(reservation.fee);
    if (!(fee > 0)) {
      return [];
    }
    const kind = reservation.type === "pickup" ? "Pickup" : "Delivery";
    return [
      {
        base_fee: Math.round(fee * 100) / 100,
        code: FEE_CODE,
        label: `${kind} slot: ${reservation.label}`,
      },
    ];
  };
}
