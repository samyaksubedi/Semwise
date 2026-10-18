export interface AuthContext {
  userId: string;
  sessionId: string;
  /** The college chosen for this session; tenant routes use only this. */
  activeTenantId: string | null;
  isSuperAdmin: boolean;
}
