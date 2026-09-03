import { useEffect, useRef, useState } from "react";
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
  const navRef = useRef<HTMLDivElement>(null);

  /*
   * Entrar direto numa rota cujo item de menu esta abaixo da dobra deixava a
   * navegacao mostrando um trecho do menu onde nada esta marcado como atual —
   * a pessoa via uma tela de Gestao com o menu parado em Cadastros.
   *
   * `block: "nearest"` nao mexe em nada quando o item ja esta visivel, e rola
   * apenas o proprio miolo da navegacao: a pagina principal fica onde estava.
   */
  useEffect(() => {
    const nav = navRef.current;
    const ativo = nav?.querySelector<HTMLElement>(".sidebar__link.is-active");
    if (!nav || !ativo) return;

    /*
     * ROLAR SEM TOCAR NO FOCO.
     *
     * `scrollIntoView` parecia inofensivo e não era: ele move o "ponto de
     * partida sequencial" do navegador para o elemento revelado. O primeiro
     * Tab depois de carregar qualquer rota passava a pular tudo o que vem
     * antes do item ativo — inclusive o skip-link, que existe justamente para
     * quem navega por teclado não precisar atravessar trinta e dois links.
     * Na última entrada do menu era pior: não havendo próximo, o Tab pulava a
     * navegação inteira.
     *
     * Consertar a descoberta com o mouse não pode custar a descoberta com o
     * teclado. Ajustar `scrollTop` à mão rola igual e não mexe em foco nenhum.
     */
    const caixaNav = nav.getBoundingClientRect();
    const caixaItem = ativo.getBoundingClientRect();
    if (caixaItem.top < caixaNav.top) {
      nav.scrollTop -= caixaNav.top - caixaItem.top;
    } else if (caixaItem.bottom > caixaNav.bottom) {
      nav.scrollTop += caixaItem.bottom - caixaNav.bottom;
    }
  }, [location.pathname]);

  /*
   * Titulo da aba por tela.
   *
   * Era "Veridi Nutrition" em todas, entao quem trabalha com varias abas —
   * que e o normal aqui: pedido numa, estoque noutra, ordem numa terceira —
   * so descobria qual era qual clicando. O nome do item de menu ja e o nome
   * que a pessoa usa para a tela; nao ha por que inventar outro.
   *
   * A rota mais especifica ganha: `/estoque/lotes` e Lotes, nao Posicao de
   * Estoque.
   */
  useEffect(() => {
    const atual = [...navItems]
      .filter((item) =>
        item.path === "/"
          ? location.pathname === "/"
          : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`),
      )
      .sort((a, b) => b.path.length - a.path.length)[0];
    document.title = atual && atual.path !== "/"
      ? `${atual.label} · Veridi Nutrition`
      : "Veridi Nutrition";
  }, [location.pathname]);
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
    // O termo também não sobrevive à troca de tela: um código de lote parado
    // no campo, três telas depois, parece filtro ativo do que está na frente.
    setSearchValue("");
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
        <div className="sidebar__header" />
        <div className="sidebar__nav" ref={navRef}>
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
        </div>
        <div className="sidebar__footer" />
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
