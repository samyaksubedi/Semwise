import type { RequestHandler } from "express";
import { AppError } from "../errors/app-error.js";

export const notFound: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`No route for ${req.method} ${req.path}`));
};
