export interface ApiValidationIssue {
  path: string;
  message: string;
}

/** Erro 400 de validação vindo da API (`{ error, issues }`). */
export class ApiValidationError extends Error {
  issues: ApiValidationIssue[];

  constructor(issues: ApiValidationIssue[]) {
    super("Erro de validação");
    this.name = "ApiValidationError";
    this.issues = issues;
  }
}

/** Erro 409 de mismatch de lote no Picking — carrega os dois códigos para a UI mostrar lado a lado. */
export class LotMismatchApiError extends Error {
  expectedLotCode: string;
  scannedLotCode: string;

  constructor(message: string, expectedLotCode: string, scannedLotCode: string) {
    super(message);
    this.name = "LotMismatchApiError";
    this.expectedLotCode = expectedLotCode;
    this.scannedLotCode = scannedLotCode;
  }
}

/** Lê a resposta como JSON e lança em erro HTTP, incluindo `ApiValidationError` para 400 com `issues`. */
export async function parseJsonOrThrow(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (
      response.status === 400 &&
      body !== null &&
      typeof body === "object" &&
      "issues" in body &&
      Array.isArray((body as { issues: unknown }).issues)
    ) {
      throw new ApiValidationError(
        (body as { issues: ApiValidationIssue[] }).issues,
      );
    }

    if (
      response.status === 409 &&
      body !== null &&
      typeof body === "object" &&
      (body as { error?: string }).error === "lot_mismatch"
    ) {
      const typed = body as { message: string; expectedLotCode: string; scannedLotCode: string };
      throw new LotMismatchApiError(typed.message, typed.expectedLotCode, typed.scannedLotCode);
    }

    const message =
      body !== null &&
      typeof body === "object" &&
      "message" in body &&
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : `Falha na requisição (${response.status})`;
    throw new Error(message);
  }

  return body;
}
