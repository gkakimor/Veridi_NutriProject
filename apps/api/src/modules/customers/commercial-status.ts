import type { Prisma } from "@prisma/client";
import type {
  CustomerCommercialStatus,
  CustomerCommercialStatusDTO,
  CustomerProjectSummaryDTO,
  ProjectStatus,
} from "@veridi/shared";
import {
  COMMERCIALLY_OPEN_PROJECT_STATUSES,
  CUSTOMER_INACTIVITY_WINDOW_DAYS,
  diaCivilDeslocado,
  diaDoInstantePorExtenso,
  hojeComercial,
  limitesDoDiaComercial,
} from "@veridi/shared";

/**
 * Situação comercial do Cliente — CUSTOMER-COMMERCIAL-STATUS-01, `PRODUCT_RULES.md` §86.
 *
 * Derivada na LEITURA, dos fatos que já existem: sem coluna, sem job, e por
 * isso nunca dessincronizada. Precedência, de cima para baixo:
 *
 * 1. converteu alguma vez — Projeto aprovado ou Pedido confirmado —: ACTIVE,
 *    para sempre;
 * 2. não converteu e tem Projeto aguardando ou em amostra: PROSPECT;
 * 3. não converteu, sem Projeto aberto, até 15 dias civis desde a última
 *    atividade comercial relevante: PROSPECT;
 * 4. passados os 15 dias civis completos: INACTIVE.
 *
 * `Customer.active` não entra em nada disto. O dia é o dia comercial da
 * Veridi (`hojeComercial`), nunca o do navegador nem o da máquina.
 *
 * A mesma regra existe em duas formas, e elas precisam concordar: a DERIVAÇÃO
 * de um Cliente carregado (`situacaoComercial`) e o FILTRO da listagem
 * (`filtroDaSituacaoComercial`), que decide no banco para a paginação contar
 * certo. Os fatos considerados são os mesmos nas duas.
 */

/**
 * Pedido confirmado alguma vez. `confirmedAt` nasce na confirmação e continua
 * lá depois de um cancelamento — conversão é histórica. Status além do
 * rascunho é a mesma evidência num registro sem a data.
 */
const STATUS_DE_PEDIDO_CONFIRMADO = [
  "CONFIRMED",
  "IN_FULFILLMENT",
  "PARTIALLY_SHIPPED",
  "SHIPPED",
] as const;

const PROJETO_ABERTO: readonly ProjectStatus[] = COMMERCIALLY_OPEN_PROJECT_STATUSES;

/**
 * Os fatos que a derivação lê, num `include` só. O Prisma resolve cada relação
 * numa consulta para a página inteira — nunca uma por Cliente.
 */
export const fatosComerciaisInclude = {
  projects: {
    select: {
      code: true,
      status: true,
      createdAt: true,
      approvedAt: true,
      cancelledAt: true,
      statusHistory: { select: { toStatus: true, changedAt: true } },
    },
  },
  customerOrders: {
    where: {
      OR: [{ confirmedAt: { not: null } }, { status: { in: [...STATUS_DE_PEDIDO_CONFIRMADO] } }],
    },
    select: { code: true, confirmedAt: true },
  },
} satisfies Prisma.CustomerInclude;

export interface FatosComerciais {
  createdAt: Date;
  projects: {
    code: string;
    status: ProjectStatus;
    createdAt: Date;
    approvedAt: Date | null;
    cancelledAt: Date | null;
    statusHistory: { toStatus: ProjectStatus; changedAt: Date }[];
  }[];
  /** Só os Pedidos confirmados alguma vez — o `include` já filtra. */
  customerOrders: { code: string; confirmedAt: Date | null }[];
}

/** `2026-09-16` → `16/09/2026`. */
function diaPorExtenso(dia: string): string {
  const [ano, mes, d] = dia.split("-");
  return `${d}/${mes}/${ano}`;
}

interface Atividade {
  em: Date;
  descricao: string;
}

/**
 * A atividade comercial relevante mais recente — o que a janela mede.
 *
 * Cadastro do Cliente, abertura de Projeto, cada mudança de status (entrada em
 * stand-by, cancelamento, reabertura) e a data de cancelamento. Edição de
 * cadastro e login não são atividade comercial.
 */
function ultimaAtividade(fatos: FatosComerciais): Atividade {
  let ultima: Atividade = {
    em: fatos.createdAt,
    descricao: `Cliente cadastrado em ${diaDoInstantePorExtenso(fatos.createdAt)}`,
  };
  const considerar = (em: Date | null, descricao: (dia: string) => string) => {
    if (em && em.getTime() >= ultima.em.getTime()) {
      ultima = { em, descricao: descricao(diaDoInstantePorExtenso(em)) };
    }
  };
  for (const projeto of fatos.projects) {
    considerar(projeto.createdAt, (dia) => `Projeto ${projeto.code} aberto em ${dia}`);
    for (const passo of projeto.statusHistory) {
      considerar(passo.changedAt, (dia) =>
        passo.toStatus === "STAND_BY"
          ? `Projeto ${projeto.code} em stand-by desde ${dia}`
          : passo.toStatus === "CANCELLED"
            ? `Projeto ${projeto.code} cancelado em ${dia}`
            : `Projeto ${projeto.code} movimentado em ${dia}`,
      );
    }
    considerar(projeto.cancelledAt, (dia) => `Projeto ${projeto.code} cancelado em ${dia}`);
  }
  return ultima;
}

function maisAntiga(datas: Date[]): Date | null {
  return datas.reduce<Date | null>(
    (menor, data) => (menor === null || data.getTime() < menor.getTime() ? data : menor),
    null,
  );
}

/** A situação comercial de UM Cliente com os fatos já carregados. */
export function situacaoComercial(
  fatos: FatosComerciais,
  agora: Date = new Date(),
): CustomerCommercialStatusDTO {
  // 1. Conversão — histórica: aprovação e confirmação valem para sempre.
  const conversoes: { em: Date | null; motivo: string }[] = [];
  for (const projeto of fatos.projects) {
    const aprovacoes = [
      projeto.approvedAt,
      ...projeto.statusHistory
        .filter((passo) => passo.toStatus === "APPROVED")
        .map((passo) => passo.changedAt),
    ].filter((data): data is Date => data !== null);
    if (aprovacoes.length > 0 || projeto.status === "APPROVED") {
      conversoes.push({ em: maisAntiga(aprovacoes), motivo: `Projeto aprovado (${projeto.code})` });
    }
  }
  for (const pedido of fatos.customerOrders) {
    conversoes.push({ em: pedido.confirmedAt, motivo: `Pedido confirmado (${pedido.code})` });
  }
  if (conversoes.length > 0) {
    // "Cliente desde" é a conversão MAIS ANTIGA — nunca a do último Pedido.
    const datadas = conversoes
      .filter((conversao) => conversao.em !== null)
      .sort((a, b) => a.em!.getTime() - b.em!.getTime());
    const primeira = datadas[0] ?? conversoes[0]!;
    return {
      status: "ACTIVE",
      reason: primeira.motivo,
      customerSince: primeira.em ? hojeComercial(primeira.em) : null,
    };
  }

  // 2. Oportunidade aberta: Prospect enquanto houver Projeto aguardando ou em amostra.
  const abertos = fatos.projects.filter((projeto) => PROJETO_ABERTO.includes(projeto.status));
  if (abertos.length > 0) {
    return {
      status: "PROSPECT",
      reason:
        abertos.length === 1
          ? `Projeto ${abertos[0]!.code} em andamento`
          : `${abertos.length} projetos em andamento`,
      customerSince: null,
    };
  }

  // 3 e 4. Janela de 15 dias CIVIS desde a última atividade relevante.
  const ultima = ultimaAtividade(fatos);
  const ultimoDiaDeProspect = diaCivilDeslocado(
    hojeComercial(ultima.em),
    CUSTOMER_INACTIVITY_WINDOW_DAYS,
  );
  if (hojeComercial(agora) <= ultimoDiaDeProspect) {
    return {
      status: "PROSPECT",
      reason: `${ultima.descricao} · sem oportunidade aberta, Prospect até ${diaPorExtenso(ultimoDiaDeProspect)}`,
      customerSince: null,
    };
  }
  return {
    status: "INACTIVE",
    reason: `Sem atividade comercial há mais de ${CUSTOMER_INACTIVITY_WINDOW_DAYS} dias · ${ultima.descricao}`,
    customerSince: null,
  };
}

/**
 * O primeiro instante que ainda mantém Prospect: o início do dia comercial de
 * (hoje − 15). Atividade a partir dele cai dentro da janela; tudo antes dele
 * já passou dos 15 dias civis completos.
 */
export function inicioDaJanelaDeProspect(agora: Date = new Date()): Date {
  const primeiroDia = diaCivilDeslocado(hojeComercial(agora), -CUSTOMER_INACTIVITY_WINDOW_DAYS);
  return limitesDoDiaComercial(primeiroDia).inicio;
}

/**
 * A mesma regra como `where`, para a listagem filtrar e contar no banco.
 *
 * "A última atividade é anterior à janela" vira "TODAS as atividades são
 * anteriores a ela" — a mais recente de um conjunto é antiga exatamente
 * quando todas são.
 */
export function filtroDaSituacaoComercial(
  status: CustomerCommercialStatus,
  agora: Date = new Date(),
): Prisma.CustomerWhereInput {
  const convertido: Prisma.CustomerWhereInput = {
    OR: [
      {
        projects: {
          some: {
            OR: [
              { approvedAt: { not: null } },
              { status: "APPROVED" },
              { statusHistory: { some: { toStatus: "APPROVED" } } },
            ],
          },
        },
      },
      {
        customerOrders: {
          some: {
            OR: [
              { confirmedAt: { not: null } },
              { status: { in: [...STATUS_DE_PEDIDO_CONFIRMADO] } },
            ],
          },
        },
      },
    ],
  };
  if (status === "ACTIVE") return convertido;

  const comProjetoAberto: Prisma.CustomerWhereInput = {
    projects: { some: { status: { in: [...COMMERCIALLY_OPEN_PROJECT_STATUSES] } } },
  };
  const limite = inicioDaJanelaDeProspect(agora);
  const semAtividadeNaJanela: Prisma.CustomerWhereInput = {
    createdAt: { lt: limite },
    projects: {
      none: {
        OR: [
          { createdAt: { gte: limite } },
          { cancelledAt: { gte: limite } },
          { statusHistory: { some: { changedAt: { gte: limite } } } },
        ],
      },
    },
  };

  if (status === "INACTIVE") {
    return { AND: [{ NOT: convertido }, { NOT: comProjetoAberto }, semAtividadeNaJanela] };
  }
  return {
    AND: [{ NOT: convertido }, { OR: [comProjetoAberto, { NOT: semAtividadeNaJanela }] }],
  };
}

/** Os Projetos do Cliente por situação — o resumo da Consulta. */
export function resumoDeProjetos(projetos: { status: ProjectStatus }[]): CustomerProjectSummaryDTO {
  const conta = (status: readonly ProjectStatus[]) =>
    projetos.filter((projeto) => status.includes(projeto.status)).length;
  return {
    open: conta(PROJETO_ABERTO),
    standBy: conta(["STAND_BY"]),
    approved: conta(["APPROVED"]),
    cancelled: conta(["CANCELLED"]),
  };
}
