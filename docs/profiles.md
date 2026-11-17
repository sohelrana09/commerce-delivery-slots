# Profile format

A **profile** is one delivery or pickup calendar: which shipping methods and store views it covers, when it's open, its cut-offs, and its time slots. Merchants edit profiles on the Admin page; this is the JSON behind it, which is also what `SLOT_PROFILES` takes and what `validateProfile` in the engine checks.

```json
{
  "code": "home-delivery",
  "name": "Home delivery",
  "enabled": true,
  "priority": 10,
  "type": "delivery",
  "required": true,
  "shippingMethods": ["flatrate_flatrate"],
  "storeViews": [],
  "timezone": "Europe/London",
  "workingDays": [1, 2, 3, 4, 5],
  "leadTimeMinutes": 120,
  "sameDayEnabled": true,
  "sameDayCutoff": "10:00",
  "nextDayCutoff": "18:00",
  "maxDaysAhead": 14,
  "slots": [
    { "code": "morning", "label": "Morning", "start": "08:00", "end": "12:00", "capacity": 20, "fee": 0 },
    { "code": "evening", "label": "Evening", "start": "17:00", "end": "21:00", "capacity": 10, "fee": 4.95 },
    { "code": "saturday", "label": "Saturday morning", "start": "09:00", "end": "13:00", "days": [6], "capacity": 8, "fee": 6.95 }
  ],
  "holidays": [
    { "date": "12-25", "name": "Christmas Day" },
    { "date": "2027-04-02", "name": "Good Friday" }
  ],
  "blackouts": [
    { "from": "2026-08-01", "to": "2026-08-14", "name": "Summer shutdown" }
  ],
  "overrides": [
    { "date": "2026-12-20", "name": "Christmas Sunday opening" },
    { "date": "2026-12-24", "name": "Christmas Eve", "capacity": { "evening": 0, "morning": 40 } }
  ]
}
```

## Fields

| Field | Default | Meaning |
|---|---|---|
| `code` | — | Unique ID: lowercase letters, digits, `-` and `_`, up to 64. It's stored with every booking, so don't change it on a live profile. |
| `name` | — | The Admin name. Shoppers don't see it. |
| `enabled` | `true` | Off: the profile is ignored, and the method is offered without slots. |
| `priority` | `0` | When several enabled profiles match a cart, the lowest number wins. |
| `type` | `delivery` | `delivery` or `pickup`: only changes the wording at checkout. |
| `required` | `true` | The shopper must pick a slot to place the order. Off: a slot is optional, and an order without one goes through. |
| `shippingMethods` | `[]` (all) | Which methods use this calendar: an exact `carrier_method` such as `flatrate_flatrate`, a carrier with a wildcard such as `flatrate_*`, or the carrier code alone. |
| `storeViews` | `[]` (all) | Store view codes. Empty: every store view. |
| `timezone` | `UTC` | IANA time zone, such as `Europe/London`. Every date, cut-off and slot time is in this zone. |
| `workingDays` | `[1,2,3,4,5]` | Weekdays the calendar opens: `0` is Sunday, `6` Saturday. |
| `leadTimeMinutes` | `0` | A slot must start at least this long after the order. 120 means a 12:00 slot can be booked until 10:00. Up to 60 days. |
| `sameDayEnabled` | `true` | Off: today is never offered. |
| `sameDayCutoff` | `""` | `HH:MM`. After this local time, today is closed. Empty: no cut-off (the lead time still applies). |
| `nextDayCutoff` | `""` | `HH:MM`. After this local time, the next open day is closed too. "Next open day" skips closed days, so a Friday 18:00 cut-off closes Monday for a Monday-to-Friday calendar. |
| `maxDaysAhead` | `14` | The last bookable date is today plus this many days, up to 365. |
| `slots` | — | At least one, up to 48. See [Slots](#slots). |
| `holidays` | `[]` | Closed dates: `YYYY-MM-DD` once, or `MM-DD` every year, with an optional `name`. |
| `blackouts` | `[]` | Closed periods: `from` and `to` (`YYYY-MM-DD`, inclusive), with an optional `name`. |
| `overrides` | `[]` | One-date exceptions. See [Date overrides](#date-overrides). |

## Slots

| Field | Meaning |
|---|---|
| `code` | Unique in the profile: lowercase letters, digits, `-` and `_`. Stored with every booking, so don't change it on a live profile. |
| `label` | What shoppers see next to the time, such as "Morning". Optional. |
| `start`, `end` | Local times, `HH:MM`. `end` must be after `start`; slots don't cross midnight. |
| `days` | Optional weekdays for this slot only, such as `[6]` for a Saturday slot. Empty: every working day. A slot can open a day that isn't a working day. |
| `capacity` | Places per date. Empty or `null`: unlimited. `0`: closed. |
| `fee` | Added to the cart as a custom fee when the shopper picks the slot. `0` or empty: free. |

## Date overrides

An override changes one date, and wins over working days, holidays and blackouts:

| Override | Effect |
|---|---|
| `{ "date": "2026-12-24", "closed": true }` | Closes the date. |
| `{ "date": "2026-12-20" }` on a non-working day | Opens it with all the profile's slots. |
| `{ "date": "2026-12-27" }` on a holiday or in a blackout | Opens it with that weekday's slots. |
| `{ "date": "2026-12-24", "capacity": { "morning": 40, "evening": 0 } }` | Changes the capacity of the named slots for that date (`0` closes a slot, `null` makes it unlimited). |

## How a date is decided

For each date from today to `maxDaysAhead`, in the profile's time zone:

1. Before today, or after `maxDaysAhead`: unavailable.
2. An override that closes it, a holiday or a blackout (unless an override opens it): closed.
3. No slots on that weekday: closed.
4. Today, with same-day off or after the same-day cut-off; or the next open day after the next-day cut-off: every slot shows "cut-off passed".
5. Each slot: too soon if it starts within the lead time, closed if its capacity is `0`, full if every place is taken.

A date is available when at least one of its slots is. Unavailable dates stay in the feed with a `reason`, so the calendar can show why: `blackout`, `closed`, `cutoff`, `full`, `holiday`, `lead-time`, `no-slots`, `out-of-range`, `past` or `same-day-off`.

## Which profile a cart gets

`selectProfile` takes the enabled profiles whose `shippingMethods` match the cart's method (or that list none) and whose `storeViews` include the cart's store view (or that list none), and picks the one with the lowest `priority`. No match: the method has no slots, and checkout works as without the app.

## Changing a live profile

- Bookings keep the date and slot code they were made with. Renaming a slot's label or changing its times is safe; changing its `code` orphans its bookings from the capacity view.
- Lowering a capacity doesn't cancel bookings. The slot shows full until enough are released.
- The availability feed is cached for **Cache seconds**, and the actions cache profiles for 30 seconds, so a change reaches shoppers within about a minute.
