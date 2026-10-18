import { usersRepository } from "./users.repository.js";

export type UserStatus = "INVITED" | "ACTIVE" | "DEACTIVATED";

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string | null;
  status: UserStatus;
  failedLoginCount: number;
  lockedUntil: Date | null;
}

/** The single User entity. Other modules use these functions, never the repository. */
export const usersService = {
  findByEmail(email: string): Promise<UserRecord | null> {
    return usersRepository.findByEmail(email);
  },

  findById(id: string): Promise<UserRecord | null> {
    return usersRepository.findById(id);
  },

  findManyByIds(ids: string[]): Promise<UserRecord[]> {
    return ids.length ? usersRepository.findManyByIds(ids) : Promise.resolve([]);
  },

  /** Returns the existing account for this email, or creates an invited one. */
  async findOrCreateInvited(email: string, displayName: string): Promise<UserRecord> {
    const existing = await usersRepository.findByEmail(email);
    if (existing) return existing;
    return usersRepository.create({ email, displayName, status: "INVITED" });
  },

  createActive(email: string, displayName: string, passwordHash: string): Promise<UserRecord> {
    return usersRepository.create({ email, displayName, passwordHash, status: "ACTIVE" });
  },

  setPassword(id: string, passwordHash: string): Promise<UserRecord> {
    return usersRepository.update(id, {
      passwordHash,
      failedLoginCount: 0,
      lockedUntil: null,
    });
  },

  activate(id: string, passwordHash: string, displayName?: string): Promise<UserRecord> {
    return usersRepository.update(id, {
      passwordHash,
      status: "ACTIVE",
      failedLoginCount: 0,
      lockedUntil: null,
      ...(displayName ? { displayName } : {}),
    });
  },

  setStatus(id: string, status: UserStatus): Promise<UserRecord> {
    return usersRepository.update(id, { status });
  },

  changeEmail(id: string, email: string): Promise<UserRecord> {
    return usersRepository.update(id, { email });
  },

  recordFailedLogin(id: string, failedLoginCount: number, lockedUntil: Date | null) {
    return usersRepository.update(id, { failedLoginCount, lockedUntil });
  },

  recordSuccessfulLogin(id: string, at: Date) {
    return usersRepository.update(id, { failedLoginCount: 0, lockedUntil: null, lastLoginAt: at });
  },
};
