import { acceptInvitationSchema, inviteTeacherSchema, peekInvitationSchema } from "@semwise/shared";
import type { Request, Response } from "express";
import { sendData } from "../../common/http/response.js";
import { SESSION_COOKIE, sessionCookieOptions } from "../auth/index.js";
import { getActor } from "../authz/index.js";
import { invitationsService } from "./invitations.service.js";

export const invitationsController = {
  /** POST, not GET: the token must never sit in a URL or a log line. */
  async preview(req: Request, res: Response): Promise<void> {
    const { token } = peekInvitationSchema.parse(req.body);
    sendData(res, await invitationsService.preview(token));
  },

  async inviteTeacher(req: Request, res: Response): Promise<void> {
    const input = inviteTeacherSchema.parse(req.body);
    sendData(res, await invitationsService.inviteTeacher(getActor(req), input), { status: 202 });
  },

  async listTeachers(req: Request, res: Response): Promise<void> {
    sendData(res, await invitationsService.listTeachers(getActor(req)));
  },

  async accept(req: Request, res: Response): Promise<void> {
    const input = acceptInvitationSchema.parse(req.body);
    const { result, session } = await invitationsService.accept(input, {
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
    if (session) {
      res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions(session.cookieExpiresAt));
    }
    sendData(res, result);
  },
};
