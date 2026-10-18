import { auditQuerySchema, idSchema } from "@semwise/shared";
import type { Request, Response } from "express";
import { sendData } from "../../common/http/response.js";
import { getActor } from "../authz/index.js";
import { auditService } from "./audit.service.js";

export const auditController = {
  async list(req: Request, res: Response): Promise<void> {
    const result = await auditService.listForTenant(
      getActor(req),
      auditQuerySchema.parse(req.query),
    );
    sendData(res, result.data, { meta: result.meta });
  },

  async listPlatform(req: Request, res: Response): Promise<void> {
    const tenantId = req.query.tenantId ? idSchema.parse(req.query.tenantId) : null;
    const result = await auditService.listAll(
      getActor(req),
      auditQuerySchema.parse(req.query),
      tenantId,
    );
    sendData(res, result.data, { meta: result.meta });
  },
};
