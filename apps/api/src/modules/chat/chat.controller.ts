import {
  askSchema,
  createConversationSchema,
  idSchema,
  updateConversationSchema,
} from "@semwise/shared";
import type { Request, Response } from "express";
import { sendData } from "../../common/http/response.js";
import { getActor, getTenant } from "../authz/index.js";
import { chatService as service } from "./chat.service.js";

const param = (req: Request, name = "id") => idSchema.parse(req.params[name]);

export const chatController = {
  async create(req: Request, res: Response) {
    const input = createConversationSchema.parse(req.body ?? {});
    sendData(res, await service.create(getActor(req), input), { status: 201 });
  },
  async list(req: Request, res: Response) {
    sendData(res, await service.list(getActor(req)));
  },
  async get(req: Request, res: Response) {
    sendData(res, await service.get(getActor(req), param(req)));
  },
  async update(req: Request, res: Response) {
    const input = updateConversationSchema.parse(req.body);
    sendData(res, await service.update(getActor(req), param(req), input));
  },
  async remove(req: Request, res: Response) {
    await service.remove(getActor(req), param(req));
    res.status(204).end();
  },
  async ask(req: Request, res: Response) {
    const { text } = askSchema.parse(req.body);
    sendData(res, await service.ask(getActor(req), getTenant(req).timezone, param(req), text));
  },
};
