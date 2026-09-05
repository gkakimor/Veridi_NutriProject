import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { BillingDTO, BillingStatus } from "@veridi/shared";
import { BILLING_STATUS_LABELS, calcularTotaisFaturamento } from "@veridi/shared";
import { cancelBilling, getBilling, issueBilling, updateBilling } from "../../lib/billings-api";
import { formatBRL, formatUnitPriceBRL } from "../../lib/currency";
import { CalcHint } from "../../components/help/CalcHint";
import { exigirDecimalOpcional } from "../../lib/decimal-field";
import { mensagemDecimalInvalido, parseDecimalInput } from "../../lib/decimal-input";
import { FormSection } from "../../components/FormSection";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { FlowContext } from "../../components/FlowContext";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EntityLink } from "../../components/EntityLink";
import { PriceOverrideDialog } from "./PriceOverrideDialog";
import { formatDate } from "../../lib/dates";
import { ModalDialog } from "../../components/ModalDialog";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";

function statusBadgeClass(status: BillingStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "ISSUED":
      return "badge badge--active";
    case "CANCELLED":
      return "badge badge--err";
  }
}


function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR");
}

/**
 * Documento transacional — página própria no workspace. Faturamento
 * comercial/operacional: nunca emite Nota Fiscal e nunca movimenta
 * estoque. Só `unitPrice`/observações/referência externa são editáveis, e
 * apenas enquanto rascunho.
 */
export function BillingPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [billing, setBilling] = useState<BillingDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [prices, setPrices] = useState<Record<string, string>>({});
  const [overrideLineId, setOverrideLineId] = useState<string | null>(null);
  const [externalReference, setExternalReference] = useState("");
  const [notes, setNotes] = useState("");

  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const syncFromServer = useCallback((next: BillingDTO) => {
    setBilling(next);
    setExternalReference(next.externalReference ?? "");
    setNotes(next.notes ?? "");
    const nextPrices: Record<string, string> = {};
    for (const line of next.lines) {
      nextPrices[line.id] = line.unitPrice ?? "";
    }
    setPrices(nextPrices);
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    getBilling(id)
      .then(syncFromServer)
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id, syncFromServer]);

  const isDraft = billing?.status === "DRAFT";

  function buildPayload() {
    return {
      externalReference: externalReference.trim(),
      notes: notes.trim(),
      // Linha com preço acordado nunca vai no PATCH — ela só muda por
      // "Alterar preço de faturamento", com permissão e motivo.
      lines: (billing?.lines ?? [])
        .filter((line) => line.agreedUnitPrice === null)
        .map((line) => ({
          billingLineId: line.id,
          // Vazio continua sendo "sem preço" — faturamento quantitativo é
          // legítimo. Só o que foi digitado precisa ser legível.
          unitPrice: exigirDecimalOpcional(prices[line.id] ?? "", "Preço faturado") ?? "",
        })),
    };
  }

  async function handleSave() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      syncFromServer(await updateBilling(id, buildPayload()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar faturamento");
    } finally {
      setSaving(false);
    }
  }

  async function handleIssue() {
    if (!id) return;
    setIssueDialogOpen(false);
    setSaving(true);
    setError(null);
    try {
      // Salva o que está na tela antes de congelar o documento.
      await updateBilling(id, buildPayload());
      syncFromServer(await issueBilling(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao emitir faturamento");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const cancelled = await cancelBilling(id, { reason: cancelReason.trim() });
      setCancelDialogOpen(false);
      setCancelReason("");
      syncFromServer(cancelled);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao cancelar faturamento");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Faturamento</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (notFound || !billing) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Faturamento não encontrado</h1>
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/comercial/faturamento")}>
            ← Voltar para Faturamento
          </button>
        </div>
      </div>
    );
  }

  /*
   * Total da linha e do documento — UMA conta só, a mesma que a API usa para
   * emitir (`calcularTotaisFaturamento`, em `@veridi/shared`, em `Decimal`).
   *
   * O preço acordado é guardado com mais casas do que a tela mostra (9,7203
   * aparece como R$ 9,72), e recalcular a partir do texto EXIBIDO dava um
   * total diferente do que o servidor emitiria — a linha dizia R$ 1.677,27 e
   * o rodapé R$ 1.677,00, com os dois números discordando justamente na hora
   * de emitir. Por isso o operando é sempre o preço cheio do DTO; só a linha
   * cujo preço está sendo digitado (sem preço acordado, em rascunho) usa o
   * que foi digitado — e aí o digitado É a precisão.
   */
  const totais = calcularTotaisFaturamento(
    billing.lines.map((line) => ({
      quantity: line.quantity,
      unitPrice:
        isDraft && !line.agreedUnitPrice
          ? parseDecimalInput(prices[line.id] ?? "")
          : line.unitPrice,
    })),
  );
  const totaisDeLinha = totais.lineTotals;
  const previewTotal = totais.totalAmount;
  const displayTotal = isDraft ? previewTotal : billing.totalAmount;
  /*
   * Em rascunho o rodapé mostra a PRÉVIA — o total dos preços que estão na
   * tela agora. Quando ela difere do último salvamento, o gravado aparece
   * ao lado, nomeado: dois números de momentos diferentes só podem conviver
   * se estiver dito qual é qual.
   */
  const totalGravadoDivergente =
    isDraft && billing.totalAmount !== null && billing.totalAmount !== previewTotal;
  /*
   * Emitir é definitivo. Faturar sem preço continua permitido — existe
   * faturamento puramente quantitativo — mas quem confirma precisa saber que
   * está congelando um documento sem valor, e quais linhas estão assim.
   */
  const linhasSemPreco = billing.lines.filter((line) => (prices[line.id] ?? "").trim() === "");
  /*
   * Preço ilegível não é "sem preço": ficava fora de `linhasSemPreco`, a
   * prévia sumia sem dizer por quê, e emitir congelava o documento com o
   * texto cru. Agora a tela nomeia o problema antes de emitir.
   */
  const linhasComPrecoIlegivel = billing.lines.filter((line) => {
    const digitado = (prices[line.id] ?? "").trim();
    return digitado !== "" && parseDecimalInput(digitado) === null;
  });

  return (
    <>
      <div className="doc-header">
        <div>
          <PageBreadcrumbs items={[{ label: "Faturamento", href: "/comercial/faturamento" }, { label: "Detalhe" }]} />
          <div className="doc-title">
            <h1>{billing.code}</h1>
            <span className={statusBadgeClass(billing.status)}>{BILLING_STATUS_LABELS[billing.status]}</span>
          </div>
        </div>
        <div className="table__actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => navigate(`/comercial/faturamento/${billing.id}/imprimir`)}
          >
            Imprimir
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/comercial/faturamento")}>
            ← Voltar
          </button>
        </div>
      </div>

      <FlowContext
        steps={[
          {
            kind: "Pedido",
            code: billing.customerOrderCode,
            path: `/comercial/pedidos/${billing.customerOrderId}`,
            detail: billing.customerName,
          },
          {
            kind: "Expedição",
            code: billing.shipmentCode,
            path: `/comercial/expedicoes/${billing.shipmentId}`,
          },
          { kind: "Faturamento", code: billing.code, current: true },
        ]}
      />

      <div className="doc-body">
        {error && <p className="form-alert" role="alert">{error}</p>}

        {/* "Faturamento" carrega a expectativa de Nota Fiscal e de Contas a
            Receber, e nenhuma das duas acontece aqui. Dizer isso uma vez, no
            topo, custa menos que desfazer a confusão depois de emitir. */}
        <ContextHelp topic={helpTopics["faturamento.comoFunciona"]} />

        {billing.status === "CANCELLED" && (
          <FormSection title="Cancelamento">
            <div className="status-line">
              <span className="badge badge--err">Cancelado</span>
              <span className="field__hint">
                {formatDateTime(billing.cancelledAt)} — {billing.cancelledBy ?? "—"}
              </span>
            </div>
            {billing.cancelReason && <p className="field__hint">Motivo: {billing.cancelReason}</p>}
          </FormSection>
        )}

        <FormSection
          title="Origem"
          subtitle="Faturamento comercial/operacional — não emite Nota Fiscal e não movimenta estoque."
        >
          <dl className="definition-list">
            <dt>Pedido</dt>
            <dd>
              <Link
                className="btn btn--ghost btn--sm"
                to={`/comercial/pedidos/${billing.customerOrderId}`}
              >
                {billing.customerOrderCode}
              </Link>
            </dd>
            <dt>Expedição</dt>
            <dd>
              <Link
                className="btn btn--ghost btn--sm"
                to={`/comercial/expedicoes/${billing.shipmentId}`}
              >
                {billing.shipmentCode}
              </Link>
            </dd>
            <dt>Cliente</dt>
            <dd>
              <EntityLink
                kind="customer"
                id={billing.customerId}
                code={billing.customerCode}
                name={billing.customerName}
              />
            </dd>
            <dt>Data de expedição</dt>
            <dd>{formatDate(billing.shipmentDate)}</dd>
          </dl>

          <div className="field">
            <label htmlFor="billing-external-reference">Referência externa</label>
            <input
              id="billing-external-reference"
              type="text"
              placeholder="Ex.: NF 12345"
              disabled={!isDraft}
              value={externalReference}
              onChange={(event) => setExternalReference(event.target.value)}
            />
            <p className="field__hint">
              Referência a documento externo/ERP quando existir — o sistema não valida nem emite esse documento.
            </p>
          </div>
        </FormSection>

        <FormSection
          title="Itens faturados"
          subtitle="Quantidades vêm da expedição confirmada — nunca editáveis. Só o preço unitário é informado aqui."
        >
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  {/* Produto e Lote absorvem a largura; sem isto, o padrão
                      `nowrap` das células empurrava a coluna Total — justamente
                      a que o operador confere — para fora da área visível em
                      tela de notebook. */}
                  <th className="col-flex">Produto</th>
                  <th className="col-flex">Lote</th>
                  <th className="is-numeric col-tight">Quantidade</th>
                  <th className="col-tight">Unidade</th>
                  <th className="is-numeric col-tight">Preço acordado</th>
                  <th className="is-numeric col-tight">Preço faturado</th>
                  <th className="is-numeric col-tight">Total</th>
                </tr>
              </thead>
              <tbody>
                {billing.lines.map((line, indice) => {
                  const lineTotal = totaisDeLinha[indice] ?? line.lineTotal;
                  return (
                    <tr key={line.id}>
                      <td className="col-flex">
                        <EntityLink kind="product" id={line.productId} code={line.productCode} name={line.productName} />
                      </td>
                      <td className="col-flex">
                        {line.lotCode ?? "—"}
                        {line.businessLotNumber ? ` — ${line.businessLotNumber}` : ""}
                      </td>
                      <td className="is-numeric">{formatQuantity(line.quantity)}</td>
                      <td>{line.unitCode}</td>
                      <td className="is-numeric">
                        {/* Veio do Pedido e não se redigita. Deixá-lo
                            editável transformaria a quebra de um acordo
                            num deslize de digitação. */}
                        {line.agreedUnitPrice ? formatUnitPriceBRL(line.agreedUnitPrice) : "—"}
                      </td>
                      <td className="is-numeric">
                        {line.agreedUnitPrice ? (
                          <div className="cell-stack">
                            <span>{formatUnitPriceBRL(line.unitPrice)}</span>
                            {line.priceOverridden && (
                              <span className="badge badge--warn">Alterado</span>
                            )}
                            {isDraft && (
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                onClick={() => setOverrideLineId(line.id)}
                              >
                                Alterar preço de faturamento
                              </button>
                            )}
                          </div>
                        ) : isDraft ? (
                          (() => {
                            const digitado = (prices[line.id] ?? "").trim();
                            const ilegivel =
                              digitado !== "" && parseDecimalInput(digitado) === null;
                            return (
                              <>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="Opcional"
                                  aria-label={`Preço faturado de ${line.productCode}`}
                                  aria-invalid={ilegivel || undefined}
                                  className={ilegivel ? "is-invalid" : undefined}
                                  value={prices[line.id] ?? ""}
                                  onChange={(event) =>
                                    setPrices((prev) => ({
                                      ...prev,
                                      [line.id]: event.target.value,
                                    }))
                                  }
                                />
                                {ilegivel && (
                                  <p className="field__error">
                                    {mensagemDecimalInvalido("Preço faturado")}
                                  </p>
                                )}
                              </>
                            );
                          })()
                        ) : (
                          formatUnitPriceBRL(line.unitPrice)
                        )}
                      </td>
                      <td className="is-numeric">
                        {formatBRL(lineTotal)}{" "}
                        {line.unitPrice && lineTotal && (
                          /*
                            A conta que o operador refaz na calculadora. Este
                            documento já exibiu R$ 4,05 ao lado de um total
                            calculado sobre 4,0531 — quem conferia chegava a
                            outro número e não tinha como descobrir de onde
                            vinha a diferença.
                          */
                          <CalcHint
                            label="Total da linha"
                            operandos={[
                              { valor: formatUnitPriceBRL(line.unitPrice), papel: "preço faturado" },
                              { valor: formatQuantity(line.quantity), papel: `quantidade em ${line.unitCode}` },
                            ]}
                            resultado={formatBRL(lineTotal)}
                            esperado={Number(line.unitPrice) * Number(line.quantity)}
                            nota={
                              line.priceOverridden
                                ? "Preço alterado em relação ao acordado — a diferença está registrada com motivo e autor."
                                : "Preço vem do Pedido e não é recalculado pela precificação vigente de hoje."
                            }
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="table-foot">
              Quantidade total: {formatQuantity(billing.totalQuantity)} ·{" "}
              {isDraft ? "Valor total (prévia)" : "Valor total"}:{" "}
              {displayTotal ? formatBRL(displayTotal) : "Valores incompletos"}
              {totalGravadoDivergente && (
                <span className="field__hint">
                  {" "}
                  · Valor total gravado: {formatBRL(billing.totalAmount)} — salve o rascunho para
                  atualizar.
                </span>
              )}
            </div>
            {/* O acordado não é substituído: quem auditar vê os dois
                números, o motivo e o autor, e não um valor solitário. */}
            {billing.lines.some((line) => line.priceOverridden) && (
              <div className="table-container table-container--spaced">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th className="is-numeric">Preço acordado</th>
                      <th className="is-numeric">Preço faturado</th>
                      <th>Motivo</th>
                      <th>Alterado por</th>
                      <th>Quando</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billing.lines
                      .filter((line) => line.priceOverridden)
                      .map((line) => (
                        <tr key={line.id}>
                          <td>{line.productCode}</td>
                          <td className="is-numeric">{formatUnitPriceBRL(line.agreedUnitPrice)}</td>
                          <td className="is-numeric">{formatUnitPriceBRL(line.unitPrice)}</td>
                          <td className="cell-sub cell-sub--wrap">{line.overrideReason}</td>
                          <td>{line.overriddenBy ?? "—"}</td>
                          <td>
                            {line.overriddenAt
                              ? new Date(line.overriddenAt).toLocaleString("pt-BR")
                              : "—"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {!displayTotal && (
            <p className="field__hint">
              O valor total só é calculado quando todas as linhas têm preço — o faturamento quantitativo
              continua válido sem preço.
            </p>
          )}
        </FormSection>

        <FormSection title="Observações">
          <div className="field">
            <label htmlFor="billing-notes">Notas internas</label>
            <textarea
              id="billing-notes"
              rows={3}
              disabled={!isDraft}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </FormSection>

        {billing.status === "ISSUED" && (
          <FormSection title="Auditoria">
            <dl className="definition-list">
              <dt>Emitido em</dt>
              <dd>
                {formatDateTime(billing.issuedAt)} — {billing.issuedBy ?? "—"}
              </dd>
            </dl>
          </FormSection>
        )}
      </div>

      <div className="doc-actions">
        {isDraft && (
          <button
            type="button"
            className="btn btn--danger"
            disabled={saving}
            onClick={() => setCancelDialogOpen(true)}
          >
            Cancelar faturamento
          </button>
        )}

        <div className="doc-actions__primary">
          {isDraft && (
            <>
              <button type="button" className="btn btn--secondary" disabled={saving} onClick={handleSave}>
                {saving ? "Salvando…" : "Salvar rascunho"}
              </button>
              <button
                type="button"
                className="btn btn--accent"
                disabled={saving || linhasComPrecoIlegivel.length > 0}
                onClick={() => setIssueDialogOpen(true)}
                title={
                  linhasComPrecoIlegivel.length > 0
                    ? mensagemDecimalInvalido("Preço faturado")
                    : undefined
                }
              >
                Emitir faturamento
              </button>
            </>
          )}
        </div>
      </div>

      {overrideLineId && (
        <PriceOverrideDialog
          billing={billing}
          line={billing.lines.find((line) => line.id === overrideLineId)!}
          onClose={() => setOverrideLineId(null)}
          onOverridden={(atualizado) => {
            setOverrideLineId(null);
            setBilling(atualizado);
          }}
        />
      )}

      <ConfirmDialog
        open={issueDialogOpen}
        title={`Emitir faturamento ${billing.code}?`}
        message={
          linhasSemPreco.length === 0
            ? "O documento será marcado como emitido e ficará somente para leitura. Esta ação não emite Nota Fiscal."
            : `${linhasSemPreco.length} de ${billing.lines.length} ${
                billing.lines.length === 1 ? "linha está" : "linhas estão"
              } sem preço: ${linhasSemPreco
                .map((line) => line.productCode)
                .join(", ")}. O faturamento será emitido sem valor total e ficará somente para leitura — emitir não tem volta. Esta ação não emite Nota Fiscal.`
        }
        confirmLabel="Emitir"
        confirmTone="accent"
        onCancel={() => setIssueDialogOpen(false)}
        onConfirm={handleIssue}
      />

      {cancelDialogOpen && (
        <>
          <ModalDialog labelledBy="cancel-billing-title" onClose={() => setCancelDialogOpen(false)}>
            <h2 id="cancel-billing-title">Cancelar faturamento?</h2>
            <p>
              {billing.code} permanecerá no histórico. Nada muda no estoque nem na expedição — a expedição
              volta a aparecer como faturável e um novo faturamento pode ser preparado.
            </p>
            <div className="field">
              <label htmlFor="billing-cancel-reason">
                Motivo do cancelamento <span className="req">*</span>
              </label>
              <textarea
                id="billing-cancel-reason"
                rows={3}
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
              />
            </div>
            <div className="confirm-dialog__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setCancelDialogOpen(false)}>
                Voltar
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={cancelReason.trim().length < 3 || saving}
                onClick={handleCancel}
              >
                Cancelar faturamento
              </button>
            </div>
          </ModalDialog>
        </>
      )}
    </>
  );
}
