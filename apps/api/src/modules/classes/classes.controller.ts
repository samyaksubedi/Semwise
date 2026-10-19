import {
  createClassSchema,
  idSchema,
  setClassTeachersSchema,
  updateClassSchema,
} from "@semwise/shared";
import type { Request, Response } from "express";
import { sendData } from "../../common/http/response.js";
import { getActor } from "../authz/index.js";
import { classesService as service } from "./classes.service.js";

const param = (req: Request, name: string) => idSchema.parse(req.params[name]);

export const classesController = {
  async create(req: Request, res: Response) {
    const input = createClassSchema.parse(req.body);
    sendData(res, await service.create(getActor(req), input), { status: 201 });
  },
  async mine(req: Request, res: Response) {
    sendData(res, await service.mine(getActor(req)));
  },
  async get(req: Request, res: Response) {
    sendData(res, await service.get(getActor(req), param(req, "id")));
  },
  async setTeachers(req: Request, res: Response) {
    const input = setClassTeachersSchema.parse(req.body);
    sendData(res, await service.setTeachers(getActor(req), param(req, "id"), input));
  },
  async update(req: Request, res: Response) {
    const input = updateClassSchema.parse(req.body);
    sendData(res, await service.update(getActor(req), param(req, "id"), input));
  },
  async listForSemester(req: Request, res: Response) {
    sendData(res, await service.listForSemester(getActor(req), param(req, "id")));
  },
};
