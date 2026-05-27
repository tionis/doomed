export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function assert(condition: unknown, statusCode: number, message: string) {
  if (!condition) throw new HttpError(statusCode, message);
}
