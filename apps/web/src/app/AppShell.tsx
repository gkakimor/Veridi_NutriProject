import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { USER_ROLE_LABELS } from "@veridi/shared";
import { lookupLot } from "../lib/lots-api";
import { useAuth } from "./AuthProvider";
import { navigation, navItems } from "./navigation";
import "./shell.css";

/**
 * NavLink sem `end` casa por prefixo (ex.: "/estoque" tambem "ativa" em
 * "/estoque/lotes"). Isso e o comportamento certo quando a subrota NAO tem
 * item de sidebar proprio (ex.: "/compras/ordens/:id" sob "Ordens de
 * Compra"), mas quebra quando dois itens de sidebar tem essa relacao de
 * prefixo entre si (ex.: "Visão Geral" = "/estoque" vs "Lotes" =
 * "/estoque/lotes"). Nesse segundo caso os dois ficariam marcados como
 * ativos ao mesmo tempo — exige match exato (`end`).
 */
function needsExactMatch(path: string): boolean {
  if (path === "/") return true;
  return navItems.some((other) => other.path !== path && other.path.startsWith(`${path}/`));
}

/**
 * Shell operacional Veridi.
 *
 * Estrutura fixa: topbar verde-escuro, navegacao a esquerda recolhivel,
 * workspace principal. Modais fullscreen de CRUD cobrem apenas o workspace
 * (ver `FullWorkspaceModal`) — topbar e sidebar continuam visiveis.
 */
/** Em telas de celular a sidebar começa recolhida (vira overlay sob demanda). */
function startsCollapsed(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
}

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const [navCollapsed, setNavCollapsed] = useState(startsCollapsed);

  const [searchValue, setSearchValue] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  /*
   * O aviso da busca morre ao trocar de tela.
   *
   * Ele ficava colado no topo por navegações inteiras, cobrindo botão de
   * outra tela e parecendo erro da ação atual. Aviso de busca fala da busca
   * que acabou de acontecer — mudou de tela, acabou o assunto.
   */
  useEffect(() => {
    setSearchError(null);
  }, [location.pathname]);

  async function handleSearchSubmit(event: FormEvent) {
    event.preventDefault();
    const query = searchValue.trim();
    if (!query) return;

    setSearching(true);
    setSearchError(null);
    try {
      const lot = await lookupLot(query);
      if (lot) {
        setSearchValue("");
        navigate(`/estoque/lotes/${lot.id}`);
      } else {
        setSearchError(
          `Nenhum lote encontrado para "${query}". Se o número comercial se repete em mais de um lote, procure em Estoque › Lotes.`,
        );
      }
    } catch {
      setSearchError("Falha ao consultar lote.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className={navCollapsed ? "shell shell--nav-collapsed" : "shell"}>
      {/* Sem isso, chegar à primeira ação da tela pelo teclado exige passar
          pelos ~20 links da navegação em todas as páginas. */}
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="masthead">
        <button
          type="button"
          className="masthead__toggle"
          aria-label={navCollapsed ? "Mostrar menu" : "Esconder menu"}
          aria-expanded={!navCollapsed}
          onClick={() => setNavCollapsed((collapsed) => !collapsed)}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <Link to="/" className="masthead__brand">
          <BrandLogo variant="symbol" className="masthead__mark" />
          Veridi
          <span className="masthead__sub">Nutrition</span>
        </Link>

        <div className="masthead__search-wrap">
          <form className="masthead__search" onSubmit={handleSearchSubmit}>
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4-4" />
            </svg>
            <label className="sr-only" htmlFor="global-search">
              Buscar ou escanear lote
            </label>
            <input
              id="global-search"
              type="search"
              // Resolve lote pelo código interno, pelo QR e pelo número de lote
              // comercial impresso na etiqueta. Item e OP continuam fora — não
              // prometer o que não faz.
              placeholder="Buscar ou escanear lote (código interno ou lote comercial)…"
              value={searchValue}
              disabled={searching}
              onChange={(event) => {
                setSearchValue(event.target.value);
                if (searchError) setSearchError(null);
              }}
            />
          </form>
          {searchError && <div className="masthead__search-feedback">{searchError}</div>}
        </div>

        <div className="masthead__user">
          {user ? (
            <>
              <span>
                {user.name}
                <span className="masthead__role"> · {USER_ROLE_LABELS[user.role]}</span>
              </span>
              <button type="button" className="masthead__logout" onClick={() => void signOut()}>
                Sair
              </button>
            </>
          ) : (
            <span>Ambiente local</span>
          )}
        </div>
      </header>

      <nav className="sidebar" aria-label="Navegação principal">
        {navigation.map((group, index) => (
          <div className="sidebar__group" key={group.title ?? `grupo-${index}`}>
            {group.title !== null && (
              <div className="sidebar__group-title">{group.title}</div>
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={needsExactMatch(item.path)}
                className={({ isActive }) =>
                  isActive ? "sidebar__link is-active" : "sidebar__link"
                }
                onClick={() => {
                  if (window.matchMedia("(max-width: 640px)").matches) setNavCollapsed(true);
                }}
              >
                <span>{item.label}</span>
                {!item.implemented && (
                  <span className="sidebar__tag">em breve</span>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {!navCollapsed && (
        <div
          className="sidebar-backdrop"
          aria-hidden="true"
          onClick={() => setNavCollapsed(true)}
        />
      )}

      <main className="workspace" id="conteudo" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
