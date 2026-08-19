import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";
import type {
  CostTemplateDTO,
  IndustrialCostVersionDTO,
  TemplateDiffDTO,
  TemplateUpdateAvailableDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { getIndustrialCostVersion } from "../industrial-costs/industrial-costs.service.js";
import { IndustrialCostVersionNotFoundError } from "../industrial-costs/industrial-costs.errors.js";
import { ProductNotFoundError } from "../formulations/formulations.errors.js";
import {
  CostDraftInUseError,
  CostTemplateNotFoundError,
  TemplateArchivedForUseError,
  TemplateNotActiveError,
} from "./cost-templates.errors.js";
import {
  compararEstruturas,
  createCostTemplate,
  estruturaComparavel,
  getCostTemplate,
  requireCostTemplateVersion,
  updateCostTemplateVersion,
} from "./cost-templates.service.js";
import type { CreateCostTemplateFromVersionInput } from "./cost-templates.schemas.js";

/**
 * Aplicar um template de estrutura a um Produto — e voltar.
 *
 * A regra que governa este arquivo: **usar um template é copiar CONFIGURAÇÃO**.
 *
 * O que atravessa: base de produção, quais recursos e por quanto tempo, modo
 * de energia, serviços e rateios. O que NÃO atravessa: tarifa, preço/hora,
 * custo calculado. Os campos `rate*Snapshot` da estrutura operacional existem
 * para congelar economia NA ATIVAÇÃO dela — não na cópia. Preenchê-los aqui
 * faria um produto novo nascer com a tarifa do dia em que a matriz foi
 * escrita, e ninguém descobriria até comparar dois cálculos.
 */

/** Uma EC em rascunho, sem configuração nenhuma, pode receber o template. */
function podeSerPreenchida(version: {
  status: string;
  resourceUsages: unknown[];
  lines: unknown[];
  energyCalculationMode: string;
}): boolean {
  return (
    version.status === "DRAFT" &&
    version.resourceUsages.length === 0 &&
    version.lines.length === 0 &&
    version.energyCalculationMode === "NONE"
  );
}

export async function applyCostTemplateToProduct(
  productId: string,
  templateVersionId: string,
  actor: User,
): Promise<IndustrialCostVersionDTO> {
  const prisma = getPrisma();
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new ProductNotFoundError(productId);

  const template = await requireCostTemplateVersion(templateVersionId);
  if (template.status !== "ACTIVE") throw new TemplateNotActiveError(template.status);
  if (template.industrialCostTemplate.archivedAt !== null) {
    throw new TemplateArchivedForUseError(template.industrialCostTemplate.code);
  }

  /*
   * A estrutura precisa de uma formulação: é dela que sai a lista de
   * materiais. O template não carrega materiais — carrega o entorno
   * industrial —, então a receita continua vindo do produto.
   */
  const formulacao = await prisma.formulationVersion.findFirst({
    where: { productId, status: "ACTIVE" },
    select: { id: true, versionNumber: true },
  });
  const rascunhoFormulacao = formulacao
    ? null
    : await prisma.formulationVersion.findFirst({
        where: { productId },
        orderBy: { versionNumber: "desc" },
        select: { id: true, versionNumber: true },
      });
  const formulacaoEscolhida = formulacao ?? rascunhoFormulacao;
  if (!formulacaoEscolhida) throw new ProductNotFoundError(productId);

  const versionId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;

    const existentes = await tx.industrialCostVersion.findMany({
      where: { productId },
      include: { resourceUsages: { select: { id: true } }, lines: { select: { id: true } } },
      orderBy: { versionNumber: "asc" },
    });

    const configuracao = {
      referenceOutputQuantity: template.referenceOutputQuantity,
      referenceOutputUomCode: template.referenceOutputUomCode,
      energyCalculationMode: template.energyCalculationMode,
      energyResourceId: template.energyResourceId,
      notes: template.notes,
      // PROVENIÊNCIA — código e número gravados junto para o rótulo
      // sobreviver mesmo se o template sumir.
      originCostTemplateVersionId: template.id,
      originCostTemplateCode: template.industrialCostTemplate.code,
      originCostTemplateVersionNumber: template.versionNumber,
    };

    /*
     * Linhas SEMPRE novas, e SEM os snapshots econômicos. A tarifa continua
     * sendo resolvida pelo motor na data de referência do cálculo — é isso
     * que mantém a biblioteca viva enquanto os preços mudam.
     */
    const usosNovos = template.resourceUsages.map((usage, index) => ({
      industrialResourceId: usage.industrialResourceId,
      usageBasis: usage.usageBasis,
      usageQuantity: usage.usageQuantity,
      usageUom: usage.usageUom,
      notes: usage.notes,
      sortOrder: index,
    }));
    const linhasNovas = template.additionalCosts.map((cost, index) => ({
      category: cost.category,
      description: cost.description,
      calculationBasis: cost.calculationBasis,
      rateValue: cost.rateValue,
      notes: cost.notes,
      sortOrder: index,
    }));

    const rascunhoVazio = existentes.find((version) => podeSerPreenchida(version));
    if (rascunhoVazio) {
      await tx.industrialCostVersion.update({
        where: { id: rascunhoVazio.id },
        data: {
          ...configuracao,
          resourceUsages: { create: usosNovos },
          lines: { create: linhasNovas },
        },
      });
      return rascunhoVazio.id;
    }

    /*
     * Um rascunho de estrutura por produto — regra do domínio, garantida por
     * índice parcial. Se o rascunho existente tem configuração, não há para
     * onde ir sem apagar trabalho alheio: a operação para e explica.
     */
    const rascunhoOcupado = existentes.find((version) => version.status === "DRAFT");
    if (rascunhoOcupado) throw new CostDraftInUseError(rascunhoOcupado.code);

    const maior = existentes.reduce((max, version) => Math.max(max, version.versionNumber), 0);
    const { nextSequenceCode } = await import("../../lib/sequence-code.js");
    const code = await nextSequenceCode(prisma, "industrial_cost_code_seq", "EC");

    const criada = await tx.industrialCostVersion.create({
      data: {
        code,
        productId,
        versionNumber: maior + 1,
        status: "DRAFT",
        formulationVersionId: formulacaoEscolhida.id,
        ...configuracao,
        createdByNameSnapshot: actor.name,
        resourceUsages: { create: usosNovos },
        lines: { create: linhasNovas },
      },
    });
    return criada.id;
  });

  return (await getIndustrialCostVersion(versionId))!;
}

/**
 * Existe versão de template mais recente do que a que originou esta estrutura?
 *
 * Só informa. Não existe "atualizar para a V2" que sobrescreva — atualizar no
 * lugar reescreveria uma estrutura que já pode ter servido de base para
 * cálculo, preço e produção.
 */
export async function getCostTemplateUpdateAvailable(
  costVersionId: string,
): Promise<TemplateUpdateAvailableDTO | null> {
  const prisma = getPrisma();
  const version = await prisma.industrialCostVersion.findUnique({
    where: { id: costVersionId },
    select: { originCostTemplateVersionId: true },
  });
  if (!version) throw new IndustrialCostVersionNotFoundError(costVersionId);
  if (!version.originCostTemplateVersionId) return null;

  const origem = await requireCostTemplateVersion(version.originCostTemplateVersionId);
  const ativa = await prisma.industrialCostTemplateVersion.findFirst({
    where: { industrialCostTemplateId: origem.industrialCostTemplateId, status: "ACTIVE" },
    select: { id: true, versionNumber: true },
  });
  if (!ativa || ativa.id === origem.id) return null;
  if (ativa.versionNumber <= origem.versionNumber) return null;

  return {
    templateId: origem.industrialCostTemplateId,
    templateCode: origem.industrialCostTemplate.code,
    templateName: origem.industrialCostTemplate.name,
    originVersionId: origem.id,
    originVersionNumber: origem.versionNumber,
    latestVersionId: ativa.id,
    latestVersionNumber: ativa.versionNumber,
  };
}

/** O que muda entre a estrutura atual e a versão nova do template. */
export async function compareCostVersionWithTemplate(
  costVersionId: string,
  targetTemplateVersionId?: string,
): Promise<TemplateDiffDTO> {
  const prisma = getPrisma();
  const version = await prisma.industrialCostVersion.findUnique({
    where: { id: costVersionId },
    include: {
      energyResource: true,
      resourceUsages: { include: { industrialResource: true }, orderBy: { sortOrder: "asc" } },
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!version) throw new IndustrialCostVersionNotFoundError(costVersionId);

  const alvoId =
    targetTemplateVersionId ??
    (await getCostTemplateUpdateAvailable(costVersionId))?.latestVersionId;
  if (!alvoId) throw new CostTemplateNotFoundError(costVersionId);
  const alvo = await requireCostTemplateVersion(alvoId);

  // Compara a ESTRUTURA ATUAL contra a versão nova — quem lê quer saber o que
  // muda no produto dela, incluindo os ajustes que ela mesma fez.
  const estruturaAtual = {
    label: `${version.code} · V${version.versionNumber}`,
    referenceOutputQuantity: version.referenceOutputQuantity.toString(),
    referenceOutputUomCode: version.referenceOutputUomCode,
    energyCalculationMode: version.energyCalculationMode,
    energyResourceName: version.energyResource?.name ?? null,
    resources: version.resourceUsages.map((usage) => ({
      name: usage.industrialResource.name,
      usageQuantity: usage.usageQuantity.toString(),
      usageUom: usage.usageUom,
      usageBasis: usage.usageBasis,
    })),
    costs: version.lines.map((line) => ({
      description: line.description,
      category: line.category,
      calculationBasis: line.calculationBasis,
      rateValue: line.rateValue ? line.rateValue.toString() : null,
    })),
  };

  return compararEstruturas(estruturaAtual, estruturaComparavel(alvo));
}

/**
 * Salvar a estrutura de custos do produto como matriz da biblioteca.
 *
 * É CÓPIA da CONFIGURAÇÃO. Não vão junto: cálculo, tarifas congeladas na
 * ativação, qualidade do custo, data de referência, nem qualquer valor
 * monetário resolvido — só o que descreve COMO se produz.
 *
 * Nasce em RASCUNHO: quem vai reutilizar revisa antes.
 */
export async function createCostTemplateFromVersion(
  costVersionId: string,
  input: CreateCostTemplateFromVersionInput,
  actor: User,
): Promise<CostTemplateDTO> {
  const prisma = getPrisma();
  const version = await prisma.industrialCostVersion.findUnique({
    where: { id: costVersionId },
    include: {
      resourceUsages: { orderBy: { sortOrder: "asc" } },
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!version) throw new IndustrialCostVersionNotFoundError(costVersionId);

  const template = await createCostTemplate(
    {
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      referenceOutputQuantity: version.referenceOutputQuantity.toString(),
      referenceOutputUomCode: version.referenceOutputUomCode,
    },
    actor,
  );

  const rascunho = template.draftVersion;
  if (rascunho) {
    await updateCostTemplateVersion(rascunho.id, {
      energyCalculationMode: version.energyCalculationMode,
      ...(version.energyResourceId ? { energyResourceId: version.energyResourceId } : {}),
      notes: version.notes,
      resourceUsages: version.resourceUsages.map((usage) => ({
        industrialResourceId: usage.industrialResourceId,
        usageBasis: usage.usageBasis,
        usageQuantity: usage.usageQuantity.toString(),
        usageUom: usage.usageUom,
        notes: usage.notes,
      })),
      additionalCosts: version.lines.map((line) => ({
        category: line.category,
        description: line.description,
        calculationBasis: line.calculationBasis,
        rateValue: line.rateValue ? line.rateValue.toString() : null,
        notes: line.notes,
      })),
    });
  }

  return getCostTemplate(template.id);
}

/** Reexportado para a rota. */
export { Prisma };
