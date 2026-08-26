export class AppError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const Unauthorized = (message = "Authentication required") =>
  new AppError(401, "unauthorized", message);

export const Forbidden = (message = "Not allowed for this tenant/role") =>
  new AppError(403, "forbidden", message);

export const NotFound = (message = "Resource not found") =>
  new AppError(404, "not_found", message);

export const Conflict = (message = "Conflicting state") => new AppError(409, "conflict", message);

export const Unprocessable = (message = "Validation failed") =>
  new AppError(422, "validation_failed", message);
