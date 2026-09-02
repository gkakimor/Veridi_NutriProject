import { Link } from "react-router-dom";

export interface BreadcrumbItem {
  label: string;
  /** Destino do nível. Ausente = nível sem página própria (raro). */
  href?: string;
  /** Marca o nível em que a pessoa está. Sem isto, vale o último item. */
  current?: boolean;
}

/**
 * Trilha da página: onde este registro MORA no sistema, não por onde a
 * pessoa passou para chegar aqui.
 *
 * "Ordens de Compra / OC-000011" é verdade venha a pessoa do menu, de um
 * link no Pedido ou de um endereço colado — por isso a trilha é montada da
 * rota, nunca do histórico.
 *
 * Os níveis anteriores são `<Link>` de verdade: abrir em nova aba, Voltar e
 * Avançar do navegador precisam funcionar neles como em qualquer link.
 */
export function PageBreadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  // Trilha de um nível só repete o título da tela logo abaixo — é ruído.
  // Lista raiz (Clientes, Produtos) cai exatamente neste caso.
  if (items.length < 2) return null;

  // `aria-current="page"` só faz sentido uma vez por trilha: quem declarar
  // `current` manda, e sem declaração nenhuma vale o último nível.
  const declared = items.findIndex((item) => item.current === true);
  const currentIndex = declared === -1 ? items.length - 1 : declared;

  return (
    <nav className="page-crumbs" aria-label="Trilha da página">
      <ol>
        {items.map((item, index) => {
          const isCurrent = index === currentIndex;
          return (
            <li key={`${item.label}-${index}`}>
              {item.href && !isCurrent ? (
                <Link to={item.href}>{item.label}</Link>
              ) : (
                <span aria-current={isCurrent ? "page" : undefined}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
