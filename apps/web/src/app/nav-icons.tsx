import type { ReactNode } from "react";

export type NavIconName =
  | "dashboard"
  | "commercial"
  | "production"
  | "purchasing"
  | "inventory"
  | "quality"
  | "master-data"
  | "management"
  | "models"
  | "administration"
  | "star"
  | "search"
  | "chevron"
  | "collapse"
  | "expand";

/**
 * Ícones da navegação — traço único, 24×24, cor herdada do texto.
 *
 * Desenhados aqui porque o projeto não usa biblioteca de UI nem de ícones.
 * Um por GRUPO, não por tela: trinta e poucos ícones para telas parecidas
 * viram adivinhação, e quem diz qual é a tela continua sendo o rótulo.
 */
const SHAPES: Record<NavIconName, ReactNode> = {
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  commercial: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M3 12.5h18" />
    </>
  ),
  production: (
    <>
      <path d="M3 20.5h18" />
      <path d="M4.5 20.5V11l5 3v-3l5 3V7.5h5v13" />
    </>
  ),
  purchasing: (
    <>
      <circle cx="9.5" cy="19.5" r="1.5" />
      <circle cx="17.5" cy="19.5" r="1.5" />
      <path d="M2.5 3.5h2.6l2.3 11a1.5 1.5 0 0 0 1.5 1.2h8.3a1.5 1.5 0 0 0 1.5-1.1L20.5 7.5H6" />
    </>
  ),
  inventory: (
    <>
      <path d="M20.5 7.5 12 3 3.5 7.5v9L12 21l8.5-4.5z" />
      <path d="M3.5 7.5 12 12l8.5-4.5" />
      <path d="M12 12v9" />
    </>
  ),
  quality: (
    <>
      <path d="M12 3 19.5 6v5.5c0 4.4-3.1 8.2-7.5 9.5-4.4-1.3-7.5-5.1-7.5-9.5V6z" />
      <path d="m8.8 12 2.2 2.2 4.3-4.4" />
    </>
  ),
  "master-data": (
    <>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" />
      <path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13" />
      <path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" />
    </>
  ),
  management: (
    <>
      <path d="M3.5 20.5h17" />
      <rect x="5" y="11" width="3" height="6.5" rx="1" />
      <rect x="10.5" y="6" width="3" height="11.5" rx="1" />
      <rect x="16" y="13" width="3" height="4.5" rx="1" />
    </>
  ),
  models: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  administration: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </>
  ),
  star: <path d="m12 3.5 2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20.5 20.5-4.9-4.9" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
  collapse: <path d="m11 17-5-5 5-5M18 17l-5-5 5-5" />,
  expand: <path d="m13 17 5-5-5-5M6 17l5-5-5-5" />,
};

export function NavIcon({
  name,
  size = 18,
  filled = false,
  className,
}: {
  name: NavIconName;
  size?: number;
  filled?: boolean;
  className?: string;
}) {
  return (
    <svg
      className={className ? `nav-icon ${className}` : "nav-icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}
