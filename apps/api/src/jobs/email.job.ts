import { QueueName } from "../lib/queue.js";
import {
  EMAIL_JOB,
  notificationsService,
  type EmailJobData,
} from "../modules/notifications/index.js";
import { registerHandler } from "./registry.js";

/** Sends one queued email (rate: MAIL_PER_MINUTE via the queue limiter, MAIL_DAILY_CAP per day). */
registerHandler<EmailJobData>(QueueName.email, EMAIL_JOB, (data, job, token) =>
  notificationsService.sendQueued(data, job, token),
);
