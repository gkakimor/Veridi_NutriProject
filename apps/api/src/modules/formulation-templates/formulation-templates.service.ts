import { Prisma } from "@prisma/client";
import type {
  FormulationTemplate,
  FormulationTemplateComponent,
  FormulationTemplateVersion,
  Item,
  UnitOfMeasure,
  User,
} from "@prisma/client";
import type {
  DosageForm,
  FormulationCalculationMode,
  FormulationComponentBasis,
  FormulationComponentIssueDTO,
  FormulationTemplateComponentDTO,
  FormulationTemplateDTO,
  FormulationTemplateDiffDTO,
  FormulationTemplateDiffEntryDTO,
  FormulationTemplateListResponse,
  FormulationTemplateSummaryDTO,
  FormulationTemplateVersionDTO,
  ItemType,
  PresentationType,
} from "@veridi/shared";
import {
  DOSAGE_FORM_LABELS,
  FORMULATION_TEMPLATE_CODE_PREFIX,
  PRESENTATION_TYPE_LABELS,
  SECAO_DA_FORMULA_LABELS,
  capsulasPorEmbalagem,
  formaDerivaDoses,
  secaoDoItem,
} from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
/*
 * A MESMA regra da Formulacao para o que o cadastro do Item invalidou
 * (FORMULATION-TEMPLATE-WORKBENCH-01, fatia 3).
 */
import {
  MOTIVO_CURTO_DO_PROBLEMA,
  problemasDosComponentes,
} from "../../lib/formulation-component-issues.js";
/*
 * A MESMA autoridade da Formulacao para as premissas tecnicas
 * (FORMULATION-TEMPLATE-WORKBENCH-01): o Modelo nao implementa conta propria.
 */
import { resolverApresentacao, tocouNaApresentacao } from "../../lib/formulation-premises.js";
import type {
  PremissasAtuais,
  PremissasGravadas,
  PremissasInformadas,
} from "../../lib/formulation-premises.js";
import {
  basisRequiresDosesPerPackage,
  hasUsableDosesPerPackage,
  missingFormulationContext,
} from "../../lib/formulation-math.js";
import { isUomCompatible, UomNotFoundError } from "../items/uom.js";
import { nextSequenceCode } from "../../lib/sequence-code.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import {
  ComponentItemNotFoundError,
  DuplicateComponentItemError,
  IncompatibleComponentUnitError,
  InactiveComponentItemError,
  InvalidComponentItemTypeError,
  InvalidComponentQuantityError,
} from "../formulations/formulations.errors.js";
import { modoEFlags } from "../formulations/formulations.service.js";
import {
  FormulationTemplateNotFoundError,
  FormulationTemplateVersionNotFoundError,
  TemplateArchivedError,
  TemplateComponentsNeedReviewError,
  TemplateDosesRequiredError,
  TemplateDraftAlreadyExistsError,
  TemplateVersionNotDraftError,
  TemplateVersionWithoutComponentsError,
} from "./formulation-templates.errors.js";
import type {
  CreateFormulationTemplateInput,
  ListFormulationTemplatesQuery,
  UpdateFormulationTemplateInput,
  UpdateFormulationTemplateVersionInput,
} from "./formulation-templates.schemas.js";

/**
 * Biblioteca técnica de Formulações.
 *
 * Uma matriz reutilizável entre clientes. O template não é a formulação de
 * ninguém: usá-lo COPIA os dados para uma `FormulationVersion` do Produto, e a
 * partir daí as duas vidas seguem separadas.
 *
 * A alternativa — vários produtos apontando para a mesma formulação viva —
 * foi recusada de propósito: mexer na receita de um cliente reescreveria a de
 * outro, e ninguém descobriria antes da produção. Por isso não existe
 * sincronização, atualização em massa nem "aplicar em todos os produtos".
 */

const CODE_SEQUENCE = "formulation_template_code_seq";

type ComponentWithItem = FormulationTemplateComponent & { item: Item };
type VersionWithRelations = FormulationTemplateVersion & {
  formulationTemplate: FormulationTemplate;
  components: ComponentWithItem[];
  _count?: { derivedFormulationVersions: number };
};
type TemplateWithVersions = FormulationTemplate & {
  versions: VersionWithRelations[];
};

const versionInclude = {
  formulationTemplate: true,
  components: { include: { item: true }, orderBy: { position: "asc" as const } },
  _count: { select: { derivedFormulationVersions: true } },
} as const;

const templateInclude = {
  versions: {
    include: versionInclude,
    orderBy: { versionNumber: "asc" as const },
  },
} as const;

function toComponentDTO(component: ComponentWithItem): FormulationTemplateComponentDTO {
  return {
    id: component.id,
    itemId: component.itemId,
    itemCode: component.item.code,
    itemName: component.item.name,
    itemType: component.item.type,
    itemActive: component.item.active,
    quantity: component.quantity.toString(),
    unitCode: component.unitCode,
    basis: component.basis,
    supplyResponsibility: component.supplyResponsibility,
    purityPercentApplied: component.purityPercentApplied
      ? component.purityPercentApplied.toString()
      : null,
    overagePercent: component.overagePercent ? component.overagePercent.toString() : null,
    quantityMode: component.quantityMode,
    applyPurityAdjustment: component.applyPurityAdjustment,
    applyOverageAdjustment: component.applyOverageAdjustment,
    notes: component.notes,
    position: component.position,
    /*
     * Dados tecnicos do cadastro ATUAL do Item — os MESMOS nomes do componente
     * da Formulacao, porque a bancada compartilhada le um contrato so. Sao
     * LEITURA: o que a conta usa e a versao congela continua sendo
     * `purityPercentApplied`, gravado na linha.
     */
    stockUnitCode: component.item.unitCode,
    itemSourceName: component.item.sourceName,
    itemDeclaredNutrient: component.item.declaredNutrient,
    itemFamily: component.item.family,
    itemPackagingSubtype: component.item.packagingSubtype,
    itemDefaultPurityPercent: component.item.defaultPurityPercent
      ? component.item.defaultPurityPercent.toString()
      : null,
    itemExternalCode: component.item.externalCode,
  };
}

/**
 * O que o cadastro do Item invalidou nos componentes desta versão.
 *
 * RASCUNHO: é o que barra a ativação do Modelo — dito antes do clique.
 * ATIVA: é o aviso de quem vai aplicá-la; a Formulação nasce em rascunho com a
 * receita como está e só ativa depois da correção (decisão D-6).
 * ARQUIVADA: não se aplica nem se edita, e apontar problema nela sugeriria um
 * gesto que não existe.
 */
function problemasDaVersao(
  version: VersionWithRelations,
  units: readonly UnitOfMeasure[],
): FormulationComponentIssueDTO[] {
  if (version.status === "ARCHIVED") return [];
  return problemasDosComponentes(version.components, units);
}

export function toTemplateVersionDTO(
  version: VersionWithRelations,
  units: readonly UnitOfMeasure[],
): FormulationTemplateVersionDTO {
  return {
    id: version.id,
    formulationTemplateId: version.formulationTemplateId,
    templateCode: version.formulationTemplate.code,
    templateName: version.formulationTemplate.name,
    versionNumber: version.versionNumber,
    versionLabel: `V${version.versionNumber}`,
    status: version.status,
    basisQuantity: version.basisQuantity.toString(),
    calculationMode: version.calculationMode,
    dosesPerPackage: version.dosesPerPackage,
    /*
     * PREMISSAS TECNICAS — as mesmas da Formulacao, com os mesmos nomes.
     * `capsulesPerPackage` nao e coluna aqui tambem: sai do produto de
     * capsulas por dose e doses por embalagem, pela funcao do motor.
     */
    dosageForm: version.dosageForm,
    presentationType: version.presentationType,
    capsulesPerDose: version.capsulesPerDose,
    capsulesPerPackage: capsulasPorEmbalagem(version.capsulesPerDose, version.dosesPerPackage),
    doseAmount: version.doseAmount ? version.doseAmount.toString() : null,
    doseUomCode: version.doseUomCode,
    packageContentAmount: version.packageContentAmount
      ? version.packageContentAmount.toString()
      : null,
    packageContentUomCode: version.packageContentUomCode,
    expectedLossPercent: version.expectedLossPercent
      ? version.expectedLossPercent.toString()
      : null,
    outputUnitCode: version.outputUnitCode,
    notes: version.notes,
    components: version.components.map(toComponentDTO),
    createdAt: version.createdAt.toISOString(),
    createdBy: version.createdBy,
    activatedAt: version.activatedAt ? version.activatedAt.toISOString() : null,
    activatedBy: version.activatedBy,
    archivedAt: version.archivedAt ? version.archivedAt.toISOString() : null,
    sourceVersionId: version.sourceVersionId,
    sourceVersionNumber: version.sourceVersionNumber,
    usageCount: version._count?.derivedFormulationVersions ?? 0,
    componentIssues: problemasDaVersao(version, units),
  };
}

function toTemplateDTO(
  template: TemplateWithVersions,
  units: readonly UnitOfMeasure[],
): FormulationTemplateDTO {
  const versions = template.versions.map((version) => toTemplateVersionDTO(version, units));
  return {
    id: template.id,
    code: template.code,
    name: template.name,
    description: template.description,
    archived: template.archivedAt !== null,
    archivedAt: template.archivedAt ? template.archivedAt.toISOString() : null,
    activeVersion: versions.find((version) => version.status === "ACTIVE") ?? null,
    draftVersion: versions.find((version) => version.status === "DRAFT") ?? null,
    versions,
    createdAt: template.createdAt.toISOString(),
    createdBy: template.createdBy,
    updatedAt: template.updatedAt.toISOString(),
  };
}

function toSummaryDTO(template: TemplateWithVersions): FormulationTemplateSummaryDTO {
  const ativa = template.versions.find((version) => version.status === "ACTIVE") ?? null;
  return {
    id: template.id,
    code: template.code,
    name: template.name,
    description: template.description,
    archived: template.archivedAt !== null,
    activeVersionId: ativa?.id ?? null,
    activeVersionNumber: ativa?.versionNumber ?? null,
    basisQuantity: ativa ? ativa.basisQuantity.toString() : null,
    outputUnitCode: ativa?.outputUnitCode ?? null,
    calculationMode: ativa?.calculationMode ?? null,
    componentCount: ativa?.components.length ?? 0,
    componentItemCodes: ativa ? ativa.components.map((c) => c.item.code) : [],
    hasDraft: template.versions.some((version) => version.status === "DRAFT"),
    updatedAt: template.updatedAt.toISOString(),
  };
}

async function requireTemplate(id: string): Promise<TemplateWithVersions> {
  const template = await getPrisma().formulationTemplate.findUnique({
    where: { id },
    include: templateInclude,
  });
  if (!template) throw new FormulationTemplateNotFoundError(id);
  return template;
}

export async function requireTemplateVersion(id: string): Promise<VersionWithRelations> {
  const version = await getPrisma().formulationTemplateVersion.findUnique({
    where: { id },
    include: versionInclude,
  });
  if (!version) throw new FormulationTemplateVersionNotFoundError(id);
  return version;
}

/** O catálogo de unidades — a compatibilidade da linha depende dele. */
function lerUnidades(): Promise<UnitOfMeasure[]> {
  return getPrisma().unitOfMeasure.findMany();
}

export async function getFormulationTemplate(id: string): Promise<FormulationTemplateDTO> {
  const [template, units] = await Promise.all([requireTemplate(id), lerUnidades()]);
  return toTemplateDTO(template, units);
}

export async function getFormulationTemplateVersion(
  id: string,
): Promise<FormulationTemplateVersionDTO> {
  const [version, units] = await Promise.all([requireTemplateVersion(id), lerUnidades()]);
  return toTemplateVersionDTO(version, units);
}

/**
 * Biblioteca pesquisável.
 *
 * A busca cobre código, nome e o CÓDIGO DOS COMPONENTES: quem procura uma
 * matriz costuma lembrar do princípio ativo antes do nome que alguém deu ao
 * template.
 */
export async function listFormulationTemplates(
  query: ListFormulationTemplatesQuery,
  pagination: Pagination,
): Promise<FormulationTemplateListResponse> {
  const prisma = getPrisma();
  const termo = query.search?.trim();

  const where: Prisma.FormulationTemplateWhereInput = {
    ...(query.archived === undefined
      ? // Arquivado sai da lista por padrão: a biblioteca mostra o que se usa.
        { archivedAt: null }
      : query.archived
        ? { archivedAt: { not: null } }
        : { archivedAt: null }),
    ...(termo
      ? {
          OR: [
            { code: { contains: termo, mode: "insensitive" } },
            { name: { contains: termo, mode: "insensitive" } },
            { description: { contains: termo, mode: "insensitive" } },
            {
              versions: {
                some: {
                  status: "ACTIVE",
                  components: {
                    some: {
                      item: {
                        OR: [
                          { code: { contains: termo, mode: "insensitive" } },
                          { name: { contains: termo, mode: "insensitive" } },
                        ],
                      },
                    },
                  },
                },
              },
            },
          ],
        }
      : {}),
  };

  const [total, templates] = await Promise.all([
    prisma.formulationTemplate.count({ where }),
    prisma.formulationTemplate.findMany({
      where,
      include: templateInclude,
      orderBy: { updatedAt: "desc" },
      ...pageArgs(pagination),
    }),
  ]);

  return {
    templates: templates.map(toSummaryDTO),
    ...pageMeta(pagination, total),
  };
}

/** Valida componentes com as MESMAS regras da formulação de produto. */
async function validateComponents(
  inputs: { itemId: string; quantity: string; unitCode: string }[],
  previousItemIds: ReadonlySet<string>,
  units: readonly UnitOfMeasure[],
): Promise<void> {
  const prisma = getPrisma();
  const seen = new Set<string>();
  for (const input of inputs) {
    if (seen.has(input.itemId)) {
      const item = await prisma.item.findUnique({ where: { id: input.itemId } });
      throw new DuplicateComponentItemError(item?.code ?? input.itemId);
    }
    seen.add(input.itemId);
  }

  for (const input of inputs) {
    const item = await prisma.item.findUnique({ where: { id: input.itemId } });
    if (!item) throw new ComponentItemNotFoundError(input.itemId);
    if (item.type === "FINISHED_PRODUCT") throw new InvalidComponentItemTypeError(item.code);
    // Item inativado depois só bloqueia se for linha genuinamente nova.
    if (!previousItemIds.has(input.itemId) && !item.active) {
      throw new InactiveComponentItemError(item.code);
    }
    if (new Prisma.Decimal(input.quantity).lessThanOrEqualTo(0)) {
      throw new InvalidComponentQuantityError(item.code);
    }
    if (!isUomCompatible(input.unitCode, item.unitCode, units)) {
      throw new IncompatibleComponentUnitError(item.code);
    }
  }
}

/**
 * A unidade da base existe no catálogo — FORM-UOM-01.
 *
 * O modelo não tem Item de saída: a unidade da base é a própria dimensão da
 * matriz, e qualquer código do catálogo serve. Fora dele, a recusa tem nome —
 * antes era o erro cru da chave estrangeira, devolvido como 500.
 */
async function exigirUnidadeDoCatalogo(code: string): Promise<void> {
  const unidade = await getPrisma().unitOfMeasure.findUnique({ where: { code } });
  if (!unidade) throw new UomNotFoundError(code);
}

/**
 * O próximo código FT. `nextval` não volta atrás com a transação: quem chama
 * faz toda recusa possível ANTES, para que Modelo recusado não gaste número.
 */
export function proximoCodigoDeModelo(): Promise<string> {
  return nextSequenceCode(getPrisma(), CODE_SEQUENCE, FORMULATION_TEMPLATE_CODE_PREFIX);
}

export async function createFormulationTemplate(
  input: CreateFormulationTemplateInput,
  actor: User,
): Promise<FormulationTemplateDTO> {
  const prisma = getPrisma();
  // Antes do código: recusa não consome número da sequência.
  await exigirUnidadeDoCatalogo(input.outputUnitCode ?? "un");
  const code = await proximoCodigoDeModelo();
  const modo = input.calculationMode ?? "FIXED_BASIS";
  if (modo === "PER_DOSE" && !input.dosesPerPackage) throw new TemplateDosesRequiredError();

  const created = await prisma.formulationTemplate.create({
    data: {
      code,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      createdBy: actor.name,
      // A matriz nasce com a V1 em rascunho: um template sem versão nenhuma
      // seria uma pasta vazia que ninguém sabe o que fazer com.
      versions: {
        create: {
          versionNumber: 1,
          status: "DRAFT",
          basisQuantity: new Prisma.Decimal(input.basisQuantity ?? "1"),
          calculationMode: modo,
          ...(input.dosesPerPackage ? { dosesPerPackage: input.dosesPerPackage } : {}),
          outputUnitCode: input.outputUnitCode ?? "un",
          createdBy: actor.name,
        },
      },
    },
  });

  return getFormulationTemplate(created.id);
}

export async function updateFormulationTemplate(
  id: string,
  input: UpdateFormulationTemplateInput,
): Promise<FormulationTemplateDTO> {
  await requireTemplate(id);
  await getPrisma().formulationTemplate.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });
  return getFormulationTemplate(id);
}

/**
 * Arquivar/desarquivar.
 *
 * Arquivar tira da biblioteca de escolha sem apagar nada: formulações criadas
 * a partir dele continuam válidas e continuam mostrando a origem.
 */
export async function setFormulationTemplateArchived(
  id: string,
  archived: boolean,
  actor: User,
): Promise<FormulationTemplateDTO> {
  await requireTemplate(id);
  await getPrisma().formulationTemplate.update({
    where: { id },
    data: archived
      ? { archivedAt: new Date(), archivedBy: actor.name }
      : { archivedAt: null, archivedBy: null },
  });
  return getFormulationTemplate(id);
}

/**
 * O que uma gravação deixa nas premissas técnicas do Modelo — a regra ÚNICA,
 * usada pela edição do rascunho e pela cópia de uma Formulação ("Salvar como
 * modelo"). Duas versões dela divergiriam no primeiro caso de borda corrigido
 * de um lado só.
 *
 * Recusa ANTES de qualquer escrita: divisão que não fecha e dose que falta não
 * gravam metade da apresentação — nem consomem código de Modelo novo.
 */
export function premissasDaGravacao(
  current: PremissasAtuais & { calculationMode: FormulationCalculationMode },
  input: PremissasInformadas & { calculationMode?: FormulationCalculationMode | undefined },
  componentesFinais: readonly { basis?: FormulationComponentBasis | undefined }[],
  units: readonly UnitOfMeasure[],
): Partial<PremissasGravadas> {
  const modo = input.calculationMode ?? current.calculationMode;

  /*
   * PREMISSAS TECNICAS — resolvidas pela MESMA funcao da Formulacao.
   *
   * Nas formas capsula e po as doses por embalagem sao RESULTADO das
   * premissas, e o numero que o cliente mandar nao substitui a divisao.
   */
  const apresentacao = tocouNaApresentacao(input)
    ? resolverApresentacao(current, input, units)
    : null;
  const forma = apresentacao ? apresentacao.dosageForm : current.dosageForm;
  const doses = apresentacao
    ? apresentacao.dosesPerPackage
    : input.dosesPerPackage !== undefined
      ? input.dosesPerPackage
      : current.dosesPerPackage;
  if (modo === "PER_DOSE" && !doses) throw new TemplateDosesRequiredError();

  /*
   * Quem manda é a base do COMPONENTE, não o modo da versão.
   *
   * Uma matriz `FIXED_BASIS` com componentes `PER_DOSE` é exatamente o
   * arranjo que zerou o material da auditoria VAL-LEG-01. Enquanto houver
   * um componente por dose, as doses ficam — e continuam obrigatórias.
   */
  const dependeDeDoses = componentesFinais.some(
    (component) => component.basis !== undefined && basisRequiresDosesPerPackage(component.basis),
  );
  if (dependeDeDoses && !hasUsableDosesPerPackage(doses)) throw new TemplateDosesRequiredError();

  return {
    // Mexeu na apresentacao? As doses saem dela. Senao, o campo antigo
    // continua valendo exatamente como valia.
    ...(apresentacao
      ? apresentacao
      : input.dosesPerPackage !== undefined
        ? { dosesPerPackage: input.dosesPerPackage }
        : {}),
    // Modo FIXED_BASIS não carrega doses POR SI — mas um componente por
    // dose carrega. Limpar aqui apagaria a premissa que a fórmula usa.
    //
    // A forma que DERIVA doses tambem carrega: na capsula e no po as doses
    // sao resultado das premissas, e apaga-las aqui desfaria, no mesmo
    // update, a divisao que acabou de ser aceita.
    ...(modo === "FIXED_BASIS" && !dependeDeDoses && !formaDerivaDoses(forma)
      ? { dosesPerPackage: null }
      : {}),
  };
}

export async function updateFormulationTemplateVersion(
  id: string,
  input: UpdateFormulationTemplateVersionInput,
): Promise<FormulationTemplateVersionDTO> {
  const current = await requireTemplateVersion(id);
  // Versão ativa é histórica: para mudar, cria-se uma nova.
  if (current.status !== "DRAFT") throw new TemplateVersionNotDraftError(current.status);
  if (input.outputUnitCode !== undefined) await exigirUnidadeDoCatalogo(input.outputUnitCode);

  // Uma leitura do catalogo serve as duas conferencias desta gravacao.
  const units =
    tocouNaApresentacao(input) || input.components
      ? await getPrisma().unitOfMeasure.findMany()
      : ([] as UnitOfMeasure[]);
  const premissas = premissasDaGravacao(
    current,
    input,
    input.components ?? current.components,
    units,
  );

  if (input.components) {
    const anteriores = new Set(current.components.map((component) => component.itemId));
    await validateComponents(input.components, anteriores, units);
  }

  await getPrisma().$transaction(async (tx) => {
    await tx.formulationTemplateVersion.update({
      where: { id },
      data: {
        ...(input.basisQuantity !== undefined
          ? { basisQuantity: new Prisma.Decimal(input.basisQuantity) }
          : {}),
        ...(input.outputUnitCode !== undefined ? { outputUnitCode: input.outputUnitCode } : {}),
        ...(input.calculationMode !== undefined ? { calculationMode: input.calculationMode } : {}),
        ...premissas,
        ...(input.expectedLossPercent !== undefined
          ? { expectedLossPercent: input.expectedLossPercent }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    if (input.components) {
      await tx.formulationTemplateComponent.deleteMany({
        where: { formulationTemplateVersionId: id },
      });
      await tx.formulationTemplateComponent.createMany({
        data: input.components.map((component, index) => ({
          formulationTemplateVersionId: id,
          itemId: component.itemId,
          quantity: new Prisma.Decimal(component.quantity),
          unitCode: component.unitCode,
          ...(component.basis ? { basis: component.basis } : {}),
          ...(component.supplyResponsibility
            ? { supplyResponsibility: component.supplyResponsibility }
            : {}),
          ...(component.purityPercentApplied
            ? { purityPercentApplied: new Prisma.Decimal(component.purityPercentApplied) }
            : {}),
          ...(component.overagePercent
            ? { overagePercent: new Prisma.Decimal(component.overagePercent) }
            : {}),
          // Modo e marcas com a MESMA normalização da Formulação real (§52):
          // marca ligada sob física direta não se grava.
          ...modoEFlags(component),
          ...(component.notes !== undefined ? { notes: component.notes } : {}),
          position: index,
        })),
      });
    }

    await tx.formulationTemplate.update({
      where: { id: current.formulationTemplateId },
      data: { updatedAt: new Date() },
    });
  });

  return getFormulationTemplateVersion(id);
}

/**
 * Ativar a versão.
 *
 * A versão anterior vai para ARCHIVED, não para "apagada": formulações que
 * nasceram dela continuam apontando para ela, e o rótulo "criada a partir de
 * V1" precisa continuar significando alguma coisa.
 */
export async function activateFormulationTemplateVersion(
  id: string,
  actor: User,
): Promise<FormulationTemplateVersionDTO> {
  const current = await requireTemplateVersion(id);
  if (current.status !== "DRAFT") throw new TemplateVersionNotDraftError(current.status);
  if (current.components.length === 0) throw new TemplateVersionWithoutComponentsError();
  // Matriz da biblioteca não pode ser um caminho novo para formulação
  // inválida: quem aplicar o template herdaria a premissa em branco.
  if (missingFormulationContext(current.components, current) === "DOSES_PER_PACKAGE") {
    throw new TemplateDosesRequiredError();
  }
  /*
   * A mesma porta da Formulação real (FORM-UOM-01 e FORMULATION-TEMPLATE-
   * WORKBENCH-01, fatia 3): o cadastro do Item é RELIDO agora, e não na hora em
   * que a linha foi gravada. Item que ficou inativo, que virou produto acabado,
   * que perdeu a unidade compatível — dado legado, gravado por fora da API — ou
   * com quantidade inválida não entra na biblioteca como versão pronta para uso:
   * seria copiado para toda formulação nova, e a recusa só apareceria lá.
   *
   * A recusa nomeia CADA item e o motivo. Nada é reescrito: a versão continua
   * rascunho, e as versões ativa e arquivadas continuam como estavam.
   */
  const units = await getPrisma().unitOfMeasure.findMany();
  const problemas = problemasDosComponentes(current.components, units);
  if (problemas.length > 0) {
    const motivos = problemas
      .map((problema) => `${problema.itemCode} (${MOTIVO_CURTO_DO_PROBLEMA[problema.code]})`)
      .join(", ");
    throw new TemplateComponentsNeedReviewError(problemas, motivos);
  }

  await getPrisma().$transaction(async (tx) => {
    // Uma ativa por template — o índice único parcial no banco garante o
    // invariante; este update é o caminho normal para chegar lá.
    await tx.formulationTemplateVersion.updateMany({
      where: {
        formulationTemplateId: current.formulationTemplateId,
        status: "ACTIVE",
        id: { not: id },
      },
      data: { status: "ARCHIVED", archivedAt: new Date(), archivedBy: actor.name },
    });
    await tx.formulationTemplateVersion.update({
      where: { id },
      data: { status: "ACTIVE", activatedAt: new Date(), activatedBy: actor.name },
    });
    await tx.formulationTemplate.update({
      where: { id: current.formulationTemplateId },
      data: { updatedAt: new Date() },
    });
  });

  return getFormulationTemplateVersion(id);
}

/**
 * Nova versão a partir da ativa.
 *
 * Copia tudo para um rascunho. A ativa continua ativa até alguém ativar a
 * nova explicitamente — trocar a matriz da biblioteca no meio da edição
 * mudaria o que os outros estão escolhendo agora.
 */
export async function createTemplateVersionFrom(
  sourceVersionId: string,
  actor: User,
): Promise<FormulationTemplateVersionDTO> {
  const source = await requireTemplateVersion(sourceVersionId);
  const prisma = getPrisma();

  const rascunhoAberto = await prisma.formulationTemplateVersion.findFirst({
    where: { formulationTemplateId: source.formulationTemplateId, status: "DRAFT" },
    select: { versionNumber: true },
  });
  if (rascunhoAberto) throw new TemplateDraftAlreadyExistsError(rascunhoAberto.versionNumber);

  const criadaId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM formulation_templates WHERE id = ${source.formulationTemplateId} FOR UPDATE`;
    const maior = await tx.formulationTemplateVersion.aggregate({
      where: { formulationTemplateId: source.formulationTemplateId },
      _max: { versionNumber: true },
    });

    const criada = await tx.formulationTemplateVersion.create({
      data: {
        formulationTemplateId: source.formulationTemplateId,
        versionNumber: (maior._max.versionNumber ?? 0) + 1,
        status: "DRAFT",
        basisQuantity: source.basisQuantity,
        calculationMode: source.calculationMode,
        dosesPerPackage: source.dosesPerPackage,
        /*
         * As premissas tecnicas viajam com os numeros. Versao nova que as
         * perdesse nasceria sem forma — e uma linha por dose sem forma nao tem
         * como ser lida por dose.
         */
        dosageForm: source.dosageForm,
        presentationType: source.presentationType,
        capsulesPerDose: source.capsulesPerDose,
        doseAmount: source.doseAmount,
        doseUomCode: source.doseUomCode,
        packageContentAmount: source.packageContentAmount,
        packageContentUomCode: source.packageContentUomCode,
        expectedLossPercent: source.expectedLossPercent,
        outputUnitCode: source.outputUnitCode,
        notes: source.notes,
        createdBy: actor.name,
        sourceVersionId: source.id,
        sourceVersionNumber: source.versionNumber,
        components: {
          create: source.components.map((component) => ({
            itemId: component.itemId,
            quantity: component.quantity,
            unitCode: component.unitCode,
            basis: component.basis,
            supplyResponsibility: component.supplyResponsibility,
            purityPercentApplied: component.purityPercentApplied,
            overagePercent: component.overagePercent,
            // A intenção técnica viaja com os números: versão nova do Modelo
            // que perdesse o modo aplicaria física direta sem ninguém pedir.
            quantityMode: component.quantityMode,
            applyPurityAdjustment: component.applyPurityAdjustment,
            applyOverageAdjustment: component.applyOverageAdjustment,
            notes: component.notes,
            position: component.position,
          })),
        },
      },
    });
    return criada.id;
  });

  return getFormulationTemplateVersion(criadaId);
}

/** Uma versão pronta para uso — ativa e de template não arquivado. */
export async function assertUsableTemplateVersion(
  version: VersionWithRelations,
): Promise<void> {
  if (version.formulationTemplate.archivedAt !== null) {
    throw new TemplateArchivedError(version.formulationTemplate.code);
  }
}

const MODO_LABEL: Record<string, string> = {
  FIXED_BASIS: "Base fixa",
  PER_DOSE: "Por dose",
};

const BASE_LABEL: Record<string, string> = {
  FIXED_BASIS: "Base da fórmula",
  PER_DOSE: "Por dose",
  PER_FINISHED_UNIT: "Por unidade acabada",
};

const FORNECIMENTO_LABEL: Record<string, string> = {
  VERIDI: "Veridi",
  CUSTOMER: "Cliente",
};

const INTERPRETACAO_LABEL: Record<string, string> = {
  PHYSICAL_DIRECT: "Quantidade física informada",
  THEORETICAL_WITH_ADJUSTMENTS: "Calcular quantidade física",
};

const simOuNao = (valor: boolean) => (valor ? "Sim" : "Não");

/** Premissa ausente é NÃO INFORMADA — nunca zero, nunca uma forma presumida. */
const NAO_INFORMADA = "Não informada";

interface ComparavelComponente {
  itemCode: string;
  itemName: string;
  /** Decide a seção — composição ou embalagem — em que a posição é contada. */
  itemType: ItemType;
  quantity: string;
  unitCode: string;
  basis: string;
  supplyResponsibility: string;
  purityPercentApplied: string | null;
  overagePercent: string | null;
  quantityMode: string;
  applyPurityAdjustment: boolean;
  applyOverageAdjustment: boolean;
  position: number;
}

export interface ComparavelVersao {
  label: string;
  basisQuantity: string;
  calculationMode: string;
  dosesPerPackage: number | null;
  outputUnitCode: string;
  /** Premissas técnicas — as mesmas colunas na Formulação e no Modelo. */
  dosageForm: DosageForm | null;
  presentationType: PresentationType | null;
  capsulesPerDose: number | null;
  doseAmount: string | null;
  doseUomCode: string | null;
  packageContentAmount: string | null;
  packageContentUomCode: string | null;
  expectedLossPercent: string | null;
  components: ComparavelComponente[];
}

/** Quantidade e unidade juntas: "5 g". O número sem a unidade não diz nada. */
function grandeza(quantidade: string | null, unidade: string | null): string {
  if (quantidade === null) return NAO_INFORMADA;
  return unidade ? `${quantidade} ${unidade}` : quantidade;
}

/**
 * A POSIÇÃO de cada componente dentro da própria seção, e o lugar dele entre
 * os componentes que as DUAS versões têm.
 *
 * Composição e embalagem dividem uma lista só (`position` é o índice nela), mas
 * a tela ordena dentro de cada seção. Uma linha acrescentada no topo empurra
 * todas as outras uma casa para baixo sem que nenhuma tenha sido movida: a
 * mudança de lugar se mede entre os componentes COMUNS, e a entrada mostra a
 * posição que a pessoa vê na tela.
 */
function posicoesNaSecao(
  components: readonly ComparavelComponente[],
  comuns: ReadonlySet<string>,
): Map<string, { naTela: number; entreComuns: number }> {
  const porSecao = new Map<string, ComparavelComponente[]>();
  for (const componente of [...components].sort((a, b) => a.position - b.position)) {
    const secao = secaoDoItem(componente.itemType);
    porSecao.set(secao, [...(porSecao.get(secao) ?? []), componente]);
  }
  const posicoes = new Map<string, { naTela: number; entreComuns: number }>();
  for (const linhas of porSecao.values()) {
    let entreComuns = 0;
    linhas.forEach((componente, indice) => {
      if (comuns.has(componente.itemCode)) entreComuns += 1;
      posicoes.set(componente.itemCode, { naTela: indice + 1, entreComuns });
    });
  }
  return posicoes;
}

/**
 * Diff entre duas composições.
 *
 * Específico e pequeno de propósito: as coisas que mudam numa fórmula são
 * conhecidas e contáveis. Um framework genérico de comparação custaria mais
 * do que resolver o problema, e produziria diferenças que ninguém precisa ler.
 *
 * É o ÚNICO algoritmo: versão × versão do Modelo e Formulação × Modelo passam
 * por aqui, com as premissas técnicas junto (FORMULATION-TEMPLATE-WORKBENCH-01,
 * fatia 3). Os rótulos são os da bancada — nenhum nome de campo ou de enum
 * chega à tela.
 */
export function compararComposicoes(
  de: ComparavelVersao,
  para: ComparavelVersao,
): FormulationTemplateDiffDTO {
  const entries: FormulationTemplateDiffEntryDTO[] = [];
  const anotar = (
    kind: FormulationTemplateDiffEntryDTO["kind"],
    label: string,
    field: string | null,
    from: string | null,
    to: string | null,
  ) => {
    if (from !== to) entries.push({ kind, label, field, from, to });
  };

  anotar("BASIS", "Base da formulação", null, de.basisQuantity, para.basisQuantity);
  anotar(
    "MODE",
    "Modo de cálculo",
    null,
    MODO_LABEL[de.calculationMode] ?? de.calculationMode,
    MODO_LABEL[para.calculationMode] ?? para.calculationMode,
  );
  anotar(
    "DOSAGE_FORM",
    "Forma do produto",
    null,
    de.dosageForm ? DOSAGE_FORM_LABELS[de.dosageForm] : NAO_INFORMADA,
    para.dosageForm ? DOSAGE_FORM_LABELS[para.dosageForm] : NAO_INFORMADA,
  );
  anotar(
    "PRESENTATION",
    "Apresentação comercial",
    null,
    de.presentationType ? PRESENTATION_TYPE_LABELS[de.presentationType] : NAO_INFORMADA,
    para.presentationType ? PRESENTATION_TYPE_LABELS[para.presentationType] : NAO_INFORMADA,
  );
  anotar(
    "CAPSULES_PER_DOSE",
    "Cápsulas por dose",
    null,
    de.capsulesPerDose === null ? NAO_INFORMADA : String(de.capsulesPerDose),
    para.capsulesPerDose === null ? NAO_INFORMADA : String(para.capsulesPerDose),
  );
  anotar(
    "DOSE",
    "Dose",
    null,
    grandeza(de.doseAmount, de.doseUomCode),
    grandeza(para.doseAmount, para.doseUomCode),
  );
  anotar(
    "PACKAGE_CONTENT",
    "Conteúdo da embalagem",
    null,
    grandeza(de.packageContentAmount, de.packageContentUomCode),
    grandeza(para.packageContentAmount, para.packageContentUomCode),
  );
  // Nas formas cápsula e pó as doses são RESULTADO das premissas acima: a
  // entrada aparece junto de quem a mudou.
  anotar(
    "DOSES",
    "Doses por embalagem",
    null,
    de.dosesPerPackage === null ? "—" : String(de.dosesPerPackage),
    para.dosesPerPackage === null ? "—" : String(para.dosesPerPackage),
  );
  anotar(
    "EXPECTED_LOSS",
    "Perda prevista de produção (%)",
    null,
    de.expectedLossPercent ?? NAO_INFORMADA,
    para.expectedLossPercent ?? NAO_INFORMADA,
  );
  anotar("OUTPUT_UOM", "Unidade da base", null, de.outputUnitCode, para.outputUnitCode);

  const porItemDe = new Map(de.components.map((c) => [c.itemCode, c]));
  const porItemPara = new Map(para.components.map((c) => [c.itemCode, c]));
  const rotulo = (c: ComparavelComponente) => `${c.itemName} (${c.itemCode})`;

  for (const componente of para.components) {
    if (!porItemDe.has(componente.itemCode)) {
      entries.push({
        kind: "COMPONENT_ADDED",
        label: rotulo(componente),
        field: null,
        from: null,
        to: `${componente.quantity} ${componente.unitCode}`,
      });
    }
  }
  for (const componente of de.components) {
    if (!porItemPara.has(componente.itemCode)) {
      entries.push({
        kind: "COMPONENT_REMOVED",
        label: rotulo(componente),
        field: null,
        from: `${componente.quantity} ${componente.unitCode}`,
        to: null,
      });
    }
  }

  const comuns = new Set(
    para.components.filter((c) => porItemDe.has(c.itemCode)).map((c) => c.itemCode),
  );
  const posicoesDe = posicoesNaSecao(de.components, comuns);
  const posicoesPara = posicoesNaSecao(para.components, comuns);

  for (const componente of para.components) {
    const anterior = porItemDe.get(componente.itemCode);
    if (!anterior) continue;
    const label = rotulo(componente);
    const campos: [string, string | null, string | null][] = [
      ["Quantidade", anterior.quantity, componente.quantity],
      ["Unidade", anterior.unitCode, componente.unitCode],
      [
        "Base",
        BASE_LABEL[anterior.basis] ?? anterior.basis,
        BASE_LABEL[componente.basis] ?? componente.basis,
      ],
      [
        "Fornecimento",
        FORNECIMENTO_LABEL[anterior.supplyResponsibility] ?? anterior.supplyResponsibility,
        FORNECIMENTO_LABEL[componente.supplyResponsibility] ?? componente.supplyResponsibility,
      ],
      [
        "Interpretação da quantidade",
        INTERPRETACAO_LABEL[anterior.quantityMode] ?? anterior.quantityMode,
        INTERPRETACAO_LABEL[componente.quantityMode] ?? componente.quantityMode,
      ],
      ["Pureza (%)", anterior.purityPercentApplied, componente.purityPercentApplied],
      [
        "Aplicar pureza",
        simOuNao(anterior.applyPurityAdjustment),
        simOuNao(componente.applyPurityAdjustment),
      ],
      // `overagePercent` é interno: na bancada a coluna se chama Reserva.
      ["Reserva (%)", anterior.overagePercent, componente.overagePercent],
      [
        "Aplicar reserva na conta",
        simOuNao(anterior.applyOverageAdjustment),
        simOuNao(componente.applyOverageAdjustment),
      ],
    ];
    /*
     * Mudou de LUGAR só quem mudou de ordem entre os componentes comuns; a
     * entrada mostra a posição na tela. Linha acrescentada ou removida já tem
     * a própria entrada, e não faz as vizinhas parecerem movidas.
     */
    const lugarDe = posicoesDe.get(componente.itemCode);
    const lugarPara = posicoesPara.get(componente.itemCode);
    if (
      lugarDe &&
      lugarPara &&
      lugarDe.entreComuns !== lugarPara.entreComuns &&
      lugarDe.naTela !== lugarPara.naTela
    ) {
      const secao = SECAO_DA_FORMULA_LABELS[secaoDoItem(componente.itemType)].toLowerCase();
      campos.push([
        `Posição na ${secao}`,
        `${lugarDe.naTela}ª linha`,
        `${lugarPara.naTela}ª linha`,
      ]);
    }
    for (const [campo, antes, depois] of campos) {
      if (antes !== depois) {
        entries.push({
          kind: "COMPONENT_CHANGED",
          label,
          field: campo,
          from: antes ?? "—",
          to: depois ?? "—",
        });
      }
    }
  }

  return { fromLabel: de.label, toLabel: para.label, entries };
}

/**
 * O que a Formulação e o Modelo gravam — as MESMAS colunas, lidas de um jeito
 * só. É por aqui que as duas comparações montam o lado de cada uma: um segundo
 * leitor esqueceria a próxima premissa que entrar.
 */
type ReceitaGravada = {
  basisQuantity: Prisma.Decimal;
  calculationMode: string;
  dosesPerPackage: number | null;
  outputUnitCode: string;
  dosageForm: DosageForm | null;
  presentationType: PresentationType | null;
  capsulesPerDose: number | null;
  doseAmount: Prisma.Decimal | null;
  doseUomCode: string | null;
  packageContentAmount: Prisma.Decimal | null;
  packageContentUomCode: string | null;
  expectedLossPercent: Prisma.Decimal | null;
  components: readonly {
    item: Pick<Item, "code" | "name" | "type">;
    quantity: Prisma.Decimal;
    unitCode: string;
    basis: string;
    supplyResponsibility: string;
    purityPercentApplied: Prisma.Decimal | null;
    overagePercent: Prisma.Decimal | null;
    quantityMode: string;
    applyPurityAdjustment: boolean;
    applyOverageAdjustment: boolean;
    position: number;
  }[];
};

const textoOuNulo = (valor: Prisma.Decimal | null) => (valor ? valor.toString() : null);

export function receitaComparavel(label: string, receita: ReceitaGravada): ComparavelVersao {
  return {
    label,
    basisQuantity: receita.basisQuantity.toString(),
    calculationMode: receita.calculationMode,
    dosesPerPackage: receita.dosesPerPackage,
    outputUnitCode: receita.outputUnitCode,
    dosageForm: receita.dosageForm,
    presentationType: receita.presentationType,
    capsulesPerDose: receita.capsulesPerDose,
    doseAmount: textoOuNulo(receita.doseAmount),
    doseUomCode: receita.doseUomCode,
    packageContentAmount: textoOuNulo(receita.packageContentAmount),
    packageContentUomCode: receita.packageContentUomCode,
    expectedLossPercent: textoOuNulo(receita.expectedLossPercent),
    components: receita.components.map((component) => ({
      itemCode: component.item.code,
      itemName: component.item.name,
      itemType: component.item.type,
      quantity: component.quantity.toString(),
      unitCode: component.unitCode,
      basis: component.basis,
      supplyResponsibility: component.supplyResponsibility,
      purityPercentApplied: textoOuNulo(component.purityPercentApplied),
      overagePercent: textoOuNulo(component.overagePercent),
      quantityMode: component.quantityMode,
      applyPurityAdjustment: component.applyPurityAdjustment,
      applyOverageAdjustment: component.applyOverageAdjustment,
      position: component.position,
    })),
  };
}

/** Uma versão do Modelo no formato comparável. */
export function versaoComparavel(version: VersionWithRelations): ComparavelVersao {
  return receitaComparavel(
    `${version.formulationTemplate.code} · V${version.versionNumber}`,
    version,
  );
}

export async function compareTemplateVersions(
  fromId: string,
  toId: string,
): Promise<FormulationTemplateDiffDTO> {
  const [de, para] = await Promise.all([
    requireTemplateVersion(fromId),
    requireTemplateVersion(toId),
  ]);
  return compararComposicoes(versaoComparavel(de), versaoComparavel(para));
}
