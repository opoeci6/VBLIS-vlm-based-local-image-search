// Proving a password without sending it (see api/password_proof.py for the server's side).
//
// The page never sends a password: to sign in, or to confirm a change with its own password, it answers a
// challenge with HMAC-SHA256 keyed by the scrypt key of the password; a new password goes as its scrypt hash.
// Plain JavaScript (@noble/hashes), because crypto.subtle doesn't exist on a plain-HTTP page.
import { scryptAsync } from '@noble/hashes/scrypt';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { randomBytes, utf8ToBytes } from '@noble/hashes/utils';

const PROOF_VERSION = 'vblis-proof-v1';
const PURPOSES = ['sign_in', 'confirm'];

// What the server writes for a new password; it refuses any other cost (password_hash_invalid).
const NEW_LOG_N = 15;
const NEW_R = 8;
const NEW_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

// The costs a challenge may ask for: the server's own bounds, so a broken answer can't freeze the page.
const MIN_LOG_N = 10;
const MAX_LOG_N = 17;
const MAX_R = 16;
const MAX_P = 4;
const MAX_SALT_BYTES = 64;
const MAX_CHALLENGE_CHARS = 128;

const toBase64Url = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text) => {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    throw new Error('Not base64url');
  }
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const inRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

// The length of a password the way the server counts it: in Unicode code points ("😀" is 1, not 2).
export const passwordLength = (password) => [...password].length;

const deriveKey = (password, salt, logN, r, p) => (
  scryptAsync(utf8ToBytes(password), salt, { N: 2 ** logN, r, p, dkLen: KEY_BYTES })
);

// The proof for a challenge answer { challenge, salt, log_n, r, p } (from POST /auth/challenge or
// /auth/confirm-challenge). `purpose` is 'sign_in' or 'confirm'. Throws on an answer outside the server's
// bounds, before doing any work.
export async function answerChallenge(password, answer, purpose) {
  if (!PURPOSES.includes(purpose)) throw new Error('Unknown purpose');
  const { challenge, salt, log_n: logN, r, p } = answer ?? {};
  if (!inRange(logN, MIN_LOG_N, MAX_LOG_N) || !inRange(r, 1, MAX_R) || !inRange(p, 1, MAX_P)) {
    throw new Error('Cost values out of bounds');
  }
  if (typeof challenge !== 'string' || !/^[\x21-\x7e]+$/.test(challenge) || challenge.length > MAX_CHALLENGE_CHARS) {
    throw new Error('Bad challenge');
  }
  const saltBytes = fromBase64Url(salt);
  if (saltBytes.length === 0 || saltBytes.length > MAX_SALT_BYTES) throw new Error('Bad salt');
  const key = await deriveKey(password, saltBytes, logN, r, p);
  const message = utf8ToBytes(`${PROOF_VERSION}|${purpose}|${challenge}`);
  return toBase64Url(hmac(sha256, key, message));
}

// The hash string of a new password with the given salt: scrypt$15$8$1$<salt>$<key>.
export async function encodeHash(password, saltBytes) {
  const key = await deriveKey(password, saltBytes, NEW_LOG_N, NEW_R, NEW_P);
  return `scrypt$${NEW_LOG_N}$${NEW_R}$${NEW_P}$${toBase64Url(saltBytes)}$${toBase64Url(key)}`;
}

// The hash of a new password, with a fresh random salt: what the server is sent in place of the password.
export const hashNewPassword = (password) => encodeHash(password, randomBytes(SALT_BYTES));
