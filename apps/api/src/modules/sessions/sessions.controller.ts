import {
  approveEntrySchema,
  bulkApproveSchema,
  createEntrySchema,
  entryListQuerySchema,
  idSchema,
  newEntryVersionSchema,
  rejectEntrySchema,
  submitEntrySchema,
  updateDraftSchema,
} from "@semwise/shared";
import type { Request, Response } from "express";
import { sendData } from "../../common/http/response.js";
import { getActor, getTenant } from "../authz/index.js";
import { sessionsService as service } from "./sessions.service.js";

const param = (req: Request, name = "id") => idSchema.parse(req.params[name]);

export const sessionsController = {
  // Class entries
  async listForClass(req: Request, res: Response) {
    const range = entryListQuerySchema.parse(req.query);
    sendData(res, await service.listForClass(getActor(req), param(req), range));
  },
  async create(req: Request, res: Response) {
    const input = createEntrySchema.parse(req.body);
    sendData(res, await service.create(getActor(req), getTenant(req).timezone, param(req), input), {
      status: 201,
    });
  },

  // Entries
  async mine(req: Request, res: Response) {
    sendData(res, await service.mine(getActor(req)));
  },
  async get(req: Request, res: Response) {
    sendData(res, await service.get(getActor(req), param(req)));
  },
  async updateDraft(req: Request, res: Response) {
    const input = updateDraftSchema.parse(req.body);
    sendData(
      res,
      await service.updateDraft(getActor(req), getTenant(req).timezone, param(req), input),
    );
  },
  async submit(req: Request, res: Response) {
    const input = submitEntrySchema.parse(req.body ?? {});
    sendData(res, await service.submit(getActor(req), param(req), input));
  },
  async newVersion(req: Request, res: Response) {
    const input = newEntryVersionSchema.parse(req.body);
    sendData(res, await service.newVersion(getActor(req), param(req), input), { status: 201 });
  },
  async withdraw(req: Request, res: Response) {
    const view = await service.withdraw(getActor(req), param(req));
    if (view) sendData(res, view);
    else res.status(204).end();
  },
  async takedown(req: Request, res: Response) {
    sendData(res, await service.takedown(getActor(req), param(req)));
  },
  async restore(req: Request, res: Response) {
    sendData(res, await service.restore(getActor(req), param(req)));
  },

  // Approvals
  async queue(req: Request, res: Response) {
    sendData(res, await service.queue(getActor(req)));
  },
  async approve(req: Request, res: Response) {
    const input = approveEntrySchema.parse(req.body ?? {});
    sendData(res, await service.approve(getActor(req), param(req, "versionId"), input));
  },
  async reject(req: Request, res: Response) {
    const { reason } = rejectEntrySchema.parse(req.body);
    sendData(res, await service.reject(getActor(req), param(req, "versionId"), reason));
  },
  async bulkApprove(req: Request, res: Response) {
    const { versionIds } = bulkApproveSchema.parse(req.body);
    sendData(res, await service.bulkApprove(getActor(req), versionIds));
  },
};
