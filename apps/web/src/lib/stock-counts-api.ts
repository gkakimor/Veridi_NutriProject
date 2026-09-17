import type {
  AddStockCountPositionInput,
  CancelStockCountInput,
  CreateStockCountFindingInput,
  PreviewStockCountInput,
  RegisterStockCountEntryInput,
  RegisterStockCountEntryResultDTO,
  RemoveStockCountPositionInput,
  StartStockCountInput,
  StockCountDetailDTO,
  StockCountErrorBody,
  StockCountErrorCode,
  StockCountFindingDTO,
  StockCountKind,
  StockCountListResponse,
  StockCountMode,
  StockCountPositionDTO,
  StockCountPreviewDTO,
  StockCountStatus,
  StockCountView,
} from "@veridi/shared";
import { API_URL, apiFetch } from "./api";
import { parseJsonOrThrow } from "./api-errors";

/**
 * Inventário Físico em sessão — as chamadas das telas (INVENTORY-PHYSICAL-COUNT-01, Fatia 2A).
 *
 * A Contagem rápida continua em `inventory-api.ts` (`POST /stock-counts`).
 */

/** Todo código que a API do inventário devolve no corpo de uma recusa. */
const CODIGOS_DO_INVENTARIO: ReadonlySet<string> = new Set<StockCountErrorCode>([
  "forbidden",
  "not_found",
  "position_not_found",
  "invalid_stock_count_status",
  "empty_scope",
  "scope_too_large",
  "scope_changed",
  "customer_not_found",
  "position_in_open_count",
  "position_already_in_count",
  "action_not_allowed",
  "entry_not_allowed",
  "client_request_reused",
  "fractional_count_quantity",
  "first_round_incomplete",
  "nothing_to_review",
  "recount_not_allowed",
  "decision_not_allowed",
  "stock_count_close_blocked",
  "system_quantity_changed",
  "invalid_finding",
  "concurrent_write",
  "stock_count_entry_conflict",
  "item_not_found",
  "lot_not_found",
  "lot_item_mismatch",
  "missing_lot",
  "unexpected_lot",
  "missing_count_reason",
  "count_below_reserved",
]);

/**
 * Recusa do Inventário Físico com o corpo INTEIRO.
 *
 * `parseJsonOrThrow` entrega só a frase — e a tela do inventário precisa do
 * resto para agir: o delta do escopo que mudou, a posição atual no conflito,
 * onde a posição está retida, quantas faltam contar. Não é reforma dos erros da
 * Web: só as chamadas deste arquivo lançam este erro, e `message` continua
 * sendo a frase do servidor, para quem só mostra texto.
 */
export class StockCountApiError extends Error {
  readonly status: number;
  readonly code: StockCountErrorCode;
  readonly body: StockCountErrorBody;

  constructor(status: number, body: StockCountErrorBody) {
    super(body.message);
    this.name = "StockCountApiError";
    this.status = status;
    this.code = body.error;
    this.body = body;
  }
}

/**
 * A contagem pode não ter chegado ao servidor: a rede caiu ou o servidor não
 * respondeu. Reenviar com o MESMO `clientRequestId` é seguro — se ela chegou, o
 * servidor devolve o registro que já existe, sem duplicar.
 */
export class StockCountSendFailedError extends Error {
  readonly status: number | null;

  constructor(status: number | null) {
    super(
      status === null
        ? "Sem conexão com o sistema: a contagem não foi enviada."
        : "O sistema não respondeu: a contagem pode não ter sido gravada.",
    );
    this.name = "StockCountSendFailedError";
    this.status = status;
  }
}

function ehCorpoDoInventario(corpo: unknown): corpo is StockCountErrorBody {
  if (corpo === null || typeof corpo !== "object") return false;
  const { error, message } = corpo as { error?: unknown; message?: unknown };
  return typeof error === "string" && CODIGOS_DO_INVENTARIO.has(error) && typeof message === "string";
}

export function isStockCountApiError(err: unknown, code?: StockCountErrorCode): err is StockCountApiError {
  return err instanceof StockCountApiError && (code === undefined || err.code === code);
}

async function lerDoInventario<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const corpo: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if (ehCorpoDoInventario(corpo)) throw new StockCountApiError(response.status, corpo);
  }
  // Validação (400 com `issues`), sessão expirada, 404 sem frase e falha do servidor: o tratamento de sempre.
  return (await parseJsonOrThrow(response)) as T;
}

function enviar(url: string, corpo?: unknown): Promise<Response> {
  return apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo ?? {}),
  });
}

export interface ListStockCountsParams {
  /** Um ou vários — "Em aberto" são dois, numa consulta só. */
  status?: StockCountStatus[];
  kind?: StockCountKind;
  mode?: StockCountMode;
  /** Código `INV-` ou descrição. */
  search?: string;
  /** Dia de início, `YYYY-MM-DD`. */
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

export async function listStockCounts(params: ListStockCountsParams = {}): Promise<StockCountListResponse> {
  const query = new URLSearchParams();
  if (params.status && params.status.length > 0) query.set("status", params.status.join(","));
  if (params.kind) query.set("kind", params.kind);
  if (params.mode) query.set("mode", params.mode);
  if (params.search) query.set("search", params.search);
  if (params.dateFrom) query.set("dateFrom", params.dateFrom);
  if (params.dateTo) query.set("dateTo", params.dateTo);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));
  const response = await apiFetch(`${API_URL}/stock-counts?${query.toString()}`);
  return lerDoInventario<StockCountListResponse>(response);
}

/**
 * A leitura é escolhida por QUEM chama e nunca tem padrão aqui: quem conta lê
 * `counting`, que numa contagem cega não traz saldo nenhum; o detalhe lê
 * `review`, que o servidor só revela depois da primeira contagem.
 */
export async function getStockCount(id: string, view: StockCountView): Promise<StockCountDetailDTO> {
  const response = await apiFetch(`${API_URL}/stock-counts/${id}?view=${view}`);
  return lerDoInventario<StockCountDetailDTO>(response);
}

export async function previewStockCount(input: PreviewStockCountInput): Promise<StockCountPreviewDTO> {
  return lerDoInventario<StockCountPreviewDTO>(await enviar(`${API_URL}/stock-counts/preview`, input));
}

export async function startStockCount(input: StartStockCountInput): Promise<StockCountDetailDTO> {
  return lerDoInventario<StockCountDetailDTO>(await enviar(`${API_URL}/stock-counts/sessions`, input));
}

export async function registerStockCountEntry(
  stockCountId: string,
  positionId: string,
  input: RegisterStockCountEntryInput,
): Promise<RegisterStockCountEntryResultDTO> {
  let response: Response;
  try {
    response = await enviar(`${API_URL}/stock-counts/${stockCountId}/positions/${positionId}/entries`, input);
  } catch {
    // `fetch` rejeita sem resposta nenhuma: a contagem não saiu daqui.
    throw new StockCountSendFailedError(null);
  }
  if (response.status >= 500) throw new StockCountSendFailedError(response.status);
  return lerDoInventario<RegisterStockCountEntryResultDTO>(response);
}

export async function addStockCountPosition(
  stockCountId: string,
  input: AddStockCountPositionInput,
): Promise<StockCountPositionDTO> {
  return lerDoInventario<StockCountPositionDTO>(
    await enviar(`${API_URL}/stock-counts/${stockCountId}/positions`, input),
  );
}

export async function removeStockCountPosition(
  stockCountId: string,
  positionId: string,
  input: RemoveStockCountPositionInput,
): Promise<StockCountPositionDTO> {
  return lerDoInventario<StockCountPositionDTO>(
    await enviar(`${API_URL}/stock-counts/${stockCountId}/positions/${positionId}/remove`, input),
  );
}

export async function closeStockCountFirstRound(stockCountId: string): Promise<StockCountDetailDTO> {
  return lerDoInventario<StockCountDetailDTO>(await enviar(`${API_URL}/stock-counts/${stockCountId}/close-first-round`));
}

export async function cancelStockCount(stockCountId: string, input: CancelStockCountInput): Promise<StockCountDetailDTO> {
  return lerDoInventario<StockCountDetailDTO>(await enviar(`${API_URL}/stock-counts/${stockCountId}/cancel`, input));
}

export async function createStockCountFinding(
  stockCountId: string,
  input: CreateStockCountFindingInput,
): Promise<StockCountFindingDTO> {
  return lerDoInventario<StockCountFindingDTO>(await enviar(`${API_URL}/stock-counts/${stockCountId}/findings`, input));
}
