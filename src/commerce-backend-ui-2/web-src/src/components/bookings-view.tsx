import { ActionButton } from "@react-spectrum/s2/ActionButton";
import { AlertDialog } from "@react-spectrum/s2/AlertDialog";
import { Button } from "@react-spectrum/s2/Button";
import { Checkbox } from "@react-spectrum/s2/Checkbox";
import { CheckboxGroup } from "@react-spectrum/s2/CheckboxGroup";
import { Content } from "@react-spectrum/s2/Content";
import { DialogContainer } from "@react-spectrum/s2/Dialog";
import { Heading } from "@react-spectrum/s2/Heading";
import { IllustratedMessage } from "@react-spectrum/s2/IllustratedMessage";
import { InlineAlert } from "@react-spectrum/s2/InlineAlert";
import Refresh from "@react-spectrum/s2/icons/Refresh";
import { Picker, PickerItem } from "@react-spectrum/s2/Picker";
import { ProgressCircle } from "@react-spectrum/s2/ProgressCircle";
import { StatusLight } from "@react-spectrum/s2/StatusLight";
import { style } from "@react-spectrum/s2/style" with { type: "macro" };
import {
  Cell,
  Column,
  Row,
  TableBody,
  TableHeader,
  TableView,
} from "@react-spectrum/s2/TableView";
import { Text } from "@react-spectrum/s2/Text";
import { TextField } from "@react-spectrum/s2/TextField";
import { useCallback, useEffect, useMemo, useState } from "react";

import { addDays, isDate } from "#engine";

import { useSlotsApi } from "../hooks/use-slots-api.ts";
import { dateError, formatDay, slotWindow } from "../lib/profiles.ts";
import { CalendarGrid } from "./calendar-grid.tsx";

import type {
  Booking,
  BookingStatus,
  BookingsResult,
  Profile,
} from "../lib/types.ts";

export type BookingsViewProps = { profiles: Profile[] };

const RANGE_DAYS = 14;
const ACTIVE: BookingStatus[] = ["hold", "pending", "confirmed"];
const STATUS_INFO: Record<
  BookingStatus,
  {
    label: string;
    variant: "positive" | "notice" | "neutral" | "informative" | "negative";
  }
> = {
  cancelled: { label: "Cancelled", variant: "neutral" },
  confirmed: { label: "Confirmed", variant: "positive" },
  expired: { label: "Expired", variant: "neutral" },
  hold: { label: "Held at checkout", variant: "informative" },
  pending: { label: "Placing order", variant: "notice" },
  released: { label: "Released", variant: "neutral" },
};

function orderLabel(booking: Booking): string {
  if (booking.incrementId) {
    return `#${booking.incrementId}`;
  }
  return booking.orderId
    ? `Order ${booking.orderId}`
    : `Cart ${booking.quoteId}`;
}

/** Capacity per date and slot, and every booking in a date range, with manual release. */
export function BookingsView({ profiles }: BookingsViewProps) {
  const api = useSlotsApi();
  const [profileCode, setProfileCode] = useState(profiles[0]?.code ?? "");
  const [from, setFrom] = useState("");
  const [statuses, setStatuses] = useState<string[]>(ACTIVE);
  const [data, setData] = useState<BookingsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [releasing, setReleasing] = useState<Booking | null>(null);

  const load = useCallback(async () => {
    if (!profileCode || (from && !isDate(from))) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const to = from ? addDays(from, RANGE_DAYS - 1) : undefined;
      const result = await api.bookings({
        from: from || undefined,
        profile: profileCode,
        to,
      });
      setData(result);
      if (!from) {
        setFrom(result.from);
      }
    } catch (loadError) {
      setError((loadError as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, from, profileCode]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(
    () =>
      (data?.bookings ?? []).filter(
        (b) => !statuses.length || statuses.includes(b.status),
      ),
    [data, statuses],
  );
  const totals = useMemo(() => {
    const active = (data?.bookings ?? []).filter((b) =>
      ACTIVE.includes(b.status),
    );
    return {
      active: active.length,
      confirmed: active.filter((b) => b.status === "confirmed").length,
      fees: active.reduce((sum, b) => sum + (b.fee ?? 0), 0),
    };
  }, [data]);

  const release = async (booking: Booking) => {
    setReleasing(null);
    try {
      await api.releaseBooking(booking.quoteId);
      await load();
    } catch (releaseError) {
      setError((releaseError as Error).message);
    }
  };

  const renderEmptyState = useCallback(
    () => (
      <IllustratedMessage>
        <Heading>No bookings in these dates</Heading>
        <Content>Pick other dates or statuses.</Content>
      </IllustratedMessage>
    ),
    [],
  );

  if (!profiles.length) {
    return (
      <IllustratedMessage>
        <Heading>No profiles yet</Heading>
        <Content>Add a delivery profile to start taking bookings.</Content>
      </IllustratedMessage>
    );
  }

  return (
    <main
      className={style({ display: "flex", flexDirection: "column", gap: 16 })}>
      <div className={style({ alignItems: "center", display: "flex", gap: 8 })}>
        <Heading
          level={1}
          styles={style({ flexGrow: 1, font: "heading-lg", margin: 0 })}>
          Bookings and capacity
        </Heading>
        <ActionButton
          aria-label="Reload bookings"
          isDisabled={loading}
          onPress={load}>
          <Refresh />
        </ActionButton>
      </div>

      <div
        className={style({
          alignItems: "end",
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
        })}>
        <Picker
          label="Profile"
          onSelectionChange={(key) => setProfileCode(String(key))}
          selectedKey={profileCode}>
          {profiles.map((profile) => (
            <PickerItem id={profile.code} key={profile.code}>
              {profile.name}
            </PickerItem>
          ))}
        </Picker>
        <TextField
          description={`Shows ${RANGE_DAYS} days`}
          errorMessage={dateError(from)}
          isInvalid={Boolean(dateError(from))}
          label="From (YYYY-MM-DD)"
          onChange={setFrom}
          value={from}
        />
        <Button
          isDisabled={!isDate(from)}
          onPress={() => setFrom(addDays(from, -RANGE_DAYS))}
          variant="secondary">
          Previous {RANGE_DAYS} days
        </Button>
        <Button
          isDisabled={!isDate(from)}
          onPress={() => setFrom(addDays(from, RANGE_DAYS))}
          variant="secondary">
          Next {RANGE_DAYS} days
        </Button>
      </div>

      {error && (
        <InlineAlert variant="negative">
          <Heading>Couldn't load bookings</Heading>
          <Content>{error}</Content>
        </InlineAlert>
      )}

      {loading && !data ? (
        <div
          className={style({
            display: "flex",
            justifyContent: "center",
            marginTop: 32,
          })}>
          <ProgressCircle
            aria-label="Loading bookings"
            isIndeterminate
            size="L"
          />
        </div>
      ) : (
        data && (
          <>
            <Text>
              {totals.active} active booking{totals.active === 1 ? "" : "s"} (
              {totals.confirmed} confirmed) from {formatDay(data.from)} to{" "}
              {formatDay(data.to)}
              {totals.fees > 0
                ? `, ${totals.fees.toFixed(2)} in slot fees`
                : ""}
              .
            </Text>
            <CalendarGrid
              days={data.calendar}
              label="Capacity by date"
              showUsage
            />
            <Heading level={2} styles={style({ font: "title-lg", margin: 0 })}>
              Bookings
            </Heading>
            <CheckboxGroup
              label="Show"
              onChange={setStatuses}
              orientation="horizontal"
              value={statuses}>
              {(Object.keys(STATUS_INFO) as BookingStatus[]).map((status) => (
                <Checkbox key={status} value={status}>
                  {STATUS_INFO[status].label}
                </Checkbox>
              ))}
            </CheckboxGroup>
            <TableView
              aria-label="Bookings"
              selectionMode="none"
              styles={style({ minHeight: 240, width: "full" })}>
              <TableHeader>
                <Column isRowHeader>Date</Column>
                <Column>Slot</Column>
                <Column>Order</Column>
                <Column>Status</Column>
                <Column>Shipping method</Column>
                <Column>Fee</Column>
                <Column>Action</Column>
              </TableHeader>
              <TableBody
                items={shown.map((b) => ({ ...b, id: b.quoteId }))}
                renderEmptyState={renderEmptyState}>
                {(booking) => (
                  <Row id={booking.quoteId}>
                    <Cell>{formatDay(booking.date)}</Cell>
                    <Cell>
                      {slotWindow(booking)}
                      {booking.label && booking.label !== slotWindow(booking)
                        ? ` ${booking.label}`
                        : ""}
                    </Cell>
                    <Cell>{orderLabel(booking)}</Cell>
                    <Cell>
                      <StatusLight
                        size="S"
                        variant={STATUS_INFO[booking.status].variant}>
                        {STATUS_INFO[booking.status].label}
                      </StatusLight>
                    </Cell>
                    <Cell>{booking.shippingMethod || "—"}</Cell>
                    <Cell>{booking.fee ? booking.fee.toFixed(2) : "—"}</Cell>
                    <Cell>
                      {ACTIVE.includes(booking.status) ? (
                        <ActionButton
                          aria-label={`Release ${orderLabel(booking)}`}
                          onPress={() => setReleasing(booking)}
                          size="S">
                          Release
                        </ActionButton>
                      ) : (
                        "—"
                      )}
                    </Cell>
                  </Row>
                )}
              </TableBody>
            </TableView>
          </>
        )
      )}

      <DialogContainer onDismiss={() => setReleasing(null)}>
        {releasing && (
          <AlertDialog
            onPrimaryAction={() => release(releasing)}
            primaryActionLabel="Release"
            secondaryActionLabel="Cancel"
            title={`Release ${orderLabel(releasing)}?`}
            variant="warning">
            The place in {slotWindow(releasing)} on {formatDay(releasing.date)}{" "}
            goes back on sale. The order itself isn't changed. Use this for a
            cancelled delivery the app didn't see, or a test booking.
          </AlertDialog>
        )}
      </DialogContainer>
    </main>
  );
}
