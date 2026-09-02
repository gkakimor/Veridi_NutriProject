import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  FormulationActivationImpactDTO,
  FormulationCalculationMode,
  FormulationComponentBasis,
  FormulationCostEstimateDTO,
  FormulationVersionDTO,
  SupplyResponsibility,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import {
  COST_QUALITY_LABELS,
  COST_SOURCE_LABELS,
  FORMULATION_CALCULATION_MODES,
  FORMULATION_CALCULATION_MODE_LABELS,
  FORMULATION_COMPONENT_BASES,
  FORMULATION_COMPONENT_BASIS_LABELS,
  FORMULATION_VERSION_STATUS_LABELS,
  SUPPLY_RESPONSIBILITIES,
  SUPPLY_RESPONSIBILITY_LABELS,
} from "@veridi/shared";
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
import { ProductRelatedLinks } from "../../components/ProductRelatedLinks";
import { ProjectOriginLink } from "../../components/ProjectOriginLink";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";

interface ItemOption {
  id: string;
  code: string;
  name: string;
  unitCode: string;
  unitDimension: string;
  active: boolean;
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
    notes: component.notes ?? "",
    stockEquivalentQuantity: component.stockEquivalentQuantity,
    physicalPerUnit: component.physicalPerUnit,
  };
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

  const syncFromServer = useCallback((dto: FormulationVersionDTO) => {
    setBasisQuantity(dto.basisQuantity);
    setCalculationMode(dto.calculationMode);
    setDosesPerPackage(dto.dosesPerPackage === null ? "" : String(dto.dosesPerPackage));
    setNotes(dto.notes ?? "");
    setComponents(dto.components.map(rowFromDTO));
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
      listItems({ type: "RAW_MATERIAL", active: true, pageSize: 1000 }),
      listItems({ type: "PACKAGING", active: true, pageSize: 1000 }),
    ])
      .then(([raw, packaging]) =>
        setActiveItems(
          [...raw.items, ...packaging.items].map((item) => ({
            id: item.id,
            code: item.code,
            name: item.name,
            unitCode: item.unitCode,
            unitDimension: item.unit.dimension,
            active: item.active,
          })),
        ),
      )
      .catch(() => setActiveItems([]));
    listUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

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

  function handleComponentFieldChange(
    key: string,
    field: "quantity" | "unitCode" | "notes" | "purityPercentApplied" | "overagePercent",
    value: string,
  ) {
    setComponents((prev) => prev.map((row) => (row.key === key ? { ...row, [field]: value } : row)));
  }

  async function handleSaveDraft() {
    if (!versionId) return;
    setSaving(true);
    setError(null);
    setFieldErrors({});

    const componentsPayload = components
      .filter((row) => row.itemId)
      .map((row) => ({
        itemId: row.itemId,
        quantity: row.quantity.trim(),
        unitCode: row.unitCode,
        basis: row.basis,
        supplyResponsibility: row.supplyResponsibility,
        // Campo vazio = fator DESCONHECIDO (null), nunca 100%/0% implícito.
        purityPercentApplied: row.purityPercentApplied.trim() || null,
        overagePercent: row.overagePercent.trim() || null,
        ...(row.notes.trim() ? { notes: row.notes.trim() } : {}),
      }));

    try {
      const updated = await updateFormulationVersion(versionId, {
        basisQuantity: basisQuantity.trim(),
        calculationMode,
        dosesPerPackage: dosesPerPackage.trim() || null,
        notes: notes.trim(),
        components: componentsPayload,
      });
      setVersion(updated);
      syncFromServer(updated);
    } catch (err) {
      if (err instanceof ApiValidationError) {
        const nextFieldErrors: Record<string, string> = {};
        for (const issue of err.issues) nextFieldErrors[issue.path] = issue.message;
        setFieldErrors(nextFieldErrors);
        setError("Corrija os campos destacados.");
      } else {
        setError(err instanceof Error ? err.message : "Falha ao salvar rascunho");
      }
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

  async function handleActivate() {
    if (!versionId) return;
    setActivateDialogOpen(false);
    setSaving(true);
    setError(null);
    try {
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
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate(`/producao/formulacoes/${productId ?? ""}`)}
          >
            ← Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Produção / Formulações / {version.productName}</div>
          <div className="doc-title">
            <h1>Formulação {version.versionLabel}</h1>
            <span className={statusBadgeClass(version.status)}>
              {FORMULATION_VERSION_STATUS_LABELS[version.status]}
            </span>
          </div>
        </div>
        <div className="table__actions">
          <ProjectOriginLink productId={productId} />
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate(`/producao/formulacoes/${productId}`)}
          >
            ← Voltar
          </button>
        </div>
      </div>

      <ProductRelatedLinks productId={productId} current="formulation" />

      <div className="doc-body">
        {error && <p className="form-alert">{error}</p>}

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
              />
            ) : (
              <p className="field-readonly-value">
                {version.basisQuantity} {version.outputUnitCode}
              </p>
            )}
            {fieldErrors["basisQuantity"] && (
              <p className="field__error">{fieldErrors["basisQuantity"]}</p>
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
                />
              ) : (
                <p className="field-readonly-value">{version.dosesPerPackage ?? "—"}</p>
              )}
              <p className="field__hint">
                Usado para calcular a quantidade total de componentes definidos por dose.
              </p>
              {dosesObrigatorias && !dosesInformadas && (
                <p className="field__error">
                  Há componentes calculados por dose. Sem este número a formulação não pode ser
                  ativada — e a quantidade de material não existe.
                </p>
              )}
              {fieldErrors["dosesPerPackage"] && (
                <p className="field__error">{fieldErrors["dosesPerPackage"]}</p>
              )}
            </div>
          )}
        </FormSection>

        <FormSection
          title="Componentes"
          subtitle="Fornecimento Cliente = material que o cliente envia (exige produto vinculado a cliente). Pureza vazia = desconhecida (nenhuma correção é aplicada). Embalagem normalmente usa base por unidade acabada. O físico por unidade já inclui pureza e overage."
        >
          <div className="table-container">
            {/* Dez colunas não cabem na largura de leitura: a ação da linha era
                a primeira a sair de cena. Fixa à direita, ela continua ao
                alcance mesmo com a tabela rolando. */}
            <table className="table table--sticky-actions">
              <thead>
                <tr>
                  <th>Item</th>
                  {/* Mostra `stockUnitCode`: chamar de "Tipo" fazia ler
                      categoria do material onde está a unidade de estoque. */}
                  <th>Un. estoque</th>
                  <th>Base</th>
                  <th>
                    Fornecimento <Dica id="formulacao.fornecimento" />
                  </th>
                  <th className="is-numeric">Quantidade</th>
                  <th>Unidade</th>
                  <th>
                    Pureza % <Dica id="formulacao.pureza" />
                  </th>
                  <th>
                    Overage % <Dica id="formulacao.overage" />
                  </th>
                  <th>
                    Equivalente estoque <Dica id="formulacao.equivalenteEstoque" />
                  </th>
                  <th>Físico / unidade</th>
                  {isDraft && <th aria-hidden="true" />}
                </tr>
              </thead>
              <tbody>
                {components.map((row) => (
                  <tr key={row.key}>
                    <td>
                      {isDraft ? (
                        <SearchableEntitySelect
                          id={`componente-${row.key}`}
                          value={row.itemId}
                          onChange={(itemId) => handleComponentItemChange(row.key, itemId)}
                          placeholder="Digite código ou nome do item…"
                          options={optionsForRow(row).map((item) => ({
                            id: item.id,
                            code: item.code,
                            name: item.name,
                            ...(item.active ? {} : { hint: "inativo" }),
                          }))}
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
                        <>
                          <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
                        </>
                      )}
                      {!row.itemActive && (
                        <div className="field__hint">Item inativo — mantido pelo histórico.</div>
                      )}
                    </td>
                    <td>{row.stockUnitCode || "—"}</td>
                    <td>
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
                    <td>
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
                    <td className="is-numeric">
                      {isDraft ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={row.quantity}
                          onChange={(event) =>
                            handleComponentFieldChange(row.key, "quantity", event.target.value)
                          }
                        />
                      ) : (
                        row.quantity
                      )}
                    </td>
                    <td>
                      {isDraft ? (
                        <select
                          value={row.unitCode}
                          onChange={(event) =>
                            handleComponentFieldChange(row.key, "unitCode", event.target.value)
                          }
                        >
                          <option value="">—</option>
                          {unitOptionsForRow(row).map((unit) => (
                            <option key={unit.code} value={unit.code}>
                              {unit.code}
                            </option>
                          ))}
                        </select>
                      ) : (
                        row.unitCode
                      )}
                    </td>
                    <td>
                      {isDraft ? (
                        <input
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
                        />
                      ) : (
                        row.purityPercentApplied || "—"
                      )}
                    </td>
                    <td>
                      {isDraft ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label="Overage do componente"
                          placeholder="—"
                          value={row.overagePercent}
                          onChange={(event) =>
                            handleComponentFieldChange(row.key, "overagePercent", event.target.value)
                          }
                        />
                      ) : (
                        row.overagePercent || "—"
                      )}
                    </td>
                    <td>
                      {row.stockEquivalentQuantity} {row.stockUnitCode}
                    </td>
                    <td>
                      {row.physicalPerUnit ? `${row.physicalPerUnit} ${row.stockUnitCode}` : "—"}
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
                ))}

                {components.length === 0 && (
                  <tr>
                    <td colSpan={isDraft ? 11 : 10} className="table__empty">
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
            subtitle="Estimativa de HOJE: lê a referência de custo vigente a cada abertura e nunca é gravada na versão. O CMV e a precificação leem a base CONGELADA do cálculo salvo — por isso os dois podem discordar, e é o cálculo salvo que vale como documento."
          >
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Componente</th>
                    <th className="is-numeric">Quantidade</th>
                    <th>Referência unitária</th>
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
                        {component.normalizedQuantity} {component.stockUnitCode}
                        <br />
                        <span className="field__hint">
                          {component.formulaQuantity} {component.formulaUnitCode}
                        </span>
                      </td>
                      <td>{formatBRL(component.unitCost)}</td>
                      <td>
                        <span
                          className={
                            component.costSource === "NO_COST" ? "badge badge--warn" : "badge badge--neutral"
                          }
                        >
                          {COST_SOURCE_LABELS[component.costSource]}
                        </span>
                      </td>
                      <td className="is-numeric">{formatBRL(component.estimatedComponentCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="definition-list">
              <dt>Custo estimado da base ({costEstimate.basisQuantity} {costEstimate.outputUnitCode})</dt>
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

            {costEstimate.quality === "PARTIAL" && (
              <p className="field__hint">
                Custo parcial: {costEstimate.missingCostItems.join(", ")} sem referência de custo. O
                subtotal conhecido ({formatBRL(costEstimate.knownCostSubtotal)}) não representa o custo
                total da fórmula.{" "}
                {/* Dizer o que falta sem dizer onde resolver deixa a pessoa
                    parada: a referência de custo vem do preço do fornecedor
                    para o item, e é lá que ela é corrigida. */}
                <Link to="/compras/item-fornecedor">
                  Definir preço de fornecedor para esses itens
                </Link>
                .
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
