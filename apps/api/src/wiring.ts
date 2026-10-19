import { registerEnrollmentLoader, registerTeachingLoader } from "./modules/authz/index.js";
import { classesService, registerSyllabusGate } from "./modules/classes/index.js";
import { enrollmentsService } from "./modules/enrollments/index.js";
import { registerAcceptHandler } from "./modules/invitations/index.js";
import { sessionsService } from "./modules/sessions/index.js";
import { onSyllabusPublished, syllabusService } from "./modules/syllabus/index.js";

let wired = false;

/**
 * Connects modules that must not import each other directly (to keep dependencies one way):
 * authz learns where students are enrolled, invitations learn what a student invite grants.
 * Called once by the API and by the worker.
 */
export function wireModules(): void {
  if (wired) return;
  wired = true;
  registerEnrollmentLoader((tenantId, userId) =>
    enrollmentsService.actorEnrollments(tenantId, userId),
  );
  registerTeachingLoader((tenantId, userId) => classesService.teaching(tenantId, userId));
  registerAcceptHandler("STUDENT", enrollmentsService.acceptStudent);
  registerSyllabusGate((scope, subjectId) => syllabusService.hasPublished(scope, subjectId));
  onSyllabusPublished((event) => sessionsService.onSyllabusPublished(event));
}
