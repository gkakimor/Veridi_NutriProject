import type { ReactNode } from "react";

/**
 * `@react-pdf/renderer` desenhado como DOM — só para teste de CONTEÚDO.
 *
 * O documento PDF é uma árvore React. Trocando as primitivas do renderer por
 * `div`/`span`, o teste lê o que o documento ESCREVE com a mesma Testing
 * Library das telas:
 *
 *     vi.mock("@react-pdf/renderer", async () => ({
 *       ...(await import("../pdf/testing/react-pdf-dom")),
 *     }));
 *
 * Página, fonte e posição não existem aqui; conteúdo dinâmico (`render`)
 * sai como página 1 de 1. O arquivo real — A4, paginação, rodapé em toda
 * folha — é provado em `pdf-generator.test.tsx`.
 */

type DynamicProps = {
  pageNumber: number;
  totalPages: number;
  subPageNumber: number;
  subPageTotalPages: number;
};
type Props = {
  children?: ReactNode;
  render?: (props: DynamicProps) => ReactNode;
  [key: string]: unknown;
};

const PAGINA_UNICA: DynamicProps = { pageNumber: 1, totalPages: 1, subPageNumber: 1, subPageTotalPages: 1 };

/** Só os `data-*` chegam ao DOM: é por eles que o teste acha as peças. */
function dataAttributes(props: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(props).filter(([key]) => key.startsWith("data-")));
}

export function Document({ children, ...rest }: Props) {
  return (
    <div data-pdf="document" {...dataAttributes(rest)}>
      {children}
    </div>
  );
}

export function Page({ children, ...rest }: Props) {
  return (
    <div data-pdf="page" {...dataAttributes(rest)}>
      {children}
    </div>
  );
}

export function View({ children, render, ...rest }: Props) {
  return <div {...dataAttributes(rest)}>{render ? render(PAGINA_UNICA) : children}</div>;
}

export function Text({ children, render, ...rest }: Props) {
  return <span {...dataAttributes(rest)}>{render ? render(PAGINA_UNICA) : children}</span>;
}

export function Image() {
  return null;
}

export function Link({ children }: Props) {
  return <span>{children}</span>;
}

export const StyleSheet = {
  create: <T,>(styles: T): T => styles,
};

export const Font = {
  register: () => undefined,
  registerHyphenationCallback: () => undefined,
  registerEmojiSource: () => undefined,
};

export function pdf(): never {
  throw new Error("pdf() não existe no teste de conteúdo — o arquivo real é de pdf-generator.test.tsx");
}
