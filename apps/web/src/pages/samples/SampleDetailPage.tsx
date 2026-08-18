import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  InventoryLotBreakdownDTO,
  ItemDTO,
  ProjectSampleDTO,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import { PROJECT_SAMPLE_STATUS_LABELS, SAMPLE_ATTACHMENT_TYPES, ownerLabel } from "@veridi/shared";
import { AttachmentsSection } from "../../components/AttachmentsSection";
import { FormSection } from "../../components/FormSection";
import { FlowContext } from "../../components/FlowContext";
import { useAuth } from "../../app/AuthProvider";
import { getInventoryItem } from "../../lib/inventory-api";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { listItems } from "../../lib/items-api";
import { listUnits } from "../../lib/units-api";
import {
  approveSample,
  cancelSample,
  getSample,
  produceSample,
  registerSampleConsumption,
  rejectSample,
} from "../../lib/samples-api";
import { sampleStatusBadgeClass } from "./SamplesPage";
import { EntityLink } from "../../components/EntityLink";

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

/**
 * Detalhe da amostra: consumo real de material, conclusão física e decisão.
 *
 * Três limites que a tela respeita:
 * 1. consumo é ato de produção — Comercial não baixa estoque;
 * 2. aprovar a amostra NÃO aprova o projeto (isso continua sendo ato
 *    comercial, com orçamento aceito);
 * 3. reprovar ou cancelar nunca devolve material ao estoque — o que foi
 *    fisicamente usado continua usado.
 */
export function SampleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [sample, setSample] = useState<ProjectSampleDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [items, setItems] = useState<ItemDTO[]>([]);
  const [units, setUnits] = useState<UnitOfMeasureDTO[]>([]);

  const [itemId, setItemId] = useState("");
  const [lots, setLots] = useState<InventoryLotBreakdownDTO[]>([]);
  const [controlsLot, setControlsLot] = useState(false);
  const [lotCode, setLotCode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [consumptionNotes, setConsumptionNotes] = useState("");

  const [outputQuantity, setOutputQuantity] = useState("");
  const [outputUomCode, setOutputUomCode] = useState("");
  const [productionNotes, setProductionNotes] = useState("");

  const [decisionNotes, setDecisionNotes] = useState("");

  const canConsume = user?.role === "PRODUCTION" || user?.role === "ADMIN";
  const canDecide = user?.role === "COMMERCIAL" || user?.role === "ADMIN";
  const canCancel = canConsume || canDecide;

  const reload = useCallback(() => {
    if (!id) return;
    getSample(id)
      .then((result) => {
        setSample(result);
        setOutputUomCode((current) => current || (result.outputUomCode ?? ""));
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar a amostra"),
      );
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    listItems({ active: true, pageSize: 1000 })
      .then((response) => setItems(response.items))
      .catch(() => setItems([]));
    listUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  // Lotes do item escolhido — mesma leitura de estoque do resto do sistema,
  // sem atalho "porque é amostra".
  useEffect(() => {
    setLotCode("");
    if (!itemId) {
      setLots([]);
      setControlsLot(false);
      return;
    }
    getInventoryItem(itemId)
      .then((detail) => {
        setControlsLot(detail.controlsLot);
        setLots(detail.lots);
      })
      .catch(() => {
        setControlsLot(false);
        setLots([]);
      });
  }, [itemId]);

  async function run(action: () => Promise<ProjectSampleDTO>, onDone?: () => void) {
    setSaving(true);
    setActionError(null);
    try {
      setSample(await action());
      onDone?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Falha ao executar a ação");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <p className="form-alert">{error}</p>;
  if (!sample || !id) return <p>Carregando…</p>;

  const isOpen = sample.status === "DRAFT" || sample.status === "IN_PROGRESS";
  const awaitingDecision = sample.status === "PRODUCED";
  const selectedItem = items.find((item) => item.id === itemId) ?? null;

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">
            <span className="code">{sample.code}</span> — Teste {sample.testLabel}
          </h1>
          <p className="page__subtitle">
            {/* Um link só: o `EntityLink` já leva ao projeto, e envolvê-lo em
                outro `<a>` produzia âncora aninhada — HTML inválido e destino
                imprevisível conforme onde o clique cai. */}
            <EntityLink
              kind="project"
              id={sample.projectId}
              code={sample.projectCode}
              name={sample.projectName}
            />{" "}
            · {sample.customerName} ·{" "}
            <span className={sampleStatusBadgeClass(sample.status)}>
              {PROJECT_SAMPLE_STATUS_LABELS[sample.status]}
            </span>
          </p>
        </div>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => navigate(`/comercial/amostras/${sample.id}/etiqueta`)}
        >
          Etiqueta
        </button>
      </div>

      <FlowContext
        steps={[
          {
            kind: "Projeto",
            code: sample.projectCode,
            path: `/comercial/projetos/${sample.projectId}`,
            detail: sample.customerName,
          },
          { kind: "Amostra", code: sample.code, detail: sample.testLabel, current: true },
        ]}
      />

      {sample.source === "LEGACY_IMPORT" && (
        <p className="field__hint">
          Amostra importada do legado — o desfecho não veio na planilha.
        </p>
      )}

      {actionError && <p className="form-alert">{actionError}</p>}

      <div className="doc-body">
        <FormSection
          title="Dados da amostra"
          subtitle="Amostra não é lote nem ordem de produção — o resultado nunca entra no estoque de produto acabado."
        >
          <dl className="definition-list">
            <dt>Projeto</dt>
            <dd>
              <EntityLink
                kind="project"
                id={sample.projectId}
                code={sample.projectCode}
                name={sample.projectName}
              />
            </dd>
            <dt>Cliente</dt>
            <dd>
              <EntityLink kind="customer" id={sample.customerId} code={sample.customerName} />
            </dd>
            {/* Num projeto com vários produtos, saber o que a amostra testa é
                a informação principal — sem ela T1 e T2 podem ser sabores
                diferentes e a tela não conta a diferença. */}
            <dt>Produto testado</dt>
            <dd>
              {sample.productId ? (
                <EntityLink
                  kind="product"
                  id={sample.productId}
                  code={sample.productCode}
                  name={sample.productName}
                />
              ) : (
                <span className="muted">Produto não identificado</span>
              )}
            </dd>
            <dt>Descrição</dt>
            <dd>{sample.description ?? "—"}</dd>
            <dt>Código legado</dt>
            <dd className="is-code">{sample.externalCode ?? "—"}</dd>
            <dt>Quantidade produzida</dt>
            <dd>
              {sample.outputQuantity
                ? `${sample.outputQuantity} ${sample.outputUomCode ?? ""}`
                : "—"}
            </dd>
            <dt>Observações de produção</dt>
            <dd>{sample.productionNotes ?? "—"}</dd>
            <dt>Criada</dt>
            <dd>
              {formatDateTime(sample.createdAt)} — {sample.createdByName ?? "—"}
            </dd>
            <dt>Produzida</dt>
            <dd>
              {formatDateTime(sample.producedAt)}
              {sample.producedByName ? ` — ${sample.producedByName}` : ""}
            </dd>
            {sample.approvedAt && (
              <>
                <dt>Aprovada</dt>
                <dd>
                  {formatDateTime(sample.approvedAt)} — {sample.approvedByName ?? "—"}
                </dd>
              </>
            )}
            {sample.rejectedAt && (
              <>
                <dt>Reprovada</dt>
                <dd>
                  {formatDateTime(sample.rejectedAt)} — {sample.rejectedByName ?? "—"}
                </dd>
              </>
            )}
            {sample.cancelledAt && (
              <>
                <dt>Cancelada</dt>
                <dd>
                  {formatDateTime(sample.cancelledAt)} — {sample.cancelledByName ?? "—"}
                </dd>
              </>
            )}
            {sample.decisionNotes && (
              <>
                <dt>Parecer</dt>
                <dd>{sample.decisionNotes}</dd>
              </>
            )}
          </dl>
        </FormSection>

        <FormSection
          title="Material consumido"
          subtitle="Saída física real do estoque. Reprovar ou cancelar a amostra não estorna consumo."
        >
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Lote</th>
                  <th>Proprietário</th>
                  <th className="is-numeric">Quantidade</th>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>Observação</th>
                </tr>
              </thead>
              <tbody>
                {sample.consumptions.map((consumption) => (
                  <tr key={consumption.id}>
                    <td>
                      <EntityLink kind="item" id={consumption.itemId} code={consumption.itemCode} name={consumption.itemName} />
                    </td>
                    <td className="is-code">{consumption.lotCode ?? "—"}</td>
                    <td>{ownerLabel(consumption.ownerType, consumption.ownerCustomerName)}</td>
                    <td className="is-numeric">
                      {consumption.quantity} {consumption.uomCode}
                    </td>
                    <td>{formatDateTime(consumption.executedAt)}</td>
                    <td>{consumption.executedByName}</td>
                    <td>{consumption.notes ?? "—"}</td>
                  </tr>
                ))}
                {sample.consumptions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="table__empty">
                      Nenhum consumo registrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {canConsume && isOpen && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  () =>
                    registerSampleConsumption(id, {
                      itemId,
                      ...(lotCode ? { lotCode } : {}),
                      quantity,
                      ...(consumptionNotes.trim() ? { notes: consumptionNotes.trim() } : {}),
                    }),
                  () => {
                    setQuantity("");
                    setConsumptionNotes("");
                    setLotCode("");
                  },
                );
              }}
            >
              <div className="field-grid-2">
                <div className="field">
                  <label htmlFor="sample-item">Item</label>
                  <SearchableEntitySelect
                    id="sample-item"
                    value={itemId}
                    onChange={setItemId}
                    required
                    placeholder="Digite código ou nome do item…"
                    options={items.map((item) => ({
                      id: item.id,
                      code: item.code,
                      name: item.name,
                    }))}
                  />
                </div>

                <div className="field">
                  <label htmlFor="sample-lot">Lote</label>
                  <select
                    id="sample-lot"
                    value={lotCode}
                    onChange={(event) => setLotCode(event.target.value)}
                    disabled={!controlsLot}
                    required={controlsLot}
                  >
                    <option value="">
                      {controlsLot ? "Selecione…" : "Item sem controle de lote"}
                    </option>
                    {lots.map((lot) => (
                      <option key={lot.lotId} value={lot.lotCode}>
                        {lot.lotCode} — disponível {lot.available}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="sample-quantity">
                    Quantidade{selectedItem ? ` (${selectedItem.unitCode})` : ""}
                  </label>
                  <input
                    id="sample-quantity"
                    type="text"
                    inputMode="decimal"
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    required
                  />
                </div>

                <div className="field">
                  <label htmlFor="sample-consumption-notes">Observação</label>
                  <input
                    id="sample-consumption-notes"
                    type="text"
                    value={consumptionNotes}
                    onChange={(event) => setConsumptionNotes(event.target.value)}
                  />
                </div>
              </div>

              <div className="line-actions">
                <button
                  type="submit"
                  className="btn btn--secondary btn--sm"
                  disabled={saving || !itemId || !quantity.trim()}
                >
                  Registrar consumo
                </button>
              </div>
            </form>
          )}
        </FormSection>

        {canConsume && isOpen && (
          <FormSection
            title="Concluir amostra"
            subtitle="Registra o que foi efetivamente produzido e congela cliente/projeto na etiqueta."
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const withoutConsumption = sample.consumptions.length === 0;
                if (
                  withoutConsumption &&
                  !window.confirm("Nenhum consumo registrado nesta amostra. Concluir mesmo assim?")
                ) {
                  return;
                }
                void run(() =>
                  produceSample(id, {
                    outputQuantity,
                    outputUomCode,
                    ...(productionNotes.trim() ? { productionNotes: productionNotes.trim() } : {}),
                    ...(withoutConsumption ? { confirmWithoutConsumption: true } : {}),
                  }),
                );
              }}
            >
              <div className="field-grid-2">
                <div className="field">
                  <label htmlFor="sample-output">Quantidade produzida</label>
                  <input
                    id="sample-output"
                    type="text"
                    inputMode="decimal"
                    value={outputQuantity}
                    onChange={(event) => setOutputQuantity(event.target.value)}
                    required
                  />
                </div>

                <div className="field">
                  <label htmlFor="sample-output-uom">Unidade</label>
                  <select
                    id="sample-output-uom"
                    value={outputUomCode}
                    onChange={(event) => setOutputUomCode(event.target.value)}
                    required
                  >
                    <option value="">Selecione…</option>
                    {units.map((unit) => (
                      <option key={unit.code} value={unit.code}>
                        {unit.code} — {unit.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="sample-production-notes">Observações de produção</label>
                  <input
                    id="sample-production-notes"
                    type="text"
                    value={productionNotes}
                    onChange={(event) => setProductionNotes(event.target.value)}
                  />
                </div>
              </div>

              <div className="line-actions">
                <button
                  type="submit"
                  className="btn btn--accent btn--sm"
                  disabled={saving || !outputQuantity.trim() || !outputUomCode}
                >
                  Concluir amostra
                </button>
              </div>
            </form>
          </FormSection>
        )}

        {(awaitingDecision || isOpen) && canCancel && (
          <FormSection
            title="Decisão"
            subtitle="Aprovar a amostra não aprova o projeto — a aprovação comercial continua exigindo orçamento aceito."
          >
            <div className="field">
              <label htmlFor="sample-decision-notes">Parecer</label>
              <input
                id="sample-decision-notes"
                type="text"
                value={decisionNotes}
                onChange={(event) => setDecisionNotes(event.target.value)}
                placeholder="Obrigatório na reprovação"
              />
            </div>

            <div className="line-actions">
              {awaitingDecision && canDecide && (
                <>
                  <button
                    type="button"
                    className="btn btn--accent btn--sm"
                    disabled={saving}
                    onClick={() =>
                      void run(() =>
                        approveSample(id, {
                          ...(decisionNotes.trim() ? { decisionNotes: decisionNotes.trim() } : {}),
                        }),
                      )
                    }
                  >
                    Aprovar amostra
                  </button>
                  <button
                    type="button"
                    className="btn btn--danger btn--sm"
                    disabled={saving || !decisionNotes.trim()}
                    onClick={() =>
                      void run(() => rejectSample(id, { decisionNotes: decisionNotes.trim() }))
                    }
                  >
                    Reprovar amostra
                  </button>
                </>
              )}

              {isOpen && (
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={saving}
                  onClick={() => {
                    if (
                      !window.confirm(
                        "Cancelar a amostra? O material já consumido NÃO volta para o estoque.",
                      )
                    ) {
                      return;
                    }
                    void run(() =>
                      cancelSample(id, {
                        ...(decisionNotes.trim() ? { decisionNotes: decisionNotes.trim() } : {}),
                      }),
                    );
                  }}
                >
                  Cancelar amostra
                </button>
              )}
            </div>
          </FormSection>
        )}

        <AttachmentsSection
          context="project-samples"
          contextId={id}
          title="Documentos da amostra"
          subtitle="Resultado de teste, arte e ficha técnica. Laudo de matéria-prima pertence ao lote, não à amostra."
          types={SAMPLE_ATTACHMENT_TYPES}
        />
      </div>
    </>
  );
}
