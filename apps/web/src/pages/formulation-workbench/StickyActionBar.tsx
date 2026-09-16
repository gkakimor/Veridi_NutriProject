import type { ReactNode } from "react";

/**
 * BARRA DE AÇÕES FIXA NO RODAPÉ — infraestrutura visual, e só isso.
 *
 * Numa tela longa as ações principais ficavam no FIM do conteúdo: quem edita a
 * décima linha da receita não vê "Salvar rascunho" nem "Ativar versão", e a
 * saída natural passa a ser rolar até o fim para descobrir se ainda existem.
 * A barra fica visível enquanto se trabalha.
 *
 * Ela NÃO conhece Formulação, Modelo, Produto, ativação, permissão nem
 * alteração pendente: recebe as ações como filhos e desenha o rodapé. Um
 * `isTemplate` aqui dentro faria a barra virar uma terceira tela, com regras de
 * domínio escondidas num componente de layout.
 *
 * `position: sticky` dentro do próprio scroll do workspace — não `fixed` sobre
 * a viewport: o `fixed` ignoraria a largura do conteúdo e a sidebar, e passaria
 * por cima da tela inteira em qualquer largura.
 */
export interface StickyActionBarProps {
  /** Lado esquerdo: voltar e ações secundárias do documento. */
  inicio?: ReactNode;
  /** Lado direito: a ação primária e as que a acompanham. */
  fim: ReactNode;
  /** Descrição da região para leitor de tela. */
  rotulo?: string;
}

export function StickyActionBar({ inicio, fim, rotulo = "Ações da página" }: StickyActionBarProps) {
  return (
    <div className="sticky-action-bar" role="group" aria-label={rotulo}>
      <div className="sticky-action-bar__inicio">{inicio}</div>
      <div className="sticky-action-bar__fim">{fim}</div>
    </div>
  );
}
