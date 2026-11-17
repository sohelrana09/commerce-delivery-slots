import { AlertDialog } from "@react-spectrum/s2/AlertDialog";
import { Button } from "@react-spectrum/s2/Button";
import { ButtonGroup } from "@react-spectrum/s2/ButtonGroup";
import { Checkbox } from "@react-spectrum/s2/Checkbox";
import { CheckboxGroup } from "@react-spectrum/s2/CheckboxGroup";
import { ComboBox, ComboBoxItem } from "@react-spectrum/s2/ComboBox";
import { Content } from "@react-spectrum/s2/Content";
import { DialogTrigger } from "@react-spectrum/s2/Dialog";
import { Heading } from "@react-spectrum/s2/Heading";
import { InlineAlert } from "@react-spectrum/s2/InlineAlert";
import { NumberField } from "@react-spectrum/s2/NumberField";
import { Radio, RadioGroup } from "@react-spectrum/s2/RadioGroup";
import { Switch } from "@react-spectrum/s2/Switch";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import { Tab, TabList, TabPanel, Tabs } from "@react-spectrum/s2/Tabs";
import { Text } from "@react-spectrum/s2/Text";
import { TextField } from "@react-spectrum/s2/TextField";
import { useMemo, useState } from "react";

import {
  availability,
  isDate,
  isTime,
  isValidTimeZone,
  validateProfile,
  zonedParts,
  zonedTimeToInstant,
} from "#engine";

import { ApiError } from "../hooks/use-slots-api.ts";
import {
  COMMON_TIME_ZONES,
  cleanProfile,
  timeError,
  toCode,
  WEEKDAYS,
} from "../lib/profiles.ts";
import { CalendarGrid } from "./calendar-grid.tsx";
import { DatesEditor } from "./dates-editor.tsx";
import { SlotsEditor } from "./slots-editor.tsx";

import type { Lookups, Profile, ProfileType } from "../lib/types.ts";

export type ProfileEditorProps = {
  initial: Profile;
  lookups: Lookups | null;
  onCancel: () => void;
  onDelete: (code: string) => Promise<void>;
  onSave: (profile: Profile, previousCode?: string) => Promise<void>;
  /** The saved code when editing; undefined for a new profile. */
  originalCode?: string;
};

const column = style({
  display: "flex",
  flexDirection: "column",
  gap: 16,
  paddingY: 16,
});
const grid = style({
  display: "grid",
  gap: 16,
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
});

function splitCodes(text: string): string[] {
  return text
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);
}

function StoreViewsField({
  lookups,
  value,
  onChange,
}: {
  lookups: Lookups | null;
  value: string[];
  onChange: (codes: string[]) => void;
}) {
  const description = "Leave empty to use this profile in every store view.";
  const available = lookups?.storeViews ?? [];
  if (lookups?.unavailable || available.length === 0) {
    return (
      <TextField
        description={`${description} Enter store view codes separated by commas.`}
        label="Store views"
        onChange={(text) => onChange(splitCodes(text))}
        value={value.join(", ")}
      />
    );
  }
  return (
    <CheckboxGroup
      description={description}
      label="Store views"
      onChange={onChange}
      orientation="horizontal"
      value={value}>
      {available.map((view) => (
        <Checkbox key={view.code} value={view.code}>
          {view.label}
        </Checkbox>
      ))}
    </CheckboxGroup>
  );
}

/** Previews the calendar a shopper would see at a chosen moment, in the profile's zone. */
function CalendarPreview({ profile }: { profile: Profile }) {
  const zone = isValidTimeZone(profile.timezone)
    ? (profile.timezone as string)
    : "UTC";
  const [now] = useState(() => zonedParts(Date.now(), zone));
  const [date, setDate] = useState(now.date);
  const [time, setTime] = useState(now.time);
  const errors = validateProfile(profile);
  const valid = isDate(date) && isTime(time);
  const result = useMemo(() => {
    if (errors.length || !valid) {
      return null;
    }
    return availability(profile, { now: zonedTimeToInstant(date, time, zone) });
  }, [profile, date, time, zone, errors.length, valid]);

  return (
    <div className={column}>
      <Text>
        What a shopper sees when they check out at this local time in {zone}.
        Capacity is shown as unbooked here; see Bookings for real counts.
      </Text>
      <div className={style({ display: "flex", flexWrap: "wrap", gap: 16 })}>
        <TextField
          errorMessage="Use YYYY-MM-DD"
          isInvalid={!isDate(date)}
          label="Checkout date"
          onChange={setDate}
          value={date}
        />
        <TextField
          errorMessage="Use HH:MM"
          isInvalid={!isTime(time)}
          label="Checkout time"
          onChange={setTime}
          value={time}
        />
      </div>
      {errors.length > 0 && (
        <InlineAlert variant="notice">
          <Heading>Fix the profile to preview it</Heading>
          <Content>{errors.join("; ")}</Content>
        </InlineAlert>
      )}
      {result && <CalendarGrid days={result.dates} label="Calendar preview" />}
    </div>
  );
}

export function ProfileEditor({
  initial,
  lookups,
  onCancel,
  onDelete,
  onSave,
  originalCode,
}: ProfileEditorProps) {
  const [profile, setProfile] = useState<Profile>(initial);
  const [codeTouched, setCodeTouched] = useState(Boolean(originalCode));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const set = (patch: Partial<Profile>) =>
    setProfile((current) => ({ ...current, ...patch }));

  const save = async () => {
    const clean = cleanProfile(profile);
    const problems = validateProfile(clean);
    if (problems.length) {
      setErrors(problems);
      setMessage("Fix these before saving:");
      return;
    }
    setSaving(true);
    setErrors([]);
    setMessage(null);
    try {
      await onSave(clean, originalCode);
    } catch (error) {
      setMessage((error as Error).message);
      setErrors(error instanceof ApiError ? error.errors : []);
    } finally {
      setSaving(false);
    }
  };

  const zoneError = isValidTimeZone(profile.timezone)
    ? undefined
    : "Unknown time zone";

  return (
    <main
      className={style({ display: "flex", flexDirection: "column", gap: 16 })}>
      <div
        className={style({
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        })}>
        <Heading
          level={1}
          styles={style({ flexGrow: 1, font: "heading-lg", margin: 0 })}>
          {originalCode ? `Edit ${initial.name}` : "New delivery profile"}
        </Heading>
        <ButtonGroup>
          {originalCode && (
            <DialogTrigger>
              <Button variant="negative">Delete</Button>
              <AlertDialog
                onPrimaryAction={() => onDelete(originalCode)}
                primaryActionLabel="Delete"
                secondaryActionLabel="Cancel"
                title={`Delete ${initial.name}?`}
                variant="destructive">
                Shoppers can no longer pick slots for its shipping methods.
                Existing bookings are kept, but no new ones are taken.
              </AlertDialog>
            </DialogTrigger>
          )}
          <Button onPress={onCancel} variant="secondary">
            Cancel
          </Button>
          <Button isPending={saving} onPress={save} variant="accent">
            Save
          </Button>
        </ButtonGroup>
      </div>

      {message && (
        <InlineAlert variant="negative">
          <Heading>Couldn't save</Heading>
          <Content>
            {message}
            {errors.length > 0 && (
              <ul>
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}
          </Content>
        </InlineAlert>
      )}

      <Tabs aria-label="Profile settings">
        <TabList>
          <Tab id="general">General</Tab>
          <Tab id="calendar">Calendar and cut-offs</Tab>
          <Tab id="slots">Time slots</Tab>
          <Tab id="dates">Holidays and dates</Tab>
          <Tab id="preview">Preview</Tab>
        </TabList>

        <TabPanel id="general">
          <div className={column}>
            <div className={grid}>
              <TextField
                isRequired
                label="Name"
                onChange={(name) =>
                  set(codeTouched ? { name } : { code: toCode(name), name })
                }
                value={profile.name}
              />
              <TextField
                description="Lowercase letters, digits, - and _. Stored with each booking."
                isRequired
                label="Code"
                onChange={(code) => {
                  setCodeTouched(true);
                  set({ code });
                }}
                value={profile.code}
              />
              <NumberField
                description="When several profiles match, the lowest number wins."
                label="Priority"
                onChange={(priority) => set({ priority })}
                value={profile.priority ?? 0}
              />
            </div>
            <RadioGroup
              label="Type"
              onChange={(type) => set({ type: type as ProfileType })}
              orientation="horizontal"
              value={profile.type ?? "delivery"}>
              <Radio value="delivery">Delivery</Radio>
              <Radio value="pickup">Pickup</Radio>
            </RadioGroup>
            <Switch
              isSelected={profile.enabled !== false}
              onChange={(enabled) => set({ enabled })}>
              Offer this calendar at checkout
            </Switch>
            <Switch
              isSelected={profile.required !== false}
              onChange={(required) => set({ required })}>
              Shoppers must pick a slot to place the order
            </Switch>
            <TextField
              description="Shipping method codes (carrier_method), separated by commas. Use carrier_* or the carrier code for all its methods. Leave empty for every method."
              label="Shipping methods"
              onChange={(text) => set({ shippingMethods: splitCodes(text) })}
              value={(profile.shippingMethods ?? []).join(", ")}
            />
            <StoreViewsField
              lookups={lookups}
              onChange={(storeViews) => set({ storeViews })}
              value={profile.storeViews ?? []}
            />
          </div>
        </TabPanel>

        <TabPanel id="calendar">
          <div className={column}>
            <ComboBox
              allowsCustomValue
              description="Every date, cut-off and slot time is in this zone, whatever the shopper's own."
              errorMessage={zoneError}
              inputValue={profile.timezone ?? ""}
              isInvalid={Boolean(zoneError)}
              label="Time zone"
              onInputChange={(timezone) => set({ timezone })}>
              {COMMON_TIME_ZONES.map((zone) => (
                <ComboBoxItem id={zone} key={zone}>
                  {zone}
                </ComboBoxItem>
              ))}
            </ComboBox>
            <CheckboxGroup
              label="Working days"
              onChange={(days) => set({ workingDays: days.map(Number) })}
              orientation="horizontal"
              value={(profile.workingDays ?? []).map(String)}>
              {WEEKDAYS.map((day) => (
                <Checkbox key={day.id} value={String(day.id)}>
                  {day.long}
                </Checkbox>
              ))}
            </CheckboxGroup>
            <div className={grid}>
              <NumberField
                description="A slot must start at least this long after the order."
                label="Lead time (minutes)"
                minValue={0}
                onChange={(leadTimeMinutes) => set({ leadTimeMinutes })}
                value={profile.leadTimeMinutes ?? 0}
              />
              <NumberField
                description="How far ahead shoppers can book."
                label="Maximum days ahead"
                maxValue={365}
                minValue={0}
                onChange={(maxDaysAhead) => set({ maxDaysAhead })}
                value={profile.maxDaysAhead ?? 14}
              />
            </div>
            <Switch
              isSelected={profile.sameDayEnabled !== false}
              onChange={(sameDayEnabled) => set({ sameDayEnabled })}>
              Allow same-day slots
            </Switch>
            <div className={grid}>
              <TextField
                description="After this time, today is closed. Empty: no cut-off."
                errorMessage={timeError(profile.sameDayCutoff)}
                isDisabled={profile.sameDayEnabled === false}
                isInvalid={Boolean(timeError(profile.sameDayCutoff))}
                label="Same-day cut-off (HH:MM)"
                onChange={(sameDayCutoff) => set({ sameDayCutoff })}
                value={profile.sameDayCutoff ?? ""}
              />
              <TextField
                description="After this time, the next open day is closed too. Empty: no cut-off."
                errorMessage={timeError(profile.nextDayCutoff)}
                isInvalid={Boolean(timeError(profile.nextDayCutoff))}
                label="Next-day cut-off (HH:MM)"
                onChange={(nextDayCutoff) => set({ nextDayCutoff })}
                value={profile.nextDayCutoff ?? ""}
              />
            </div>
          </div>
        </TabPanel>

        <TabPanel id="slots">
          <div className={column}>
            <SlotsEditor
              onChange={(slots) => set({ slots })}
              slots={profile.slots ?? []}
            />
          </div>
        </TabPanel>

        <TabPanel id="dates">
          <div className={column}>
            <DatesEditor
              blackouts={profile.blackouts ?? []}
              holidays={profile.holidays ?? []}
              onChange={set}
              overrides={profile.overrides ?? []}
              slots={profile.slots ?? []}
            />
          </div>
        </TabPanel>

        <TabPanel id="preview">
          <CalendarPreview profile={cleanProfile(profile)} />
        </TabPanel>
      </Tabs>
    </main>
  );
}
