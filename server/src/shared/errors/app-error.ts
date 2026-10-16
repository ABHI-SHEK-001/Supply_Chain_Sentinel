export class AppError extends Error {
    public readonly statusCode: number;
    public readonly code: string;
    public readonly details: unknown;

    constructor(statusCode: number, code: string, message: string, details?: unknown) {
        super(message);
        this.name = "AppError";
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}

export const badRequest = (message: string, details?: unknown) =>
    new AppError(400, "BAD_REQUEST", message, details);

export const notFound = (message: string) => new AppError(404, "NOT_FOUND", message);

export const notImplemented = (message: string) =>
    new AppError(501, "NOT_IMPLEMENTED", message);

export const serviceUnavailable = (message: string, details?: unknown) =>
    new AppError(503, "SERVICE_UNAVAILABLE", message, details);