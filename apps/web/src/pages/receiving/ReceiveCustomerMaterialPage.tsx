import { useEffect, useState } from "react";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { useNavigate } from "react-router-dom";
import type { CustomerDTO, ItemDTO } from "@veridi/shared";
import { listCustomers } from "../../lib/customers-api";
import { listItems } from "../../lib/items-api";
import { createCustomerSuppliedReceipt } from "../../lib/receiving-api";
import { ApiValidationError, apiErrorMessage } from "../../lib/api-errors";
import { exigirDecimal } from "../../lib/decimal-field";
import { FormSection } from "../../components/FormSection";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { useContextualCreateOrigin } from "../../lib/use-contextual-create";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

/** ⓘ de um campo, lido do registro central — o texto nunca mora no JSX. */
function DicaDoCampo({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

interface LineDraft {
  key: string;
  itemId: string;
  receivedQuantity: string;
  supplierLot: string;
  expiryDate: string;
  location: string;
}

let lineKeySeq = 0;
function nextLineKey(): string {
  lineKeySeq += 1;
  return `linha-${lineKeySeq}`;
}

/**
 * O contador reinicia junto com o módulo, e o rascunho atravessa um F5 na
 * tela de cadastro: sem empurrá-lo para além das chaves restauradas,
 * "Adicionar material" devolveria uma chave que uma linha já usa — duas
 * linhas mudariam juntas.
 */
function absorverChaves(linhas: LineDraft[]) {
  for (const linha of linhas) {
    const numero = Number(linha.key.split("-")[1]);
    if (Number.isFinite(numero) && numero > lineKeySeq) lineKeySeq = numero;
  }
}

/**
 * O que o recebimento leva junto ao sair para cadastrar o cliente.
 *
 * Só o formulário: `customers` e `items` vêm do servidor e são recarregados
 * na volta, então guardá-los seria copiar catálogo para dentro do rascunho.
 */
type RascunhoRecebimento = {
  customerId: string;
  receivedAt: string;
  documentReference: string;
  invoiceNumber: string;
  notes: string;
  lines: LineDraft[];
};

function emptyLine(): LineDraft {
  return {
    key: nextLineKey(),
    itemId: "",
    receivedQuantity: "",
    supplierLot: "",
    expiryDate: "",
    location: "",
  };
}

/**
 * Recebimento de material ENVIADO PELO CLIENTE — sem Ordem de Compra e sem
 * fornecedor. O lote nasce com o cliente como proprietário: entra no mesmo
 * estoque físico, mas só pode ser usado em OPs desse cliente.
 */
export function ReceiveCustomerMaterialPage() {
  const navigate = useNavigate();

  const [customers, setCustomers] = useState<CustomerDTO[]>([]);
  const [items, setItems] = useState<ItemDTO[]>([]);

  const [customerId, setCustomerId] = useState("");
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [documentReference, setDocumentReference] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  /**
   * Cadastro de cliente na TELA OFICIAL, sem perder o recebimento.
   *
   * Material do cliente chega na doca com o documento na mão; se o cliente
   * ainda não existe, sair daqui significaria redigitar lotes, validades e
   * quantidades já conferidos. O rascunho vai junto e volta inteiro, com o
   * cliente novo selecionado pelo id.
   */
  const origem = useContextualCreateOrigin<RascunhoRecebimento>({
    collectDraft: () => ({
      customerId,
      receivedAt,
      documentReference,
      invoiceNumber,
      notes,
      lines,
    }),
    restoreDraft: (draft) => {
      setCustomerId(draft.customerId ?? "");
      setReceivedAt(draft.receivedAt ?? "");
      setDocumentReference(draft.documentReference ?? "");
      setInvoiceNumber(draft.invoiceNumber ?? "");
      setNotes(draft.notes ?? "");
      // Rascunho sem linha volta com a linha vazia com que a tela nasce:
      // tabela sem linha nenhuma não dá onde digitar.
      const linhas = Array.isArray(draft.lines) ? draft.lines : [];
      absorverChaves(linhas);
      setLines(linhas.length > 0 ? linhas : [emptyLine()]);
    },
    // Pelo id: o nome digitado na busca escolheria o cliente errado.
    onCreated: (result) => setCustomerId(result.entityId),
  });

  useEffect(() => {
    listCustomers({ active: true, pageSize: 1000 })
      .then((result) => setCustomers(result.customers))
      .catch(() => setCustomers([]));

    // Material de cliente existe só para matéria-prima e embalagem.
    Promise.all([
      listItems({ type: "RAW_MATERIAL", active: true, pageSize: 1000 }),
      listItems({ type: "PACKAGING", active: true, pageSize: 1000 }),
    ])
      .then(([raw, packaging]) => setItems([...raw.items, ...packaging.items]))
      .catch(() => setItems([]));
  }, []);

  function updateLine(key: string, field: keyof Omit<LineDraft, "key">, value: string) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, [field]: value } : line)));
  }

  const selectedItem = (itemId: string): ItemDTO | undefined =>
    items.find((item) => item.id === itemId);

  async function handleConfirm() {
    setConfirmOpen(false);
    setSaving(true);
    setError(null);
    setFieldErrors({});

    try {
      const receipt = await createCustomerSuppliedReceipt({
        customerId,
        receivedAt: new Date(`${receivedAt}T12:00:00`).toISOString(),
        ...(invoiceNumber.trim() ? { invoiceNumber: invoiceNumber.trim() } : {}),
        ...(documentReference.trim() ? { documentReference: documentReference.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        lines: lines
          .filter((line) => line.itemId && line.receivedQuantity.trim())
          .map((line) => ({
            itemId: line.itemId,
            // Nomeia o item na recusa: a tabela tem várias linhas, e
            // "informe um valor numérico válido" sem dizer onde não ajuda.
            receivedQuantity: exigirDecimal(
              line.receivedQuantity,
              `Quantidade recebida de ${selectedItem(line.itemId)?.code ?? "item"}`,
            ),
            ...(line.supplierLot.trim() ? { supplierLot: line.supplierLot.trim() } : {}),
            ...(line.expiryDate
              ? { expiryDate: new Date(`${line.expiryDate}T12:00:00`).toISOString() }
              : {}),
            ...(line.location.trim() ? { location: line.location.trim() } : {}),
          })),
      });
      navigate(`/compras/recebimentos/${receipt.id}`);
    } catch (err) {
      if (err instanceof ApiValidationError) {
        const nextFieldErrors: Record<string, string> = {};
        for (const issue of err.issues) nextFieldErrors[issue.path] = issue.message;
        setFieldErrors(nextFieldErrors);
        setError("Corrija os campos destacados.");
      } else {
        setError(apiErrorMessage(err, "Falha ao registrar recebimento"));
      }
    } finally {
      setSaving(false);
    }
  }

  const canSubmit =
    customerId !== "" && lines.some((line) => line.itemId && line.receivedQuantity.trim());

  return (
    <>
      <div className="doc-header">
        <div>
          <PageBreadcrumbs
            items={[
              { label: "Recebimentos", href: "/compras/recebimentos" },
              { label: "Material do cliente" },
            ]}
          />
          <div className="doc-title">
            <h1>Material enviado pelo cliente</h1>
          </div>
        </div>
      </div>

      <div className="doc-body">
        {error && <p className="form-alert" role="alert">{error}</p>}

        {/* Recebimento sem fornecedor e sem OC parece cadastro incompleto
            para quem chegou pelo caminho da compra. É o contrário: é o único
            jeito de o material do cliente entrar sem virar estoque nosso. */}
        <ContextHelp topic={helpTopics["compras.recebimentos"]} />

        <FormSection
          title="Origem"
          subtitle="Sem Ordem de Compra e sem fornecedor: o material continua sendo do cliente, só está fisicamente aqui."
        >
          <div className="field field--narrow">
            <label htmlFor="customer-receipt-customer">
              Cliente proprietário <span className="req">*</span>
              <DicaDoCampo id="estoque.proprietario" />
            </label>
            <SearchableEntitySelect
              id="customer-receipt-customer"
              value={customerId}
              onChange={(selectedId) => setCustomerId(selectedId)}
              placeholder="Digite código ou nome do cliente…"
              options={customers.map((customer) => ({
                id: customer.id,
                code: customer.code,
                name: customer.legalName,
                ...(customer.tradeName ? { hint: customer.tradeName } : {}),
                searchTerms: [customer.tradeName ?? "", customer.cnpj ?? ""]
                  .filter(Boolean)
                  .join(" "),
              }))}
              canCreate
              createLabel="Novo cliente"
              onCreateNew={() =>
                origem.goCreate({
                  route: "/cadastros/clientes/novo",
                  fieldKey: "customerId",
                  entityType: "customer",
                })
              }
            />
            {fieldErrors["customerId"] && (
              <p className="field__error">{fieldErrors["customerId"]}</p>
            )}
          </div>

          <div className="field field--narrow">
            <label htmlFor="customer-receipt-date">
              Data do recebimento <span className="req">*</span>
            </label>
            <input
              id="customer-receipt-date"
              type="date"
              value={receivedAt}
              onChange={(event) => setReceivedAt(event.target.value)}
            />
          </div>

          <div className="field field--narrow">
            <label htmlFor="customer-receipt-document">Documento de remessa</label>
            <input
              id="customer-receipt-document"
              type="text"
              value={documentReference}
              onChange={(event) => setDocumentReference(event.target.value)}
            />
            <p className="field__hint">
              Nota fiscal não é obrigatória — material do cliente costuma chegar com outro documento.
            </p>
          </div>

          <div className="field field--narrow">
            <label htmlFor="customer-receipt-invoice">Nota fiscal (opcional)</label>
            <input
              id="customer-receipt-invoice"
              type="text"
              value={invoiceNumber}
              onChange={(event) => setInvoiceNumber(event.target.value)}
            />
          </div>
        </FormSection>

        <FormSection
          title="Materiais recebidos"
          subtitle="Material de cliente exige controle de lote — item sem controle de lote é recusado no recebimento."
        >
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="is-numeric">Quantidade</th>
                  <th>
                    Lote do fabricante
                    <DicaDoCampo id="estoque.loteFornecedor" />
                  </th>
                  <th>Validade</th>
                  <th>Localização</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const item = selectedItem(line.itemId);
                  return (
                    <tr key={line.key}>
                      <td>
                        <select
                          aria-label="Item recebido"
                          value={line.itemId}
                          onChange={(event) => updateLine(line.key, "itemId", event.target.value)}
                        >
                          <option value="">Selecione…</option>
                          {items.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.code} — {option.name}
                            </option>
                          ))}
                        </select>
                        {item && !item.controlsLot && (
                          <div className="field__error">
                            Item não controla lote — ative o controle de lote no cadastro antes de
                            receber material do cliente.
                          </div>
                        )}
                      </td>
                      <td className="is-numeric">
                        <input
                          type="text"
                          inputMode="decimal"
                          /* Nomeia a LINHA, nao a coluna: com o rotulo fixo,
                             todas as linhas tinham o mesmo nome acessivel e
                             quem navega por leitor de tela nao sabia em qual
                             estava. */
                          aria-label={
                            line.itemId
                              ? `Quantidade recebida de ${items.find((option) => option.id === line.itemId)?.code ?? "item"}`
                              : "Quantidade recebida"
                          }
                          placeholder="0"
                          value={line.receivedQuantity}
                          onChange={(event) =>
                            updateLine(line.key, "receivedQuantity", event.target.value)
                          }
                        />
                        {item ? <span className="field__hint"> {item.unitCode}</span> : null}
                      </td>
                      <td>
                        <input
                          type="text"
                          aria-label="Lote do fabricante"
                          value={line.supplierLot}
                          onChange={(event) =>
                            updateLine(line.key, "supplierLot", event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          aria-label="Validade"
                          value={line.expiryDate}
                          onChange={(event) =>
                            updateLine(line.key, "expiryDate", event.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          aria-label="Localização"
                          value={line.location}
                          onChange={(event) => updateLine(line.key, "location", event.target.value)}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          aria-label="Remover linha"
                          onClick={() =>
                            setLines((prev) =>
                              prev.length === 1
                                ? [emptyLine()]
                                : prev.filter((row) => row.key !== line.key),
                            )
                          }
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="line-actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => setLines((prev) => [...prev, emptyLine()])}
            >
              + Adicionar material
            </button>
          </div>
        </FormSection>

        <FormSection title="Observações">
          <div className="field">
            <label htmlFor="customer-receipt-notes">Observações</label>
            <textarea
              id="customer-receipt-notes"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </FormSection>
      </div>

      <div className="doc-actions">
        <div className="doc-actions__primary">
          <button
            type="button"
            className="btn btn--accent"
            disabled={saving || !canSubmit}
            onClick={() => setConfirmOpen(true)}
          >
            {saving ? "Registrando…" : "Confirmar recebimento"}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Confirmar recebimento de material do cliente?"
        message="Os lotes criados ficarão com o cliente como proprietário e só poderão ser usados em Ordens de Produção desse cliente. O recebimento confirmado é histórico e não pode ser editado."
        confirmLabel="Confirmar"
        confirmTone="accent"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
      />
    </>
  );
}
