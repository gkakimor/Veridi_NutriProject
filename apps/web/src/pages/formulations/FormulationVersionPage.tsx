import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
import type {
  ApresentacaoBlock,
  DosageForm,
  FormulationActivationImpactDTO,
  FormulationCalculationMode,
  FormulationComponentBasis,
  FormulationComponentQuantityMode,
  FormulationCostEstimateDTO,
  FormulationVersionDTO,
  IndustrialMaterialCostSource,
  ItemDTO,
  ItemFamily,
  ItemType,
  PackagingSubtype,
  PresentationType,
  SupplyResponsibility,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import {
  COST_QUALITY_LABELS,
  FORMULATION_CALCULATION_MODES,
  FORMULATION_CALCULATION_MODE_LABELS,
  FORMULATION_COMPONENT_BASES,
  FORMULATION_COMPONENT_BASIS_LABELS,
  FORMULATION_VERSION_STATUS_LABELS,
  INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS,
  SUPPLY_RESPONSIBILITIES,
  SUPPLY_RESPONSIBILITY_LABELS,
  DOSAGE_FORM_LABELS,
  FORMAS_DA_BANCADA,
  ITEM_FAMILY_LABELS,
  MENSAGENS_DA_APRESENTACAO,
  PACKAGING_SUBTYPE_LABELS,
  PRESENTATION_TYPES,
  PRESENTATION_TYPE_LABELS,
  TARGET_AGE_GROUP_LABELS,
  ajustesAutorizados,
  apresentacoesDaForma,
  calcularQuantidadeDaDose,
  calcularQuantidadeDoComponente,
  capsulasPorEmbalagem,
  dosesPorEmbalagemDaApresentacao,
  formaDerivaDoses,
  quantidadeBrutaPlanejada,
  rendimentoEsperado,
  resumirDoses,
} from "@veridi/shared";
import { CalcHint } from "../../components/help/CalcHint";
import { DecimalField, IntegerField, PercentField } from "../../components/NumericField";
import { decimalDaApiComparavel } from "../../lib/dirty-fields";
import { lerInteiroOpcional } from "../../lib/integer-input";
import { numericInvalidMessage, parsePtBrNumber, toPtBrEditText, formatIntegerPtBr, formatPercentPtBr } from "../../lib/numeric-ptbr";
import {
  CASAS_PERCENTUAL_TECNICO,
  CASAS_QUANTIDADE,
  OPCOES_PERCENTUAL_TECNICO,
  OPCOES_QUANTIDADE,
} from "../../lib/numeric-scales";
import {
  activateFormulationVersion,
  getFormulationActivationImpact,
  createNewFormulationVersion,
  getFormulationVersion,
  updateFormulationVersion,
} from "../../lib/formulations-api";
import { getItem, listItems } from "../../lib/items-api";
import { listUnits } from "../../lib/units-api";
import { unidadesDaDimensao } from "../../lib/uom-options";
import { ApiValidationError } from "../../lib/api-errors";
import { decimalLegivel, exigirDecimal, exigirDecimalOpcional } from "../../lib/decimal-field";
import { getFormulationCostEstimate } from "../../lib/costs-api";
import { formatBRL } from "../../lib/currency";
import { FormSection } from "../../components/FormSection";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import { FormulationTemplateOrigin } from "../formulation-templates/FormulationTemplateOrigin";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EntityLink, entityHref } from "../../components/EntityLink";
import { useAuth } from "../../app/AuthProvider";
import { useContextualCreateOrigin } from "../../lib/use-contextual-create";
import { formatQuantity, formatQuantityWithUnit } from "../../lib/quantity";
import { ProductRelatedLinks } from "../../components/ProductRelatedLinks";
import { ProjectOriginLink } from "../../components/ProjectOriginLink";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
/*
  O painel "O que a quantidade informada significa" saiu da Formulação
  (FORMULATION-WORKBENCH-01, homologação). Pureza e reserva de produção são
  COLUNAS da linha, e o que a pureza faz deixou de ser uma marca escondida
  atrás de um expansível. O componente continua vivo: o Modelo de Formulação
  é outra tela e continua com ele. O que fica aqui é a VALIDAÇÃO dos dois
  percentuais, que é a mesma nas duas telas e não pode divergir.
*/
import { errosDosAjustes } from "./AjustesDaQuantidade";
import type { AjustesDaQuantidade } from "./AjustesDaQuantidade";
import { TableEmptyRow } from "../../components/TableEmptyRow";

/**
 * As duas seções da bancada, pelo TIPO REAL do Item — nunca pelo texto do
 * cadastro: "Cápsula" é matéria-prima num produto e embalagem em outro, e quem
 * responde isso é o tipo, não o nome.
 */
type SecaoDaFormula = "COMPOSICAO" | "EMBALAGEM";

const SECAO_DO_TIPO: Record<ItemType, SecaoDaFormula> = {
  RAW_MATERIAL: "COMPOSICAO",
  PACKAGING: "EMBALAGEM",
  // Produto acabado não é componente válido; fica visível na composição, onde
  // `componentIssues` explica por que a versão não ativa.
  FINISHED_PRODUCT: "COMPOSICAO",
};

interface ItemOption {
  id: string;
  code: string;
  name: string;
  type: ItemType;
  unitCode: string;
  unitDimension: string;
  active: boolean;
  /** Dados técnicos do cadastro — a linha nova nasce com eles preenchidos. */
  sourceName: string | null;
  declaredNutrient: string | null;
  family: ItemFamily | null;
  packagingSubtype: PackagingSubtype | null;
  defaultPurityPercent: string | null;
  externalCode: string | null;
}

/**
 * Primeira página do catálogo — o que a lista mostra antes de digitar.
 *
 * Era 1000 por tipo, e o catálogo tem 1.211 matérias-primas ativas: 211
 * existiam e não apareciam na busca, sem aviso. Quem digita agora pergunta
 * ao servidor (`buscarItens`), que conhece o catálogo inteiro.
 */
const PRIMEIRA_PAGINA = 50;

/**
 * Lote de referência da simulação da perda, em unidade do produto acabado.
 *
 * Número redondo de propósito: ele não descreve nenhum pedido, serve para ler a
 * perda como quantidade em vez de percentual. Quem planeja de verdade usa a
 * quantidade do Pedido; aqui é régua.
 */
const LOTE_DA_SIMULACAO = "1000";

/** Uma conversão só de item do catálogo para opção da tela. */
function itemOption(item: ItemDTO): ItemOption {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    type: item.type,
    unitCode: item.unitCode,
    unitDimension: item.unit.dimension,
    active: item.active,
    sourceName: item.sourceName,
    declaredNutrient: item.declaredNutrient,
    family: item.family,
    packagingSubtype: item.packagingSubtype,
    defaultPurityPercent: item.defaultPurityPercent,
    externalCode: item.externalCode,
  };
}

/** Um formato só de rótulo: o da lista inicial e o da busca não podem divergir. */
function opcaoDoItem(item: ItemOption): EntityOption {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    ...(item.active ? {} : { hint: "inativo" }),
  };
}

interface ComponentRow {
  key: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemActive: boolean;
  stockUnitCode: string;
  quantity: string;
  unitCode: string;
  basis: FormulationComponentBasis;
  supplyResponsibility: SupplyResponsibility;
  purityPercentApplied: string;
  overagePercent: string;
  quantityMode: FormulationComponentQuantityMode;
  applyPurityAdjustment: boolean;
  applyOverageAdjustment: boolean;
  notes: string;
  /**
   * Grandezas AUTORITATIVAS do servidor, por unidade acabada e na unidade de
   * estoque. Nada aqui é recalculado a partir de pureza, overage, doses ou
   * conversão: a prévia do rascunho chama a mesma função do motor, e a versão
   * gravada usa o que a API já respondeu.
   */
  theoreticalPerUnit: string | null;
  physicalPerUnit: string | null;
  /**
   * As mesmas grandezas por DOSE e por CÁPSULA, na unidade declarada. Do
   * servidor na versão gravada; da prévia (mesma função) enquanto se edita.
   */
  theoreticalPerDose: string | null;
  physicalPerDose: string | null;
  physicalPerCapsule: string | null;
  /** Tipo real do Item — decide a seção. `null` enquanto a linha não tem item. */
  itemType: ItemType | null;
  /** Onde a linha nasceu, usado só enquanto ela não tem item. */
  secao: SecaoDaFormula;
  /** Cadastro do Item, para a linha explicar de onde veio — nunca cálculo. */
  itemSourceName: string | null;
  itemDeclaredNutrient: string | null;
  itemFamily: ItemFamily | null;
  itemPackagingSubtype: PackagingSubtype | null;
  /** Pureza do cadastro HOJE; a aplicada nesta versão é `purityPercentApplied`. */
  itemDefaultPurityPercent: string | null;
  /** Código do sistema legado do Item. `null` = item sem legado, e a linha cala. */
  itemExternalCode: string | null;
}

function statusBadgeClass(status: FormulationVersionDTO["status"]): string {
  switch (status) {
    case "ACTIVE":
      return "badge badge--active";
    case "DRAFT":
      return "badge badge--warn";
    case "INACTIVE":
      return "badge badge--neutral";
  }
}

let rowKeySeq = 0;
function nextRowKey(): string {
  rowKeySeq += 1;
  return `component-${rowKeySeq}`;
}

/**
 * O contador reinicia junto com o módulo, e o rascunho atravessa um F5 na
 * tela de cadastro de item: sem empurrá-lo para além das chaves
 * restauradas, "Adicionar componente" devolveria uma chave que uma linha já
 * usa — e duas linhas passariam a mudar juntas.
 */
function absorverChaves(linhas: ComponentRow[]) {
  for (const linha of linhas) {
    const numero = Number(linha.key.split("-")[1]);
    if (Number.isFinite(numero) && numero > rowKeySeq) rowKeySeq = numero;
  }
}

/**
 * O que a versão leva junto ao sair para cadastrar um item.
 *
 * Só o formulário. Catálogo de itens, unidades, estimativa de custo e
 * impacto de ativação vêm do servidor e são recarregados na volta.
 */
type RascunhoVersao = {
  basisQuantity: string;
  calculationMode: FormulationCalculationMode;
  dosesPerPackage: string;
  /** Premissas da apresentação, como estão nos campos da bancada. */
  dosageForm: DosageForm | "";
  presentationType: PresentationType | "";
  capsulesPerDose: string;
  capsulesPerPackage: string;
  doseAmount: string;
  doseUomCode: string;
  packageContentAmount: string;
  packageContentUomCode: string;
  notes: string;
  components: ComponentRow[];
};

/**
 * A linha que pediu o cadastro.
 *
 * O contexto atravessa `sessionStorage` e o token viaja na URL: é dado
 * desconhecido, lido com desconfiança. Sem chave legítima o item novo não
 * entra em linha nenhuma — melhor que entrar na primeira, que é a errada.
 */
function lerChaveDaLinha(contexto: Record<string, unknown> | null | undefined): string | null {
  const chave = contexto?.["rowKey"];
  return typeof chave === "string" && chave.length > 0 ? chave : null;
}

/**
 * O DTO do servidor projetado na MESMA forma do payload de gravação.
 *
 * É o outro lado de `montarRascunho`: comparar as duas serializações é o que
 * diz se há alteração pendente. Precisam produzir a mesma forma para o mesmo
 * conteúdo, senão a tela acharia que há edição onde não há — e salvaria a
 * cada ativação, ou pior, o contrário.
 */
function rascunhoDoDTO(dto: FormulationVersionDTO) {
  return {
    basisQuantity: dto.basisQuantity.trim(),
    calculationMode: dto.calculationMode,
    dosesPerPackage: dto.dosesPerPackage === null ? null : String(dto.dosesPerPackage).trim(),
    // Premissas da apresentação viajam na mesma forma do payload de gravação:
    // é comparando as duas serializações que a tela sabe se há edição pendente.
    dosageForm: dto.dosageForm ?? null,
    presentationType: dto.presentationType ?? null,
    capsulesPerDose: dto.capsulesPerDose == null ? null : String(dto.capsulesPerDose),
    capsulesPerPackage: dto.capsulesPerPackage == null ? null : String(dto.capsulesPerPackage),
    doseAmount: dto.doseAmount ?? null,
    doseUomCode: dto.doseUomCode ?? null,
    packageContentAmount: dto.packageContentAmount ?? null,
    packageContentUomCode: dto.packageContentUomCode ?? null,
    expectedLossPercent: dto.expectedLossPercent ?? null,
    notes: (dto.notes ?? "").trim(),
    components: dto.components.map((component) => ({
      itemId: component.itemId,
      quantity: component.quantity.trim(),
      unitCode: component.unitCode,
      basis: component.basis,
      supplyResponsibility: component.supplyResponsibility,
      purityPercentApplied: (component.purityPercentApplied ?? "").trim() || null,
      overagePercent: (component.overagePercent ?? "").trim() || null,
      quantityMode: component.quantityMode,
      applyPurityAdjustment: component.applyPurityAdjustment,
      applyOverageAdjustment: component.applyOverageAdjustment,
      ...((component.notes ?? "").trim() ? { notes: (component.notes ?? "").trim() } : {}),
    })),
  };
}

/**
 * O rascunho com os decimais em forma canônica, para comparar: `1000.50` e
 * `1000.5` são o mesmo rascunho, e sair de um campo — que normaliza o texto —
 * não é alteração pendente (PTBR-NUMERIC-INPUT-ROLLOUT-01).
 */
function rascunhoComparavel<
  T extends {
    basisQuantity: string;
    doseAmount: string | null;
    packageContentAmount: string | null;
    expectedLossPercent: string | null;
    components: { quantity: string; purityPercentApplied: string | null; overagePercent: string | null }[];
  },
>(rascunho: T): unknown {
  return {
    ...rascunho,
    basisQuantity: decimalDaApiComparavel(rascunho.basisQuantity) ?? "",
    doseAmount: decimalDaApiComparavel(rascunho.doseAmount),
    packageContentAmount: decimalDaApiComparavel(rascunho.packageContentAmount),
    expectedLossPercent: decimalDaApiComparavel(rascunho.expectedLossPercent),
    components: rascunho.components.map((componente) => ({
      ...componente,
      quantity: decimalDaApiComparavel(componente.quantity) ?? "",
      purityPercentApplied: decimalDaApiComparavel(componente.purityPercentApplied),
      overagePercent: decimalDaApiComparavel(componente.overagePercent),
    })),
  };
}

const MENSAGEM_DOSES_INVALIDAS = "Doses por embalagem: informe um número inteiro maior que zero.";

/**
 * Doses por embalagem como vai ao servidor — FORMULATION-DOSES-INPUT-01.
 *
 * Era o texto cru, e a prévia lia com `Number()`: `1e2` aparecia como 100 e
 * gravava 100. Agora é a leitura estrita de inteiro, a mesma do Projeto e do
 * Orçamento. Vazio é `null`; o inteiro segue como texto, como sempre foi; zero
 * segue para o servidor, que responde no campo.
 */
function dosesParaEnvio(texto: string): string | null {
  const leitura = lerInteiroOpcional(texto);
  if (leitura.tipo === "vazio") return null;
  if (leitura.tipo === "invalido") throw new Error(MENSAGEM_DOSES_INVALIDAS);
  return String(leitura.valor);
}

/** Inteiro opcional da apresentação — a mesma leitura estrita das doses. */
function inteiroParaEnvio(texto: string, rotulo: string): string | null {
  const leitura = lerInteiroOpcional(texto);
  if (leitura.tipo === "vazio") return null;
  if (leitura.tipo === "invalido") {
    throw new Error(`${rotulo}: informe um número inteiro maior que zero.`);
  }
  return String(leitura.valor);
}

/** Em que campo a recusa da apresentação aparece — o mesmo endereço do servidor. */
function campoDaRecusaNaTela(motivo: ApresentacaoBlock): string {
  if (motivo === "CAPSULAS_NAO_DIVIDEM") return "capsulesPerPackage";
  if (motivo === "DOSES_NAO_INTEIRAS") return "packageContentAmount";
  return "doseUomCode";
}

function rowFromDTO(component: FormulationVersionDTO["components"][number]): ComponentRow {
  return {
    key: nextRowKey(),
    itemId: component.itemId,
    itemCode: component.itemCode,
    itemName: component.itemName,
    itemActive: component.itemActive,
    stockUnitCode: component.stockUnitCode,
    // Números no texto do campo, em português: é o que os campos editam.
    quantity: toPtBrEditText(component.quantity, OPCOES_QUANTIDADE),
    unitCode: component.unitCode,
    basis: component.basis,
    supplyResponsibility: component.supplyResponsibility,
    purityPercentApplied: toPtBrEditText(component.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO),
    overagePercent: toPtBrEditText(component.overagePercent, OPCOES_PERCENTUAL_TECNICO),
    quantityMode: component.quantityMode,
    applyPurityAdjustment: component.applyPurityAdjustment,
    applyOverageAdjustment: component.applyOverageAdjustment,
    notes: component.notes ?? "",
    theoreticalPerUnit: component.theoreticalPerUnit,
    physicalPerUnit: component.physicalPerUnit,
    theoreticalPerDose: component.theoreticalPerDose ?? null,
    physicalPerDose: component.physicalPerDose ?? null,
    physicalPerCapsule: component.physicalPerCapsule ?? null,
    itemType: component.itemType,
    secao: SECAO_DO_TIPO[component.itemType] ?? "COMPOSICAO",
    itemSourceName: component.itemSourceName ?? null,
    itemDeclaredNutrient: component.itemDeclaredNutrient ?? null,
    itemFamily: component.itemFamily ?? null,
    itemPackagingSubtype: component.itemPackagingSubtype ?? null,
    itemDefaultPurityPercent: component.itemDefaultPurityPercent ?? null,
    itemExternalCode: component.itemExternalCode ?? null,
  };
}

/** A configuração de ajustes da linha — a forma que a validação compartilhada lê. */
function ajustesDaLinha(row: ComponentRow): AjustesDaQuantidade {
  return {
    quantityMode: row.quantityMode,
    purityPercentApplied: row.purityPercentApplied,
    overagePercent: row.overagePercent,
    applyPurityAdjustment: row.applyPurityAdjustment,
    applyOverageAdjustment: row.applyOverageAdjustment,
  };
}

/**
 * O CONTRATO da bancada, numa linha de matéria-prima: a pureza informada
 * participa da conta, e a reserva de produção não.
 *
 * Antes, preencher a pureza não bastava — era preciso abrir um painel, trocar
 * o modo da quantidade e marcar uma caixa. Três gestos para dizer o que a
 * planilha da Veridi diz com um número, e dois estados possíveis para a mesma
 * coluna preenchida: quem lia "70" não sabia se a conta usava 70. Agora a
 * coluna É a resposta — física por dose = alvo ÷ (pureza ÷ 100), pelo motor de
 * sempre.
 *
 * A RESERVA DE PRODUÇÃO (`overagePercent`) fica registrada e NUNCA multiplica a
 * dose: ela é percentual previsto para o lote, e a planilha real traz 10% no
 * Ácido Fólico e 2% no Beef sem que a dose formulada mude. Aplicá-la aqui
 * inflaria a dose de cada cápsula.
 *
 * Vale só na COMPOSIÇÃO: a linha de embalagem não tem pureza, e mexer no modo
 * dela seria reescrever configuração que ninguém pediu para mudar.
 */
function comAjustesDaBancada(row: ComponentRow): ComponentRow {
  if (secaoDaLinha(row) !== "COMPOSICAO") return row;
  const pureza = decimalLegivel(row.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO);
  const corrigePelaPureza = pureza !== null && Number(pureza) > 0;
  return {
    ...row,
    quantityMode: corrigePelaPureza ? "THEORETICAL_WITH_ADJUSTMENTS" : "PHYSICAL_DIRECT",
    applyPurityAdjustment: corrigePelaPureza,
    applyOverageAdjustment: false,
  };
}

/**
 * Esta linha tem pureza gravada que a conta NÃO usa?
 *
 * Só acontece em versão histórica, gravada sob o contrato antigo (pureza
 * registrada sem autorizar a correção). A tela diz isso onde acontece, porque
 * um documento fechado que mostra "70%" ao lado de um físico não corrigido
 * estaria mentindo por omissão. Num rascunho a resposta é sempre `false`: o
 * contrato de hoje não produz esse estado.
 */
function purezaRegistradaSemAplicar(row: ComponentRow): boolean {
  return row.purityPercentApplied.trim() !== "" && !ajustesAutorizados(row).purity;
}

/**
 * Validação por CAMPO e por LINHA, antes de qualquer chamada.
 *
 * `exigirDecimal` interrompia na primeira recusa com uma frase na faixa do
 * topo. Numa receita de doze linhas isso obrigava a procurar a linha — e se o
 * campo morasse no painel de ajustes fechado, nem havia pista. Cada erro agora
 * nomeia o componente E o campo, marca o próprio campo (`aria-invalid`, mensagem
 * ligada por `aria-describedby`) e a tela leva a pessoa até o primeiro deles.
 */
type CampoDoComponente = "quantity" | "unitCode" | "purityPercentApplied" | "overagePercent";

/** Ordem de leitura na linha: é a ordem em que o primeiro erro é escolhido. */
const CAMPOS_DO_COMPONENTE: readonly CampoDoComponente[] = [
  "quantity",
  "unitCode",
  "purityPercentApplied",
  "overagePercent",
];

/** Um id só por campo: o input, a mensagem e o foco falam dele pelo mesmo nome. */
function idDoCampo(rowKey: string, campo: CampoDoComponente): string {
  return `comp-${rowKey}-${campo}`;
}

function chaveDeErro(rowKey: string, campo: CampoDoComponente): string {
  return `components.${rowKey}.${campo}`;
}

/** Regras de uma linha — as mesmas que o servidor aplica, ditas antes de enviar. */
function errosDaLinha(row: ComponentRow): Partial<Record<CampoDoComponente, string>> {
  const nome = row.itemCode || row.itemName || "Componente";
  const erros: Partial<Record<CampoDoComponente, string>> = {};

  const quantidade = parsePtBrNumber(row.quantity, OPCOES_QUANTIDADE);
  if (quantidade.tipo === "vazio") {
    erros.quantity = `${nome} — Quantidade é obrigatória.`;
  } else if (quantidade.tipo === "invalido") {
    erros.quantity = `${nome} — ${numericInvalidMessage("Quantidade", quantidade.motivo, OPCOES_QUANTIDADE)}`;
  } else if (/^[0.]+$/.test(quantidade.valor)) {
    erros.quantity = `${nome} — Quantidade deve ser maior que zero.`;
  }
  if (!row.unitCode) erros.unitCode = `${nome} — Unidade é obrigatória.`;

  // Pureza e reserva: as mesmas regras do Modelo de Formulação, num lugar só —
  // só o rótulo da recusa muda, porque o campo se chama outra coisa aqui.
  return {
    ...erros,
    ...errosDosAjustes(ajustesDaLinha(row), nome, "Reserva %"),
  };
}

/** Cor do selo da origem do custo: o que falta ou exige decisão avisa; o resto informa. */
function seloDaFonte(source: IndustrialMaterialCostSource): string {
  return source === "NO_COST" || source === "AMBIGUOUS_SUPPLIER_REFERENCE"
    ? "badge badge--warn"
    : "badge badge--neutral";
}

/**
 * Prévia do físico ENQUANTO se digita.
 *
 * As colunas de equivalente e de físico vinham do servidor, então uma linha
 * nova ou recém-editada mostrava um travessão até salvar — e é justamente
 * enquanto se edita que a pessoa precisa ver o efeito do que está fazendo.
 * Descobrir o número depois de gravar é descobrir tarde.
 *
 * A conta vem de `@veridi/shared`, a MESMA função que a API chama. Recalcular
 * aqui com uma cópia da fórmula criaria um segundo motor, e duas contas para o
 * mesmo número acabam discordando — com a agravante de que a que aparece na
 * tela seria a que ninguém usa.
 *
 * Devolve `null` quando a conta não é possível (premissa ausente, unidade
 * incompatível). `null` vira travessão, nunca zero: zero seria "não precisa de
 * material".
 */
function previaDoComponente(
  row: ComponentRow,
  basisQuantity: string,
  dosesPerPackage: number | null,
  units: UnitOfMeasureDTO[],
): { teorico: string; fisico: string } | null {
  const quantidade = decimalLegivel(row.quantity, OPCOES_QUANTIDADE);
  if (quantidade === null) return null;

  const resultado = calcularQuantidadeDoComponente(
    {
      basis: row.basis,
      quantity: quantidade,
      unitCode: row.unitCode,
      stockUnitCode: row.stockUnitCode,
      purityPercent: decimalLegivel(row.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO),
      overagePercent: decimalLegivel(row.overagePercent, OPCOES_PERCENTUAL_TECNICO),
      quantityMode: row.quantityMode,
      applyPurityAdjustment: row.applyPurityAdjustment,
      applyOverageAdjustment: row.applyOverageAdjustment,
    },
    1,
    { basisQuantity: decimalLegivel(basisQuantity, OPCOES_QUANTIDADE) ?? "0", dosesPerPackage },
    units.map((u) => ({ code: u.code, dimension: u.dimension, toBaseFactor: u.toBaseFactor })),
  );

  if (typeof resultado === "string") return null;
  return { teorico: resultado.theoretical.toString(), fisico: resultado.physical.toString() };
}

/** As unidades como o motor compartilhado as consome. */
function unidadesDoMotor(units: UnitOfMeasureDTO[]) {
  return units.map((unit) => ({
    code: unit.code,
    dimension: unit.dimension,
    toBaseFactor: unit.toBaseFactor,
  }));
}

/**
 * Prévia da DOSE — alvo, física e por cápsula — enquanto se digita.
 *
 * É a mesma função que a API chama (`calcularQuantidadeDaDose`), pelo mesmo
 * motivo da prévia por embalagem: a bancada existe para mostrar o efeito da
 * pureza e das cápsulas ANTES de gravar, e um número que a API não confirmaria
 * é pior que número nenhum. `null` vira travessão — nunca zero.
 */
function previaDaDose(
  row: ComponentRow,
  capsulasPorDose: number | null,
  units: UnitOfMeasureDTO[],
): { teorica: string; fisica: string; porCapsula: string | null } | null {
  const quantidade = decimalLegivel(row.quantity, OPCOES_QUANTIDADE);
  if (quantidade === null) return null;

  const resultado = calcularQuantidadeDaDose(
    {
      basis: row.basis,
      quantity: quantidade,
      unitCode: row.unitCode,
      purityPercent: decimalLegivel(row.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO),
      overagePercent: decimalLegivel(row.overagePercent, OPCOES_PERCENTUAL_TECNICO),
      quantityMode: row.quantityMode,
      applyPurityAdjustment: row.applyPurityAdjustment,
      applyOverageAdjustment: row.applyOverageAdjustment,
    },
    capsulasPorDose,
    unidadesDoMotor(units),
  );
  if (resultado === null || typeof resultado === "string") return null;
  return {
    teorica: resultado.teorica.toFixed(),
    fisica: resultado.fisica.toFixed(),
    porCapsula: resultado.porCapsula ? resultado.porCapsula.toFixed() : null,
  };
}

/** Onde a linha aparece: o tipo real do Item manda; sem item, onde ela nasceu. */
function secaoDaLinha(row: ComponentRow): SecaoDaFormula {
  return row.itemType ? SECAO_DO_TIPO[row.itemType] : row.secao;
}

/**
 * A linha com o item escolhido — e com o que o cadastro do Item já sabe.
 *
 * Fonte, nutriente, família e pureza vêm do cadastro: redigitar o que já está
 * cadastrado é trabalho repetido e é divergência esperando acontecer. A pureza
 * entra como a APLICADA desta versão (snapshot) — mudar o cadastro depois não
 * reescreve versão nenhuma —, e ela é do ITEM: trocar o item não mantém a
 * pureza do anterior.
 *
 * A unidade mantém a que estava quando ela serve ao item novo (trocar o item
 * não pode transformar `500 mg` em `500 kg`) e só cai na unidade de estoque
 * quando a atual é de outra dimensão. Linha por dose em massa nasce em mg, que
 * é como a formulação é escrita.
 */
function comItemEscolhido(
  row: ComponentRow,
  item: ItemOption | undefined,
  units: UnitOfMeasureDTO[],
): ComponentRow {
  if (!item) {
    return {
      ...row,
      itemId: "",
      itemCode: "",
      itemName: "",
      itemActive: true,
      itemType: null,
      stockUnitCode: "",
      unitCode: "",
      itemSourceName: null,
      itemDeclaredNutrient: null,
      itemFamily: null,
      itemPackagingSubtype: null,
      itemDefaultPurityPercent: null,
      itemExternalCode: null,
    };
  }
  const dimensaoAtual = units.find((unit) => unit.code === row.unitCode)?.dimension ?? null;
  const mantemUnidade = dimensaoAtual !== null && dimensaoAtual === item.unitDimension;
  const unidadePadrao =
    item.unitDimension === "MASS" && row.basis === "PER_DOSE" && units.some((u) => u.code === "mg")
      ? "mg"
      : item.unitCode;
  const daComposicao = SECAO_DO_TIPO[item.type] === "COMPOSICAO";
  return comAjustesDaBancada({
    ...row,
    itemId: item.id,
    itemCode: item.code,
    itemName: item.name,
    itemActive: item.active,
    itemType: item.type,
    stockUnitCode: item.unitCode,
    unitCode: mantemUnidade ? row.unitCode : unidadePadrao,
    itemSourceName: item.sourceName,
    itemDeclaredNutrient: item.declaredNutrient,
    itemFamily: item.family,
    itemPackagingSubtype: item.packagingSubtype,
    itemDefaultPurityPercent: item.defaultPurityPercent,
    itemExternalCode: item.externalCode,
    purityPercentApplied: daComposicao
      ? toPtBrEditText(item.defaultPurityPercent, OPCOES_PERCENTUAL_TECNICO)
      : "",
  });
}

/**
 * A conta da dose, escrita como se lê: alvo ativo ÷ pureza.
 *
 * É a mesma aritmética da planilha da Veridi, com os números desta linha. O
 * `CalcHint` confere a explicação contra o resultado exibido, então o que
 * aparece aqui não pode ser uma versão resumida da conta.
 */
function operandosDaDose(
  row: ComponentRow,
): { valor: string; papel: string; operador?: string; numero?: number }[] {
  const alvo = decimalLegivel(row.quantity, OPCOES_QUANTIDADE);
  const operandos: { valor: string; papel: string; operador?: string; numero?: number }[] = [
    {
      valor: `${formatQuantity(alvo ?? row.quantity)} ${row.unitCode}`,
      papel: "alvo ativo por dose",
      numero: Number(alvo),
    },
  ];
  const teorico = row.quantityMode === "THEORETICAL_WITH_ADJUSTMENTS";
  if (teorico && row.applyPurityAdjustment && row.purityPercentApplied) {
    const pureza = Number(decimalLegivel(row.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO));
    if (pureza > 0) {
      operandos.push({
        valor: formatPercentPtBr(
          decimalLegivel(row.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO),
          OPCOES_PERCENTUAL_TECNICO,
        ),
        papel: "pureza",
        operador: "÷",
        numero: pureza / 100,
      });
    }
  }
  if (teorico && row.applyOverageAdjustment && row.overagePercent) {
    const overage = Number(decimalLegivel(row.overagePercent, OPCOES_PERCENTUAL_TECNICO));
    if (overage >= 0) {
      operandos.push({
        valor: `(1 + ${formatPercentPtBr(decimalLegivel(row.overagePercent, OPCOES_PERCENTUAL_TECNICO), OPCOES_PERCENTUAL_TECNICO)})`,
        papel: "reserva de produção",
        numero: 1 + overage / 100,
      });
    }
  }
  return operandos;
}

/**
 * A conta da quantidade física, escrita como se lê — e refazível à mão.
 *
 * A versão anterior listava só `quantidade × (1 + overage) ÷ pureza` e omitia
 * dois fatores que o motor aplica: a base da fórmula e a conversão de unidade.
 * Com base 300, isso mostrava `22 kg × 1,23 ÷ 0,99`, que dá 27,33, ao lado do
 * valor exibido de 0,091111 kg. O número da tela estava certo; a explicação,
 * não — e explicação errada convence mais do que explicação nenhuma.
 *
 * A ordem segue a do motor: base, unidade, pureza, reserva.
 */
function operandosDoFisico(
  row: ComponentRow,
  basisQuantity: string,
  dosesPerPackage: number | null,
  units: UnitOfMeasureDTO[],
): { valor: string; papel: string; operador?: string; numero?: number }[] {
  const teorico = row.quantityMode === "THEORETICAL_WITH_ADJUSTMENTS";
  const operandos: { valor: string; papel: string; operador?: string; numero?: number }[] = [
    {
      valor: `${formatQuantity(decimalLegivel(row.quantity, OPCOES_QUANTIDADE) ?? row.quantity)} ${row.unitCode}`,
      papel: teorico ? "quantidade teórica" : "quantidade informada",
      numero: Number(decimalLegivel(row.quantity, OPCOES_QUANTIDADE)),
    },
  ];

  if (row.basis === "FIXED_BASIS") {
    const base = decimalLegivel(basisQuantity, OPCOES_QUANTIDADE);
    if (base !== null && Number(base) !== 0) {
      operandos.push({
        valor: formatQuantity(base),
        papel: "base da fórmula",
        operador: "÷",
        numero: Number(base),
      });
    }
  } else if (row.basis === "PER_DOSE" && dosesPerPackage) {
    operandos.push({
      valor: formatIntegerPtBr(dosesPerPackage),
      papel: "doses por embalagem",
      numero: dosesPerPackage,
    });
  }

  // Conversão de unidade só entra na conta quando as duas diferem.
  const de = units.find((u) => u.code === row.unitCode);
  const para = units.find((u) => u.code === row.stockUnitCode);
  if (de && para && de.code !== para.code && Number(para.toBaseFactor) !== 0) {
    const fator = Number(de.toBaseFactor) / Number(para.toBaseFactor);
    operandos.push({
      valor: formatQuantity(String(fator)),
      papel: `${de.code} para ${para.code}`,
      numero: fator,
    });
  }

  if (teorico && row.applyPurityAdjustment && row.purityPercentApplied) {
    const pureza = Number(decimalLegivel(row.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO));
    if (pureza > 0) {
      operandos.push({
        valor: formatPercentPtBr(
          decimalLegivel(row.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO),
          OPCOES_PERCENTUAL_TECNICO,
        ),
        papel: "pureza",
        operador: "÷",
        numero: pureza / 100,
      });
    }
  }
  if (teorico && row.applyOverageAdjustment && row.overagePercent) {
    const overage = Number(decimalLegivel(row.overagePercent, OPCOES_PERCENTUAL_TECNICO));
    if (overage >= 0) {
      operandos.push({
        valor: `(1 + ${formatPercentPtBr(decimalLegivel(row.overagePercent, OPCOES_PERCENTUAL_TECNICO), OPCOES_PERCENTUAL_TECNICO)})`,
        papel: "reserva de produção",
        numero: 1 + overage / 100,
      });
    }
  }
  return operandos;
}

/**
 * Editor de versão de formulação — página própria (documento transacional),
 * não modal. DRAFT é totalmente editável; ACTIVE/INACTIVE são read-only por
 * construção (backend também bloqueia).
 */
/** ⓘ de um conceito da tela — o texto vive no registro de ajuda. */
type DicaDaBancada =
  | "formulacao.base"
  | "formulacao.modoCalculo"
  | "formulacao.fornecimento"
  | "formulacao.pureza"
  | "formulacao.overage"
  | "formulacao.equivalenteEstoque"
  | "formulacao.perdaPrevista"
  | "formulacao.rendimentoEsperado"
  | "formulacao.simulacaoDeLote"
  | "formulacao.forma"
  | "formulacao.apresentacaoComercial"
  | "formulacao.capsulasPorDose"
  | "formulacao.capsulasPorEmbalagem"
  | "formulacao.dose"
  | "formulacao.conteudo"
  | "formulacao.dosesPorEmbalagem"
  | "formulacao.loteMinimo"
  | "formulacao.caixaEmbarque"
  | "formulacao.faixaEtaria";

function Dica({ id }: { id: DicaDaBancada }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

export function FormulationVersionPage() {
  const navigate = useNavigate();
  const { productId, versionId } = useParams<{ productId: string; versionId: string }>();

  const [version, setVersion] = useState<FormulationVersionDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [basisQuantity, setBasisQuantity] = useState("");
  const [calculationMode, setCalculationMode] = useState<FormulationCalculationMode>("FIXED_BASIS");
  const [dosesPerPackage, setDosesPerPackage] = useState("");
  /* Premissas da apresentação — a bancada (FORMULATION-WORKBENCH-01). */
  const [dosageForm, setDosageForm] = useState<DosageForm | "">("");
  const [presentationType, setPresentationType] = useState<PresentationType | "">("");
  const [capsulesPerDose, setCapsulesPerDose] = useState("");
  const [capsulesPerPackage, setCapsulesPerPackage] = useState("");
  const [doseAmount, setDoseAmount] = useState("");
  const [doseUomCode, setDoseUomCode] = useState("");
  const [packageContentAmount, setPackageContentAmount] = useState("");
  const [packageContentUomCode, setPackageContentUomCode] = useState("");
  /*
   * PERDA PREVISTA DE PRODUÇÃO — premissa GLOBAL desta versão, não da linha.
   * A reserva de matéria-prima continua por componente, na coluna: uma é do
   * insumo, a outra é do processo.
   */
  const [expectedLossPercent, setExpectedLossPercent] = useState("");
  const [notes, setNotes] = useState("");
  const [components, setComponents] = useState<ComponentRow[]>([]);

  const [activeItems, setActiveItems] = useState<ItemOption[]>([]);
  const [units, setUnits] = useState<UnitOfMeasureDTO[]>([]);

  /*
   * A ação em curso pelo nome: "Salvando…" aparecia no botão de salvar
   * também durante a ativação e a criação de versão, que usam o mesmo freio
   * de clique duplo. O freio continua um só (`saving`); o rótulo, não.
   */
  const [acaoEmCurso, setAcaoEmCurso] = useState<"rascunho" | "ativar" | "nova-versao" | null>(
    null,
  );
  const saving = acaoEmCurso !== null;
  /** O que a última gravação confirmou — uma frase, substituída pela próxima. */
  const [feito, setFeito] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [activateDialogOpen, setActivateDialogOpen] = useState(false);
  const [impact, setImpact] = useState<FormulationActivationImpactDTO | null>(null);
  const { user } = useAuth();
  const [costEstimate, setCostEstimate] = useState<FormulationCostEstimateDTO | null>(null);

  /**
   * O rascunho como ele está GRAVADO, serializado.
   *
   * Comparar contra isto é o que responde "há alteração pendente?". A
   * alternativa — vasculhar o DOM ou marcar uma flag em cada `onChange` —
   * quebra no primeiro campo novo que alguém esquecer de instrumentar, e
   * quebra em silêncio, que é o modo de falha que esta correção existe para
   * eliminar.
   */
  /*
   * Linhas cuja pureza gravada passou a valer ao abrir o rascunho.
   *
   * Uma versão antiga podia guardar pureza SEM autorizar a correção. Sob o
   * contrato de hoje a coluna preenchida corrige, e um rascunho herdado desse
   * tempo muda de número ao ser aberto. A tela DIZ quais linhas mudaram, em vez
   * de deixar a diferença aparecer só na hora de salvar.
   */
  const [purezaPassouAValer, setPurezaPassouAValer] = useState<string[]>([]);

  /*
   * O campo que a próxima renderização deve focar.
   *
   * Passa por estado, e não por `getElementById` no clique, porque o campo
   * pode estar dentro de um painel FECHADO: abrir o painel e focar são duas
   * renderizações. Só acontece numa tentativa de salvar ou ativar que falhou
   * por validação — digitar nunca rola a tela.
   */
  const [focoPendente, setFocoPendente] = useState<string | null>(null);
  useEffect(() => {
    if (!focoPendente) return;
    const alvo = document.getElementById(focoPendente);
    if (alvo) {
      // jsdom não implementa `scrollIntoView`; no navegador ele existe sempre.
      alvo.scrollIntoView?.({ block: "center" });
      alvo.focus({ preventScroll: true });
    }
    setFocoPendente(null);
  }, [focoPendente]);

  const gravado = useRef<string>("");

  const syncFromServer = useCallback((dto: FormulationVersionDTO) => {
    setBasisQuantity(toPtBrEditText(dto.basisQuantity, OPCOES_QUANTIDADE));
    setCalculationMode(dto.calculationMode);
    setDosesPerPackage(dto.dosesPerPackage === null ? "" : String(dto.dosesPerPackage));
    setDosageForm(dto.dosageForm ?? "");
    setPresentationType(dto.presentationType ?? "");
    setCapsulesPerDose(dto.capsulesPerDose == null ? "" : String(dto.capsulesPerDose));
    setCapsulesPerPackage(dto.capsulesPerPackage == null ? "" : String(dto.capsulesPerPackage));
    setDoseAmount(toPtBrEditText(dto.doseAmount ?? null, OPCOES_QUANTIDADE));
    setDoseUomCode(dto.doseUomCode ?? "");
    setPackageContentAmount(toPtBrEditText(dto.packageContentAmount ?? null, OPCOES_QUANTIDADE));
    setPackageContentUomCode(dto.packageContentUomCode ?? "");
    setExpectedLossPercent(
      toPtBrEditText(dto.expectedLossPercent ?? null, OPCOES_PERCENTUAL_TECNICO),
    );
    setNotes(dto.notes ?? "");
    /*
     * O rascunho entra na tela já sob o contrato da bancada: pureza preenchida
     * corrige, reserva de produção não multiplica. Versão ATIVA ou INATIVA é
     * documento fechado e entra como está gravada — o snapshot é dela, e a tela
     * não reescreve história para ficar parecida com a regra nova.
     */
    const linhas = dto.components.map(rowFromDTO);
    const normalizadas = dto.status === "DRAFT" ? linhas.map(comAjustesDaBancada) : linhas;
    setComponents(normalizadas);
    setPurezaPassouAValer(
      normalizadas
        .filter((linha, indice) => {
          const antes = linhas[indice];
          return antes !== undefined && !ajustesAutorizados(antes).purity && ajustesAutorizados(linha).purity;
        })
        .map((linha) => linha.itemCode || linha.itemName),
    );
    gravado.current = JSON.stringify(rascunhoComparavel(rascunhoDoDTO(dto)));
  }, []);

  /**
   * O rascunho restaurado ganha do servidor — uma vez.
   *
   * Quem volta do cadastro de item chega junto com a carga da versão, e ela
   * traz a fórmula como está salva. Sem esta trava a resposta chegaria
   * depois e apagaria o que a pessoa acabou de montar. Vale só para a
   * primeira carga: depois de salvar, o servidor é a verdade.
   */
  const rascunhoRestaurado = useRef(false);

  const load = useCallback(() => {
    if (!versionId) return;
    setLoading(true);
    setNotFound(false);
    getFormulationVersion(versionId)
      .then((dto) => {
        setVersion(dto);
        if (rascunhoRestaurado.current) {
          rascunhoRestaurado.current = false;
          return;
        }
        syncFromServer(dto);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [versionId, syncFromServer]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Geração da estimativa em curso.
   *
   * Dois salvamentos seguidos disparam duas buscas, e a primeira pode voltar
   * depois da segunda — o custo na tela passaria a ser o do estado anterior,
   * que é exatamente o defeito que esta busca existe para fechar. Mesmo
   * mecanismo da busca de entidades (`SearchableEntitySelect`).
   */
  const geracaoDoCusto = useRef(0);

  /**
   * Fotografia de custo do que está GRAVADO — sempre do servidor.
   *
   * A dependência era `version?.components.length`: alterar a quantidade de um
   * componente e salvar não muda o tamanho da lista, então o efeito não
   * reexecutava e o bloco continuava mostrando o custo anterior até recarregar
   * a página (F-03-1). Quem sabe que o estado persistido mudou é quem salvou,
   * então é o salvamento que pede a estimativa nova — nada é recalculado aqui.
   */
  const carregarCustoEstimado = useCallback(() => {
    if (!versionId) return;
    const minha = (geracaoDoCusto.current += 1);
    getFormulationCostEstimate(versionId)
      .then((dto) => {
        if (minha !== geracaoDoCusto.current) return;
        setCostEstimate(dto);
      })
      .catch(() => {
        if (minha !== geracaoDoCusto.current) return;
        setCostEstimate(null);
      });
  }, [versionId]);

  useEffect(() => {
    carregarCustoEstimado();
  }, [carregarCustoEstimado]);

  useEffect(() => {
    Promise.all([
      listItems({ type: "RAW_MATERIAL", active: true, pageSize: PRIMEIRA_PAGINA }),
      listItems({ type: "PACKAGING", active: true, pageSize: PRIMEIRA_PAGINA }),
    ])
      .then(([raw, packaging]) =>
        setActiveItems([...raw.items, ...packaging.items].map(itemOption)),
      )
      .catch(() => setActiveItems([]));
    listUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  /**
   * Busca no servidor, com os MESMOS filtros de negócio da carga inicial:
   * só matéria-prima e embalagem, só ativos, e fora o que outra linha já
   * consome — as duas primeiras no servidor, a terceira aqui, exatamente
   * como `optionsForRow` já faz com a primeira página. Componente encontrado
   * é componente que já era elegível; nada passa a ser escolhível por causa
   * da busca.
   */
  async function buscarItens(row: ComponentRow, termo: string): Promise<EntityOption[]> {
    // A seção decide o TIPO: na composição só matéria-prima, na embalagem só
    // material de embalagem. É a mesma separação que a tabela mostra.
    const tipo: ItemType = secaoDaLinha(row) === "EMBALAGEM" ? "PACKAGING" : "RAW_MATERIAL";
    const resposta = await listItems({
      type: tipo,
      active: true,
      search: termo,
      pageSize: PRIMEIRA_PAGINA,
    });
    const encontrados = resposta.items.map(itemOption);
    /*
     * O achado entra no catálogo da tela porque a escolha é resolvida por
     * ele: `handleComponentItemChange` lê código, nome e unidade de estoque
     * de `activeItems`, e `unitOptionsForRow` limita as unidades pela
     * dimensão do item. Sem a mesclagem, escolher um item de fora da
     * primeira página deixaria a linha sem unidade.
     */
    setActiveItems((atual) => {
      const conhecidos = new Set(atual.map((item) => item.id));
      const ineditos = encontrados.filter((item) => !conhecidos.has(item.id));
      return ineditos.length === 0 ? atual : [...atual, ...ineditos];
    });
    const usadosPorOutrasLinhas = new Set(
      components.filter((c) => c.key !== row.key).map((c) => c.itemId),
    );
    return encontrados.filter((item) => !usadosPorOutrasLinhas.has(item.id)).map(opcaoDoItem);
  }

  /**
   * Cadastro de item na TELA OFICIAL, sem perder a fórmula.
   *
   * A coluna Item vive em linha de tabela: o contexto carrega QUAL linha
   * pediu, porque sem isso o item criado voltaria para a primeira.
   */
  const origem = useContextualCreateOrigin<RascunhoVersao>({
    collectDraft: () => ({
      basisQuantity,
      calculationMode,
      dosesPerPackage,
      dosageForm,
      presentationType,
      capsulesPerDose,
      capsulesPerPackage,
      doseAmount,
      doseUomCode,
      packageContentAmount,
      packageContentUomCode,
      notes,
      components,
    }),
    restoreDraft: (draft) => {
      // Antes de qualquer `setState`: a carga da versão está a caminho.
      rascunhoRestaurado.current = true;
      setBasisQuantity(draft.basisQuantity ?? "");
      setCalculationMode(draft.calculationMode ?? "FIXED_BASIS");
      setDosesPerPackage(draft.dosesPerPackage ?? "");
      setDosageForm(draft.dosageForm ?? "");
      setPresentationType(draft.presentationType ?? "");
      setCapsulesPerDose(draft.capsulesPerDose ?? "");
      setCapsulesPerPackage(draft.capsulesPerPackage ?? "");
      setDoseAmount(draft.doseAmount ?? "");
      setDoseUomCode(draft.doseUomCode ?? "");
      setPackageContentAmount(draft.packageContentAmount ?? "");
      setPackageContentUomCode(draft.packageContentUomCode ?? "");
      setNotes(draft.notes ?? "");
      const linhas = Array.isArray(draft.components) ? draft.components : [];
      absorverChaves(linhas);
      setComponents(linhas);
    },
    onCreated: (result, record) => {
      const chave = lerChaveDaLinha(record.context);
      if (!chave) return;
      // Pelo id, imediatamente — o rótulo só ocupa a coluna até o item real
      // chegar logo abaixo.
      setComponents((prev) =>
        prev.map((row) =>
          row.key === chave ? { ...row, itemId: result.entityId, itemName: result.label } : row,
        ),
      );
      /*
       * A linha precisa da unidade de estoque, e o resultado da criação
       * traz só id e rótulo. Buscar o item pelo id é o que completa a linha
       * — e o que põe a opção no seletor antes de o catálogo recarregar.
       * Falha aqui não desfaz a seleção: o id já está na linha.
       */
      void getItem(result.entityId)
        .then((item) => {
          const opcao = itemOption(item);
          setActiveItems((prev) => [opcao, ...prev.filter((row) => row.id !== item.id)]);
          setComponents((prev) =>
            prev.map((row) => (row.key === chave ? comItemEscolhido(row, opcao, units) : row)),
          );
        })
        .catch(() => undefined);
    },
  });

  const isDraft = version?.status === "DRAFT";

  /*
   * Doses por embalagem: quem exige é a base do COMPONENTE.
   *
   * O modo da versão continua importando para o default de linha nova, mas
   * não pode ser o critério de exibição — foi assim que o campo sumiu numa
   * fórmula que precisava dele.
   */
  const dosesObrigatorias =
    calculationMode === "PER_DOSE" || components.some((row) => row.basis === "PER_DOSE");

  /*
   * As premissas da apresentação como estão nos campos — e o que elas fecham.
   *
   * Na cápsula e no pó, doses por embalagem é RESULTADO (cápsulas por embalagem
   * ÷ cápsulas por dose; conteúdo ÷ dose), e a tela MOSTRA o número em vez de
   * pedi-lo de novo: dois campos para a mesma premissa divergem no primeiro que
   * alguém esquecer de atualizar. Divisão que não fecha vira recusa no campo,
   * nunca doses arredondadas.
   */
  const leituraDasCapsulasPorDose = lerInteiroOpcional(capsulesPerDose);
  const leituraDasCapsulasPorEmbalagem = lerInteiroOpcional(capsulesPerPackage);
  const capsulasPorDose =
    dosageForm === "CAPSULE" && leituraDasCapsulasPorDose.tipo === "valido"
      ? leituraDasCapsulasPorDose.valor
      : null;
  const premissasDaTela = {
    dosageForm: dosageForm === "" ? null : dosageForm,
    capsulesPerDose: capsulasPorDose,
    capsulesPerPackage:
      leituraDasCapsulasPorEmbalagem.tipo === "valido" ? leituraDasCapsulasPorEmbalagem.valor : null,
    doseAmount: decimalLegivel(doseAmount, OPCOES_QUANTIDADE),
    doseUomCode: doseUomCode || null,
    packageContentAmount: decimalLegivel(packageContentAmount, OPCOES_QUANTIDADE),
    packageContentUomCode: packageContentUomCode || null,
  };
  const derivaDoses = formaDerivaDoses(premissasDaTela.dosageForm);
  const dosesDerivadas = derivaDoses
    ? dosesPorEmbalagemDaApresentacao(premissasDaTela, unidadesDoMotor(units))
    : null;
  const recusaDaApresentacao: ApresentacaoBlock | null =
    typeof dosesDerivadas === "string" ? dosesDerivadas : null;
  /* Leitura estrita, a mesma da gravação — nunca `Number()` (FORMULATION-DOSES-INPUT-01). */
  const leituraDasDoses = lerInteiroOpcional(dosesPerPackage);
  const dosesPorEmbalagem = derivaDoses
    ? typeof dosesDerivadas === "number"
      ? dosesDerivadas
      : null
    : leituraDasDoses.tipo === "valido"
      ? leituraDasDoses.valor
      : null;
  const dosesInformadas = dosesPorEmbalagem !== null && dosesPorEmbalagem > 0;
  const mostrarDoses = !derivaDoses && (dosesObrigatorias || dosesPerPackage.trim() !== "");
  /* Cápsula e pó calculam por dose: é o que a linha nova assume. */
  const receitaPorDose = calculationMode === "PER_DOSE" || derivaDoses;
  /* Dose e conteúdo do pó são massa: o seletor só oferece unidade de massa. */
  const unidadesDeMassa = units.filter((unit) => unit.dimension === "MASS");

  /*
   * O perfil industrial do PRODUTO, dito quando difere do que esta versão diz.
   *
   * Serve para conferir sem sair da tela e deixa explícito que a versão tem as
   * SUAS premissas: mudar o cadastro do produto não reescreve formulação
   * nenhuma — nem esta, nem as históricas.
   */
  const perfil = version?.productProfile ?? null;
  const perfilDivergente =
    perfil !== null &&
    ((perfil.dosageForm ?? null) !== (dosageForm === "" ? null : dosageForm) ||
      (perfil.presentationType ?? null) !== (presentationType === "" ? null : presentationType) ||
      (perfil.capsulesPerDose ?? null) !== capsulasPorDose ||
      (perfil.dosesPerPackage ?? null) !== dosesPorEmbalagem);
  const perfilDoProduto =
    perfil && perfilDivergente
      ? [
          perfil.dosageForm ? DOSAGE_FORM_LABELS[perfil.dosageForm] : null,
          perfil.presentationType ? PRESENTATION_TYPE_LABELS[perfil.presentationType] : null,
          perfil.capsulesPerDose
            ? `${formatIntegerPtBr(perfil.capsulesPerDose)} cápsula(s) por dose`
            : null,
          perfil.dosesPerPackage
            ? `${formatIntegerPtBr(perfil.dosesPerPackage)} dose(s) por embalagem`
            : null,
        ]
          .filter((parte): parte is string => Boolean(parte))
          .join(" · ")
      : "";

  /*
   * O campo de doses tem duas mensagens de erro independentes e elas podem
   * aparecer juntas — a descrição soma os dois ids em vez de escolher um.
   */
  const dosesErrorIds = [
    ...(dosesObrigatorias && !dosesInformadas ? ["version-doses-required-error"] : []),
    ...(fieldErrors["dosesPerPackage"] ? ["version-dosesPerPackage-error"] : []),
  ];

  function optionsForRow(row: ComponentRow): ItemOption[] {
    const secao = secaoDaLinha(row);
    const usedByOtherRows = new Set(components.filter((c) => c.key !== row.key).map((c) => c.itemId));
    const base = activeItems.filter(
      (item) => !usedByOtherRows.has(item.id) && SECAO_DO_TIPO[item.type] === secao,
    );
    if (row.itemId && !base.some((item) => item.id === row.itemId)) {
      return [
        ...base,
        {
          id: row.itemId,
          code: row.itemCode,
          name: row.itemName,
          type: row.itemType ?? "RAW_MATERIAL",
          unitCode: row.stockUnitCode,
          unitDimension: "",
          active: row.itemActive,
          sourceName: row.itemSourceName,
          declaredNutrient: row.itemDeclaredNutrient,
          family: row.itemFamily,
          packagingSubtype: row.itemPackagingSubtype,
          defaultPurityPercent: row.itemDefaultPurityPercent,
          externalCode: row.itemExternalCode,
        },
      ];
    }
    return base;
  }

  /**
   * As unidades compatíveis com o Item da linha.
   *
   * A dimensão vem do catálogo quando o Item está na página carregada e, senão,
   * da UNIDADE DE ESTOQUE que a própria linha guarda. A versão anterior caía em
   * "todas as unidades" quando o Item não estava na página — e o catálogo abre
   * com 50 de 1.211 —, então uma linha de pote gravada meses atrás oferecia `kg`
   * e `mL`. O servidor recusaria (`IncompatibleComponentUnitError`), mas só
   * depois de a pessoa escolher e salvar: oferecer o que não é aceito é mandar
   * errar.
   */
  function unitOptionsForRow(row: ComponentRow): UnitOfMeasureDTO[] {
    const selected = activeItems.find((item) => item.id === row.itemId);
    const dimensao =
      selected?.unitDimension ??
      units.find((unit) => unit.code === row.stockUnitCode)?.dimension ??
      null;
    if (dimensao === null) return units;
    return unidadesDaDimensao(units, dimensao);
  }

  /**
   * Linha nova, na seção em que a pessoa clicou.
   *
   * MATÉRIA-PRIMA nasce como a bancada pergunta: a quantidade digitada é o ALVO
   * ATIVO por dose, e a pureza do cadastro corrige a quantidade física
   * (FORMULATION-WORKBENCH-01). A correção fica visível na coluna Pureza e no
   * resumo dos ajustes — é escolha declarada da linha, não regra escondida, e
   * o modo continua trocável no painel.
   *
   * EMBALAGEM nasce por unidade acabada e com quantidade FÍSICA informada:
   * pureza não se aplica a um pote.
   */
  function handleAddComponent(secao: SecaoDaFormula) {
    const daComposicao = secao === "COMPOSICAO";
    setComponents((prev) => [
      ...prev,
      {
        key: nextRowKey(),
        itemId: "",
        itemCode: "",
        itemName: "",
        itemActive: true,
        stockUnitCode: "",
        quantity: "",
        unitCode: "",
        basis: daComposicao
          ? receitaPorDose
            ? "PER_DOSE"
            : "FIXED_BASIS"
          : "PER_FINISHED_UNIT",
        // Default do domínio: a Veridi fornece, salvo declaração explícita.
        supplyResponsibility: "VERIDI",
        purityPercentApplied: "",
        overagePercent: "",
        quantityMode: daComposicao ? "THEORETICAL_WITH_ADJUSTMENTS" : "PHYSICAL_DIRECT",
        applyPurityAdjustment: daComposicao,
        applyOverageAdjustment: false,
        notes: "",
        // Linha em branco não tem grandeza calculada: `null` vira travessão,
        // e a prévia assume assim que houver item e quantidade.
        theoreticalPerUnit: null,
        physicalPerUnit: null,
        theoreticalPerDose: null,
        physicalPerDose: null,
        physicalPerCapsule: null,
        itemType: null,
        secao,
        itemSourceName: null,
        itemDeclaredNutrient: null,
        itemFamily: null,
        itemPackagingSubtype: null,
        itemDefaultPurityPercent: null,
        itemExternalCode: null,
      },
    ]);
  }

  function handleRemoveComponent(key: string) {
    setComponents((prev) => prev.filter((row) => row.key !== key));
  }

  function handleComponentBasisChange(key: string, basis: FormulationComponentBasis) {
    setComponents((prev) => prev.map((row) => (row.key === key ? { ...row, basis } : row)));
  }

  function handleComponentSupplyChange(key: string, supplyResponsibility: SupplyResponsibility) {
    setComponents((prev) =>
      prev.map((row) => (row.key === key ? { ...row, supplyResponsibility } : row)),
    );
  }

  function handleComponentItemChange(key: string, itemId: string) {
    const item = activeItems.find((option) => option.id === itemId);
    setComponents((prev) =>
      prev.map((row) => (row.key === key ? comItemEscolhido(row, item, units) : row)),
    );
  }

  /**
   * Campo da linha, já sob o contrato da bancada.
   *
   * Digitar na coluna Pureza é o gesto INTEIRO: não há mais painel para abrir,
   * modo para trocar nem caixa para marcar. `comAjustesDaBancada` é idempotente
   * e vale para qualquer campo, então nenhum caminho de edição escapa dele —
   * era essa a brecha por onde a configuração ficava fora do que a coluna diz.
   */
  function handleComponentFieldChange<K extends keyof ComponentRow>(
    key: string,
    field: K,
    value: ComponentRow[K],
  ) {
    setComponents((prev) =>
      prev.map((row) => (row.key === key ? comAjustesDaBancada({ ...row, [field]: value }) : row)),
    );
  }

  /**
   * A conta do físico por embalagem, ao lado do número que ela produz.
   *
   * Vivia dentro do painel de ajustes; com o painel fora, ela vai para a
   * própria célula do "Por embalagem". Explicação longe do resultado obriga a
   * pessoa a confiar no número em vez de conferi-lo.
   */
  function explicacaoDoFisico(linha: ComponentRow, fisico: string | null) {
    if (fisico === null) return null;
    return (
      <CalcHint
        label="Quantidade física"
        operandos={operandosDoFisico(linha, basisQuantity, dosesPorEmbalagem, units)}
        resultado={`${formatQuantity(fisico)} ${linha.stockUnitCode}`}
        nota={
          ajustesAutorizados(linha).purity
            ? "Calculado pelo mesmo motor que a Ordem de Produção e o CMV usam — a pureza corrige a quantidade física."
            : purezaRegistradaSemAplicar(linha)
              ? "Quantidade física informada. A pureza gravada nesta versão ficou como registro, sem corrigir."
              : "Quantidade física informada."
        }
      />
    );
  }

  function temAlteracaoPendente() {
    // Rascunho com campo ilegível não serializa — e é alteração pendente por
    // definição: o que está na tela não é o que está gravado.
    try {
      return JSON.stringify(rascunhoComparavel(montarRascunho())) !== gravado.current;
    } catch {
      return true;
    }
  }

  /**
   * O rascunho como o servidor o receberia AGORA.
   *
   * Uma função só, usada por salvar e por ativar: se cada caminho montasse o
   * seu, um deles ficaria para trás no dia em que um campo fosse acrescentado
   * — e o que fica para trás é justamente o que some sem avisar.
   */
  function montarRascunho() {
    return {
      basisQuantity: exigirDecimal(basisQuantity, "Base da formulação", OPCOES_QUANTIDADE),
      calculationMode,
      /*
       * Doses por embalagem: DERIVADO na cápsula e no pó, digitado nas demais
       * formas. Um número só chega ao servidor, e ele é o mesmo que a tela
       * mostra — inteiro, por leitura estrita, nunca `Number()`.
       */
      dosesPerPackage: derivaDoses
        ? dosesPorEmbalagem === null
          ? null
          : String(dosesPorEmbalagem)
        : dosesParaEnvio(dosesPerPackage),
      // Cada forma manda só as premissas que usa; as outras vão nulas, para não
      // ficar dado invisível que volta a valer quando alguém trocar a forma.
      dosageForm: dosageForm === "" ? null : dosageForm,
      presentationType: presentationType === "" ? null : presentationType,
      capsulesPerDose:
        dosageForm === "CAPSULE" ? inteiroParaEnvio(capsulesPerDose, "Cápsulas por dose") : null,
      capsulesPerPackage:
        dosageForm === "CAPSULE"
          ? inteiroParaEnvio(capsulesPerPackage, "Cápsulas por embalagem")
          : null,
      doseAmount:
        dosageForm === "POWDER" ? exigirDecimalOpcional(doseAmount, "Dose", OPCOES_QUANTIDADE) : null,
      doseUomCode: dosageForm === "POWDER" ? doseUomCode || null : null,
      packageContentAmount:
        dosageForm === "POWDER"
          ? exigirDecimalOpcional(packageContentAmount, "Conteúdo da embalagem", OPCOES_QUANTIDADE)
          : null,
      packageContentUomCode: dosageForm === "POWDER" ? packageContentUomCode || null : null,
      /*
       * PERDA PREVISTA: vai para a VERSÃO em qualquer forma — é premissa do
       * processo produtivo, não da apresentação. Vazio é `null`, e `null`
       * significa não informada, nunca 0%.
       */
      expectedLossPercent: exigirDecimalOpcional(
        expectedLossPercent,
        "Perda prevista de produção",
        OPCOES_PERCENTUAL_TECNICO,
      ),
      notes: notes.trim(),
      components: components
        .filter((row) => row.itemId)
        .map((row) => {
          /*
           * O erro diz QUAL componente, não só qual campo.
           *
           * "Pureza %: informe um valor numérico válido" numa receita de doze
           * linhas manda a pessoa conferir doze linhas — e se a linha estiver
           * com o painel fechado, não há nem pista de onde procurar. O código
           * do item é o que ela usa para achar a linha.
           */
          const doItem = (campo: string) =>
            row.itemCode ? `${campo} de ${row.itemCode}` : campo;
          return {
          itemId: row.itemId,
          quantity: exigirDecimal(row.quantity, doItem("Quantidade"), OPCOES_QUANTIDADE),
          unitCode: row.unitCode,
          basis: row.basis,
          supplyResponsibility: row.supplyResponsibility,
          // Campo vazio = fator DESCONHECIDO (null), nunca 100%/0% implícito.
          purityPercentApplied: exigirDecimalOpcional(
            row.purityPercentApplied,
            doItem("Pureza %"),
            OPCOES_PERCENTUAL_TECNICO,
          ),
          overagePercent: exigirDecimalOpcional(
            row.overagePercent,
            doItem("Overage %"),
            OPCOES_PERCENTUAL_TECNICO,
          ),
          /*
           * O modo VIAJA no payload, senão o seletor da linha é decorativo.
           *
           * Sem estes três campos o servidor recebia a versão sem o modo e
           * reaplicava o padrão: um componente marcado como teórico voltava a
           * `PHYSICAL_DIRECT` ao salvar qualquer outra edição, e a necessidade
           * física caía pelo fator de pureza sem ninguém ter pedido. É a
           * mudança silenciosa de receita que esta capability existe para
           * impedir, entrando pela porta dos fundos.
           */
          quantityMode: row.quantityMode,
          applyPurityAdjustment: row.applyPurityAdjustment,
          applyOverageAdjustment: row.applyOverageAdjustment,
          ...(row.notes.trim() ? { notes: row.notes.trim() } : {}),
          };
        }),
    };
  }

  /**
   * Todos os erros de uma vez, por campo — nunca só o primeiro.
   *
   * Quem corrige um e tenta de novo precisa ir ao PRÓXIMO, não redescobrir
   * a lista. Linha sem item não entra no payload, então também não é
   * validada aqui — é o comportamento de sempre.
   */
  function validarRascunho(): Record<string, string> {
    const erros: Record<string, string> = {};
    // A base só precisa ser legível para GRAVAR: base zero é recusada na
    // ativação, pelo servidor, com a mensagem dele no campo. Aqui se espelha
    // o que o servidor recusaria ao salvar — não se inventa regra nova.
    const base = parsePtBrNumber(basisQuantity, OPCOES_QUANTIDADE);
    if (base.tipo === "vazio") erros["basisQuantity"] = "Base da formulação é obrigatória.";
    else if (base.tipo === "invalido") {
      erros["basisQuantity"] = numericInvalidMessage("Base da formulação", base.motivo, OPCOES_QUANTIDADE);
    }
    // Doses ilegíveis não vão ao servidor como texto cru — nem viram zero.
    if (lerInteiroOpcional(dosesPerPackage).tipo === "invalido") {
      erros["dosesPerPackage"] = MENSAGEM_DOSES_INVALIDAS;
    }

    if (dosageForm === "CAPSULE") {
      if (lerInteiroOpcional(capsulesPerDose).tipo === "invalido") {
        erros["capsulesPerDose"] = "Cápsulas por dose: informe um número inteiro maior que zero.";
      }
      if (lerInteiroOpcional(capsulesPerPackage).tipo === "invalido") {
        erros["capsulesPerPackage"] =
          "Cápsulas por embalagem: informe um número inteiro maior que zero.";
      }
    }
    if (dosageForm === "POWDER") {
      const dose = parsePtBrNumber(doseAmount, OPCOES_QUANTIDADE);
      if (dose.tipo === "invalido") {
        erros["doseAmount"] = numericInvalidMessage("Dose", dose.motivo, OPCOES_QUANTIDADE);
      }
      const conteudo = parsePtBrNumber(packageContentAmount, OPCOES_QUANTIDADE);
      if (conteudo.tipo === "invalido") {
        erros["packageContentAmount"] = numericInvalidMessage(
          "Conteúdo da embalagem",
          conteudo.motivo,
          OPCOES_QUANTIDADE,
        );
      }
    }
    // A MESMA recusa que o servidor daria, dita antes de enviar e no campo dela.
    if (recusaDaApresentacao) {
      erros[campoDaRecusaNaTela(recusaDaApresentacao)] =
        MENSAGENS_DA_APRESENTACAO[recusaDaApresentacao];
    }

    for (const row of components) {
      if (!row.itemId) continue;
      const daLinha = errosDaLinha(row);
      for (const campo of CAMPOS_DO_COMPONENTE) {
        const mensagem = daLinha[campo];
        if (mensagem) erros[chaveDeErro(row.key, campo)] = mensagem;
      }
    }
    return erros;
  }

  /**
   * Recusa do servidor, campo a campo.
   *
   * O caminho da API vem por índice (`components.2.quantity`) e o índice conta
   * só as linhas que foram no payload — as com item. Traduzido para a chave
   * da linha, o erro cai no mesmo campo que a validação local marcaria.
   */
  function errosDaApi(issues: { path: string; message: string }[]): Record<string, string> {
    const enviadas = components.filter((row) => row.itemId);
    const erros: Record<string, string> = {};
    for (const issue of issues) {
      const componente = /^components\.(\d+)\.(\w+)$/.exec(issue.path);
      const linha = componente ? enviadas[Number(componente[1])] : undefined;
      const campo = componente?.[2] as CampoDoComponente | undefined;
      if (linha && campo && CAMPOS_DO_COMPONENTE.includes(campo)) {
        const nome = linha.itemCode || linha.itemName || "Componente";
        erros[chaveDeErro(linha.key, campo)] = `${nome} — ${issue.message}`;
      } else {
        erros[issue.path] = issue.message;
      }
    }
    return erros;
  }

  /**
   * Foco e rolagem até o PRIMEIRO erro, na ordem de leitura da tela.
   *
   * Se o campo mora no painel de ajustes e o painel está fechado, o painel
   * abre antes — levar a pessoa a uma linha onde o erro continua escondido
   * não é levar a lugar nenhum. Só roda depois de uma tentativa de ação.
   */
  function levarAoPrimeiroErro(erros: Record<string, string>) {
    if (erros["basisQuantity"]) {
      setFocoPendente("version-basis");
      return;
    }
    if (erros["dosesPerPackage"]) {
      setFocoPendente("version-doses");
      return;
    }
    for (const campo of [
      "capsulesPerDose",
      "capsulesPerPackage",
      "doseAmount",
      "doseUomCode",
      "packageContentAmount",
    ] as const) {
      if (erros[campo]) {
        setFocoPendente(`version-${campo}`);
        return;
      }
    }
    for (const row of components) {
      for (const campo of CAMPOS_DO_COMPONENTE) {
        if (!erros[chaveDeErro(row.key, campo)]) continue;
        // Todo campo da linha vive numa coluna visível: não há mais painel para
        // abrir antes de levar o foco até ele.
        setFocoPendente(idDoCampo(row.key, campo));
        return;
      }
    }
  }

  /**
   * Grava o rascunho e devolve se deu certo.
   *
   * O booleano existe por causa da ativação: ela precisa saber se pode
   * seguir, e `try/catch` do lado de fora não distingue "salvou" de "falhou
   * e já mostrei o erro".
   */
  async function salvarRascunho(): Promise<boolean> {
    if (!versionId) return false;
    setError(null);
    setFieldErrors({});

    const erros = validarRascunho();
    if (Object.keys(erros).length > 0) {
      setFieldErrors(erros);
      setError("Corrija os campos destacados.");
      levarAoPrimeiroErro(erros);
      return false;
    }

    try {
      const updated = await updateFormulationVersion(versionId, montarRascunho());
      setVersion(updated);
      syncFromServer(updated);
      // O estado persistido mudou: a estimativa exibida passa a ser a dele.
      carregarCustoEstimado();
      return true;
    } catch (err) {
      if (err instanceof ApiValidationError) {
        const nextFieldErrors = errosDaApi(err.issues);
        setFieldErrors(nextFieldErrors);
        setError("Corrija os campos destacados.");
        levarAoPrimeiroErro(nextFieldErrors);
      } else {
        setError(err instanceof Error ? err.message : "Falha ao salvar rascunho");
      }
      return false;
    }
  }

  async function handleSaveDraft() {
    if (!versionId || saving) return;
    setFeito(null);
    setAcaoEmCurso("rascunho");
    try {
      // Só com a gravação confirmada: validação ou falha de rede nunca
      // viram "salvo".
      if (await salvarRascunho()) setFeito("Rascunho salvo.");
    } finally {
      setAcaoEmCurso(null);
    }
  }

  /**
   * O raio de impacto é buscado ao ABRIR o diálogo, não a cada render: a
   * pergunta só existe no momento em que ainda dá para cancelar.
   */
  async function abrirDialogoDeAtivacao() {
    if (!versionId) return;
    setFeito(null);
    setActivateDialogOpen(true);
    setImpact(null);
    try {
      setImpact(await getFormulationActivationImpact(versionId));
    } catch {
      // Sem o impacto o diálogo continua valendo pelo texto que já tinha —
      // uma falha de leitura não pode impedir a ativação.
      setImpact(null);
    }
  }

  /**
   * Ativar grava o que está na tela ANTES de ativar.
   *
   * Antes, `activate` era chamado direto: quem editava e clicava em Ativar
   * sem passar por "Salvar rascunho" ativava a versão SEM a alteração, em
   * silêncio — e versão ativa é documento histórico, então o estrago não se
   * conserta, só se substitui por uma versão nova.
   *
   * A gravação é condição da ativação, nunca um efeito colateral dela: se o
   * salvamento falhar por validação, por item inválido ou por rede, a
   * ativação NÃO acontece e a versão continua em rascunho, com o erro na
   * tela. Ativação parcial seria pior que o defeito original.
   *
   * Sem alteração pendente nada é gravado — ativar continua uma chamada só.
   */
  async function handleActivate() {
    if (!versionId || saving) return;
    setActivateDialogOpen(false);
    setAcaoEmCurso("ativar");
    setError(null);
    setFeito(null);
    try {
      if (temAlteracaoPendente()) {
        const salvou = await salvarRascunho();
        if (!salvou) return;
      }
      const updated = await activateFormulationVersion(versionId);
      setVersion(updated);
      syncFromServer(updated);
      carregarCustoEstimado();
      setFeito("Versão ativada.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao ativar formulação");
    } finally {
      setAcaoEmCurso(null);
    }
  }

  async function handleCreateNewVersion() {
    if (!versionId) return;
    setAcaoEmCurso("nova-versao");
    setError(null);
    setFeito(null);
    try {
      const created = await createNewFormulationVersion(versionId);
      navigate(`/producao/formulacoes/${productId}/versoes/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar nova versão");
    } finally {
      setAcaoEmCurso(null);
    }
  }

  /*
   * O que a guarda de saída considera perdível nesta tela.
   *
   * São as duas pendências que a própria tela já conhece: o rascunho diferente
   * do gravado e o painel de ajustes configurado sem "Aplicar ajustes" — a
   * mesma dupla que prende salvar e ativar. Uma terceira comparação aqui
   * divergiria das outras no primeiro campo novo.
   *
   * A trava do carregamento não é detalhe: `gravado.current` começa vazio, e
   * até a primeira leitura chegar QUALQUER serialização difere dele. A página
   * recém-aberta, sem ninguém ter digitado nada, se declararia alterada e
   * perguntaria antes de deixar sair.
   */
  /**
   * Os números por dose da linha: prévia no rascunho, servidor na versão
   * gravada — a mesma regra das colunas por embalagem.
   */
  function valoresDaDose(
    row: ComponentRow,
  ): { teorica: string; fisica: string; porCapsula: string | null } | null {
    const previa = isDraft ? previaDaDose(row, capsulasPorDose, units) : null;
    if (previa) return previa;
    if (row.theoreticalPerDose === null || row.physicalPerDose === null) return null;
    return {
      teorica: row.theoreticalPerDose,
      fisica: row.physicalPerDose,
      porCapsula: row.physicalPerCapsule,
    };
  }

  /* As duas seções da bancada, pelo tipo real do Item. */
  const linhasDaComposicao = components.filter((row) => secaoDaLinha(row) === "COMPOSICAO");
  const linhasDaEmbalagem = components.filter((row) => secaoDaLinha(row) === "EMBALAGEM");
  const mostrarPorCapsula = dosageForm === "CAPSULE";
  /*
   * As formas que o seletor oferece: pó e cápsula, o que a Veridi produz.
   *
   * Uma versão gravada com outra forma — comprimido, líquido, "outro" —
   * continua na lista ENQUANTO for a dela: tirar a opção de um valor que está
   * gravado faria o seletor cair no traço e apagar a premissa da versão no
   * primeiro salvamento. Restringir a escolha nova nunca é licença para
   * reescrever o que já foi escolhido.
   */
  const formasOferecidas = FORMAS_DA_BANCADA.includes(dosageForm as DosageForm)
    ? FORMAS_DA_BANCADA
    : dosageForm === ""
      ? FORMAS_DA_BANCADA
      : [...FORMAS_DA_BANCADA, dosageForm as DosageForm];
  /*
   * As apresentações COERENTES com a forma escolhida — pelo mesmo princípio da
   * lista de formas: a apresentação já gravada continua oferecida mesmo fora da
   * lista, para que uma versão histórica não perca a premissa no primeiro
   * salvamento. Forma em branco oferece tudo.
   */
  const apresentacoesOferecidas = apresentacoesDaForma(
    dosageForm === "" ? null : dosageForm,
    presentationType === "" ? null : presentationType,
    PRESENTATION_TYPES,
  );
  const capsulasNaEmbalagem = capsulasPorEmbalagem(capsulasPorDose, dosesPorEmbalagem);

  /*
   * A reserva de produção de referência da receita.
   *
   * Ela mora na LINHA — é lá que a planilha a escreve —, e o topo só a repete
   * quando a receita inteira concorda: 10% em todas as linhas do Ácido Fólico,
   * 2% em todas as do Beef. Com linhas divergentes o resumo cala, porque um
   * número único ali seria a média de coisa nenhuma.
   */
  const reservasDaComposicao = linhasDaComposicao
    .filter((row) => row.itemId)
    .map((row) => decimalDaApiComparavel(decimalLegivel(row.overagePercent, OPCOES_PERCENTUAL_TECNICO)));
  const reservaDeReferencia =
    reservasDaComposicao.length > 0 &&
    reservasDaComposicao[0] !== null &&
    reservasDaComposicao.every((reserva) => reserva === reservasDaComposicao[0])
      ? reservasDaComposicao[0]
      : null;

  /*
   * O resumo de premissas do topo, por FORMA.
   *
   * Cápsula e pó respondem perguntas diferentes, e a tela não deve mostrar
   * cápsulas por dose num pote de pó nem dose em gramas num produto em
   * cápsula: esses campos já aparecem acima, cada um na sua forma. O que entra
   * aqui é o que vale nas duas e não é editável na Formulação — e só quando o
   * domínio TEM o dado. Linha ausente é melhor que linha com traço inventado.
   */
  const premissasDeReferencia: { rotulo: string; valor: string; dica?: DicaDaBancada }[] = [];
  if (perfil?.targetAgeGroup) {
    premissasDeReferencia.push({
      rotulo: "Faixa etária",
      valor: TARGET_AGE_GROUP_LABELS[perfil.targetAgeGroup],
      dica: "formulacao.faixaEtaria",
    });
  }
  if (reservaDeReferencia !== null) {
    premissasDeReferencia.push({
      rotulo: "Reserva",
      valor: `${formatPercentPtBr(reservaDeReferencia, OPCOES_PERCENTUAL_TECNICO)} em todas as matérias-primas`,
      dica: "formulacao.overage",
    });
  }
  if (perfil?.minimumBatchQuantity) {
    premissasDeReferencia.push({
      rotulo: "Lote mínimo",
      valor: `${formatQuantity(perfil.minimumBatchQuantity)} ${version?.outputUnitCode ?? ""}`.trim(),
      dica: "formulacao.loteMinimo",
    });
  }
  if (perfil?.unitsPerShippingBox) {
    premissasDeReferencia.push({
      rotulo: "Caixa de embarque",
      valor: `${formatIntegerPtBr(perfil.unitsPerShippingBox)} por caixa`,
      dica: "formulacao.caixaEmbarque",
    });
  }

  /*
   * RENDIMENTO ESPERADO — 100% menos a perda prevista, calculado enquanto se
   * digita e pela MESMA função que a API usa. Nunca editável: dois campos para
   * a mesma premissa divergem no primeiro que alguém esquecer de atualizar.
   */
  const perdaDigitada = decimalLegivel(expectedLossPercent, OPCOES_PERCENTUAL_TECNICO);
  const rendimento = rendimentoEsperado(perdaDigitada);
  const rendimentoExibido =
    rendimento === null || typeof rendimento === "string" ? null : rendimento.toString();

  /*
   * SIMULAÇÃO DE LOTE — quanto entra para sair 1.000.
   *
   * Rendimento é percentual, e percentual não responde a pergunta que quem
   * planeja faz: "para entregar mil, produzo quanto?". Com 4% de perda a
   * resposta é 1.042, não 1.040 — a conta é 1.000 ÷ 0,96, pelo mesmo helper
   * canônico do custo, e não 1.000 × 1,04.
   *
   * O arredondamento é PARA CIMA, e só em unidade contável: 1.041 unidades
   * produzidas entregam 999,36 vendáveis, ou seja, não entregam o lote. Em
   * unidade contínua (um acabado a granel, em kg) o número sai como é.
   */
  const unidadeDaSaida = units.find((unit) => unit.code === version?.outputUnitCode);
  const brutaDaSimulacao = quantidadeBrutaPlanejada(LOTE_DA_SIMULACAO, perdaDigitada);
  const simulacaoExibida =
    perdaDigitada === null || typeof brutaDaSimulacao === "string"
      ? null
      : unidadeDaSaida?.dimension === "COUNT"
        ? brutaDaSimulacao.ceil().toFixed()
        : brutaDaSimulacao.toFixed();

  /*
   * A BASE decide material nesta versão?
   *
   * Só quando alguma linha é declarada por base fixa — é ela que divide por
   * `basisQuantity`. Quem decide isso é a FÓRMULA, não o modo da versão: o
   * dado real tem versão em modo "Base fixa" com todas as linhas por dose, e
   * ali a base não multiplica nada. Ela continua sendo a quantidade sobre a
   * qual o custo estimado é apresentado, e é assim que aparece.
   *
   * O valor continua indo ao servidor exatamente como antes — o contrato não
   * mudou, só o peso visual de um campo que não era decisão de ninguém.
   */
  const baseMultiplicaMaterial =
    components.length === 0 ||
    components.some((row) => row.basis === "FIXED_BASIS") ||
    /*
       Base diferente de 1 é número que alguém escolheu — continua à vista e
       editável mesmo sem linha por base fixa. Campo que some levando o número
       junto esconde a premissa em vez de simplificar a tela.

       A pergunta é feita sobre o valor GRAVADO, nunca sobre o texto que está
       sendo digitado: apagar o campo para redigitar o faria desaparecer no
       meio da digitação, levando junto o foco e o que já tinha sido escrito.
    */
    decimalDaApiComparavel(version?.basisQuantity ?? null) !== "1";

  /** Totais técnicos da dose, somados em mg pelo mesmo motor das linhas. */
  const resumoDaDose = resumirDoses(
    linhasDaComposicao
      .filter((row) => row.basis === "PER_DOSE")
      .map((row) => {
        const valores = valoresDaDose(row);
        return valores
          ? { teorica: valores.teorica, fisica: valores.fisica, unitCode: row.unitCode }
          : null;
      })
      .filter(
        (linha): linha is { teorica: string; fisica: string; unitCode: string } => linha !== null,
      ),
    capsulasPorDose,
    unidadesDoMotor(units),
  );

  function linhaDaTabela(row: ComponentRow, secao: SecaoDaFormula) {
    const daComposicao = secao === "COMPOSICAO";
    /*
      O físico ENQUANTO se digita, não só depois de salvar. A prévia usa a mesma
      função que a API chama; quando a conta não é possível, cai no valor
      gravado, e `null` vira travessão — nunca zero.
    */
    const previa = isDraft ? previaDoComponente(row, basisQuantity, dosesPorEmbalagem, units) : null;
    const fisicoExibido = previa?.fisico ?? row.physicalPerUnit;
    const equivalenteExibido = previa?.teorico ?? row.theoreticalPerUnit;
    const dose = valoresDaDose(row);
    const nomeDoItem = row.itemCode || "componente";
    /** Base canônica da seção — o que `handleAddComponent` já escolhe sozinho. */
    const baseDaSecao: FormulationComponentBasis = daComposicao
      ? receitaPorDose
        ? "PER_DOSE"
        : "FIXED_BASIS"
      : "PER_FINISHED_UNIT";
    const baseEditavelNaLinha = baseMultiplicaMaterial || row.basis !== baseDaSecao;
    /*
      Uma unidade compatível só: o Item decide, e não há o que perguntar. Vale
      apenas com Item escolhido — linha em branco ainda não tem cadastro que
      responda, e ali o seletor continua sendo a pergunta certa.
    */
    const unidadesDaLinha = unitOptionsForRow(row);
    const unidadeUnica = row.itemId !== "" && unidadesDaLinha.length === 1 && row.unitCode !== "";
    const erroDe = (campo: CampoDoComponente) => fieldErrors[chaveDeErro(row.key, campo)];
    const marcaDeErro = (campo: CampoDoComponente) =>
      erroDe(campo)
        ? {
            "aria-invalid": true as const,
            "aria-describedby": `${idDoCampo(row.key, campo)}-error`,
          }
        : {};
    const mensagemDeErro = (campo: CampoDoComponente) =>
      erroDe(campo) ? (
        <p className="field__error" id={`${idDoCampo(row.key, campo)}-error`}>
          {erroDe(campo)}
        </p>
      ) : null;
    /* Pureza do cadastro de HOJE ao lado da aplicada, quando as duas divergem:
       é o que explica uma versão histórica não bater com o item de agora. */
    const purezaDaLinha = decimalLegivel(row.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO);
    const cadastroDiferente =
      row.itemDefaultPurityPercent !== null &&
      decimalDaApiComparavel(row.itemDefaultPurityPercent) !== decimalDaApiComparavel(purezaDaLinha);

    return (
      <tr
        key={row.key}
        className={CAMPOS_DO_COMPONENTE.some((campo) => erroDe(campo)) ? "is-invalid" : undefined}
      >
        <td className="col-item">
          {isDraft ? (
            <SearchableEntitySelect
              id={`componente-${row.key}`}
              value={row.itemId}
              onChange={(itemId) => handleComponentItemChange(row.key, itemId)}
              placeholder={
                daComposicao
                  ? "Buscar matéria-prima por código ou nome…"
                  : "Buscar embalagem por código ou nome…"
              }
              options={optionsForRow(row).map(opcaoDoItem)}
              onSearch={(termo) => buscarItens(row, termo)}
              canCreate
              createLabel="Novo item de estoque"
              /* Sair para cadastrar o item NÃO é descartar: o rascunho vai
                 junto e volta aplicado na linha. */
              onCreateNew={() =>
                liberarGuarda(() =>
                  origem.goCreate({
                    route: "/cadastros/itens/novo",
                    fieldKey: "itemId",
                    entityType: "item",
                    context: { rowKey: row.key },
                  }),
                )
              }
            />
          ) : (
            <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
          )}
          {/*
            O CÓDIGO LEGADO ao lado da unidade de estoque, e só quando existe.
            Quem confere a receita contra a planilha antiga procura por ele, e
            sair para o cadastro do Item a cada linha era o que essa conferência
            custava. Item sem legado não ganha rótulo vazio nem travessão: a
            linha simplesmente não o menciona.
          */}
          <span className="cell-sub">
            {row.stockUnitCode ? `Estoque em ${row.stockUnitCode}` : "Estoque: —"}
            {row.itemExternalCode ? ` · Código legado: ${row.itemExternalCode}` : ""}
            {row.itemPackagingSubtype
              ? ` · ${PACKAGING_SUBTYPE_LABELS[row.itemPackagingSubtype]}`
              : ""}
            {!row.itemActive && " · item inativo, mantido pelo histórico"}
          </span>
        </td>

        {daComposicao && (
          <td className="col-fonte" data-label="Fonte / Função">
            {row.itemSourceName ?? "—"}
            {(row.itemFamily || row.itemDeclaredNutrient) && (
              <span className="cell-sub">
                {[
                  row.itemFamily ? ITEM_FAMILY_LABELS[row.itemFamily] : null,
                  row.itemDeclaredNutrient,
                ]
                  .filter((parte): parte is string => Boolean(parte))
                  .join(" · ")}
              </span>
            )}
          </td>
        )}

        {daComposicao && (
          <td className="col-pureza is-numeric" data-label="Pureza (%)">
            {isDraft ? (
              <>
                <PercentField
                  id={idDoCampo(row.key, "purityPercentApplied")}
                  scale={CASAS_PERCENTUAL_TECNICO}
                  aria-label={`Pureza de ${nomeDoItem}`}
                  placeholder="—"
                  /* A seta para onde a validação pararia: pureza é 0 < x ≤ 100. */
                  stepper={{ min: "0", max: "100" }}
                  value={row.purityPercentApplied}
                  onChangeValue={(valor) =>
                    handleComponentFieldChange(row.key, "purityPercentApplied", valor)
                  }
                  {...marcaDeErro("purityPercentApplied")}
                />
                {mensagemDeErro("purityPercentApplied")}
              </>
            ) : (
              <span>
                {row.purityPercentApplied
                  ? formatPercentPtBr(purezaDaLinha, OPCOES_PERCENTUAL_TECNICO)
                  : "—"}
              </span>
            )}
            {/*
              A referência do cadastro de HOJE, discreta, só quando diverge do
              que esta versão usa: é o que explica uma versão histórica não
              bater com o Item de agora, sem transformar a coluna num debate.
            */}
            {cadastroDiferente && (
              <span className="cell-sub">
                Cadastro:{" "}
                {formatPercentPtBr(row.itemDefaultPurityPercent, OPCOES_PERCENTUAL_TECNICO)}
              </span>
            )}
            {/* Versão gravada sob o contrato antigo: a pureza está ali e não
                corrigiu nada. Calar seria deixar a coluna mentir. */}
            {purezaRegistradaSemAplicar(row) && (
              <span className="cell-sub">registrada, não aplicada</span>
            )}
          </td>
        )}

        <td
          className="col-quantidade is-numeric"
          data-label={daComposicao ? "Alvo por dose" : "Quantidade"}
        >
          {isDraft ? (
            <>
              <div
                className={
                  unidadeUnica
                    ? "quantidade-unidade quantidade-unidade--fixa"
                    : "quantidade-unidade"
                }
              >
                <DecimalField
                  id={idDoCampo(row.key, "quantity")}
                  scale={CASAS_QUANTIDADE}
                  placeholder="0"
                  aria-label={`Quantidade de ${nomeDoItem}`}
                  value={row.quantity}
                  onChangeValue={(valor) =>
                    handleComponentFieldChange(row.key, "quantity", valor)
                  }
                  {...marcaDeErro("quantity")}
                />
                {/*
                  ESCOLHER ENTRE UMA OPÇÃO NÃO É ESCOLHA.
                  A unidade da linha só vira campo quando o cadastro oferece
                  mais de uma unidade compatível com o Item. Embalagem é o caso
                  claro: a dimensão do pote é contagem, e `un` é a única unidade
                  cadastrada nela — o seletor gastava a largura da coluna para
                  repetir o que o cadastro já diz, e o número, que é o que se
                  digita ali, ficava espremido ao lado dele. A unidade continua
                  viajando no payload; ela passa a ser lida do Item em vez de
                  redigitada. Matéria-prima em massa segue com o seletor: mg, g
                  e kg são três escolhas reais.
                */}
                {unidadeUnica ? (
                  <span className="quantidade-unidade__unidade">{row.unitCode}</span>
                ) : (
                  <select
                    id={idDoCampo(row.key, "unitCode")}
                    aria-label={`Unidade de ${nomeDoItem}`}
                    value={row.unitCode}
                    onChange={(event) =>
                      handleComponentFieldChange(row.key, "unitCode", event.target.value)
                    }
                    {...marcaDeErro("unitCode")}
                  >
                    <option value="">—</option>
                    {unidadesDaLinha.map((unit) => (
                      <option key={unit.code} value={unit.code}>
                        {unit.code}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {mensagemDeErro("quantity")}
              {mensagemDeErro("unitCode")}
            </>
          ) : (
            `${formatQuantity(decimalLegivel(row.quantity, OPCOES_QUANTIDADE) ?? row.quantity)} ${row.unitCode}`
          )}
        </td>

        {daComposicao && (
          <td className="col-dose is-numeric" data-label="Física por dose">
            <span className="estoque-valor__numero estoque-valor--dose">
              {formatQuantityWithUnit(dose?.fisica ?? null, row.unitCode)}
            </span>
            {dose && (
              <CalcHint
                label="Física por dose"
                operandos={operandosDaDose(row)}
                resultado={`${formatQuantity(dose.fisica)} ${row.unitCode}`}
                nota="Mesmo motor da Ordem de Produção e do CMV — a pureza corrige a quantidade física do ingrediente."
              />
            )}
          </td>
        )}

        {daComposicao && mostrarPorCapsula && (
          <td className="col-capsula is-numeric" data-label="Por cápsula">
            <span className="estoque-valor__numero estoque-valor--capsula">
              {formatQuantityWithUnit(dose?.porCapsula ?? null, row.unitCode)}
            </span>
          </td>
        )}

        {/*
          BASE e FORNECIMENTO dividem a célula, mas não têm o mesmo peso.

          A base de cada linha já é decidida pela seção e pelo modo: matéria-prima
          numa fórmula por dose nasce por dose, embalagem nasce por unidade
          acabada, e a seção vem do TIPO do Item, que a linha não escolhe. Um
          seletor repetindo essa escolha em cada linha ocupava a largura de uma
          coluna inteira para oferecer uma decisão que ninguém toma. Ele volta a
          ser seletor quando a base multiplica material de verdade (alguma linha
          por base fixa) ou quando ESTA linha já tem base fora do padrão da seção
          — linha herdada de cópia antiga continua corrigível. Fora disso a base
          fica como texto de apoio: a capacidade do domínio continua inteira, o
          que saiu foi o peso visual.
        */}
        <td
          className="col-regras"
          data-label={baseEditavelNaLinha ? "Base · Fornecimento" : "Fornecimento"}
        >
          {isDraft ? (
            <div className="col-regras__campos">
              {baseEditavelNaLinha && (
                <select
                  aria-label="Base de cálculo do componente"
                  value={row.basis}
                  onChange={(event) =>
                    handleComponentBasisChange(
                      row.key,
                      event.target.value as FormulationComponentBasis,
                    )
                  }
                >
                  {FORMULATION_COMPONENT_BASES.map((basis) => (
                    <option key={basis} value={basis}>
                      {FORMULATION_COMPONENT_BASIS_LABELS[basis]}
                    </option>
                  ))}
                </select>
              )}
              <select
                aria-label="Responsabilidade de fornecimento"
                value={row.supplyResponsibility}
                onChange={(event) =>
                  handleComponentSupplyChange(
                    row.key,
                    event.target.value as SupplyResponsibility,
                  )
                }
              >
                {SUPPLY_RESPONSIBILITIES.map((responsibility) => (
                  <option key={responsibility} value={responsibility}>
                    {SUPPLY_RESPONSIBILITY_LABELS[responsibility]}
                  </option>
                ))}
              </select>
              {!baseEditavelNaLinha && (
                <span className="cell-sub">
                  {FORMULATION_COMPONENT_BASIS_LABELS[row.basis]}
                </span>
              )}
            </div>
          ) : (
            <>
              {SUPPLY_RESPONSIBILITY_LABELS[row.supplyResponsibility]}
              <span className="cell-sub">
                {FORMULATION_COMPONENT_BASIS_LABELS[row.basis]}
              </span>
            </>
          )}
        </td>

        {/*
          RESERVA DE PRODUÇÃO — coluna, como a pureza, e pelo mesmo motivo: o
          número da planilha (10% no Ácido Fólico, 2% no Beef) tem de estar
          à vista e editável na linha. Ela NÃO entra na dose: o campo ao lado
          continua igual depois de digitar aqui.
        */}
        {daComposicao && (
          <td className="col-reserva is-numeric" data-label="Reserva %">
            {isDraft ? (
              <>
                <PercentField
                  id={idDoCampo(row.key, "overagePercent")}
                  scale={CASAS_PERCENTUAL_TECNICO}
                  aria-label={`Reserva % de ${nomeDoItem}`}
                  placeholder="—"
                  /* Sem teto: o domínio nunca declarou um para a reserva. */
                  stepper={{ min: "0" }}
                  value={row.overagePercent}
                  onChangeValue={(valor) =>
                    handleComponentFieldChange(row.key, "overagePercent", valor)
                  }
                  {...marcaDeErro("overagePercent")}
                />
                {mensagemDeErro("overagePercent")}
              </>
            ) : (
              <span>
                {row.overagePercent
                  ? formatPercentPtBr(
                      decimalLegivel(row.overagePercent, OPCOES_PERCENTUAL_TECNICO),
                      OPCOES_PERCENTUAL_TECNICO,
                    )
                  : "—"}
              </span>
            )}
          </td>
        )}

        <td className="col-fisico is-numeric" data-label="Por embalagem">
          <span className="estoque-valor__numero estoque-valor--fisico">
            {formatQuantityWithUnit(fisicoExibido, row.stockUnitCode)}
          </span>
          <span className="cell-sub">
            equivalente{" "}
            <span className="estoque-valor__numero estoque-valor--equivalente">
              {formatQuantityWithUnit(equivalenteExibido, row.stockUnitCode)}
            </span>
          </span>
          {explicacaoDoFisico(row, fisicoExibido)}
        </td>

        {isDraft && (
          <td className="col-acoes">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              aria-label="Remover componente"
              onClick={() => handleRemoveComponent(row.key)}
            >
              ✕
            </button>
          </td>
        )}
      </tr>
    );
  }

  /**
   * Quantas colunas a tabela da seção tem — só a linha de vazio precisa saber.
   *
   * Composição: ingrediente, fonte, pureza, alvo, física por dose, base,
   * reserva e por embalagem — mais "por cápsula" quando a forma é cápsula.
   * Embalagem: item, quantidade, base, por embalagem. A coluna de ações só
   * existe no rascunho.
   */
  function colunasDaSecao(daComposicao: boolean): number {
    const fixas = daComposicao ? 8 + (mostrarPorCapsula ? 1 : 0) : 4;
    return fixas + (isDraft ? 1 : 0);
  }

  function tabelaDaSecao(secao: SecaoDaFormula) {
    const daComposicao = secao === "COMPOSICAO";
    const linhas = daComposicao ? linhasDaComposicao : linhasDaEmbalagem;
    return (
      <FormSection
        title={daComposicao ? "Composição — matérias-primas" : "Embalagem"}
        subtitle={
          daComposicao
            ? "Busque por código ou nome — digitar procura no catálogo inteiro. A quantidade é o alvo ATIVO por dose."
            : "Itens do tipo Material de embalagem, pela classificação do cadastro. A quantidade é por embalagem acabada: 120 cápsulas, 1 pote, 1 tampa."
        }
      >
        <div className="table-container">
          {/*
            A largura de cada coluna é DECLARADA no CSS, e a declaração depende
            de três coisas que só a tela sabe: qual seção é, se a forma tem
            coluna "Por cápsula" e se a linha tem a coluna de ações. São as três
            variantes da proporção — no pó, os 96px da coluna que não existe vão
            para o Ingrediente, e fora do rascunho a sobra elástica é maior.
          */}
          <table
            className={[
              "table",
              "table--sticky-actions",
              "table--formulacao",
              daComposicao ? "table--formulacao-composicao" : "table--formulacao-embalagem",
              daComposicao && mostrarPorCapsula ? "table--com-capsula" : "",
              isDraft ? "" : "table--sem-acoes",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <thead>
              <tr>
                <th className="col-item">{daComposicao ? "Ingrediente" : "Item"}</th>
                {daComposicao && <th className="col-fonte">Fonte / Função</th>}
                {daComposicao && (
                  <th className="col-pureza is-numeric">
                    Pureza (%) <Dica id="formulacao.pureza" />
                  </th>
                )}
                <th className="col-quantidade is-numeric">
                  {/* A unidade tem controle próprio na segunda linha da célula;
                      repeti-la no cabeçalho gastava três linhas de altura. */}
                  {daComposicao ? "Alvo por dose" : "Quantidade"}
                </th>
                {daComposicao && <th className="col-dose is-numeric">Física por dose</th>}
                {daComposicao && mostrarPorCapsula && (
                  <th className="col-capsula is-numeric">Por cápsula</th>
                )}
                <th className="col-regras">
                  {baseMultiplicaMaterial ? "Base · Fornecimento" : "Fornecimento"}{" "}
                  <Dica id="formulacao.fornecimento" />
                </th>
                {daComposicao && (
                  <th className="col-reserva is-numeric">
                    Reserva % <Dica id="formulacao.overage" />
                  </th>
                )}
                <th className="col-fisico is-numeric">
                  Por embalagem <Dica id="formulacao.equivalenteEstoque" />
                </th>
                {isDraft && <th className="col-acoes" aria-hidden="true" />}
              </tr>
            </thead>
            <tbody>
              {linhas.map((row) => linhaDaTabela(row, secao))}
              {linhas.length === 0 && (
                <TableEmptyRow colSpan={colunasDaSecao(daComposicao)}>
                  {daComposicao
                    ? "Nenhuma matéria-prima adicionada."
                    : "Nenhum item de embalagem adicionado."}
                </TableEmptyRow>
              )}
            </tbody>
          </table>
        </div>

        {isDraft && (
          <div className="line-actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => handleAddComponent(secao)}
            >
              {daComposicao ? "+ Adicionar matéria-prima" : "+ Adicionar embalagem"}
            </button>
          </div>
        )}
      </FormSection>
    );
  }

  const carregada = !loading && version !== null;
  const { liberarGuarda } = useUnsavedChangesGuard({
    isDirty: carregada && temAlteracaoPendente(),
    substantivo: "formulação",
    genero: "a",
  });

  if (loading) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Formulação</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (notFound || !version) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Versão não encontrada</h1>
          <Link
            className="btn btn--ghost"
            to={`/producao/formulacoes/${productId ?? ""}`}
          >
            ← Voltar
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="doc-header">
        <div>
          <PageBreadcrumbs items={[{ label: "Formulações", href: "/producao/formulacoes" }, { label: version.productName }]} />
          <div className="doc-title">
            <h1>Formulação {version.versionLabel}</h1>
            <span className={statusBadgeClass(version.status)}>
              {FORMULATION_VERSION_STATUS_LABELS[version.status]}
            </span>
          </div>
        </div>
        <div className="table__actions">
          <ProjectOriginLink productId={productId} />
          <Link
            className="btn btn--ghost"
            to={`/producao/formulacoes/${productId}`}
          >
            ← Voltar
          </Link>
        </div>
      </div>

      <ProductRelatedLinks productId={productId} current="formulation" />

      <div className="doc-body">
        {error && <p className="form-alert" role="alert">{error}</p>}

        {/* Mesma explicação do detalhe do produto, disponível também aqui:
            quem chega direto na versão (link de OP, de custo ou de orçamento)
            nunca passou pela outra tela. */}
        <ContextHelp topic={helpTopics["formulacao.comoFunciona"]} />

        {/* Uma versão copiada de outra criada meses antes pode trazer item
            inativado, item que virou produto acabado ou unidade que deixou de
            ser compatível. A cópia é fiel de propósito — alterar a receita em
            silêncio seria inventar fórmula — então o que vai barrar a ativação
            é dito aqui, e não só no clique final. */}
        {version && version.componentIssues.length > 0 && (
          <div className="pendency-panel">
            <h4 className="pendency-panel__title">
              {version.componentIssues.length === 1
                ? "1 componente impede ativar esta versão"
                : `${version.componentIssues.length} componentes impedem ativar esta versão`}
            </h4>
            <p className="pendency-panel__sub">
              A receita foi copiada como estava. O cadastro mudou desde então — ajuste o item ou
              troque o componente antes de ativar.
            </p>
            <ul className="pendency-panel__list">
              {version.componentIssues.map((issue) => (
                <li key={`${issue.code}-${issue.itemId}`}>
                  <span>{issue.description}</span>{" "}
                  <Link to={entityHref("item", issue.itemId)}>
                    Abrir o item
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Origem no template e o que mudou nela desde então. */}
        <FormulationTemplateOrigin
          version={version}
          canEdit={user?.role === "ADMIN" || user?.role === "PRODUCTION"}
          onChanged={load}
        />

        <FormSection
          title="Produto e apresentação"
          subtitle={
            isDraft
              ? "Enquanto rascunho, tudo pode ser alterado livremente."
              : "Versão ativa/inativa é somente leitura — para alterar, crie uma nova versão."
          }
        >
          <dl className="definition-list">
            <dt>Produto</dt>
            <dd>
              <EntityLink
                kind="product"
                id={version.productId}
                code={version.productCode}
                name={version.productName}
              />
            </dd>
            <dt>Item de saída</dt>
            <dd>
              <EntityLink
                kind="item"
                id={version.outputItemId}
                code={version.outputItemCode}
                name={version.outputItemName}
              />
            </dd>
          </dl>

          {/*
            AS PREMISSAS LADO A LADO, e não uma embaixo da outra.
            Empilhadas, cada campo ocupava 220px numa tela de 1900 e o resumo da
            apresentação — que é o que a pessoa confere de relance — virava uma
            coluna de rolagem com o texto de apoio entre um campo e o seguinte.
            A grade acomoda quantas colunas couberem e cai para uma só em tela
            estreita.
          */}
          <div className="form-premissas">
          {/*
            FORMA e APRESENTAÇÃO são coisas diferentes: a forma é cápsula ou pó
            — o que a bancada calcula por dose —, e a apresentação é a embalagem
            comercial. Misturar as duas num campo só ("pote/cápsula") produz um
            vocabulário que não descreve nem produto nem embalagem.
          */}
          <div className="field field--narrow">
            <label htmlFor="version-dosageForm">
              Forma do produto <Dica id="formulacao.forma" />
            </label>
            {isDraft ? (
              <select
                id="version-dosageForm"
                value={dosageForm}
                onChange={(event) => setDosageForm(event.target.value as DosageForm | "")}
              >
                <option value="">—</option>
                {formasOferecidas.map((forma) => (
                  <option key={forma} value={forma}>
                    {DOSAGE_FORM_LABELS[forma]}
                  </option>
                ))}
              </select>
            ) : (
              <p className="field-readonly-value">
                {dosageForm ? DOSAGE_FORM_LABELS[dosageForm] : "—"}
              </p>
            )}
          </div>

          <div className="field field--narrow">
            <label htmlFor="version-presentationType">
              Apresentação comercial <Dica id="formulacao.apresentacaoComercial" />
            </label>
            {isDraft ? (
              <select
                id="version-presentationType"
                value={presentationType}
                onChange={(event) =>
                  setPresentationType(event.target.value as PresentationType | "")
                }
              >
                <option value="">—</option>
                {apresentacoesOferecidas.map((tipo) => (
                  <option key={tipo} value={tipo}>
                    {PRESENTATION_TYPE_LABELS[tipo]}
                  </option>
                ))}
              </select>
            ) : (
              <p className="field-readonly-value">
                {presentationType ? PRESENTATION_TYPE_LABELS[presentationType] : "—"}
              </p>
            )}
          </div>

          {dosageForm === "CAPSULE" && (
            <>
              <div className="field field--narrow">
                <label htmlFor="version-capsulesPerDose">
                  Cápsulas por dose <Dica id="formulacao.capsulasPorDose" />
                </label>
                {isDraft ? (
                  <IntegerField
                    id="version-capsulesPerDose"
                    value={capsulesPerDose}
                    onChangeValue={setCapsulesPerDose}
                    {...(fieldErrors["capsulesPerDose"]
                      ? {
                          "aria-invalid": true as const,
                          "aria-describedby": "version-capsulesPerDose-error",
                        }
                      : {})}
                  />
                ) : (
                  <p className="field-readonly-value">
                    {capsulesPerDose ? formatIntegerPtBr(Number(capsulesPerDose)) : "—"}
                  </p>
                )}
                {fieldErrors["capsulesPerDose"] && (
                  <p className="field__error" id="version-capsulesPerDose-error">
                    {fieldErrors["capsulesPerDose"]}
                  </p>
                )}
              </div>

              <div className="field field--narrow">
                <label htmlFor="version-capsulesPerPackage">
                  Cápsulas por embalagem <Dica id="formulacao.capsulasPorEmbalagem" />
                </label>
                {isDraft ? (
                  <IntegerField
                    id="version-capsulesPerPackage"
                    value={capsulesPerPackage}
                    onChangeValue={setCapsulesPerPackage}
                    {...(fieldErrors["capsulesPerPackage"]
                      ? {
                          "aria-invalid": true as const,
                          "aria-describedby": "version-capsulesPerPackage-error",
                        }
                      : {})}
                  />
                ) : (
                  <p className="field-readonly-value">
                    {capsulesPerPackage ? formatIntegerPtBr(Number(capsulesPerPackage)) : "—"}
                  </p>
                )}
                {fieldErrors["capsulesPerPackage"] && (
                  <p className="field__error" id="version-capsulesPerPackage-error">
                    {fieldErrors["capsulesPerPackage"]}
                  </p>
                )}
              </div>
            </>
          )}

          {dosageForm === "POWDER" && (
            <>
              <div className="field field--narrow">
                <label htmlFor="version-doseAmount">
                  Dose <Dica id="formulacao.dose" />
                </label>
                {isDraft ? (
                  <div className="quantidade-unidade">
                    <DecimalField
                      id="version-doseAmount"
                      scale={CASAS_QUANTIDADE}
                      placeholder="0"
                      value={doseAmount}
                      onChangeValue={setDoseAmount}
                      {...(fieldErrors["doseAmount"]
                        ? {
                            "aria-invalid": true as const,
                            "aria-describedby": "version-doseAmount-error",
                          }
                        : {})}
                    />
                    <select
                      id="version-doseUomCode"
                      aria-label="Unidade da dose"
                      value={doseUomCode}
                      onChange={(event) => setDoseUomCode(event.target.value)}
                    >
                      <option value="">—</option>
                      {unidadesDeMassa.map((unit) => (
                        <option key={unit.code} value={unit.code}>
                          {unit.code}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <p className="field-readonly-value">
                    {doseAmount ? `${doseAmount} ${doseUomCode}` : "—"}
                  </p>
                )}
                {fieldErrors["doseAmount"] && (
                  <p className="field__error" id="version-doseAmount-error">
                    {fieldErrors["doseAmount"]}
                  </p>
                )}
                {fieldErrors["doseUomCode"] && (
                  <p className="field__error" id="version-doseUomCode-error">
                    {fieldErrors["doseUomCode"]}
                  </p>
                )}
              </div>

              <div className="field field--narrow">
                <label htmlFor="version-packageContentAmount">
                  Conteúdo da embalagem <Dica id="formulacao.conteudo" />
                </label>
                {isDraft ? (
                  <div className="quantidade-unidade">
                    <DecimalField
                      id="version-packageContentAmount"
                      scale={CASAS_QUANTIDADE}
                      placeholder="0"
                      value={packageContentAmount}
                      onChangeValue={setPackageContentAmount}
                      {...(fieldErrors["packageContentAmount"]
                        ? {
                            "aria-invalid": true as const,
                            "aria-describedby": "version-packageContentAmount-error",
                          }
                        : {})}
                    />
                    <select
                      id="version-packageContentUomCode"
                      aria-label="Unidade do conteúdo da embalagem"
                      value={packageContentUomCode}
                      onChange={(event) => setPackageContentUomCode(event.target.value)}
                    >
                      <option value="">—</option>
                      {unidadesDeMassa.map((unit) => (
                        <option key={unit.code} value={unit.code}>
                          {unit.code}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <p className="field-readonly-value">
                    {packageContentAmount
                      ? `${packageContentAmount} ${packageContentUomCode}`
                      : "—"}
                  </p>
                )}
                {fieldErrors["packageContentAmount"] && (
                  <p className="field__error" id="version-packageContentAmount-error">
                    {fieldErrors["packageContentAmount"]}
                  </p>
                )}
              </div>
            </>
          )}

          {derivaDoses && (
            <div className="field field--narrow field--calculado">
              <span className="field__label-static">
                Doses por embalagem <Dica id="formulacao.dosesPorEmbalagem" />
              </span>
              <p className="field-readonly-value field-readonly-value--calculado" data-testid="doses-derivadas">
                {dosesPorEmbalagem === null ? "—" : formatIntegerPtBr(dosesPorEmbalagem)}
              </p>
            </div>
          )}

          <div className="field field--narrow">
            <label htmlFor="version-basis">
              Base da formulação ({version.outputUnitCode})
              {baseMultiplicaMaterial && <span className="req"> *</span>}{" "}
              <Dica id="formulacao.base" />
            </label>
            {isDraft && baseMultiplicaMaterial ? (
              <DecimalField
                id="version-basis"
                scale={CASAS_QUANTIDADE}
                value={basisQuantity}
                onChangeValue={setBasisQuantity}
                /* Liga campo, `aria-invalid` e a mensagem, para leitor de tela também. */
                {...(fieldErrors["basisQuantity"]
                  ? {
                      "aria-invalid": true as const,
                      "aria-describedby": "version-basisQuantity-error",
                    }
                  : {})}
              />
            ) : (
              /*
                Sem linha por base fixa a base não multiplica material nenhum:
                aparece como REFERÊNCIA, não como decisão. O valor continua
                gravado e continua viajando no payload — o que saiu foi o campo,
                não o contrato.
              */
              <p className="field-readonly-value field-readonly-value--calculado">
                {formatQuantity(decimalLegivel(basisQuantity, OPCOES_QUANTIDADE) ?? version.basisQuantity)}{" "}
                {version.outputUnitCode}
              </p>
            )}
            {fieldErrors["basisQuantity"] && (
              <p className="field__error" id="version-basisQuantity-error">
                {fieldErrors["basisQuantity"]}
              </p>
            )}
          </div>

          <div className="field field--narrow">
            <label htmlFor="version-mode">
              Modo de cálculo <Dica id="formulacao.modoCalculo" />
            </label>
            {isDraft ? (
              <select
                id="version-mode"
                value={calculationMode}
                onChange={(event) =>
                  setCalculationMode(event.target.value as FormulationCalculationMode)
                }
              >
                {FORMULATION_CALCULATION_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {FORMULATION_CALCULATION_MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
            ) : (
              <p className="field-readonly-value">
                {FORMULATION_CALCULATION_MODE_LABELS[version.calculationMode]}
              </p>
            )}
          </div>

          {/*
              Quem decide se o campo aparece é a fórmula, não o modo.
              A auditoria VAL-LEG-01 tinha modo "Base fixa" com quatro
              componentes por dose: o campo ficava escondido, as doses
              ficavam nulas e todo material saía zerado. Um valor já
              gravado também mantém o campo à vista — campo que some
              levando o número junto é pior que campo a mais.
          */}
          {mostrarDoses && (
            <div className="field field--narrow">
              <label htmlFor="version-doses">
                Doses por embalagem {dosesObrigatorias && <span className="req">*</span>}{" "}
                <Dica id="formulacao.dosesPorEmbalagem" />
              </label>
              {isDraft ? (
                <IntegerField
                  id="version-doses"
                  value={dosesPerPackage}
                  onChangeValue={setDosesPerPackage}
                  /* Liga campo, `aria-invalid` e as mensagens, para leitor de tela também. */
                  {...(dosesErrorIds.length > 0
                    ? {
                        "aria-invalid": true as const,
                        "aria-describedby": dosesErrorIds.join(" "),
                      }
                    : {})}
                />
              ) : (
                <p className="field-readonly-value">{formatIntegerPtBr(version.dosesPerPackage)}</p>
              )}
              {dosesObrigatorias && !dosesInformadas && (
                <p className="field__error" id="version-doses-required-error">
                  Há componentes calculados por dose. Sem este número a formulação não pode ser
                  ativada — e a quantidade de material não existe.
                </p>
              )}
              {fieldErrors["dosesPerPackage"] && (
                <p className="field__error" id="version-dosesPerPackage-error">
                  {fieldErrors["dosesPerPackage"]}
                </p>
              )}
            </div>
          )}
          </div>

          {/*
            PREMISSAS DE PRODUÇÃO — a perda prevista e o rendimento que sai dela.
            Bloco próprio, e não mais um campo no meio da apresentação: a
            apresentação descreve o que se vende, esta linha descreve o processo.
            Compacta de propósito — é uma premissa e o seu resultado, não um
            assunto que mereça cartão inteiro.
          */}
          <div className="premissas-producao">
            <span className="premissas-producao__titulo">Premissas de produção</span>
            <div className="premissas-producao__campos">
              <div className="field field--narrow">
                <label htmlFor="version-expectedLoss">
                  Perda prevista de produção (%) <Dica id="formulacao.perdaPrevista" />
                </label>
                {isDraft ? (
                  <PercentField
                    id="version-expectedLoss"
                    scale={CASAS_PERCENTUAL_TECNICO}
                    placeholder="—"
                    /* 100% de perda não tem quantidade bruta: a seta para em 99. */
                    stepper={{ min: "0", max: "99", nome: "Perda prevista de produção" }}
                    value={expectedLossPercent}
                    onChangeValue={setExpectedLossPercent}
                    {...(fieldErrors["expectedLossPercent"]
                      ? {
                          "aria-invalid": true as const,
                          "aria-describedby": "version-expectedLossPercent-error",
                        }
                      : {})}
                  />
                ) : (
                  <p className="field-readonly-value">
                    {version.expectedLossPercent
                      ? formatPercentPtBr(version.expectedLossPercent, OPCOES_PERCENTUAL_TECNICO)
                      : "—"}
                  </p>
                )}
                {fieldErrors["expectedLossPercent"] && (
                  <p className="field__error" id="version-expectedLossPercent-error">
                    {fieldErrors["expectedLossPercent"]}
                  </p>
                )}
              </div>

              <div className="field field--narrow field--calculado">
                <span className="field__label-static">
                  Rendimento esperado <Dica id="formulacao.rendimentoEsperado" />
                </span>
                <p
                  className="field-readonly-value field-readonly-value--calculado"
                  data-testid="rendimento-esperado"
                >
                  {rendimentoExibido === null
                    ? "—"
                    : formatPercentPtBr(rendimentoExibido, OPCOES_PERCENTUAL_TECNICO)}
                </p>
              </div>

              <div className="field field--calculado premissas-producao__simulacao">
                <span className="field__label-static">
                  Produzir para entregar {formatIntegerPtBr(Number(LOTE_DA_SIMULACAO))}{" "}
                  {version.outputUnitCode} <Dica id="formulacao.simulacaoDeLote" />
                </span>
                <p
                  className="field-readonly-value field-readonly-value--calculado"
                  data-testid="simulacao-de-lote"
                >
                  {simulacaoExibida === null
                    ? "—"
                    : `${formatQuantity(simulacaoExibida)} ${version.outputUnitCode}`}
                </p>
              </div>
            </div>
          </div>

          {/*
            PREMISSAS QUE A FORMULAÇÃO NÃO EDITA, mas que quem confere precisa ver
            junto: público, reserva de referência, lote mínimo e caixa de embarque.
            Vieram do cadastro do Produto e das próprias linhas — nenhum cadastro
            novo foi criado para preencher o topo da tela, e o que o domínio não
            modela simplesmente não aparece.
          */}
          {premissasDeReferencia.length > 0 && (
            <dl className="definition-list definition-list--faixa">
              {premissasDeReferencia.map((premissa) => (
                <Fragment key={premissa.rotulo}>
                  <dt>
                    {premissa.rotulo}
                    {premissa.dica && (
                      <>
                        {" "}
                        <Dica id={premissa.dica} />
                      </>
                    )}
                  </dt>
                  <dd>{premissa.valor}</dd>
                </Fragment>
              ))}
            </dl>
          )}

          {perfilDoProduto && (
            <p className="field__hint">Cadastro do produto: {perfilDoProduto}.</p>
          )}
        </FormSection>

        {/*
          COMPOSIÇÃO e EMBALAGEM na mesma tela, visualmente separadas — e a
          separação é pelo TIPO REAL do Item, nunca pelo nome: "cápsula" é
          matéria-prima num produto e embalagem em outro, e quem responde isso é
          o cadastro, não o texto.
        */}
        {purezaPassouAValer.length > 0 && (
          <p className="field__hint" role="status">
            Neste rascunho a pureza de {purezaPassouAValer.join(", ")} estava gravada sem corrigir a
            quantidade. Na bancada a pureza informada sempre corrige, então a quantidade física
            dessas linhas mudou — confira antes de salvar.
          </p>
        )}

        {tabelaDaSecao("COMPOSICAO")}

        {tabelaDaSecao("EMBALAGEM")}

        <FormSection
          title="Resumo da formulação"
          subtitle="Totais técnicos desta receita, pelo mesmo motor das linhas: o que uma dose pesa, o que cada cápsula leva e quantas doses a embalagem entrega."
        >
          <dl className="definition-list">
            <dt>Forma e apresentação</dt>
            <dd>
              {dosageForm ? DOSAGE_FORM_LABELS[dosageForm] : "—"}
              {presentationType ? ` · ${PRESENTATION_TYPE_LABELS[presentationType]}` : ""}
            </dd>

            {mostrarPorCapsula && (
              <>
                <dt>Cápsulas</dt>
                <dd>
                  {capsulasPorDose === null ? "—" : formatIntegerPtBr(capsulasPorDose)} por dose ·{" "}
                  {capsulasNaEmbalagem === null ? "—" : formatIntegerPtBr(capsulasNaEmbalagem)} por
                  embalagem
                </dd>
              </>
            )}

            {dosageForm === "POWDER" && (
              <>
                <dt>Dose e conteúdo</dt>
                <dd>
                  {doseAmount.trim() ? `${doseAmount} ${doseUomCode}` : "—"} por dose ·{" "}
                  {packageContentAmount.trim()
                    ? `${packageContentAmount} ${packageContentUomCode}`
                    : "—"}{" "}
                  por embalagem
                </dd>
              </>
            )}

            <dt>Doses por embalagem</dt>
            <dd>{dosesPorEmbalagem === null ? "—" : formatIntegerPtBr(dosesPorEmbalagem)}</dd>

            {/*
              Soma o que É massa, e diz quando deixou linha de fora: total que
              omite em silêncio parece completo. Sem linha somável o valor é
              travessão — zero seria "esta dose não pesa nada".
            */}
            <dt>Massa por dose</dt>
            <dd>
              {resumoDaDose.somadas === 0
                ? "—"
                : `${formatQuantity(resumoDaDose.fisicaTotal.toFixed())} mg físicos · alvo ativo ${formatQuantity(resumoDaDose.teoricaTotal.toFixed())} mg`}
            </dd>

            {mostrarPorCapsula && (
              <>
                <dt>Massa por cápsula</dt>
                <dd>
                  {resumoDaDose.somadas > 0 && resumoDaDose.porCapsulaTotal
                    ? `${formatQuantity(resumoDaDose.porCapsulaTotal.toFixed())} mg`
                    : "—"}
                </dd>
              </>
            )}

            <dt>Linhas</dt>
            <dd>
              {formatIntegerPtBr(linhasDaComposicao.length)} na composição ·{" "}
              {formatIntegerPtBr(linhasDaEmbalagem.length)} na embalagem
            </dd>
          </dl>

          {resumoDaDose.foraDaSoma > 0 && (
            <p className="field__hint">
              {formatIntegerPtBr(resumoDaDose.foraDaSoma)} linha(s) por dose ficaram fora da soma
              porque a unidade não é de massa. O total diz só o que pôde somar.
            </p>
          )}
        </FormSection>

        {costEstimate && (
          <FormSection
            title="Custo estimado de materiais"
            subtitle="Estimativa de HOJE, com a MESMA escolha de fonte do cálculo de custo e do CMV: compra real dos últimos 30 dias, depois 90 dias, depois a última compra, depois oferta válida de fornecedor, depois referência manual. Lida a cada abertura e nunca gravada na versão — o CMV e a precificação leem a base CONGELADA do cálculo salvo, e é ele que vale como documento. A quantidade é a mesma que a Ordem de Produção separa."
          >
            {/*
              §54: dois números de momentos diferentes só convivem se estiver
              dito qual é qual. Este bloco é sempre o GRAVADO — vem do servidor,
              sobre a versão como ela está persistida. Enquanto houver edição
              não salva na tela, ele diz isso em vez de deixar a pessoa conferir
              o custo de um estado que ela acabou de mudar.
            */}
            {temAlteracaoPendente() && (
              <p className="field__hint">
                Custo do último salvamento — há alteração pendente nesta tela. Salve o rascunho
                para atualizar.
              </p>
            )}
            {/*
              Premissa faltando não vira lista de zeros: sem doses por embalagem
              não há quantidade física, e sem quantidade não há custo. O campo
              que resolve está logo acima, nesta mesma tela.
            */}
            {costEstimate.missingContext === "DOSES_PER_PACKAGE" && (
              <p className="field__hint">
                Informe as doses por embalagem para estimar o custo — há componentes calculados
                por dose. Enquanto isso o custo de material não existe; não é zero.
              </p>
            )}
            <div className="table-container">
              <table className="table table--custo-estimado">
                <thead>
                  <tr>
                    <th>Componente</th>
                    {/*
                      "para a base" no rótulo, não subentendido. Esta coluna e a
                      da tabela de componentes têm denominadores diferentes — uma
                      é por unidade acabada, outra é para a base inteira da
                      versão —, e sem dizer qual é qual duas colunas da mesma
                      tela divergem sem explicação.
                    */}
                    <th className="is-numeric">Quantidade física para a base</th>
                    <th className="is-numeric">Referência unitária</th>
                    <th>Origem</th>
                    <th className="is-numeric">Custo estimado</th>
                  </tr>
                </thead>
                <tbody>
                  {costEstimate.components.map((component) => (
                    <tr key={component.itemId}>
                      <td>
                        <EntityLink kind="item" id={component.itemId} code={component.itemCode} name={component.itemName} />
                      </td>
                      <td className="is-numeric">
                        {formatQuantity(component.requiredQuantity)} {component.stockUnitCode}
                        <br />
                        <span className="field__hint">
                          {formatQuantity(component.formulaQuantity)} {component.formulaUnitCode}
                        </span>
                        {/* Um custo que subiu sem a lista de QUEM subiu é um
                            número sem auditoria: a linha diz quando a perda
                            prevista entrou na quantidade dela. */}
                        {component.expectedLossApplied && (
                          <span className="cell-sub">com perda prevista</span>
                        )}
                      </td>
                      <td className="is-numeric">{component.customerSupplied ? "—" : formatBRL(component.unitCost)}</td>
                      <td>
                        {/* O selo diz o que a fonte É; o detalhe (janela, fornecedor,
                            vigência) fica em segunda linha, sem esticar a tabela. */}
                        <span className={seloDaFonte(component.costSource)}>
                          {INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS[component.costSource]}
                        </span>
                        {component.costSourceDetails && (
                          <span className="cell-sub" title={component.costSourceDetails}>
                            {component.costSourceDetails}
                          </span>
                        )}
                      </td>
                      <td className="is-numeric">
                        {component.customerSupplied ? "—" : formatBRL(component.estimatedComponentCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="definition-list">
              {/*
                A PREMISSA ao lado do número que ela mudou. Conferir um custo
                maior sem ver a perda que o aumentou não é conferência — e a
                quantidade bruta é a única linha da tela em que a perda vira
                quantidade.
              */}
              {costEstimate.expectedLossPercent && (
                <>
                  <dt>
                    Perda prevista de produção <Dica id="formulacao.perdaPrevista" />
                  </dt>
                  <dd>
                    {formatPercentPtBr(costEstimate.expectedLossPercent, OPCOES_PERCENTUAL_TECNICO)}{" "}
                    · rendimento{" "}
                    {costEstimate.expectedYieldPercent
                      ? formatPercentPtBr(costEstimate.expectedYieldPercent, OPCOES_PERCENTUAL_TECNICO)
                      : "—"}
                    {costEstimate.grossPlannedQuantity && (
                      <span className="cell-sub">
                        quantidade bruta planejada{" "}
                        {formatQuantity(costEstimate.grossPlannedQuantity)}{" "}
                        {costEstimate.outputUnitCode} para{" "}
                        {formatQuantity(costEstimate.basisQuantity)}{" "}
                        {costEstimate.outputUnitCode} vendáveis — a quantidade comercial do
                        Orçamento e do Pedido não muda.
                      </span>
                    )}
                  </dd>
                </>
              )}
              <dt>Custo estimado da base ({formatQuantity(costEstimate.basisQuantity)} {costEstimate.outputUnitCode})</dt>
              <dd>
                {costEstimate.estimatedMaterialCost
                  ? formatBRL(costEstimate.estimatedMaterialCost)
                  : "Indisponível"}
              </dd>
              <dt>Custo estimado por unidade vendável</dt>
              <dd>
                {costEstimate.estimatedMaterialUnitCost
                  ? formatBRL(costEstimate.estimatedMaterialUnitCost)
                  : "Indisponível"}
              </dd>
              <dt>Qualidade</dt>
              <dd>
                <span
                  className={costEstimate.quality === "ESTIMATED" ? "badge badge--active" : "badge badge--warn"}
                >
                  {COST_QUALITY_LABELS[costEstimate.quality]}
                </span>
              </dd>
            </dl>

            {costEstimate.ambiguousCostItems.length > 0 && (
              <p className="field__hint">
                {/* Ofertas existem, falta escolher — e a referência manual não
                    entra sozinha no lugar delas. A solução mora no cadastro
                    Item × Fornecedor, não aqui. */}
                {costEstimate.ambiguousCostItems.join(", ")}: há mais de uma oferta válida de
                fornecedor e nenhuma preferencial, então o custo fica em aberto — a referência
                manual não entra sozinha no lugar delas.{" "}
                <Link to="/compras/item-fornecedor">Definir a oferta preferencial em Item × Fornecedor</Link>.
              </p>
            )}

            {costEstimate.missingCostItems.length > 0 && (
              <p className="field__hint">
                {costEstimate.quality === "PARTIAL" ? "Custo parcial: " : ""}
                {costEstimate.missingCostItems.join(", ")} sem referência de custo
                {costEstimate.quality === "PARTIAL" ? (
                  <>
                    . O subtotal conhecido ({formatBRL(costEstimate.knownCostSubtotal)}) não representa o
                    custo total da fórmula.
                  </>
                ) : (
                  "."
                )}{" "}
                {/* Dizer o que falta sem dizer onde resolver deixa a pessoa
                    parada: compra recebida com custo, oferta de fornecedor ou
                    referência manual no item — nesta ordem. */}
                <Link to="/compras/item-fornecedor">
                  Definir preço de fornecedor para esses itens
                </Link>{" "}
                ou informar uma referência manual de custo no cadastro do item.
              </p>
            )}

            {costEstimate.hasCustomerSuppliedMaterials && (
              <p className="field__hint">
                Material fornecido pelo cliente fica fora do custo: não é custo de aquisição
                Veridi, nem mesmo quando o item tem compra ou referência manual.
              </p>
            )}
          </FormSection>
        )}

        <FormSection title="Observações">
          <div className="field">
            <label htmlFor="version-notes">Notas técnicas</label>
            <textarea
              id="version-notes"
              rows={3}
              disabled={!isDraft}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </FormSection>
      </div>

      <div className="doc-actions">
        <div className="doc-actions__primary">
          {/* Pendência antes de confirmação: "salvo" ao lado de campo já
              alterado de novo mentiria sobre o que está gravado. É a mesma
              pendência da guarda de saída, não uma conta paralela. */}
          {isDraft && temAlteracaoPendente() ? (
            <span className="form-status form-status--dirty" role="status">
              Alterações não salvas
            </span>
          ) : (
            feito && (
              <span className="form-status" role="status">
                {feito}
              </span>
            )
          )}
          {isDraft && (
            <button type="button" className="btn btn--secondary" disabled={saving} onClick={handleSaveDraft}>
              {acaoEmCurso === "rascunho" ? "Salvando…" : "Salvar rascunho"}
            </button>
          )}
          {isDraft && (
            <button
              type="button"
              className="btn btn--accent"
              disabled={saving}
              onClick={() => void abrirDialogoDeAtivacao()}
            >
              {acaoEmCurso === "ativar" ? "Ativando…" : "Ativar versão"}
            </button>
          )}
          {version.status === "ACTIVE" && (
            <button
              type="button"
              className="btn btn--accent"
              disabled={saving}
              onClick={handleCreateNewVersion}
            >
              {acaoEmCurso === "nova-versao" ? "Criando…" : "Criar nova versão"}
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={activateDialogOpen}
        title={`Ativar formulação ${version.versionLabel}?`}
        message={
          <>
            <p>
              Esta versão passará a ser a formulação oficial do produto; a versão ativa anterior
              (se houver) será inativada; a versão ativada não poderá mais ser editada — futuras
              alterações exigirão uma nova versão.
            </p>
            {/* Nada nesta lista é alterado por ativar: cada documento continua
                apontando para a receita que escolheu. O que muda é o que passa
                a estar defasado — e isso só é útil enquanto dá para cancelar. */}
            {impact && impact.costStructures.length > 0 && (
              <>
                <p>
                  <strong>Continuam na receita atual:</strong>
                </p>
                <ul className="confirm-dialog__list">
                  {impact.costStructures.map((structure) => (
                    <li key={structure.id}>
                      <Link to={`/produtos/${productId}/custos`}>{structure.label}</Link> — usa a V
                      {structure.formulationVersionNumber}
                      {structure.status === "ACTIVE"
                        ? ". Estrutura ativa não se move: a receita dela é o que o custo já significa."
                        : ". Rascunho: dá para trazer para a nova receita em um clique, depois de ativar."}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {impact && impact.productionOrders.length > 0 && (
              <>
                <p>
                  <strong>Ordens em rascunho que precisarão trocar de versão:</strong>
                </p>
                <ul className="confirm-dialog__list">
                  {impact.productionOrders.map((order) => (
                    <li key={order.id}>
                      <Link to={`/producao/ordens/${order.id}`}>{order.code}</Link> — usa a V
                      {order.formulationVersionNumber}; planejar exige a versão ativa.
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        }
        confirmLabel="Ativar"
        confirmTone="accent"
        onCancel={() => setActivateDialogOpen(false)}
        onConfirm={handleActivate}
      />
    </>
  );
}
