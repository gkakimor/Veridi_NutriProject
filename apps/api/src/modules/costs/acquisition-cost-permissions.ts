import type { UserRole } from "@veridi/shared";
import { ACQUISITION_COST_ROLES, USER_ROLE_LABELS } from "@veridi/shared";
import { ForbiddenError } from "../auth/auth.errors.js";

/**
 * Quem informa o custo efetivo de aquisição — ACQUISITION-COST-PERMISSION-01.
 *
 * O custo gravado na linha de recebimento é a fonte REAL do lote e entra nas
 * médias de 30 e 90 dias do Item. Duas portas gravam esse número, e as duas
 * seguem `ACQUISITION_COST_ROLES`:
 *
 * - `PUT /receipt-lines/:id/acquisition-cost` é o ato inteiro: a rota confere o
 *   perfil com `exigirPerfil`, antes do corpo e da linha;
 * - `POST /purchase-orders/:id/receipts` é o recebimento físico, aberto a toda
 *   sessão; só o custo que vier junto tem dono, e o pedido que o traz de outro
 *   perfil é recusado — nunca gravado sem o custo em silêncio.
 */
export function podeInformarCustoDeAquisicao(role: UserRole): boolean {
  return ACQUISITION_COST_ROLES.includes(role);
}

/**
 * O corpo cru do recebimento informa custo em alguma linha? Lido ANTES da
 * validação, para a recusa por perfil vir antes do 400 e da busca da OC.
 *
 * Ausente, `null` ou texto em branco não informam custo: é o desconhecido que
 * todo perfil pode deixar (e `null`, que o contrato não aceita, cai no 400 de
 * qualquer um). Qualquer outro valor — inclusive ilegível ou negativo — é
 * alguém tentando informar custo.
 */
export function recebimentoInformaCusto(corpo: unknown): boolean {
  if (typeof corpo !== "object" || corpo === null) return false;
  const linhas = (corpo as { lines?: unknown }).lines;
  if (!Array.isArray(linhas)) return false;
  return linhas.some((linha) => {
    if (typeof linha !== "object" || linha === null) return false;
    const custo = (linha as { actualUnitCost?: unknown }).actualUnitCost;
    if (custo === undefined || custo === null) return false;
    return !(typeof custo === "string" && custo.trim() === "");
  });
}

/** "Compras ou Administrador" — lido da mesma lista que o gate aplica. */
function quemInforma(): string {
  return ACQUISITION_COST_ROLES.map((role) => USER_ROLE_LABELS[role]).join(" ou ");
}

/** A recusa do recebimento que traz custo de quem não o informa: diz de quem é e o caminho. */
export function recusaDoCustoNoRecebimento(): ForbiddenError {
  return new ForbiddenError(
    `Seu perfil não informa o custo efetivo de aquisição — só ${quemInforma()}. Confirme o recebimento sem o custo.`,
  );
}
