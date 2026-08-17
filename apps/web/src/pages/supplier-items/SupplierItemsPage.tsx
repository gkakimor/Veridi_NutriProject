import { useCallback, useEffect, useState } from "react";
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

const PAGE_SIZE = 20;
const FILTER_SCOPE = "supplier-items";

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

  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

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
    listSuppliers({ active: true, pageSize: 100 })
      .then((result) => setSuppliers(result.suppliers))
      .catch(() => setSuppliers([]));
    listItems({ active: true, pageSize: 100 })
      .then((result) => setItems(result.items))
      .catch(() => setItems([]));
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listSupplierItems>[0] = { page, pageSize: PAGE_SIZE };
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
        <button type="button" className="btn btn--primary" onClick={() => setCreateOpen(true)}>
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

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>Item</th>
              <th>Fornecedor</th>
              <th>Código no fornecedor</th>
              <th>Homologação</th>
              <th>Preferencial</th>
              <th>Preço</th>
              <th>Pedido mínimo</th>
              <th>Referências</th>
              <th>Situação</th>
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
                <td>
                  <span className="code">{row.itemCode}</span> {row.itemName}
                </td>
                <td>{row.supplierName}</td>
                <td className="is-code">{row.supplierItemCode ?? "—"}</td>
                <td>
                  <span className={qualificationBadgeClass(row.qualificationStatus)}>
                    {SUPPLIER_ITEM_QUALIFICATION_LABELS[row.qualificationStatus]}
                  </span>
                </td>
                <td>{row.preferred ? "Sim" : "—"}</td>
                <td>
                  <SupplierItemPriceCell row={row} />
                </td>
                <td>
                  {row.currentOffer?.minimumOrderQuantity
                    ? `${row.currentOffer.minimumOrderQuantity} ${row.currentOffer.minimumOrderUomCode ?? ""}`
                    : (row.latestLegacyOffer?.minimumOrderQuantity ?? "—") +
                      (row.latestLegacyOffer?.minimumOrderQuantity
                        ? ` ${row.latestLegacyOffer.minimumOrderUomCode ?? ""}`
                        : "")}
                </td>
                <td>{row.offerCount}</td>
                <td>{row.active ? "Ativa" : "Inativa"}</td>
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
          onClose={() => setCreateOpen(false)}
          onSaved={(created) => {
            setCreateOpen(false);
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
