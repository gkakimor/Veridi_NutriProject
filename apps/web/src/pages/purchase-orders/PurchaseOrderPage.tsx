import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useMemo, useState , useRef } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import type {
  ItemDTO,
  PurchaseOrderDTO,
  PurchaseOrderStatus,
  SupplierItemDTO,
} from "@veridi/shared";
import { PURCHASE_ORDER_STATUS_LABELS, SUPPLIER_ITEM_QUALIFICATION_LABELS } from "@veridi/shared";
import {
  cancelPurchaseOrder,
  confirmPurchaseOrder,
  createPurchaseOrder,
  getPurchaseOrder,
  updatePurchaseOrder,
} from "../../lib/purchase-orders-api";
import { listSuppliers } from "../../lib/suppliers-api";
import { listSupplierItems } from "../../lib/supplier-items-api";
import { getItem, listItems } from "../../lib/items-api";
import { useContextualCreateOrigin } from "../../lib/use-contextual-create";
import { formatBRL } from "../../lib/currency";
import { ApiValidationError, apiErrorMessage } from "../../lib/api-errors";
import { parseDecimalInput } from "../../lib/decimal-input";
import { exigirDecimal, exigirDecimalOpcional } from "../../lib/decimal-field";
import { EntityLink } from "../../components/EntityLink";
import { FormSection } from "../../components/FormSection";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { formatDate } from "../../lib/dates";
import { ModalDialog } from "../../components/ModalDialog";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

/** ⓘ de um campo, lido do registro central — o texto nunca mora no JSX. */
function DicaDoCampo({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

interface SupplierOption {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  active: boolean;
}

interface ItemOption {
  id: string;
  code: string;
  name: string;
  unitCode: string;
  active: boolean;
}

/**
 * Primeira página do catálogo — o que a lista mostra antes de digitar.
 *
 * Era 1000 por tipo, e o catálogo tem 1.211 matérias-primas ativas: 211
 * existiam e não apareciam na busca, sem aviso — e a linha oferece "+ Novo
 * item de estoque" no topo, então quem não achava cadastrava duplicata.
 * Quem digita agora pergunta ao servidor (`buscarItens`).
 */
const PRIMEIRA_PAGINA = 50;

/** Uma conversão só de item do catálogo para opção da tela. */
function itemOption(item: ItemDTO): ItemOption {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    unitCode: item.unitCode,
    active: item.active,
  };
}

/** Um formato só de rótulo: o da lista inicial e o da busca não podem divergir. */
function opcaoDoItem(item: ItemOption): EntityOption {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    ...(item.active ? {} : { hint: "inativo" }),
  };
}

/** Mescla sem duplicar e sem trocar a referência à toa. */
function mesclarItens(atual: ItemOption[], novos: ItemOption[]): ItemOption[] {
  const conhecidos = new Set(atual.map((item) => item.id));
  const ineditos = novos.filter((item) => !conhecidos.has(item.id));
  return ineditos.length === 0 ? atual : [...atual, ...ineditos];
}

interface LineRow {
  key: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  unitCode: string;
  orderedQuantity: string;
  unitPrice: string;
  receivedQuantity: string;
  openQuantity: string;
}

function statusBadgeClass(status: PurchaseOrderStatus): string {
  switch (status) {
    case "DRAFT":
      return "badge badge--neutral";
    case "ORDERED":
    case "RECEIVED":
      return "badge badge--active";
    case "PARTIALLY_RECEIVED":
      return "badge badge--warn";
    case "CANCELLED":
      return "badge badge--err";
  }
}

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

function toIsoOrEmpty(dateInputValue: string): string {
  if (!dateInputValue) return "";
  return new Date(dateInputValue).toISOString();
}

let rowKeySeq = 0;
function nextRowKey(): string {
  rowKeySeq += 1;
  return `row-${rowKeySeq}`;
}

/**
 * O contador reinicia junto com o módulo, e o rascunho atravessa um F5 na
 * tela de cadastro: sem empurrá-lo para além das chaves restauradas,
 * "Adicionar linha" devolveria uma chave que uma linha já usa — duas linhas
 * passariam a mudar juntas.
 */
function absorverChaves(linhas: LineRow[]) {
  for (const linha of linhas) {
    const numero = Number(linha.key.split("-")[1]);
    if (Number.isFinite(numero) && numero > rowKeySeq) rowKeySeq = numero;
  }
}

/**
 * O que a OC leva junto ao sair para cadastrar fornecedor ou item.
 *
 * Só o documento em edição. O que é derivado do servidor — a OC carregada,
 * os catálogos, as unidades, as relações item × fornecedor — é recarregado
 * na volta, e guardá-lo seria copiar o servidor para dentro do rascunho.
 */
type RascunhoOrdemCompra = {
  supplierId: string;
  orderDate: string;
  expectedDeliveryDate: string;
  notes: string;
  lines: LineRow[];
};

/**
 * A linha que pediu o cadastro.
 *
 * O contexto atravessa `sessionStorage` e o token viaja na URL: é dado
 * desconhecido. Sem chave legítima o item novo não entra em linha nenhuma —
 * melhor que entrar na primeira, que é a errada.
 */
function lerChaveDaLinha(contexto: Record<string, unknown> | null | undefined): string | null {
  const chave = contexto?.["rowKey"];
  return typeof chave === "string" && chave.length > 0 ? chave : null;
}

function lineFromDTO(line: PurchaseOrderDTO["lines"][number]): LineRow {
  return {
    key: nextRowKey(),
    itemId: line.itemId,
    itemCode: line.itemCode,
    itemName: line.itemName,
    unitCode: line.unitCode,
    orderedQuantity: line.orderedQuantity,
    unitPrice: line.unitPrice ?? "",
    receivedQuantity: line.receivedQuantity,
    openQuantity: line.openQuantity,
  };
}

/**
 * Documento transacional — pagina propria dentro do workspace, nao
 * FullWorkspaceModal. Padrao para futuros documentos (ex.: OP).
 * Atende `/compras/ordens/nova` (sem :id) e `/compras/ordens/:id`.
 */
export function PurchaseOrderPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = !id;

  const [purchaseOrder, setPurchaseOrder] = useState<PurchaseOrderDTO | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);

  const [supplierId, setSupplierId] = useState("");
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineRow[]>([]);

  /**
   * Falta de material manda o item e a quantidade que falta pela URL. Sem
   * isso o atalho "Ir para compras" deixava a pessoa reconstruir de memória o
   * que o sistema acabou de calcular. Só pré-preenche a linha — fornecedor,
   * preço e decisão de comprar continuam com quem usa.
   */
  const [searchParams] = useSearchParams();
  const shortageItemId = searchParams.get("itemId") ?? "";
  const shortageQuantity = searchParams.get("quantidade") ?? "";

  const [activeSuppliers, setActiveSuppliers] = useState<SupplierOption[]>([]);
  const [activeItems, setActiveItems] = useState<ItemOption[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const syncFormFromServer = useCallback((po: PurchaseOrderDTO) => {
    setSupplierId(po.supplierId);
    setOrderDate(toDateInputValue(po.orderDate));
    setExpectedDeliveryDate(toDateInputValue(po.expectedDeliveryDate));
    setNotes(po.notes ?? "");
    setLines(po.lines.map(lineFromDTO));
  }, []);

  /**
   * O rascunho restaurado ganha do servidor — uma vez.
   *
   * Quem volta do cadastro chega junto com a carga da OC, e ela traz o
   * documento como está salvo. Sem esta trava a resposta chegaria depois e
   * apagaria as linhas que a pessoa acabou de digitar. Vale só para a
   * primeira carga: depois de salvar, o servidor é a verdade.
   */
  const rascunhoRestaurado = useRef(false);

  useEffect(() => {
    if (isNew || !id) return;
    setLoading(true);
    setNotFound(false);
    getPurchaseOrder(id)
      .then((po) => {
        setPurchaseOrder(po);
        if (rascunhoRestaurado.current) {
          rascunhoRestaurado.current = false;
          return;
        }
        syncFormFromServer(po);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id, isNew, syncFormFromServer]);

  useEffect(() => {
    listSuppliers({ active: true, pageSize: 50 })
      .then((result) => setActiveSuppliers(result.suppliers))
      .catch(() => setActiveSuppliers([]));
    Promise.all([
      listItems({ type: "RAW_MATERIAL", active: true, pageSize: PRIMEIRA_PAGINA }),
      listItems({ type: "PACKAGING", active: true, pageSize: PRIMEIRA_PAGINA }),
    ])
      .then(([raw, packaging]) =>
        setActiveItems([...raw.items, ...packaging.items].map(itemOption)),
      )
      .catch(() => setActiveItems([]));
  }, []);

  /*
   * Busca no SERVIDOR, com os MESMOS filtros da carga inicial: achar nao e o
   * mesmo que poder usar, e a busca torna encontravel quem ja era elegivel,
   * nunca quem nao era. O achado entra no estado de onde as opcoes derivam,
   * porque a escolha e resolvida por ele. A carga inicial passou a servir so
   * a abertura do campo — acima do teto o registro existia e nao aparecia,
   * com "+ Novo" logo acima convidando a duplicar.
   */
  async function buscarFornecedores(termo: string): Promise<EntityOption[]> {
    const resultado = await listSuppliers({ active: true, search: termo, pageSize: 50 });
    const novos = resultado.suppliers;
    setActiveSuppliers((atual) => {
      const conhecidos = new Set(atual.map((x) => x.id));
      return [...atual, ...novos.filter((x) => !conhecidos.has(x.id))];
    });
    return novos.map((f) => ({ id: f.id, code: f.code, name: f.tradeName ?? f.legalName }));
  }

  /**
   * Busca no servidor, com os MESMOS filtros de negócio da carga inicial:
   * só matéria-prima e embalagem, só ativos, e fora o que outra linha já
   * pede — as duas primeiras no servidor, a terceira aqui, exatamente como
   * `optionsForRow` já faz com a primeira página. Comprar continua sendo
   * possível só para quem já era comprável.
   */
  async function buscarItens(row: LineRow, termo: string): Promise<EntityOption[]> {
    const [raw, packaging] = await Promise.all([
      listItems({ type: "RAW_MATERIAL", active: true, search: termo, pageSize: PRIMEIRA_PAGINA }),
      listItems({ type: "PACKAGING", active: true, search: termo, pageSize: PRIMEIRA_PAGINA }),
    ]);
    const encontrados = [...raw.items, ...packaging.items].map(itemOption);
    // O achado entra no catálogo da tela: `handleLineItemChange` lê código,
    // nome e unidade de `activeItems`. Sem a mesclagem, escolher um item de
    // fora da primeira página deixaria a linha sem unidade.
    setActiveItems((atual) => mesclarItens(atual, encontrados));
    const usadosPorOutrasLinhas = new Set(
      lines.filter((l) => l.key !== row.key).map((l) => l.itemId),
    );
    return encontrados.filter((item) => !usadosPorOutrasLinhas.has(item.id)).map(opcaoDoItem);
  }

  const status: PurchaseOrderStatus = purchaseOrder?.status ?? "DRAFT";
  const isDraftEditable = isNew || status === "DRAFT";

  // Relacoes item x fornecedor do fornecedor escolhido — apoio visual na
  // DRAFT. A OC continua livre: homologacao orienta, nunca bloqueia compra
  // (emergencia, amostra, fornecedor novo).
  const [supplierItemsByItem, setSupplierItemsByItem] = useState<Record<string, SupplierItemDTO>>(
    {},
  );

  useEffect(() => {
    if (!supplierId) {
      setSupplierItemsByItem({});
      return;
    }
    listSupplierItems({ supplierId, pageSize: 100 })
      .then((result) =>
        setSupplierItemsByItem(
          Object.fromEntries(result.supplierItems.map((row) => [row.itemId, row])),
        ),
      )
      .catch(() => setSupplierItemsByItem({}));
  }, [supplierId]);
  const isForecastEditable = !purchaseOrder || status !== "CANCELLED";
  const isCancellable = !isNew && (status === "DRAFT" || status === "ORDERED");
  const isConfirmable = !isNew && status === "DRAFT" && lines.length > 0;
  const isReceivable = !isNew && (status === "ORDERED" || status === "PARTIALLY_RECEIVED");

  const supplierOptions: SupplierOption[] = useMemo(() => {
    if (!purchaseOrder || activeSuppliers.some((s) => s.id === purchaseOrder.supplierId)) {
      return activeSuppliers;
    }
    return [
      ...activeSuppliers,
      {
        id: purchaseOrder.supplierId,
        code: purchaseOrder.supplierCode,
        legalName: purchaseOrder.supplierName,
        tradeName: null,
        active: false,
      },
    ];
  }, [activeSuppliers, purchaseOrder]);

  function optionsForRow(row: LineRow): ItemOption[] {
    const usedByOtherRows = new Set(lines.filter((l) => l.key !== row.key).map((l) => l.itemId));
    const base = activeItems.filter((item) => !usedByOtherRows.has(item.id));
    if (row.itemId && !base.some((item) => item.id === row.itemId)) {
      return [
        ...base,
        { id: row.itemId, code: row.itemCode, name: row.itemName, unitCode: row.unitCode, active: false },
      ];
    }
    return base;
  }

  const prefilled = useRef(false);
  useEffect(() => {
    if (!isNew || prefilled.current || !shortageItemId) return;
    prefilled.current = true;
    /*
     * O item em falta é buscado pelo id, não procurado na lista carregada.
     * Antes o atalho "Ir para compras" dependia de o item estar na página do
     * catálogo; fora dela a OC abria vazia e o atalho não fazia nada — e é
     * justamente o item que ninguém acha que costuma faltar.
     */
    void getItem(shortageItemId)
      .then((dto) => {
        const item = itemOption(dto);
        setActiveItems((atual) => mesclarItens(atual, [item]));
        // Só preenche documento vazio: o rascunho restaurado de um cadastro
        // no contexto é mais recente que o atalho e não pode ser trocado por
        // uma linha só.
        setLines((atual) =>
          atual.length > 0
            ? atual
            : [
                {
                  key: nextRowKey(),
                  itemId: item.id,
                  itemCode: item.code,
                  itemName: item.name,
                  unitCode: item.unitCode,
                  orderedQuantity: shortageQuantity,
                  unitPrice: "",
                  receivedQuantity: "0",
                  openQuantity: "0",
                },
              ],
        );
      })
      .catch(() => undefined);
  }, [isNew, shortageItemId, shortageQuantity]);

  /**
   * Cadastro de fornecedor e de item na TELA OFICIAL, sem perder a OC.
   *
   * Fornecedor é campo único: basta lembrar que foi ele quem pediu. Item
   * vive em linha de tabela, então o contexto carrega QUAL linha — sem isso
   * o item criado voltaria para a primeira.
   */
  const origem = useContextualCreateOrigin<RascunhoOrdemCompra>({
    collectDraft: () => ({ supplierId, orderDate, expectedDeliveryDate, notes, lines }),
    restoreDraft: (draft) => {
      // Antes de qualquer `setState`: a carga da OC está a caminho.
      rascunhoRestaurado.current = true;
      /*
       * O atalho "Ir para compras" continua na URL de retorno, e o efeito de
       * pré-preenchimento trocaria as linhas restauradas por uma linha só. O
       * rascunho é mais recente que o atalho.
       */
      prefilled.current = true;
      setSupplierId(draft.supplierId ?? "");
      setOrderDate(draft.orderDate ?? "");
      setExpectedDeliveryDate(draft.expectedDeliveryDate ?? "");
      setNotes(draft.notes ?? "");
      const linhas = Array.isArray(draft.lines) ? draft.lines : [];
      absorverChaves(linhas);
      setLines(linhas);
    },
    onCreated: (result, record) => {
      // Pelo id, sempre. O tipo do registro diz qual campo pediu.
      if (record.entityType === "supplier") {
        setSupplierId(result.entityId);
        return;
      }
      const chave = lerChaveDaLinha(record.context);
      if (!chave) return;
      // O nome ocupa a coluna enquanto o item real não chega: `optionsForRow`
      // monta a opção da linha a partir dele.
      setLines((prev) =>
        prev.map((line) =>
          line.key === chave ? { ...line, itemId: result.entityId, itemName: result.label } : line,
        ),
      );
      /*
       * A linha precisa de código e unidade, e o resultado da criação traz
       * só id e rótulo. Buscar o item pelo id completa a linha e põe a opção
       * no seletor antes de o catálogo recarregar. Falha aqui não desfaz a
       * seleção: o id já está na linha.
       */
      void getItem(result.entityId)
        .then((item) => {
          setActiveItems((prev) => [
            {
              id: item.id,
              code: item.code,
              name: item.name,
              unitCode: item.unitCode,
              active: item.active,
            },
            ...prev.filter((row) => row.id !== item.id),
          ]);
          setLines((prev) =>
            prev.map((line) =>
              line.key === chave
                ? { ...line, itemCode: item.code, itemName: item.name, unitCode: item.unitCode }
                : line,
            ),
          );
        })
        .catch(() => undefined);
    },
  });

  function handleAddLine() {
    setLines((prev) => [
      ...prev,
      {
        key: nextRowKey(),
        itemId: "",
        itemCode: "",
        itemName: "",
        unitCode: "",
        orderedQuantity: "",
        unitPrice: "",
        receivedQuantity: "0",
        openQuantity: "0",
      },
    ]);
  }

  function handleRemoveLine(key: string) {
    setLines((prev) => prev.filter((line) => line.key !== key));
  }

  function handleLineItemChange(key: string, itemId: string) {
    const item = activeItems.find((option) => option.id === itemId);
    setLines((prev) =>
      prev.map((line) =>
        line.key === key
          ? {
              ...line,
              itemId,
              itemCode: item?.code ?? "",
              itemName: item?.name ?? "",
              unitCode: item?.unitCode ?? "",
            }
          : line,
      ),
    );
  }

  function handleLineFieldChange(key: string, field: "orderedQuantity" | "unitPrice", value: string) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, [field]: value } : line)));
  }

  /*
   * Total previsto da OC, somado sobre o que foi digitado.
   *
   * Era `Number(line.unitPrice)` direto, e `12,50` virava `NaN`: a linha
   * era pulada e o total aparecia menor do que a OC realmente vale, sem
   * nenhum sinal de que faltava uma linha na conta.
   */
  const previewTotal = useMemo(() => {
    let total: number | null = null;
    for (const line of lines) {
      const price = parseDecimalInput(line.unitPrice);
      const qty = parseDecimalInput(line.orderedQuantity);
      if (price === null || qty === null) continue;
      total = (total ?? 0) + Number(qty) * Number(price);
    }
    return total;
  }, [lines]);

  const displayTotal = purchaseOrder
    ? purchaseOrder.orderTotal
    : previewTotal !== null
      ? previewTotal.toFixed(2)
      : null;

  async function handleSaveDraft() {
    if (!supplierId) {
      setError("Selecione um fornecedor.");
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});

    try {
      // Dentro do funil: quantidade ou preço ilegível interrompe aqui,
      // nomeando o item, e a OC não é criada nem alterada.
      const linesPayload = lines
        .filter((line) => line.itemId)
        .map((line) => {
          const preco = exigirDecimalOpcional(
            line.unitPrice,
            `Preço unitário de ${line.itemCode || "item"}`,
          );
          return {
            itemId: line.itemId,
            orderedQuantity: exigirDecimal(
              line.orderedQuantity,
              `Quantidade de ${line.itemCode || "item"}`,
            ),
            ...(preco ? { unitPrice: preco } : {}),
          };
        });

      const expectedIso = toIsoOrEmpty(expectedDeliveryDate);

      const payload = {
        supplierId,
        orderDate: toIsoOrEmpty(orderDate),
        notes: notes.trim(),
        lines: linesPayload,
        ...(isNew ? (expectedIso ? { expectedDeliveryDate: expectedIso } : {}) : { expectedDeliveryDate: expectedIso }),
      };

      if (isNew) {
        const created = await createPurchaseOrder(payload);
        navigate(`/compras/ordens/${created.id}`, { replace: true });
      } else if (id) {
        const updated = await updatePurchaseOrder(id, payload);
        setPurchaseOrder(updated);
        syncFormFromServer(updated);
      }
    } catch (err) {
      if (err instanceof ApiValidationError) {
        const nextFieldErrors: Record<string, string> = {};
        for (const issue of err.issues) {
          nextFieldErrors[issue.path] = issue.message;
        }
        setFieldErrors(nextFieldErrors);
        setError("Corrija os campos destacados.");
      } else {
        setError(apiErrorMessage(err, "Falha ao salvar ordem de compra"));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveForecastOnly() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updatePurchaseOrder(id, {
        expectedDeliveryDate: toIsoOrEmpty(expectedDeliveryDate),
        notes: notes.trim(),
      });
      setPurchaseOrder(updated);
      syncFormFromServer(updated);
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao salvar"));
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    if (!id) return;
    setConfirmDialogOpen(false);
    setSaving(true);
    setError(null);
    try {
      const updated = await confirmPurchaseOrder(id);
      setPurchaseOrder(updated);
      syncFormFromServer(updated);
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao confirmar pedido"));
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelConfirm() {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await cancelPurchaseOrder(id, { reason: cancelReason.trim() });
      setCancelDialogOpen(false);
      setCancelReason("");
      setPurchaseOrder(updated);
      syncFormFromServer(updated);
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao cancelar ordem de compra"));
    } finally {
      setSaving(false);
    }
  }

  if (!isNew && loading) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Ordem de compra</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (!isNew && notFound) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Ordem de compra não encontrada</h1>
          <button type="button" className="btn btn--ghost" onClick={() => navigate("/compras/ordens")}>
            ← Voltar para Ordens de Compra
          </button>
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
              { label: "Ordens de Compra", href: "/compras/ordens" },
              { label: isNew ? "Nova" : (purchaseOrder?.code ?? "Ordem de compra") },
            ]}
          />
          <div className="doc-title">
            <h1>{isNew ? "Nova ordem de compra" : purchaseOrder?.code}</h1>
            {purchaseOrder && (
              <span className={statusBadgeClass(status)}>{PURCHASE_ORDER_STATUS_LABELS[status]}</span>
            )}
          </div>
        </div>
        <div className="table__actions">
          {purchaseOrder && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => navigate(`/compras/ordens/${purchaseOrder.id}/imprimir`)}
            >
              Imprimir
            </button>
          )}
        </div>
      </div>

      <div className="doc-body">
        {/* Confirmar não é comprar de novo nem receber: é o ato que trava o
            documento e joga o saldo em aberto para Em Compra. */}
        <ContextHelp topic={helpTopics["compras.ordens"]} />

      {error && <p className="form-alert" role="alert">{error}</p>}

      {purchaseOrder && purchaseOrder.origin === "CUSTOMER_ORDER" && (
        <FormSection title="Origem">
          <dl className="definition-list">
            <dt>Origem</dt>
            <dd>Pedido do Cliente</dd>
            <dt>Pedido</dt>
            <dd>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => navigate(`/comercial/pedidos/${purchaseOrder.customerOrderId}`)}
              >
                {purchaseOrder.customerOrderCode}
              </button>
            </dd>
          </dl>
        </FormSection>
      )}

      {purchaseOrder?.status === "CANCELLED" && (
        <FormSection title="Cancelamento">
          <div className="status-line">
            <span className="badge badge--err">Cancelado</span>
            <span className="field__hint">
              {formatDateTime(purchaseOrder.cancelledAt)} — {purchaseOrder.cancelledBy ?? "—"}
            </span>
          </div>
          {purchaseOrder.cancelReason && (
            <p className="field__hint">Motivo: {purchaseOrder.cancelReason}</p>
          )}
        </FormSection>
      )}

      <FormSection
        title="Fornecedor e datas"
        subtitle={
          isDraftEditable
            ? "Enquanto rascunho, fornecedor e datas podem ser alterados livremente."
            : "Após confirmada, fornecedor e data do pedido ficam congelados."
        }
      >
        <div className="field-grid-2">
          <div className="field">
            <label htmlFor="po-supplier">
              Fornecedor <span className="req">*</span>
            </label>
            {isDraftEditable ? (
              <SearchableEntitySelect
                id="po-supplier"
                value={supplierId}
                onChange={setSupplierId}
                placeholder="Digite código ou nome do fornecedor…"
                onSearch={buscarFornecedores}
options={supplierOptions.map((supplier) => ({
                  id: supplier.id,
                  code: supplier.code,
                  name: supplier.tradeName ?? supplier.legalName,
                  ...(supplier.active ? {} : { hint: "inativo" }),
                }))}
                canCreate
                createLabel="Novo fornecedor"
                onCreateNew={() =>
                  origem.goCreate({
                    route: "/cadastros/fornecedores/novo",
                    fieldKey: "supplierId",
                    entityType: "supplier",
                  })
                }
                /* Liga campo, `aria-invalid` e a mensagem, para leitor de tela também. */
                {...(fieldErrors["supplierId"]
                  ? {
                      "aria-invalid": true as const,
                      "aria-describedby": "po-supplierId-error",
                    }
                  : {})}
              />
            ) : (
              <p className="field-readonly-value">
                {purchaseOrder?.supplierCode} — {purchaseOrder?.supplierName}
              </p>
            )}
            {fieldErrors["supplierId"] && (
              <p className="field__error" id="po-supplierId-error">
                {fieldErrors["supplierId"]}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="po-order-date">
              Data do pedido <span className="req">*</span>
            </label>
            {isDraftEditable ? (
              <input
                id="po-order-date"
                type="date"
                value={orderDate}
                onChange={(event) => setOrderDate(event.target.value)}
              />
            ) : (
              <p className="field-readonly-value">
                {formatDate(purchaseOrder?.orderDate ?? "")}
              </p>
            )}
          </div>

          <div className="field">
            <label htmlFor="po-expected-date">Previsão de entrega</label>
            <input
              id="po-expected-date"
              type="date"
              value={expectedDeliveryDate}
              disabled={!isForecastEditable}
              onChange={(event) => setExpectedDeliveryDate(event.target.value)}
            />
          </div>
        </div>
      </FormSection>

      <FormSection
        title="Itens"
        subtitle="Somente matérias-primas e embalagens ativas podem ser adicionadas."
      >
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="is-numeric">Quantidade</th>
                <th>Un.</th>
                <th className="is-numeric">
                  Preço unit.
                  <DicaDoCampo id="compras.precoPrevisto" />
                </th>
                <th className="is-numeric">Total</th>
                {isDraftEditable && <th aria-hidden="true" />}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                // Mesma leitura do total previsto: `12,50` é doze e cinquenta,
                // não `NaN` — antes a coluna Total virava "—" no exato momento
                // em que a pessoa terminava de digitar o preço.
                const precoDigitado = parseDecimalInput(line.unitPrice);
                const qtdDigitada = parseDecimalInput(line.orderedQuantity);
                const lineTotal =
                  precoDigitado !== null && qtdDigitada !== null
                    ? (Number(qtdDigitada) * Number(precoDigitado)).toFixed(2)
                    : null;

                return (
                  <tr key={line.key}>
                    <td>
                      {isDraftEditable ? (
                        /* Mesmo seletor com busca de Formulação, Amostra e
                           Pedido. Era o único lugar onde escolher item virava
                           rolar uma lista fechada — com o catálogo real da
                           Veridi, procurar "beta-alanina" numa lista de
                           centenas é trabalho, não escolha. */
                        <SearchableEntitySelect
                          id={`po-line-item-${line.key}`}
                          value={line.itemId}
                          onChange={(value) => handleLineItemChange(line.key, value)}
                          placeholder="Digite código ou nome do item…"
                          options={optionsForRow(line).map(opcaoDoItem)}
                          onSearch={(termo) => buscarItens(line, termo)}
                          canCreate
                          createLabel="Novo item de estoque"
                          onCreateNew={() =>
                            origem.goCreate({
                              route: "/cadastros/itens/novo",
                              fieldKey: "itemId",
                              entityType: "item",
                              // Qual linha pediu — o item volta para ela.
                              context: { rowKey: line.key },
                            })
                          }
                        />
                      ) : (
                        <EntityLink
                          kind="item"
                          id={line.itemId}
                          code={line.itemCode}
                          name={line.itemName}
                        />
                      )}
                      {(() => {
                        const relation = supplierItemsByItem[line.itemId];
                        if (!line.itemId || !relation) return null;
                        const offer = relation.currentOffer;
                        return (
                          <div className="field__hint">
                            {SUPPLIER_ITEM_QUALIFICATION_LABELS[relation.qualificationStatus]}
                            {relation.preferred ? " · preferencial" : ""}
                            {offer
                              ? ` · referência ${offer.unitPrice} ${offer.currencyCode}/${offer.priceUomCode}`
                              : relation.latestLegacyOffer
                                ? " · só referência histórica de preço"
                                : ""}
                            {offer?.minimumOrderQuantity
                              ? ` · mínimo ${formatQuantity(offer.minimumOrderQuantity)} ${offer.minimumOrderUomCode ?? ""}`
                              : ""}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="is-numeric">
                      {isDraftEditable ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          // "0" e "Opcional" não nomeiam campo nenhum: sem
                          // isto, quantidade e preço da mesma linha soavam
                          // idênticos para um leitor de tela.
                          aria-label={`Quantidade de ${line.itemCode || "item"}`}
                          value={line.orderedQuantity}
                          onChange={(event) =>
                            handleLineFieldChange(line.key, "orderedQuantity", event.target.value)
                          }
                        />
                      ) : (
                        <>
                          {formatQuantity(line.orderedQuantity)}
                          {status !== "CANCELLED" && (
                            <>
                              <br />
                              <span className="field__hint">
                                Recebido: {formatQuantity(line.receivedQuantity)} · Aberto: {formatQuantity(line.openQuantity)}
                                <DicaDoCampo id="compras.saldoAberto" />
                              </span>
                            </>
                          )}
                        </>
                      )}
                    </td>
                    <td>{line.unitCode || "—"}</td>
                    <td className="is-numeric">
                      {isDraftEditable ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="Opcional"
                          aria-label={`Preço unitário de ${line.itemCode || "item"}`}
                          value={line.unitPrice}
                          onChange={(event) =>
                            handleLineFieldChange(line.key, "unitPrice", event.target.value)
                          }
                        />
                      ) : (
                        formatBRL(line.unitPrice || null)
                      )}
                    </td>
                    <td className="is-numeric">{formatBRL(lineTotal)}</td>
                    {isDraftEditable && (
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          aria-label="Remover linha"
                          onClick={() => handleRemoveLine(line.key)}
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}

              {lines.length === 0 && (
                <tr>
                  <td colSpan={isDraftEditable ? 6 : 5} className="table__empty">
                    Nenhum item adicionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="table-foot">Total: {formatBRL(displayTotal)}</div>
        </div>

        {isDraftEditable && (
          <div className="line-actions">
            <button type="button" className="btn btn--secondary btn--sm" onClick={handleAddLine}>
              + Adicionar item
            </button>
          </div>
        )}
      </FormSection>

      {purchaseOrder && purchaseOrder.receipts.length > 0 && (
        <FormSection
          title="Recebimentos"
          subtitle="O que de fato chegou contra esta ordem. Cada recebimento abre direto pelo código."
        >
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Recebimento</th>
                  <th>Data</th>
                  <th>Nota fiscal</th>
                  <th className="is-numeric">Itens</th>
                  <th className="is-numeric">Quantidade</th>
                  <th className="is-numeric">Lotes gerados</th>
                </tr>
              </thead>
              <tbody>
                {purchaseOrder.receipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td className="is-code">
                      <EntityLink kind="receipt" id={receipt.id} code={receipt.code} />
                    </td>
                    <td>{formatDate(receipt.receivedAt)}</td>
                    <td>{receipt.invoiceNumber ?? "—"}</td>
                    <td className="is-numeric">{receipt.lineCount}</td>
                    <td className="is-numeric">{formatQuantity(receipt.receivedQuantity)}</td>
                    <td className="is-numeric">{receipt.lotCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </FormSection>
      )}

      <FormSection title="Observações">
        <div className="field">
          <label htmlFor="po-notes">Notas internas</label>
          <textarea
            id="po-notes"
            rows={3}
            disabled={!isForecastEditable}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
      </FormSection>
      </div>

      <div className="doc-actions">
        {isCancellable && (
          <button
            type="button"
            className="btn btn--danger"
            disabled={saving}
            onClick={() => setCancelDialogOpen(true)}
          >
            Cancelar OC
          </button>
        )}

        <div className="doc-actions__primary">
          {isDraftEditable && (
            <button type="button" className="btn btn--secondary" disabled={saving} onClick={handleSaveDraft}>
              {saving ? "Salvando…" : "Salvar rascunho"}
            </button>
          )}
          {!isDraftEditable && isForecastEditable && !isNew && (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={saving}
              onClick={handleSaveForecastOnly}
            >
              {saving ? "Salvando…" : "Salvar previsão e observações"}
            </button>
          )}
          {isConfirmable && (
            <button
              type="button"
              className="btn btn--accent"
              disabled={saving}
              onClick={() => setConfirmDialogOpen(true)}
            >
              Confirmar OC
            </button>
          )}
          {isReceivable && (
            <button
              type="button"
              className="btn btn--accent"
              disabled={saving}
              onClick={() => navigate(`/compras/recebimentos/novo?purchaseOrderId=${id}`)}
            >
              Receber materiais
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDialogOpen}
        title="Confirmar OC?"
        message='Após confirmar, fornecedor, itens, quantidades e preços não poderão ser alterados. Só será possível ajustar a previsão de entrega e as observações.'
        confirmLabel="Confirmar"
        confirmTone="accent"
        onCancel={() => setConfirmDialogOpen(false)}
        onConfirm={handleConfirm}
      />

      {cancelDialogOpen && (
        <>
          <ModalDialog labelledBy="cancel-po-title" onClose={() => setCancelDialogOpen(false)}>
            <h2 id="cancel-po-title">Cancelar ordem de compra?</h2>
            <p>
              {purchaseOrder?.code} permanecerá no histórico, mas deixará de contribuir para "Em
              Compra". Esta ação não pode ser desfeita.
            </p>
            <div className="field">
              <label htmlFor="po-cancel-reason">
                Motivo do cancelamento <span className="req">*</span>
              </label>
              <textarea
                id="po-cancel-reason"
                rows={3}
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
              />
            </div>
            <div className="confirm-dialog__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setCancelDialogOpen(false)}
              >
                Voltar
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={cancelReason.trim().length < 3 || saving}
                onClick={handleCancelConfirm}
              >
                Cancelar OC
              </button>
            </div>
          </ModalDialog>
        </>
      )}

    </>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}
