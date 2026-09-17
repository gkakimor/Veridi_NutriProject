import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
import type {
  ApresentacaoBlock,
  DosageForm,
  FormulationActivationImpactDTO,
  FormulationCalculationMode,
  FormulationComponentBasis,
  FormulationCostEstimateDTO,
  FormulationVersionDTO,
  IndustrialMaterialCostSource,
  PresentationType,
  SecaoDaFormula,
  SupplyResponsibility,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import {
  COST_QUALITY_LABELS,
  FORMULATION_CALCULATION_MODES,
  FORMULATION_CALCULATION_MODE_LABELS,
  FORMULATION_VERSION_STATUS_LABELS,
  INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS,
  DOSAGE_FORM_LABELS,
  FORMAS_DA_BANCADA,
  MENSAGENS_DA_APRESENTACAO,
  PRESENTATION_TYPES,
  PRESENTATION_TYPE_LABELS,
  TARGET_AGE_GROUP_LABELS,
  ajustesAutorizados,
  apresentacoesDaForma,
  capsulasPorEmbalagem,
  dosesPorEmbalagemDaApresentacao,
  formaDerivaDoses,
  quantidadeBrutaPlanejada,
  rendimentoEsperado,
  resumirDoses,
} from "@veridi/shared";
import { CalcHint } from "../../components/help/CalcHint";
import { DecimalField, IntegerField } from "../../components/NumericField";
import { decimalDaApiComparavel } from "../../lib/dirty-fields";
import { lerInteiroOpcional } from "../../lib/integer-input";
import { numericInvalidMessage, parsePtBrNumber, toPtBrEditText, formatIntegerPtBr, formatPercentPtBr } from "../../lib/numeric-ptbr";
import {
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
import { getItem } from "../../lib/items-api";
import { listUnits } from "../../lib/units-api";
import { unidadesDaDimensao } from "../../lib/uom-options";
import { ApiValidationError } from "../../lib/api-errors";
import { decimalLegivel, exigirDecimal, exigirDecimalOpcional } from "../../lib/decimal-field";
import { getFormulationCostEstimate } from "../../lib/costs-api";
import { formatBRL } from "../../lib/currency";
import { FormSection } from "../../components/FormSection";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";
import { FormulationTemplateOrigin } from "../formulation-templates/FormulationTemplateOrigin";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EntityLink, entityHref } from "../../components/EntityLink";
import { useAuth } from "../../app/AuthProvider";
import { useContextualCreateOrigin } from "../../lib/use-contextual-create";
import { formatQuantity } from "../../lib/quantity";
import { ProductRelatedLinks } from "../../components/ProductRelatedLinks";
import { ProjectOriginLink } from "../../components/ProjectOriginLink";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
/*
  A BANCADA MORA EM `formulation-workbench` (FORMULATION-TEMPLATE-WORKBENCH-01,
  fatia 2).

  A grade da receita, as premissas da forma, a prévia do cálculo e o catálogo de
  itens deixaram esta página e viraram componentes: o Modelo de Formulação edita
  a MESMA receita, e enquanto cada tela tinha a sua cópia da bancada, a correção
  feita de um lado só não alcançava o outro. O que ficou aqui é o DOCUMENTO —
  produto, cliente, ciclo de vida da versão, custo estimado, proveniência e
  ficha técnica —, que é o que esta tela tem e o Modelo não.
*/
import { Dica } from "../formulation-workbench/dicas";
import { PremissasDaForma } from "../formulation-workbench/PremissasDaForma";
import type { PremissasDaFormaValores } from "../formulation-workbench/PremissasDaForma";
import { PremissasDeProducao } from "../formulation-workbench/PremissasDeProducao";
import { ResumoDaReceita } from "../formulation-workbench/ResumoDaReceita";
import { StickyActionBar } from "../formulation-workbench/StickyActionBar";
import { TabelaDaReceita } from "../formulation-workbench/TabelaDaReceita";
import {
  itemDaBancada,
  itemElegivelParaSecao,
  opcaoDoItem,
  tipoDaSecao,
  useCatalogoDeItens,
} from "../formulation-workbench/catalogo-de-itens";
import type { ItemDaBancada } from "../formulation-workbench/catalogo-de-itens";
import {
  CAMPOS_DO_COMPONENTE,
  absorverChaves,
  chaveDeErro,
  comAjustesDaBancada,
  comItemEscolhido,
  errosDaLinha,
  idDoCampo,
  linhaNova,
  proximaChaveDaLinha,
  purezaRegistradaSemAplicar,
  secaoDaLinha,
} from "../formulation-workbench/linha-da-receita";
import type { CampoDoComponente, LinhaDaReceita } from "../formulation-workbench/linha-da-receita";
import { usePodeCriarItem } from "../items/item-permissions";
import {
  operandosDoFisico,
  previaDaDose,
  previaDoComponente,
  unidadesDoMotor,
} from "../formulation-workbench/previa-do-calculo";

/**
 * Lote de referência da simulação da perda, em unidade do produto acabado.
 *
 * Número redondo de propósito: ele não descreve nenhum pedido, serve para ler a
 * perda como quantidade em vez de percentual. Quem planeja de verdade usa a
 * quantidade do Pedido; aqui é régua.
 */
const LOTE_DA_SIMULACAO = "1000";

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
  components: LinhaDaReceita[];
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

function rowFromDTO(component: FormulationVersionDTO["components"][number]): LinhaDaReceita {
  return {
    key: proximaChaveDaLinha(),
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
    secao: secaoDaLinha({ itemType: component.itemType, secao: "COMPOSICAO" }),
    itemSourceName: component.itemSourceName ?? null,
    itemDeclaredNutrient: component.itemDeclaredNutrient ?? null,
    itemFamily: component.itemFamily ?? null,
    itemPackagingSubtype: component.itemPackagingSubtype ?? null,
    itemDefaultPurityPercent: component.itemDefaultPurityPercent ?? null,
    itemExternalCode: component.itemExternalCode ?? null,
  };
}

/** Cor do selo da origem do custo: o que falta ou exige decisão avisa; o resto informa. */
function seloDaFonte(source: IndustrialMaterialCostSource): string {
  return source === "NO_COST" || source === "AMBIGUOUS_SUPPLIER_REFERENCE"
    ? "badge badge--warn"
    : "badge badge--neutral";
}

/**
 * Editor de versão de formulação — página própria (documento transacional),
 * não modal. DRAFT é totalmente editável; ACTIVE/INACTIVE são read-only por
 * construção (backend também bloqueia).
 */

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
  const [components, setComponents] = useState<LinhaDaReceita[]>([]);

  /* O catálogo da bancada — primeira página, busca no servidor e mesclagem. */
  const catalogo = useCatalogoDeItens();
  const activeItems = catalogo.itens;
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
  /* "+ Novo item de estoque" na bancada só para quem cadastra Item
     (MASTER-DATA-EDIT-PERMISSIONS-01); escolher item existente segue livre. */
  const podeCadastrarItem = usePodeCriarItem();
  const [costEstimate, setCostEstimate] = useState<FormulationCostEstimateDTO | null>(null);
  /*
   * "Salvar como template": o BOTÃO mora na barra fixa, o formulário de nome
   * continua na proveniência.
   *
   * O estado sobe para cá porque as duas metades da mesma ação passaram a morar
   * em cantos diferentes da tela. O que a ação FAZ não mudou em nada — mesma
   * validação de nome, mesma chamada, mesmo destino —, e é por isso que ela não
   * virou diálogo: trocar o gesto junto com o lugar seria mudar duas coisas de
   * uma vez numa ação homologada.
   */
  const [salvarComoTemplateAberto, setSalvarComoTemplateAberto] = useState(false);

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
    listUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  /**
   * Busca no servidor, com os MESMOS filtros de negócio da carga inicial:
   * só o tipo da seção, só ativos, e fora o que outra linha já consome — os
   * dois primeiros no servidor (`catalogo.buscar`), o terceiro aqui,
   * exatamente como `optionsForRow` já faz com a primeira página. Componente
   * encontrado é componente que já era elegível; nada passa a ser escolhível
   * por causa da busca.
   */
  async function buscarItens(row: LinhaDaReceita, termo: string): Promise<EntityOption[]> {
    const secao = secaoDaLinha(row);
    const encontrados = await catalogo.buscar(secao, termo);
    const usadosPorOutrasLinhas = new Set(
      components.filter((c) => c.key !== row.key).map((c) => c.itemId),
    );
    return encontrados
      .filter((item) => !usadosPorOutrasLinhas.has(item.id) && itemElegivelParaSecao(item, secao))
      .map(opcaoDoItem);
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
          const opcao = itemDaBancada(item);
          catalogo.adicionar(opcao);
          setComponents((prev) =>
            prev.map((row) => (row.key === chave ? comItemEscolhido(row, opcao, units) : row)),
          );
        })
        .catch(() => undefined);
    },
  });

  const isDraft = version?.status === "DRAFT";
  /* Quem pode promover esta formulação a Modelo — a mesma regra de sempre. */
  const podeSalvarComoTemplate = user?.role === "ADMIN" || user?.role === "PRODUCTION";

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

  function optionsForRow(row: LinhaDaReceita): ItemDaBancada[] {
    const secao = secaoDaLinha(row);
    const usedByOtherRows = new Set(components.filter((c) => c.key !== row.key).map((c) => c.itemId));
    // A mesma regra do Modelo: nova escolha só entre ativos do tipo da seção,
    // e o item que a linha já referencia continua à vista.
    const base = activeItems.filter(
      (item) =>
        !usedByOtherRows.has(item.id) &&
        (item.id === row.itemId || itemElegivelParaSecao(item, secao)),
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
  function unitOptionsForRow(row: LinhaDaReceita): UnitOfMeasureDTO[] {
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
   * (FORMULATION-WORKBENCH-01). A correção fica visível na coluna Pureza — é
   * escolha declarada da linha, não regra escondida.
   *
   * EMBALAGEM nasce por unidade acabada e com quantidade FÍSICA informada:
   * pureza não se aplica a um pote.
   */
  function handleAddComponent(secao: SecaoDaFormula) {
    setComponents((prev) => [...prev, linhaNova(secao, receitaPorDose)]);
  }

  function handleRemoveComponent(key: string) {
    setComponents((prev) => prev.filter((row) => row.key !== key));
  }

  /**
   * Move a linha uma posição dentro da PRÓPRIA seção.
   *
   * A ordem da receita é dela: quem monta a fórmula lista o ativo principal
   * primeiro e os excipientes depois, e essa leitura vale na tela, na Ordem de
   * Produção e na folha de pesagem. A ordem já viajava no payload — o servidor
   * grava `position` pelo índice do array —, e o que faltava era poder mudá-la
   * sem apagar a linha e refazer.
   *
   * O vizinho é procurado SALTANDO as linhas da outra seção: composição e
   * embalagem dividem um array só, e trocar com a linha imediatamente anterior
   * moveria uma matéria-prima para dentro da embalagem.
   */
  function handleMoveComponent(key: string, direcao: -1 | 1) {
    setComponents((prev) => {
      const indice = prev.findIndex((row) => row.key === key);
      const atual = prev[indice];
      if (!atual) return prev;
      const secao = secaoDaLinha(atual);
      let vizinho = indice + direcao;
      while (vizinho >= 0 && vizinho < prev.length && secaoDaLinha(prev[vizinho]!) !== secao) {
        vizinho += direcao;
      }
      const trocada = prev[vizinho];
      if (!trocada) return prev;
      const proximo = [...prev];
      proximo[indice] = trocada;
      proximo[vizinho] = atual;
      return proximo;
    });
  }

  /**
   * Uma premissa da forma muda — a bancada fala com a página por um nome só.
   *
   * Os campos continuam em estados separados: eles são independentes de fato, e
   * juntá-los num objeto só para atender ao componente trocaria uma repetição
   * curta por uma indireção em toda leitura da tela.
   */
  function mudarPremissa<K extends keyof PremissasDaFormaValores>(
    campo: K,
    valor: PremissasDaFormaValores[K],
  ) {
    const destinos: { [C in keyof PremissasDaFormaValores]: (v: PremissasDaFormaValores[C]) => void } = {
      dosageForm: setDosageForm,
      presentationType: setPresentationType,
      capsulesPerDose: setCapsulesPerDose,
      capsulesPerPackage: setCapsulesPerPackage,
      doseAmount: setDoseAmount,
      doseUomCode: setDoseUomCode,
      packageContentAmount: setPackageContentAmount,
      packageContentUomCode: setPackageContentUomCode,
    };
    destinos[campo](valor);
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
   * O item escolhido na CONSULTA ASSISTIDA (ASSISTED-ENTITY-SELECTOR-FOUNDATION-01).
   *
   * Chega inteiro, e não pelo id: pode vir da terceira página da consulta, fora
   * do catálogo que o seletor conhece. Entra no catálogo — é dele que a coluna
   * de unidade e o rótulo do seletor leem — e vai para a linha pelo mesmo
   * `comItemEscolhido` da escolha no autocomplete.
   */
  function handleComponentItemConsulted(linha: LinhaDaReceita, item: ItemDaBancada) {
    catalogo.mesclar([item]);
    setComponents((prev) =>
      prev.map((row) => (row.key === linha.key ? comItemEscolhido(row, item, units) : row)),
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
  function handleComponentFieldChange<K extends keyof LinhaDaReceita>(
    key: string,
    field: K,
    value: LinhaDaReceita[K],
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
  function explicacaoDoFisico(linha: LinhaDaReceita, fisico: string | null) {
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
    row: LinhaDaReceita,
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
  const premissasDeReferencia: { rotulo: string; valor: string; dica?: HelpHintId }[] = [];
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

  /** Base canônica da seção — o que `handleAddComponent` já escolhe sozinho. */
  function baseDaSecao(secao: SecaoDaFormula): FormulationComponentBasis {
    return secao === "COMPOSICAO"
      ? receitaPorDose
        ? "PER_DOSE"
        : "FIXED_BASIS"
      : "PER_FINISHED_UNIT";
  }

  /**
   * As grandezas que a linha exibe.
   *
   * O físico ENQUANTO se digita, não só depois de salvar: a prévia usa a mesma
   * função que a API chama e, quando a conta não é possível, a linha cai no
   * valor gravado. `null` vira travessão — nunca zero.
   */
  function valoresDaLinha(row: LinhaDaReceita) {
    const previa = isDraft
      ? previaDoComponente(row, basisQuantity, dosesPorEmbalagem, units)
      : null;
    return {
      fisicoExibido: previa?.fisico ?? row.physicalPerUnit,
      equivalenteExibido: previa?.teorico ?? row.theoreticalPerUnit,
      dose: valoresDaDose(row),
    };
  }

  /**
   * A seção da receita, na bancada COMPARTILHADA com o Modelo de Formulação.
   *
   * A grade, as colunas, as larguras e a ordenação moram em
   * `formulation-workbench`: esta página entrega os dados e os gestos, e não
   * sabe desenhar linha nenhuma. Foi essa duplicação — cada tela com a sua
   * tabela — que fez a bancada existir só aqui durante duas capabilities.
   */
  function tabelaDaSecao(secao: SecaoDaFormula) {
    return (
      <TabelaDaReceita
        secao={secao}
        linhas={secao === "COMPOSICAO" ? linhasDaComposicao : linhasDaEmbalagem}
        editavel={isDraft}
        mostrarPorCapsula={mostrarPorCapsula}
        baseMultiplicaMaterial={baseMultiplicaMaterial}
        baseDaSecao={baseDaSecao(secao)}
        unidadesDaLinha={unitOptionsForRow}
        opcoesDeItem={(row) => optionsForRow(row).map(opcaoDoItem)}
        onBuscarItem={buscarItens}
        /* Sair para cadastrar o item NÃO é descartar: o rascunho vai junto e
           volta aplicado na linha. */
        onCriarItem={
          podeCadastrarItem
            ? (row) =>
                liberarGuarda(() =>
                  origem.goCreate({
                    // O tipo da seção chega pré-escolhido — sugestão com os
                    // defaults do tipo, que o cadastro deixa trocar.
                    route: `/cadastros/itens/novo?tipo=${tipoDaSecao(secaoDaLinha(row))}`,
                    fieldKey: "itemId",
                    entityType: "item",
                    context: { rowKey: row.key },
                  }),
                )
            : undefined
        }
        consultaDeItem={
          isDraft
            ? { origem: "Formulação", onEscolher: handleComponentItemConsulted }
            : undefined
        }
        valoresDaLinha={valoresDaLinha}
        explicacaoDoFisico={explicacaoDoFisico}
        erros={fieldErrors}
        onCampo={handleComponentFieldChange}
        onBase={handleComponentBasisChange}
        onFornecimento={handleComponentSupplyChange}
        onItem={handleComponentItemChange}
        onMover={handleMoveComponent}
        onRemover={handleRemoveComponent}
        onAdicionar={handleAddComponent}
        /* Os totais da dose fecham a COMPOSIÇÃO: a embalagem não soma massa. */
        totaisDaDose={secao === "COMPOSICAO" ? resumoDaDose : undefined}
      />
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
          {/*
            A FICHA TÉCNICA da versão, em PDF — documento técnico da receita,
            sem custo nem preço. Fica junto das ações da versão porque é dela
            que o papel fala: cada versão tem a sua ficha, e a de um rascunho
            sai marcada como rascunho.
          */}
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() =>
              navigate(
                `/producao/formulacoes/${productId}/versoes/${version.id}/ficha-tecnica`,
              )
            }
          >
            Ficha técnica (PDF)
          </button>
          {/* "← Voltar" foi para a barra fixa do rodapé, junto das outras ações
              da versão. Duas cópias do mesmo botão em pontas opostas da tela
              seriam duas respostas para "onde ficam as ações desta página?". */}
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
          canEdit={podeSalvarComoTemplate}
          onChanged={load}
          salvandoComoTemplate={salvarComoTemplateAberto}
          onSalvandoComoTemplateChange={setSalvarComoTemplateAberto}
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

          <PremissasDaForma
            idPrefixo="version"
            valores={{
              dosageForm,
              presentationType,
              capsulesPerDose,
              capsulesPerPackage,
              doseAmount,
              doseUomCode,
              packageContentAmount,
              packageContentUomCode,
            }}
            onChange={mudarPremissa}
            editavel={isDraft}
            erros={fieldErrors}
            formasOferecidas={formasOferecidas}
            apresentacoesOferecidas={apresentacoesOferecidas}
            unidadesDeMassa={unidadesDeMassa}
            derivaDoses={derivaDoses}
            dosesDerivadas={dosesPorEmbalagem}
            testIdDasDoses="doses-derivadas"
          >
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
          </PremissasDaForma>

          <PremissasDeProducao
            idPrefixo="version"
            expectedLossPercent={expectedLossPercent}
            onChange={setExpectedLossPercent}
            editavel={isDraft}
            erro={fieldErrors["expectedLossPercent"]}
            rendimentoExibido={rendimentoExibido}
          >
            {/*
              SIMULAÇÃO DE LOTE — só a Formulação tem produto acabado e unidade
              de saída para responder "para entregar mil, produzo quanto?". O
              Modelo não tem: a premissa é a mesma, a régua não.
            */}
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
          </PremissasDeProducao>

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

        <ResumoDaReceita
          dosageForm={dosageForm}
          presentationType={presentationType}
          capsulasPorDose={capsulasPorDose}
          capsulasNaEmbalagem={capsulasNaEmbalagem}
          doseAmount={doseAmount}
          doseUomCode={doseUomCode}
          packageContentAmount={packageContentAmount}
          packageContentUomCode={packageContentUomCode}
          dosesPorEmbalagem={dosesPorEmbalagem}
          resumoDaDose={resumoDaDose}
          linhasNaComposicao={linhasDaComposicao.length}
          linhasNaEmbalagem={linhasDaEmbalagem.length}
        />

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

      {/*
        A BARRA FIXA DAS AÇÕES (FORMULATION-TEMPLATE-WORKBENCH-01, fatia 2).

        Antes as ações moravam no fim do documento, depois do custo estimado e
        das observações: quem editava a receita não via "Salvar rascunho" nem
        "Ativar versão" sem rolar a tela inteira. A barra continua sendo a
        ÚNICA superfície dessas ações — nem o topo nem o rodapé guardam uma
        segunda cópia.
      */}
      <StickyActionBar
        rotulo="Ações da formulação"
        inicio={
          <>
            <Link className="btn btn--ghost" to={`/producao/formulacoes/${productId}`}>
              ← Voltar
            </Link>
            {/* "Salvar como template" mudou de lugar, não de contrato: o botão
                abre o MESMO formulário de nome, na proveniência, com a mesma
                validação e o mesmo destino. */}
            {podeSalvarComoTemplate && !salvarComoTemplateAberto && (
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setSalvarComoTemplateAberto(true)}
              >
                Salvar como modelo
              </button>
            )}
          </>
        }
        fim={
          <>
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
          </>
        }
      />

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
