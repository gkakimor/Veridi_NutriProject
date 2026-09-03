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
  variant = "button",
}: {
  title?: string;
  /**
   * `highlight` marca o destino que vale a pena notar primeiro — hoje só a
   * Consulta do Cliente, que é a única entrada que muda o MODO de navegar
   * (mantém o cliente como contexto) em vez de abrir mais uma lista
   * filtrada. Sem a marca, o link é secundário como os outros.
   */
  links: { label: string; to: string; highlight?: boolean }[];
  /**
   * Como o destino se apresenta.
   *
   * `button` é a barra de atalhos de um CADASTRO: cada destino abre outra
   * lista, e o botão fantasma separa esses atalhos do corpo do formulário.
   *
   * `link` é a barra que troca de TELA do mesmo registro. Vestida de botão
   * fantasma ela virava texto cinza sem sublinhado — só o cursor no hover
   * dizia que levava a algum lugar, e quem não passa o mouse não descobre.
   * O estilo de link é o mesmo que a tela já usa para citar Cliente e
   * Produto (`entity-link`), então a pessoa reconhece a afordância que já
   * viu em toda tabela do sistema.
   */
  variant?: "button" | "link";
}) {
  if (links.length === 0) return null;

  const defaultClass = variant === "link" ? "entity-link" : "btn btn--ghost btn--sm";

  return (
    <div className="related-links">
      <span className="related-links__title">{title}</span>
      {links.map((link) => (
        <Link
          key={link.to}
          className={link.highlight ? "btn btn--secondary btn--sm" : defaultClass}
          to={link.to}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}
