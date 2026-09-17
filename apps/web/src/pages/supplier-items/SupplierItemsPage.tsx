import { OPCOES_PRECO_UNITARIO } from "../../lib/numeric-scales";
import { formatDecimalPtBr, formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { formatQuantity } from "../../lib/quantity";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { ItemDTO, SupplierDTO, SupplierItemDTO, SupplierItemQualificationStatus } from "@veridi/shared";
import {
  ITEM_FAMILIES,
  ITEM_FAMILY_LABELS,
  SUPPLIER_ITEM_EDIT_ROLES,
  SUPPLIER_ITEM_QUALIFICATION_LABELS,
  SUPPLIER_ITEM_QUALIFICATION_STATUSES,
  SUPPLIER_OFFER_AMBIGUITY_MESSAGE,
  SUPPLIER_OFFER_ELIGIBILITY_HINTS,
} from "@veridi/shared";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { ListStatusRow } from "../../components/ListStatusRow";
import { EntityFilterSelect } from "../../components/filters/EntityFilterSelect";
import { fornecedoresAtivosDaTela } from "../../lib/filter-sources";
import { listItems } from "../../lib/items-api";
import { useFilteredPage, useListQuery } from "../../lib/list-query";
import type { ListSupplierItemsParams } from "../../lib/supplier-items-api";
import { listSupplierItems } from "../../lib/supplier-items-api";
import { useAuth } from "../../app/AuthProvider";
import { perfilPermite } from "../../lib/perfis";
import { useInitialFilters } from "../../lib/filter-params";
import { clearStoredFilters, usePersistentFilter } from "../../lib/stored-filters";
import { SupplierItemFormModal } from "./SupplierItemFormModal";
import { SupplierItemDetailModal } from "./SupplierItemDetailModal";
import { ROTULO_DA_PARTE_INATIVA } from "./parte-inativa";
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
        {formatDecimalPtBr(row.currentOffer.unitPrice, { ...OPCOES_PRECO_UNITARIO, minFractionDigits: 2 })} {row.currentOffer.currencyCode}/{row.currentOffer.priceUomCode}
      </span>
    );
  }
  if (row.latestLegacyOffer) {
    return (
      <span title={SUPPLIER_OFFER_ELIGIBILITY_HINTS[row.latestLegacyOffer.eligibility]}>
        {formatDecimalPtBr(row.latestLegacyOffer.unitPrice, { ...OPCOES_PRECO_UNITARIO, minFractionDigits: 2 })} {row.latestLegacyOffer.currencyCode}/
        {row.latestLegacyOffer.priceUomCode}{" "}
        {/* Sem vigência não é oferta inválida: é histórico, e some da
            grade quem o esconder. A frase inteira fica no title e no
            detalhe — a célula do preço não é lugar de parágrafo. */}
        <span className="badge badge--neutral">Importada sem vigência</span>
      </span>
    );
  }
  return <span>—</span>;
}

/** Comercial → Compras → Item × Fornecedor. */
export function SupplierItemsPage() {
  const { user } = useAuth();
  /*
   * Cadastrar relação é de Compras e Administrador — a lista da API
   * (MASTER-DATA-EDIT-PERMISSIONS-01). Os demais perfis consultam e abrem o
   * detalhe, sem "Nova relação" que terminaria em 403.
   */
  const podeCriarRelacao = perfilPermite(SUPPLIER_ITEM_EDIT_ROLES, user?.role);

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

  /**
   * Primeira página de fornecedores ativos — a mesma para a barra e para o
   * formulário de relação, pedida uma vez por montagem (PERFORMANCE-CLEANUP-WAVE-01).
   *
   * Era 1000, e a mesma lista abastecia a barra: do fornecedor ativo 1001 em
   * diante ele não era filtrável nem escolhível. Barra e formulário buscam no
   * servidor por conta própria; daqui só sai a abertura.
   */
  const fornecedoresAtivos = useMemo(fornecedoresAtivosDaTela, []);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  useEffect(() => {
    fornecedoresAtivos
      .primeiraPagina()
      .then(setSuppliers)
      .catch(() => setSuppliers([]));
    listItems({ active: true, pageSize: PRIMEIRA_PAGINA_DE_ITENS })
      .then((result) => setItems(result.items))
      .catch(() => setItems([]));
  }, [fornecedoresAtivos]);

  // Link contextual traz identidade exata; nunca combina com filtro anterior.
  const navigate = useNavigate();
  const contextParam = urlFilter("itemId");

  const filtrosDaConsulta = useMemo(() => {
    const filtros: Omit<ListSupplierItemsParams, "page" | "pageSize"> = {};
    if (contextParam) filtros.itemId = contextParam;
    if (search) filtros.search = search;
    if (qualificationStatus !== "all") filtros.qualificationStatus = qualificationStatus;
    if (supplierId) filtros.supplierId = supplierId;
    if (itemFamily) filtros.itemFamily = itemFamily;
    if (preferredOnly) filtros.preferred = true;
    if (activeOnly) filtros.active = true;
    return filtros;
  }, [contextParam, search, qualificationStatus, supplierId, itemFamily, preferredOnly, activeOnly]);

  /* Filtro novo é página 1 no mesmo render — uma consulta por troca (LISTS-LOADING-STALE-DATA-02). */
  const [page, setPage] = useFilteredPage(filtrosDaConsulta);

  const consulta = useListQuery(
    listSupplierItems,
    { ...filtrosDaConsulta, page, pageSize: PAGE_SIZE },
    { fallbackError: "Falha ao carregar relações" },
  );
  const rows: SupplierItemDTO[] = consulta.data?.supplierItems ?? [];
  const total = consulta.data?.total ?? 0;
  const reload = consulta.reload;

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
        {podeCriarRelacao && (
          <button type="button" className="btn btn--primary" onClick={abrirCriacao}>
            Nova relação
          </button>
        )}
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

        {/* Só fornecedores ativos, como o `<select>` de 1000 oferecia —
            agora com busca no servidor. */}
        <EntityFilterSelect
          id="supplier-items-supplier"
          label="Filtrar por fornecedor"
          placeholder="Todos os fornecedores"
          value={supplierId}
          onChange={setSupplierId}
          source={fornecedoresAtivos.source}
        />

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

      {consulta.error && <p className="form-alert" role="alert">{consulta.error}</p>}

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

      <div className="table-container" aria-busy={consulta.loading || undefined}>
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
                {/* Três situações distintas: o item, o fornecedor e a relação
                    (última coluna). A relação de cadastro inativo continua
                    listada — e marcada (SUPPLIER-ITEM-INACTIVE-GATE-01). */}
                <td className="col-flex">
                  <EntityLink kind="item" id={row.itemId} code={row.itemCode} name={row.itemName} />
                  {!row.itemActive && (
                    <>
                      {" "}
                      <span className="badge badge--inactive">{ROTULO_DA_PARTE_INATIVA.item}</span>
                    </>
                  )}
                </td>
                <td className="col-flex">
                  {row.supplierName}
                  {!row.supplierActive && (
                    <>
                      {" "}
                      <span className="badge badge--inactive">
                        {ROTULO_DA_PARTE_INATIVA.supplier}
                      </span>
                    </>
                  )}
                </td>
                <td className="col-tight is-code">{row.supplierItemCode ?? "—"}</td>
                <td className="col-tight">
                  <span className={qualificationBadgeClass(row.qualificationStatus)}>
                    {SUPPLIER_ITEM_QUALIFICATION_LABELS[row.qualificationStatus]}
                  </span>
                </td>
                {/* A ambiguidade é do ITEM e aparece na linha porque é aqui
                    que ela se resolve: marcar um preferencial é ação de uma
                    relação. Sem isso, quem cadastrou dois fornecedores certos
                    via o CMV sem custo e nada explicava a ligação. */}
                <td className="col-tight">
                  {row.preferred ? (
                    <span className="badge badge--active">Sim</span>
                  ) : row.costSourceAmbiguous ? (
                    <span className="badge badge--neutral" title={SUPPLIER_OFFER_AMBIGUITY_MESSAGE}>
                      Definir preferencial
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="col-tight is-numeric">
                  <SupplierItemPriceCell row={row} />
                </td>
                <td className="col-tight">
                  {row.currentOffer?.minimumOrderQuantity
                    ? `${formatQuantity(row.currentOffer.minimumOrderQuantity)} ${row.currentOffer.minimumOrderUomCode ?? ""}`
                    : (row.latestLegacyOffer?.minimumOrderQuantity ?? "—") +
                      (row.latestLegacyOffer?.minimumOrderQuantity
                        ? ` ${row.latestLegacyOffer.minimumOrderUomCode ?? ""}`
                        : "")}
                </td>
                <td className="col-tight">{formatIntegerPtBr(row.offerCount)}</td>
                <td className="col-tight">{row.active ? "Ativa" : "Inativa"}</td>
              </tr>
            ))}

            <ListStatusRow colSpan={9} query={consulta} rowCount={rows.length}>
              Nenhuma relação item × fornecedor encontrada.
            </ListStatusRow>
          </tbody>
        </table>
      </div>

      {consulta.data && (
        <div className="pagination">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={page <= 1}
            onClick={() => setPage(Math.max(1, page - 1))}
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
            onClick={() => setPage(page + 1)}
          >
            Próxima
          </button>
        </div>
      )}

      {/* `?nova=1` na URL não abre o formulário para quem não cria relação. */}
      {createOpen && podeCriarRelacao && (
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
