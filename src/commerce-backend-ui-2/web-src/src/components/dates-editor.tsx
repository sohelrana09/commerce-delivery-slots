import { ActionButton } from "@react-spectrum/s2/ActionButton";
import { Button } from "@react-spectrum/s2/Button";
import { Heading } from "@react-spectrum/s2/Heading";
import Delete from "@react-spectrum/s2/icons/Delete";
import { Switch } from "@react-spectrum/s2/Switch";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import { Text } from "@react-spectrum/s2/Text";
import { TextField } from "@react-spectrum/s2/TextField";
import { useState } from "react";

import { isDate } from "#engine";

import { dateError } from "../lib/profiles.ts";

import type { Blackout, DateOverride, Holiday, Slot } from "../lib/types.ts";

export type DatesEditorProps = {
  holidays: Holiday[];
  blackouts: Blackout[];
  overrides: DateOverride[];
  slots: Slot[];
  onChange: (patch: {
    holidays?: Holiday[];
    blackouts?: Blackout[];
    overrides?: DateOverride[];
  }) => void;
};

const MONTH_DAY = /^\d{2}-\d{2}$/u;
const section = style({ display: "flex", flexDirection: "column", gap: 12 });
const line = style({
  alignItems: "end",
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
});

function holidayError(value: string): string | undefined {
  return value && !(isDate(value) || MONTH_DAY.test(value))
    ? "Use YYYY-MM-DD, or MM-DD for every year"
    : undefined;
}

/** "am=5, pm=0" <-> { am: 5, pm: 0 } for per-date capacity. */
function parseCapacity(text: string): Record<string, number> {
  const entries = text
    .split(",")
    .map((part) => part.split("=").map((s) => s.trim()))
    .filter(([code, value]) => code && value !== undefined && value !== "")
    .map(([code, value]) => [code, Number(value)] as const)
    .filter(([, value]) => Number.isFinite(value) && value >= 0);
  return Object.fromEntries(entries);
}

function formatCapacity(capacity?: Record<string, unknown>): string {
  return Object.entries(capacity ?? {})
    .map(([code, value]) => `${code}=${value}`)
    .join(", ");
}

/** Keeps the typed text while it's half-written ("am=") and reports the parsed capacities. */
function CapacityField({
  value,
  isDisabled,
  onChange,
}: {
  value?: Record<string, unknown>;
  isDisabled?: boolean;
  onChange: (capacity: Record<string, number>) => void;
}) {
  const [text, setText] = useState(() => formatCapacity(value));
  return (
    <TextField
      description="For example am=5, pm=0"
      isDisabled={isDisabled}
      label="Capacity on this date"
      onChange={(next) => {
        setText(next);
        onChange(parseCapacity(next));
      }}
      value={text}
    />
  );
}

function replaceAt<T>(list: T[], index: number, patch: Partial<T>): T[] {
  return list.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

/** Holidays, blackout ranges and one-off date changes. */
export function DatesEditor({
  holidays,
  blackouts,
  overrides,
  slots,
  onChange,
}: DatesEditorProps) {
  const slotCodes = slots.map((s) => s.code).join(", ");
  return (
    <div
      className={style({ display: "flex", flexDirection: "column", gap: 24 })}>
      <section className={section}>
        <Heading level={3} styles={style({ font: "title", margin: 0 })}>
          Holidays
        </Heading>
        <Text>
          Closed all day. Use MM-DD (for example 12-25) for a date that repeats
          every year.
        </Text>
        {holidays.map((holiday, index) => (
          <div className={line} key={index}>
            <TextField
              errorMessage={holidayError(holiday.date)}
              isInvalid={Boolean(holidayError(holiday.date))}
              label="Date"
              onChange={(date) =>
                onChange({ holidays: replaceAt(holidays, index, { date }) })
              }
              value={holiday.date}
            />
            <TextField
              label="Name"
              onChange={(name) =>
                onChange({ holidays: replaceAt(holidays, index, { name }) })
              }
              value={holiday.name ?? ""}
            />
            <ActionButton
              aria-label={`Remove holiday ${holiday.name || holiday.date}`}
              onPress={() =>
                onChange({ holidays: holidays.filter((_, i) => i !== index) })
              }>
              <Delete />
            </ActionButton>
          </div>
        ))}
        <div>
          <Button
            onPress={() =>
              onChange({ holidays: [...holidays, { date: "", name: "" }] })
            }
            variant="secondary">
            Add holiday
          </Button>
        </div>
      </section>

      <section className={section}>
        <Heading level={3} styles={style({ font: "title", margin: 0 })}>
          Blackout dates
        </Heading>
        <Text>
          Closed from the first to the last date, inclusive. For shutdowns and
          stocktakes.
        </Text>
        {blackouts.map((blackout, index) => (
          <div className={line} key={index}>
            <TextField
              errorMessage={dateError(blackout.from)}
              isInvalid={Boolean(dateError(blackout.from))}
              label="From (YYYY-MM-DD)"
              onChange={(from) =>
                onChange({ blackouts: replaceAt(blackouts, index, { from }) })
              }
              value={blackout.from}
            />
            <TextField
              errorMessage={dateError(blackout.to)}
              isInvalid={Boolean(dateError(blackout.to))}
              label="To (YYYY-MM-DD)"
              onChange={(to) =>
                onChange({ blackouts: replaceAt(blackouts, index, { to }) })
              }
              value={blackout.to}
            />
            <TextField
              label="Reason"
              onChange={(name) =>
                onChange({ blackouts: replaceAt(blackouts, index, { name }) })
              }
              value={blackout.name ?? ""}
            />
            <ActionButton
              aria-label={`Remove blackout ${blackout.name || blackout.from}`}
              onPress={() =>
                onChange({ blackouts: blackouts.filter((_, i) => i !== index) })
              }>
              <Delete />
            </ActionButton>
          </div>
        ))}
        <div>
          <Button
            onPress={() =>
              onChange({
                blackouts: [...blackouts, { from: "", name: "", to: "" }],
              })
            }
            variant="secondary">
            Add blackout
          </Button>
        </div>
      </section>

      <section className={section}>
        <Heading level={3} styles={style({ font: "title", margin: 0 })}>
          Date changes
        </Heading>
        <Text>
          Close one date, open a date that is normally closed (it then offers
          every slot), or change capacity for one date. Slot codes:{" "}
          {slotCodes || "none yet"}.
        </Text>
        {overrides.map((override, index) => (
          <div className={line} key={index}>
            <TextField
              errorMessage={dateError(override.date)}
              isInvalid={Boolean(dateError(override.date))}
              label="Date (YYYY-MM-DD)"
              onChange={(date) =>
                onChange({ overrides: replaceAt(overrides, index, { date }) })
              }
              value={override.date}
            />
            <TextField
              label="Name"
              onChange={(name) =>
                onChange({ overrides: replaceAt(overrides, index, { name }) })
              }
              value={override.name ?? ""}
            />
            <CapacityField
              isDisabled={override.closed}
              onChange={(capacity) =>
                onChange({
                  overrides: replaceAt(overrides, index, { capacity }),
                })
              }
              value={override.capacity}
            />
            <Switch
              isSelected={Boolean(override.closed)}
              onChange={(closed) =>
                onChange({ overrides: replaceAt(overrides, index, { closed }) })
              }>
              Closed
            </Switch>
            <ActionButton
              aria-label={`Remove date change ${override.name || override.date}`}
              onPress={() =>
                onChange({ overrides: overrides.filter((_, i) => i !== index) })
              }>
              <Delete />
            </ActionButton>
          </div>
        ))}
        <div>
          <Button
            onPress={() =>
              onChange({
                overrides: [
                  ...overrides,
                  { closed: false, date: "", name: "" },
                ],
              })
            }
            variant="secondary">
            Add date change
          </Button>
        </div>
      </section>
    </div>
  );
}
