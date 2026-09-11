import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { USER_ROLE_LABELS } from "@veridi/shared";
import { lookupLot } from "../lib/lots-api";
import { useAuth } from "./AuthProvider";
import { navItems } from "./navigation";
import { Sidebar } from "./Sidebar";
import { useMediaQuery } from "./use-media-query";
import { useNavigationPreferences } from "./use-navigation-preferences";
import "./shell.css";

/**
 * Abaixo desta largura a sidebar é drawer sob demanda — nunca coluna, nem
 * compacta: num celular ela espremeria o workspace.
 */
const MOBILE_QUERY = "(max-width: 640px)";

/**
 * Shell operacional Veridi.
 *
 * Estrutura fixa: topbar verde-escuro, navegacao a esquerda (expandida ou
 * compacta no desktop, drawer no celular), workspace principal. Modais
 * fullscreen de CRUD cobrem apenas o workspace (ver `FullWorkspaceModal`) —
 * topbar e sidebar continuam visiveis.
 */
export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { prefs, update } = useNavigationPreferences(user?.id ?? null);

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

  // O drawer do celular fecha ao trocar de tela — e ao deixar de ser celular.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname, location.search, isMobile]);

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

  const shellClass = [
    "shell",
    prefs.compact && !isMobile ? "shell--compact" : null,
    isMobile && mobileNavOpen ? "shell--nav-open" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={shellClass}>
      {/* Sem isso, chegar à primeira ação da tela pelo teclado exige passar
          pela navegação inteira em todas as páginas. */}
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="masthead">
        {/* No desktop o menu mora na coluna (expandida ou compacta) e se
            recolhe pelo controle do rodapé dela; o hambúrguer é do celular. */}
        {isMobile && (
          <button
            type="button"
            className="masthead__toggle"
            aria-label={mobileNavOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={mobileNavOpen}
            aria-controls="sidebar"
            onClick={() => setMobileNavOpen((open) => !open)}
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
        )}

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

      <Sidebar
        role={user?.role ?? null}
        prefs={prefs}
        updatePrefs={update}
        isMobile={isMobile}
        mobileOpen={mobileNavOpen}
        onMobileOpenChange={setMobileNavOpen}
      />

      {isMobile && mobileNavOpen && (
        <div
          className="sidebar-backdrop"
          aria-hidden="true"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      <main className="workspace" id="conteudo" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
