import type { ApiSuccess } from "@semwise/shared";
import type { Response } from "express";

/** Sends the success envelope `{ data, meta? }`. */
export function sendData<TData, TMeta = undefined>(
  res: Response,
  data: TData,
  options: { status?: number; meta?: TMeta } = {},
): void {
  const body: ApiSuccess<TData, TMeta> =
    options.meta === undefined ? { data } : { data, meta: options.meta };
  res.status(options.status ?? 200).json(body);
}
