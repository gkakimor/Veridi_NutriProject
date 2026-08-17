import { useEffect, useState } from "react";
import type { ProjectDTO, QuoteLineDTO, QuoteVersionDTO } from "@veridi/shared";
import { QUOTE_STATUS_LABELS, QUOTE_PRICE_SOURCE_LABELS } from "@veridi/shared";
import {
  acceptQuoteVersion,
  addQuoteLine,
  applyQuotePricing,
  createQuoteVersion,
  getQuotePricingOptions,
  rejectQuoteVersion,
  removeQuoteLine,
  sendQuoteVersion,
  updateQuoteLine,
  updateQuoteVersion,
  useManualQuotePrice,
} from "../../lib/projects-api";
import type { PricingVersionDTO } from "@veridi/shared";
import { EntityLink } from "../../components/EntityLink";
import { FormSection } from "../../components/FormSection";
import { formatBRL } from "../../lib/currency";

/**
 * Orçamentos do projeto.
 *
 * A negociação acontece por versão, e a proposta cobre vários produtos: uma
 * linha por produto, cada uma com a própria origem de preço. Toda versão
 * abre — inclusive as antigas —, porque conferir o que foi proposto em V1 é
 * trabalho normal de quem negocia, não arqueologia.
 *
 * Versão enviada é somente leitura: renegociar cria versão nova.
 */

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function quoteBadgeClass(status: QuoteVersionDTO["status"]): string {
  if (status === "ACCEPTED") return "badge badge--active";
  if (status === "REJECTED") return "badge badge--err";
  if (status === "DRAFT") return "badge badge--warn";
  return "badge badge--neutral";
}

export function QuoteVersionsSection({
  project,
  canEdit,
  onChanged,
}: {
  project: ProjectDTO;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const versions = project.quoteVersions;
  const draft = versions.find((quote) => quote.status === "DRAFT") ?? null;

  const [openId, setOpenId] = useState<string | null>(draft?.id ?? versions.at(-1)?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addProductId, setAddProductId] = useState("");
  const [pricingLineId, setPricingLineId] = useState<string | null>(null);
  const [pricingOptions, setPricingOptions] = useState<PricingVersionDTO | null>(null);

  useEffect(() => {
    if (openId && versions.some((quote) => quote.id === openId)) return;
    setOpenId(draft?.id ?? versions.at(-1)?.id ?? null);
  }, [versions, draft, openId]);

  const open = versions.find((quote) => quote.id === openId) ?? null;
  const editable = canEdit && open?.status === "DRAFT";

  async function run(action: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na operação");
    } finally {
      setSaving(false);
    }
  }

  async function openPricing(line: QuoteLineDTO) {
    setPricingLineId(line.id);
    setPricingOptions(null);
    setError(null);
    try {
      setPricingOptions(await getQuotePricingOptions(line.id));
    } catch {
      // Sem precificação ativa para o produto: a mensagem é a ausência de
      // opções, não um erro técnico.
      setPricingOptions(null);
    }
  }

  const linkedProducts = project.products;
  const usedProductIds = new Set((open?.lines ?? []).map((line) => line.productId));
  const availableProducts = linkedProducts.filter((link) => !usedProductIds.has(link.productId));
  const missingPrice = (open?.lines ?? []).some((line) => line.unitPrice === null);

  return (
    <FormSection
      title="Orçamentos"
      subtitle="Cada negociação é uma versão. Enviado congela o snapshot e vira histórico — que continua acessível."
    >
      {error && <p className="form-alert">{error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>Versão</th>
              <th>Data</th>
              <th>Produtos</th>
              <th>Total</th>
              <th>Validade</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {versions.length === 0 && (
              <tr>
                <td colSpan={6}>Nenhuma versão de orçamento.</td>
              </tr>
            )}
            {versions.map((quote) => (
              <tr
                key={quote.id}
                className={quote.id === openId ? "is-selected" : undefined}
                onClick={() => setOpenId(quote.id)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setOpenId(quote.id);
                }}
              >
                <td className="is-code">{quote.versionLabel}</td>
                <td>{formatDate(quote.quoteDate)}</td>
                <td>{quote.lines.length}</td>
                <td>{quote.total ? formatBRL(quote.total) : "—"}</td>
                <td>{formatDate(quote.validUntil)}</td>
                <td>
                  <span className={quoteBadgeClass(quote.status)}>
                    {QUOTE_STATUS_LABELS[quote.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="line-actions">
        {canEdit && (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={saving}
            onClick={() =>
              void run(async () => {
                const created = await createQuoteVersion(project.id);
                setOpenId(created.id);
              })
            }
          >
            {draft ? "Abrir rascunho" : "Criar nova versão"}
          </button>
        )}
      </div>

      {open && (
        <div className="quote-workspace">
          <div className="quote-workspace__head">
            <h4>
              <span className="code">{open.versionLabel}</span>{" "}
              <span className={quoteBadgeClass(open.status)}>
                {QUOTE_STATUS_LABELS[open.status]}
              </span>
            </h4>
            {open.status !== "DRAFT" && (
              <p className="field__hint">
                Proposta apresentada é histórico: os valores são os que o cliente recebeu, não os
                de hoje. Para renegociar, crie uma nova versão.
              </p>
            )}
          </div>

          <div className="table-container">
            <table className="table table--quote-lines">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>Quantidade</th>
                  <th>Unidade</th>
                  <th>Origem do preço</th>
                  <th>Preço unitário</th>
                  <th>Total</th>
                  {editable && <th aria-label="Ações" />}
                </tr>
              </thead>
              <tbody>
                {open.lines.length === 0 && (
                  <tr>
                    <td colSpan={editable ? 7 : 6}>
                      Nenhum produto na proposta. Adicione ao menos um para poder enviar.
                    </td>
                  </tr>
                )}
                {open.lines.map((line) => (
                  <tr key={line.id}>
                    <td>
                      <EntityLink
                        kind="product"
                        id={line.productId}
                        code={line.productCode}
                        name={line.productName}
                      />
                    </td>
                    <td>
                      {editable ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`Quantidade de ${line.productCode}`}
                          defaultValue={line.quotedQuantity ?? ""}
                          onBlur={(event) =>
                            void run(() =>
                              updateQuoteLine(line.id, {
                                quotedQuantity: event.target.value.trim() || null,
                              }),
                            )
                          }
                        />
                      ) : (
                        (line.quotedQuantity ?? "—")
                      )}
                    </td>
                    <td>
                      {editable ? (
                        <input
                          type="text"
                          aria-label={`Unidade de ${line.productCode}`}
                          defaultValue={line.uomCode ?? ""}
                          onBlur={(event) =>
                            void run(() =>
                              updateQuoteLine(line.id, {
                                uomCode: event.target.value.trim() || null,
                              }),
                            )
                          }
                        />
                      ) : (
                        (line.uomCode ?? "—")
                      )}
                    </td>
                    <td>
                      {QUOTE_PRICE_SOURCE_LABELS[line.priceSource]}
                      {line.pricing?.pricingCode && (
                        <div className="field__hint">
                          <span className="code">{line.pricing.pricingCode}</span>
                          {line.pricing.tierQuantity ? ` · faixa ${line.pricing.tierQuantity}` : ""}
                        </div>
                      )}
                    </td>
                    <td>
                      {editable && line.priceSource === "MANUAL" ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={`Preço unitário de ${line.productCode}`}
                          defaultValue={line.unitPrice ?? ""}
                          onBlur={(event) =>
                            void run(() =>
                              updateQuoteLine(line.id, {
                                unitPrice: event.target.value.trim() || null,
                              }),
                            )
                          }
                        />
                      ) : line.unitPrice ? (
                        formatBRL(line.unitPrice)
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{line.total ? formatBRL(line.total) : "—"}</td>
                    {editable && (
                      <td className="table__actions">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={saving}
                          onClick={() => void openPricing(line)}
                        >
                          Usar precificação
                        </button>
                        {line.priceSource !== "MANUAL" && (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={saving}
                            onClick={() => void run(() => useManualQuotePrice(line.id))}
                          >
                            Usar preço manual
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={saving}
                          onClick={() => void run(() => removeQuoteLine(line.id))}
                        >
                          Remover
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={editable ? 5 : 4}>Total da proposta</td>
                  <td colSpan={2}>
                    {/* Total parcial não existe: com linha sem preço, não há total. */}
                    <strong>{open.total ? formatBRL(open.total) : "—"}</strong>
                    {missingPrice && (
                      <div className="field__hint">Existem produtos sem preço definido.</div>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {pricingLineId && (
            <div className="inline-form">
              <h5>Faixas de precificação do produto</h5>
              {!pricingOptions ? (
                <p className="field__hint">
                  Nenhuma precificação ativa para este produto. Feche uma precificação antes de
                  vincular o preço.
                </p>
              ) : (
                <ul className="plain-list">
                  {pricingOptions.tiers.map((tier) => (
                    <li key={tier.id}>
                      {tier.quantity} {tier.uomCode} ·{" "}
                      {tier.selectedUnitPrice ? formatBRL(tier.selectedUnitPrice) : "sem preço"}{" "}
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={saving || !tier.selectedUnitPrice}
                        onClick={() =>
                          void run(async () => {
                            await applyQuotePricing(pricingLineId, tier.id);
                            setPricingLineId(null);
                          })
                        }
                      >
                        Usar esta faixa
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="field__hint">
                A quantidade da linha precisa corresponder exatamente à faixa — o sistema não
                escolhe faixa aproximada nem interpola preço.
              </p>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setPricingLineId(null)}
              >
                Fechar
              </button>
            </div>
          )}

          {editable && availableProducts.length > 0 && (
            <div className="inline-form">
              <label htmlFor="quote-add-product">Adicionar produto à proposta</label>
              <select
                id="quote-add-product"
                value={addProductId}
                onChange={(event) => setAddProductId(event.target.value)}
              >
                <option value="">Selecione…</option>
                {availableProducts.map((link) => (
                  <option key={link.id} value={link.id}>
                    {link.productCode} · {link.productName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={saving || addProductId === ""}
                onClick={() =>
                  void run(async () => {
                    await addQuoteLine(open.id, addProductId);
                    setAddProductId("");
                  })
                }
              >
                Adicionar
              </button>
            </div>
          )}

          {editable && availableProducts.length === 0 && linkedProducts.length === 0 && (
            <p className="field__hint">
              O projeto ainda não tem produtos. Adicione um produto ao projeto para poder orçá-lo.
            </p>
          )}

          <div className="quote-workspace__conditions">
            <div className="field field--narrow">
              <label htmlFor="quote-valid-until">Validade da proposta</label>
              <input
                id="quote-valid-until"
                type="date"
                disabled={!editable}
                defaultValue={open.validUntil ? open.validUntil.slice(0, 10) : ""}
                onBlur={(event) =>
                  void run(() =>
                    updateQuoteVersion(open.id, { validUntil: event.target.value || null }),
                  )
                }
              />
            </div>
            <div className="field field--narrow">
              <label htmlFor="quote-payment-terms">Condições de pagamento</label>
              <input
                id="quote-payment-terms"
                type="text"
                disabled={!editable}
                defaultValue={open.paymentTerms ?? ""}
                onBlur={(event) =>
                  void run(() =>
                    updateQuoteVersion(open.id, { paymentTerms: event.target.value || null }),
                  )
                }
              />
            </div>
            <div className="field field--narrow">
              <label htmlFor="quote-lead-time">Prazo de entrega (dias)</label>
              <input
                id="quote-lead-time"
                type="text"
                inputMode="numeric"
                disabled={!editable}
                defaultValue={open.leadTimeDays ? String(open.leadTimeDays) : ""}
                onBlur={(event) =>
                  void run(() =>
                    updateQuoteVersion(open.id, {
                      leadTimeDays: event.target.value ? Number(event.target.value) : null,
                    }),
                  )
                }
              />
            </div>
            <div className="field">
              <label htmlFor="quote-notes">Observações comerciais</label>
              <textarea
                id="quote-notes"
                rows={2}
                disabled={!editable}
                defaultValue={open.commercialNotes ?? ""}
                onBlur={(event) =>
                  void run(() =>
                    updateQuoteVersion(open.id, { commercialNotes: event.target.value || null }),
                  )
                }
              />
            </div>
          </div>

          <div className="line-actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => window.open(`/comercial/orcamentos/${open.id}/imprimir`, "_blank")}
            >
              Imprimir
            </button>

            {editable && (
              <button
                type="button"
                className="btn btn--accent"
                disabled={saving || open.lines.length === 0}
                onClick={() => {
                  const partial = open.lines.some(
                    (line) =>
                      line.pricing?.costQuality === "PARTIAL" ||
                      line.pricing?.costQuality === "NO_COST",
                  );
                  if (
                    partial &&
                    !window.confirm(
                      "Esta proposta utiliza preço com custo industrial incompleto. Enviar assim?",
                    )
                  ) {
                    return;
                  }
                  void run(() =>
                    sendQuoteVersion(open.id, partial ? { confirmIncompleteCost: true } : {}),
                  );
                }}
              >
                Enviar ao cliente
              </button>
            )}

            {canEdit && open.status === "SENT" && (
              <>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={saving}
                  onClick={() => void run(() => acceptQuoteVersion(open.id))}
                >
                  Registrar aceite
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={saving}
                  onClick={() => void run(() => rejectQuoteVersion(open.id, {}))}
                >
                  Registrar recusa
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </FormSection>
  );
}
