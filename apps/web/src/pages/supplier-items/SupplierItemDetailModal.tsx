import { useCallback, useEffect, useState } from "react";
import type { SupplierItemDetailDTO, UnitOfMeasureDTO } from "@veridi/shared";
import {
  DEFAULT_OFFER_CURRENCY,
  SUPPLIER_ITEM_OFFER_SOURCE_LABELS,
  SUPPLIER_ITEM_QUALIFICATION_LABELS,
} from "@veridi/shared";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { FormSection } from "../../components/FormSection";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useAuth } from "../../app/AuthProvider";
import { listUnits } from "../../lib/units-api";
import {
  changeSupplierItemQualification,
  createSupplierItemOffer,
  getSupplierItem,
  setSupplierItemPreferred,
  updateSupplierItem,
} from "../../lib/supplier-items-api";
import { qualificationBadgeClass } from "./SupplierItemsPage";
import { EntityLink } from "../../components/EntityLink";
import { formatDate } from "../../lib/dates";
import { apiErrorMessage } from "../../lib/api-errors";
import { exigirDecimal } from "../../lib/decimal-field";

function formatDateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

/**
 * Detalhe da relação: dados comerciais, homologação com histórico e as
 * ofertas de preço.
 *
 * Oferta é imutável: corrigir preço/MOQ é registrar outra. Homologar e
 * bloquear são da Qualidade; preferencial e preços são de Compras.
 */
export function SupplierItemDetailModal({
  supplierItemId,
  onClose,
}: {
  supplierItemId: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [supplierItem, setSupplierItem] = useState<SupplierItemDetailDTO | null>(null);
  const [units, setUnits] = useState<UnitOfMeasureDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmarInativacao, setConfirmarInativacao] = useState(false);

  const [supplierItemCode, setSupplierItemCode] = useState("");
  const [commercialNotes, setCommercialNotes] = useState("");
  const [qualificationNote, setQualificationNote] = useState("");

  const [price, setPrice] = useState("");
  const [currencyCode, setCurrencyCode] = useState(DEFAULT_OFFER_CURRENCY);
  const [priceUomCode, setPriceUomCode] = useState("");
  const [moq, setMoq] = useState("");
  const [moqUomCode, setMoqUomCode] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [offerNotes, setOfferNotes] = useState("");

  const canPurchase = user?.role === "PURCHASING" || user?.role === "ADMIN";
  const canQualify = user?.role === "QUALITY" || user?.role === "ADMIN";

  const load = useCallback(() => {
    getSupplierItem(supplierItemId)
      .then((result) => {
        setSupplierItem(result);
        setSupplierItemCode(result.supplierItemCode ?? "");
        setCommercialNotes(result.commercialNotes ?? "");
        setPriceUomCode((current) => current || result.itemUnitCode);
        setMoqUomCode((current) => current || result.itemUnitCode);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar a relação"),
      );
  }, [supplierItemId]);

  useEffect(() => {
    load();
    listUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, [load]);

  async function run(action: () => Promise<SupplierItemDetailDTO>, onDone?: () => void) {
    setSaving(true);
    setError(null);
    try {
      const updated = await action();
      setSupplierItem(updated);
      onDone?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao executar a ação"));
    } finally {
      setSaving(false);
    }
  }

  if (!supplierItem) {
    return (
      <FullWorkspaceModal
        open
        onClose={onClose}
        crumb="Compras / Item × Fornecedor"
        crumbActive="Detalhe"
        title="Carregando…"
        footer={null}
      >
        {error ? <p className="form-alert" role="alert">{error}</p> : <p>Carregando…</p>}
      </FullWorkspaceModal>
    );
  }

  return (
    <FullWorkspaceModal
      open
      onClose={onClose}
      crumb="Compras / Item × Fornecedor"
      crumbActive={supplierItem.itemCode}
      title={`${supplierItem.itemName} · ${supplierItem.supplierName}`}
      codeChip={supplierItem.itemCode}
      footer={
        <>
          <span className="modal-fullscreen__foot-meta">
            Preço aqui é referência do fornecedor — o custo real de aquisição continua vindo do
            recebimento.
          </span>
        </>
      }
    >
      {error && <p className="form-alert" role="alert">{error}</p>}

      <FormSection title="Relação">
        <dl className="definition-list">
          <dt>Item</dt>
          <dd>
            <EntityLink kind="item" id={supplierItem.itemId} code={supplierItem.itemCode} name={supplierItem.itemName} /> (
            {supplierItem.itemUnitCode})
          </dd>
          <dt>Código legado do item</dt>
          <dd className="is-code">{supplierItem.itemExternalCode ?? "—"}</dd>
          <dt>Fornecedor</dt>
          <dd>
            <EntityLink kind="supplier" id={supplierItem.supplierId} code={supplierItem.supplierCode} name={supplierItem.supplierName} />
          </dd>
          <dt>Homologação</dt>
          <dd>
            <span className={qualificationBadgeClass(supplierItem.qualificationStatus)}>
              {SUPPLIER_ITEM_QUALIFICATION_LABELS[supplierItem.qualificationStatus]}
            </span>
          </dd>
          <dt>Preferencial</dt>
          <dd>{supplierItem.preferred ? "Sim" : "Não"}</dd>
          <dt>Situação</dt>
          <dd>{supplierItem.active ? "Ativa" : "Inativa"}</dd>
        </dl>

        {canPurchase && (
          <>
            <div className="field-grid-2">
              <div className="field">
                <label htmlFor="detail-supplier-item-code">Código do item no fornecedor</label>
                <input
                  id="detail-supplier-item-code"
                  type="text"
                  value={supplierItemCode}
                  onChange={(event) => setSupplierItemCode(event.target.value)}
                />
                <span className="field__hint">
                  Referência do catálogo do fornecedor — não é o código interno nem o legado.
                </span>
              </div>
              <div className="field">
                <label htmlFor="detail-commercial-notes">Observações comerciais</label>
                {/* Texto de frase inteira em input de uma linha aparecia
                    cortado, sem forma de ler o resto ali. */}
                <textarea
                  id="detail-commercial-notes"
                  rows={3}
                  value={commercialNotes}
                  onChange={(event) => setCommercialNotes(event.target.value)}
                />
              </div>
            </div>

            <div className="line-actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={saving}
                onClick={() =>
                  void run(() =>
                    updateSupplierItem(supplierItem.id, {
                      supplierItemCode: supplierItemCode.trim() || null,
                      commercialNotes: commercialNotes.trim() || null,
                    }),
                  )
                }
              >
                Salvar dados comerciais
              </button>

              {/* Preferencial é decisão operacional — não muda porque alguém baixou o preço. */}
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={
                  saving ||
                  (!supplierItem.preferred &&
                    (supplierItem.qualificationStatus !== "APPROVED" || !supplierItem.active))
                }
                onClick={() =>
                  void run(() => setSupplierItemPreferred(supplierItem.id, !supplierItem.preferred))
                }
              >
                {supplierItem.preferred ? "Remover preferencial" : "Marcar como preferencial"}
              </button>

              {/*
                  A ação menos reversível do painel tinha o menor peso visual:
                  texto puro ENTRE dois botões com borda. Ganhou a variante
                  destrutiva e a confirmação; o que faltava era sair do meio do
                  grupo de rotina — encostada em "Salvar" e "Preferencial" ela
                  continuava vizinha de quem só queria salvar. Agora fica no fim
                  da linha, separada. Reativar é construtivo e segue discreto.
              */}
              <button
                type="button"
                className={
                  supplierItem.active
                    ? "btn btn--danger btn--sm btn--set-apart"
                    : "btn btn--ghost btn--sm btn--set-apart"
                }
                disabled={saving}
                onClick={() => {
                  if (supplierItem.active) {
                    setConfirmarInativacao(true);
                    return;
                  }
                  void run(() => updateSupplierItem(supplierItem.id, { active: true }));
                }}
              >
                {supplierItem.active ? "Inativar relação" : "Reativar relação"}
              </button>
            </div>
          </>
        )}
      </FormSection>

      <FormSection
        title="Homologação"
        subtitle="Homologação é por item, não pelo fornecedor inteiro. Pendente significa ausência de homologação — não é reprovação."
      >
        {(canQualify || canPurchase) && (
          <div className="field">
            <label htmlFor="qualification-note">Observação da decisão</label>
            <input
              id="qualification-note"
              type="text"
              value={qualificationNote}
              onChange={(event) => setQualificationNote(event.target.value)}
            />
          </div>
        )}

        <div className="line-actions">
          {canQualify && (
            <>
              <button
                type="button"
                className="btn btn--accent btn--sm"
                disabled={saving || supplierItem.qualificationStatus === "APPROVED"}
                onClick={() =>
                  void run(
                    () =>
                      changeSupplierItemQualification(supplierItem.id, {
                        status: "APPROVED",
                        ...(qualificationNote.trim() ? { note: qualificationNote.trim() } : {}),
                      }),
                    () => setQualificationNote(""),
                  )
                }
              >
                Homologar
              </button>
              <button
                type="button"
                className="btn btn--danger btn--sm"
                disabled={saving || supplierItem.qualificationStatus === "BLOCKED"}
                onClick={() =>
                  void run(
                    () =>
                      changeSupplierItemQualification(supplierItem.id, {
                        status: "BLOCKED",
                        ...(qualificationNote.trim() ? { note: qualificationNote.trim() } : {}),
                      }),
                    () => setQualificationNote(""),
                  )
                }
              >
                Bloquear
              </button>
            </>
          )}
          {(canQualify || canPurchase) && supplierItem.qualificationStatus !== "PENDING" && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={saving}
              onClick={() =>
                void run(
                  () =>
                    changeSupplierItemQualification(supplierItem.id, {
                      status: "PENDING",
                      ...(qualificationNote.trim() ? { note: qualificationNote.trim() } : {}),
                    }),
                  () => setQualificationNote(""),
                )
              }
            >
              Voltar para pendente
            </button>
          )}
        </div>

        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>De</th>
                <th>Para</th>
                <th>Quem</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>
              {supplierItem.qualificationHistory.map((event) => (
                <tr key={event.id}>
                  <td>{formatDateTime(event.changedAt)}</td>
                  <td>
                    {event.fromStatus
                      ? SUPPLIER_ITEM_QUALIFICATION_LABELS[event.fromStatus]
                      : "—"}
                  </td>
                  <td>{SUPPLIER_ITEM_QUALIFICATION_LABELS[event.toStatus]}</td>
                  <td>{event.changedByName ?? "—"}</td>
                  <td>{event.note ?? "—"}</td>
                </tr>
              ))}
              {/* Mesma cortesia que a tabela de ofertas logo abaixo já faz:
                  cabeçalho sobre corpo vazio não diz nada a ninguém. */}
              {supplierItem.qualificationHistory.length === 0 && (
                <tr>
                  <td colSpan={5} className="table__empty">
                    Nenhuma decisão de homologação registrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </FormSection>

      <FormSection
        title="Ofertas / preços"
        subtitle="Oferta é imutável: mudou preço, MOQ, moeda ou vigência, registra-se outra. Oferta sem vigência é observação histórica, nunca preço atual."
      >
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th className="is-numeric">Preço</th>
                <th>Moeda</th>
                <th>Unidade</th>
                <th>Pedido mínimo</th>
                <th>Vigência</th>
                <th>Validade</th>
                <th>Situação</th>
                <th>Origem</th>
                <th>Registrada</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>
              {supplierItem.offers.map((offer) => (
                <tr key={offer.id}>
                  <td className="is-numeric">{offer.unitPrice}</td>
                  <td className="is-code">{offer.currencyCode}</td>
                  <td className="is-code">{offer.priceUomCode}</td>
                  <td>
                    {offer.minimumOrderQuantity
                      ? `${offer.minimumOrderQuantity} ${offer.minimumOrderUomCode ?? ""}`
                      : "—"}
                  </td>
                  <td>{formatDate(offer.effectiveAt)}</td>
                  <td>{formatDate(offer.validUntil)}</td>
                  <td>
                    {offer.isCurrent ? (
                      <span className="badge badge--active">Vigente</span>
                    ) : offer.effectiveAt ? (
                      <span className="badge badge--neutral">Histórica</span>
                    ) : (
                      <span className="badge badge--neutral">Referência sem vigência</span>
                    )}
                  </td>
                  <td>{SUPPLIER_ITEM_OFFER_SOURCE_LABELS[offer.source]}</td>
                  <td>{formatDateTime(offer.createdAt)}</td>
                  {/* O formulário pede a observação da oferta e a tabela não
                      tinha onde mostrá-la: o texto era gravado e não voltava
                      para ninguém. É onde ficam as notas de origem do legado. */}
                  <td className="cell-note">{offer.notes ?? "—"}</td>
                </tr>
              ))}
              {supplierItem.offers.length === 0 && (
                <tr>
                  <td colSpan={10} className="table__empty">
                    Nenhum preço registrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canPurchase && (
          <>
            <div className="field-grid-2">
              <div className="field">
                <label htmlFor="offer-price">Preço</label>
                <input
                  id="offer-price"
                  type="text"
                  inputMode="decimal"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="offer-currency">Moeda</label>
                <input
                  id="offer-currency"
                  type="text"
                  maxLength={3}
                  value={currencyCode}
                  onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())}
                />
                <span className="field__hint">
                  Moeda diferente de BRL fica como referência: não há conversão cambial no sistema.
                </span>
              </div>
              <div className="field">
                <label htmlFor="offer-price-uom">Unidade do preço</label>
                <select
                  id="offer-price-uom"
                  value={priceUomCode}
                  onChange={(event) => setPriceUomCode(event.target.value)}
                >
                  {units.map((unit) => (
                    <option key={unit.code} value={unit.code}>
                      {unit.code} — {unit.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="offer-moq">Pedido mínimo</label>
                <input
                  id="offer-moq"
                  type="text"
                  inputMode="decimal"
                  value={moq}
                  onChange={(event) => setMoq(event.target.value)}
                  placeholder="Opcional"
                />
              </div>
              <div className="field">
                <label htmlFor="offer-moq-uom">Unidade do pedido mínimo</label>
                <select
                  id="offer-moq-uom"
                  value={moqUomCode}
                  onChange={(event) => setMoqUomCode(event.target.value)}
                >
                  {units.map((unit) => (
                    <option key={unit.code} value={unit.code}>
                      {unit.code} — {unit.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="offer-effective">Vigência a partir de</label>
                <input
                  id="offer-effective"
                  type="date"
                  value={effectiveAt}
                  onChange={(event) => setEffectiveAt(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="offer-valid-until">Validade</label>
                <input
                  id="offer-valid-until"
                  type="date"
                  value={validUntil}
                  onChange={(event) => setValidUntil(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="offer-notes">Observação</label>
                <input
                  id="offer-notes"
                  type="text"
                  value={offerNotes}
                  onChange={(event) => setOfferNotes(event.target.value)}
                />
              </div>
            </div>

            <div className="line-actions">
              <button
                type="button"
                className="btn btn--accent btn--sm"
                disabled={saving || !price.trim() || !priceUomCode}
                onClick={() =>
                  void run(
                    () =>
                      createSupplierItemOffer(supplierItem.id, {
                        unitPrice: exigirDecimal(price, "Preço"),
                        currencyCode: currencyCode.trim() || DEFAULT_OFFER_CURRENCY,
                        priceUomCode,
                        ...(moq.trim()
                          ? {
                              minimumOrderQuantity: exigirDecimal(moq, "Pedido mínimo"),
                              minimumOrderUomCode: moqUomCode,
                            }
                          : {}),
                        ...(effectiveAt
                          ? { effectiveAt: new Date(`${effectiveAt}T12:00:00`).toISOString() }
                          : {}),
                        ...(validUntil
                          ? { validUntil: new Date(`${validUntil}T12:00:00`).toISOString() }
                          : {}),
                        ...(offerNotes.trim() ? { notes: offerNotes.trim() } : {}),
                      }),
                    () => {
                      setPrice("");
                      setMoq("");
                      setEffectiveAt("");
                      setValidUntil("");
                      setOfferNotes("");
                    },
                  )
                }
              >
                Registrar preço
              </button>
            </div>
          </>
        )}
      </FormSection>

      <ConfirmDialog
        open={confirmarInativacao}
        title="Inativar esta relação?"
        /* O botão que abriu já diz "Inativar relação": o confirmar responde
           com o verbo, senão parece o mesmo botão de novo. */
        confirmLabel="Inativar"
        cancelLabel="Cancelar"
        confirmTone="danger"
        message={
          <>
            <p>
              <b>{supplierItem.supplierName}</b> deixa de ser fornecedor considerado para{" "}
              <b>{supplierItem.itemCode}</b>: a relação sai do sourcing e as ofertas dela param de
              valer como referência de custo.
            </p>
            <p>
              As ofertas já registradas continuam no histórico, e ordens de compra passadas não são
              afetadas. A relação pode ser reativada depois.
            </p>
          </>
        }
        onCancel={() => setConfirmarInativacao(false)}
        onConfirm={() => {
          setConfirmarInativacao(false);
          void run(() => updateSupplierItem(supplierItem.id, { active: false }));
        }}
      />
    </FullWorkspaceModal>
  );
}
