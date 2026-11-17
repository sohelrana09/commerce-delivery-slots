import { Meter } from "@react-spectrum/s2/Meter";
import { StatusLight } from "@react-spectrum/s2/StatusLight";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import { Text } from "@react-spectrum/s2/Text";

import {
  formatDay,
  money,
  REASON_LABELS,
  slotWindow,
} from "../lib/profiles.ts";

import type { DayAvailability, SlotAvailability } from "../lib/types.ts";

export type CalendarGridProps = {
  days: DayAvailability[];
  /** Show booked / capacity meters (bookings view) instead of shopper availability only. */
  showUsage?: boolean;
  label: string;
};

const grid = style({
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
});

const card = style({
  backgroundColor: "layer-1",
  borderColor: "gray-200",
  borderRadius: "lg",
  borderStyle: "solid",
  borderWidth: 1,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 12,
});

function slotStatus(slot: SlotAvailability): {
  label: string;
  variant: "positive" | "notice" | "neutral" | "negative";
} {
  if (slot.available) {
    return { label: "Open", variant: "positive" };
  }
  if (slot.reason === "full") {
    return { label: "Full", variant: "negative" };
  }
  return {
    label: slot.reason ? REASON_LABELS[slot.reason] : "Closed",
    variant: "neutral",
  };
}

function meterVariant(usage: number): "negative" | "notice" | "positive" {
  if (usage >= 100) {
    return "negative";
  }
  return usage >= 80 ? "notice" : "positive";
}

function SlotRow({
  slot,
  showUsage,
}: {
  slot: SlotAvailability;
  showUsage?: boolean;
}) {
  const state = slotStatus(slot);
  const capacity = slot.capacity ?? null;
  const booked = slot.booked ?? 0;
  const usage = capacity
    ? Math.min(100, Math.round((booked / capacity) * 100))
    : 0;
  return (
    <li className={style({ display: "flex", flexDirection: "column", gap: 4 })}>
      <div
        className={style({
          alignItems: "center",
          display: "flex",
          gap: 8,
          justifyContent: "space-between",
        })}>
        <Text styles={style({ font: "ui", fontWeight: "bold" })}>
          {slotWindow(slot)}
        </Text>
        <StatusLight size="S" variant={state.variant}>
          {state.label}
        </StatusLight>
      </div>
      <Text styles={style({ color: "gray-700", font: "ui-sm" })}>
        {[
          slot.label === slotWindow(slot) ? "" : slot.label,
          money(slot.fee) ? `+${money(slot.fee)}` : "",
          capacity === null ? "Unlimited" : `${booked} of ${capacity} booked`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </Text>
      {showUsage && capacity !== null && capacity > 0 && (
        <Meter
          aria-label={`${slotWindow(slot)}: ${booked} of ${capacity} booked`}
          size="S"
          value={usage}
          variant={meterVariant(usage)}
        />
      )}
    </li>
  );
}

/** One card per date with its slots: what shoppers can book, and how full each slot is. */
export function CalendarGrid({ days, showUsage, label }: CalendarGridProps) {
  return (
    <ul
      aria-label={label}
      className={`${grid} ${style({ margin: 0, padding: 0 })}`}>
      {days.map((day) => (
        <li className={card} key={day.date} style={{ listStyle: "none" }}>
          <div
            className={style({
              alignItems: "baseline",
              display: "flex",
              gap: 8,
              justifyContent: "space-between",
            })}>
            <Text styles={style({ font: "title-sm" })}>
              {formatDay(day.date)}
            </Text>
            {!day.available && day.slots.length === 0 && (
              <StatusLight size="S" variant="neutral">
                {day.reason ? REASON_LABELS[day.reason] : "Closed"}
              </StatusLight>
            )}
          </div>
          {day.name && (
            <Text styles={style({ color: "gray-700", font: "ui-sm" })}>
              {day.name}
            </Text>
          )}
          {day.slots.length > 0 && (
            <ul
              className={style({
                display: "flex",
                flexDirection: "column",
                gap: 8,
                margin: 0,
                padding: 0,
              })}
              style={{ listStyle: "none" }}>
              {day.slots.map((slot) => (
                <SlotRow key={slot.code} showUsage={showUsage} slot={slot} />
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
