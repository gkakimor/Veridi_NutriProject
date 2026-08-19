import { Fragment, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { ProjectDTO, ProjectStatus, QuoteLineDTO, QuoteVersionDTO } from "@veridi/shared";
import { QUOTE_STATUS_LABELS, QUOTE_PRICE_SOURCE_LABELS } from "@veridi/shared";
import {
  acceptQuoteVersion,
  addQuoteLine,
  applyQuotePricing,
  createOrderFromQuote,
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
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EntityLink, entityHref } from "../../components/EntityLink";
import { QuoteClosingSection } from "./QuoteClosingSection";
import { FormSection } from "../../components/FormSection";
import { IncompleteCostApiError } from "../../lib/api-errors";
import { formatBRL } from "../../lib/currency";
import { QuoteConditionsForm } from "./QuoteConditionsForm";

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

/**
 * Faixa vigente para EXATAMENTE esta quantidade.
 *
 * Comparação numérica, não textual: "1000" e "1000.000000" são a mesma
 * quantidade e vêm do banco em formatos diferentes. O que nunca acontece é
 * casar por aproximação — faixa é acordo comercial registrado para uma
 * quantidade, e escolher a vizinha inventaria negociação.
 */
function exactTier(pricing: PricingVersionDTO | null, quantity: string | null) {
  if (!pricing || !quantity) return null;
  const alvo = Number(quantity);
  if (!Number.isFinite(alvo)) return null;
  return pricing.tiers.find((tier) => Number(tier.quantity) === alvo) ?? null;
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
  projectStatus,
  onChanged,
}: {
  project: ProjectDTO;
  canEdit: boolean;
  /** Só para explicar por que a ação sumiu — nunca para liberar a ação. */
  projectStatus?: ProjectStatus;
  onChanged: () => void;
}) {
  /*
   * Projeto aprovado ou cancelado é histórico e não recebe proposta nova.
   * O botão existia mesmo assim, e a recusa só aparecia DEPOIS do clique —
   * no fim de um caminho em que a pessoa já tinha conferido custo e preço.
   * Ação impossível não deve ser oferecida; a explicação toma o lugar dela.
   */
  const projectOpen = projectStatus !== "APPROVED" && projectStatus !== "CANCELLED";
  const versions = project.quoteVersions;
  const draft = versions.find((quote) => quote.status === "DRAFT") ?? null;

  /*
   * Quem volta da simulação de CMV volta para a versão de onde saiu — e para
   * a linha de onde saiu. Sem isso, "voltar ao orçamento" devolveria a
   * pessoa ao rascunho corrente, que pode não ser a versão que ela estava
   * lendo, e a busca recomeçaria do zero.
   */
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returningToQuoteId = params.get("quoteVersionId");
  const returningToLineId = params.get("quoteLineId");

  const [openId, setOpenId] = useState<string | null>(
    returningToQuoteId ?? draft?.id ?? versions.at(-1)?.id ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addProductId, setAddProductId] = useState("");
  const [sendConfirm, setSendConfirm] = useState<{
    quote: QuoteVersionDTO;
    /** Vazio quando a proposta não tem custo incompleto a declarar. */
    lines: QuoteLineDTO[];
    incompleteCost: boolean;
  } | null>(null);
  const [pricingLineId, setPricingLineId] = useState<string | null>(null);
  const [pricingOptions, setPricingOptions] = useState<PricingVersionDTO | null>(null);
  /** Precificação ativa por linha — consultada, nunca aplicada sozinha. */
  const [tierByLine, setTierByLine] = useState<Record<string, PricingVersionDTO | null>>({});

  /*
   * Abre a versão pedida — e só escolhe sozinho quando ninguém pediu nada.
   *
   * Antes o efeito voltava para a última versão sempre que o id aberto não
   * estava na lista. Criar a V2 caía exatamente nesse buraco: o id novo era
   * selecionado, a lista ainda era a antiga por um render, e a tela voltava
   * para a V1 enviada — parecendo que a nova versão nasceu bloqueada.
   */
  useEffect(() => {
    if (openId !== null) return;
    setOpenId(draft?.id ?? versions.at(-1)?.id ?? null);
  }, [versions, draft, openId]);

  const open = versions.find((quote) => quote.id === openId) ?? null;
  const editable = canEdit && projectOpen && open?.status === "DRAFT";

  // Voltar do CMV traz a linha de volta ao campo de visão — a versão pode ter
  // muitas linhas, e "está aberta" não é o mesmo que "está visível".
  useEffect(() => {
    if (!returningToLineId) return;
    document.getElementById(`quote-line-${returningToLineId}`)?.scrollIntoView({ block: "center" });
  }, [returningToLineId, openId]);

  /*
   * Consulta a precificação vigente de cada linha assim que produto e
   * quantidade existem. É CONSULTA: o preço da linha continua sendo o que
   * alguém decidiu, e nada aqui escreve `unitPrice`.
   */
  const linesSignature = (open?.lines ?? [])
    .map((line) => `${line.id}:${line.quotedQuantity ?? ""}`)
    .join("|");
  useEffect(() => {
    if (!open || open.status !== "DRAFT") {
      setTierByLine({});
      return;
    }
    let active = true;
    const alvo = open.lines.filter((line) => line.quotedQuantity);
    void Promise.all(
      alvo.map(async (line) => {
        // Sem precificação ativa (ou sem permissão) a resposta é ausência de
        // opção, não erro técnico.
        const options = await getQuotePricingOptions(line.id).catch(() => null);
        return [line.id, options] as const;
      }),
    ).then((pares) => {
      if (active) setTierByLine(Object.fromEntries(pares));
    });
    return () => {
      active = false;
    };
    // `linesSignature` cobre produto+quantidade de cada linha: mudar a
    // quantidade reconsulta, digitar em outro campo não.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.id, open?.status, linesSignature]);

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

  /** Linhas cujo preço veio de uma faixa com custo industrial incompleto. */
  function incompleteCostLines(quote: QuoteVersionDTO): QuoteLineDTO[] {
    return quote.lines.filter(
      (line) =>
        line.pricing?.costQuality === "PARTIAL" || line.pricing?.costQuality === "NO_COST",
    );
  }

  /**
   * Envio do orçamento.
   *
   * Enviar é ato comercial com data: a versão sai do rascunho, congela a
   * proveniência e vira o documento que o cliente recebe. Sempre confirma —
   * antes só o custo incompleto perguntava, e uma proposta de preço manual
   * saía no primeiro clique, sem volta.
   *
   * A proveniência da linha permite ANTECIPAR o custo incompleto e dizer
   * QUAIS linhas estão sem base. O 409 continua tratado: o backend é a
   * autoridade final sobre o que é incompleto, então uma recusa inesperada
   * reabre a confirmação já no tom certo.
   */
  function trySend(quote: QuoteVersionDTO) {
    const incomplete = incompleteCostLines(quote);
    setSendConfirm({ quote, lines: incomplete, incompleteCost: incomplete.length > 0 });
  }

  async function confirmSend(target: {
    quote: QuoteVersionDTO;
    lines: QuoteLineDTO[];
    incompleteCost: boolean;
  }) {
    setSaving(true);
    setError(null);
    try {
      await sendQuoteVersion(
        target.quote.id,
        target.incompleteCost ? { confirmIncompleteCost: true } : {},
      );
      onChanged();
    } catch (err) {
      if (err instanceof IncompleteCostApiError) {
        // O servidor viu um custo incompleto que a tela não antecipou.
        setSendConfirm({ quote: target.quote, lines: [], incompleteCost: true });
        return;
      }
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
              <th className="is-numeric">Total</th>
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
                <td className="is-numeric">{quote.total ? formatBRL(quote.total) : "—"}</td>
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
        {canEdit && projectOpen && (
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

      {canEdit && !projectOpen && (
        <p className="field__hint">
          {projectStatus === "APPROVED"
            ? "Projeto aprovado é histórico: a proposta aceita ficou registrada como está. Para propor de novo ao mesmo cliente, crie um projeto novo."
            : "Projeto cancelado é histórico e não recebe proposta nova."}
        </p>
      )}

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
                  <th className="is-numeric">Quantidade</th>
                  <th>Unidade</th>
                  <th>Origem do preço</th>
                  <th className="is-numeric">Preço unitário</th>
                  <th className="is-numeric">Total</th>
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
                {open.lines.map((line) => {
                  const options = tierByLine[line.id] ?? null;
                  const tier = exactTier(options, line.quotedQuantity);
                  const cmvHref =
                    `/produtos/${line.productId}/cmv` +
                    `?quantity=${encodeURIComponent(line.quotedQuantity ?? "")}` +
                    `&projectId=${project.id}&quoteVersionId=${open.id}&quoteLineId=${line.id}`;
                  return (
                    <Fragment key={line.id}>
                  <tr
                    id={`quote-line-${line.id}`}
                    className={returningToLineId === line.id ? "is-selected" : undefined}
                  >
                    <td>
                      <EntityLink
                        kind="product"
                        id={line.productId}
                        code={line.productCode}
                        name={line.productName}
                      />
                    </td>
                    <td className="is-numeric">
                      {editable ? (
                        <input
                          /*
                           * `key` amarrada ao valor do servidor.
                           *
                           * O campo é não-controlado (`defaultValue`), então o
                           * DOM guarda o que foi digitado e ignora mudanças
                           * vindas de fora. Aplicar uma faixa passa a definir
                           * quantidade, unidade e preço no servidor — e a
                           * linha continuava mostrando os campos vazios, num
                           * documento que pode ser impresso e enviado. Trocar
                           * a `key` remonta o campo com o valor novo.
                           */
                          key={`qtd-${line.quotedQuantity ?? ""}`}
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
                          key={`uom-${line.uomCode ?? ""}`}
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
                    <td className="is-numeric">
                      {editable && line.priceSource === "MANUAL" ? (
                        <input
                          key={`preco-${line.unitPrice ?? ""}`}
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
                    <td className="is-numeric">{line.total ? formatBRL(line.total) : "—"}</td>
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

                  {/* Sugestão de preço: informa e oferece: nunca escreve o
                      preço da linha sozinha. Preço só muda por decisão de
                      quem negocia — faixa explícita ou manual. */}
                  {editable && line.quotedQuantity && (
                    <tr className="quote-suggestion">
                      <td colSpan={7}>
                        {tier && tier.selectedUnitPrice ? (
                          <div className="quote-suggestion__row">
                            <span>
                              Existe uma precificação vigente para {tier.quantity} {tier.uomCode}:{" "}
                              <strong>{formatBRL(tier.selectedUnitPrice)}</strong> / {tier.uomCode}.
                            </span>
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              disabled={saving}
                              onClick={() => void run(() => applyQuotePricing(line.id, tier.id))}
                            >
                              Aplicar preço calculado
                            </button>
                            <Link className="btn btn--ghost btn--sm" to={cmvHref}>
                              Simular CMV
                            </Link>
                          </div>
                        ) : (
                          <div className="quote-suggestion__row">
                            <span>
                              Não existe precificação vigente para esta quantidade.
                            </span>
                            <Link className="btn btn--ghost btn--sm" to={cmvHref}>
                              Simular CMV
                            </Link>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                    </Fragment>
                  );
                })}
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

          <QuoteConditionsForm
            quote={open}
            editable={editable}
            saving={saving}
            onSave={(input) => void run(() => updateQuoteVersion(open.id, input))}
          />

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
                onClick={() => void trySend(open)}
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

          {/* O que falta depois do "sim" do cliente. */}
          <QuoteClosingSection
            quote={open}
            projectId={project.id}
            projectStatus={projectStatus}
            canEdit={canEdit}
            saving={saving}
            onGenerate={() =>
              void run(async () => {
                const pedido = await createOrderFromQuote(open.id);
                navigate(entityHref("customerOrder", pedido.id));
              })
            }
          />
        </div>
      )}

      <ConfirmDialog
        open={sendConfirm !== null}
        title={
          sendConfirm?.incompleteCost
            ? "Enviar com custo incompleto?"
            : "Enviar esta proposta ao cliente?"
        }
        confirmLabel={sendConfirm?.incompleteCost ? "Enviar mesmo assim" : "Enviar ao cliente"}
        cancelLabel="Voltar e revisar"
        confirmTone="accent"
        message={
          <>
            {sendConfirm?.incompleteCost ? (
              <>
                <p>
                  Uma ou mais linhas desta proposta usam um custo industrial incompleto ou
                  estimado.
                </p>
                <p>
                  O preço comercial pode ser enviado, mas a base de custo ainda possui informações
                  pendentes. Confirme somente se deseja enviar esta versão mesmo assim.
                </p>
              </>
            ) : (
              <>
                <p>
                  A versão <span className="code">{sendConfirm?.quote.code}</span> sai do rascunho e
                  passa a ser o documento enviado ao cliente, com data de envio registrada.
                </p>
                <p>
                  Depois disso a versão fica somente leitura: renegociar exige criar uma versão
                  nova.
                </p>
              </>
            )}
            {sendConfirm && sendConfirm.lines.length > 0 && (
              <ul className="confirm-dialog__list">
                {sendConfirm.lines.map((line) => (
                  <li key={line.id}>
                    <span className="code">{line.productCode}</span> {line.productName} —{" "}
                    {line.pricing?.costQuality === "NO_COST"
                      ? "sem custo industrial conhecido"
                      : "custo industrial parcial"}
                    {/* Avisos reais da faixa, quando a precificação registrou algum. */}
                    {line.pricing?.warnings?.length ? (
                      <ul>
                        {line.pricing.warnings.map((warning, index) => (
                          <li key={index}>{warning.message}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        }
        onCancel={() => setSendConfirm(null)}
        onConfirm={() => {
          const target = sendConfirm;
          setSendConfirm(null);
          if (target) void confirmSend(target);
        }}
      />
    </FormSection>
  );
}
