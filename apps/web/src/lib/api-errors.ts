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

/**
 * Erro 409 de custo industrial incompleto.
 *
 * O backend continua sendo a autoridade sobre o que é "incompleto": a tela
 * antecipa pela proveniência da linha, mas se a recusa vier mesmo assim é
 * este erro que abre a confirmação explícita, em vez de virar um texto solto.
 */
export class IncompleteCostApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompleteCostApiError";
  }
}

/**
 * Mensagem amigável por código de erro da API.
 *
 * O backend já responde em pt-BR na maior parte dos casos de domínio; este
 * mapa cobre o resto para que a operação nunca leia "400" na tela. O erro
 * técnico continua disponível no console/log — nada é engolido.
 */
const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: "Sessão expirada. Entre novamente para continuar.",
  forbidden: "Seu perfil não permite esta ação.",
  insufficient_stock: "Estoque insuficiente para a quantidade informada.",
  lot_not_eligible: "Lote indisponível para uso (qualidade, validade ou laudo).",
  lot_owner_mismatch: "Este lote pertence a outro proprietário.",
  missing_lot: "Informe o lote: este item é controlado por lote.",
  coa_pending: "O laudo (CoA) deste lote ainda não foi aprovado.",
  quality_not_released: "Lote ainda não liberado pela Qualidade.",
  not_eligible_preferred: "Só um fornecedor homologado e ativo pode ser o preferencial.",
  incompatible_uom: "Unidade incompatível com a unidade do item.",
  quote_locked: "Versão de orçamento enviada é histórico — crie uma nova versão.",
  project_closed: "Projeto aprovado ou cancelado é somente leitura.",
  invalid_transition: "Esta ação não é válida para o estado atual do documento.",
  shipment_not_verified: "Confira os lotes da expedição antes de confirmar.",
  no_consumption: "Nenhum consumo registrado — confirme antes de concluir.",
};

/** Mensagem por status quando a resposta não traz nada aproveitável. */
function messageForStatus(status: number): string {
  if (status === 401) return ERROR_MESSAGES["not_authenticated"]!;
  if (status === 403) return ERROR_MESSAGES["forbidden"]!;
  if (status === 404) return "Registro não encontrado.";
  if (status >= 500) return `Erro interno do servidor (${status}). Tente novamente ou avise o suporte.`;
  return `Falha na requisição (${status})`;
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

    if (
      response.status === 409 &&
      body !== null &&
      typeof body === "object" &&
      (body as { error?: string }).error === "incomplete_cost"
    ) {
      throw new IncompleteCostApiError((body as { message: string }).message);
    }

    const payload = (body ?? {}) as { message?: unknown; error?: unknown };
    const code = typeof payload.error === "string" ? payload.error : null;
    const message =
      typeof payload.message === "string" && payload.message.length > 0
        ? payload.message
        : ((code ? ERROR_MESSAGES[code] : null) ?? messageForStatus(response.status));

    // Detalhe técnico continua visível para quem investiga — a tela mostra
    // a mensagem tratada, o console mostra o código real.
    if (code) console.warn(`API ${response.status} ${code}`);
    throw new Error(message);
  }

  return body;
}
