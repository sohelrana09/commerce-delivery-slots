import type { DayAvailability, Profile } from "#engine";

export type {
  Blackout,
  DateOverride,
  DayAvailability,
  Holiday,
  Profile,
  ProfileType,
  Reason,
  Slot,
  SlotAvailability,
} from "#engine";

export type StoreView = { code: string; id: number; label: string };

export type Lookups = {
  storeViews: StoreView[];
  unavailable?: boolean;
};

export type BookingStatus =
  | "hold"
  | "pending"
  | "confirmed"
  | "cancelled"
  | "expired"
  | "released";

/** A reservation as the bookings action returns it. */
export type Booking = {
  quoteId: string;
  status: BookingStatus;
  profile: string;
  profileName?: string;
  type?: "delivery" | "pickup";
  date: string;
  slot: string;
  label: string;
  start: string;
  end: string;
  fee?: number;
  shippingMethod?: string;
  storeView?: string;
  orderId?: string | null;
  incrementId?: string | null;
  expiresAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type BookingsResult = {
  bookings: Booking[];
  calendar: DayAvailability[];
  from: string;
  to: string;
};

export type ProfilesResult = { profiles: Profile[]; examples: Profile[] };
