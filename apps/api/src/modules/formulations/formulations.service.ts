import { Prisma } from "@prisma/client";
import type {
  DosageForm,
  FormulationComponent,
  FormulationComponentQuantityMode,
  FormulationTemplate,
  FormulationTemplateVersion,
  FormulationVersion,
  Item,
  PresentationType,
  Product,
  UnitOfMeasure,
} from "@prisma/client";
import type {
  FormulationActivationImpactDTO,
  FormulationComponentDTO,
  FormulationComponentIssueDTO,
  FormulationListResponse,
  FormulationSummaryDTO,
  FormulationVersionDTO,
  FormulationVersionListResponse,
} from "@veridi/shared";
import {
  MENSAGENS_DA_APRESENTACAO,
  calcularQuantidadeDaDose,
  capsulasPorEmbalagem,
  dosesPorEmbalagemDaApresentacao,
  formaDerivaDoses,
} from "@veridi/shared";
import type { ApresentacaoBlock, PremissasDaApresentacao, UomFactorLike } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import {
  missingFormulationContext,
  tryComputeComponentRequirement,
} from "../../lib/formulation-math.js";
import type { Pagination } from "../../lib/pagination.js";
import { pageArgs, pageMeta } from "../../lib/pagination.js";
import { isUomCompatible } from "../items/uom.js";
import {
  ComponentItemNotFoundError,
  DuplicateComponentItemError,
  FormulationActivationError,
  FormulationAlreadyExistsError,
  FormulationVersionNotFoundError,
  InactiveComponentItemError,
  IncompatibleComponentUnitError,
  InvalidFormulationPresentationError,
  InvalidComponentItemTypeError,
  InvalidComponentQuantityError,
  MissingFinishedItemError,
  ProductNotFoundError,
  VersionIsDraftSourceError,
  VersionNotDraftError,
} from "./formulations.errors.js";
import type {
  CreateFormulationVersionInput,
  FormulationComponentInput,
  ListFormulationsQuery,
  UpdateFormulationVersionInput,
} from "./formulations.schemas.js";

/** Sem autenticacao/Usuarios no MVP ainda — mesma string ja usada na topbar. */
const SYSTEM_ACTOR = "Ambiente local";

type ComponentWithItem = FormulationComponent & { item: Item };
type VersionWithRelations = FormulationVersion & {
  product: Product;
  components: ComponentWithItem[];
  originTemplateVersion?:
    | (FormulationTemplateVersion & { formulationTemplate: FormulationTemplate })
    | null;
};

/** As unidades como o motor compartilhado as consome. */
function unidadesDoMotor(units: readonly UnitOfMeasure[]): UomFactorLike[] {
  return units.map((unit) => ({
    code: unit.code,
    dimension: unit.dimension,
    toBaseFactor: unit.toBaseFactor.toString(),
  }));
}

/** O que o componente precisa saber da versao para se quantificar. */
type ContextoDaVersao = {
  basisQuantity: Prisma.Decimal;
  dosesPerPackage: number | null;
  dosageForm: DosageForm | null;
  capsulesPerDose: number | null;
};

function toComponentDTO(
  component: ComponentWithItem,
  units: readonly UnitOfMeasure[],
  version: ContextoDaVersao,
): FormulationComponentDTO {
  const item = component.item;

  // Previa por UNIDADE acabada — mesma matematica do Requirement da OP,
  // nunca uma conta paralela so para a tela.
  const perUnit = tryComputeComponentRequirement(
    {
      basis: component.basis,
      quantity: component.quantity,
      unitCode: component.unitCode,
      stockUnitCode: item.unitCode,
      purityPercentApplied: component.purityPercentApplied,
      overagePercent: component.overagePercent,
      quantityMode: component.quantityMode,
      applyPurityAdjustment: component.applyPurityAdjustment,
      applyOverageAdjustment: component.applyOverageAdjustment,
    },
    new Prisma.Decimal(1),
    { basisQuantity: version.basisQuantity, dosesPerPackage: version.dosesPerPackage },
    [...units],
  );

  /*
   * A leitura da BANCADA — por dose e por cápsula —, pelo mesmo motor.
   *
   * A planilha da Veridi pensa em mg por dose e mg por cápsula; a Ordem de
   * Produção separa por embalagem, na unidade de estoque. São recortes
   * diferentes da MESMA conta, e por isso os dois saem daqui: a tela dividir o
   * que recebeu criaria um segundo caminho para o mesmo número.
   */
  const porDose = calcularQuantidadeDaDose(
    {
      basis: component.basis,
      quantity: component.quantity.toString(),
      unitCode: component.unitCode,
      purityPercent: component.purityPercentApplied
        ? component.purityPercentApplied.toString()
        : null,
      overagePercent: component.overagePercent ? component.overagePercent.toString() : null,
      quantityMode: component.quantityMode,
      applyPurityAdjustment: component.applyPurityAdjustment,
      applyOverageAdjustment: component.applyOverageAdjustment,
    },
    version.dosageForm === "CAPSULE" ? version.capsulesPerDose : null,
    unidadesDoMotor(units),
  );
  const dose = porDose !== null && typeof porDose !== "string" ? porDose : null;

  return {
    id: component.id,
    itemId: component.itemId,
    itemCode: item.code,
    itemName: item.name,
    itemType: item.type,
    itemActive: item.active,
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
    legacyTotalQuantity: component.legacyTotalQuantity
      ? component.legacyTotalQuantity.toString()
      : null,
    legacyTotalUnitCode: component.legacyTotalUnitCode,
    legacyBatchUnits: component.legacyBatchUnits ? component.legacyBatchUnits.toString() : null,
    // `null` = a versão ainda não tem premissa para quantificar este
    // componente. Nunca zero: zero seria "não precisa de material".
    theoreticalPerUnit: perUnit ? perUnit.theoreticalQuantity.toString() : null,
    physicalPerUnit: perUnit ? perUnit.requiredQuantity.toString() : null,
    stockUnitCode: item.unitCode,
    /*
     * Cadastro ATUAL do Item: quem monta a receita vê de onde a linha veio sem
     * redigitar nada que já está cadastrado. Nada aqui entra no cálculo — a
     * pureza que o motor usa é o snapshot `purityPercentApplied`, e esta é a do
     * cadastro de hoje, para a tela poder dizer quando as duas divergem.
     */
    itemSourceName: item.sourceName,
    itemDeclaredNutrient: item.declaredNutrient,
    itemFamily: item.family,
    itemPackagingSubtype: item.packagingSubtype,
    itemDefaultPurityPercent: item.defaultPurityPercent
      ? item.defaultPurityPercent.toString()
      : null,
    itemExternalCode: item.externalCode,
    theoreticalPerDose: dose ? dose.teorica.toFixed() : null,
    physicalPerDose: dose ? dose.fisica.toFixed() : null,
    physicalPerCapsule: dose && dose.porCapsula ? dose.porCapsula.toFixed() : null,
    notes: component.notes,
    position: component.position,
  };
}

function toVersionDTO(
  version: VersionWithRelations,
  units: readonly UnitOfMeasure[],
): FormulationVersionDTO {
  return {
    id: version.id,
    productId: version.productId,
    productCode: version.product.code,
    productName: version.product.name,
    versionNumber: version.versionNumber,
    versionLabel: `V${version.versionNumber}`,
    status: version.status,
    basisQuantity: version.basisQuantity.toString(),
    calculationMode: version.calculationMode,
    dosesPerPackage: version.dosesPerPackage,
    /*
     * Premissas da apresentação — SNAPSHOT desta versão. O perfil do Produto vai
     * junto como REFERÊNCIA, para a bancada mostrar o que o cadastro diz hoje;
     * mudar o cadastro nunca reescreve uma versão.
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
    /*
     * PERDA PREVISTA — snapshot da versão, como as demais premissas. `null` nas
     * versões gravadas antes desta coluna: ausência é "não informada", e quem
     * calcula trata isso como "sem correção", nunca como 0% declarado.
     */
    expectedLossPercent: version.expectedLossPercent
      ? version.expectedLossPercent.toString()
      : null,
    productProfile: {
      dosageForm: version.product.dosageForm,
      presentationType: version.product.presentationType,
      capsulesPerDose: version.product.capsulesPerDose,
      doseAmount: version.product.doseAmount ? version.product.doseAmount.toString() : null,
      doseUomCode: version.product.doseUomCode,
      dosesPerPackage: version.product.dosesPerPackage,
      // Público, lote mínimo e caixa de embarque: cadastro do Produto, lido
      // para o resumo da bancada conferir sem sair da tela. Nenhum deles é
      // premissa de cálculo desta versão.
      targetAgeGroup: version.product.targetAgeGroup,
      minimumBatchQuantity: version.product.minimumBatchQuantity
        ? version.product.minimumBatchQuantity.toString()
        : null,
      unitsPerShippingBox: version.product.unitsPerShippingBox,
    },
    outputItemId: version.outputItemId,
    outputItemCode: version.outputItemCode,
    outputItemName: version.outputItemName,
    outputUnitCode: version.outputUnitCode,
    notes: version.notes,
    components: version.components
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((component) => toComponentDTO(component, units, version)),
    createdAt: version.createdAt.toISOString(),
    createdBy: version.createdBy,
    activatedAt: version.activatedAt ? version.activatedAt.toISOString() : null,
    activatedBy: version.activatedBy,
    inactivatedAt: version.inactivatedAt ? version.inactivatedAt.toISOString() : null,
    inactivatedBy: version.inactivatedBy,
    sourceVersionId: version.sourceVersionId,
    sourceVersionNumber: version.sourceVersionNumber,
    // Proveniência do template — nunca vínculo vivo. O código fica gravado
    // para o rótulo sobreviver mesmo se o template for removido.
    originTemplateVersionId: version.originTemplateVersionId,
    originTemplateCode: version.originTemplateCode,
    originTemplateVersionNumber: version.originTemplateVersionNumber,
    originTemplateName: version.originTemplateVersion?.formulationTemplate.name ?? null,
    componentIssues: version.status === "DRAFT" ? componentIssues(version, units) : [],
  };
}

/**
 * O que, nos componentes desta versão, vai barrar a ativação.
 *
 * São as MESMAS regras que `activateFormulationVersion` aplica — apuradas
 * antes, não em paralelo. Uma versão criada a partir de outra de meses atrás
 * pode carregar item inativado, item que virou produto acabado ou unidade que
 * deixou de ser compatível; descobrir isso só no clique de ativar é descobrir
 * tarde.
 */
function componentIssues(
  version: VersionWithRelations,
  units: readonly UnitOfMeasure[],
): FormulationComponentIssueDTO[] {
  const issues: FormulationComponentIssueDTO[] = [];
  for (const component of version.components) {
    const item = component.item;
    const base = { itemId: item.id, itemCode: item.code, itemName: item.name };
    if (item.type === "FINISHED_PRODUCT") {
      issues.push({
        ...base,
        code: "ITEM_IS_FINISHED_PRODUCT",
        description: `${item.code} passou a ser produto acabado e não pode ser componente.`,
      });
    } else if (!item.active) {
      issues.push({
        ...base,
        code: "ITEM_INACTIVE",
        description: `${item.code} foi inativado no cadastro de itens.`,
      });
    }
    if (new Prisma.Decimal(component.quantity).lessThanOrEqualTo(0)) {
      issues.push({
        ...base,
        code: "INVALID_QUANTITY",
        description: `${item.code} está com quantidade inválida.`,
      });
    } else if (!isUomCompatible(component.unitCode, item.unitCode, units)) {
      issues.push({
        ...base,
        code: "UOM_INCOMPATIBLE",
        description: `${item.code} usa ${component.unitCode}, incompatível com a unidade de estoque ${item.unitCode}.`,
      });
    }
  }
  return issues;
}

const versionInclude = {
  product: true,
  /*
   * ORDENADO POR `position`, como todo documento com linhas nesta base.
   *
   * A gravação sempre escreveu `position` pelo índice do array, e a leitura não
   * pedia ordem nenhuma: o banco devolvia na ordem que quisesse. Funcionava por
   * acaso — `deleteMany` seguido de `createMany` costuma devolver na ordem de
   * inserção —, e acaso não é contrato: basta um UPDATE numa linha para ela
   * mudar de lugar físico e a receita aparecer embaralhada. O motor de
   * necessidade já ordenava (`requirement-calc.ts`); quem não ordenava era a
   * leitura que a TELA usa, e foi a reordenação manual que tornou isso visível.
   */
  components: { include: { item: true }, orderBy: { position: "asc" as const } },
  // Nome atual do template de origem, só para o rótulo "criada a partir de".
  originTemplateVersion: { include: { formulationTemplate: true } },
} as const;

async function getUnits(): Promise<UnitOfMeasure[]> {
  return getPrisma().unitOfMeasure.findMany();
}

async function requireVersion(id: string): Promise<VersionWithRelations> {
  const version = await getPrisma().formulationVersion.findUnique({
    where: { id },
    include: versionInclude,
  });
  if (!version) throw new FormulationVersionNotFoundError(id);
  return version;
}

/**
 * Modo e flags do componente, com a marca desligada fora do modo teorico.
 *
 * `applyPurityAdjustment: true` debaixo de `PHYSICAL_DIRECT` e um registro que
 * mente: o motor ignora a marca nesse modo, entao o dado guardado diz que a
 * pureza sera aplicada e ela nao e. Pior, e estado invisivel — a tela so mostra
 * as caixas no modo teorico, e voltar o modo depois religaria a correcao sem
 * ninguem ter marcado nada.
 *
 * Normalizar aqui e no servidor, e nao so na tela, porque a regra e do dominio:
 * um cliente que mande a combinacao incoerente nao deve conseguir grava-la.
 * Nenhum resultado de calculo muda — `ajustesHabilitados` ja devolvia
 * `{ purity: false, overage: false }` para `PHYSICAL_DIRECT`.
 *
 * Componentes sao apagados e recriados a cada gravacao, entao `undefined` aqui
 * significa "use o padrao do banco", nunca "preserve o que estava la".
 */
export function modoEFlags(component: {
  // `| undefined` explicito por causa de `exactOptionalPropertyTypes`: os dois
  // chamadores sao diferentes — a copia de versao le linhas do banco, e a
  // gravacao le um payload validado onde o campo pode faltar.
  quantityMode?: FormulationComponentQuantityMode | null | undefined;
  applyPurityAdjustment?: boolean | null | undefined;
  applyOverageAdjustment?: boolean | null | undefined;
}) {
  const modo = component.quantityMode ?? undefined;
  const teorico = modo === "THEORETICAL_WITH_ADJUSTMENTS";
  return {
    ...(modo !== undefined ? { quantityMode: modo } : {}),
    ...(component.applyPurityAdjustment !== undefined && component.applyPurityAdjustment !== null
      ? { applyPurityAdjustment: teorico && component.applyPurityAdjustment }
      : {}),
    ...(component.applyOverageAdjustment !== undefined && component.applyOverageAdjustment !== null
      ? { applyOverageAdjustment: teorico && component.applyOverageAdjustment }
      : {}),
  };
}

export async function listFormulations(
  query: ListFormulationsQuery,
  pagination: Pagination = query,
): Promise<FormulationListResponse> {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (query.search) {
    where["OR"] = [
      { code: { contains: query.search, mode: "insensitive" } },
      { name: { contains: query.search, mode: "insensitive" } },
      {
        customer: {
          is: {
            OR: [
              { legalName: { contains: query.search, mode: "insensitive" } },
              { tradeName: { contains: query.search, mode: "insensitive" } },
            ],
          },
        },
      },
    ];
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { customer: true, finishedProductItem: true },
      orderBy: { code: "asc" },
      ...pageArgs(pagination),
    }),
    prisma.product.count({ where }),
  ]);

  const productIds = products.map((product) => product.id);
  const versions = productIds.length
    ? await prisma.formulationVersion.findMany({
        where: { productId: { in: productIds } },
        orderBy: { versionNumber: "desc" },
      })
    : [];

  const byProduct = new Map<string, FormulationVersion[]>();
  for (const version of versions) {
    const list = byProduct.get(version.productId) ?? [];
    list.push(version);
    byProduct.set(version.productId, list);
  }

  const formulations: FormulationSummaryDTO[] = products.map((product) => {
    const productVersions = byProduct.get(product.id) ?? [];
    const active = productVersions.find((version) => version.status === "ACTIVE") ?? null;
    const latest = productVersions[0] ?? null;
    const reference = active ?? latest;

    return {
      productId: product.id,
      productCode: product.code,
      productName: product.name,
      customerName: product.customer?.legalName ?? null,
      finishedProductItemId: product.finishedProductItemId,
      finishedProductItemCode: product.finishedProductItem?.code ?? null,
      activeVersionId: active?.id ?? null,
      activeVersionLabel: active ? `V${active.versionNumber}` : null,
      hasFormulation: productVersions.length > 0,
      updatedAt: reference ? (reference.activatedAt ?? reference.createdAt).toISOString() : null,
    };
  });

  return { formulations, ...pageMeta(pagination, total) };
}

export async function listFormulationVersionsByProduct(
  productId: string,
): Promise<FormulationVersionListResponse> {
  const product = await getPrisma().product.findUnique({ where: { id: productId } });
  if (!product) throw new ProductNotFoundError(productId);

  const [versions, units] = await Promise.all([
    getPrisma().formulationVersion.findMany({
      where: { productId },
      include: versionInclude,
      orderBy: { versionNumber: "desc" },
    }),
    getUnits(),
  ]);

  return { versions: versions.map((version) => toVersionDTO(version, units)) };
}

export async function getFormulationVersionById(id: string): Promise<FormulationVersionDTO | null> {
  const version = await getPrisma().formulationVersion.findUnique({
    where: { id },
    include: versionInclude,
  });
  if (!version) return null;
  return toVersionDTO(version, await getUnits());
}

export async function createFirstFormulationVersion(
  productId: string,
  input: CreateFormulationVersionInput,
): Promise<FormulationVersionDTO> {
  const prisma = getPrisma();
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new ProductNotFoundError(productId);
  if (!product.finishedProductItemId) throw new MissingFinishedItemError();

  const outputItem = await prisma.item.findUnique({ where: { id: product.finishedProductItemId } });
  if (!outputItem) throw new MissingFinishedItemError();

  const versionId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId} FOR UPDATE`;

    const existing = await tx.formulationVersion.count({ where: { productId } });
    if (existing > 0) throw new FormulationAlreadyExistsError();

    const version = await tx.formulationVersion.create({
      data: {
        productId,
        versionNumber: 1,
        status: "DRAFT",
        basisQuantity: "1",
        // A V1 nasce com o perfil industrial do Produto — cadastro que ja
        // existe, e a bancada abre preenchida em vez de em branco.
        ...premissasIniciaisDoProduto(product),
        outputItemId: outputItem.id,
        outputItemCode: outputItem.code,
        outputItemName: outputItem.name,
        outputUnitCode: outputItem.unitCode,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        createdBy: SYSTEM_ACTOR,
      },
    });
    return version.id;
  });

  return (await getFormulationVersionById(versionId))!;
}

/**
 * Nova versão a partir de OUTRA versão — a ativa ou uma histórica.
 *
 * Voltar para uma receita antiga só existe para frente: a V1 não é
 * reativada, uma V3 nasce igual a ela. Reativar reescreveria o significado
 * de uma versão que já serviu de base para custo e produção; copiar não
 * mexe em nada do passado.
 *
 * Rascunho não serve de molde: ele ainda é editável, e duplicá-lo cria dois
 * documentos abertos dizendo a mesma coisa — quem quer mudar um rascunho
 * edita o rascunho.
 *
 * A cópia é FIEL, mesmo que o cadastro tenha mudado desde então: alterar uma
 * receita em silêncio para caber nas regras de hoje seria inventar fórmula.
 * O que não passar aparece em `componentIssues` do rascunho criado.
 */
/**
 * Raio de impacto de ativar esta versão.
 *
 * Nada aqui é alterado por ativar — cada documento continua apontando para a
 * receita que ele escolheu. O que muda é o que passa a estar DEFASADO, e essa
 * informação só serve antes do clique.
 */
export async function getFormulationActivationImpact(
  versionId: string,
): Promise<FormulationActivationImpactDTO> {
  const version = await requireVersion(versionId);
  const prisma = getPrisma();

  const [costVersions, orders] = await Promise.all([
    prisma.industrialCostVersion.findMany({
      where: {
        productId: version.productId,
        formulationVersionId: { not: versionId },
        status: { in: ["DRAFT", "ACTIVE"] },
      },
      include: { formulationVersion: { select: { versionNumber: true } } },
      orderBy: { versionNumber: "asc" },
    }),
    // Ordem planejada já congelou requisitos: trocar a formulação ativa não
    // a alcança, e listá-la seria alarme sem consequência.
    prisma.productionOrder.findMany({
      where: {
        productId: version.productId,
        status: "DRAFT",
        formulationVersionId: { not: null, notIn: [versionId] },
      },
      include: { formulationVersion: { select: { versionNumber: true } } },
      orderBy: { code: "asc" },
    }),
  ]);

  return {
    costStructures: costVersions.map((costVersion) => ({
      id: costVersion.id,
      code: costVersion.code,
      label: `${costVersion.code} · V${costVersion.versionNumber}`,
      status: costVersion.status as "DRAFT" | "ACTIVE",
      formulationVersionNumber: costVersion.formulationVersion.versionNumber,
    })),
    productionOrders: orders
      .filter((order) => order.formulationVersion !== null)
      .map((order) => ({
        id: order.id,
        code: order.code,
        formulationVersionNumber: order.formulationVersion!.versionNumber,
      })),
  };
}

export async function createNewVersionFrom(
  sourceVersionId: string,
): Promise<FormulationVersionDTO> {
  const source = await requireVersion(sourceVersionId);
  if (source.status === "DRAFT") throw new VersionIsDraftSourceError();

  const versionId = await getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${source.productId} FOR UPDATE`;

    const maxVersion = await tx.formulationVersion.aggregate({
      where: { productId: source.productId },
      _max: { versionNumber: true },
    });
    const nextVersionNumber = (maxVersion._max.versionNumber ?? 0) + 1;

    const version = await tx.formulationVersion.create({
      data: {
        productId: source.productId,
        versionNumber: nextVersionNumber,
        status: "DRAFT",
        basisQuantity: source.basisQuantity,
        // A nova versao nasce identica a ativa: copiar so os componentes
        // deixaria linhas PER_DOSE numa versao FIXED_BASIS sem doses —
        // formula quebrada no primeiro calculo.
        calculationMode: source.calculationMode,
        dosesPerPackage: source.dosesPerPackage,
        // Premissas da apresentacao seguem a copia FIEL do resto: a versao nova
        // comeca dizendo o que a de origem dizia, e nao o que o cadastro do
        // Produto diz hoje.
        dosageForm: source.dosageForm,
        presentationType: source.presentationType,
        capsulesPerDose: source.capsulesPerDose,
        doseAmount: source.doseAmount,
        doseUomCode: source.doseUomCode,
        packageContentAmount: source.packageContentAmount,
        packageContentUomCode: source.packageContentUomCode,
        // Perda prevista tambem e copia FIEL: a versao nova comeca com a
        // premissa de producao que a de origem declarava.
        expectedLossPercent: source.expectedLossPercent,
        outputItemId: source.outputItemId,
        outputItemCode: source.outputItemCode,
        outputItemName: source.outputItemName,
        outputUnitCode: source.outputUnitCode,
        notes: source.notes,
        createdBy: SYSTEM_ACTOR,
        // Origem declarada: sem ela, um salto de custo entre duas versões
        // não tem explicação possível meses depois.
        sourceVersionId: source.id,
        sourceVersionNumber: source.versionNumber,
        components: {
          create: source.components.map((component) => ({
            itemId: component.itemId,
            quantity: component.quantity,
            unitCode: component.unitCode,
            ...(component.basis !== undefined ? { basis: component.basis } : {}),
            // Responsabilidade de fornecimento tambem e congelada aqui:
            // e intencao da versao, nao consulta ao cadastro atual.
            ...(component.supplyResponsibility !== undefined
              ? { supplyResponsibility: component.supplyResponsibility }
              : {}),
            // Pureza/overage sao SNAPSHOT: gravados aqui e nunca mais
            // reescritos por mudanca no cadastro do Item.
            ...(component.purityPercentApplied !== undefined
              ? { purityPercentApplied: component.purityPercentApplied }
              : {}),
            ...(component.overagePercent !== undefined
              ? { overagePercent: component.overagePercent }
              : {}),
            // Modo e flags acompanham o snapshot: sao a INTERPRETACAO da
            // quantidade, e mudar a receita depois nao reescreve versao ativa.
            ...modoEFlags(component),
            ...(component.legacyTotalQuantity !== undefined
              ? { legacyTotalQuantity: component.legacyTotalQuantity }
              : {}),
            ...(component.legacyTotalUnitCode !== undefined
              ? { legacyTotalUnitCode: component.legacyTotalUnitCode }
              : {}),
            ...(component.legacyBatchUnits !== undefined
              ? { legacyBatchUnits: component.legacyBatchUnits }
              : {}),
            notes: component.notes,
            position: component.position,
          })),
        },
      },
    });
    return version.id;
  });

  return (await getFormulationVersionById(versionId))!;
}

/** As premissas da apresentacao como as colunas as guardam. */
type PremissasGravadas = {
  dosageForm: DosageForm | null;
  presentationType: PresentationType | null;
  capsulesPerDose: number | null;
  doseAmount: Prisma.Decimal | null;
  doseUomCode: string | null;
  packageContentAmount: Prisma.Decimal | null;
  packageContentUomCode: string | null;
  dosesPerPackage: number | null;
};

/**
 * Premissas com que uma versao NOVA nasce: as do cadastro do Produto.
 *
 * Forma, apresentacao e o que a forma usa ja estao cadastrados no Produto —
 * redigitar seria so mais uma chance de divergir. Nao e vinculo: daqui em
 * diante a versao tem as SUAS premissas, editaveis enquanto rascunho, e mudar o
 * cadastro do Produto depois nao reescreve versao nenhuma.
 */
export function premissasIniciaisDoProduto(
  product: Pick<
    Product,
    | "dosageForm"
    | "presentationType"
    | "capsulesPerDose"
    | "doseAmount"
    | "doseUomCode"
    | "dosesPerPackage"
  >,
): Partial<PremissasGravadas> {
  const forma = product.dosageForm;
  const base = {
    ...(forma ? { dosageForm: forma } : {}),
    ...(product.presentationType ? { presentationType: product.presentationType } : {}),
  };
  if (forma === "CAPSULE") {
    return {
      ...base,
      ...(product.capsulesPerDose ? { capsulesPerDose: product.capsulesPerDose } : {}),
      ...(product.dosesPerPackage ? { dosesPerPackage: product.dosesPerPackage } : {}),
    };
  }
  if (forma === "POWDER" && product.doseAmount && product.doseUomCode) {
    // Conteudo da embalagem = dose x doses, na unidade da dose: o mesmo dado do
    // cadastro, dito do jeito que a bancada do po pergunta.
    const conteudo = product.dosesPerPackage
      ? new Prisma.Decimal(product.doseAmount).times(product.dosesPerPackage)
      : null;
    return {
      ...base,
      doseAmount: product.doseAmount,
      doseUomCode: product.doseUomCode,
      ...(conteudo
        ? { packageContentAmount: conteudo, packageContentUomCode: product.doseUomCode }
        : {}),
      ...(product.dosesPerPackage ? { dosesPerPackage: product.dosesPerPackage } : {}),
    };
  }
  return base;
}

/** Campos da apresentacao que o payload pode trazer. */
const CAMPOS_DA_APRESENTACAO = [
  "dosageForm",
  "presentationType",
  "capsulesPerDose",
  "capsulesPerPackage",
  "doseAmount",
  "doseUomCode",
  "packageContentAmount",
  "packageContentUomCode",
] as const;

function tocouNaApresentacao(input: UpdateFormulationVersionInput): boolean {
  return CAMPOS_DA_APRESENTACAO.some((campo) => input[campo] !== undefined);
}

/** Em que campo a recusa da apresentacao deve aparecer. */
function campoDaRecusa(motivo: ApresentacaoBlock, forma: DosageForm | null): string {
  if (motivo === "CAPSULAS_NAO_DIVIDEM") return "capsulesPerPackage";
  if (motivo === "DOSES_NAO_INTEIRAS") return "packageContentAmount";
  return forma === "POWDER" ? "doseUomCode" : "dosageForm";
}

/**
 * As premissas depois desta gravacao, com doses por embalagem DERIVADO nas
 * formas que o derivam.
 *
 * Cada forma guarda so o que usa: premissa de outra forma deixada aqui seria
 * dado invisivel, que volta a valer no dia em que alguem trocar a forma.
 *
 * `dosesPerPackage` continua sendo a premissa do motor — a diferenca e que na
 * capsula e no po ela e RESULTADO (capsulas por embalagem / capsulas por dose,
 * conteudo / dose) em vez de um segundo numero digitado, que divergiria do
 * primeiro. Divisao que nao fecha e RECUSADA com o campo junto: arredondar
 * doses mudaria em silencio o material de toda linha por dose.
 */
function resolverApresentacao(
  current: FormulationVersion,
  input: UpdateFormulationVersionInput,
  units: readonly UnitOfMeasure[],
): PremissasGravadas {
  const forma = input.dosageForm !== undefined ? input.dosageForm : current.dosageForm;
  const apresentacao =
    input.presentationType !== undefined ? input.presentationType : current.presentationType;
  const capsulasPorDose =
    input.capsulesPerDose !== undefined ? input.capsulesPerDose : current.capsulesPerDose;
  const capsulasNaEmbalagem =
    input.capsulesPerPackage !== undefined
      ? input.capsulesPerPackage
      : capsulasPorEmbalagem(current.capsulesPerDose, current.dosesPerPackage);
  const dose =
    input.doseAmount !== undefined
      ? input.doseAmount
      : current.doseAmount
        ? current.doseAmount.toString()
        : null;
  const doseUom = input.doseUomCode !== undefined ? input.doseUomCode : current.doseUomCode;
  const conteudo =
    input.packageContentAmount !== undefined
      ? input.packageContentAmount
      : current.packageContentAmount
        ? current.packageContentAmount.toString()
        : null;
  const conteudoUom =
    input.packageContentUomCode !== undefined
      ? input.packageContentUomCode
      : current.packageContentUomCode;

  const daCapsula = forma === "CAPSULE";
  const doPo = forma === "POWDER";
  const premissas: PremissasDaApresentacao = {
    dosageForm: forma,
    capsulesPerDose: daCapsula ? capsulasPorDose : null,
    capsulesPerPackage: daCapsula ? capsulasNaEmbalagem : null,
    doseAmount: doPo ? dose : null,
    doseUomCode: doPo ? doseUom : null,
    packageContentAmount: doPo ? conteudo : null,
    packageContentUomCode: doPo ? conteudoUom : null,
  };

  let doses: number | null;
  if (formaDerivaDoses(forma)) {
    const derivado = dosesPorEmbalagemDaApresentacao(premissas, unidadesDoMotor(units));
    if (typeof derivado === "string") {
      throw new InvalidFormulationPresentationError(
        campoDaRecusa(derivado, forma),
        MENSAGENS_DA_APRESENTACAO[derivado],
      );
    }
    doses = derivado;
  } else {
    doses = input.dosesPerPackage !== undefined ? input.dosesPerPackage : current.dosesPerPackage;
  }

  return {
    dosageForm: forma,
    presentationType: apresentacao,
    capsulesPerDose: premissas.capsulesPerDose,
    doseAmount:
      premissas.doseAmount === null ? null : new Prisma.Decimal(String(premissas.doseAmount)),
    doseUomCode: premissas.doseUomCode,
    packageContentAmount:
      premissas.packageContentAmount === null
        ? null
        : new Prisma.Decimal(String(premissas.packageContentAmount)),
    packageContentUomCode: premissas.packageContentUomCode,
    dosesPerPackage: doses,
  };
}

/** Valida um array de componentes recebido — dedupe, tipo, ativo (so para itens NOVOS) e unidade. */
async function validateComponents(
  inputs: FormulationComponentInput[],
  previousItemIds: ReadonlySet<string>,
  units: readonly UnitOfMeasure[],
): Promise<void> {
  const seen = new Set<string>();
  for (const input of inputs) {
    if (seen.has(input.itemId)) {
      const item = await getPrisma().item.findUnique({ where: { id: input.itemId } });
      throw new DuplicateComponentItemError(item?.code ?? input.itemId);
    }
    seen.add(input.itemId);
  }

  for (const input of inputs) {
    const item = await getPrisma().item.findUnique({ where: { id: input.itemId } });
    if (!item) throw new ComponentItemNotFoundError(input.itemId);
    if (item.type === "FINISHED_PRODUCT") throw new InvalidComponentItemTypeError(item.code);

    // So exige item ativo para uma linha genuinamente NOVA — uma linha ja
    // existente antes desta edicao (herdada de copia de versao ACTIVE, por
    // exemplo) continua editavel mesmo que o item tenha sido inativado depois.
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

export async function updateFormulationVersion(
  id: string,
  input: UpdateFormulationVersionInput,
): Promise<FormulationVersionDTO> {
  const current = await requireVersion(id);
  if (current.status !== "DRAFT") throw new VersionNotDraftError();

  const mexeuNaApresentacao = tocouNaApresentacao(input);
  const units =
    input.components !== undefined || mexeuNaApresentacao ? await getUnits() : ([] as UnitOfMeasure[]);
  if (input.components !== undefined) {
    const previousItemIds = new Set(current.components.map((component) => component.itemId));
    await validateComponents(input.components, previousItemIds, units);
  }
  // Recusa da premissa ANTES da transacao: divisao que nao fecha nao grava
  // metade da apresentacao.
  const apresentacao = mexeuNaApresentacao ? resolverApresentacao(current, input, units) : null;

  await getPrisma().$transaction(async (tx) => {
    await tx.formulationVersion.update({
      where: { id },
      data: {
        ...(input.basisQuantity !== undefined ? { basisQuantity: input.basisQuantity } : {}),
        ...(input.calculationMode !== undefined
          ? { calculationMode: input.calculationMode }
          : {}),
        // Mexeu na apresentacao? As doses saem dela. Senao, o campo antigo
        // continua valendo exatamente como valia.
        ...(apresentacao
          ? apresentacao
          : input.dosesPerPackage !== undefined
            ? { dosesPerPackage: input.dosesPerPackage }
            : {}),
        ...(input.expectedLossPercent !== undefined
          ? { expectedLossPercent: input.expectedLossPercent }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });

    if (input.components !== undefined) {
      await tx.formulationComponent.deleteMany({ where: { formulationVersionId: id } });
      if (input.components.length > 0) {
        await tx.formulationComponent.createMany({
          data: input.components.map((component, index) => ({
            formulationVersionId: id,
            itemId: component.itemId,
            quantity: component.quantity,
            unitCode: component.unitCode,
            ...(component.basis !== undefined ? { basis: component.basis } : {}),
            // Responsabilidade de fornecimento tambem e congelada aqui:
            // e intencao da versao, nao consulta ao cadastro atual.
            ...(component.supplyResponsibility !== undefined
              ? { supplyResponsibility: component.supplyResponsibility }
              : {}),
            // Pureza/overage sao SNAPSHOT: gravados aqui e nunca mais
            // reescritos por mudanca no cadastro do Item.
            ...(component.purityPercentApplied !== undefined
              ? { purityPercentApplied: component.purityPercentApplied }
              : {}),
            ...(component.overagePercent !== undefined
              ? { overagePercent: component.overagePercent }
              : {}),
            // Modo e flags acompanham o snapshot: sao a INTERPRETACAO da
            // quantidade, e mudar a receita depois nao reescreve versao ativa.
            ...modoEFlags(component),
            ...(component.legacyTotalQuantity !== undefined
              ? { legacyTotalQuantity: component.legacyTotalQuantity }
              : {}),
            ...(component.legacyTotalUnitCode !== undefined
              ? { legacyTotalUnitCode: component.legacyTotalUnitCode }
              : {}),
            ...(component.legacyBatchUnits !== undefined
              ? { legacyBatchUnits: component.legacyBatchUnits }
              : {}),
            ...(component.notes !== undefined ? { notes: component.notes } : {}),
            position: index,
          })),
        });
      }
    }
  });

  return (await getFormulationVersionById(id))!;
}

export async function activateFormulationVersion(id: string): Promise<FormulationVersionDTO> {
  const version = await requireVersion(id);
  if (version.status !== "DRAFT") throw new VersionNotDraftError();

  const product = await getPrisma().product.findUnique({
    where: { id: version.productId },
    include: { finishedProductItem: true },
  });
  if (!product) throw new ProductNotFoundError(version.productId);

  const reasons: string[] = [];
  if (!product.active) reasons.push("o produto está inativo");
  if (!product.finishedProductItemId || !product.finishedProductItem) {
    reasons.push("o produto não possui item de produto acabado vinculado");
  } else {
    if (!product.finishedProductItem.active) reasons.push("o item de produto acabado está inativo");
    if (product.finishedProductItem.type !== "FINISHED_PRODUCT") {
      reasons.push("o item de saída não é mais um produto acabado");
    }
  }
  if (new Prisma.Decimal(version.basisQuantity).lessThanOrEqualTo(0)) {
    reasons.push("a base da formulação deve ser maior que zero");
  }
  if (version.components.length === 0) {
    reasons.push("adicione ao menos um componente antes de ativar");
  }

  const units = await getUnits();
  const invalidComponents: string[] = [];
  for (const component of version.components) {
    const item = component.item;
    if (!item.active) invalidComponents.push(`${item.code} (inativo)`);
    else if (item.type === "FINISHED_PRODUCT") invalidComponents.push(`${item.code} (produto acabado)`);
    else if (new Prisma.Decimal(component.quantity).lessThanOrEqualTo(0)) {
      invalidComponents.push(`${item.code} (quantidade inválida)`);
    } else if (!isUomCompatible(component.unitCode, item.unitCode, units)) {
      invalidComponents.push(`${item.code} (unidade incompatível)`);
    }
  }
  if (invalidComponents.length > 0) {
    reasons.push(`componentes precisam de revisão: ${invalidComponents.join(", ")}`);
  }

  /*
   * Premissa que a fórmula usa mas ninguém informou.
   *
   * A pergunta é sobre a base de CADA componente, não sobre o modo da
   * versão: a auditoria VAL-LEG-01 ativou uma versão `FIXED_BASIS` com
   * quatro componentes `PER_DOSE` e doses em branco. Cada material saiu
   * com necessidade zero, e o custo industrial se declarou completo.
   *
   * Rascunho pode ficar incompleto — é onde se corrige. Ativa, não.
   */
  if (missingFormulationContext(version.components, version) === "DOSES_PER_PACKAGE") {
    reasons.push(
      "informe as doses por embalagem — há componentes calculados por dose",
    );
  }

  // Material fornecido pelo cliente só existe se houver cliente: sem isso a
  // fórmula fica ambígua ("qual cliente envia?"). O DRAFT continua livre
  // para edição — o bloqueio é só na ativação.
  const hasCustomerComponent = version.components.some(
    (component) => component.supplyResponsibility === "CUSTOMER",
  );
  if (hasCustomerComponent && !product.customerId) {
    reasons.push(
      "há componentes fornecidos pelo cliente, mas o produto não está vinculado a um cliente",
    );
  }

  if (reasons.length > 0) {
    throw new FormulationActivationError(
      `Não é possível ativar esta versão: ${reasons.join("; ")}.`,
    );
  }

  await getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${version.productId} FOR UPDATE`;

    const previousActive = await tx.formulationVersion.findFirst({
      where: { productId: version.productId, status: "ACTIVE" },
    });
    if (previousActive) {
      await tx.formulationVersion.update({
        where: { id: previousActive.id },
        data: { status: "INACTIVE", inactivatedAt: new Date(), inactivatedBy: SYSTEM_ACTOR },
      });
    }

    await tx.formulationVersion.update({
      where: { id },
      data: { status: "ACTIVE", activatedAt: new Date(), activatedBy: SYSTEM_ACTOR },
    });

    /*
     * Rascunho de estrutura de custos acompanha, na mesma transação.
     *
     * Congelar a receita protege COMPROMISSO — orçamento enviado, OP
     * liberada. Um rascunho não tem nenhum: deixá-lo para trás só obrigava a
     * refazer à mão o que o sistema sabia. Nada digitado se perde: a lista de
     * materiais é reflexo da formulação, e premissas, recursos e base de
     * produção não vêm dela.
     *
     * Versão ATIVA nunca entra aqui, e rascunho FIXADO também não: escolher
     * explicitamente outra receita é decisão, não defasagem.
     */
    await tx.industrialCostVersion.updateMany({
      where: { productId: version.productId, status: "DRAFT", formulationPinned: false },
      data: { formulationVersionId: id },
    });
  });

  return (await getFormulationVersionById(id))!;
}
