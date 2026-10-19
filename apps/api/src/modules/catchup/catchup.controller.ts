import { catchupQuerySchema } from "@semwise/shared";
import type { Request, Response } from "express";
import { sendData } from "../../common/http/response.js";
import { getActor, getTenant } from "../authz/index.js";
import { catchupService as service } from "./catchup.service.js";

export const catchupController = {
  async view(req: Request, res: Response) {
    const query = catchupQuerySchema.parse(req.query);
    sendData(res, await service.view(getActor(req), getTenant(req).timezone, query));
  },
};
