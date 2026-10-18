import {
  addStudentSchema,
  assignSectionSchema,
  bulkAssignSchema,
  grantCrSchema,
  idSchema,
  importStudentsSchema,
  studentListQuerySchema,
  updateStudentSchema,
} from "@semwise/shared";
import type { Request, Response } from "express";
import { sendData } from "../../common/http/response.js";
import { getActor } from "../authz/index.js";
import { enrollmentsService as service } from "./enrollments.service.js";

const param = (req: Request, name: string) => idSchema.parse(req.params[name]);

export const enrollmentsController = {
  async list(req: Request, res: Response) {
    const filter = studentListQuerySchema.parse(req.query);
    sendData(res, await service.listStudents(getActor(req), param(req, "id"), filter));
  },
  async add(req: Request, res: Response) {
    const input = addStudentSchema.parse(req.body);
    sendData(res, await service.addStudent(getActor(req), param(req, "id"), input), {
      status: 201,
    });
  },
  async previewImport(req: Request, res: Response) {
    const { csv } = importStudentsSchema.parse(req.body);
    sendData(res, await service.previewImport(getActor(req), param(req, "id"), csv));
  },
  async import(req: Request, res: Response) {
    const { csv } = importStudentsSchema.parse(req.body);
    sendData(res, await service.importStudents(getActor(req), param(req, "id"), csv), {
      status: 201,
    });
  },
  async progress(req: Request, res: Response) {
    sendData(res, await service.inviteProgress(getActor(req), param(req, "id")));
  },
  async bulkAssign(req: Request, res: Response) {
    const input = bulkAssignSchema.parse(req.body);
    sendData(res, await service.bulkAssign(getActor(req), param(req, "id"), input));
  },

  async get(req: Request, res: Response) {
    sendData(res, await service.getStudent(getActor(req), param(req, "id")));
  },
  async update(req: Request, res: Response) {
    const input = updateStudentSchema.parse(req.body);
    sendData(res, await service.updateStudent(getActor(req), param(req, "id"), input));
  },
  async resend(req: Request, res: Response) {
    sendData(res, await service.resendInvite(getActor(req), param(req, "id")));
  },
  async revoke(req: Request, res: Response) {
    sendData(res, await service.revokeInvite(getActor(req), param(req, "id")));
  },
  async deactivate(req: Request, res: Response) {
    sendData(res, await service.deactivate(getActor(req), param(req, "id")));
  },
  async assignSection(req: Request, res: Response) {
    const { sectionId } = assignSectionSchema.parse(req.body);
    sendData(
      res,
      await service.assignSection(
        getActor(req),
        param(req, "id"),
        param(req, "semesterId"),
        sectionId,
      ),
    );
  },

  async grantCr(req: Request, res: Response) {
    const input = grantCrSchema.parse(req.body);
    sendData(res, await service.grantCr(getActor(req), param(req, "id"), input));
  },
  async removeCr(req: Request, res: Response) {
    await service.removeCr(getActor(req), param(req, "id"));
    res.status(204).end();
  },
};
