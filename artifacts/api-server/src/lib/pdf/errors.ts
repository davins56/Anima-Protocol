export class PdfUploadError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "PdfUploadError";
    this.code = code;
    this.status = status;
  }
}

export function isPdfUploadError(error: unknown): error is PdfUploadError {
  return error instanceof PdfUploadError;
}
