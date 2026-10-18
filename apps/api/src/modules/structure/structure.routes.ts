import { Router } from "express";
import { structureController as c } from "./structure.controller.js";

/** Mounted at /v1/programs. */
export const programsRouter: Router = Router();
programsRouter.get("/", c.listPrograms);
programsRouter.post("/", c.createProgram);
programsRouter.get("/:id", c.getProgram);
programsRouter.patch("/:id", c.updateProgram);
programsRouter.get("/:id/admins", c.listProgramAdmins);
programsRouter.post("/:id/admins", c.inviteProgramAdmin);
programsRouter.delete("/:id/admins/:userId", c.removeProgramAdmin);
programsRouter.get("/:id/batches", c.listBatches);
programsRouter.post("/:id/batches", c.createBatch);

/** Mounted at /v1/batches. */
export const batchesRouter: Router = Router();
batchesRouter.patch("/:id", c.updateBatch);
batchesRouter.get("/:id/tree", c.getBatchTree);
batchesRouter.get("/:id/semesters", c.listSemesters);
batchesRouter.post("/:id/semesters", c.createSemester);

/** Mounted at /v1/semesters. */
export const semestersRouter: Router = Router();
semestersRouter.patch("/:id", c.updateSemester);
semestersRouter.get("/:id/sections", c.listSections);
semestersRouter.post("/:id/sections", c.createSection);
semestersRouter.get("/:id/subjects", c.listSubjects);
semestersRouter.post("/:id/subjects", c.createSubject);

/** Mounted at /v1/sections. */
export const sectionsRouter: Router = Router();
sectionsRouter.patch("/:id", c.updateSection);

/** Mounted at /v1/subjects. */
export const subjectsRouter: Router = Router();
subjectsRouter.get("/:id", c.getSubject);
subjectsRouter.patch("/:id", c.updateSubject);
