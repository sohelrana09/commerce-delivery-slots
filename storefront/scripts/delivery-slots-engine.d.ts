// Types for delivery-slots-engine.js, used by the Admin page. Storefronts don't need this file.

export type ProfileType = "delivery" | "pickup";

export type Slot = {
  code: string;
  label?: string;
  start: string;
  end: string;
  days?: number[];
  capacity?: number | string | null;
  fee?: number | string;
};

export type Holiday = { date: string; name?: string };
export type Blackout = { from: string; to: string; name?: string };
export type DateOverride = {
  date: string;
  closed?: boolean;
  name?: string;
  capacity?: Record<string, number | string | null>;
};

export type Profile = {
  code: string;
  name: string;
  enabled?: boolean;
  priority?: number;
  type?: ProfileType;
  required?: boolean;
  shippingMethods?: string[];
  storeViews?: string[];
  timezone?: string;
  workingDays?: number[];
  holidays?: Holiday[];
  blackouts?: Blackout[];
  overrides?: DateOverride[];
  leadTimeMinutes?: number;
  sameDayEnabled?: boolean;
  sameDayCutoff?: string;
  nextDayCutoff?: string;
  maxDaysAhead?: number;
  slots?: Slot[];
  updatedAt?: string;
};

export type Reason =
  | "blackout"
  | "closed"
  | "cutoff"
  | "full"
  | "holiday"
  | "lead-time"
  | "no-slots"
  | "out-of-range"
  | "past"
  | "same-day-off"
  | "unknown-slot";

export type SlotAvailability = {
  available: boolean;
  booked?: number;
  capacity?: number | null;
  code: string;
  end: string;
  endsAt: string;
  fee: number;
  key?: string;
  label: string;
  reason?: Reason;
  remaining?: number | null;
  start: string;
  startsAt: string;
};

export type DayAvailability = {
  available: boolean;
  date: string;
  name?: string;
  reason?: Reason;
  slots: SlotAvailability[];
  weekday: number;
};

export type PublicProfile = {
  code: string;
  name: string;
  required: boolean;
  timezone: string;
  type: ProfileType;
};

export type Availability = {
  dates: DayAvailability[];
  profile: PublicProfile;
  today: string;
};

export type Booked = Record<string, number> | Map<string, number>;

export const TYPES: ProfileType[];
export const MAX_SLOTS: number;
export const MAX_DAYS_AHEAD: number;
export const REASONS: Record<string, Reason>;

export function isDate(value: unknown): value is string;
export function isTime(value: unknown): value is string;
export function toMinutes(time: string): number;
export function addDays(date: string, days: number): string;
export function daysBetween(a: string, b: string): number;
export function weekdayOf(date: string): number;
export function isValidTimeZone(timeZone: unknown): boolean;
export function offsetMinutes(instant: number, timeZone: string): number;
export function zonedParts(
  instant: number,
  timeZone: string,
): { date: string; minutes: number; time: string; weekday: number };
export function zonedTimeToInstant(date: string, time: string, timeZone: string): number;
export function capacityOf(value: unknown): number | null;
export function normalizeProfile(profile?: Partial<Profile>): Required<Profile>;
export function validateProfile(profile: unknown): string[];
export function selectProfile(
  profiles: Profile[] | null | undefined,
  options?: { shippingMethod?: string; storeView?: string },
): Required<Profile> | null;
export function slotKey(profileCode: string, date: string, slotCode: string): string;
export function availability(
  profile: Profile,
  options?: { now?: number; booked?: Booked; from?: string; days?: number },
): Availability;
export function checkSelection(
  profile: Profile,
  selection?: { date?: string; slot?: string },
  options?: { now?: number; booked?: Booked; ignoreTime?: boolean },
): { ok: boolean; reason?: Reason; slot?: SlotAvailability };
export function firstAvailable(
  profile: Profile,
  options?: { now?: number; booked?: Booked },
): { date: string; slot: SlotAvailability } | null;
export function publicProfile(profile: Profile): PublicProfile;
export function publicAvailability(
  result: Availability,
  options?: { showRemaining?: boolean },
): Availability;
export function describeSelection(
  selection: { date: string; start?: string; end?: string; label?: string },
  locale?: string,
): string;
