import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";
import type {
  FormulationTemplateDiffDTO,
  FormulationTemplateDTO,
  FormulationTemplateUpdateAvailableDTO,
  FormulationVersionDTO,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import {
  getFormulationVersionById,
  listFormulationVersionsByProduct,
} from "../formulations/formulations.service.js";
import {
  FormulationVersionNotFoundError,
  MissingFinishedItemError,
  ProductNotFoundError,
} from "../formulations/formulations.errors.js";
import {
  TemplateArchivedError,
  TemplateVersionNotActiveError,
} from "./formulation-templates.errors.js";
import {
  compararComposicoes,
  createFormulationTemplate,
  getFormulationTemplate,
  requireTemplateVersion,
  updateFormulationTemplateVersion,
  versaoComparavel,
} from "./formulation-templates.service.js";
import type { CreateTemplateFromFormulationInput } from "./formulation-templates.schemas.js";

/**
 * Aplicar um template a um Produto — e voltar.
 *
 * A regra que governa este arquivo inteiro: **usar um template é copiar**.
 * Nenhuma linha é compartilhada, nenhum id é reaproveitado, nada se
 * sincroniza depois. Dois clientes podem partir da mesma matriz e seguir
 * caminhos completamente diferentes sem que um saiba do outro.
 *
 * O contrário — apontar a formulação de vários produtos para a mesma
 * receita — teria custado menos código e sido muito pior: a primeira
 * alteração pedida por um cliente reescreveria a fórmula do outro, e a
 * descoberta viria na produção.
 */

/** Uma V1 em rascunho, vazia e sem história, pode receber o template. */
function podeSerPreenchida(version: {
  status: string;
  components: unknown[];
  basisQuantity: Prisma.Decimal;
}): boolean {
  return version.status === "DRAFT" && version.components.length === 0;
}

/**
 * Copia a versão do template para uma FormulationVersion do Produto.
 *
 * Preenche o rascunho vazio quando existe um — produto técnico nasce com a V1
 * em branco, e criar uma V2 só para não usá-la deixaria a V1 órfã na história
 * sem nunca ter significado nada. Se a versão de destino já tem conteúdo, uma
 * versão nova nasce e a anterior fica intacta.
 */
export async function applyTemplateToProduct(
  productId: string,
  templateVersionId: string,
  actor: User,
): Promise<FormulationVersionDTO> {
  const prisma = getPrisma();
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new ProductNotFoundError(productId);
  if (!product.finishedProductItemId) throw new MissingFinishedItemError();
  const outputItem = await prisma.item.findUnique({
    where: { id: product.finishedProductItemId },
  });
  if (!outputItem) throw new MissingFinishedItemError();

  const template = await requireTemplateVersion(templateVersionId);
  // Rascunho de template é trabalho em curso: copiá-lo para um produto que
  // vai ser vendido levaria uma matriz que ninguém revisou.
  if (template.status !== "ACTIVE") throw new TemplateVersionNotActiveError(template.status);
  if (template.formulationTemplate.archivedAt !== null) {
    throw new TemplateArchivedError(template.formulationTemplate.code);
  }

  const versionId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;

    const existentes = await tx.formulationVersion.findMany({
      where: { productId },
      include: { components: { select: { id: true } } },
      orderBy: { versionNumber: "asc" },
    });

    const dadosDoTemplate = {
      basisQuantity: template.basisQuantity,
      calculationMode: template.calculationMode,
      dosesPerPackage: template.dosesPerPackage,
      notes: template.notes,
      // PROVENIÊNCIA — código e número gravados junto para o rótulo
      // sobreviver mesmo se o template sumir depois.
      originTemplateVersionId: template.id,
      originTemplateCode: template.formulationTemplate.code,
      originTemplateVersionNumber: template.versionNumber,
    };

    /*
     * Linhas SEMPRE novas. Nada de reaproveitar id de componente do template:
     * é isso que impede a edição de um produto de vazar para o outro.
     */
    const componentesNovos = template.components.map((component, index) => ({
      itemId: component.itemId,
      quantity: component.quantity,
      unitCode: component.unitCode,
      basis: component.basis,
      // Fornecimento vem como SUGESTÃO: o usuário ajusta no produto sem
      // tocar no template.
      supplyResponsibility: component.supplyResponsibility,
      purityPercentApplied: component.purityPercentApplied,
      overagePercent: component.overagePercent,
      notes: component.notes,
      position: index,
    }));

    const rascunhoVazio = existentes.find((version) => podeSerPreenchida(version));
    if (rascunhoVazio) {
      await tx.formulationVersion.update({
        where: { id: rascunhoVazio.id },
        data: {
          ...dadosDoTemplate,
          components: { create: componentesNovos },
        },
      });
      return rascunhoVazio.id;
    }

    const maior = existentes.reduce(
      (maximo, version) => Math.max(maximo, version.versionNumber),
      0,
    );
    const criada = await tx.formulationVersion.create({
      data: {
        productId,
        versionNumber: maior + 1,
        status: "DRAFT",
        ...dadosDoTemplate,
        outputItemId: outputItem.id,
        outputItemCode: outputItem.code,
        outputItemName: outputItem.name,
        outputUnitCode: outputItem.unitCode,
        createdBy: actor.name,
        components: { create: componentesNovos },
      },
    });
    return criada.id;
  });

  return (await getFormulationVersionById(versionId))!;
}

/**
 * Existe versão de template mais recente do que a que originou esta formulação?
 *
 * Só informa. Não existe "atualizar para a V4" que sobrescreva a formulação —
 * o caminho é criar uma versão nova, e a atual continua histórica. Atualizar
 * no lugar reescreveria a receita que já serviu de base para custo, preço e
 * possivelmente produção.
 */
export async function getTemplateUpdateAvailable(
  formulationVersionId: string,
): Promise<FormulationTemplateUpdateAvailableDTO | null> {
  const prisma = getPrisma();
  const version = await prisma.formulationVersion.findUnique({
    where: { id: formulationVersionId },
    select: { originTemplateVersionId: true },
  });
  if (!version) throw new FormulationVersionNotFoundError(formulationVersionId);
  if (!version.originTemplateVersionId) return null;

  const origem = await requireTemplateVersion(version.originTemplateVersionId);
  const ativa = await prisma.formulationTemplateVersion.findFirst({
    where: { formulationTemplateId: origem.formulationTemplateId, status: "ACTIVE" },
    select: { id: true, versionNumber: true },
  });
  if (!ativa || ativa.id === origem.id) return null;
  // Uma versão ANTERIOR reativada não é novidade; só avisa para frente.
  if (ativa.versionNumber <= origem.versionNumber) return null;

  return {
    templateId: origem.formulationTemplateId,
    templateCode: origem.formulationTemplate.code,
    templateName: origem.formulationTemplate.name,
    originVersionId: origem.id,
    originVersionNumber: origem.versionNumber,
    latestVersionId: ativa.id,
    latestVersionNumber: ativa.versionNumber,
  };
}

/** O que muda entre a versão de origem e a versão atual do template. */
export async function compareFormulationWithTemplate(
  formulationVersionId: string,
  targetTemplateVersionId?: string,
): Promise<FormulationTemplateDiffDTO> {
  const prisma = getPrisma();
  const version = await prisma.formulationVersion.findUnique({
    where: { id: formulationVersionId },
    include: { components: { include: { item: true }, orderBy: { position: "asc" } } },
  });
  if (!version) throw new FormulationVersionNotFoundError(formulationVersionId);

  const alvoId =
    targetTemplateVersionId ??
    (await getTemplateUpdateAvailable(formulationVersionId))?.latestVersionId;
  if (!alvoId) throw new FormulationVersionNotFoundError(formulationVersionId);
  const alvo = await requireTemplateVersion(alvoId);

  /*
   * Compara a FORMULAÇÃO ATUAL contra a versão nova do template — e não a
   * versão antiga do template contra a nova. Quem lê quer saber o que muda no
   * produto dela, incluindo os ajustes que ela mesma fez depois da cópia.
   */
  const formulacaoComparavel = {
    label: `Formulação V${version.versionNumber}`,
    basisQuantity: version.basisQuantity.toString(),
    calculationMode: version.calculationMode,
    dosesPerPackage: version.dosesPerPackage,
    outputUnitCode: version.outputUnitCode,
    components: version.components.map((component) => ({
      itemCode: component.item.code,
      itemName: component.item.name,
      quantity: component.quantity.toString(),
      unitCode: component.unitCode,
      basis: component.basis,
      supplyResponsibility: component.supplyResponsibility,
      purityPercentApplied: component.purityPercentApplied
        ? component.purityPercentApplied.toString()
        : null,
      overagePercent: component.overagePercent ? component.overagePercent.toString() : null,
    })),
  };

  return compararComposicoes(formulacaoComparavel, versaoComparavel(alvo));
}

/**
 * Salvar uma formulação de produto como template da biblioteca.
 *
 * É CÓPIA: a formulação original não se move, não se converte e não muda de
 * dono. Nada comercial vem junto — cliente, projeto, orçamento, custo, preço
 * e pedido ficam onde estão, porque uma matriz técnica reutilizável entre
 * clientes não pode carregar o nome de um deles.
 *
 * Nasce em RASCUNHO de propósito: quem vai reutilizar precisa revisar antes,
 * e ativar sozinho transformaria uma decisão em efeito colateral.
 */
export async function createTemplateFromFormulation(
  formulationVersionId: string,
  input: CreateTemplateFromFormulationInput,
  actor: User,
): Promise<FormulationTemplateDTO> {
  const prisma = getPrisma();
  const version = await prisma.formulationVersion.findUnique({
    where: { id: formulationVersionId },
    include: { components: { include: { item: true }, orderBy: { position: "asc" } } },
  });
  if (!version) throw new FormulationVersionNotFoundError(formulationVersionId);

  const template = await createFormulationTemplate(
    {
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      basisQuantity: version.basisQuantity.toString(),
      outputUnitCode: version.outputUnitCode,
      calculationMode: version.calculationMode,
      ...(version.dosesPerPackage ? { dosesPerPackage: version.dosesPerPackage } : {}),
    },
    actor,
  );

  const rascunho = template.draftVersion;
  if (rascunho && version.components.length > 0) {
    await updateFormulationTemplateVersion(rascunho.id, {
      notes: version.notes,
      components: version.components.map((component) => ({
        itemId: component.itemId,
        quantity: component.quantity.toString(),
        unitCode: component.unitCode,
        basis: component.basis,
        supplyResponsibility: component.supplyResponsibility,
        purityPercentApplied: component.purityPercentApplied
          ? component.purityPercentApplied.toString()
          : null,
        overagePercent: component.overagePercent ? component.overagePercent.toString() : null,
        notes: component.notes,
      })),
    });
  }

  return getFormulationTemplate(template.id);
}

/** Formulações do produto — reexportado para a rota de aplicação. */
export { listFormulationVersionsByProduct };
