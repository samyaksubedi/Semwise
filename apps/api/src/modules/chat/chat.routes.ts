import { Router } from "express";
import { aiLimit } from "../../common/middleware/rate-limit.js";
import { chatController as c } from "./chat.controller.js";

/** Mounted at /v1/chat. A student's own conversations only. */
export const chatRouter: Router = Router();
chatRouter.get("/conversations", c.list);
chatRouter.post("/conversations", c.create);
chatRouter.get("/conversations/:id", c.get);
chatRouter.patch("/conversations/:id", c.update);
chatRouter.delete("/conversations/:id", c.remove);
chatRouter.post("/conversations/:id/messages", aiLimit, c.ask);
