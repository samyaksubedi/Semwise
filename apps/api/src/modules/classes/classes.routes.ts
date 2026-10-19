import { Router } from "express";
import { classesController as c } from "./classes.controller.js";

/** Mounted at /v1/classes. */
export const classesRouter: Router = Router();
classesRouter.post("/", c.create);
classesRouter.get("/mine", c.mine);
classesRouter.get("/:id", c.get);
classesRouter.patch("/:id", c.update);
classesRouter.put("/:id/teachers", c.setTeachers);

/** Mounted at /v1/semesters, next to the structure routes. */
export const semesterClassesRouter: Router = Router();
semesterClassesRouter.get("/:id/classes", c.listForSemester);
