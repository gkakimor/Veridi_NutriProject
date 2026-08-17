import { Link } from "react-router-dom";

/**
 * Atalhos para as listas relacionadas a um cadastro.
 *
 * Quando o sistema já sabe a relação — os pedidos são deste cliente, os lotes
 * são deste item —, obrigar a pessoa a abrir outro módulo e pesquisar de novo
 * é trabalho que a máquina deveria ter feito. Cada link abre o destino **já
 * filtrado**, via query param.
 *
 * São links secundários de propósito: a ação principal da tela continua sendo
 * salvar o cadastro.
 */
export function RelatedLinks({
  title = "Ver relacionados",
  links,
}: {
  title?: string;
  links: { label: string; to: string }[];
}) {
  if (links.length === 0) return null;

  return (
    <div className="related-links">
      <span className="related-links__title">{title}</span>
      {links.map((link) => (
        <Link key={link.to} className="btn btn--ghost btn--sm" to={link.to}>
          {link.label}
        </Link>
      ))}
    </div>
  );
}
