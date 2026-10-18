import { pino } from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  // Never write credentials, tokens or private content to the logs.
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      'res.headers["set-cookie"]',
      "*.password",
      "*.token",
      "*.email",
    ],
    censor: "[redacted]",
  },
  ...(env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
        },
      }
    : {}),
});
