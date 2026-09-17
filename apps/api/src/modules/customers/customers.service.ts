import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";
import type { CustomerDTO, CustomerListResponse } from "@veridi/shared";
import { CUSTOMER_CODE_PREFIX, situacaoCadastral } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { exigirNomeDeCadastroLivre } from "../../lib/nome-de-cadastro-mestre.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import {
  condicaoPadraoParaGravar,
  padraoDePagamentoDTO,
  padraoDePagamentoSelect,
  tocaCondicaoPadrao,
} from "../../lib/payment-condition.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import { CustomerNotFoundError, DuplicateCnpjError } from "./customers.errors.js";
import {
  fatosComerciaisInclude,
  filtroDaSituacaoComercial,
  situacaoComercial,
} from "./commercial-status.js";
import type { CustomerComBloqueio } from "./customer-status.js";
import {
  bloqueioVigente,
  bloqueioVigenteInclude,
  filtroDaSituacaoCadastral,
} from "./customer-status.js";
import type {
  CreateCustomerInput,
  ListCustomersQuery,
  UpdateCustomerInput,
} from "./customers.schemas.js";

const CODE_SEQUENCE = "customer_code_seq";

/**
 * Endereco estruturado (capacidade 33). Chave ausente nao mexe, `""` limpa
 * — mesmo idioma dos demais campos do cadastro.
 */
function addressData(input: CreateCustomerInput | UpdateCustomerInput) {
  return {
    ...(input.street !== undefined ? { street: input.street } : {}),
    ...(input.number !== undefined ? { number: input.number } : {}),
    ...(input.complement !== undefined ? { complement: input.complement } : {}),
    ...(input.district !== undefined ? { district: input.district } : {}),
    ...(input.zipCode !== undefined ? { zipCode: input.zipCode } : {}),
    ...(input.city !== undefined ? { city: input.city } : {}),
    ...(input.state !== undefined ? { state: input.state } : {}),
  };
}

function toCustomerDTO(customer: CustomerComBloqueio): CustomerDTO {
  return {
    id: customer.id,
    code: customer.code,
    legalName: customer.legalName,
    tradeName: customer.tradeName,
    cnpj: customer.cnpj,
    email: customer.email,
    phone: customer.phone,
    taxProfile: customer.taxProfile,
    street: customer.street,
    number: customer.number,
    complement: customer.complement,
    district: customer.district,
    zipCode: customer.zipCode,
    city: customer.city,
    state: customer.state,
    notes: customer.notes,
    businessLotSuffix: customer.businessLotSuffix,
    // Pagamento padrão: sugestão para orçamentos novos, `null` = não informado.
    ...padraoDePagamentoDTO(customer),
    active: customer.active,
    blocked: customer.blocked,
    // Situação cadastral (§95): derivada dos dois fatos, nunca uma coluna
    // própria que alguém pudesse gravar sem passar pelo histórico.
    status: situacaoCadastral(customer),
    block: bloqueioVigente(customer),
    createdAt: customer.createdAt.toISOString(),
    createdByName: customer.createdByNameSnapshot,
    updatedAt: customer.updatedAt.toISOString(),
    updatedByName: customer.updatedByNameSnapshot,
  };
}

async function assertCnpjAvailable(cnpj: string, excludeId?: string): Promise<void> {
  const existing = await getPrisma().customer.findFirst({
    where: { cnpj, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (existing) throw new DuplicateCnpjError(cnpj);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

async function requireCustomer(id: string): Promise<void> {
  const customer = await getPrisma().customer.findUnique({ where: { id }, select: { id: true } });
  if (!customer) throw new CustomerNotFoundError(id);
}

export async function listCustomers(
  query: ListCustomersQuery,
  pagination: Pagination = query,
): Promise<CustomerListResponse> {
  const prisma = getPrisma();
  const where: Prisma.CustomerWhereInput = {};

  if (query.ids && query.ids.length > 0) where.id = { in: query.ids };
  if (query.active !== undefined) where.active = query.active;
  if (query.state) where.state = query.state;
  if (query.search) {
    where.OR = [
      { code: { contains: query.search, mode: "insensitive" } },
      { legalName: { contains: query.search, mode: "insensitive" } },
      { tradeName: { contains: query.search, mode: "insensitive" } },
      { cnpj: { contains: query.search, mode: "insensitive" } },
    ];
  }

  /*
   * Situação cadastral (§95) e situação comercial (§86) são perguntas
   * diferentes e filtram juntas, cada uma no banco — a paginação conta o que a
   * tela mostra, e a derivação de cada linha lê o que o `include` trouxe para
   * a página inteira, numa consulta por relação.
   */
  const agora = new Date();
  const condicoes: Prisma.CustomerWhereInput[] = [];
  if (query.status) condicoes.push(filtroDaSituacaoCadastral(query.status));
  if (query.commercialStatus) {
    condicoes.push(filtroDaSituacaoComercial(query.commercialStatus, agora));
  }
  if (condicoes.length > 0) where.AND = condicoes;

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      include: { ...fatosComerciaisInclude, ...bloqueioVigenteInclude },
      orderBy: { code: "asc" },
      ...pageArgs(pagination),
    }),
    prisma.customer.count({ where }),
  ]);

  return {
    customers: customers.map((customer) => ({
      ...toCustomerDTO(customer),
      commercial: situacaoComercial(customer, agora),
    })),
    ...pageMeta(pagination, total),
  };
}

export async function getCustomerById(id: string): Promise<CustomerDTO | null> {
  const customer = await getPrisma().customer.findUnique({
    where: { id },
    include: bloqueioVigenteInclude,
  });
  return customer ? toCustomerDTO(customer) : null;
}

export async function createCustomer(
  input: CreateCustomerInput,
  actor: User,
): Promise<CustomerDTO> {
  await exigirNomeDeCadastroLivre("CUSTOMER", input.legalName);
  if (input.cnpj) await assertCnpjAvailable(input.cnpj);
  // Antes de consumir código: condição parcelada sem parcelas não nasce.
  const condicaoPadrao = tocaCondicaoPadrao(input) ? condicaoPadraoParaGravar(null, input) : {};

  const prisma = getPrisma();
  const code = await nextSequenceCode(prisma, CODE_SEQUENCE, CUSTOMER_CODE_PREFIX);

  try {
    const customer = await prisma.customer.create({
      data: {
        code,
        legalName: input.legalName,
        ...(input.tradeName !== undefined ? { tradeName: input.tradeName } : {}),
        ...(input.cnpj !== undefined ? { cnpj: input.cnpj } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        // Ausente: o default do banco (NOT_INFORMED) decide, como para o
        // importador legado e para toda linha anterior à coluna.
        ...(input.taxProfile !== undefined ? { taxProfile: input.taxProfile } : {}),
        ...addressData(input),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.businessLotSuffix !== undefined
          ? { businessLotSuffix: input.businessLotSuffix }
          : {}),
        ...(input.defaultPaymentInstrument !== undefined
          ? { defaultPaymentInstrument: input.defaultPaymentInstrument }
          : {}),
        ...condicaoPadrao,
        createdByUserId: actor.id,
        createdByNameSnapshot: actor.name,
        updatedByUserId: actor.id,
        updatedByNameSnapshot: actor.name,
      },
      include: bloqueioVigenteInclude,
    });
    return toCustomerDTO(customer);
  } catch (error) {
    if (isUniqueConstraintError(error) && input.cnpj) {
      throw new DuplicateCnpjError(input.cnpj);
    }
    throw error;
  }
}

/**
 * Alteração de cadastro. A situação cadastral NÃO entra aqui: ela muda só
 * pelas quatro ações de `customer-status.ts`, que exigem motivo e gravam o
 * histórico — um PATCH que pudesse bloquear ou inativar deixaria o histórico
 * incompleto sem ninguém perceber.
 */
export async function updateCustomer(
  id: string,
  input: UpdateCustomerInput,
  actor: User,
): Promise<CustomerDTO> {
  await requireCustomer(id);
  if (input.legalName !== undefined) await exigirNomeDeCadastroLivre("CUSTOMER", input.legalName, id);
  if (input.cnpj) await assertCnpjAvailable(input.cnpj, id);

  try {
    const customer = await getPrisma().$transaction(async (tx) => {
      /*
       * Condição padrão é um bloco: o PATCH parcial se resolve contra o que está
       * GRAVADO, e a checagem "parcelado com parcelas" vale para o estado que a
       * gravação produz. A trava da linha impede que dois PATCHes válidos cada
       * um, lidos antes um do outro, gravem juntos um parcelado sem parcelas.
       */
      let condicaoPadrao = {};
      if (tocaCondicaoPadrao(input)) {
        await tx.$queryRaw`SELECT id FROM customers WHERE id = ${id} FOR UPDATE`;
        const gravado = await tx.customer.findUniqueOrThrow({
          where: { id },
          select: padraoDePagamentoSelect,
        });
        condicaoPadrao = condicaoPadraoParaGravar(gravado, input);
      }

      return tx.customer.update({
        where: { id },
        data: {
          ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
          ...(input.tradeName !== undefined ? { tradeName: input.tradeName } : {}),
          ...(input.cnpj !== undefined ? { cnpj: input.cnpj } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.taxProfile !== undefined ? { taxProfile: input.taxProfile } : {}),
          ...addressData(input),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.businessLotSuffix !== undefined
            ? { businessLotSuffix: input.businessLotSuffix }
            : {}),
          ...(input.defaultPaymentInstrument !== undefined
            ? { defaultPaymentInstrument: input.defaultPaymentInstrument }
            : {}),
          ...condicaoPadrao,
          // Quem criou nao muda numa alteracao — so quem alterou por ultimo.
          updatedByUserId: actor.id,
          updatedByNameSnapshot: actor.name,
        },
        include: bloqueioVigenteInclude,
      });
    });
    return toCustomerDTO(customer);
  } catch (error) {
    if (isUniqueConstraintError(error) && input.cnpj) {
      throw new DuplicateCnpjError(input.cnpj);
    }
    throw error;
  }
}
