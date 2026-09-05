import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  FormulationActivationImpactDTO,
  FormulationCalculationMode,
  FormulationComponentBasis,
  FormulationComponentQuantityMode,
  FormulationCostEstimateDTO,
  FormulationVersionDTO,
  IndustrialMaterialCostSource,
  ItemDTO,
  SupplyResponsibility,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import {
  COST_QUALITY_LABELS,
  FORMULATION_CALCULATION_MODES,
  FORMULATION_CALCULATION_MODE_LABELS,
  FORMULATION_COMPONENT_BASES,
  FORMULATION_COMPONENT_BASIS_LABELS,
  FORMULATION_QUANTITY_MODE_DESCRIPTIONS,
  FORMULATION_QUANTITY_MODE_LABELS,
  FORMULATION_VERSION_STATUS_LABELS,
  INDUSTRIAL_MATERIAL_COST_SOURCE_LABELS,
  SUPPLY_RESPONSIBILITIES,
  SUPPLY_RESPONSIBILITY_LABELS,
  calcularQuantidadeDoComponente,
} from "@veridi/shared";
import { CalcHint } from "../../components/help/CalcHint";
import { mensagemDecimalInvalido, parseDecimalInput } from "../../lib/decimal-input";
import {
  activateFormulationVersion,
  getFormulationActivationImpact,
  createNewFormulationVersion,
  getFormulationVersion,
  updateFormulationVersion,
} from "../../lib/formulations-api";
import { getItem, listItems } from "../../lib/items-api";
import { listUnits } from "../../lib/units-api";
import { ApiValidationError } from "../../lib/api-errors";
import { exigirDecimal, exigirDecimalOpcional } from "../../lib/decimal-field";
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

interface ItemOption {
  id: string;
  code: string;
  name: string;
  unitCode: string;
  unitDimension: string;
  active: boolean;
}

/**
 * Primeira página do catálogo — o que a lista mostra antes de digitar.
 *
 * Era 1000 por tipo, e o catálogo tem 1.211 matérias-primas ativas: 211
 * existiam e não apareciam na busca, sem aviso. Quem digita agora pergunta
 * ao servidor (`buscarItens`), que conhece o catálogo inteiro.
 */
const PRIMEIRA_PAGINA = 50;

/** Uma conversão só de item do catálogo para opção da tela. */
function itemOption(item: ItemDTO): ItemOption {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    unitCode: item.unitCode,
    unitDimension: item.unit.dimension,
    active: item.active,
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
  stockEquivalentQuantity: string;
  physicalPerUnit: string | null;
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

function rowFromDTO(component: FormulationVersionDTO["components"][number]): ComponentRow {
  return {
    key: nextRowKey(),
    itemId: component.itemId,
    itemCode: component.itemCode,
    itemName: component.itemName,
    itemActive: component.itemActive,
    stockUnitCode: component.stockUnitCode,
    quantity: component.quantity,
    unitCode: component.unitCode,
    basis: component.basis,
    supplyResponsibility: component.supplyResponsibility,
    purityPercentApplied: component.purityPercentApplied ?? "",
    overagePercent: component.overagePercent ?? "",
    quantityMode: component.quantityMode,
    applyPurityAdjustment: component.applyPurityAdjustment,
    applyOverageAdjustment: component.applyOverageAdjustment,
    notes: component.notes ?? "",
    stockEquivalentQuantity: component.stockEquivalentQuantity,
    physicalPerUnit: component.physicalPerUnit,
  };
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

/** Campos que vivem no painel de ajustes — o painel precisa abrir para mostrá-los. */
const CAMPOS_DO_PAINEL: readonly CampoDoComponente[] = ["purityPercentApplied", "overagePercent"];

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

  if (row.quantity.trim() === "") {
    erros.quantity = `${nome} — Quantidade é obrigatória.`;
  } else {
    const quantidade = parseDecimalInput(row.quantity);
    if (quantidade === null) erros.quantity = `${nome} — ${mensagemDecimalInvalido("Quantidade")}`;
    else if (Number(quantidade) <= 0) erros.quantity = `${nome} — Quantidade deve ser maior que zero.`;
  }
  if (!row.unitCode) erros.unitCode = `${nome} — Unidade é obrigatória.`;

  if (row.purityPercentApplied.trim() !== "") {
    const pureza = parseDecimalInput(row.purityPercentApplied);
    if (pureza === null) erros.purityPercentApplied = `${nome} — ${mensagemDecimalInvalido("Pureza %")}`;
    else if (Number(pureza) <= 0 || Number(pureza) > 100) {
      erros.purityPercentApplied = `${nome} — Pureza % deve ser maior que zero e no máximo 100.`;
    }
  }
  if (row.overagePercent.trim() !== "") {
    const overage = parseDecimalInput(row.overagePercent);
    if (overage === null) erros.overagePercent = `${nome} — ${mensagemDecimalInvalido("Overage %")}`;
    else if (Number(overage) < 0) erros.overagePercent = `${nome} — Overage % não pode ser negativo.`;
  }
  return erros;
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
  const quantidade = parseDecimalInput(row.quantity);
  if (quantidade === null) return null;

  const resultado = calcularQuantidadeDoComponente(
    {
      basis: row.basis,
      quantity: quantidade,
      unitCode: row.unitCode,
      stockUnitCode: row.stockUnitCode,
      purityPercent: parseDecimalInput(row.purityPercentApplied),
      overagePercent: parseDecimalInput(row.overagePercent),
      quantityMode: row.quantityMode,
      applyPurityAdjustment: row.applyPurityAdjustment,
      applyOverageAdjustment: row.applyOverageAdjustment,
    },
    1,
    { basisQuantity: parseDecimalInput(basisQuantity) ?? "0", dosesPerPackage },
    units.map((u) => ({ code: u.code, dimension: u.dimension, toBaseFactor: u.toBaseFactor })),
  );

  if (typeof resultado === "string") return null;
  return { teorico: resultado.theoretical.toString(), fisico: resultado.physical.toString() };
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
 * A ordem segue a do motor: base, unidade, pureza, overage.
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
      valor: `${formatQuantity(row.quantity)} ${row.unitCode}`,
      papel: teorico ? "quantidade teórica" : "quantidade informada",
      numero: Number(parseDecimalInput(row.quantity)),
    },
  ];

  if (row.basis === "FIXED_BASIS") {
    const base = parseDecimalInput(basisQuantity);
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
      valor: String(dosesPerPackage),
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
      valor: String(fator),
      papel: `${de.code} para ${para.code}`,
      numero: fator,
    });
  }

  if (teorico && row.applyPurityAdjustment && row.purityPercentApplied) {
    const pureza = Number(parseDecimalInput(row.purityPercentApplied));
    if (pureza > 0) {
      operandos.push({
        valor: `${row.purityPercentApplied}%`,
        papel: "pureza",
        operador: "÷",
        numero: pureza / 100,
      });
    }
  }
  if (teorico && row.applyOverageAdjustment && row.overagePercent) {
    const overage = Number(parseDecimalInput(row.overagePercent));
    if (overage >= 0) {
      operandos.push({
        valor: `(1 + ${row.overagePercent}%)`,
        papel: "overage",
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
function Dica({ id }: { id: "formulacao.base" | "formulacao.modoCalculo" | "formulacao.fornecimento" | "formulacao.pureza" | "formulacao.overage" | "formulacao.equivalenteEstoque" }) {
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
  const [notes, setNotes] = useState("");
  const [components, setComponents] = useState<ComponentRow[]>([]);

  const [activeItems, setActiveItems] = useState<ItemOption[]>([]);
  const [units, setUnits] = useState<UnitOfMeasureDTO[]>([]);

  const [saving, setSaving] = useState(false);
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
   * Quais linhas tem o painel de ajustes aberto.
   *
   * Era um `<details>` dentro da celula, e o painel herdava a rolagem
   * horizontal da tabela: numa tela de 1500px o aviso de dupla correcao ficava
   * 20% visivel, o resto atras da borda. O painel agora e uma LINHA propria,
   * de largura inteira, entao nao depende de rolar a tabela para o lado.
   */
  const [ajustesAbertos, setAjustesAbertos] = useState<Record<string, boolean>>({});

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
    setBasisQuantity(dto.basisQuantity);
    setCalculationMode(dto.calculationMode);
    setDosesPerPackage(dto.dosesPerPackage === null ? "" : String(dto.dosesPerPackage));
    setNotes(dto.notes ?? "");
    setComponents(dto.components.map(rowFromDTO));
    gravado.current = JSON.stringify(rascunhoDoDTO(dto));
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

  // Fotografia de custo — recarregada sempre que a versão muda (a fórmula
  // é imutável, mas a referência de custo não).
  useEffect(() => {
    if (!versionId) return;
    getFormulationCostEstimate(versionId)
      .then(setCostEstimate)
      .catch(() => setCostEstimate(null));
  }, [versionId, version?.components.length]);

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
    const [raw, packaging] = await Promise.all([
      listItems({ type: "RAW_MATERIAL", active: true, search: termo, pageSize: PRIMEIRA_PAGINA }),
      listItems({ type: "PACKAGING", active: true, search: termo, pageSize: PRIMEIRA_PAGINA }),
    ]);
    const encontrados = [...raw.items, ...packaging.items].map(itemOption);
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
    collectDraft: () => ({ basisQuantity, calculationMode, dosesPerPackage, notes, components }),
    restoreDraft: (draft) => {
      // Antes de qualquer `setState`: a carga da versão está a caminho.
      rascunhoRestaurado.current = true;
      setBasisQuantity(draft.basisQuantity ?? "");
      setCalculationMode(draft.calculationMode ?? "FIXED_BASIS");
      setDosesPerPackage(draft.dosesPerPackage ?? "");
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
          setActiveItems((prev) => [
            {
              id: item.id,
              code: item.code,
              name: item.name,
              unitCode: item.unitCode,
              unitDimension: item.unit.dimension,
              active: item.active,
            },
            ...prev.filter((row) => row.id !== item.id),
          ]);
          setComponents((prev) =>
            prev.map((row) =>
              row.key === chave
                ? {
                    ...row,
                    itemCode: item.code,
                    itemName: item.name,
                    itemActive: item.active,
                    stockUnitCode: item.unitCode,
                    unitCode: row.unitCode || item.unitCode,
                  }
                : row,
            ),
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
  const dosesInformadas = Number(dosesPerPackage.trim()) > 0;
  const mostrarDoses = dosesObrigatorias || dosesPerPackage.trim() !== "";

  /*
   * O campo de doses tem duas mensagens de erro independentes e elas podem
   * aparecer juntas — a descrição soma os dois ids em vez de escolher um.
   */
  const dosesErrorIds = [
    ...(dosesObrigatorias && !dosesInformadas ? ["version-doses-required-error"] : []),
    ...(fieldErrors["dosesPerPackage"] ? ["version-dosesPerPackage-error"] : []),
  ];

  function optionsForRow(row: ComponentRow): ItemOption[] {
    const usedByOtherRows = new Set(components.filter((c) => c.key !== row.key).map((c) => c.itemId));
    const base = activeItems.filter((item) => !usedByOtherRows.has(item.id));
    if (row.itemId && !base.some((item) => item.id === row.itemId)) {
      return [
        ...base,
        {
          id: row.itemId,
          code: row.itemCode,
          name: row.itemName,
          unitCode: row.stockUnitCode,
          unitDimension: "",
          active: row.itemActive,
        },
      ];
    }
    return base;
  }

  function unitOptionsForRow(row: ComponentRow): UnitOfMeasureDTO[] {
    const selected = activeItems.find((item) => item.id === row.itemId);
    if (!selected) return units;
    return units.filter((unit) => unit.dimension === selected.unitDimension);
  }

  function handleAddComponent() {
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
        // Componente novo herda o modo da versão: numa fórmula por dose, a
        // linha por dose é o caso normal.
        basis: calculationMode === "PER_DOSE" ? "PER_DOSE" : "FIXED_BASIS",
        // Default do domínio: a Veridi fornece, salvo declaração explícita.
        supplyResponsibility: "VERIDI",
        purityPercentApplied: "",
        overagePercent: "",
        // Componente novo nasce FÍSICO: aplicar ajuste é escolha explícita.
        quantityMode: "PHYSICAL_DIRECT",
        applyPurityAdjustment: false,
        applyOverageAdjustment: false,
        notes: "",
        stockEquivalentQuantity: "",
        physicalPerUnit: null,
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
      prev.map((row) =>
        row.key === key
          ? {
              ...row,
              itemId,
              itemCode: item?.code ?? "",
              itemName: item?.name ?? "",
              itemActive: item?.active ?? true,
              stockUnitCode: item?.unitCode ?? "",
              unitCode: item?.unitCode ?? "",
            }
          : row,
      ),
    );
  }

  function handleComponentFieldChange<K extends keyof ComponentRow>(
    key: string,
    field: K,
    value: ComponentRow[K],
  ) {
    setComponents((prev) => prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  /**
   * Troca o modo da linha e desliga os ajustes ao sair do modo teórico.
   *
   * As caixas de pureza e overage só existem na tela sob
   * `THEORETICAL_WITH_ADJUSTMENTS`. Guardar `applyPurityAdjustment: true`
   * debaixo de `PHYSICAL_DIRECT` seria estado invisível: o cálculo ignora a
   * marca hoje, e voltar o modo depois religaria a correção sem ninguém ter
   * marcado nada nesta sessão — a autorização silenciosa que esta capability
   * existe para acabar.
   *
   * Desmarcar é a perda recuperável: quem voltar ao modo teórico vê as caixas
   * vazias e remarca. O contrário não se vê.
   */
  function trocarModo(key: string, modo: FormulationComponentQuantityMode) {
    setComponents((prev) =>
      prev.map((row) =>
        row.key === key
          ? {
              ...row,
              quantityMode: modo,
              ...(modo === "PHYSICAL_DIRECT"
                ? { applyPurityAdjustment: false, applyOverageAdjustment: false }
                : {}),
            }
          : row,
      ),
    );
  }

  function temAlteracaoPendente() {
    // Rascunho com campo ilegível não serializa — e é alteração pendente por
    // definição: o que está na tela não é o que está gravado.
    try {
      return JSON.stringify(montarRascunho()) !== gravado.current;
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
      basisQuantity: exigirDecimal(basisQuantity, "Base da formulação"),
      calculationMode,
      // Doses por embalagem é inteiro: segue como está.
      dosesPerPackage: dosesPerPackage.trim() || null,
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
          quantity: exigirDecimal(row.quantity, doItem("Quantidade")),
          unitCode: row.unitCode,
          basis: row.basis,
          supplyResponsibility: row.supplyResponsibility,
          // Campo vazio = fator DESCONHECIDO (null), nunca 100%/0% implícito.
          purityPercentApplied: exigirDecimalOpcional(row.purityPercentApplied, doItem("Pureza %")),
          overagePercent: exigirDecimalOpcional(row.overagePercent, doItem("Overage %")),
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
    if (basisQuantity.trim() === "") erros["basisQuantity"] = "Base da formulação é obrigatória.";
    else if (parseDecimalInput(basisQuantity) === null) {
      erros["basisQuantity"] = mensagemDecimalInvalido("Base da formulação");
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
    for (const row of components) {
      for (const campo of CAMPOS_DO_COMPONENTE) {
        if (!erros[chaveDeErro(row.key, campo)]) continue;
        if (CAMPOS_DO_PAINEL.includes(campo)) {
          setAjustesAbertos((prev) => ({ ...prev, [row.key]: true }));
        }
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
    setSaving(true);
    try {
      await salvarRascunho();
    } finally {
      setSaving(false);
    }
  }

  /**
   * O raio de impacto é buscado ao ABRIR o diálogo, não a cada render: a
   * pergunta só existe no momento em que ainda dá para cancelar.
   */
  async function abrirDialogoDeAtivacao() {
    if (!versionId) return;
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
    setSaving(true);
    setError(null);
    try {
      if (temAlteracaoPendente()) {
        const salvou = await salvarRascunho();
        if (!salvou) return;
      }
      const updated = await activateFormulationVersion(versionId);
      setVersion(updated);
      syncFromServer(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao ativar formulação");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateNewVersion() {
    if (!versionId) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createNewFormulationVersion(versionId);
      navigate(`/producao/formulacoes/${productId}/versoes/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar nova versão");
    } finally {
      setSaving(false);
    }
  }

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
          title="Produto e base"
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

          <div className="field field--narrow">
            <label htmlFor="version-basis">
              Base da formulação ({version.outputUnitCode}) <span className="req">*</span>{" "}
              <Dica id="formulacao.base" />
            </label>
            {isDraft ? (
              <input
                id="version-basis"
                type="text"
                inputMode="decimal"
                value={basisQuantity}
                onChange={(event) => setBasisQuantity(event.target.value)}
                /* Liga campo, `aria-invalid` e a mensagem, para leitor de tela também. */
                {...(fieldErrors["basisQuantity"]
                  ? {
                      "aria-invalid": true as const,
                      "aria-describedby": "version-basisQuantity-error",
                    }
                  : {})}
              />
            ) : (
              <p className="field-readonly-value">
                {formatQuantity(version.basisQuantity)} {version.outputUnitCode}
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
            <p className="field__hint">
              Base fixa: as quantidades produzem a base declarada. Por dose: a fórmula é declarada
              por dose do produto acabado.
            </p>
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
                Doses por embalagem {dosesObrigatorias && <span className="req">*</span>}
              </label>
              {isDraft ? (
                <input
                  id="version-doses"
                  type="text"
                  inputMode="numeric"
                  value={dosesPerPackage}
                  onChange={(event) => setDosesPerPackage(event.target.value)}
                  /* Liga campo, `aria-invalid` e as mensagens, para leitor de tela também. */
                  {...(dosesErrorIds.length > 0
                    ? {
                        "aria-invalid": true as const,
                        "aria-describedby": dosesErrorIds.join(" "),
                      }
                    : {})}
                />
              ) : (
                <p className="field-readonly-value">{version.dosesPerPackage ?? "—"}</p>
              )}
              <p className="field__hint">
                Usado para calcular a quantidade total de componentes definidos por dose.
              </p>
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
        </FormSection>

        <FormSection
          title="Componentes"
          subtitle="Fornecimento Cliente = material que o cliente envia (exige produto vinculado a cliente). Cada componente declara se a quantidade informada já é física ou se o sistema deve calculá-la — pureza e overage só são aplicados quando explicitamente marcados. Embalagem normalmente usa base por unidade acabada."
        >
          <div className="table-container">
            {/*
              Sete colunas, não dez. Medido em 1440×900 antes desta rodada: a
              tabela tinha 1681px numa área de 1088px, e três colunas — ajustes,
              equivalente e físico — nasciam fora da tela. A unidade de estoque
              passou a morar sob o item; quantidade e unidade dividem a célula;
              equivalente e físico dividem outra, cada um com o seu rótulo. A
              ação da linha continua fixa à direita.
            */}
            <table className="table table--sticky-actions table--formulacao">
              <thead>
                <tr>
                  <th className="col-item">Item</th>
                  <th className="col-base">Base</th>
                  <th className="col-fornecimento">
                    Fornecimento <Dica id="formulacao.fornecimento" />
                  </th>
                  <th className="col-quantidade is-numeric">Quantidade · unidade</th>
                  <th className="col-ajustes">
                    Ajustes da quantidade <Dica id="formulacao.pureza" />
                  </th>
                  <th className="col-estoque is-numeric">
                    Equivalente estoque <Dica id="formulacao.equivalenteEstoque" /> e físico por unidade
                  </th>
                  {isDraft && <th aria-hidden="true" />}
                </tr>
              </thead>
              <tbody>
                {components.map((row) => {
                  /*
                    O físico ENQUANTO se digita, não só depois de salvar.
                    A prévia usa a mesma função que a API chama; quando a conta
                    não é possível, cai no valor gravado, e `null` vira
                    travessão — nunca zero.
                  */
                  const previa = isDraft
                    ? previaDoComponente(
                        row,
                        basisQuantity,
                        dosesPerPackage.trim() === "" ? null : Number(dosesPerPackage),
                        units,
                      )
                    : null;
                  const aberto = ajustesAbertos[row.key] === true;
                  const fisicoExibido = previa?.fisico ?? row.physicalPerUnit;
                  const equivalenteExibido = previa?.teorico ?? row.stockEquivalentQuantity;
                  const nomeDoItem = row.itemCode || "componente";
                  /** Atributos de erro de um campo desta linha, quando há erro. */
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
                  return (
                  <Fragment key={row.key}>
                  <tr className={CAMPOS_DO_COMPONENTE.some((campo) => erroDe(campo)) ? "is-invalid" : undefined}>
                    <td className="col-item">
                      {isDraft ? (
                        <SearchableEntitySelect
                          id={`componente-${row.key}`}
                          value={row.itemId}
                          onChange={(itemId) => handleComponentItemChange(row.key, itemId)}
                          placeholder="Digite código ou nome do item…"
                          options={optionsForRow(row).map(opcaoDoItem)}
                          onSearch={(termo) => buscarItens(row, termo)}
                          canCreate
                          createLabel="Novo item de estoque"
                          onCreateNew={() =>
                            origem.goCreate({
                              route: "/cadastros/itens/novo",
                              fieldKey: "itemId",
                              entityType: "item",
                              // Qual linha pediu — o item volta para ela.
                              context: { rowKey: row.key },
                            })
                          }
                        />
                      ) : (
                        <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
                      )}
                      {/* A unidade de estoque era uma coluna: 110px para dizer
                          "kg". Sob o item ela continua visível e a linha ganha
                          a largura de volta. */}
                      <span className="cell-sub">
                        {row.stockUnitCode ? `Estoque em ${row.stockUnitCode}` : "Estoque: —"}
                        {!row.itemActive && " · item inativo, mantido pelo histórico"}
                      </span>
                    </td>
                    <td className="col-base">
                      {isDraft ? (
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
                      ) : (
                        FORMULATION_COMPONENT_BASIS_LABELS[row.basis]
                      )}
                    </td>
                    <td className="col-fornecimento">
                      {isDraft ? (
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
                      ) : (
                        SUPPLY_RESPONSIBILITY_LABELS[row.supplyResponsibility]
                      )}
                    </td>
                    <td className="col-quantidade is-numeric">
                      {isDraft ? (
                        <>
                          <div className="quantidade-unidade">
                            <input
                              id={idDoCampo(row.key, "quantity")}
                              type="text"
                              inputMode="decimal"
                              placeholder="0"
                              /* O campo vive numa celula de tabela e nao tem
                                 <label> proprio: sem isto o unico nome acessivel
                                 seria o placeholder "0", que nao diz nada. */
                              aria-label={`Quantidade de ${nomeDoItem}`}
                              value={row.quantity}
                              onChange={(event) =>
                                handleComponentFieldChange(row.key, "quantity", event.target.value)
                              }
                              {...marcaDeErro("quantity")}
                            />
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
                              {unitOptionsForRow(row).map((unit) => (
                                <option key={unit.code} value={unit.code}>
                                  {unit.code}
                                </option>
                              ))}
                            </select>
                          </div>
                          {mensagemDeErro("quantity")}
                          {mensagemDeErro("unitCode")}
                        </>
                      ) : (
                        `${row.quantity} ${row.unitCode}`
                      )}
                    </td>
                    {/*
                      AJUSTES ATRÁS DE UM BOTÃO, não soltos na linha.

                      Pureza e overage são de duas naturezas ao mesmo tempo:
                      documentação de auditoria e, quando autorizados, entrada de
                      cálculo. Deixar os dois campos crus lado a lado fazia o
                      preenchimento parecer a autorização — e era, até esta
                      capability: bastava digitar a pureza para a necessidade
                      física mudar.

                      A célula guarda só o RESUMO do estado; o painel abre numa
                      linha própria, logo abaixo.
                    */}
                    <td className="col-ajustes">
                      <button
                        type="button"
                        className="ajuste-quantidade__botao"
                        aria-expanded={aberto}
                        aria-controls={`ajustes-${row.key}`}
                        onClick={() =>
                          setAjustesAbertos((prev) => ({ ...prev, [row.key]: !prev[row.key] }))
                        }
                      >
                        <span aria-hidden="true">{aberto ? "▾" : "▸"}</span>{" "}
                        {row.quantityMode === "THEORETICAL_WITH_ADJUSTMENTS"
                          ? row.applyPurityAdjustment || row.applyOverageAdjustment
                            ? `Calculada${row.applyPurityAdjustment ? " · pureza" : ""}${row.applyOverageAdjustment ? " · overage" : ""}`
                            : /*
                                Modo teórico sem ajuste marcado NÃO calcula nada.
                                Dizer só "Calculada" aqui afirmava uma correção
                                que não está ligada — o erro contrário ao antigo,
                                e igualmente silencioso.
                              */
                              "Calculada · nenhum ajuste marcado"
                          : "Física informada"}
                        {(row.purityPercentApplied || row.overagePercent) &&
                          row.quantityMode === "PHYSICAL_DIRECT" && (
                            <span className="ajuste-quantidade__nota">
                              {" · registrado, não aplicado"}
                            </span>
                          )}
                        {(erroDe("purityPercentApplied") || erroDe("overagePercent")) && (
                          <span className="ajuste-quantidade__nota ajuste-quantidade__nota--erro">
                            {" · corrigir"}
                          </span>
                        )}
                      </button>
                    </td>
                    {/* Dois números, dois rótulos, uma célula: eram as duas
                        colunas que nasciam fora da tela. */}
                    <td className="col-estoque is-numeric">
                      <div className="estoque-valor">
                        <span className="estoque-valor__rotulo">Equiv.</span>{" "}
                        <span className="estoque-valor__numero estoque-valor--equivalente">
                          {formatQuantityWithUnit(equivalenteExibido, row.stockUnitCode)}
                        </span>
                      </div>
                      <div className="estoque-valor">
                        <span className="estoque-valor__rotulo">Físico/un.</span>{" "}
                        <span className="estoque-valor__numero estoque-valor--fisico">
                          {formatQuantityWithUnit(fisicoExibido, row.stockUnitCode)}
                        </span>
                      </div>
                    </td>
                    {isDraft && (
                      <td>
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
                  {/*
                    O painel de ajustes é uma LINHA, não uma célula.

                    Dentro da célula ele herdava a rolagem horizontal da tabela:
                    numa tela de 1500px o aviso de dupla correção ficava a 20%
                    visível, e a única pista de que havia mais texto era a sombra
                    de borda — que significa "tem mais coluna", não "esta frase
                    continua". Aviso de segurança não pode depender de rolar a
                    tabela para o lado.
                  */}
                  {aberto && (
                    <tr className="ajuste-quantidade__linha">
                      <td colSpan={isDraft ? 7 : 6} id={`ajustes-${row.key}`}>
                        <div className="ajuste-quantidade__corpo">
                          {isDraft ? (
                            <>
                              <fieldset className="ajuste-quantidade__modos">
                                <legend>O que a quantidade informada significa</legend>
                                {(["PHYSICAL_DIRECT", "THEORETICAL_WITH_ADJUSTMENTS"] as const).map(
                                  (modo) => (
                                    <label key={modo} className="ajuste-quantidade__modo">
                                      <input
                                        type="radio"
                                        name={`modo-${row.key}`}
                                        /* O nome acessível é só o rótulo; a
                                           descrição vem por `aria-describedby`. */
                                        aria-label={FORMULATION_QUANTITY_MODE_LABELS[modo]}
                                        aria-describedby={`modo-${row.key}-${modo}-descricao`}
                                        checked={row.quantityMode === modo}
                                        onChange={() => trocarModo(row.key, modo)}
                                      />
                                      <span className="ajuste-quantidade__modo-texto">
                                        <strong>{FORMULATION_QUANTITY_MODE_LABELS[modo]}</strong>
                                        <span
                                          className="ajuste-quantidade__descricao"
                                          id={`modo-${row.key}-${modo}-descricao`}
                                        >
                                          {FORMULATION_QUANTITY_MODE_DESCRIPTIONS[modo]}
                                        </span>
                                      </span>
                                    </label>
                                  ),
                                )}
                              </fieldset>
                              {/*
                                Trocar o modo não liga ajuste nenhum — de
                                propósito: marcar é a autorização, e ligar
                                sozinho seria a aplicação silenciosa que esta
                                capability tirou do sistema. A frase diz o estado
                                REAL: com nada marcado, nada é corrigido.
                              */}
                              {row.quantityMode === "THEORETICAL_WITH_ADJUSTMENTS" && (
                                <>
                                  <p className="field__hint">
                                    {row.applyPurityAdjustment || row.applyOverageAdjustment
                                      ? "O sistema calcula a quantidade física usada em novas Ordens de Produção e no CMV desta versão."
                                      : "Nenhum ajuste marcado. Marque abaixo o que deve ser corrigido: enquanto nada estiver marcado, a quantidade física continua igual à informada."}
                                  </p>
                                  <p className="field__hint ajuste-quantidade__aviso">
                                    Não marque a correção se a quantidade informada já
                                    estiver corrigida — ela seria aplicada duas vezes.
                                  </p>
                                </>
                              )}
                            </>
                          ) : (
                            <p className="field__hint">
                              {FORMULATION_QUANTITY_MODE_LABELS[row.quantityMode]} — congelado
                              nesta versão. Mudar exige uma versão nova.
                            </p>
                          )}

                          {/*
                            Em modo físico informado os campos de pureza e overage
                            aparecem SEM caixa de marcar. Sem esta linha, nada
                            junto deles diz que preencher não aplica — a frase
                            existia só no ⓘ do cabeçalho da coluna, que quase
                            ninguém abre. É a regra central desta capability, e
                            ela precisa estar onde a pessoa digita.
                          */}
                          {row.quantityMode === "PHYSICAL_DIRECT" && (
                            <p className="field__hint">
                              Pureza e overage aqui são registro de auditoria:
                              preencher não aplica correção nenhuma.
                            </p>
                          )}
                          <div className="ajuste-quantidade__campos">
                            <label>
                              {isDraft && row.quantityMode === "THEORETICAL_WITH_ADJUSTMENTS" && (
                                <input
                                  type="checkbox"
                                  aria-label="Corrigir pela pureza"
                                  checked={row.applyPurityAdjustment}
                                  onChange={(event) =>
                                    handleComponentFieldChange(
                                      row.key,
                                      "applyPurityAdjustment",
                                      event.target.checked,
                                    )
                                  }
                                />
                              )}
                              <span>Pureza %</span>
                              {isDraft ? (
                                <input
                                  id={idDoCampo(row.key, "purityPercentApplied")}
                                  type="text"
                                  inputMode="decimal"
                                  aria-label="Pureza aplicada"
                                  placeholder="—"
                                  value={row.purityPercentApplied}
                                  onChange={(event) =>
                                    handleComponentFieldChange(
                                      row.key,
                                      "purityPercentApplied",
                                      event.target.value,
                                    )
                                  }
                                  {...marcaDeErro("purityPercentApplied")}
                                />
                              ) : (
                                <strong>{row.purityPercentApplied || "—"}</strong>
                              )}
                            </label>
                            {mensagemDeErro("purityPercentApplied")}

                            <label>
                              {isDraft && row.quantityMode === "THEORETICAL_WITH_ADJUSTMENTS" && (
                                <input
                                  type="checkbox"
                                  aria-label="Aplicar overage"
                                  checked={row.applyOverageAdjustment}
                                  onChange={(event) =>
                                    handleComponentFieldChange(
                                      row.key,
                                      "applyOverageAdjustment",
                                      event.target.checked,
                                    )
                                  }
                                />
                              )}
                              <span>Overage %</span>
                              {isDraft ? (
                                <input
                                  id={idDoCampo(row.key, "overagePercent")}
                                  type="text"
                                  inputMode="decimal"
                                  aria-label="Overage do componente"
                                  placeholder="—"
                                  value={row.overagePercent}
                                  onChange={(event) =>
                                    handleComponentFieldChange(
                                      row.key,
                                      "overagePercent",
                                      event.target.value,
                                    )
                                  }
                                  {...marcaDeErro("overagePercent")}
                                />
                              ) : (
                                <strong>{row.overagePercent || "—"}</strong>
                              )}
                            </label>
                            {mensagemDeErro("overagePercent")}
                          </div>

                          {/*
                            A conta vem do servidor (`physicalPerUnit`), que a
                            calcula pelo motor canônico. A explicação não pode ser
                            um segundo motor: se recalculasse aqui, passaria a
                            poder discordar do número que manda.
                          */}
                          {/*
                            `div`, não `p`: o CalcHint emite parágrafos, e `<p>`
                            dentro de `<p>` é HTML inválido — o navegador fecha o
                            de fora antes da hora e o React reclama no console. O
                            bloco é uma grade de linhas, não um parágrafo.
                          */}
                          {fisicoExibido !== null && (
                            <div className="ajuste-quantidade__resultado">
                              <span>
                                Quantidade informada:{" "}
                                <strong>
                                  {formatQuantity(row.quantity)} {row.unitCode}
                                </strong>
                              </span>
                              {/*
                                "POR UNIDADE" no rótulo, não subentendido.

                                As duas linhas ficavam lado a lado com
                                denominadores diferentes: a informada é para a
                                base inteira da fórmula, a física é para uma
                                unidade. Numa base de 300, isso mostrava
                                "22 kg" acima de "0,091111 kg" sem nada
                                explicando a razão de 240 vezes entre elas.
                              */}
                              <span>
                                Quantidade física por unidade:{" "}
                                <strong>
                                  {formatQuantity(fisicoExibido)} {row.stockUnitCode}
                                </strong>
                              </span>
                              <CalcHint
                                label="Quantidade física"
                                operandos={operandosDoFisico(
                                  row,
                                  basisQuantity,
                                  dosesPerPackage.trim() === "" ? null : Number(dosesPerPackage),
                                  units,
                                )}
                                resultado={`${formatQuantity(fisicoExibido)} ${row.stockUnitCode}`}
                                nota={
                                  row.quantityMode === "THEORETICAL_WITH_ADJUSTMENTS"
                                    ? "Calculado pelo mesmo motor que a Ordem de Produção e o CMV usam."
                                    : row.purityPercentApplied || row.overagePercent
                                      ? "Quantidade física informada. Pureza e overage estão registrados, não aplicados."
                                      : "Quantidade física informada."
                                }
                              />
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  );
                })}

                {components.length === 0 && (
                  <tr>
                    <td colSpan={isDraft ? 7 : 6} className="table__empty">
                      Nenhum componente adicionado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {isDraft && (
            <div className="line-actions">
              <button type="button" className="btn btn--secondary btn--sm" onClick={handleAddComponent}>
                + Adicionar componente
              </button>
            </div>
          )}
        </FormSection>

        {costEstimate && (
          <FormSection
            title="Custo estimado de materiais"
            subtitle="Estimativa de HOJE, com a MESMA escolha de fonte do cálculo de custo e do CMV: compra real dos últimos 30 dias, depois 90 dias, depois a última compra, depois oferta válida de fornecedor, depois referência manual. Lida a cada abertura e nunca gravada na versão — o CMV e a precificação leem a base CONGELADA do cálculo salvo, e é ele que vale como documento."
          >
            <div className="table-container">
              <table className="table table--custo-estimado">
                <thead>
                  <tr>
                    <th>Componente</th>
                    <th className="is-numeric">Quantidade</th>
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
                        {formatQuantity(component.normalizedQuantity)} {component.stockUnitCode}
                        <br />
                        <span className="field__hint">
                          {formatQuantity(component.formulaQuantity)} {component.formulaUnitCode}
                        </span>
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
              <dt>Custo estimado da base ({formatQuantity(costEstimate.basisQuantity)} {costEstimate.outputUnitCode})</dt>
              <dd>
                {costEstimate.estimatedMaterialCost
                  ? formatBRL(costEstimate.estimatedMaterialCost)
                  : "Indisponível"}
              </dd>
              <dt>Custo estimado por unidade</dt>
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
          {isDraft && (
            <button type="button" className="btn btn--secondary" disabled={saving} onClick={handleSaveDraft}>
              {saving ? "Salvando…" : "Salvar rascunho"}
            </button>
          )}
          {isDraft && (
            <button
              type="button"
              className="btn btn--accent"
              disabled={saving}
              onClick={() => void abrirDialogoDeAtivacao()}
            >
              Ativar versão
            </button>
          )}
          {version.status === "ACTIVE" && (
            <button
              type="button"
              className="btn btn--accent"
              disabled={saving}
              onClick={handleCreateNewVersion}
            >
              Criar nova versão
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
