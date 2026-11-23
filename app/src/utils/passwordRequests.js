// The requests around a password proof (see passwordProof.js): asking the server for a challenge and
// answering it, hashing a new password, and sending a change that needs the account's own password. Kept
// apart from passwordProof.js so a test can fake the slow scrypt and still see these requests.
import { requestJson } from './serverRequest';
import { answerChallenge, hashNewPassword } from './passwordProof';
import i18n from '../i18n';

const refusal = (code) => ({ ok: false, status: 0, code, message: i18n.t(`session:server.errors.codes.${code}`) });

// Asks for a challenge and answers it. Resolves to { ok: true, challenge, proof }, or a failure shaped like
// requestJson's (a refusal of the request, or code 'challenge_invalid' for an answer the page won't work on).
const fetchProof = async (path, body, password, purpose) => {
  const asked = await requestJson('POST', path, body);
  if (!asked.ok) return asked;
  try {
    return { ok: true, challenge: asked.data.challenge, proof: await answerChallenge(password, asked.data, purpose) };
  } catch {
    return refusal('challenge_invalid');
  }
};

// The proof for signing in as `name`.
export const fetchSignInProof = (name, password) => fetchProof('/auth/challenge', { name }, password, 'sign_in');

// The proof that the signed-in account's own password is `password`.
export const fetchConfirmProof = (password) => fetchProof('/auth/confirm-challenge', {}, password, 'confirm');

// The hash a new password is sent as: { ok: true, hash } or a failure (code 'password_hash_invalid').
export const hashPassword = async (password) => {
  try {
    return { ok: true, hash: await hashNewPassword(password) };
  } catch {
    return refusal('password_hash_invalid');
  }
};

// requestJson for a change that may carry the account's own password. With a `password`, it asks for a
// challenge and sends the proof as `confirm`; a 403 challenge_expired (the challenge was too old or used) is
// answered once with a new challenge. Without one it sends `body` as it is.
export async function requestConfirmed(method, path, body, password) {
  if (!password) return requestJson(method, path, body);
  let result;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const proof = await fetchConfirmProof(password);
    if (!proof.ok) return proof;
    result = await requestJson(method, path, { ...body, confirm: { challenge: proof.challenge, proof: proof.proof } });
    if (result.ok || result.code !== 'challenge_expired') return result;
  }
  return result;
}
