import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { IndustrialResourceDTO, IndustrialResourceType } from "@veridi/shared";
import {
  INDUSTRIAL_RATE_UOM_LABELS,
  INDUSTRIAL_RESOURCE_TYPES,
  INDUSTRIAL_RESOURCE_TYPE_LABELS,
} from "@veridi/shared";
import { ExportCsvButton } from "../../components/ExportCsvButton";
import { useAuth } from "../../app/AuthProvider";
import { listIndustrialResources } from "../../lib/industrial-resources-api";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

function DicaDaColuna({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

type ActiveFilter = "all" | "active" | "inactive";
type TypeFilter = "all" | IndustrialResourceType;

const PAGE_SIZE = 20;

/**
 * Gestão → Recursos Industriais.
 *
 * Um recurso é a categoria econômica que a fábrica consome (mão de obra,
 * equipamento, energia) — não é pessoa, não é máquina física com roteiro.
 * A tarifa vigente aparece aqui só como referência: quem congela valor é a
 * estrutura de custo no momento da ativação.
 */
export function IndustrialResourcesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [resources, setResources] = useState<IndustrialResourceDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("all");

  const canEdit = user?.role === "ADMIN";

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, typeFilter, activeFilter]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);

    const params: Parameters<typeof listIndustrialResources>[0] = { page, pageSize: PAGE_SIZE };
    if (search) params.search = search;
    if (typeFilter !== "all") params.type = typeFilter;
    if (activeFilter !== "all") params.active = activeFilter === "active";

    listIndustrialResources(params)
      .then((result) => {
        setResources(result.resources);
        setTotal(result.total);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar recursos industriais"),
      )
      .finally(() => setLoading(false));
  }, [page, search, typeFilter, activeFilter]);

  useEffect(() => {
    reload();
  }, [reload]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Recursos industriais</h1>
          <p className="page__subtitle">
            Mão de obra, equipamentos e energia com tarifa histórica. O uso de cada recurso é
            declarado na estrutura de custos do produto.
          </p>
        </div>
        {/* Leva à tela oficial: o cadastro passou a ter URL própria, e é ela
            que sobrevive a um F5 e vale como link. O gate de ADMIN continua
            aqui e também na página e no servidor. */}
        {canEdit && (
          <Link className="btn btn--primary" to="/gestao/recursos-industriais/novo">
            + Novo recurso
          </Link>
        )}
        <ExportCsvButton
          path="/industrial-resources/export.csv"
          filters={{
            search,
            type: typeFilter === "all" ? undefined : typeFilter,
            active: activeFilter === "all" ? undefined : activeFilter === "active",
          }}
        />
      </div>

      {/* Recurso e uso do recurso vivem em telas diferentes, e a tarifa daqui
          é histórico, não um campo a corrigir. Sem isso a primeira reação é
          procurar onde se edita o valor antigo. */}
      <ContextHelp topic={helpTopics["recursoIndustrial.comoFunciona"]} />

      <div className="toolbar">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="resources-search">
            Buscar recursos
          </label>
          <input
            id="resources-search"
            type="search"
            placeholder="Buscar por código, nome ou descrição…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <label className="sr-only" htmlFor="resources-type-filter">
          Filtrar por tipo
        </label>
        <select
          id="resources-type-filter"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as TypeFilter)}
        >
          <option value="all">Todos os tipos</option>
          {INDUSTRIAL_RESOURCE_TYPES.map((type) => (
            <option key={type} value={type}>
              {INDUSTRIAL_RESOURCE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="resources-active-filter">
          Filtrar por status
        </label>
        <select
          id="resources-active-filter"
          value={activeFilter}
          onChange={(event) => setActiveFilter(event.target.value as ActiveFilter)}
        >
          <option value="all">Todos os status</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>
      </div>

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th className="col-tight">Código</th>
              <th className="col-flex">Recurso</th>
              <th className="col-tight">
                Tipo
                <DicaDaColuna id="recurso.tipo" />
              </th>
              <th className="col-tight">
                Potência (kW)
                <DicaDaColuna id="recurso.potencia" />
              </th>
              <th className="col-tight">
                Tarifa vigente
                <DicaDaColuna id="recurso.tarifaVigente" />
              </th>
              <th className="col-tight">
                Tarifas
                <DicaDaColuna id="recurso.tarifas" />
              </th>
              <th className="col-tight">
                Status
                <DicaDaColuna id="recurso.situacao" />
              </th>
            </tr>
          </thead>
          <tbody>
            {resources.map((resource) => (
              <tr
                key={resource.id}
                tabIndex={0}
                onClick={() => navigate(`/gestao/recursos-industriais/${resource.id}`)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    navigate(`/gestao/recursos-industriais/${resource.id}`);
                  }
                }}
              >
                <td className="col-tight is-code">{resource.code}</td>
                <td className="col-flex">{resource.name}</td>
                <td className="col-tight">{INDUSTRIAL_RESOURCE_TYPE_LABELS[resource.type]}</td>
                {/* Potência desconhecida fica em branco — não vira zero. */}
                <td className="col-tight">{resource.powerKw ?? "—"}</td>
                <td className="col-tight">
                  {resource.currentRate
                    ? `R$ ${resource.currentRate.rateValue} / ${INDUSTRIAL_RATE_UOM_LABELS[resource.currentRate.rateUom]}`
                    : "Não informada"}
                </td>
                <td className="col-tight">{resource.rateCount}</td>
                <td className="col-tight">
                  <span className={resource.active ? "badge badge--active" : "badge badge--inactive"}>
                    {resource.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
              </tr>
            ))}

            {!loading && resources.length === 0 && (
              <tr>
                <td colSpan={7} className="table__empty">
                  Nenhum recurso industrial encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="table-foot">
          {total} {total === 1 ? "recurso" : "recursos"}
        </div>
      </div>

      <div className="pagination">
        <span>
          Página {page} de {totalPages}
        </span>
        <div className="table__actions">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Anterior
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Próxima
          </button>
        </div>
      </div>

    </>
  );
}
