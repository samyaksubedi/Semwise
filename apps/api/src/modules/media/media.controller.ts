import { idSchema, startReadingSchema } from "@semwise/shared";
import type { Request, Response } from "express";
import { sendData } from "../../common/http/response.js";
import { getActor } from "../authz/index.js";
import { mediaService as service } from "./media.service.js";

const param = (req: Request, name = "id") => idSchema.parse(req.params[name]);

export const mediaController = {
  async transcribe(req: Request, res: Response) {
    const { fileId } = startReadingSchema.parse(req.body);
    sendData(res, await service.start(getActor(req), param(req), fileId, "AUDIO"), { status: 202 });
  },
  async readPhoto(req: Request, res: Response) {
    const { fileId } = startReadingSchema.parse(req.body);
    sendData(res, await service.start(getActor(req), param(req), fileId, "PHOTO"), { status: 202 });
  },
  async get(req: Request, res: Response) {
    sendData(res, await service.get(getActor(req), param(req)));
  },
};
