import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { NavigationPreferencesDTO, UserRole } from "@veridi/shared";
import { NavIcon } from "./nav-icons";
import {
  dashboardItem,
  findActiveNavItem,
  isNavItemActive,
  searchNavigation,
  visibleNavGroups,
} from "./navigation";
import type { NavItem } from "./navigation";
import type { NavigationPreferencesUpdate } from "./use-navigation-preferences";

/**
 * Menu compacto aberto por cima do conteúdo, SEM mudar a preferência: a
 * pessoa clicou num ícone do trilho ou pediu a busca. Fecha ao navegar, com
 * Esc ou clicando fora.
 */
interface Peek {
  focus: "search" | "favorites" | "group";
  /** Grupo que o clique no trilho abriu — só nesta espiada, não na preferência. */
  groupId: string | null;
  /** `data-rail` do ícone que abriu a espiada: recebe o foco de volta no Esc. */
  trigger: string;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.userAgent);
const SHORTCUT_LABEL = IS_MAC ? "⌘K" : "Ctrl K";

function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

export interface SidebarProps {
  role: UserRole | null;
  prefs: NavigationPreferencesDTO;
  updatePrefs: NavigationPreferencesUpdate;
  /** Celular: drawer sob demanda, sempre expandido — nunca trilho compacto. */
  isMobile: boolean;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

/**
 * Navegação principal do ERP (NAVIGATION-SIDEBAR-01).
 *
 * Desktop expandido: busca de telas, Painel, Favoritos e os grupos
 * recolhíveis. Desktop compacto: trilho com um ícone por grupo; clicar abre
 * o menu por cima do conteúdo. Celular: o mesmo menu expandido, em drawer.
 *
 * Preferência (compacto, grupos abertos, favoritos) vem por id estável e é
 * gravada pelo `useNavigationPreferences`. O que é só desta visita — o grupo
 * da tela atual aberto sozinho, a espiada do trilho — não vira preferência.
 */
export function Sidebar({
  role,
  prefs,
  updatePrefs,
  isMobile,
  mobileOpen,
  onMobileOpenChange,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [peek, setPeek] = useState<Peek | null>(null);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [focusSearchRequest, setFocusSearchRequest] = useState(0);
  const [railFocus, setRailFocus] = useState<string | null>(null);
  const [autoOpenDismissedAt, setAutoOpenDismissedAt] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ text: string; top: number; left: number } | null>(null);

  const compact = prefs.compact && !isMobile;
  const rail = compact && peek === null;

  const groups = useMemo(() => visibleNavGroups(role), [role]);
  const visibleById = useMemo(
    () => new Map(groups.flatMap((group) => group.items.map((item) => [item.id, item] as const))),
    [groups],
  );
  // Favorito sem permissão, ou de tela que deixou de existir: não aparece, e nada quebra.
  const favorites = prefs.favorites
    .map((id) => visibleById.get(id))
    .filter((item): item is NavItem => item !== undefined);
  const favoriteIds = new Set(prefs.favorites);

  const { pathname, search } = location;
  const locationKey = `${pathname}${search}`;
  const active = findActiveNavItem(groups, pathname, search);
  const activeGroupId = active?.group.id ?? null;
  /*
   * O grupo da tela atual abre sozinho, para mostrar onde a pessoa está — sem
   * tocar na preferência. Se ela fechar esse grupo, ele fica fechado até a
   * próxima troca de tela.
   */
  const autoOpenGroupId = autoOpenDismissedAt === locationKey ? null : activeGroupId;
  const dashboardActive = isNavItemActive(dashboardItem, pathname, search);

  const results = useMemo(() => searchNavigation(query, groups), [query, groups]);
  const searching = query.trim() !== "";
  const highlightedResult = searching ? results[Math.min(highlighted, results.length - 1)] : undefined;

  function isGroupOpen(groupId: string): boolean {
    return (
      prefs.openGroups.includes(groupId) ||
      groupId === autoOpenGroupId ||
      (peek?.focus === "group" && peek.groupId === groupId)
    );
  }

  // Trocar de tela encerra a busca e a espiada.
  useEffect(() => {
    setPeek(null);
    setQuery("");
  }, [pathname, search]);

  useEffect(() => {
    if (!rail) setTooltip(null);
  }, [rail]);

  // O campo de busca pode estar nascendo neste mesmo render (espiada, drawer).
  useEffect(() => {
    if (focusSearchRequest === 0) return;
    searchRef.current?.focus();
    searchRef.current?.select();
  }, [focusSearchRequest]);

  const peekFocus = peek?.focus ?? null;
  const peekGroupId = peek?.groupId ?? null;
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || peekFocus === null || peekFocus === "search") return;
    const target =
      peekFocus === "favorites"
        ? nav.querySelector<HTMLElement>("#sidebar-favoritos")
        : peekGroupId
          ? nav.querySelector<HTMLElement>(`[data-group-toggle="${peekGroupId}"]`)
          : null;
    target?.focus();
  }, [peekFocus, peekGroupId]);

  useEffect(() => {
    if (!rail || railFocus === null) return;
    rootRef.current?.querySelector<HTMLElement>(`[data-rail="${railFocus}"]`)?.focus();
    setRailFocus(null);
  }, [rail, railFocus]);

  /*
   * Entrar direto numa rota revela o item ativo, rolando só o miolo da
   * navegação. `scrollIntoView` ficou de fora de propósito: ele move o ponto
   * de partida do Tab para o item revelado e o primeiro Tab da página pulava
   * o skip-link. Ajustar `scrollTop` rola igual e não mexe em foco.
   */
  useEffect(() => {
    const nav = navRef.current;
    const ativo = nav?.querySelector<HTMLElement>(".sidebar__link.is-active, .sidebar__rail-btn.is-active");
    if (!nav || !ativo || ativo.closest("[hidden]")) return;
    const caixaNav = nav.getBoundingClientRect();
    const caixaItem = ativo.getBoundingClientRect();
    if (caixaItem.top < caixaNav.top) {
      nav.scrollTop -= caixaNav.top - caixaItem.top;
    } else if (caixaItem.bottom > caixaNav.bottom) {
      nav.scrollTop += caixaItem.bottom - caixaNav.bottom;
    }
  }, [pathname, search, rail]);

  useEffect(() => {
    if (!peek) return;
    const trigger = peek.trigger;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setRailFocus(trigger);
      setPeek(null);
      setQuery("");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [peek]);

  const openSearch = useCallback(() => {
    setTooltip(null);
    if (isMobile) onMobileOpenChange(true);
    else if (prefs.compact) setPeek((current) => current ?? { focus: "search", groupId: null, trigger: "search" });
    setFocusSearchRequest((count) => count + 1);
  }, [isMobile, onMobileOpenChange, prefs.compact]);

  // Ctrl+K / Cmd+K: abre e foca a busca de telas, de qualquer lugar do sistema.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      openSearch();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSearch]);

  function openPeek(next: Peek) {
    setTooltip(null);
    setPeek(next);
  }

  function closePeek() {
    setPeek(null);
    setQuery("");
  }

  function closeSearch() {
    setQuery("");
    searchRef.current?.blur();
    if (peek) {
      setRailFocus(peek.trigger);
      setPeek(null);
    }
    if (isMobile) onMobileOpenChange(false);
  }

  function openScreen(path: string) {
    searchRef.current?.blur();
    setQuery("");
    setPeek(null);
    if (isMobile) onMobileOpenChange(false);
    navigate(path);
  }

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        if (results.length === 0) return;
        event.preventDefault();
        setHighlighted((index) => (index + 1) % results.length);
        break;
      case "ArrowUp":
        if (results.length === 0) return;
        event.preventDefault();
        setHighlighted((index) => (index - 1 + results.length) % results.length);
        break;
      case "Enter":
        if (!highlightedResult) return;
        event.preventDefault();
        openScreen(highlightedResult.item.path);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        closeSearch();
        break;
    }
  }

  function toggleGroup(groupId: string) {
    if (!isGroupOpen(groupId)) {
      updatePrefs((current) => ({
        ...current,
        openGroups: [...current.openGroups.filter((id) => id !== groupId), groupId],
      }));
      return;
    }
    if (groupId === autoOpenGroupId) setAutoOpenDismissedAt(locationKey);
    if (peek?.groupId === groupId) setPeek({ ...peek, groupId: null });
    // Grupo aberto só pela rota atual fecha sem gravar nada: a preferência não mudou.
    if (prefs.openGroups.includes(groupId)) {
      updatePrefs((current) => ({
        ...current,
        openGroups: current.openGroups.filter((id) => id !== groupId),
      }));
    }
  }

  function toggleFavorite(itemId: string) {
    updatePrefs((current) => ({
      ...current,
      favorites: current.favorites.includes(itemId)
        ? current.favorites.filter((id) => id !== itemId)
        : [...current.favorites, itemId],
    }));
  }

  function toggleCompact() {
    setPeek(null);
    setQuery("");
    setTooltip(null);
    updatePrefs((current) => ({ ...current, compact: !current.compact }));
  }

  /*
   * Dica do trilho em `position: fixed`, fora da `<nav>`: a coluna tem
   * `overflow: hidden` (só o miolo rola) e cortaria uma dica desenhada dentro
   * dela.
   */
  function showTooltip(event: ReactMouseEvent<HTMLElement> | FocusEvent<HTMLElement>) {
    const text = event.currentTarget.getAttribute("aria-label");
    if (!text) return;
    const box = event.currentTarget.getBoundingClientRect();
    setTooltip({ text, top: box.top + box.height / 2, left: box.right + 10 });
  }

  function hideTooltip() {
    setTooltip(null);
  }

  const tooltipHandlers = {
    onMouseEnter: showTooltip,
    onMouseLeave: hideTooltip,
    onFocus: showTooltip,
    onBlur: hideTooltip,
  };

  function renderItem(item: NavItem) {
    const isActive = isNavItemActive(item, pathname, search);
    const isFavorite = favoriteIds.has(item.id);
    return (
      <li className="sidebar__row" key={item.id}>
        <Link
          to={item.path}
          className={cx("sidebar__link", isActive && "is-active")}
          aria-current={isActive ? "page" : undefined}
        >
          <span className="sidebar__label">{item.label}</span>
          {!item.implemented && <span className="sidebar__tag">em breve</span>}
        </Link>
        <button
          type="button"
          className={cx("sidebar__star", isFavorite && "is-on")}
          aria-pressed={isFavorite}
          aria-label={`Favoritar ${item.label}`}
          title={isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          onClick={() => toggleFavorite(item.id)}
        >
          <NavIcon name="star" size={14} filled={isFavorite} />
        </button>
      </li>
    );
  }

  if (rail) {
    return (
      <nav id="sidebar" className="sidebar sidebar--rail" aria-label="Navegação principal" ref={rootRef}>
        <div className="sidebar__header">
          <button
            type="button"
            className="sidebar__rail-btn"
            data-rail="search"
            aria-label={`Buscar telas (${SHORTCUT_LABEL})`}
            onClick={openSearch}
            {...tooltipHandlers}
          >
            <NavIcon name="search" />
          </button>
        </div>
        <div className="sidebar__nav" ref={navRef} onScroll={hideTooltip}>
          <Link
            to="/"
            className={cx("sidebar__rail-btn", dashboardActive && "is-active")}
            data-rail="dashboard"
            aria-label="Painel"
            aria-current={dashboardActive ? "page" : undefined}
            {...tooltipHandlers}
          >
            <NavIcon name="dashboard" />
          </Link>
          <button
            type="button"
            className="sidebar__rail-btn"
            data-rail="favorites"
            aria-label="Favoritos"
            onClick={() => openPeek({ focus: "favorites", groupId: null, trigger: "favorites" })}
            {...tooltipHandlers}
          >
            <NavIcon name="star" filled={favorites.length > 0} />
          </button>
          {groups.map((group) => {
            const isActive = group.id === activeGroupId;
            // A tela atual entra no nome: no trilho é o que identifica o item ativo.
            const label = isActive && active ? `${group.title} — ${active.item.label}` : group.title;
            return (
              <button
                key={group.id}
                type="button"
                className={cx("sidebar__rail-btn", isActive && "is-active")}
                data-rail={group.id}
                aria-label={label}
                aria-current={isActive ? "true" : undefined}
                onClick={() => openPeek({ focus: "group", groupId: group.id, trigger: group.id })}
                {...tooltipHandlers}
              >
                <NavIcon name={group.icon} />
              </button>
            );
          })}
        </div>
        <div className="sidebar__footer">
          <button
            type="button"
            className="sidebar__rail-btn"
            data-rail="expand"
            aria-label="Expandir menu"
            onClick={toggleCompact}
            {...tooltipHandlers}
          >
            <NavIcon name="expand" />
          </button>
        </div>
        {tooltip &&
          createPortal(
            <div className="sidebar-tooltip" role="tooltip" style={{ top: tooltip.top, left: tooltip.left }}>
              {tooltip.text}
            </div>,
            document.body,
          )}
      </nav>
    );
  }

  return (
    <>
      {peek && <div className="sidebar-peek-backdrop" aria-hidden="true" onClick={closePeek} />}
      <nav
        id="sidebar"
        className={cx("sidebar", peek && "is-peek")}
        aria-label="Navegação principal"
        ref={rootRef}
        // Drawer fechado no celular: fora da tela e fora do Tab.
        inert={isMobile && !mobileOpen ? true : undefined}
      >
        <div className="sidebar__header">
          <div className="sidebar-search">
            <NavIcon name="search" size={15} />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-label="Buscar telas"
              aria-autocomplete="list"
              aria-expanded={searching}
              aria-controls={searching && results.length > 0 ? "sidebar-resultados" : undefined}
              aria-activedescendant={
                highlightedResult ? `sidebar-resultado-${highlightedResult.item.id}` : undefined
              }
              placeholder="Buscar telas..."
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlighted(0);
              }}
              onKeyDown={onSearchKeyDown}
            />
            {!searching && !isMobile && (
              <kbd className="sidebar-search__kbd" aria-hidden="true">
                {SHORTCUT_LABEL}
              </kbd>
            )}
          </div>
        </div>

        <div className="sidebar__nav" ref={navRef}>
          {searching ? (
            results.length > 0 ? (
              <div className="sidebar__results" id="sidebar-resultados" role="listbox" aria-label="Telas encontradas">
                {results.map((result, index) => (
                  <Link
                    key={result.item.id}
                    id={`sidebar-resultado-${result.item.id}`}
                    to={result.item.path}
                    role="option"
                    aria-selected={result === highlightedResult}
                    aria-label={result.breadcrumb}
                    tabIndex={-1}
                    className={cx("sidebar__result", result === highlightedResult && "is-highlighted")}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => {
                      setQuery("");
                      setPeek(null);
                      if (isMobile) onMobileOpenChange(false);
                    }}
                  >
                    <span className="sidebar__result-label">{result.item.label}</span>
                    <span className="sidebar__result-path">{result.breadcrumb}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="sidebar__empty" role="status">
                Nenhuma tela encontrada.
              </p>
            )
          ) : (
            <>
              <Link
                to={dashboardItem.path}
                className={cx("sidebar__link", dashboardActive && "is-active")}
                aria-current={dashboardActive ? "page" : undefined}
              >
                <NavIcon name="dashboard" />
                <span className="sidebar__label">{dashboardItem.label}</span>
              </Link>

              <section className="sidebar__section" aria-labelledby="sidebar-favoritos">
                <h2 className="sidebar__section-title" id="sidebar-favoritos" tabIndex={-1}>
                  <NavIcon name="star" filled={favorites.length > 0} />
                  <span className="sidebar__label">Favoritos</span>
                </h2>
                {favorites.length > 0 ? (
                  <ul className="sidebar__items">{favorites.map(renderItem)}</ul>
                ) : (
                  <p className="sidebar__hint">Marque ☆ ao lado de uma tela para trazê-la para cá.</p>
                )}
              </section>

              {groups.map((group) => {
                const open = isGroupOpen(group.id);
                const listId = `sidebar-grupo-${group.id}`;
                return (
                  <div className="sidebar__group" key={group.id}>
                    <button
                      type="button"
                      className={cx("sidebar__group-toggle", group.id === activeGroupId && "has-active")}
                      aria-expanded={open}
                      aria-controls={listId}
                      data-group-toggle={group.id}
                      onClick={() => toggleGroup(group.id)}
                    >
                      <NavIcon name={group.icon} />
                      <span className="sidebar__label">{group.title}</span>
                      <NavIcon name="chevron" size={14} className="sidebar__chevron" />
                    </button>
                    <ul className="sidebar__items" id={listId} hidden={!open}>
                      {group.items.map(renderItem)}
                    </ul>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {!isMobile && (
          <div className="sidebar__footer">
            <button type="button" className="sidebar__collapse" onClick={toggleCompact}>
              <NavIcon name={compact ? "expand" : "collapse"} />
              <span className="sidebar__label">{compact ? "Expandir menu" : "Recolher menu"}</span>
            </button>
          </div>
        )}
      </nav>
    </>
  );
}
