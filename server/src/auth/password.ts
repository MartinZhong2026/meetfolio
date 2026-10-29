import { hash, verify } from '@node-rs/argon2';

// argon2id with the library defaults (m=19MiB, t=2, p=1) — OWASP-recommended minimum profile.
export const hashPassword = (password: string) => hash(password);

export async function verifyPassword(hashed: string, password: string) {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;
/** A genuine hash used to equalise timing when the account does not exist. */
export const dummyHash = () => (dummy ??= hash('meetfolio-timing-equaliser'));
