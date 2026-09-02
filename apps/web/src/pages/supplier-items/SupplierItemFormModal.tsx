import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type {
  ItemDTO,
  SupplierDTO,
  SupplierItemDetailDTO,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { FormSection } from "../../components/FormSection";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { createSupplierItem } from "../../lib/supplier-items-api";
import { listUnits } from "../../lib/units-api";
import { ItemFormModal } from "../items/ItemFormModal";
import { SupplierFormModal } from "../suppliers/SupplierFormModal";

/**
 * Nova relação item × fornecedor.
 *
 * A grade da lista mostra homologação, preferencial, preço e pedido mínimo.
 * Este formulário pedia apenas item, fornecedor, código e observações, e a
 * relação nascia Pendente e sem preço — quem cadastrava quatro materiais
 * terminava com quatro relações que não sabiam precificar nada, e só
 * descobria isso ao calcular custo.
 *
 * Os quatro campos cabem aqui agora. Continuam OPCIONAIS: uma relação sem
 * oferta é registro legítimo, e é melhor dizer "sem oferta cadastrada" do
 * que fingir completude.
 */
export function SupplierItemFormModal({
  items,
  suppliers,
  onClose,
  onSaved,
}: {
  items: ItemDTO[];
  suppliers: SupplierDTO[];
  onClose: () => void;
  onSaved: (created: SupplierItemDetailDTO) => void;
}) {
  const [itemId, setItemId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [supplierItemCode, setSupplierItemCode] = useState("");
  const [commercialNotes, setCommercialNotes] = useState("");

  const [qualificationStatus, setQualificationStatus] = useState<"PENDING" | "APPROVED" | "BLOCKED">(
    "PENDING",
  );
  const [qualificationNote, setQualificationNote] = useState("");
  const [preferred, setPreferred] = useState(false);

  const [unitPrice, setUnitPrice] = useState("");
  const [priceUomCode, setPriceUomCode] = useState("");
  const [minimumOrderQuantity, setMinimumOrderQuantity] = useState("");
  const [minimumOrderUomCode, setMinimumOrderUomCode] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [offerNotes, setOfferNotes] = useState("");

  const [units, setUnits] = useState<UnitOfMeasureDTO[]>([]);
  /*
   * Cadastro no contexto — item e fornecedor.
   *
   * As duas listas chegam por prop, de quem abriu este formulário. O que
   * nasce aqui não pode esperar o recarregamento do pai: fica numa lista
   * própria que se junta à recebida, e o pai recarrega quando `onSaved`
   * fecha a relação.
   */
  const [itensNovos, setItensNovos] = useState<ItemDTO[]>([]);
  const [fornecedoresNovos, setFornecedoresNovos] = useState<SupplierDTO[]>([]);
  const [itemModalAberto, setItemModalAberto] = useState(false);
  const [fornecedorModalAberto, setFornecedorModalAberto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  const itensDisponiveis = [
    ...itensNovos,
    ...items.filter((item) => !itensNovos.some((novo) => novo.id === item.id)),
  ];
  const fornecedoresDisponiveis = [
    ...fornecedoresNovos,
    ...suppliers.filter((row) => !fornecedoresNovos.some((novo) => novo.id === row.id)),
  ];

  // Produto acabado é produzido, não comprado — fica fora da lista.
  const purchasableItems = itensDisponiveis.filter(
    (item) => item.type === "RAW_MATERIAL" || item.type === "PACKAGING",
  );
  const selectedItem = purchasableItems.find((item) => item.id === itemId);

  /*
   * A unidade do preço acompanha a unidade de estoque do item por padrão.
   *
   * Escolher item e ter de repetir "kg" logo abaixo é trabalho que o
   * sistema já sabe fazer — e a unidade continua editável para quem compra
   * em outra (saco, tonelada).
   */
  useEffect(() => {
    if (!selectedItem) return;
    setPriceUomCode((current) => current || selectedItem.unitCode);
    setMinimumOrderUomCode((current) => current || selectedItem.unitCode);
  }, [selectedItem]);

  const preencheuOferta = unitPrice.trim() !== "";
  const podeSerPreferencial = qualificationStatus === "APPROVED";

  // Bloquear/despender a homologação derruba a preferência: mesma regra do
  // domínio, aplicada já na tela para o estado não ficar impossível.
  useEffect(() => {
    if (!podeSerPreferencial && preferred) setPreferred(false);
  }, [podeSerPreferencial, preferred]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await createSupplierItem({
        itemId,
        supplierId,
        ...(supplierItemCode.trim() ? { supplierItemCode: supplierItemCode.trim() } : {}),
        ...(commercialNotes.trim() ? { commercialNotes: commercialNotes.trim() } : {}),
        ...(qualificationStatus !== "PENDING" ? { qualificationStatus } : {}),
        ...(qualificationNote.trim() ? { qualificationNote: qualificationNote.trim() } : {}),
        ...(preferred ? { preferred: true } : {}),
        ...(preencheuOferta
          ? {
              initialOffer: {
                unitPrice: unitPrice.trim(),
                priceUomCode: priceUomCode || selectedItem?.unitCode || "",
                ...(minimumOrderQuantity.trim()
                  ? {
                      minimumOrderQuantity: minimumOrderQuantity.trim(),
                      minimumOrderUomCode: minimumOrderUomCode || selectedItem?.unitCode || "",
                    }
                  : {}),
                ...(effectiveAt ? { effectiveAt } : {}),
                ...(validUntil ? { validUntil } : {}),
                ...(offerNotes.trim() ? { notes: offerNotes.trim() } : {}),
              },
            }
          : {}),
      });
      onSaved(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar a relação");
    } finally {
      setSaving(false);
    }
  }

  /** O que a linha vai mostrar na grade — dito antes de salvar. */
  const resumo = preencheuOferta
    ? `Será criada com oferta de ${unitPrice}/${priceUomCode || "?"}.`
    : "Será criada sem oferta cadastrada — o preço pode ser registrado depois.";

  return (
    <FullWorkspaceModal
      open
      onClose={onClose}
      crumb="Compras / Item × Fornecedor"
      crumbActive="Nova"
      title="Nova relação item × fornecedor"
      footer={
        <>
          <span className="modal-fullscreen__foot-meta">{resumo}</span>
          <div className="modal-fullscreen__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              form="supplier-item-form"
              className="btn btn--accent"
              disabled={saving || !itemId || !supplierId}
            >
              {saving ? "Criando…" : "Criar relação"}
            </button>
          </div>
        </>
      }
    >
      <form id="supplier-item-form" onSubmit={handleSubmit}>
        {error && <p className="form-alert">{error}</p>}

        <FormSection title="Relação">
          <div className="field-grid-2">
            {/*
                Catálogo de matéria-prima passa de mil itens: rolar um
                `select` nativo até achar não é trabalho de gente, e a lista
                ainda vinha truncada. Mesmo componente que o Projeto usa
                para cliente.
            */}
            <div className="field">
              <label htmlFor="supplier-item-item">
                Item <span className="req">*</span>
              </label>
              <SearchableEntitySelect
                id="supplier-item-item"
                value={itemId}
                onChange={setItemId}
                required
                placeholder="Digite código ou nome do item…"
                options={purchasableItems.map((item) => ({
                  id: item.id,
                  code: item.code,
                  name: item.name,
                  hint: item.unitCode,
                }))}
                canCreate
                createLabel="Novo item de estoque"
                onCreateNew={() => setItemModalAberto(true)}
              />
            </div>

            <div className="field">
              <label htmlFor="supplier-item-supplier">
                Fornecedor <span className="req">*</span>
              </label>
              <SearchableEntitySelect
                id="supplier-item-supplier"
                value={supplierId}
                onChange={setSupplierId}
                required
                placeholder="Digite código ou nome do fornecedor…"
                options={fornecedoresDisponiveis.map((supplier) => ({
                  id: supplier.id,
                  code: supplier.code,
                  name: supplier.legalName,
                  ...(supplier.tradeName ? { hint: supplier.tradeName } : {}),
                  searchTerms: [supplier.tradeName ?? "", supplier.cnpj ?? ""]
                    .filter(Boolean)
                    .join(" "),
                }))}
                canCreate
                createLabel="Novo fornecedor"
                onCreateNew={() => setFornecedorModalAberto(true)}
              />
            </div>

            <div className="field">
              <label htmlFor="supplier-item-code">Código do item no fornecedor</label>
              <input
                id="supplier-item-code"
                type="text"
                value={supplierItemCode}
                onChange={(event) => setSupplierItemCode(event.target.value)}
                placeholder="Ex.: VC-ASC-001"
              />
              <span className="field__hint">
                Referência do catálogo do fornecedor — não é o código interno nem o legado.
              </span>
            </div>

            <div className="field">
              <label htmlFor="supplier-item-notes">Observações comerciais</label>
              <textarea
                id="supplier-item-notes"
                rows={3}
                value={commercialNotes}
                onChange={(event) => setCommercialNotes(event.target.value)}
              />
              <span className="field__hint">
                Condição negociada, contato, prazo — texto livre, lido depois por gente.
              </span>
            </div>
          </div>
        </FormSection>

        <FormSection
          title="Homologação (opcional)"
          subtitle="Homologação é por item, não pelo fornecedor inteiro. Pendente significa ausência de homologação — não é reprovação."
        >
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="supplier-item-qualification">Situação</label>
              <select
                id="supplier-item-qualification"
                value={qualificationStatus}
                onChange={(event) =>
                  setQualificationStatus(event.target.value as "PENDING" | "APPROVED" | "BLOCKED")
                }
              >
                <option value="PENDING">Pendente</option>
                <option value="APPROVED">Homologado</option>
                <option value="BLOCKED">Bloqueado</option>
              </select>
              <span className="field__hint">
                Fica registrado como decisão de quem cadastrou, com data e autoria.
              </span>
            </div>

            <div className="field">
              <label htmlFor="supplier-item-qualification-note">Observação da decisão</label>
              <input
                id="supplier-item-qualification-note"
                type="text"
                value={qualificationNote}
                onChange={(event) => setQualificationNote(event.target.value)}
                placeholder="Ex.: auditoria de 2026, CoA aprovado"
              />
            </div>

            <div className="field field--checkbox">
              <label htmlFor="supplier-item-preferred">
                <input
                  id="supplier-item-preferred"
                  type="checkbox"
                  checked={preferred}
                  disabled={!podeSerPreferencial}
                  onChange={(event) => setPreferred(event.target.checked)}
                />
                Fornecedor preferencial deste item
              </label>
              <span className="field__hint">
                {podeSerPreferencial
                  ? "Um por item. Se já houver outro preferencial, ele deixa de ser."
                  : "Só um fornecedor homologado pode ser preferencial."}
              </span>
            </div>
          </div>
        </FormSection>

        <FormSection
          title="Primeira oferta (opcional)"
          subtitle="Opcional. Preço aqui é referência comercial do fornecedor — o custo real continua vindo do recebimento. Uma vez registrada, a oferta é imutável: mudou preço, registra-se outra."
        >
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="supplier-item-price">Preço</label>
              <input
                id="supplier-item-price"
                type="text"
                inputMode="decimal"
                value={unitPrice}
                onChange={(event) => setUnitPrice(event.target.value)}
                placeholder="Deixe vazio para criar sem oferta"
              />
              <span className="field__hint">
                O preço libera os demais campos da oferta. Sem ele, a relação nasce sem oferta
                cadastrada.
              </span>
            </div>

            <div className="field">
              <label htmlFor="supplier-item-price-uom">Unidade do preço</label>
              <select
                id="supplier-item-price-uom"
                value={priceUomCode}
                onChange={(event) => setPriceUomCode(event.target.value)}
                disabled={!preencheuOferta}
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
              <label htmlFor="supplier-item-moq">Pedido mínimo</label>
              <input
                id="supplier-item-moq"
                type="text"
                inputMode="decimal"
                value={minimumOrderQuantity}
                onChange={(event) => setMinimumOrderQuantity(event.target.value)}
                disabled={!preencheuOferta}
              />
            </div>

            <div className="field">
              <label htmlFor="supplier-item-moq-uom">Unidade do pedido mínimo</label>
              <select
                id="supplier-item-moq-uom"
                value={minimumOrderUomCode}
                onChange={(event) => setMinimumOrderUomCode(event.target.value)}
                disabled={!preencheuOferta || !minimumOrderQuantity.trim()}
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
              <label htmlFor="supplier-item-effective">Vigência a partir de</label>
              <input
                id="supplier-item-effective"
                type="date"
                value={effectiveAt}
                onChange={(event) => setEffectiveAt(event.target.value)}
                disabled={!preencheuOferta}
              />
              <span className="field__hint">Vazio = vale a partir de agora.</span>
            </div>

            <div className="field">
              <label htmlFor="supplier-item-valid-until">Validade</label>
              <input
                id="supplier-item-valid-until"
                type="date"
                value={validUntil}
                onChange={(event) => setValidUntil(event.target.value)}
                disabled={!preencheuOferta}
              />
            </div>

            <div className="field">
              <label htmlFor="supplier-item-offer-notes">Observação da oferta</label>
              <input
                id="supplier-item-offer-notes"
                type="text"
                value={offerNotes}
                onChange={(event) => setOfferNotes(event.target.value)}
                disabled={!preencheuOferta}
              />
            </div>
          </div>
        </FormSection>
      </form>

      {itemModalAberto && (
        <ItemFormModal
          mode="create"
          item={null}
          units={units}
          onClose={() => setItemModalAberto(false)}
          onSaved={(created) => {
            setItemModalAberto(false);
            if (!created) return;
            setItensNovos((prev) => [created, ...prev.filter((row) => row.id !== created.id)]);
            setItemId(created.id);
          }}
        />
      )}

      {fornecedorModalAberto && (
        <SupplierFormModal
          mode="create"
          supplier={null}
          onClose={() => setFornecedorModalAberto(false)}
          onSaved={(created) => {
            setFornecedorModalAberto(false);
            if (!created) return;
            setFornecedoresNovos((prev) => [created, ...prev.filter((row) => row.id !== created.id)]);
            setSupplierId(created.id);
          }}
        />
      )}
    </FullWorkspaceModal>
  );
}
