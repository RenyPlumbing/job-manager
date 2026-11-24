const PUBLIC_KEY = 'BEvR_HuocfRtsz6jNlAzm_W7NKng7XmUiNYp2c1s8GR9YD8t4mxH3FPm3FWwaDxrcz4ef3PZWBJNaI5pTFjM6Rw';
const PRIVATE_KEY = {
  d: 'DQ7myIbegcYBNY61ArA1RPP2GNyTNIh2JTFQNA75VtQ',
  x: 'S9H8e6hx9G2zPqM2UDOb9bs0qeDteZSI1inZzWzwZH0',
  y: 'YD8t4mxH3FPm3FWwaDxrcz4ef3PZWBJNaI5pTFjM6Rw',
};

function bytesToB64url(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concat(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

async function encryptPayload(subscription, payload) {
  const userPublic = b64urlToBytes(subscription.keys.p256dh);
  const auth = b64urlToBytes(subscription.keys.auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const remote = await crypto.subtle.importKey('raw', userPublic, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: remote }, local.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const secret = await hkdf(auth, shared, concat([new TextEncoder().encode('WebPush: info\0'), userPublic, localPublic]), 32);
  const key = await hkdf(salt, secret, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, secret, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);
  const cryptoKey = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const encoded = new TextEncoder().encode(payload);
  const padded = concat([encoded, new Uint8Array([2])]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cryptoKey, padded));
  const header = new Uint8Array(21 + localPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = localPublic.length;
  header.set(localPublic, 21);
  return concat([header, cipher]);
}

async function vapidAuthorization(endpoint) {
  const audience = new URL(endpoint).origin;
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = bytesToB64url(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: 'mailto:jobs@renyplumbing.com',
  })));
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', ...PRIVATE_KEY }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signed = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${body}`)));
  return `vapid t=${header}.${body}.${bytesToB64url(signed)}, k=${PUBLIC_KEY}`;
}

async function sendPush(subscription, message) {
  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    throw new Error('Missing push subscription');
  }
  const body = await encryptPayload(subscription, JSON.stringify(message));
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      TTL: '86400',
      Urgency: 'high',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: await vapidAuthorization(subscription.endpoint),
    },
    body,
  });
  if (!response.ok && response.status !== 201 && response.status !== 202) {
    throw new Error(`Push failed (${response.status})`);
  }
  return response.status;
}

export { sendPush, PUBLIC_KEY };
