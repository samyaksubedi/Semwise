import {
  addTopicSchema,
  changeRequestSchema,
  confirmSubjectSchema,
  copySyllabusSchema,
  decideChangesSchema,
  idSchema,
  importSyllabusSchema,
  publishSyllabusSchema,
  startDraftSchema,
  updateTopicSchema,
  updateVersionSchema,
} from "@semwise/shared";
import type { Request, Response } from "express";
import { z } from "zod";
import { sendData } from "../../common/http/response.js";
import { getActor } from "../authz/index.js";
import { syllabusService as service } from "./syllabus.service.js";

const param = (req: Request, name: string) => idSchema.parse(req.params[name]);
const pageNo = z.coerce.number().int().min(1).max(2000);

export const syllabusController = {
  // Subjects and semesters
  async importForSemester(req: Request, res: Response) {
    const { fileId } = importSyllabusSchema.parse(req.body);
    sendData(res, await service.importForSemester(getActor(req), param(req, "id"), fileId), {
      status: 202,
    });
  },
  async status(req: Request, res: Response) {
    sendData(res, await service.statusForSemester(getActor(req), param(req, "id")));
  },
  async startDraft(req: Request, res: Response) {
    const input = startDraftSchema.parse(req.body);
    sendData(res, await service.startDraft(getActor(req), param(req, "id"), input), {
      status: 202,
    });
  },
  async copy(req: Request, res: Response) {
    const { fromSubjectId } = copySyllabusSchema.parse(req.body);
    sendData(res, await service.copyFromSubject(getActor(req), param(req, "id"), fromSubjectId), {
      status: 201,
    });
  },
  async published(req: Request, res: Response) {
    sendData(res, await service.published(getActor(req), param(req, "id")));
  },
  async versions(req: Request, res: Response) {
    sendData(res, await service.versions(getActor(req), param(req, "id")));
  },

  // Versions
  async view(req: Request, res: Response) {
    sendData(res, await service.view(getActor(req), param(req, "id")));
  },
  async page(req: Request, res: Response) {
    sendData(
      res,
      await service.page(getActor(req), param(req, "id"), pageNo.parse(req.params.pageNo)),
    );
  },
  async update(req: Request, res: Response) {
    const input = updateVersionSchema.parse(req.body);
    sendData(res, await service.updateVersion(getActor(req), param(req, "id"), input));
  },
  async confirmSubject(req: Request, res: Response) {
    const input = confirmSubjectSchema.parse(req.body);
    sendData(res, await service.confirmSubject(getActor(req), param(req, "id"), input));
  },
  async retry(req: Request, res: Response) {
    sendData(res, await service.retryExtraction(getActor(req), param(req, "id")), { status: 202 });
  },
  async addTopic(req: Request, res: Response) {
    const input = addTopicSchema.parse(req.body);
    sendData(res, await service.addTopic(getActor(req), param(req, "id"), input), { status: 201 });
  },
  async updateTopic(req: Request, res: Response) {
    const input = updateTopicSchema.parse(req.body);
    sendData(
      res,
      await service.updateTopic(getActor(req), param(req, "id"), param(req, "topicId"), input),
    );
  },
  async deleteTopic(req: Request, res: Response) {
    sendData(
      res,
      await service.deleteTopic(getActor(req), param(req, "id"), param(req, "topicId")),
    );
  },
  async requestChanges(req: Request, res: Response) {
    const { text } = changeRequestSchema.parse(req.body);
    sendData(res, await service.requestChanges(getActor(req), param(req, "id"), text), {
      status: 201,
    });
  },
  async listChanges(req: Request, res: Response) {
    sendData(res, await service.listChangeRequests(getActor(req), param(req, "id")));
  },
  async decideChanges(req: Request, res: Response) {
    const input = decideChangesSchema.parse(req.body);
    sendData(res, await service.decideChanges(getActor(req), param(req, "id"), input));
  },
  async publish(req: Request, res: Response) {
    const { effectiveFrom } = publishSyllabusSchema.parse(req.body ?? {});
    sendData(res, await service.publish(getActor(req), param(req, "id"), effectiveFrom), {
      status: 202,
    });
  },
  async discard(req: Request, res: Response) {
    await service.discard(getActor(req), param(req, "id"));
    res.status(204).end();
  },
};
