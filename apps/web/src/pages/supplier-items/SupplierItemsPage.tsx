import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { ItemDTO, SupplierDTO, SupplierItemDTO, SupplierItemQualificationStatus } from "@veridi/shared";
import {
  ITEM_FAMILIES,
  ITEM_FAMILY_LABELS,
  SUPPLIER_ITEM_QUALIFICATION_LABELS,
  SUPPLIER_ITEM_QUALIFICATION_STATUSES,
} from "@veridi/shared";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { listItems } from "../../lib/items-api";
import { listSuppliers } from "../../lib/suppliers-api";
import { listSupplierItems } from "../../lib/supplier-items-api";
import { useAuth } from "../../app/AuthProvider";
import { useInitialFilters } from "../../lib/filter-params";
import { clearStoredFilters, usePersistentFilter } from "../../lib/stored-filters";
import { SupplierItemFormModal } from "./SupplierItemFormModal";
import { SupplierItemDetailModal } from "./SupplierItemDetailModal";
import { EntityLink } from "../../components/EntityLink";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

const PAGE_SIZE = 20;

/** ⓘ de uma coluna, lido do registro central — o texto nunca mora no JSX. */
function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}
const FILTER_SCOPE = "supplier-items";

/**
 * Primeira página do catálogo de itens que abastece o formulário de relação.
 *
 * Era 1000 sobre 2.729 itens ativos, e o formulário ainda filtrava tipo no
 * navegador — o que passava do teto existia e não aparecia na busca. Quem
 * digita agora pergunta ao servidor, dentro do próprio formulário; aqui só
 * fica a página de abertura.
 */
const PRIMEIRA_PAGINA_DE_ITENS = 50;

export function qualificationBadgeClass(status: SupplierItemQualificationStatus): string {
  switch (status) {
    case "APPROVED":
      return "badge badge--active";
    case "BLOCKED":
      return "badge badge--err";
    default:
      return "badge badge--neutral";
  }
}

/**
 * Preço da relação.
 *
 * Só oferta vigente é "preço atual". Referência sem vigência confiável
 * (todo o histórico da planilha) aparece marcada como referência — nunca
 * fingindo ser o preço de hoje.
 */
export function SupplierItemPriceCell({ row }: { row: SupplierItemDTO }) {
  if (row.currentOffer) {
    return (
      <span>
        {row.currentOffer.unitPrice} {row.currentOffer.currencyCode}/{row.currentOffer.priceUomCode}
      </span>
    );
  }
  if (row.latestLegacyOffer) {
    return (
      <span title="Observação histórica de preço, sem vigência — não é o preço atual.">
        {row.latestLegacyOffer.unitPrice} {row.latestLegacyOffer.currencyCode}/
        {row.latestLegacyOffer.priceUomCode}{" "}
        <span className="badge badge--neutral">Referência legada</span>
      </span>
    );
  }
  return <span>—</span>;
}

/** Comercial → Compras → Item × Fornecedor. */
export function SupplierItemsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<SupplierItemDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * A relação nova mora na URL enquanto está aberta (`?nova=1`).
   *
   * Não é enfeite: os campos Item e Fornecedor saem para a TELA OFICIAL de
   * cadastro, e sair DESMONTA o formulário. Quem volta precisa encontrá-lo
   * aberto de novo, e a única coisa que sobrevive à navegação é a URL — o
   * rascunho volta pelo contexto, mas só se houver formulário montado para
   * recebê-lo. De quebra, um F5 no meio do cadastro deixa de fechar a tela.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(() => searchParams.get("nova") === "1");
  const [detailId, setDetailId] = useState<string | null>(null);

  function abrirCriacao() {
    setCreateOpen(true);
    if (searchParams.get("nova") === "1") return;
    const proximo = new URLSearchParams(searchParams);
    proximo.set("nova", "1");
    setSearchParams(proximo, { replace: true });
  }

  function fecharCriacao() {
    setCreateOpen(false);
    if (searchParams.get("nova") !== "1") return;
    const proximo = new URLSearchParams(searchParams);
    proximo.delete("nova");
    setSearchParams(proximo, { replace: true });
  }

  const [search, setSearch] = usePersistentFilter(user?.id ?? null, FILTER_SCOPE, "search", "");
  const [qualificationStatus, setQualificationStatus] = usePersistentFilter<
    SupplierItemQualificationStatus | "all"
  >(user?.id ?? null, FILTER_SCOPE, "qualification", "all");
  const urlFilter = useInitialFilters();
  const [supplierId, setSupplierId] = usePersistentFilter(
    user?.id ?? null,
    FILTER_SCOPE,
    "supplier",
    "",
    urlFilter("supplierId"),
  );
  const [itemFamily, setItemFamily] = usePersistentFilter(
    user?.id ?? null,
    FILTER_SCOPE,
    "family",
    "",
  );
  const [preferredOnly, setPreferredOnly] = usePersistentFilter(
    user?.id ?? null,
    FILTER_SCOPE,
    "preferred",
    false,
  );
  const [activeOnly, setActiveOnly] = usePersistentFilter(
    user?.id ?? null,
    FILTER_SCOPE,
    "active",
    true,
  );
  const [searchInput, setSearchInput] = useState(search);

  const hasFilters =
    search !== "" ||
    qualificationStatus !== "all" ||
    supplierId !== "" ||
    itemFamily !== "" ||
    preferredOnly ||
    !activeOnly;

  function handleClearFilters() {
    setSearchInput("");
    setSearch("");
    setQualificationStatus("all");
    setSupplierId("");
    setItemFamily("");
    setPreferredOnly(false);
    setActiveOnly(true);
    clearStoredFilters(user?.id ?? null, FILTER_SCOPE);
  }

  const [suppliers, setSuppliers] = useState<SupplierDTO[]>([]);
  const [items, setItems] = useState<ItemDTO[]>([]);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, qualificationStatus, supplierId, itemFamily, preferredOnly, activeOnly]);

  useEffect(() => {
    listSuppliers({ active: true, pageSize: 1000 })
      .then((result) => setSuppliers(result.suppliers))
      .catch(() => setSuppliers([]));
    listItems({ active: true, pageSize: PRIMEIRA_PAGINA_DE_ITENS })
      .then((result) => setItems(result.items))
      .catch(() => setItems([]));
  }, []);

  // Link contextual traz identidade exata; nunca combina com filtro anterior.
  const navigate = useNavigate();
  const contextParam = urlFilter("itemId");

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listSupplierItems>[0] = { page, pageSize: PAGE_SIZE };
    if (contextParam) params.itemId = contextParam;
    if (search) params.search = search;
    if (qualificationStatus !== "all") params.qualificationStatus = qualificationStatus;
    if (supplierId) params.supplierId = supplierId;
    if (itemFamily) params.itemFamily = itemFamily;
    if (preferredOnly) params.preferred = true;
    if (activeOnly) params.active = true;

    listSupplierItems(params)
      .then((result) => {
        setRows(result.supplierItems);
        setTotal(result.total);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar relações"),
      )
      .finally(() => setLoading(false));
  }, [page, search, qualificationStatus, supplierId, itemFamily, preferredOnly, activeOnly]);

  useEffect(() => {
    reload();
  }, [reload]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Item × Fornecedor</h1>
          <p className="page__subtitle">
            Quem fornece cada item, com que código, homologado por quem e a que preço. Preço aqui é
            referência comercial do fornecedor — o custo real continua vindo do recebimento.
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={abrirCriacao}>
          Nova relação
        </button>
        <ExportCsvButton
          path="/supplier-items/export.csv"
          filters={{
            search,
            qualificationStatus: qualificationStatus === "all" ? undefined : qualificationStatus,
            supplierId: supplierId || undefined,
            itemFamily: itemFamily || undefined,
            preferred: preferredOnly ? "true" : undefined,
            active: activeOnly ? "true" : undefined,
          }}
        />
      </div>

      {/* Homologação é da Qualidade e preço é de Compras; a mesma linha
          mostra as duas coisas, e "preferencial" não quer dizer barato. */}
      <ContextHelp topic={helpTopics["compras.itemFornecedor"]} />

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="supplier-items-search">
            Buscar
          </label>
          <input
            id="supplier-items-search"
            type="search"
            placeholder="Buscar por item, código legado, fornecedor ou código no fornecedor…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="supplier-items-qualification">
          Filtrar por homologação
        </label>
        <select
          id="supplier-items-qualification"
          value={qualificationStatus}
          onChange={(event) =>
            setQualificationStatus(event.target.value as SupplierItemQualificationStatus | "all")
          }
        >
          <option value="all">Todas as homologações</option>
          {SUPPLIER_ITEM_QUALIFICATION_STATUSES.map((option) => (
            <option key={option} value={option}>
              {SUPPLIER_ITEM_QUALIFICATION_LABELS[option]}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="supplier-items-supplier">
          Filtrar por fornecedor
        </label>
        <select
          id="supplier-items-supplier"
          value={supplierId}
          onChange={(event) => setSupplierId(event.target.value)}
        >
          <option value="">Todos os fornecedores</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.code} — {supplier.legalName}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="supplier-items-family">
          Filtrar por família
        </label>
        <select
          id="supplier-items-family"
          value={itemFamily}
          onChange={(event) => setItemFamily(event.target.value)}
        >
          <option value="">Todas as famílias</option>
          {ITEM_FAMILIES.map((family) => (
            <option key={family} value={family}>
              {ITEM_FAMILY_LABELS[family]}
            </option>
          ))}
        </select>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={preferredOnly}
            onChange={(event) => setPreferredOnly(event.target.checked)}
          />
          Só preferenciais
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(event) => setActiveOnly(event.target.checked)}
          />
          Só ativas
        </label>

        {hasFilters && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={handleClearFilters}>
            Limpar filtros
          </button>
        )}
      </div>

      {error && <p className="form-alert">{error}</p>}

      {contextParam && (
        <p className="context-chip">
          Mostrando apenas as relações deste item — filtro veio de um link.{" "}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => navigate("/compras/item-fornecedor")}
          >
            Limpar filtros
          </button>
        </p>
      )}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th className="col-flex">Item</th>
              <th className="col-flex">Fornecedor</th>
              <th className="col-tight">Código no fornecedor</th>
              <th className="col-tight">
                Homologação
                <DicaDaColuna id="compras.homologacao" />
              </th>
              <th className="col-tight">
                Preferencial
                <DicaDaColuna id="compras.preferencial" />
              </th>
              <th className="col-tight is-numeric">
                Preço
                <DicaDaColuna id="compras.precoOferta" />
              </th>
              <th className="col-tight">
                Pedido mínimo
                <DicaDaColuna id="compras.pedidoMinimo" />
              </th>
              <th className="col-tight">Referências</th>
              <th className="col-tight">Situação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                tabIndex={0}
                onClick={() => setDetailId(row.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setDetailId(row.id);
                }}
              >
                <td className="col-flex">
                  <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
                </td>
                <td className="col-flex">{row.supplierName}</td>
                <td className="col-tight is-code">{row.supplierItemCode ?? "—"}</td>
                <td className="col-tight">
                  <span className={qualificationBadgeClass(row.qualificationStatus)}>
                    {SUPPLIER_ITEM_QUALIFICATION_LABELS[row.qualificationStatus]}
                  </span>
                </td>
                <td className="col-tight">{row.preferred ? "Sim" : "—"}</td>
                <td className="col-tight is-numeric">
                  <SupplierItemPriceCell row={row} />
                </td>
                <td className="col-tight">
                  {row.currentOffer?.minimumOrderQuantity
                    ? `${row.currentOffer.minimumOrderQuantity} ${row.currentOffer.minimumOrderUomCode ?? ""}`
                    : (row.latestLegacyOffer?.minimumOrderQuantity ?? "—") +
                      (row.latestLegacyOffer?.minimumOrderQuantity
                        ? ` ${row.latestLegacyOffer.minimumOrderUomCode ?? ""}`
                        : "")}
                </td>
                <td className="col-tight">{row.offerCount}</td>
                <td className="col-tight">{row.active ? "Ativa" : "Inativa"}</td>
              </tr>
            ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="table__empty">
                  Nenhuma relação item × fornecedor encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={page <= 1}
          onClick={() => setPage((current) => Math.max(1, current - 1))}
        >
          Anterior
        </button>
        <span className="pagination__info">
          Página {page} de {totalPages} — {total} relação(ões)
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={page >= totalPages}
          onClick={() => setPage((current) => current + 1)}
        >
          Próxima
        </button>
      </div>

      {createOpen && (
        <SupplierItemFormModal
          items={items}
          suppliers={suppliers}
          onClose={fecharCriacao}
          onSaved={(created) => {
            fecharCriacao();
            reload();
            setDetailId(created.id);
          }}
        />
      )}

      {detailId && (
        <SupplierItemDetailModal
          supplierItemId={detailId}
          onClose={() => {
            setDetailId(null);
            reload();
          }}
        />
      )}
    </>
  );
}
