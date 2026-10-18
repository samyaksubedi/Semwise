import { Router } from "express";
import { requireTrustedOrigin } from "../../common/middleware/origin-check.js";
import { loginLimit, tokenRequestLimit } from "../../common/middleware/rate-limit.js";
import { authController } from "./auth.controller.js";
import { loadSession, requireAuth } from "./auth.middleware.js";

/** Mounted at /v1/auth. */
export const authRouter: Router = Router();

authRouter.use(requireTrustedOrigin, loadSession);

authRouter.post("/login", loginLimit, authController.login);
authRouter.post("/logout", authController.logout);
authRouter.post("/password/forgot", tokenRequestLimit, authController.forgotPassword);
authRouter.post("/password/reset", tokenRequestLimit, authController.resetPassword);

authRouter.get("/me", requireAuth, authController.me);
authRouter.post("/active-tenant", requireAuth, authController.setActiveTenant);
authRouter.post("/password/change", requireAuth, authController.changePassword);
authRouter.post("/logout-all", requireAuth, authController.logoutAll);
