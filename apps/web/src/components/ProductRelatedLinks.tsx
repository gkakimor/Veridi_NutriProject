import { RelatedLinks } from "./RelatedLinks";

/**
 * Navegação entre as telas de um mesmo produto.
 *
 * Formulação, custos industriais, cálculo e precificação são telas DO produto,
 * mas moram em rotas próprias. Quem entra numa delas ficava sem saída: o
 * cadastro do produto só voltava pelo botão do navegador, e pular de custos
 * para formulação exigia refazer o caminho pela lista.
 *
 * `current` some da barra — link para a tela em que a pessoa já está é ruído.
 */
export type ProductScreen = "product" | "formulation" | "costs" | "pricing";

export function ProductRelatedLinks({
  productId,
  current,
  title = "Ver do produto",
}: {
  productId: string | null | undefined;
  current: ProductScreen;
  title?: string;
}) {
  if (!productId) return null;

  const all: { key: ProductScreen; label: string; to: string }[] = [
    { key: "product", label: "Produto", to: `/cadastros/produtos?productId=${productId}&open=${productId}` },
    { key: "formulation", label: "Formulação", to: `/producao/formulacoes/${productId}` },
    { key: "costs", label: "Custos industriais", to: `/produtos/${productId}/custos` },
    { key: "pricing", label: "Precificação", to: `/gestao/precificacao?productId=${productId}` },
  ];

  return (
    <RelatedLinks
      title={title}
      links={all.filter((link) => link.key !== current).map(({ label, to }) => ({ label, to }))}
    />
  );
}
