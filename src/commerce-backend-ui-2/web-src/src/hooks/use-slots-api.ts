import { useIms } from "@adobe/aio-commerce-lib-admin-ui/web";
import { createContext, useCallback, useContext, useMemo } from "react";

import actionUrls from "../config.json";

import type {
  BookingsResult,
  Lookups,
  Profile,
  ProfilesResult,
} from "../lib/types.ts";

const PACKAGE = "DeliverySlotsAdmin";

export class ApiError extends Error {
  public readonly errors: string[];

  public constructor(message: string, errors: string[] = []) {
    super(message);
    this.name = "ApiError";
    this.errors = errors;
  }
}

export type BookingsQuery = {
  profile: string;
  from?: string;
  to?: string;
  statuses?: string[];
};

/** What the Admin page needs from the backend. The preview supplies an in-browser version. */
export type SlotsApi = {
  bookings: (query: BookingsQuery) => Promise<BookingsResult>;
  deleteProfile: (code: string) => Promise<{ deleted: boolean }>;
  listProfiles: () => Promise<ProfilesResult>;
  lookups: () => Promise<Lookups>;
  releaseBooking: (quoteId: string) => Promise<{ released: boolean }>;
  saveProfile: (
    profile: Profile,
    previousCode?: string,
  ) => Promise<{ profile: Profile }>;
};

/**
 * Calls the app's Admin web actions with the signed-in admin's IMS token. Action URLs come from
 * `config.json`, which the App Builder CLI writes at build and dev time.
 */
export function useActionsApi(): SlotsApi {
  const ims = useIms();
  if (ims.error) {
    throw ims.error;
  }
  const { imsToken, imsOrgId } = ims.data;

  const invoke = useCallback(
    async <T>(action: string, payload: object = {}): Promise<T> => {
      const url = (actionUrls as Record<string, string>)[
        `${PACKAGE}/${action}`
      ];
      const response = await fetch(url, {
        body: JSON.stringify(payload),
        headers: {
          authorization: `Bearer ${imsToken}`,
          "Content-Type": "application/json",
          "x-gw-ims-org-id": imsOrgId,
        },
        method: "POST",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new ApiError(
          body?.error ?? `Request failed (${response.status})`,
          body?.errors ?? [],
        );
      }
      return body as T;
    },
    [imsOrgId, imsToken],
  );

  return useMemo(
    () => ({
      bookings: (query: BookingsQuery) =>
        invoke<BookingsResult>("bookings", query),
      deleteProfile: (code: string) =>
        invoke<{ deleted: boolean }>("profile-delete", { code }),
      listProfiles: () => invoke<ProfilesResult>("profiles-list"),
      lookups: () => invoke<Lookups>("lookups"),
      releaseBooking: (quoteId: string) =>
        invoke<{ released: boolean }>("booking-release", { quoteId }),
      saveProfile: (profile: Profile, previousCode?: string) =>
        invoke<{ profile: Profile }>("profile-save", { previousCode, profile }),
    }),
    [invoke],
  );
}

export const SlotsApiContext = createContext<SlotsApi | null>(null);

/** The backend the page talks to: the App Builder actions, or the preview's in-browser store. */
export function useSlotsApi(): SlotsApi {
  const api = useContext(SlotsApiContext);
  if (!api) {
    throw new Error("SlotsApiContext is missing");
  }
  return api;
}
