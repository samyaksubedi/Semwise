import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  setActiveTenantSchema,
} from "@semwise/shared";
import type { Request, Response } from "express";
import { sendData } from "../../common/http/response.js";
import { getAuth } from "./auth.middleware.js";
import { authService } from "./auth.service.js";
import { SESSION_COOKIE, clearSessionCookieOptions, sessionCookieOptions } from "./session.js";

function clearCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, clearSessionCookieOptions());
}

export const authController = {
  async login(req: Request, res: Response): Promise<void> {
    const input = loginSchema.parse(req.body);
    const result = await authService.login(input, {
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
    res.cookie(SESSION_COOKIE, result.token, sessionCookieOptions(result.cookieExpiresAt));
    sendData(res, result.view);
  },

  async logout(req: Request, res: Response): Promise<void> {
    if (req.auth) await authService.logout(req.auth);
    clearCookie(res);
    res.status(204).end();
  },

  async logoutAll(req: Request, res: Response): Promise<void> {
    await authService.logoutAll(getAuth(req));
    clearCookie(res);
    res.status(204).end();
  },

  async me(req: Request, res: Response): Promise<void> {
    sendData(res, await authService.me(getAuth(req)));
  },

  async setActiveTenant(req: Request, res: Response): Promise<void> {
    const input = setActiveTenantSchema.parse(req.body);
    sendData(res, await authService.setActiveTenant(getAuth(req), input.tenantId));
  },

  async changePassword(req: Request, res: Response): Promise<void> {
    await authService.changePassword(getAuth(req), changePasswordSchema.parse(req.body));
    res.status(204).end();
  },

  async forgotPassword(req: Request, res: Response): Promise<void> {
    await authService.forgotPassword(forgotPasswordSchema.parse(req.body));
    // Always the same answer, whether or not the address has an account.
    sendData(
      res,
      { message: "If that address has an account, a reset link is on its way." },
      { status: 202 },
    );
  },

  async resetPassword(req: Request, res: Response): Promise<void> {
    await authService.resetPassword(resetPasswordSchema.parse(req.body));
    clearCookie(res);
    res.status(204).end();
  },
};
