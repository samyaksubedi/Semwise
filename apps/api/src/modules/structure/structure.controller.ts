import {
  createBatchSchema,
  createProgramSchema,
  createSectionSchema,
  createSemesterSchema,
  createSubjectSchema,
  idSchema,
  inviteAdminSchema,
  updateBatchSchema,
  updateProgramSchema,
  updateSectionSchema,
  updateSemesterSchema,
  updateSubjectSchema,
} from "@semwise/shared";
import type { Request, Response } from "express";
import { sendData } from "../../common/http/response.js";
import { getActor } from "../authz/index.js";
import { structureService as service } from "./structure.service.js";

const param = (req: Request, name: string) => idSchema.parse(req.params[name]);

export const structureController = {
  // Programs
  async listPrograms(req: Request, res: Response) {
    sendData(res, await service.listPrograms(getActor(req)));
  },
  async getProgram(req: Request, res: Response) {
    sendData(res, await service.getProgram(getActor(req), param(req, "id")));
  },
  async createProgram(req: Request, res: Response) {
    const input = createProgramSchema.parse(req.body);
    sendData(res, await service.createProgram(getActor(req), input), { status: 201 });
  },
  async updateProgram(req: Request, res: Response) {
    const input = updateProgramSchema.parse(req.body);
    sendData(res, await service.updateProgram(getActor(req), param(req, "id"), input));
  },

  // Program Admins
  async listProgramAdmins(req: Request, res: Response) {
    sendData(res, await service.listProgramAdmins(getActor(req), param(req, "id")));
  },
  async inviteProgramAdmin(req: Request, res: Response) {
    const input = inviteAdminSchema.parse(req.body);
    sendData(res, await service.inviteProgramAdmin(getActor(req), param(req, "id"), input), {
      status: 202,
    });
  },
  async removeProgramAdmin(req: Request, res: Response) {
    await service.removeProgramAdmin(getActor(req), param(req, "id"), param(req, "userId"));
    res.status(204).end();
  },

  // Batches
  async listBatches(req: Request, res: Response) {
    sendData(res, await service.listBatches(getActor(req), param(req, "id")));
  },
  async createBatch(req: Request, res: Response) {
    const input = createBatchSchema.parse(req.body);
    sendData(res, await service.createBatch(getActor(req), param(req, "id"), input), {
      status: 201,
    });
  },
  async updateBatch(req: Request, res: Response) {
    const input = updateBatchSchema.parse(req.body);
    sendData(res, await service.updateBatch(getActor(req), param(req, "id"), input));
  },
  async getBatchTree(req: Request, res: Response) {
    sendData(res, await service.getBatchTree(getActor(req), param(req, "id")));
  },

  // Semesters
  async listSemesters(req: Request, res: Response) {
    sendData(res, await service.listSemesters(getActor(req), param(req, "id")));
  },
  async createSemester(req: Request, res: Response) {
    const input = createSemesterSchema.parse(req.body);
    sendData(res, await service.createSemester(getActor(req), param(req, "id"), input), {
      status: 201,
    });
  },
  async updateSemester(req: Request, res: Response) {
    const input = updateSemesterSchema.parse(req.body);
    sendData(res, await service.updateSemester(getActor(req), param(req, "id"), input));
  },

  // Sections
  async listSections(req: Request, res: Response) {
    sendData(res, await service.listSections(getActor(req), param(req, "id")));
  },
  async createSection(req: Request, res: Response) {
    const input = createSectionSchema.parse(req.body);
    sendData(res, await service.createSection(getActor(req), param(req, "id"), input), {
      status: 201,
    });
  },
  async updateSection(req: Request, res: Response) {
    const input = updateSectionSchema.parse(req.body);
    sendData(res, await service.updateSection(getActor(req), param(req, "id"), input));
  },

  // Subjects
  async listSubjects(req: Request, res: Response) {
    sendData(res, await service.listSubjects(getActor(req), param(req, "id")));
  },
  async getSubject(req: Request, res: Response) {
    sendData(res, await service.getSubject(getActor(req), param(req, "id")));
  },
  async createSubject(req: Request, res: Response) {
    const input = createSubjectSchema.parse(req.body);
    sendData(res, await service.createSubject(getActor(req), param(req, "id"), input), {
      status: 201,
    });
  },
  async updateSubject(req: Request, res: Response) {
    const input = updateSubjectSchema.parse(req.body);
    sendData(res, await service.updateSubject(getActor(req), param(req, "id"), input));
  },
};
