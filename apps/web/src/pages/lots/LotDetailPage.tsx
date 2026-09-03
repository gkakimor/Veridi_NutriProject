import { formatQuantity } from "../../lib/quantity";
import { Fragment, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  CostReferenceDTO,
  LotDTO,
  LotTraceabilityDTO,
  ProductionOrderMaterialCostDTO,
  ShipmentStatus,
} from "@veridi/shared";
import {
  COA_STATUS_LABELS,
  COST_QUALITY_LABELS,
  COST_SOURCE_LABELS,
  LOT_ATTACHMENT_TYPES,
  LOT_STATUS_LABELS,
  SHIPMENT_STATUS_LABELS,
  ownerLabel,
} from "@veridi/shared";
import { blockLot, getLot, getLotTraceability, releaseLot, unblockLot } from "../../lib/lots-api";
import { getItemCostReference, getProductionOrderMaterialCost } from "../../lib/costs-api";
import { getReceipt } from "../../lib/receiving-api";
import { formatBRL } from "../../lib/currency";
import { FormSection } from "../../components/FormSection";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { RejectCoaDialog } from "../../components/RejectCoaDialog";
import { AttachmentsSection } from "../../components/AttachmentsSection";
import { approveCoa, rejectCoa } from "../../lib/attachments-api";
import { useAuth } from "../../app/AuthProvider";
import { QrCode } from "../../components/QrCode";
import { EntityLink } from "../../components/EntityLink";
import { formatDate } from "../../lib/dates";
import { ModalDialog } from "../../components/ModalDialog";
import { ContextHelp, InfoHint } from "../../components/help";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

/** ⓘ de um campo, lido do registro central — o texto nunca mora no JSX. */
function DicaDoCampo({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}


function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR");
}

function statusBadgeClass(status: LotDTO["status"], isExpired: boolean): string {
  if (isExpired) return "badge badge--err";
  switch (status) {
    case "AWAITING_RELEASE":
      return "badge badge--warn";
    case "AVAILABLE":
      return "badge badge--active";
    case "BLOCKED":
    case "EXPIRED":
      return "badge badge--err";
  }
}

/** Detalhe do lote — liberacao/bloqueio explicitos. Sem saldo/QR ainda. */
export function LotDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const canReviewCoa = user?.role === "QUALITY" || user?.role === "ADMIN";

  const [lot, setLot] = useState<LotDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rejectCoaOpen, setRejectCoaOpen] = useState(false);

  const [traceability, setTraceability] = useState<LotTraceabilityDTO | null>(null);
  /** Custo real deste lote recebido (via ReceiptLine) — `null` se desconhecido. */
  const [lotActualCost, setLotActualCost] = useState<string | null>(null);
  /** Referência estimada do Item — usada só quando o lote não tem custo real. */
  const [itemCostReference, setItemCostReference] = useState<CostReferenceDTO | null>(null);
  /** Custo material da OP que produziu este lote (origin=PRODUCTION). */
  const [productionCost, setProductionCost] = useState<ProductionOrderMaterialCostDTO | null>(null);

  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  /*
   * De onde veio a recusa.
   *
   * O lote é uma página longa e o alerta morava só no topo: liberar sem CoA
   * aprovado devolvia um 400 com a razão certa, o alerta aparecia centenas
   * de pixels acima da Qualidade, e da cadeira parecia que o clique não fez
   * nada — justamente no controle que existe para impedir uso de material
   * não liberado.
   */
  const [errorScope, setErrorScope] = useState<"geral" | "qualidade">("geral");
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [unblockDialogOpen, setUnblockDialogOpen] = useState(false);
  const [unblockReason, setUnblockReason] = useState("");
  const [blockReason, setBlockReason] = useState("");

  function load(lotId: string) {
    setLoading(true);
    setNotFound(false);
    setTraceability(null);
    getLot(lotId)
      .then(setLot)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
    getLotTraceability(lotId)
      .then(setTraceability)
      .catch(() => setTraceability(null));
  }

  useEffect(() => {
    if (id) load(id);
  }, [id]);

  // Custo do lote: recebido usa o custo efetivo da própria aquisição
  // (REAL); produzido usa o custo material da OP. Sem custo real, mostra
  // a referência estimada do Item — sempre rotulada como estimativa.
  useEffect(() => {
    setLotActualCost(null);
    setItemCostReference(null);
    setProductionCost(null);
    if (!lot) return;

    if (lot.origin === "PRODUCTION") {
      if (lot.productionOrderId) {
        getProductionOrderMaterialCost(lot.productionOrderId)
          .then(setProductionCost)
          .catch(() => setProductionCost(null));
      }
      return;
    }

    if (lot.receiptId) {
      getReceipt(lot.receiptId)
        .then((receipt) => {
          const line = receipt.lines.find((receiptLine) => receiptLine.lotId === lot.id);
          setLotActualCost(line?.actualUnitCost ?? null);
          if (!line?.actualUnitCost) {
            getItemCostReference(lot.itemId)
              .then(setItemCostReference)
              .catch(() => setItemCostReference(null));
          }
        })
        .catch(() => setLotActualCost(null));
    } else {
      getItemCostReference(lot.itemId)
        .then(setItemCostReference)
        .catch(() => setItemCostReference(null));
    }
  }, [lot]);

  async function handleRelease() {
    if (!id) return;
    setReleaseDialogOpen(false);
    setSaving(true);
    setError(null);
    setErrorScope("geral");
    try {
      const updated = await releaseLot(id);
      setLot(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao liberar lote");
      setErrorScope("qualidade");
    } finally {
      setSaving(false);
    }
  }

  /** Recarrega o lote — o estado documental muda ao anexar/arquivar laudo. */
  async function reloadLot() {
    if (!id) return;
    setLot(await getLot(id));
  }

  async function handleApproveCoa() {
    if (!id) return;
    setSaving(true);
    setError(null);
    setErrorScope("geral");
    try {
      await approveCoa(id);
      await reloadLot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao aprovar o CoA");
      setErrorScope("qualidade");
    } finally {
      setSaving(false);
    }
  }

  async function handleRejectCoa(reason: string) {
    if (!id) return;
    setRejectCoaOpen(false);
    setSaving(true);
    setError(null);
    setErrorScope("geral");
    try {
      await rejectCoa(id, reason);
      await reloadLot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao rejeitar o CoA");
      setErrorScope("qualidade");
    } finally {
      setSaving(false);
    }
  }

  async function handleUnblock() {
    if (!id) return;
    setSaving(true);
    setError(null);
    setErrorScope("geral");
    try {
      const updated = await unblockLot(id, { reason: unblockReason.trim() });
      setUnblockDialogOpen(false);
      setUnblockReason("");
      setLot(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao desbloquear lote");
      setErrorScope("qualidade");
    } finally {
      setSaving(false);
    }
  }

  async function handleBlock() {
    if (!id) return;
    setSaving(true);
    setError(null);
    setErrorScope("geral");
    try {
      const updated = await blockLot(id, { reason: blockReason.trim() });
      setBlockDialogOpen(false);
      setBlockReason("");
      setLot(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao bloquear lote");
      setErrorScope("qualidade");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Lote</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (notFound || !lot) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Lote não encontrado</h1>
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/estoque/lotes")}>
            ← Voltar para Lotes
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="doc-header">
        <div>
          <PageBreadcrumbs items={[{ label: "Lotes", href: "/estoque/lotes" }, { label: lot.code }]} />
          <div className="doc-title">
            <h1>{lot.code}</h1>
            <span className={statusBadgeClass(lot.status, lot.isExpired)}>
              {lot.isExpired ? "Vencido" : LOT_STATUS_LABELS[lot.status]}
            </span>
          </div>
        </div>
        <div className="table__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => navigate(`/estoque/lotes/${lot.id}/rastreabilidade/imprimir`)}
          >
            Imprimir rastreabilidade
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/estoque/lotes")}>
            ← Voltar
          </button>
        </div>
      </div>

      <div className="doc-body">
        {/* Duas identidades, um dono, uma situação operacional e uma
            documental — quatro conceitos numa página só, e nenhum deles
            óbvio pelo rótulo. */}
        <ContextHelp topic={helpTopics["estoque.lotes"]} />

        {error && errorScope === "geral" && (
          <p className="form-alert" role="alert">
            {error}
          </p>
        )}

        {lot.origin === "PRODUCTION" ? (
          <FormSection title="Identificação">
            <dl className="definition-list">
              <dt>Origem</dt>
              <dd>Produção</dd>
              <dt>Item</dt>
              <dd>
                <EntityLink kind="item" id={lot.itemId} code={lot.itemCode} name={lot.itemName} />
              </dd>
              <dt>Produzido por</dt>
              <dd>
                {lot.productionOrderId ? (
                  <Link
                    className="btn btn--ghost btn--sm"
                    to={`/producao/ordens/${lot.productionOrderId}`}
                  >
                    {lot.productionOrderCode}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
              <dt>Lote Veridi</dt>
              <dd>{lot.businessLotNumber ?? "—"}</dd>
            </dl>
          </FormSection>
        ) : (
          <FormSection title="Identificação">
            <dl className="definition-list">
              <dt>Item</dt>
              <dd>
                <EntityLink kind="item" id={lot.itemId} code={lot.itemCode} name={lot.itemName} />
              </dd>
              <dt>
                Proprietário
                <DicaDoCampo id="estoque.proprietario" />
              </dt>
              <dd>
                {ownerLabel(lot.ownerType, lot.ownerCustomerName)}
                {lot.ownerType === "CUSTOMER" && lot.ownerCustomerCode ? (
                  <span className="field__hint"> {lot.ownerCustomerCode}</span>
                ) : null}
              </dd>
              <dt>Fornecedor</dt>
              <dd>
                <EntityLink
                  kind="supplier"
                  id={lot.supplierId}
                  code={lot.supplierCode}
                  name={lot.supplierName}
                />
              </dd>
              <dt>
                Lote do fornecedor
                <DicaDoCampo id="estoque.loteFornecedor" />
              </dt>
              <dd>{lot.supplierLot ?? "—"}</dd>
              <dt>Origem — Recebimento</dt>
              <dd>
                {/* `Link`, nao botao com `navigate`: referencia a outro
                    registro precisa abrir em nova aba, aceitar clique do meio e
                    ter endereco copiavel. Botao imita link e tira as tres. */}
                {lot.receiptId ? (
                  <Link to={`/compras/recebimentos/${lot.receiptId}`}>{lot.receiptCode}</Link>
                ) : (
                  "—"
                )}
              </dd>
              <dt>Origem — Ordem de Compra</dt>
              <dd>
                {lot.purchaseOrderId ? (
                  <Link to={`/compras/ordens/${lot.purchaseOrderId}`}>{lot.purchaseOrderCode}</Link>
                ) : (
                  "—"
                )}
              </dd>
            </dl>
          </FormSection>
        )}

        <FormSection
          title="Quantidade e validade"
          subtitle={
            lot.origin === "PRODUCTION"
              ? "Quantidade produzida acumulada (soma dos apontamentos) — não é saldo atual. Saldo atual vem do histórico de movimentações (abaixo)."
              : "Quantidade originalmente recebida — não é saldo atual. Saldo atual vem do histórico de movimentações (abaixo)."
          }
        >
          <dl className="definition-list">
            <dt>
              {lot.origin === "PRODUCTION" ? "Quantidade produzida" : "Quantidade recebida"}
              <DicaDoCampo id="estoque.recebido" />
            </dt>
            <dd>
              {lot.origin === "PRODUCTION" ? lot.producedQuantity : lot.initialReceivedQuantity}{" "}
              {lot.unitCode}
            </dd>
            <dt>Validade</dt>
            <dd>{formatDate(lot.expiryDate)}</dd>
            <dt>Localização</dt>
            <dd>{lot.location ?? "—"}</dd>
          </dl>
        </FormSection>

        <FormSection title="Saldo" subtitle="Derivado do histórico de movimentações — nunca uma coluna própria do lote.">
          <dl className="definition-list">
            <dt>
              Físico
              <DicaDoCampo id="estoque.fisico" />
            </dt>
            <dd>
              {formatQuantity(lot.onHand)} {lot.unitCode}
            </dd>
            <dt>
              Reservado
              <DicaDoCampo id="estoque.reservado" />
            </dt>
            <dd>
              {formatQuantity(lot.reserved)} {lot.unitCode}
            </dd>
            <dt>
              Disponível
              <DicaDoCampo id="estoque.disponivel" />
            </dt>
            <dd>
              {formatQuantity(lot.available)} {lot.unitCode}
            </dd>
          </dl>
        </FormSection>

        {lot.shipments.length > 0 && (
          <FormSection
            title="Expedições"
            subtitle="Para onde este lote foi. Só expedição confirmada saiu de fato do estoque."
          >
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Expedição</th>
                    <th>Pedido</th>
                    <th>Cliente</th>
                    <th className="is-numeric">Quantidade</th>
                    <th>Status</th>
                    <th>Confirmada em</th>
                  </tr>
                </thead>
                <tbody>
                  {lot.shipments.map((shipment) => (
                    <tr key={`${shipment.id}-${formatQuantity(shipment.quantity)}`}>
                      <td className="is-code">
                        <EntityLink kind="shipment" id={shipment.id} code={shipment.code} />
                      </td>
                      <td className="is-code">
                        <EntityLink
                          kind="customerOrder"
                          id={shipment.customerOrderId}
                          code={shipment.customerOrderCode}
                        />
                      </td>
                      <td>
                        <EntityLink
                          kind="customer"
                          id={shipment.customerId}
                          code={shipment.customerName}
                        />
                      </td>
                      <td className="is-numeric">
                        {formatQuantity(shipment.quantity)} {shipment.unitCode}
                      </td>
                      <td>
                        <span className="badge badge--neutral">
                          {SHIPMENT_STATUS_LABELS[shipment.status as ShipmentStatus] ?? shipment.status}
                        </span>
                      </td>
                      <td>{shipment.shippedAt ? formatDate(shipment.shippedAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}

        {lot.origin === "PRODUCTION" ? (
          <FormSection
            title="Custo material da produção"
            subtitle="Derivado do que a Ordem de Produção realmente consumiu — nunca de custo de aquisição de fornecedor."
          >
            {productionCost ? (
              <>
                <dl className="definition-list">
                  <dt>Custo material / unidade</dt>
                  <dd>
                    {productionCost.materialUnitCost
                      ? `${formatBRL(productionCost.materialUnitCost)} / ${productionCost.outputUnitCode}`
                      : "Indisponível"}
                  </dd>
                  <dt>Qualidade</dt>
                  <dd>
                    <span
                      className={
                        productionCost.quality === "REAL"
                          ? "badge badge--active"
                          : productionCost.quality === "ESTIMATED"
                            ? "badge badge--neutral"
                            : "badge badge--warn"
                      }
                    >
                      {COST_QUALITY_LABELS[productionCost.quality]}
                    </span>
                  </dd>
                </dl>
                {productionCost.quality === "PARTIAL" && (
                  <p className="field__hint">
                    Custo parcial: existem materiais consumidos sem referência de custo.
                  </p>
                )}
                <p className="field__hint">
                  Todos os lotes produzidos por esta OP compartilham a mesma referência de custo material
                  unitário — não há rateio por lote.
                </p>
              </>
            ) : (
              <p className="field__hint">Custo material indisponível para a Ordem de Produção de origem.</p>
            )}
          </FormSection>
        ) : (
          <FormSection title="Custo de aquisição">
            {/* Material do cliente não tem aquisição da Veridi — e "sem custo
                informado" lia como um dado que faltava preencher, quando na
                verdade não existe custo a preencher. */}
            {lot.ownerType === "CUSTOMER" ? (
              <>
                <dl className="definition-list">
                  <dt>Custo de aquisição Veridi</dt>
                  <dd>
                    <span className="badge badge--info">Não aplicável</span>
                  </dd>
                  <dt>Proprietário</dt>
                  <dd>{lot.ownerCustomerName ?? "Cliente não identificado"}</dd>
                </dl>
                <p className="field__hint">
                  Material fornecido pelo cliente — a aquisição não compõe o custo Veridi.
                </p>
              </>
            ) : lotActualCost !== null ? (
              <dl className="definition-list">
                <dt>Custo de aquisição</dt>
                <dd>
                  {formatBRL(lotActualCost)} / {lot.unitCode}
                </dd>
                <dt>Origem</dt>
                <dd>
                  <span className="badge badge--active">{COST_SOURCE_LABELS.REAL}</span>
                </dd>
              </dl>
            ) : itemCostReference ? (
              <>
                <dl className="definition-list">
                  <dt>Referência estimada</dt>
                  <dd>
                    {itemCostReference.unitCost
                      ? `${formatBRL(itemCostReference.unitCost)} / ${lot.unitCode}`
                      : "Sem custo"}
                  </dd>
                  <dt>Origem</dt>
                  <dd>
                    <span
                      className={
                        itemCostReference.source === "NO_COST" ? "badge badge--warn" : "badge badge--neutral"
                      }
                    >
                      {COST_SOURCE_LABELS[itemCostReference.source]}
                    </span>
                  </dd>
                </dl>
                <p className="field__hint">
                  Referência estimada do item — este lote não possui custo efetivo de aquisição informado.
                </p>
              </>
            ) : (
              <p className="field__hint">Sem custo.</p>
            )}
          </FormSection>
        )}

        <FormSection title="Qualidade">
          {error && errorScope === "qualidade" && (
            <p className="form-alert" role="alert">
              {error}
            </p>
          )}
          <div className="status-line">
            <span className={statusBadgeClass(lot.status, lot.isExpired)}>
              {LOT_STATUS_LABELS[lot.status]}
            </span>
            {lot.status === "AWAITING_RELEASE" && (
              <span className="field__hint">Aguardando liberação da Qualidade para uso.</span>
            )}
            {lot.status === "BLOCKED" && (
              <span className="field__hint">
                Bloqueado {formatDateTime(lot.blockedAt)} por {lot.blockedBy ?? "—"}
                {lot.blockReason ? ` — ${lot.blockReason}` : ""}
              </span>
            )}
            {lot.status === "AVAILABLE" && lot.releasedAt && (
              <span className="field__hint">
                Liberado {formatDateTime(lot.releasedAt)} por {lot.releasedBy ?? "—"}
              </span>
            )}
          </div>

          <div className="line-actions">
            {/* Liberar e bloquear são decisão da Qualidade. Oferecer o botão a
                quem o backend recusa é convite ao erro — e a ausência sem
                explicação parece tela quebrada, então a razão fica junto. */}
            {lot.status === "AWAITING_RELEASE" && !canReviewCoa && (
              <p className="field__hint">
                A liberação deste lote é decisão da Qualidade.
              </p>
            )}
            {lot.status === "AWAITING_RELEASE" && canReviewCoa && (
              <div className="table__actions">
                <button
                  type="button"
                  className="btn btn--accent btn--sm"
                  disabled={saving}
                  onClick={() => setReleaseDialogOpen(true)}
                >
                  Liberar
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  disabled={saving}
                  onClick={() => setBlockDialogOpen(true)}
                >
                  Bloquear
                </button>
              </div>
            )}
            {lot.status === "AVAILABLE" && canReviewCoa && (
              <button
                type="button"
                className="btn btn--danger btn--sm"
                disabled={saving}
                onClick={() => setBlockDialogOpen(true)}
              >
                Bloquear
              </button>
            )}
            {lot.status === "AVAILABLE" && !canReviewCoa && (
              <p className="field__hint">O bloqueio deste lote é decisão da Qualidade.</p>
            )}
            {/* Bloqueado deixou de ser fim de linha: material físico real não
                pode ficar fora do estoque para sempre por causa de um
                bloqueio feito por engano. Desbloquear reabre a decisão — o
                lote volta para a fila, não para o estoque disponível. */}
            {lot.status === "BLOCKED" && canReviewCoa && (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={saving}
                onClick={() => setUnblockDialogOpen(true)}
              >
                Desbloquear
              </button>
            )}
            {lot.status === "BLOCKED" && !canReviewCoa && (
              <p className="field__hint">
                O desbloqueio deste lote é decisão da Qualidade.
              </p>
            )}
          </div>
        </FormSection>

        <FormSection
          title="Qualidade documental"
          subtitle="Laudo/CoA é independente do status operacional: aprovar o documento não libera o lote."
        >
          <dl className="definition-list">
            <dt>Exige CoA</dt>
            <dd>{lot.requiresCoa ? "Sim" : "Não"}</dd>
            <dt>
              Situação do CoA
              <DicaDoCampo id="estoque.laudo" />
            </dt>
            <dd>
              <span
                className={
                  lot.coaStatus === "APPROVED"
                    ? "badge badge--active"
                    : lot.coaStatus === "REJECTED"
                      ? "badge badge--err"
                      : lot.coaStatus === "NOT_REQUIRED"
                        ? "badge badge--neutral"
                        : "badge badge--warn"
                }
              >
                {COA_STATUS_LABELS[lot.coaStatus]}
              </span>
            </dd>
            <dt>Revisado por</dt>
            <dd>{lot.coaReviewedByName ?? "—"}</dd>
            <dt>Observação da análise</dt>
            <dd>{lot.coaReviewNote ?? "—"}</dd>
          </dl>

          {canReviewCoa && lot.requiresCoa && lot.coaStatus === "RECEIVED" && (
            <div className="line-actions">
              <button
                type="button"
                className="btn btn--accent"
                disabled={saving}
                onClick={() => void handleApproveCoa()}
              >
                Aprovar CoA
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={saving}
                onClick={() => setRejectCoaOpen(true)}
              >
                Rejeitar CoA
              </button>
            </div>
          )}
        </FormSection>

        {id && (
          <AttachmentsSection
            context="lots"
            contextId={id}
            title="Documentos do lote"
            subtitle="Laudo/CoA e outros documentos. Anexar não aprova — a análise da Qualidade é uma ação separada."
            types={LOT_ATTACHMENT_TYPES}
            canArchive={canReviewCoa}
            onChanged={() => void reloadLot()}
          />
        )}

        {traceability && traceability.kind === "FINISHED_GOOD" && (
          <FormSection
            title="Rastreabilidade"
            subtitle="Genealogia real — consumo e produção efetivos, nunca reserva/sugestão FEFO."
          >
            <dl className="definition-list">
              <dt>Produzido por</dt>
              <dd>
                <Link
                  className="btn btn--ghost btn--sm"
                  to={`/producao/ordens/${traceability.productionOrderId}`}
                >
                  {traceability.productionOrderCode}
                </Link>
              </dd>
              <dt>Produto</dt>
              <dd>
                <EntityLink kind="product" id={traceability.productId} code={traceability.productCode} name={traceability.productName} />
              </dd>
              <dt>Quantidade produzida neste lote</dt>
              <dd>
                {formatQuantity(traceability.producedQuantity)} {traceability.unitCode}
              </dd>
            </dl>

            <div className="table-container table-container--spaced">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Lote</th>
                    <th>Lote de origem</th>
                    <th className="is-numeric">Quantidade consumida</th>
                    <th>Origem do material</th>
                  </tr>
                </thead>
                <tbody>
                  {traceability.consumedMaterials.map((material) => (
                    <tr key={`${material.itemId}-${material.lotId ?? "sem-lote"}`}>
                      <td>
                        <EntityLink kind="item" id={material.itemId} code={material.itemCode} name={material.itemName} />
                      </td>
                      <td>
                        {/* O lote consumido leva ao lote consumido. Era texto
                            puro ao lado de uma coluna Item que já era link, na
                            mesma linha — e ir de um lote de produto acabado até
                            a matéria-prima que o originou é exatamente a
                            pergunta que esta tabela existe para responder. O
                            `lotId` sempre esteve no DTO. */}
                        <EntityLink
                          kind="lot"
                          id={material.lotId}
                          code={material.lotCode}
                          name={material.supplierLot}
                        />
                      </td>
                      <td>{material.supplierLot ?? "—"}</td>
                      <td className="is-numeric">
                        {formatQuantity(material.quantity)} {material.unitCode}
                      </td>
                      {/* Material do cliente não é fornecedor: dizer "—" aqui
                          lia como fornecedor desconhecido. */}
                      <td>
                        {material.ownerType === "CUSTOMER" ? (
                          <>
                            <span className="badge badge--info">Material do cliente</span>
                            <div className="field__hint">{material.ownerCustomerName ?? "Cliente não identificado"}</div>
                          </>
                        ) : (
                          (material.supplierName ?? "—")
                        )}
                      </td>
                    </tr>
                  ))}
                  {traceability.consumedMaterials.length === 0 && (
                    <tr>
                      <td colSpan={5} className="table__empty">
                        Nenhum material consumido registrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}

        {/* Seção própria, e não uma linha a mais na genealogia: cliente
            não é origem de material. Junto, o operador fecha a cadeia
            fornecedor → cliente sem sair da tela. */}
        {traceability &&
          traceability.kind === "FINISHED_GOOD" &&
          traceability.commercialDestination && (
            <FormSection
              title="Destino comercial"
              subtitle="Para quem este lote foi produzido e por onde saiu — não faz parte da genealogia de material."
            >
              <dl className="definition-list">
                <dt>Pedido</dt>
                <dd>
                  <EntityLink
                    kind="customerOrder"
                    id={traceability.commercialDestination.customerOrderId}
                    code={traceability.commercialDestination.customerOrderCode}
                  />
                </dd>
                <dt>Cliente</dt>
                <dd>
                  <EntityLink
                    kind="customer"
                    id={traceability.commercialDestination.customerId}
                    code={traceability.commercialDestination.customerCode}
                    name={traceability.commercialDestination.customerName}
                  />
                </dd>
                {traceability.commercialDestination.projectId && (
                  <>
                    <dt>Projeto</dt>
                    <dd>
                      <EntityLink
                        kind="project"
                        id={traceability.commercialDestination.projectId}
                        code={traceability.commercialDestination.projectCode ?? ""}
                        name={traceability.commercialDestination.projectName ?? ""}
                      />
                    </dd>
                  </>
                )}
              </dl>

              <div className="table-container table-container--spaced">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Expedição</th>
                      <th>Data</th>
                      <th className="is-numeric">Quantidade deste lote</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traceability.commercialDestination.shipments.map((shipment) => (
                      <tr key={shipment.shipmentId}>
                        <td className="is-code">
                          <EntityLink
                            kind="shipment"
                            id={shipment.shipmentId}
                            code={shipment.shipmentCode}
                          />
                        </td>
                        <td>{formatDate(shipment.shipmentDate)}</td>
                        <td className="is-numeric">
                          {formatQuantity(shipment.quantity)} {traceability.unitCode}
                        </td>
                      </tr>
                    ))}
                    {traceability.commercialDestination.shipments.length === 0 && (
                      <tr>
                        <td colSpan={3} className="table__empty">
                          Este lote ainda não foi expedido.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </FormSection>
          )}

        {traceability && traceability.kind === "RAW_MATERIAL" && (
          <FormSection
            title="Rastreabilidade — Utilizado em"
            subtitle="Genealogia real — consumo e produção efetivos, nunca reserva/sugestão FEFO."
          >
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Ordem de Produção</th>
                    <th>Produto</th>
                    <th className="is-numeric">Quantidade consumida</th>
                    <th>Lote(s) de produto acabado gerados</th>
                  </tr>
                </thead>
                <tbody>
                  {traceability.usedIn.map((usage) => (
                    <tr key={usage.productionOrderId}>
                      <td className="is-code">
                        <EntityLink
                          kind="productionOrder"
                          id={usage.productionOrderId}
                          code={usage.productionOrderCode}
                        />
                      </td>
                      <td>
                        <EntityLink kind="product" id={usage.productId} code={usage.productCode} name={usage.productName} />
                      </td>
                      <td className="is-numeric">
                        {formatQuantity(usage.consumedQuantity)} {usage.unitCode}
                      </td>
                      <td>
                        {/* Mesma coisa no sentido inverso: da matéria-prima
                            para os lotes de produto acabado que ela gerou. */}
                        {usage.finishedLots.length === 0
                          ? "—"
                          : usage.finishedLots.map((finished, indice) => (
                              <Fragment key={finished.lotId}>
                                {indice > 0 ? ", " : ""}
                                <EntityLink
                                  kind="lot"
                                  id={finished.lotId}
                                  code={finished.businessLotNumber ?? finished.lotCode}
                                  name={finished.businessLotNumber ? finished.lotCode : null}
                                />
                              </Fragment>
                            ))}
                      </td>
                    </tr>
                  ))}
                  {traceability.usedIn.length === 0 && (
                    <tr>
                      <td colSpan={4} className="table__empty">
                        Este lote nunca foi consumido em nenhuma Ordem de Produção.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Amostra</th>
                    <th>Teste</th>
                    <th>Projeto</th>
                    <th>Cliente</th>
                    <th className="is-numeric">Quantidade consumida</th>
                    <th>Quando</th>
                  </tr>
                </thead>
                <tbody>
                  {traceability.usedInSamples.map((usage) => (
                    <tr key={usage.sampleId}>
                      <td>
                        <Link
                          className="btn btn--ghost btn--sm"
                          to={`/comercial/amostras/${usage.sampleId}`}
                        >
                          {usage.sampleCode}
                        </Link>
                      </td>
                      <td className="is-code">{usage.testLabel}</td>
                      <td>
                        <EntityLink kind="project" id={usage.projectId} code={usage.projectCode} name={usage.projectName} />
                      </td>
                      <td>{usage.customerName}</td>
                      <td className="is-numeric">
                        {formatQuantity(usage.consumedQuantity)} {usage.unitCode}
                      </td>
                      <td>{new Date(usage.consumedAt).toLocaleString("pt-BR")}</td>
                    </tr>
                  ))}
                  {traceability.usedInSamples.length === 0 && (
                    <tr>
                      <td colSpan={6} className="table__empty">
                        Este lote nunca foi consumido em amostra.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </FormSection>
        )}

        <FormSection title="QR Code" subtitle="Identifica só o lote interno — nunca dados mutáveis.">
          <div className="lot-detail-qr">
            <QrCode value={lot.qrPayload} size={112} label={`Código QR do lote ${lot.code}`} />
            <div className="lot-detail-qr__meta">
              <span className="field-readonly-value">{lot.qrPayload}</span>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => navigate(`/estoque/lotes/${lot.id}/etiqueta`)}
              >
                Imprimir etiqueta
              </button>
            </div>
          </div>
        </FormSection>

        <FormSection title="Auditoria">
          <dl className="definition-list">
            <dt>Criado em</dt>
            <dd>
              {formatDateTime(lot.createdAt)} — {lot.createdBy ?? "—"}
            </dd>
          </dl>
        </FormSection>
      </div>

      <ConfirmDialog
        open={releaseDialogOpen}
        title="Liberar lote?"
        message={
          // O backend recusa a liberação com laudo pendente, e recusava
          // certo. Mas o diálogo era o mesmo do lote sem exigência: a
          // Qualidade só descobria a pendência depois de confirmar.
          lot.requiresCoa && lot.coaStatus !== "APPROVED" ? (
            <>
              <p>
                O laudo (CoA) deste lote está como{" "}
                <strong>{COA_STATUS_LABELS[lot.coaStatus]}</strong>, e o item exige laudo
                aprovado. A liberação será recusada enquanto isso não mudar.
              </p>
              <p>
                Trate o laudo na seção Qualidade documental desta página: anexe o documento e
                aprove o CoA antes de liberar.
              </p>
            </>
          ) : (
            `"${lot.code}" ficará disponível para uso a partir de agora.`
          )
        }
        confirmLabel="Liberar"
        confirmTone="accent"
        onCancel={() => setReleaseDialogOpen(false)}
        onConfirm={handleRelease}
      />

      {blockDialogOpen && (
        <>
          <ModalDialog labelledBy="block-lot-title" onClose={() => setBlockDialogOpen(false)}>
            <h2 id="block-lot-title">Bloquear lote?</h2>
            <p>
              "{lot.code}" deixará de estar disponível para uso até uma nova decisão da Qualidade.
            </p>
            <div className="field">
              <label htmlFor="block-lot-reason">
                Motivo do bloqueio <span className="req">*</span>
              </label>
              <textarea
                id="block-lot-reason"
                rows={3}
                value={blockReason}
                onChange={(event) => setBlockReason(event.target.value)}
              />
            </div>
            <div className="confirm-dialog__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setBlockDialogOpen(false)}>
                Voltar
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={blockReason.trim().length < 3 || saving}
                onClick={handleBlock}
              >
                Bloquear lote
              </button>
            </div>
          </ModalDialog>
        </>
      )}

      {unblockDialogOpen && (
        <ModalDialog labelledBy="unblock-lot-title" onClose={() => setUnblockDialogOpen(false)}>
          <h2 id="unblock-lot-title">Desbloquear lote?</h2>
          <p>
            "{lot.code}" volta para a fila da Qualidade como <strong>aguardando liberação</strong>.
            Ele não fica disponível para uso: liberar continua sendo uma decisão à parte.
          </p>
          <div className="field">
            <label htmlFor="unblock-lot-reason">
              Motivo do desbloqueio <span className="req">*</span>
            </label>
            <textarea
              id="unblock-lot-reason"
              rows={3}
              value={unblockReason}
              onChange={(event) => setUnblockReason(event.target.value)}
            />
            <p className="field__hint">
              O motivo do bloqueio anterior continua registrado no histórico do lote.
            </p>
          </div>
          <div className="confirm-dialog__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setUnblockDialogOpen(false)}
            >
              Voltar
            </button>
            <button
              type="button"
              className="btn btn--accent"
              disabled={unblockReason.trim().length < 3 || saving}
              onClick={handleUnblock}
            >
              Desbloquear lote
            </button>
          </div>
        </ModalDialog>
      )}

      {rejectCoaOpen && (
        <RejectCoaDialog
          lotCode={lot.code}
          onCancel={() => setRejectCoaOpen(false)}
          onConfirm={(reason) => void handleRejectCoa(reason)}
        />
      )}
    </>
  );
}
