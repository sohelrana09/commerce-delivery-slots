import { ActionButton } from "@react-spectrum/s2/ActionButton";
import { Button } from "@react-spectrum/s2/Button";
import { Checkbox } from "@react-spectrum/s2/Checkbox";
import { CheckboxGroup } from "@react-spectrum/s2/CheckboxGroup";
import Delete from "@react-spectrum/s2/icons/Delete";
import { NumberField } from "@react-spectrum/s2/NumberField";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import { Text } from "@react-spectrum/s2/Text";
import { TextField } from "@react-spectrum/s2/TextField";

import { emptySlot, timeError, WEEKDAYS } from "../lib/profiles.ts";

import type { Slot } from "../lib/types.ts";

export type SlotsEditorProps = {
  slots: Slot[];
  onChange: (slots: Slot[]) => void;
};

const row = style({
  borderColor: "gray-200",
  borderRadius: "lg",
  borderStyle: "solid",
  borderWidth: 1,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 16,
});

const fields = style({
  alignItems: "end",
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
});

function toNumber(value: unknown): number | undefined {
  const n = Number(value);
  return value === "" ||
    value === null ||
    value === undefined ||
    !Number.isFinite(n)
    ? undefined
    : n;
}

/** One row per time slot: window, label, capacity, fee and the weekdays it runs. */
export function SlotsEditor({ slots, onChange }: SlotsEditorProps) {
  const update = (index: number, patch: Partial<Slot>) =>
    onChange(
      slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)),
    );
  const remove = (index: number) =>
    onChange(slots.filter((_, i) => i !== index));

  return (
    <div
      className={style({ display: "flex", flexDirection: "column", gap: 12 })}>
      <Text>
        Each slot runs on the profile's working days unless you pick its own
        days. Leave capacity empty for unlimited, or set 0 to close a slot. A
        fee is added to the cart when the shopper picks the slot.
      </Text>
      {slots.map((slot, index) => {
        const name = slot.label || `${slot.start}–${slot.end}`;
        return (
          <fieldset className={row} key={index}>
            <legend className={style({ font: "title-sm", paddingX: 4 })}>
              Slot {index + 1}: {name}
            </legend>
            <div className={fields}>
              <TextField
                isRequired
                label="Code"
                onChange={(code) => update(index, { code })}
                value={slot.code}
              />
              <TextField
                label="Label shoppers see"
                onChange={(label) => update(index, { label })}
                value={slot.label ?? ""}
              />
              <TextField
                errorMessage={timeError(slot.start)}
                isInvalid={Boolean(timeError(slot.start))}
                isRequired
                label="Starts (HH:MM)"
                onChange={(start) => update(index, { start })}
                value={slot.start}
              />
              <TextField
                errorMessage={timeError(slot.end)}
                isInvalid={Boolean(timeError(slot.end))}
                isRequired
                label="Ends (HH:MM)"
                onChange={(end) => update(index, { end })}
                value={slot.end}
              />
              <NumberField
                description="Empty = unlimited"
                label="Capacity"
                minValue={0}
                onChange={(value) =>
                  update(index, {
                    capacity: Number.isNaN(value) ? null : value,
                  })
                }
                value={toNumber(slot.capacity) ?? Number.NaN}
              />
              <NumberField
                formatOptions={{
                  maximumFractionDigits: 2,
                  minimumFractionDigits: 2,
                }}
                label="Fee"
                minValue={0}
                onChange={(value) =>
                  update(index, { fee: Number.isNaN(value) ? 0 : value })
                }
                value={toNumber(slot.fee) ?? 0}
              />
            </div>
            <CheckboxGroup
              description="Leave all unticked to use the working days."
              label={`Days for ${name}`}
              onChange={(days) => update(index, { days: days.map(Number) })}
              orientation="horizontal"
              value={(slot.days ?? []).map(String)}>
              {WEEKDAYS.map((day) => (
                <Checkbox key={day.id} value={String(day.id)}>
                  {day.short}
                </Checkbox>
              ))}
            </CheckboxGroup>
            <div>
              <ActionButton
                aria-label={`Remove ${name}`}
                isDisabled={slots.length === 1}
                onPress={() => remove(index)}>
                <Delete />
                <Text>Remove slot</Text>
              </ActionButton>
            </div>
          </fieldset>
        );
      })}
      <div>
        <Button
          onPress={() => onChange([...slots, emptySlot(slots.length)])}
          variant="secondary">
          Add slot
        </Button>
      </div>
    </div>
  );
}
