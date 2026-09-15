import type { Prisma } from "@prisma/client";
import type { Customer, CustomerStatusHistory, User } from "@prisma/client";
import type {
  CustomerBlockDTO,
  CustomerStatus,
  CustomerStatusAction,
  CustomerStatusEventDTO,
} from "@veridi/shared";
import {
  CUSTOMER_STATUS_ACTIONS_BY_STATUS,
  CUSTOMER_STATUS_LABELS,
  situacaoCadastral,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import {
  CustomerBlockedForSalesError,
  CustomerInactiveForSalesError,
  CustomerNotFoundError,
  InvalidCustomerStatusTransitionError,
} from "./customers.errors.js";

/**
 * Situação cadastral do Cliente — CUSTOMER-STATUS-LIFECYCLE-01, `PRODUCT_RULES.md` §95.
 *
 * Aqui vivem as três coisas que a situação precisa: a DERIVAÇÃO (de `active` +
 * `blocked`, pela função canônica do shared), o FILTRO equivalente para a
 * listagem decidir no banco, e a MUDANÇA — uma transação que trava a linha do
 * Cliente, valida a transição e grava o evento no histórico append-only.
 *
 * Não confundir com `commercial-status.ts` (§86): aquela é a situação
 * COMERCIAL, derivada da história de Projetos e Pedidos, e não decide venda.
 */

interface SituacaoPersistida {
  active: boolean;
  blocked: boolean;
}

/**
 * O evento que pôs o bloqueio VIGENTE: o Bloquear mais recente.
 *
 * Bloquear só parte de ATIVO, então o último `ACTIVE -> BLOCKED` é o bloqueio
 * em vigor. A reativação de um cliente arquivado que estava bloqueado também
 * termina em BLOCKED, e o motivo dela é o da reativação — por isso o filtro
 * olha os dois lados do evento, nunca só o destino.
 */
const BLOQUEIO_VIGENTE_ARGS = {
  where: { fromStatus: "ACTIVE" as const, toStatus: "BLOCKED" as const },
  orderBy: { changedAt: "desc" as const },
  take: 1,
};

export const bloqueioVigenteInclude = {
  statusHistory: BLOQUEIO_VIGENTE_ARGS,
} satisfies Prisma.CustomerInclude;

/**
 * O mesmo bloqueio vigente para quem carrega o Cliente por `select` em vez de
 * `include` — espalhar o `include` dentro de um `select` faz o TypeScript
 * perder o tipo da relação inteira.
 */
export const bloqueioVigenteSelect = BLOQUEIO_VIGENTE_ARGS;

/** Cliente inteiro com o bloqueio vigente — o que a listagem e o cadastro carregam. */
export type CustomerComBloqueio = Customer & { statusHistory?: CustomerStatusHistory[] };

/**
 * O mínimo para decidir a situação: os dois fatos e, quando a recusa precisa
 * dizer o motivo, o evento do bloqueio. Estrutural de propósito — cada módulo
 * carrega o Cliente com o `select` que já usava.
 */
export interface SituacaoDoCliente {
  active: boolean;
  blocked: boolean;
  statusHistory?: { reason: string; changedAt: Date; changedByNameSnapshot: string | null }[];
}

export function bloqueioVigente(customer: SituacaoDoCliente): CustomerBlockDTO | null {
  if (!customer.blocked) return null;
  const evento = customer.statusHistory?.[0];
  if (!evento) return null;
  return {
    reason: evento.reason,
    blockedAt: evento.changedAt.toISOString(),
    blockedByName: evento.changedByNameSnapshot,
  };
}

export function toStatusEventDTO(evento: CustomerStatusHistory): CustomerStatusEventDTO {
  return {
    id: evento.id,
    fromStatus: evento.fromStatus,
    toStatus: evento.toStatus,
    reason: evento.reason,
    changedAt: evento.changedAt.toISOString(),
    changedByName: evento.changedByNameSnapshot,
  };
}

/** O histórico inteiro, do mais recente ao mais antigo: são poucos eventos por Cliente. */
export async function listCustomerStatusHistory(
  customerId: string,
): Promise<CustomerStatusEventDTO[]> {
  const eventos = await getPrisma().customerStatusHistory.findMany({
    where: { customerId },
    orderBy: { changedAt: "desc" },
  });
  return eventos.map(toStatusEventDTO);
}

/**
 * O filtro da listagem, na mesma verdade da derivação: quem decide o recorte é
 * o banco, para a paginação contar o que a tela mostra.
 */
export function filtroDaSituacaoCadastral(
  statuses: readonly CustomerStatus[],
): Prisma.CustomerWhereInput {
  const por: Record<CustomerStatus, Prisma.CustomerWhereInput> = {
    ACTIVE: { active: true, blocked: false },
    BLOCKED: { active: true, blocked: true },
    INACTIVE: { active: false },
  };
  return { OR: [...new Set(statuses)].map((status) => por[status]) };
}

/** O efeito de cada ação sobre os dois fatos — nunca "gravar a situação". */
const EFEITO: Record<CustomerStatusAction, (atual: SituacaoPersistida) => SituacaoPersistida> = {
  BLOCK: (atual) => ({ active: atual.active, blocked: true }),
  UNBLOCK: (atual) => ({ active: atual.active, blocked: false }),
  // Inativar não desfaz o bloqueio: ele fica latente e volta na reativação —
  // arquivar um cliente bloqueado não é uma forma de desbloqueá-lo.
  DEACTIVATE: (atual) => ({ active: false, blocked: atual.blocked }),
  ACTIVATE: (atual) => ({ active: true, blocked: atual.blocked }),
};

function recusaDaTransicao(action: CustomerStatusAction, de: CustomerStatus): string {
  if (action === "BLOCK") {
    return de === "BLOCKED"
      ? "Cliente já está bloqueado."
      : "Cliente inativo não pode ser bloqueado — reative o cadastro antes.";
  }
  if (action === "UNBLOCK") {
    return de === "ACTIVE"
      ? "Cliente não está bloqueado."
      : "Cliente inativo — reative o cadastro antes de desbloquear.";
  }
  if (action === "DEACTIVATE") return "Cliente já está inativo.";
  return `Cliente não está inativo (situação atual: ${CUSTOMER_STATUS_LABELS[de]}).`;
}

/**
 * Bloquear, Desbloquear, Inativar e Reativar — a única porta de mudança.
 *
 * Tudo numa transação: o Cliente novo e o evento do histórico nascem juntos ou
 * não nascem. `FOR UPDATE` antes de ler garante que dois comandos concorrentes
 * não partam da mesma situação: o segundo espera, relê o que o primeiro
 * gravou e cai na validação de transição, em vez de gravar um evento que
 * contradiz o outro. O histórico é append-only: nada aqui atualiza ou apaga
 * evento anterior.
 */
export async function changeCustomerStatus(
  id: string,
  action: CustomerStatusAction,
  reason: string,
  actor: User,
): Promise<void> {
  await getPrisma().$transaction(async (tx) => {
    const travado = await tx.$queryRaw<SituacaoPersistida[]>`
      SELECT active, blocked FROM customers WHERE id = ${id} FOR UPDATE
    `;
    const atual = travado[0];
    if (!atual) throw new CustomerNotFoundError(id);

    const de = situacaoCadastral(atual);
    if (!CUSTOMER_STATUS_ACTIONS_BY_STATUS[de].includes(action)) {
      throw new InvalidCustomerStatusTransitionError(recusaDaTransicao(action, de));
    }

    const novo = EFEITO[action](atual);

    await tx.customer.update({
      where: { id },
      data: {
        ...novo,
        // Mudar a situação é alteração do cadastro: `updatedAt` muda sozinho,
        // e deixar a autoria parada mostraria data nova com autor velho.
        updatedByUserId: actor.id,
        updatedByNameSnapshot: actor.name,
      },
    });

    await tx.customerStatusHistory.create({
      data: {
        customerId: id,
        fromStatus: de,
        toStatus: situacaoCadastral(novo),
        reason,
        changedByUserId: actor.id,
        changedByNameSnapshot: actor.name,
      },
    });
  });
}

/**
 * Operação comercial NOVA exige cliente ATIVO — §95.
 *
 * Bloqueado e inativo recusam com frases diferentes, porque são fatos
 * diferentes para quem vende: um é decisão comercial em vigor (com motivo),
 * o outro é cadastro arquivado. Documento que já existe não passa por aqui —
 * Pedido confirmado, faturamento e histórico seguem intactos.
 *
 * O Cliente vem CARREGADO (com `bloqueioVigenteInclude` quando a mensagem
 * precisa do motivo): quem sabe buscá-lo — e qual 404 devolver — é o módulo
 * que chama.
 */
export function assertCustomerCanSell(customer: SituacaoDoCliente): void {
  const status = situacaoCadastral(customer);
  if (status === "ACTIVE") return;
  if (status === "INACTIVE") throw new CustomerInactiveForSalesError();
  throw new CustomerBlockedForSalesError(bloqueioVigente(customer)?.reason ?? null);
}
