import { Link } from "react-router-dom";

/**
 * Referência clicável a outro registro.
 *
 * O ERP cita registro o tempo todo: a formulação cita o produto e o item de
 * saída, o pedido cita o cliente, o lote cita o recebimento. Escrito como
 * texto, cada citação obriga a pessoa a decorar o código, abrir outro módulo
 * e procurar de novo — trabalho que o sistema já tinha feito e jogou fora.
 *
 * Duas regras que não mudam:
 *
 * 1. **Destino por identidade.** O link leva ao `id` do registro citado,
 *    nunca a uma busca textual pelo código. Busca por texto pode trazer
 *    homônimo, pode trazer nada, e depende do índice de busca do momento.
 * 2. **Sem id, sem link.** Referência histórica que guardou só o texto (dado
 *    legado, snapshot congelado) continua texto. Inventar destino provável
 *    seria pior que não navegar: leva ao registro errado com cara de certo.
 *
 * O `id` nunca aparece na tela — quem lê vê `PROD-000012`, o UUID fica no
 * endereço.
 */

export type EntityKind =
  | "product"
  | "item"
  | "customer"
  | "supplier"
  | "project"
  | "sample"
  | "lot"
  | "purchaseOrder"
  | "receipt"
  | "productionOrder"
  | "customerOrder"
  | "shipment"
  | "billing"
  | "formulation"
  | "costCalculation"
  | "industrialResource";

/**
 * Cadastro simples mora numa lista com modal, não em página própria: o link
 * reduz a lista ao registro (`ids`/`productId`) e abre o modal (`open`).
 * Documento transacional tem página própria e vai direto nela.
 */
export function entityHref(kind: EntityKind, id: string): string {
  switch (kind) {
    case "product":
      return `/cadastros/produtos?productId=${id}&open=${id}`;
    case "item":
      return `/cadastros/itens?ids=${id}&open=${id}`;
    case "customer":
      return `/cadastros/clientes?ids=${id}&open=${id}`;
    case "supplier":
      return `/cadastros/fornecedores?ids=${id}&open=${id}`;
    case "project":
      return `/comercial/projetos/${id}`;
    case "sample":
      return `/comercial/amostras/${id}`;
    case "lot":
      return `/estoque/lotes/${id}`;
    case "purchaseOrder":
      return `/compras/ordens/${id}`;
    case "receipt":
      return `/compras/recebimentos/${id}`;
    case "productionOrder":
      return `/producao/ordens/${id}`;
    case "customerOrder":
      return `/comercial/pedidos/${id}`;
    case "shipment":
      return `/comercial/expedicoes/${id}`;
    case "billing":
      return `/comercial/faturamento/${id}`;
    // A formulação é uma tela do produto, endereçada pelo produto.
    case "formulation":
      return `/producao/formulacoes/${id}`;
    case "costCalculation":
      return `/calculos-custo/${id}`;
    case "industrialResource":
      return `/gestao/recursos-industriais/${id}`;
  }
}

const KIND_LABEL: Record<EntityKind, string> = {
  product: "produto",
  item: "item",
  customer: "cliente",
  supplier: "fornecedor",
  project: "projeto",
  sample: "amostra",
  lot: "lote",
  purchaseOrder: "ordem de compra",
  receipt: "recebimento",
  productionOrder: "ordem de produção",
  customerOrder: "pedido",
  shipment: "expedição",
  billing: "faturamento",
  formulation: "formulação",
  costCalculation: "cálculo de custo",
  industrialResource: "recurso industrial",
};

interface EntityLinkProps {
  kind: EntityKind;
  /** Sem id o componente devolve texto simples — nunca um link que chuta. */
  id: string | null | undefined;
  /** Código interno, o que a pessoa lê e reconhece. */
  code: string | null | undefined;
  /** Descrição ao lado do código, quando a tela já a mostrava. */
  name?: string | null;
  /** `code` some e fica só o nome — para colunas que já têm o código ao lado. */
  hideCode?: boolean;
}

export function EntityLink({ kind, id, code, name, hideCode = false }: EntityLinkProps) {
  const label = hideCode ? (name ?? code ?? "") : [code, name].filter(Boolean).join(" ");

  if (!label) return <span className="muted">—</span>;
  if (!id) return <>{label}</>;

  return (
    <Link
      className="entity-link"
      to={entityHref(kind, id)}
      title={`Abrir ${KIND_LABEL[kind]}`}
      // Linha de tabela costuma ser clicável inteira. Sem isto o clique no
      // link sobe para a linha e a navegação da linha vence — a pessoa mira
      // o produto e cai na formulação.
      onClick={(event) => event.stopPropagation()}
    >
      {label}
    </Link>
  );
}
