import { Router } from "express";
import { inviteLimit } from "../../common/middleware/rate-limit.js";
import { enrollmentsController as c } from "./enrollments.controller.js";

/** Mounted at /v1/semesters, next to the structure routes. */
export const semesterStudentsRouter: Router = Router();
semesterStudentsRouter.get("/:id/students", c.list);
semesterStudentsRouter.post("/:id/students", inviteLimit, c.add);
semesterStudentsRouter.post("/:id/students/import/preview", c.previewImport);
semesterStudentsRouter.post("/:id/students/import", inviteLimit, c.import);
semesterStudentsRouter.get("/:id/students/invite-progress", c.progress);
semesterStudentsRouter.post("/:id/enrollments", c.bulkAssign);

/** Mounted at /v1/students. */
export const studentsRouter: Router = Router();
studentsRouter.get("/:id", c.get);
studentsRouter.patch("/:id", c.update);
studentsRouter.post("/:id/resend-invite", inviteLimit, c.resend);
studentsRouter.post("/:id/revoke-invite", c.revoke);
studentsRouter.post("/:id/deactivate", c.deactivate);
studentsRouter.put("/:id/enrollments/:semesterId", c.assignSection);

/** Mounted at /v1/sections, next to the structure routes. */
export const sectionCrRouter: Router = Router();
sectionCrRouter.post("/:id/cr", c.grantCr);
sectionCrRouter.delete("/:id/cr/:studentId", c.removeCr);
