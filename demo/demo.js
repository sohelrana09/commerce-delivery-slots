import {
  availability,
  checkSelection,
  publicAvailability,
  selectProfile,
  slotKey,
} from '/storefront/scripts/delivery-slots-engine.js';
import { mountDeliverySlots } from '/storefront/scripts/delivery-slots.js';

// The Admin examples, switched on. Kept in sync with src/common/slots/default-profiles.js.
const profiles = await fetch('/demo/profiles.json').then((r) => r.json());
const booked = {};
const holds = new Map();
const CART_ID = 'demo-cart-0000000000000001';
const log = document.getElementById('log');

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' }, status });
}

function write(line) {
  log.textContent = `${new Date().toLocaleTimeString()}  ${line}\n${log.textContent === 'Nothing yet.' ? '' : log.textContent}`;
}

/** The two storefront actions, answered in the browser with the same engine. */
async function fakeBackend(url, init = {}) {
  await new Promise((resolve) => { setTimeout(resolve, 250); });
  const { pathname, searchParams } = new URL(url, window.location.href);
  if (pathname.endsWith('/availability')) {
    const profile = selectProfile(profiles, { shippingMethod: searchParams.get('method'), storeView: 'default' });
    if (!profile) return json({ enabled: true, profile: null });
    return json({ enabled: true, ...publicAvailability(availability(profile, { booked }), { showRemaining: true }) });
  }
  const body = JSON.parse(init.body);
  const previous = holds.get(body.cartId);
  if (body.release) {
    if (previous) booked[previous.key] -= 1;
    holds.delete(body.cartId);
    return json({ released: Boolean(previous) });
  }
  const profile = selectProfile(profiles, body);
  const check = checkSelection(profile, body, { booked });
  if (!check.ok && !(previous && previous.key === slotKey(profile.code, body.date, body.slot))) {
    return json({ error: 'That time slot has just filled up. Please choose another.', reason: check.reason }, 409);
  }
  const key = slotKey(profile.code, body.date, body.slot);
  if (previous?.key !== key) {
    if (previous) booked[previous.key] -= 1;
    booked[key] = (booked[key] ?? 0) + 1;
  }
  const hold = { ...check.slot, date: body.date, expiresAt: new Date(Date.now() + 20 * 60000).toISOString(), key, profile: profile.code, slot: body.slot };
  holds.set(body.cartId, hold);
  write(`Held ${body.date} ${hold.start}–${hold.end} for the cart`);
  return json({ hold });
}

const picker = mountDeliverySlots(document.getElementById('delivery-slots'), {
  availabilityEndpoint: '/api/delivery-slots/availability',
  currency: 'GBP',
  fetch: fakeBackend,
  graphql: async (query, { variables }) => {
    write(`setCustomAttributesOnCart ${JSON.stringify(variables.attributes)}`);
    return { data: { setCustomAttributesOnCart: { cart: { id: variables.cartId } } } };
  },
  holdEndpoint: '/api/delivery-slots/hold',
  storeView: 'default',
});

const methods = document.querySelectorAll('input[name="method"]');
const follow = () => picker.update({ cartId: CART_ID, shippingMethod: document.querySelector('input[name="method"]:checked').value });
methods.forEach((input) => input.addEventListener('change', follow));
follow();

document.getElementById('place').addEventListener('click', async () => {
  if (!picker.validate()) {
    write('Place order blocked: no slot chosen');
    return;
  }
  await picker.saveToCart(CART_ID);
  const selection = picker.getSelection();
  write(selection ? `Order placed with ${selection.date} / ${selection.slot}` : 'Order placed (no slot needed)');
});

document.getElementById('fill').addEventListener('click', async () => {
  const method = document.querySelector('input[name="method"]:checked').value;
  const profile = selectProfile(profiles, { shippingMethod: method });
  const next = profile && availability(profile, { booked }).dates.flatMap((d) => d.slots).find((s) => s.available && s.capacity);
  if (!next) return;
  booked[next.key] = next.capacity;
  write(`Other shoppers filled ${next.key}`);
  await picker.refresh();
});
