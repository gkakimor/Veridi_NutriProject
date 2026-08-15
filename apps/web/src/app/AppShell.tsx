import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { navigation } from "./navigation";
import "./shell.css";

/**
 * Shell operacional Veridi.
 *
 * Estrutura fixa: topbar verde-escuro, navegacao a esquerda recolhivel,
 * workspace principal. Modais fullscreen de CRUD cobrem apenas o workspace
 * (ver `FullWorkspaceModal`) — topbar e sidebar continuam visiveis.
 */
export function AppShell() {
  const [navCollapsed, setNavCollapsed] = useState(false);

  return (
    <div className={navCollapsed ? "shell shell--nav-collapsed" : "shell"}>
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
          <span className="masthead__mark" aria-hidden="true">
            V
          </span>
          Veridi
          <span className="masthead__sub">Nutrition</span>
        </Link>

        <div className="masthead__search">
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
