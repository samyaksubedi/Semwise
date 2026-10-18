export { Action } from "./authz.rules.js";
export {
  adminProgramIds,
  authorize,
  authzService,
  can,
  hasRole,
  registerEnrollmentLoader,
} from "./authz.service.js";
export { getActor, getTenant, requireSuperAdmin, resolveTenant } from "./authz.middleware.js";
export type { Actor, ActorEnrollment, Resource } from "./authz.types.js";
