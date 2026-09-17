/**
 * Fila local de contagens — INVENTORY-PHYSICAL-COUNT-01, Fatia 2A.
 *
 * Toda contagem entra aqui ANTES de ser enviada e só sai quando o servidor
 * responde que ela existe (ou quando a pessoa decide descartá-la). Se a rede
 * cai no meio, o que foi contado não se perde: ao reabrir a tela, ela oferece
 * reenviar com o MESMO `clientRequestId` — e o servidor que já tinha gravado
 * devolve o registro existente, sem duplicar.
 *
 * Três regras que não mudam:
 *
 * 1. **Por usuário e por inventário.** O reenvio grava como autor quem está
 *    logado; a fila de outra pessoa no mesmo navegador nunca é lida.
 * 2. **Só o que a contagem precisa.** Posição, rodada, o último registro visto,
 *    a quantidade contada, o id do envio e a nota. Nenhum saldo, esperado ou
 *    diferença: numa contagem cega, o armazenamento do navegador também não
 *    pode revelar o número.
 * 3. **Uma pendência por posição.** Contar de novo a mesma posição substitui a
 *    pendência — com id novo se a quantidade mudou, porque o mesmo id com outro
 *    valor devolveria o registro antigo como se fosse o novo.
 */

export interface EnvioDeContagem {
  positionId: string;
  round: number;
  /** O `lastEntryId` que a tela tinha — a trava otimista do registro. */
  expectedLastEntryId: string | null;
  /** Quantidade canônica, como vai à API (`"12.5"`). */
  countedQuantity: string;
  clientRequestId: string;
  note?: string;
}

const PREFIXO = "veridi:inventario-fisico:fila";

export function chaveDaFila(userId: string, stockCountId: string): string {
  return `${PREFIXO}:${userId}:${stockCountId}`;
}

function armazenamento(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function ehEnvio(valor: unknown): valor is EnvioDeContagem {
  if (valor === null || typeof valor !== "object") return false;
  const v = valor as Record<string, unknown>;
  return (
    typeof v["positionId"] === "string" &&
    typeof v["round"] === "number" &&
    Number.isInteger(v["round"]) &&
    (v["expectedLastEntryId"] === null || typeof v["expectedLastEntryId"] === "string") &&
    typeof v["countedQuantity"] === "string" &&
    typeof v["clientRequestId"] === "string" &&
    (v["note"] === undefined || typeof v["note"] === "string")
  );
}

/** Só os campos da contagem — nada que venha junto por engano chega ao armazenamento. */
function soOEnvio(envio: EnvioDeContagem): EnvioDeContagem {
  return {
    positionId: envio.positionId,
    round: envio.round,
    expectedLastEntryId: envio.expectedLastEntryId,
    countedQuantity: envio.countedQuantity,
    clientRequestId: envio.clientRequestId,
    ...(envio.note ? { note: envio.note } : {}),
  };
}

export function lerFila(userId: string, stockCountId: string): EnvioDeContagem[] {
  const local = armazenamento();
  if (!local) return [];
  try {
    const bruto = local.getItem(chaveDaFila(userId, stockCountId));
    if (!bruto) return [];
    const lido: unknown = JSON.parse(bruto);
    return Array.isArray(lido) ? lido.filter(ehEnvio).map(soOEnvio) : [];
  } catch {
    return [];
  }
}

function gravarFila(userId: string, stockCountId: string, fila: EnvioDeContagem[]): void {
  const local = armazenamento();
  if (!local) return;
  try {
    const chave = chaveDaFila(userId, stockCountId);
    if (fila.length === 0) local.removeItem(chave);
    else local.setItem(chave, JSON.stringify(fila.map(soOEnvio)));
  } catch {
    // Armazenamento cheio ou bloqueado: a contagem segue na tela e no envio.
  }
}

/** Guarda (ou substitui) a pendência da posição. Devolve a fila como ficou. */
export function guardarEnvio(userId: string, stockCountId: string, envio: EnvioDeContagem): EnvioDeContagem[] {
  const fila = lerFila(userId, stockCountId).filter((item) => item.positionId !== envio.positionId);
  fila.push(soOEnvio(envio));
  gravarFila(userId, stockCountId, fila);
  return fila;
}

/** Tira a pendência daquele envio — e só dele: outra contagem da mesma posição fica. */
export function tirarEnvio(userId: string, stockCountId: string, clientRequestId: string): EnvioDeContagem[] {
  const fila = lerFila(userId, stockCountId).filter((item) => item.clientRequestId !== clientRequestId);
  gravarFila(userId, stockCountId, fila);
  return fila;
}
