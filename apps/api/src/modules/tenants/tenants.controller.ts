import {
  createTenantSchema,
  idSchema,
  inviteAdminSchema,
  updateCollegeSchema,
  updateTenantSchema,
} from "@semwise/shared";
import type { Request, Response } from "express";
import { sendData } from "../../common/http/response.js";
import { getActor } from "../authz/index.js";
import { tenantsService } from "./tenants.service.js";

export const tenantsController = {
  // Platform
  async create(req: Request, res: Response): Promise<void> {
    const input = createTenantSchema.parse(req.body);
    sendData(res, await tenantsService.create(getActor(req), input), { status: 201 });
  },

  async list(req: Request, res: Response): Promise<void> {
    sendData(res, await tenantsService.list(getActor(req)));
  },

  async get(req: Request, res: Response): Promise<void> {
    sendData(res, await tenantsService.platformView(getActor(req), idSchema.parse(req.params.id)));
  },

  async update(req: Request, res: Response): Promise<void> {
    const input = updateTenantSchema.parse(req.body);
    sendData(res, await tenantsService.update(getActor(req), idSchema.parse(req.params.id), input));
  },

  async inviteAdmin(req: Request, res: Response): Promise<void> {
    const input = inviteAdminSchema.parse(req.body);
    const id = idSchema.parse(req.params.id);
    sendData(res, await tenantsService.inviteUniversityAdmin(getActor(req), id, input), {
      status: 201,
    });
  },

  // College (tenant routes)
  async getCollege(req: Request, res: Response): Promise<void> {
    sendData(res, await tenantsService.getCollege(getActor(req)));
  },

  async updateCollege(req: Request, res: Response): Promise<void> {
    const input = updateCollegeSchema.parse(req.body);
    sendData(res, await tenantsService.updateCollege(getActor(req), input));
  },
};
