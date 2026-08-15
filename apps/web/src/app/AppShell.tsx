import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { navigation } from "./navigation";
import "./shell.css";

/**
 * Shell operacional Veridi.
 *
 * Estrutura fixa: masthead superior verde-escuro, navegacao a esquerda,
 * workspace principal. Drawer contextual a direita entra por tela, quando
 * util — nao existe painel permanente.
 */
export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  // Em tablet/mobile a navegacao e sobreposta: fecha ao trocar de rota.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="shell">
      <header className="masthead">
        <button
          type="button"
          className="masthead__toggle"
          aria-label={navOpen ? "Fechar navegação" : "Abrir navegação"}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((open) => !open)}
        >
          <span aria-hidden="true">☰</span>
        </button>

        <Link to="/" className="masthead__brand">
          <span className="masthead__mark" aria-hidden="true">
            V
          </span>
          Veridi
          <span className="masthead__sub">Nutrition</span>
        </Link>

        <div className="masthead__search">
          <label className="sr-only" htmlFor="global-search">
            Buscar ou escanear
          </label>
          <input
            id="global-search"
            type="search"
            placeholder="Buscar ou escanear…"
            disabled
          />
        </div>

        <div className="masthead__user">
          <span>Ambiente local</span>
        </div>
      </header>

      {navOpen && (
        <button
          type="button"
          className="sidebar__scrim"
          aria-label="Fechar navegação"
          onClick={() => setNavOpen(false)}
        />
      )}

      <nav
        className={navOpen ? "sidebar is-open" : "sidebar"}
        aria-label="Navegação principal"
      >
        {navigation.map((group, index) => (
          <div className="sidebar__group" key={group.title ?? `grupo-${index}`}>
            {group.title !== null && (
              <div className="sidebar__group-title">{group.title}</div>
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/"}
                className={({ isActive }) =>
                  isActive ? "sidebar__link is-active" : "sidebar__link"
                }
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

      <main className="workspace">
        <Outlet />
      </main>
    </div>
  );
}
