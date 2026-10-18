export { invitationsPublicRouter, teachersRouter } from "./invitations.routes.js";
export {
  INVITE_TTL_MS,
  invitationsService,
  registerAcceptHandler,
  type AcceptHandler,
  type InviteSpec,
} from "./invitations.service.js";
