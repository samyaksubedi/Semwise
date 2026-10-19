import { Router } from "express";
import { aiLimit } from "../../common/middleware/rate-limit.js";
import { syllabusController as c } from "./syllabus.controller.js";

/** Mounted at /v1/semesters, next to the structure routes. */
export const semesterSyllabusRouter: Router = Router();
semesterSyllabusRouter.post("/:id/syllabus-imports", aiLimit, c.importForSemester);
semesterSyllabusRouter.get("/:id/syllabus-status", c.status);

/** Mounted at /v1/subjects, next to the structure routes. */
export const subjectSyllabusRouter: Router = Router();
subjectSyllabusRouter.get("/:id/syllabus", c.published);
subjectSyllabusRouter.get("/:id/syllabus/versions", c.versions);
subjectSyllabusRouter.post("/:id/syllabus/drafts", aiLimit, c.startDraft);
subjectSyllabusRouter.post("/:id/syllabus/copy", c.copy);

/** Mounted at /v1/syllabus. */
export const syllabusRouter: Router = Router();
syllabusRouter.get("/versions/:id", c.view);
syllabusRouter.patch("/versions/:id", c.update);
syllabusRouter.delete("/versions/:id", c.discard);
syllabusRouter.get("/versions/:id/pages/:pageNo", c.page);
syllabusRouter.post("/versions/:id/confirm-subject", c.confirmSubject);
syllabusRouter.post("/versions/:id/retry", aiLimit, c.retry);
syllabusRouter.post("/versions/:id/topics", c.addTopic);
syllabusRouter.patch("/versions/:id/topics/:topicId", c.updateTopic);
syllabusRouter.delete("/versions/:id/topics/:topicId", c.deleteTopic);
syllabusRouter.get("/versions/:id/change-requests", c.listChanges);
syllabusRouter.post("/versions/:id/change-requests", aiLimit, c.requestChanges);
syllabusRouter.post("/change-requests/:id/decide", c.decideChanges);
syllabusRouter.post("/versions/:id/publish", c.publish);
