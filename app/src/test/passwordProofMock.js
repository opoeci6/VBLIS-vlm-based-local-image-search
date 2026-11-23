// A stand-in for utils/passwordProof.js in the tests that are not about the scrypt maths (real scrypt takes a
// fraction of a second per call, and the suite would crawl). Use it with
//   vi.mock('../utils/passwordProof', async () => (await import('../test/passwordProofMock')).passwordProofMock);
// The fakes are deterministic and carry what they were given, so a test can see which password was hashed or
// proved: a hash holds the password reversed, a proof holds the challenge.

export const fakeHash = (password) => `scrypt$15$8$1$SALT$${[...password].reverse().join('')}`;
export const fakeProof = (purpose, challenge) => `${purpose}-proof-for-${challenge}`;

// What the server's challenge routes answer; a test can override fields.
export const challengeAnswer = (challenge, extra = {}) => ({
  challenge,
  salt: 'AAECAwQFBgcICQoLDA0ODw',
  log_n: 15,
  r: 8,
  p: 1,
  ...extra
});

export const passwordProofMock = {
  // Refuses costs above the server's bound, like the real one, so a test can see the page's reaction
  answerChallenge: async (_password, answer, purpose) => {
    if (!(answer.log_n <= 17)) throw new Error('Cost values out of bounds');
    return fakeProof(purpose, answer.challenge);
  },
  hashNewPassword: async (password) => fakeHash(password),
  passwordLength: (password) => [...password].length
};

// Every request body sent through a fetch mock must be free of the plain-password fields the server no
// longer accepts, and of the typed passwords themselves.
export const expectNoPlainPassword = (expect, fetchMock, ...typed) => {
  for (const [, init] of fetchMock.mock.calls) {
    if (!init?.body) continue;
    const body = JSON.parse(init.body);
    for (const key of ['password', 'current_password', 'new_password']) expect(body).not.toHaveProperty(key);
    for (const password of typed) expect(init.body).not.toContain(password);
  }
};
