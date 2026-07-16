const BASE36_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase36(bytes: Uint8Array): string {
  return Array.from(
    bytes,
    (b) => BASE36_ALPHABET[b % BASE36_ALPHABET.length],
  ).join("");
}

function randomBase36(length: number): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(length);
    cryptoApi.getRandomValues(bytes);
    return bytesToBase36(bytes);
  }
  return Math.random()
    .toString(36)
    .slice(2, 2 + length)
    .padEnd(length, "0");
}

export function makeId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return `${prefix}-${cryptoApi.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  }
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(8);
    cryptoApi.getRandomValues(bytes);
    return `${prefix}-${bytesToHex(bytes)}`;
  }
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function makeTimedId(prefix: string): string {
  const time = Date.now().toString(36);
  const random = randomBase36(6);
  return `${prefix}-${time}${random}`;
}
