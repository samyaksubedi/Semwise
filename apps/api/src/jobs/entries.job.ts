import { env } from "../config/env.js";
import { QueueName } from "../lib/queue.js";
import { ESCALATE_JOB, REMINDER_JOB, UNREVIEWED_JOB } from "../modules/approvals/index.js";
import {
  ENTRY_PUBLISH_JOB,
  ENTRY_REINDEX_JOB,
  ORGANIZE_JOB,
  sessionsService,
} from "../modules/sessions/index.js";
import { registerHandler } from "./registry.js";

type VersionJob = { tenantId: string; versionId: string };

/** Lesson notes to topics mapped onto the syllabus, plus the stored summary. */
registerHandler<VersionJob & { userId: string }>(QueueName.ai, ORGANIZE_JOB, (data, job) =>
  sessionsService.runOrganize(data, job),
);

/** Index an approved version, switch the live pointer, delete the old vectors. */
registerHandler<VersionJob>(QueueName.index, ENTRY_PUBLISH_JOB, (data) =>
  sessionsService.runPublish(data),
);
registerHandler<VersionJob>(QueueName.index, ENTRY_REINDEX_JOB, (data) =>
  sessionsService.runReindex(data),
);

/** Delayed jobs; each checks the version is still pending, so a teacher's action makes them no-ops. */
registerHandler<VersionJob & { n: number }>(QueueName.workflow, REMINDER_JOB, (data) =>
  sessionsService.remind(data),
);
registerHandler<VersionJob>(QueueName.workflow, ESCALATE_JOB, (data) =>
  sessionsService.escalate(data, env.APPROVAL_ESCALATE_HOURS),
);
registerHandler<VersionJob>(QueueName.workflow, UNREVIEWED_JOB, (data) =>
  sessionsService.publishUnreviewed(data),
);
