import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id with the OWASP-recommended minimum cost (19 MiB, 2 passes, 1 lane).
 * The algorithm, cost and salt are stored inside the hash string, so these numbers
 * can be raised later without breaking existing passwords.
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // A malformed hash is a failed login, never a crash.
    return false;
  }
}

/**
 * A real hash of a random value. Login verifies against it when the email is unknown, so a wrong
 * email takes as long as a wrong password and response times reveal nothing.
 */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(`dummy-${Math.random()}`);
  return dummyHash;
}
