// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { answerChallenge, encodeHash, hashNewPassword, passwordLength } from './passwordProof';

// Computed with the server's own code (api/password_proof.py, api/passwords.py).
const SALT = Uint8Array.from({ length: 16 }, (_, index) => index);
const ANSWER = { challenge: 'dGVzdC1jaGFsbGVuZ2UtMQ', salt: 'AAECAwQFBgcICQoLDA0ODw', log_n: 15, r: 8, p: 1 };
const VECTORS = [
  {
    password: 'correct horse 1',
    hash: 'scrypt$15$8$1$AAECAwQFBgcICQoLDA0ODw$jMHW70RgPxCdz8iFOOFtYcsmRx-bGbrf8bBUaszNuzQ',
    signIn: 'cln05ztuDGuwdRBcq5wTODTIoRCSUXk7yQicD9KFAIs',
    confirm: '7TpS_TGPmGjY7O_d2PwqrhiDiPnhCIl-fw9Sr6EhzhM'
  },
  {
    password: '密码 pass 1',
    hash: 'scrypt$15$8$1$AAECAwQFBgcICQoLDA0ODw$wh1fFVU3d1IGmsouRc9nhTRXmJESyttKsGB3Lt54DeM',
    signIn: 'bgVW9J4FrNuAb4S5wQZPnmQ5W0QkTovm_LMHU7e2yJU',
    confirm: 'Jv_7o4ULAgeyiMO_dsa2JgO7MY6A4k1hYYLvMXrEqIs'
  }
];

describe('passwordProof', () => {
  describe.each(VECTORS)('the password $password', ({ password, hash, signIn, confirm }) => {
    it('hashes to the server\'s string for a fixed salt', async () => {
      expect(await encodeHash(password, SALT)).toBe(hash);
    });

    it('answers a sign-in challenge like the server does', async () => {
      expect(await answerChallenge(password, ANSWER, 'sign_in')).toBe(signIn);
    });

    it('answers a confirmation challenge like the server does', async () => {
      expect(await answerChallenge(password, ANSWER, 'confirm')).toBe(confirm);
    });
  });

  it('hashes a new password with a fresh salt each time', async () => {
    const first = await hashNewPassword('correct horse 1');
    const second = await hashNewPassword('correct horse 1');
    for (const hash of [first, second]) {
      const parts = hash.split('$');
      expect(parts.slice(0, 4)).toEqual(['scrypt', '15', '8', '1']);
      expect(parts[4]).toHaveLength(22);
      expect(parts[5]).toHaveLength(43);
      expect(hash).toMatch(/^[A-Za-z0-9$_-]+$/);
    }
    expect(second).not.toBe(first);
  });

  it('refuses cost values outside the server\'s bounds', async () => {
    const outOfBounds = [{ log_n: 9 }, { log_n: 18 }, { r: 0 }, { r: 17 }, { p: 0 }, { p: 5 }, { log_n: 15.5 }, { log_n: '15' }];
    for (const costs of outOfBounds) {
      await expect(answerChallenge('x', { ...ANSWER, ...costs }, 'sign_in')).rejects.toThrow();
    }
  });

  it('refuses a malformed challenge, salt or purpose', async () => {
    await expect(answerChallenge('x', { ...ANSWER, challenge: '' }, 'sign_in')).rejects.toThrow();
    await expect(answerChallenge('x', { ...ANSWER, challenge: 'two words' }, 'sign_in')).rejects.toThrow();
    await expect(answerChallenge('x', { ...ANSWER, salt: 'not base64!' }, 'sign_in')).rejects.toThrow();
    await expect(answerChallenge('x', { ...ANSWER, salt: '' }, 'sign_in')).rejects.toThrow();
    await expect(answerChallenge('x', ANSWER, 'other')).rejects.toThrow();
    await expect(answerChallenge('x', null, 'sign_in')).rejects.toThrow();
  });

  it('counts a password in code points like the server', () => {
    expect(passwordLength('😀a')).toBe(2);
    expect(passwordLength('😀'.repeat(8))).toBe(8);
    expect(passwordLength('')).toBe(0);
    expect(passwordLength('密码 pass 1')).toBe(9);
  });
});
