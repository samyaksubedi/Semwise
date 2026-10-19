import { idSchema, requestUploadSchema } from "@semwise/shared";
import type { Request, Response } from "express";
import { sendData } from "../../common/http/response.js";
import { getActor } from "../authz/index.js";
import { filesService } from "./files.service.js";

export const filesController = {
  async requestUpload(req: Request, res: Response) {
    const input = requestUploadSchema.parse(req.body);
    sendData(res, await filesService.requestUpload(getActor(req), input), { status: 201 });
  },
  async complete(req: Request, res: Response) {
    sendData(res, await filesService.completeUpload(getActor(req), idSchema.parse(req.params.id)));
  },
  async downloadUrl(req: Request, res: Response) {
    sendData(res, await filesService.downloadUrl(getActor(req), idSchema.parse(req.params.id)));
  },
};
