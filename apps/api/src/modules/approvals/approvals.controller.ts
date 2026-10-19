import { classApprovalSchema, idSchema, programApprovalSchema } from "@semwise/shared";
import type { Request, Response } from "express";
import { sendData } from "../../common/http/response.js";
import { getActor } from "../authz/index.js";
import { approvalsService as service } from "./approvals.service.js";

const param = (req: Request) => idSchema.parse(req.params.id);

export const approvalsController = {
  async getProgram(req: Request, res: Response) {
    sendData(res, await service.getProgram(getActor(req), param(req)));
  },
  async setProgram(req: Request, res: Response) {
    const input = programApprovalSchema.parse(req.body);
    sendData(res, await service.setProgram(getActor(req), param(req), input));
  },
  async getClass(req: Request, res: Response) {
    sendData(res, await service.getClass(getActor(req), param(req)));
  },
  async setClass(req: Request, res: Response) {
    const { autoApprove } = classApprovalSchema.parse(req.body);
    sendData(res, await service.setClass(getActor(req), param(req), autoApprove));
  },
};
