import type { Request, Response } from "express";
import { sendData } from "../../common/http/response.js";
import { getLiveness, getReadiness } from "./health.service.js";

export function liveness(_req: Request, res: Response): void {
  sendData(res, getLiveness());
}

export async function readiness(_req: Request, res: Response): Promise<void> {
  const report = await getReadiness();
  sendData(res, report, { status: report.status === "ready" ? 200 : 503 });
}
