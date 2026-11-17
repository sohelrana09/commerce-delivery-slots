/**
 * Delivery Slots storefront kit for the Edge Delivery Services checkout drop-in.
 *
 * Copy this file, delivery-slots-engine.js and ../styles/delivery-slots.css into your storefront
 * (scripts/ and styles/), then in blocks/commerce-checkout/commerce-checkout.js:
 *
 *   import { mountDeliverySlots } from '../../scripts/delivery-slots.js';
 *
 *   const deliverySlots = mountDeliverySlots($slots, {
 *     availabilityEndpoint: '<your delivery-slots/availability action URL>',
 *     holdEndpoint: '<your delivery-slots/hold action URL>',
 *     storeView: 'default',
 *     events,                         // from @dropins/tools/event-bus.js
 *     graphql: checkoutApi.fetchGraphQl,
 *   });
 *
 *   // handleValidation: ... && deliverySlots.validate()
 *   // handlePlaceOrder: await deliverySlots.saveToCart(cartId) before orderApi.placeOrder(cartId)
 *
 * The picker is two native radio groups (dates, then times), so it works with the keyboard
 * (Tab into a group, arrow keys to move, Space to choose) and with screen readers without extra
 * ARIA. Unavailable dates and times stay in the list, disabled, with the reason as text.
 * Picking a time holds it for the cart; the place-order webhook confirms it.
 */

import { describeSelection } from './delivery-slots-engine.js';

export const ATTRIBUTES = {
  date: 'delivery_date',
  profile: 'delivery_profile',
  slot: 'delivery_slot',
};

export const DEFAULT_TEXT = {
  available: '',
  blackout: 'Unavailable',
  chooseDate: 'Date',
  chooseTime: 'Time',
  closed: 'Closed',
  cutoff: 'Cut-off passed',
  deliveryHint: 'Choose when you’d like your order delivered.',
  deliveryTitle: 'Delivery date and time',
  error: 'We couldn’t load delivery times. Please try again.',
  fee: '+{fee}',
  free: '',
  full: 'Full',
  held: '{when} is held for you for {minutes} minutes.',
  heldNote: 'Held for you',
  holding: 'Holding {when}…',
  holiday: 'Closed',
  'lead-time': 'Too soon',
  loading: 'Loading delivery times…',
  moreDates: 'Show later dates',
  noDates: 'No delivery times are available. Please choose another shipping method or contact us.',
  'no-slots': 'No times',
  'out-of-range': 'Unavailable',
  past: 'Passed',
  pickupHint: 'Choose when you’d like to collect your order.',
  pickupTitle: 'Pickup date and time',
  remaining: '{count} left',
  required: 'Please choose a date and time.',
  retry: 'Try again',
  'same-day-off': 'Not today',
  timesFor: 'Times on {date}',
  timezone: 'Times are shown in {zone} time.',
  unheld: 'We’ll confirm {when} when you place your order.',
};

const METHOD = /^[A-Za-z0-9_-]{1,128}$/;
let instances = 0;

function fill(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match));
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * The shipping method code (carrier_method) from the shapes the drop-ins use: a string,
 * { carrier: { code }, code }, { carrierCode, methodCode } or { carrier_code, method_code }.
 */
export function shippingMethodCode(method) {
  if (!method) return '';
  if (typeof method === 'string') return METHOD.test(method) ? method : '';
  const carrier = method.carrier?.code ?? method.carrierCode ?? method.carrier_code ?? '';
  const code = method.code ?? method.methodCode ?? method.method_code ?? '';
  const joined = carrier && code ? `${carrier}_${code}` : '';
  return METHOD.test(joined) ? joined : '';
}

/** The cart's selected shipping method from a checkout drop-in Cart (`checkout/updated`). */
export function methodFromCart(cart) {
  const address = cart?.shippingAddresses?.[0] ?? cart?.shipping_addresses?.[0];
  return shippingMethodCode(address?.selectedShippingMethod ?? address?.selected_shipping_method);
}

/** The custom attributes for setCustomAttributesOnCart. Empty when nothing is chosen. */
export function selectionAttributes(selection) {
  if (!selection?.date || !selection?.slot) return [];
  return [
    { attribute_code: ATTRIBUTES.date, value: selection.date },
    { attribute_code: ATTRIBUTES.slot, value: selection.slot },
    { attribute_code: ATTRIBUTES.profile, value: selection.profile ?? '' },
  ];
}

export const SET_ATTRIBUTES_MUTATION = `mutation SetDeliverySlot($cartId: String!, $attributes: [CustomAttributeInput]) {
  setCustomAttributesOnCart(input: { cart_id: $cartId, custom_attributes: $attributes }) {
    cart { id }
  }
}`;

function formatDate(date, locale, options) {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

function formatMoney(amount, locale, currency) {
  if (!currency) return amount.toFixed(2);
  return new Intl.NumberFormat(locale, { currency, style: 'currency' }).format(amount);
}

function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return '';
  }
}

/**
 * Mounts the picker into `container` and returns its controller.
 *
 * @param {HTMLElement} container
 * @param {object} options
 * @param {string} options.availabilityEndpoint URL of the `delivery-slots/availability` action
 * @param {string} [options.holdEndpoint] URL of the `delivery-slots/hold` action
 * @param {string} [options.storeView] store view code
 * @param {string} [options.locale] defaults to `<html lang>`
 * @param {string} [options.currency] currency code for slot fees, for example 'GBP'
 * @param {object} [options.events] the drop-in event bus; the picker then follows the cart
 * @param {Function} [options.graphql] `(query, { variables }) => Promise` for saveToCart
 * @param {Function} [options.onChange] called with the selection (or null) when it changes
 * @param {number} [options.maxDates] dates shown before "Show later dates" (default 14)
 * @param {object} [options.text] replaces any of DEFAULT_TEXT, for translations
 * @param {Function} [options.fetch] for tests
 */
export function mountDeliverySlots(container, options = {}) {
  instances += 1;
  const id = `delivery-slots-${instances}`;
  const text = { ...DEFAULT_TEXT, ...options.text };
  const locale = options.locale || document.documentElement.lang || undefined;
  const doFetch = options.fetch ?? ((...args) => window.fetch(...args));
  const maxDates = options.maxDates ?? 14;
  const state = {
    cartId: '',
    data: null,
    date: '',
    expanded: false,
    holdSeq: 0,
    loadSeq: 0,
    method: null,
    selection: null,
    unsubscribe: [],
  };

  const root = element('section', 'delivery-slots');
  root.setAttribute('aria-labelledby', `${id}-title`);
  root.hidden = true;
  const title = element('h3', 'delivery-slots__title');
  title.id = `${id}-title`;
  const hint = element('p', 'delivery-slots__hint');
  hint.id = `${id}-hint`;
  const body = element('div', 'delivery-slots__body');
  const status = element('p', 'delivery-slots__status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const error = element('p', 'delivery-slots__error');
  error.id = `${id}-error`;
  error.setAttribute('role', 'alert');
  error.hidden = true;
  root.append(title, hint, body, status, error);
  container.replaceChildren(root);

  function setError(message) {
    error.textContent = message || '';
    error.hidden = !message;
    body.querySelectorAll('fieldset').forEach((fieldset) => {
      const describedBy = [`${id}-hint`, message ? `${id}-error` : ''].filter(Boolean).join(' ');
      fieldset.setAttribute('aria-describedby', describedBy);
    });
  }

  function setSelection(selection) {
    const before = JSON.stringify(state.selection);
    state.selection = selection;
    if (JSON.stringify(selection) !== before) options.onChange?.(selection);
  }

  function whenText(day, slot) {
    return describeSelection({
      date: day.date, end: slot.end, label: slot.label, start: slot.start,
    }, locale);
  }

  async function postHold(payload) {
    const response = await doFetch(options.holdEndpoint, {
      body: JSON.stringify(payload),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
    });
    const json = await response.json().catch(() => ({}));
    return { json, ok: response.ok, status: response.status };
  }

  async function hold(day, slot) {
    state.holdSeq += 1;
    const seq = state.holdSeq;
    const when = whenText(day, slot);
    setSelection({
      date: day.date, held: false, profile: state.data.profile.code, slot: slot.code,
    });
    if (!(options.holdEndpoint && state.cartId)) {
      status.textContent = fill(text.unheld, { when });
      return;
    }
    status.textContent = fill(text.holding, { when });
    try {
      const result = await postHold({
        cartId: state.cartId,
        date: day.date,
        shippingMethod: state.method,
        slot: slot.code,
        store: options.storeView ?? '',
      });
      if (seq !== state.holdSeq) return;
      if (result.ok) {
        setSelection({ ...state.selection, held: true });
        // Minutes, not a clock time: the shopper's zone may differ from the store's.
        const left = Date.parse(result.json.hold.expiresAt) - Date.now();
        const minutes = Math.max(1, Math.round(left / 60000));
        status.textContent = fill(text.held, { minutes, when });
        return;
      }
      if (result.status === 409) {
        // Taken or closed meanwhile: say why and show fresh availability.
        setSelection(null);
        status.textContent = '';
        setError(result.json.error || text.full);
        // eslint-disable-next-line no-use-before-define
        await load(true);
        return;
      }
      status.textContent = fill(text.unheld, { when });
    } catch {
      if (seq === state.holdSeq) status.textContent = fill(text.unheld, { when });
    }
  }

  function releaseHold() {
    if (!(options.holdEndpoint && state.cartId && state.selection?.held)) return;
    postHold({ cartId: state.cartId, release: true }).catch(() => {});
  }

  function reasonText(reason) {
    return text[reason] ?? text.closed;
  }

  function slotOption(day, offered, checked) {
    // The shopper's own held place counts towards capacity, so a slot can look full to them.
    const heldByMe = checked && state.selection?.held;
    const slot = heldByMe ? { ...offered, available: true, reason: undefined } : offered;
    const label = element('label', 'delivery-slots__slot');
    const input = element('input');
    input.type = 'radio';
    input.name = `${id}-slot`;
    input.value = slot.code;
    input.disabled = !slot.available;
    input.checked = checked;
    const time = element('span', 'delivery-slots__slot-time', `${slot.start}–${slot.end}`);
    const plain = slot.label === `${slot.start}–${slot.end}`;
    const name = element('span', 'delivery-slots__slot-label', plain ? '' : slot.label);
    const extra = [];
    if (heldByMe) extra.push(text.heldNote);
    else if (!slot.available) extra.push(reasonText(slot.reason));
    else if (typeof slot.remaining === 'number') extra.push(fill(text.remaining, { count: slot.remaining }));
    if (slot.fee > 0) {
      extra.push(fill(text.fee, { fee: formatMoney(slot.fee, locale, options.currency) }));
    }
    const note = element('span', 'delivery-slots__slot-note', extra.join(' · '));
    label.append(input, time, name, note);
    if (!slot.available) label.classList.add('delivery-slots__slot--unavailable');
    input.addEventListener('change', () => {
      setError('');
      hold(day, slot);
    });
    return label;
  }

  function renderSlots(fieldset, day) {
    fieldset.replaceChildren();
    const legend = element('legend', 'delivery-slots__legend', fill(text.timesFor, {
      date: formatDate(day.date, locale, { day: 'numeric', month: 'long', weekday: 'long' }),
    }));
    const list = element('div', 'delivery-slots__slot-list');
    day.slots.forEach((slot) => {
      const checked = state.selection?.date === day.date && state.selection?.slot === slot.code;
      list.append(slotOption(day, slot, checked && (slot.available || state.selection.held)));
    });
    fieldset.append(legend, list);
  }

  function dateOption(day, checked) {
    const label = element('label', 'delivery-slots__date');
    const input = element('input');
    input.type = 'radio';
    input.name = `${id}-date`;
    input.value = day.date;
    input.disabled = !day.available;
    input.checked = checked;
    // The visible parts are short; the input's accessible name is the full date.
    input.setAttribute('aria-label', formatDate(day.date, locale, { day: 'numeric', month: 'long', weekday: 'long' })
      + (day.available ? '' : `, ${day.name || reasonText(day.reason)}`));
    label.append(
      input,
      element('span', 'delivery-slots__date-weekday', formatDate(day.date, locale, { weekday: 'short' })),
      element('span', 'delivery-slots__date-day', formatDate(day.date, locale, { day: 'numeric' })),
      element('span', 'delivery-slots__date-month', formatDate(day.date, locale, { month: 'short' })),
    );
    if (!day.available) {
      label.classList.add('delivery-slots__date--unavailable');
      label.append(element('span', 'delivery-slots__date-note', day.name || reasonText(day.reason)));
    }
    return label;
  }

  function render() {
    const { data } = state;
    body.replaceChildren();
    const pickup = data.profile.type === 'pickup';
    title.textContent = pickup ? text.pickupTitle : text.deliveryTitle;
    const zone = data.profile.timezone;
    hint.textContent = [
      pickup ? text.pickupHint : text.deliveryHint,
      zone && zone !== browserZone() ? fill(text.timezone, { zone: zone.replace(/_/g, ' ') }) : '',
    ].filter(Boolean).join(' ');

    const open = data.dates.filter((day) => day.available);
    if (!open.length) {
      body.append(element('p', 'delivery-slots__empty', text.noDates));
      return;
    }
    if (!data.dates.some((day) => day.date === state.date && day.available)) {
      state.date = state.selection?.date && open.some((d) => d.date === state.selection.date)
        ? state.selection.date
        : open[0].date;
    }

    const dates = element('fieldset', 'delivery-slots__dates');
    dates.append(element('legend', 'delivery-slots__legend', text.chooseDate));
    const list = element('div', 'delivery-slots__date-list');
    const lastShown = data.dates.indexOf(open[0]) + maxDates;
    const shown = state.expanded ? data.dates : data.dates.filter((day, index) => index < lastShown
      || day.date === state.date);
    shown.forEach((day) => list.append(dateOption(day, day.date === state.date)));
    dates.append(list);
    if (shown.length < data.dates.length) {
      const more = element('button', 'delivery-slots__more', text.moreDates);
      more.type = 'button';
      more.addEventListener('click', () => {
        state.expanded = true;
        render();
        // Continue where the list ended, on the first date that can be chosen.
        const next = data.dates.slice(lastShown).find((day) => day.available);
        body.querySelector(`input[value="${next?.date}"]`)?.focus();
      });
      dates.append(more);
    }

    const slots = element('fieldset', 'delivery-slots__slots');
    renderSlots(slots, data.dates.find((day) => day.date === state.date));
    list.addEventListener('change', (event) => {
      state.date = event.target.value;
      setError('');
      renderSlots(slots, data.dates.find((day) => day.date === state.date));
    });
    body.append(dates, slots);
    setError(error.hidden ? '' : error.textContent);
  }

  async function fetchAvailability() {
    const url = new URL(options.availabilityEndpoint, window.location.href);
    url.searchParams.set('method', state.method);
    if (options.storeView) url.searchParams.set('store', options.storeView);
    const response = await doFetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Delivery slots unavailable (${response.status})`);
    return response.json();
  }

  function showRetry() {
    body.replaceChildren();
    const retry = element('button', 'delivery-slots__retry', text.retry);
    retry.type = 'button';
    // eslint-disable-next-line no-use-before-define
    retry.addEventListener('click', () => load(true));
    body.append(element('p', 'delivery-slots__empty', text.error), retry);
  }

  async function load(keepError = false) {
    state.loadSeq += 1;
    const seq = state.loadSeq;
    if (!state.method || !options.availabilityEndpoint) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    root.setAttribute('aria-busy', 'true');
    if (!keepError) setError('');
    if (!state.data) status.textContent = text.loading;
    try {
      const data = await fetchAvailability();
      if (seq !== state.loadSeq) return;
      if (!data?.enabled || !data.profile) {
        state.data = null;
        root.hidden = true;
        releaseHold();
        setSelection(null);
        return;
      }
      state.data = data;
      if (state.selection) {
        const day = data.dates.find((d) => d.date === state.selection.date);
        const slot = day?.slots.find((s) => s.code === state.selection.slot);
        const keep = slot && (slot.available || state.selection.held)
          && state.selection.profile === data.profile.code;
        if (!keep) setSelection(null);
      }
      if (status.textContent === text.loading) status.textContent = '';
      render();
    } catch (loadError) {
      if (seq !== state.loadSeq) return;
      // Slots must never break checkout: show a retry, and let the webhook decide at order time.
      console.warn(loadError.message);
      status.textContent = '';
      showRetry();
    } finally {
      if (seq === state.loadSeq) root.removeAttribute('aria-busy');
    }
  }

  const controller = {
    /** Follows a checkout drop-in Cart, or `{ cartId, shippingMethod }`. */
    update(input = {}) {
      const cartId = input.id ?? input.cartId ?? state.cartId;
      const method = input.shippingMethod !== undefined
        ? shippingMethodCode(input.shippingMethod)
        : methodFromCart(input);
      const changed = method !== state.method;
      state.cartId = typeof cartId === 'string' ? cartId : '';
      if (!changed) return Promise.resolve();
      if (state.selection?.held) releaseHold();
      state.method = method;
      state.data = null;
      state.date = '';
      state.expanded = false;
      setSelection(null);
      status.textContent = '';
      return load();
    },

    /** Reloads availability (for example after a long pause). */
    refresh: () => load(),

    /** The current choice: { date, slot, profile, held } or null. */
    getSelection: () => (state.selection ? { ...state.selection } : null),

    /**
     * For the Place Order button's handleValidation: false (with a message, and focus on the
     * picker) when a required slot isn't chosen. True when no slot applies.
     */
    validate() {
      if (root.hidden || !state.data?.profile?.required) return true;
      if (state.selection) return true;
      setError(text.required);
      // A date is usually chosen already, so start at its first free time.
      const target = body.querySelector('.delivery-slots__slots input:not(:disabled)')
        ?? body.querySelector('input[type="radio"]:not(:disabled)');
      target?.focus();
      root.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      return false;
    },

    /**
     * Writes the choice to the cart as custom attributes (setCustomAttributesOnCart), so it is
     * copied to the order and shown in the Admin. Call it right before placing the order.
     * Returns true when saved; false (and logs) when GraphQL isn't available or refuses.
     */
    async saveToCart(cartId = state.cartId) {
      if (!options.graphql || !cartId) return false;
      try {
        const result = await options.graphql(SET_ATTRIBUTES_MUTATION, {
          variables: { attributes: selectionAttributes(state.selection), cartId },
        });
        if (result?.errors?.length) throw new Error(result.errors[0].message);
        return true;
      } catch (saveError) {
        // The hold still books the slot; the attributes only add it to the order record.
        console.warn(`Delivery slot not saved on the cart: ${saveError.message}`);
        return false;
      }
    },

    /** Removes the picker and its event listeners. */
    destroy() {
      state.unsubscribe.forEach((off) => off?.());
      container.replaceChildren();
    },
  };

  if (options.events?.on) {
    const follow = (cart) => cart && controller.update(cart);
    const followValues = (values) => {
      if (values?.selectedShippingMethod) {
        controller.update({ shippingMethod: values.selectedShippingMethod });
      }
    };
    state.unsubscribe.push(
      options.events.on('checkout/initialized', follow, { eager: true })?.off,
      options.events.on('checkout/updated', follow)?.off,
      options.events.on('checkout/values', followValues)?.off,
    );
  }

  return controller;
}
