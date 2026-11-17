/**
 * Optional Commerce webhook signature check. When the Commerce webhook signing key pair is set
 * up (Stores > Settings > Configuration > Adobe Services > Webhooks > Regenerate key pair) and
 * its public key is given to the action as WEBHOOK_PUBLIC_KEY, every webhook call must carry a
 * valid `x-adobe-commerce-webhook-signature`: a base64 RSA-SHA256 signature of the raw body.
 *
 * The place-order action runs as a `raw-http: true` web action, so the exact bytes Commerce
 * signed reach it in `__ow_body`, and `webhookPayload` parses them whether or not a key is set.
 * App Management also registers it with `require-adobe-auth: true`, which already proves the
 * caller is Commerce; the signature adds a second check where your setup provides it.
 */

import { createVerify } from "node:crypto";

export const SIGNATURE_HEADER = "x-adobe-commerce-webhook-signature";

const BASE64 = /^[A-Za-z0-9+/=\s]+$/u;

function pem(key) {
  const text = String(key).replaceAll("\\n", "\n").trim();
  if (text.includes("BEGIN PUBLIC KEY")) {
    return text;
  }
  const body = text
    .replaceAll(/\s+/gu, "")
    .match(/.{1,64}/gu)
    ?.join("\n");
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
}

function rawBody(params) {
  const body = params.__ow_body;
  if (typeof body !== "string") {
    return null;
  }
  // raw-http actions receive the body base64-encoded unless it is plain text.
  const looksBase64 = BASE64.test(body) && !body.trim().startsWith("{");
  return looksBase64 ? Buffer.from(body, "base64").toString("utf8") : body;
}

/**
 * The webhook payload: the parsed raw body of a raw-http request, or the params themselves
 * (without the `__ow_*` request fields) when the platform already parsed it.
 */
export function webhookPayload(params = {}) {
  const raw = rawBody(params);
  if (raw !== null && raw.trim() !== "") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => !key.startsWith("__ow_")),
  );
}

/**
 * `{ checked: false }` when no public key is configured, otherwise `{ checked: true, valid }`.
 * Pass the parsed payload back with `body` when the signature is valid.
 */
export function verifyWebhookSignature(params = {}) {
  const key = params.WEBHOOK_PUBLIC_KEY;
  if (!key || String(key).trim() === "") {
    return { checked: false };
  }
  const signature = params.__ow_headers?.[SIGNATURE_HEADER];
  const body = rawBody(params);
  if (!(signature && body !== null)) {
    return { checked: true, valid: false };
  }
  try {
    const verifier = createVerify("SHA256");
    verifier.update(body);
    const valid = verifier.verify(pem(key), signature, "base64");
    return valid
      ? { body: JSON.parse(body), checked: true, valid }
      : { checked: true, valid };
  } catch {
    return { checked: true, valid: false };
  }
}
