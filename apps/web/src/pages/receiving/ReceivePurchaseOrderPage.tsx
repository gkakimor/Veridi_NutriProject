import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Decimal, type PurchaseOrderDTO } from "@veridi/shared";
import { getPurchaseOrder, listPurchaseOrders } from "../../lib/purchase-orders-api";
import { getItem } from "../../lib/items-api";
import { createReceipt } from "../../lib/receiving-api";
import { diaDoRecebimentoPadrao, instanteDoRecebimento } from "../../lib/receipt-instant";
import { ApiValidationError, apiErrorMessage } from "../../lib/api-errors";
import { mensagemDecimalInvalido } from "../../lib/decimal-input";
import { resolverQuantidadeContraLimite } from "../../lib/quantity-limit";
import { exigirDecimalOpcional } from "../../lib/decimal-field";
import { formatUnitPriceBRL } from "../../lib/currency";
import { FormSection } from "../../components/FormSection";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";
import { formatQuantity } from "../../lib/quantity";

/** ⓘ de um campo, lido do registro central — o texto nunca mora no JSX. */
function DicaDoCampo({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

interface LineDraft {
  purchaseOrderLineId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  orderedQuantity: string;
  receivedQuantity: string;
  openQuantity: string;
  controlsLot: boolean;
  controlsExpiry: boolean;
  receiveNow: string;
  supplierLot: string;
  expiryDate: string;
  location: string;
  /** Preço previsto da OC — só referência visual, nunca custo real. */
  purchaseUnitPrice: string | null;
  /** Custo efetivo de aquisição — sempre opcional. */
  actualUnitCost: string;
}

/**
 * O veredito da tela sobre uma quantidade digitada.
 *
 * `vazio` não é erro: campo em branco é a linha que a pessoa não vai receber
 * agora. `ok` carrega o valor que DEVE ir no payload — nunca o texto digitado.
 */
type QuantidadeRecebida =
  | { estado: "vazio" }
  | { estado: "erro"; mensagem: string }
  | { estado: "ok"; valorCanonico: string };

/**
 * A única validação de quantidade desta tela — onChange, botão e envio leem
 * daqui.
 *
 * A tela já escreve "Aberto: 50 kg" logo acima do campo e mesmo assim aceitava
 * 80 em silêncio: a pessoa preenchia lote, validade e custo, passava pelo
 * diálogo de irreversibilidade e só então era recusada pelo servidor (F-06-1).
 * O saldo estava na tela o tempo todo. O que faltava era dizê-lo antes.
 *
 * Isto NÃO reescreve a regra do servidor, que continua sendo a autoridade:
 * `receiving.service.ts` recalcula o saldo dentro da transação, contra os
 * recebimentos confirmados naquele instante, e recusa igual. Aqui a tela
 * antecipa só o que ela já sabe com certeza, e o saldo pode ter mudado desde
 * que a página abriu — por isso a recusa do servidor continua tratada.
 *
 * O teto vem por `resolverQuantidadeContraLimite`: o saldo tem doze casas e a
 * tela mostra seis, então digitar o número exibido significa "receber tudo o
 * que está em aberto" e o que vai ao servidor é o saldo canônico. Sem isso,
 * o único valor impossível de digitar seria justamente o que está escrito na
 * frente do operador.
 */
function validarQuantidadeRecebida(
  digitado: string,
  saldoAberto: string,
  unitCode: string,
): QuantidadeRecebida {
  const resolvido = resolverQuantidadeContraLimite(digitado, saldoAberto);

  if (resolvido.status === "vazio") return { estado: "vazio" };
  if (resolvido.status === "ilegivel") {
    return { estado: "erro", mensagem: mensagemDecimalInvalido("Receber agora") };
  }
  if (resolvido.status === "acima") {
    return {
      estado: "erro",
      mensagem: `Máximo ${formatQuantity(saldoAberto)} ${unitCode} — é o saldo em aberto desta linha.`,
    };
  }
  // Zero e negativo: o servidor recusa os dois, por caminhos diferentes —
  // negativo nem chega a ser um decimal para a fronteira, e cai em "ilegível"
  // acima. Zero chega, e é recusado por `receivedQuantity <= 0`.
  if (new Decimal(resolvido.valorCanonico).lessThanOrEqualTo(0)) {
    return {
      estado: "erro",
      mensagem:
        "Quantidade recebida deve ser maior que zero — deixe o campo em branco para não receber esta linha.",
    };
  }
  return { estado: "ok", valorCanonico: resolvido.valorCanonico };
}

/** Chave de erro de campo por LINHA, nunca por posição no array. */
function chaveDeErro(purchaseOrderLineId: string, campo: string): string {
  return `${purchaseOrderLineId}.${campo}`;
}

/**
 * Fluxo de recebimento — pagina propria (nao FullWorkspaceModal), acessivel
 * de Compras → Recebimentos → "Receber OC" (sem OC pre-selecionada) ou do
 * detalhe da OC via "Receber materiais" (`?purchaseOrderId=`).
 */
export function ReceivePurchaseOrderPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedId = searchParams.get("purchaseOrderId");

  const [pickerOptions, setPickerOptions] = useState<PurchaseOrderDTO[]>([]);
  const [pickerLoading, setPickerLoading] = useState(!preselectedId);

  const [po, setPo] = useState<PurchaseOrderDTO | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [loadingPo, setLoadingPo] = useState(!!preselectedId);

  const [receivedAt, setReceivedAt] = useState(() => diaDoRecebimentoPadrao());
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [documentReference, setDocumentReference] = useState("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** Quantas edições de linha já houve — para descartar resposta atrasada. */
  const edicoes = useRef(0);

  const loadPurchaseOrder = useCallback(async (id: string) => {
    setLoadingPo(true);
    setError(null);
    try {
      const fetched = await getPurchaseOrder(id);
      setPo(fetched);

      const openLines = fetched.lines.filter((line) => Number(line.openQuantity) > 0);
      const items = await Promise.all(openLines.map((line) => getItem(line.itemId)));

      setLines(
        openLines.map((line, index) => ({
          purchaseOrderLineId: line.id,
          itemCode: line.itemCode,
          itemName: line.itemName,
          unitCode: line.unitCode,
          orderedQuantity: line.orderedQuantity,
          receivedQuantity: line.receivedQuantity,
          openQuantity: line.openQuantity,
          controlsLot: items[index]?.controlsLot ?? true,
          controlsExpiry: items[index]?.controlsExpiry ?? true,
          receiveNow: "",
          supplierLot: "",
          expiryDate: "",
          location: "",
          purchaseUnitPrice: line.unitPrice,
          // NUNCA pré-preenchido com o preço da OC — custo real exige
          // decisão explícita do usuário.
          actualUnitCost: "",
        })),
      );
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao carregar ordem de compra"));
    } finally {
      setLoadingPo(false);
    }
  }, []);

  useEffect(() => {
    if (preselectedId) {
      void loadPurchaseOrder(preselectedId);
      return;
    }

    setPickerLoading(true);
    Promise.all([
      listPurchaseOrders({ status: "ORDERED", pageSize: 100 }),
      listPurchaseOrders({ status: "PARTIALLY_RECEIVED", pageSize: 100 }),
    ])
      .then(([ordered, partial]) => setPickerOptions([...ordered.purchaseOrders, ...partial.purchaseOrders]))
      .catch(() => setPickerOptions([]))
      .finally(() => setPickerLoading(false));
  }, [preselectedId, loadPurchaseOrder]);

  function handleLineChange(id: string, field: keyof LineDraft, value: string) {
    setLines((prev) =>
      prev.map((line) => (line.purchaseOrderLineId === id ? { ...line, [field]: value } : line)),
    );

    /*
     * Editar é responder ao que a tela reclamou. A recusa do servidor descreve
     * um envio que já não é o que está na tela — deixá-la ali até a próxima
     * submissão fazia a pessoa corrigir o valor e continuar lendo o alerta
     * antigo, sem saber se tinha resolvido (F-06-2).
     *
     * A faixa some porque ela é uma só e fala do envio inteiro. O erro de
     * campo some SÓ no campo alterado — o problema das outras linhas continua
     * legítimo e continua na tela.
     */
    edicoes.current += 1;
    setError(null);
    setFieldErrors((prev) => {
      const chave = chaveDeErro(id, field);
      if (!(chave in prev)) return prev;
      const proximo = { ...prev };
      delete proximo[chave];
      return proximo;
    });
  }

  /*
   * O veredito por linha, derivado — nunca guardado em estado. Erro que mora
   * em estado é erro que sobrevive à correção; foi assim que o alerta de
   * excesso ficou na tela depois de a quantidade ser corrigida.
   */
  const validacoes = new Map(
    lines.map((line) => [
      line.purchaseOrderLineId,
      validarQuantidadeRecebida(line.receiveNow, line.openQuantity, line.unitCode),
    ]),
  );
  /** Linha com algo digitado — entra na conta do rodapé, válida ou não. */
  const linhasPreenchidas = lines.filter(
    (line) => validacoes.get(line.purchaseOrderLineId)?.estado !== "vazio",
  );
  /** O que de fato vai no payload. */
  const linesToSubmit = lines.filter(
    (line) => validacoes.get(line.purchaseOrderLineId)?.estado === "ok",
  );
  const temLinhaInvalida = linhasPreenchidas.length !== linesToSubmit.length;

  async function handleConfirmReceipt() {
    if (!po) return;
    setConfirmOpen(false);
    setSaving(true);
    setError(null);
    setFieldErrors({});

    // As linhas que este envio leva, congeladas: é contra ELAS que os índices
    // das issues do servidor são lidos depois.
    const enviadas = linesToSubmit;
    const geracao = edicoes.current;

    try {
      // Montado dentro do funil: um custo ilegível interrompe aqui, nomeando o
      // item, e o recebimento não é criado. A quantidade já chega resolvida
      // pela mesma validação que a tela mostrou.
      const payload = {
        receivedAt: instanteDoRecebimento(receivedAt),
        ...(invoiceNumber.trim() ? { invoiceNumber: invoiceNumber.trim() } : {}),
        ...(documentReference.trim() ? { documentReference: documentReference.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        lines: enviadas.map((line) => {
          const custo = exigirDecimalOpcional(
            line.actualUnitCost,
            `Custo efetivo de aquisição de ${line.itemCode}`,
          );
          const quantidade = validacoes.get(line.purchaseOrderLineId);
          if (quantidade?.estado !== "ok") {
            throw new Error(`Receber agora de ${line.itemCode}: corrija a quantidade.`);
          }
          return {
            purchaseOrderLineId: line.purchaseOrderLineId,
            receivedQuantity: quantidade.valorCanonico,
            ...(line.supplierLot.trim() ? { supplierLot: line.supplierLot.trim() } : {}),
            ...(line.expiryDate ? { expiryDate: new Date(line.expiryDate).toISOString() } : {}),
            ...(line.location.trim() ? { location: line.location.trim() } : {}),
            ...(custo ? { actualUnitCost: custo } : {}),
          };
        }),
      };

      const receipt = await createReceipt(po.id, payload);
      navigate(`/compras/recebimentos/${receipt.id}`, { replace: true });
    } catch (err) {
      /*
       * Resposta que chega depois de a pessoa já ter mexido no formulário fala
       * de um estado que não existe mais. Reinstalar o erro por cima do valor
       * novo é contar a história errada — a mesma que F-06-2 descreve, só que
       * pela porta dos fundos.
       */
      if (edicoes.current !== geracao) return;
      if (err instanceof ApiValidationError) {
        const nextFieldErrors: Record<string, string> = {};
        for (const issue of err.issues) {
          // `lines.0.receivedQuantity` indexa o PAYLOAD, não a lista da tela:
          // com uma linha em branco antes, o erro pousava na linha errada.
          const emLinha = /^lines\.(\d+)\.(.+)$/.exec(issue.path);
          const linha = emLinha ? enviadas[Number(emLinha[1])] : undefined;
          nextFieldErrors[
            linha ? chaveDeErro(linha.purchaseOrderLineId, emLinha![2]!) : issue.path
          ] = issue.message;
        }
        setFieldErrors(nextFieldErrors);
        setError("Corrija os campos destacados.");
      } else {
        setError(apiErrorMessage(err, "Falha ao confirmar recebimento"));
      }
    } finally {
      setSaving(false);
    }
  }

  if (!preselectedId && !po) {
    return (
      <>
        <div className="doc-header">
          <div>
            <PageBreadcrumbs
              items={[
                { label: "Recebimentos", href: "/compras/recebimentos" },
                { label: "Receber OC" },
              ]}
            />
            <div className="doc-title">
              <h1>Receber OC</h1>
            </div>
          </div>
        </div>

        <div className="doc-body">
          <ContextHelp topic={helpTopics["compras.recebimentos"]} />

          <FormSection
            title="Selecionar ordem de compra"
            subtitle="Somente OCs confirmadas com quantidade em aberto podem receber materiais."
          >
            {pickerLoading ? (
              <p className="muted">Carregando…</p>
            ) : pickerOptions.length === 0 ? (
              <p className="muted">Nenhuma OC confirmada com saldo em aberto no momento.</p>
            ) : (
              <div className="field">
                <label htmlFor="receiving-po-picker">Ordem de compra</label>
                <select
                  id="receiving-po-picker"
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value) void loadPurchaseOrder(event.target.value);
                  }}
                >
                  <option value="" disabled>
                    Selecione…
                  </option>
                  {pickerOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.code} — {option.supplierName}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </FormSection>
        </div>
      </>
    );
  }

  if (loadingPo || !po) {
    return (
      <div className="doc-header">
        <div>
          <h1 className="page__title">Receber OC</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="doc-header">
        <div>
          <PageBreadcrumbs
            items={[
              { label: "Recebimentos", href: "/compras/recebimentos" },
              { label: "Receber OC" },
            ]}
          />
          <div className="doc-title">
            <h1>{po.code}</h1>
            <span className="field-readonly-value">{po.supplierName}</span>
          </div>
        </div>
      </div>

      <div className="doc-body">
        {error && <p className="form-alert" role="alert">{error}</p>}

        {/* Confirmar aqui é irreversível: cria lote e entrada de estoque, e
            não existe edição depois. Vale dizer isso antes, não no erro. */}
        <ContextHelp topic={helpTopics["compras.recebimentos"]} />

        <FormSection title="Dados do recebimento">
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="receipt-date">
                Data do recebimento <span className="req">*</span>
              </label>
              <input
                id="receipt-date"
                type="date"
                value={receivedAt}
                onChange={(event) => setReceivedAt(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="receipt-invoice">Nota fiscal</label>
              <input
                id="receipt-invoice"
                type="text"
                placeholder="Ex.: NF 12345"
                value={invoiceNumber}
                onChange={(event) => setInvoiceNumber(event.target.value)}
              />
            </div>
            <div className="field field--full">
              <label htmlFor="receipt-document">Referência de documento</label>
              <input
                id="receipt-document"
                type="text"
                value={documentReference}
                onChange={(event) => setDocumentReference(event.target.value)}
              />
            </div>
          </div>
        </FormSection>

        {lines.length === 0 ? (
          <FormSection title="Itens">
            <p className="muted">Esta OC não possui mais quantidade em aberto para receber.</p>
          </FormSection>
        ) : (
          lines.map((line) => {
            const validacao = validacoes.get(line.purchaseOrderLineId) ?? { estado: "vazio" as const };
            /* O erro local vem primeiro: ele descreve o que está na tela AGORA;
               o do servidor descreve o envio anterior. */
            const erroDaQuantidade =
              validacao.estado === "erro"
                ? validacao.mensagem
                : fieldErrors[chaveDeErro(line.purchaseOrderLineId, "receivedQuantity")];
            return (
            <FormSection
              key={line.purchaseOrderLineId}
              title={`${line.itemCode} — ${line.itemName}`}
              subtitle={`Pedido: ${formatQuantity(line.orderedQuantity)} ${line.unitCode}  ·  Recebido: ${formatQuantity(line.receivedQuantity)} ${line.unitCode}  ·  Aberto: ${formatQuantity(line.openQuantity)} ${line.unitCode}`}
            >
              <div className="field-grid-2">
                <div className="field">
                  <label htmlFor={`receive-now-${line.purchaseOrderLineId}`}>
                    Receber agora ({line.unitCode})
                  </label>
                  <input
                    id={`receive-now-${line.purchaseOrderLineId}`}
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={line.receiveNow}
                    onChange={(event) =>
                      handleLineChange(line.purchaseOrderLineId, "receiveNow", event.target.value)
                    }
                    /* Liga campo, `aria-invalid` e a mensagem, para leitor de tela também. */
                    {...(erroDaQuantidade
                      ? {
                          "aria-invalid": true as const,
                          "aria-describedby": `receive-now-${line.purchaseOrderLineId}-error`,
                        }
                      : {})}
                  />
                  {erroDaQuantidade && (
                    <p
                      className="field__error"
                      id={`receive-now-${line.purchaseOrderLineId}-error`}
                    >
                      {erroDaQuantidade}
                    </p>
                  )}
                </div>

                {line.controlsLot && (
                  <div className="field">
                    <label htmlFor={`supplier-lot-${line.purchaseOrderLineId}`}>
                      Lote do fornecedor <span className="req">*</span>
                      <DicaDoCampo id="estoque.loteFornecedor" />
                    </label>
                    <input
                      id={`supplier-lot-${line.purchaseOrderLineId}`}
                      type="text"
                      placeholder="Ex.: ABC-98765"
                      value={line.supplierLot}
                      onChange={(event) =>
                        handleLineChange(line.purchaseOrderLineId, "supplierLot", event.target.value)
                      }
                    />
                  </div>
                )}

                {line.controlsExpiry && (
                  <div className="field">
                    <label htmlFor={`expiry-${line.purchaseOrderLineId}`}>
                      Validade <span className="req">*</span>
                    </label>
                    <input
                      id={`expiry-${line.purchaseOrderLineId}`}
                      type="date"
                      value={line.expiryDate}
                      onChange={(event) =>
                        handleLineChange(line.purchaseOrderLineId, "expiryDate", event.target.value)
                      }
                    />
                  </div>
                )}

                <div className="field">
                  <label htmlFor={`cost-${line.purchaseOrderLineId}`}>
                    Custo efetivo de aquisição ({line.unitCode})
                    <DicaDoCampo id="compras.custoEfetivo" />
                  </label>
                  <input
                    id={`cost-${line.purchaseOrderLineId}`}
                    type="text"
                    inputMode="decimal"
                    placeholder="Opcional"
                    value={line.actualUnitCost}
                    onChange={(event) =>
                      handleLineChange(line.purchaseOrderLineId, "actualUnitCost", event.target.value)
                    }
                  />
                  <p className="field__hint">
                    {line.purchaseUnitPrice
                      ? `Preço previsto da OC: ${formatUnitPriceBRL(line.purchaseUnitPrice)} / ${line.unitCode}. `
                      : ""}
                    Opcional — o recebimento não depende do custo. Informe apenas o custo realmente
                    praticado; o preço da OC nunca é assumido como custo real.
                  </p>
                  {line.purchaseUnitPrice && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() =>
                        handleLineChange(
                          line.purchaseOrderLineId,
                          "actualUnitCost",
                          line.purchaseUnitPrice!,
                        )
                      }
                    >
                      Usar preço da OC
                    </button>
                  )}
                </div>

                {line.controlsLot && (
                  <div className="field">
                    <label htmlFor={`location-${line.purchaseOrderLineId}`}>Localização</label>
                    <input
                      id={`location-${line.purchaseOrderLineId}`}
                      type="text"
                      placeholder="Ex.: MP / Estante B / Posição 03"
                      value={line.location}
                      onChange={(event) =>
                        handleLineChange(line.purchaseOrderLineId, "location", event.target.value)
                      }
                    />
                  </div>
                )}
              </div>
            </FormSection>
            );
          })
        )}

        <FormSection title="Observações">
          <div className="field">
            <label htmlFor="receipt-notes">Notas internas</label>
            <textarea id="receipt-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
        </FormSection>
      </div>

      <div className="doc-actions">
        <span className="modal-fullscreen__foot-meta">
          {temLinhaInvalida
            ? "Corrija as quantidades destacadas."
            : linesToSubmit.length === 0
              ? "Informe a quantidade recebida em ao menos uma linha."
              : `${linesToSubmit.length} ${linesToSubmit.length === 1 ? "linha será recebida" : "linhas serão recebidas"}.`}
        </span>
        <div className="doc-actions__primary">
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/compras/recebimentos")}>
            Cancelar
          </button>
          {/* Bloqueia pelo que está na tela agora — nunca por erro já corrigido,
              porque o veredito é derivado e não sobrevive à edição. */}
          <button
            type="button"
            className="btn btn--accent"
            disabled={saving || temLinhaInvalida || linesToSubmit.length === 0}
            onClick={() => setConfirmOpen(true)}
          >
            {saving ? "Confirmando…" : "Confirmar recebimento"}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Confirmar recebimento?"
        message="O recebimento será registrado no histórico e lotes internos serão criados para os itens que controlam lote. A operação não poderá ser simplesmente apagada depois."
        confirmLabel="Confirmar"
        confirmTone="accent"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmReceipt}
      />
    </>
  );
}
