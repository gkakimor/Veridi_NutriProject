import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type {
  ItemDTO,
  StockCountHeldPositionDTO,
  StockCountMode,
  StockCountPreviewPositionDTO,
} from "@veridi/shared";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { apiErrorMessage } from "../../lib/api-errors";
import { listItems } from "../../lib/items-api";
import { previewStockCount } from "../../lib/stock-counts-api";

/**
 * Seletores do Inventário Físico — INVENTORY-PHYSICAL-COUNT-01, Fatia 2A.
 *
 * Escolher item e lote dentro do inventário não pode mostrar saldo numa
 * contagem cega. A lista de lotes do estoque (`GET /lots`) traz saldo em toda
 * linha; por isso os lotes de um item saem da PRÉVIA do inventário, no modo da
 * contagem — que numa contagem cega o servidor devolve sem saldo nenhum, e que
 * ainda diz quais lotes já estão em outro inventário aberto.
 */

const PAGINA = 50;

/**
 * Uma caixa ou um botão de opção numa linha inteira clicável (`.selection-row--plain`).
 * Dentro de `.field`, `<input>` cru herda a largura de campo de texto.
 */
export function LinhaDeMarcacao({
  tipo,
  nome,
  valor,
  marcado,
  desabilitado = false,
  aoMudar,
  children,
}: {
  tipo: "checkbox" | "radio";
  nome?: string;
  valor?: string;
  marcado: boolean;
  desabilitado?: boolean;
  aoMudar: () => void;
  children: ReactNode;
}) {
  const classes = ["selection-row", "selection-row--plain"];
  if (marcado) classes.push("selection-row--selected");
  if (desabilitado) classes.push("selection-row--disabled");
  return (
    <div className={classes.join(" ")}>
      <label className="selection-row__label selection-row__label--full">
        <input type={tipo} name={nome} value={valor} checked={marcado} disabled={desabilitado} onChange={aoMudar} />
        <span>{children}</span>
      </label>
    </div>
  );
}

function opcaoDoItem(item: ItemDTO): EntityOption {
  return { id: item.id, code: item.code, name: item.name, hint: item.unitCode };
}

/** Catálogo de itens com busca no servidor; guarda o item inteiro para saber se ele controla lote. */
export function useCatalogoDeItens() {
  const [itens, setItens] = useState<ItemDTO[]>([]);

  const juntar = useCallback((novos: ItemDTO[]) => {
    setItens((atuais) => {
      const conhecidos = new Set(atuais.map((item) => item.id));
      const faltam = novos.filter((item) => !conhecidos.has(item.id));
      return faltam.length === 0 ? atuais : [...atuais, ...faltam];
    });
  }, []);

  useEffect(() => {
    let vivo = true;
    listItems({ active: true, pageSize: PAGINA })
      .then((resposta) => {
        if (vivo) juntar(resposta.items);
      })
      .catch(() => {
        // Sem a primeira página a busca continua funcionando.
      });
    return () => {
      vivo = false;
    };
  }, [juntar]);

  const buscar = useCallback(
    async (termo: string): Promise<EntityOption[]> => {
      const resposta = await listItems({ search: termo, pageSize: PAGINA });
      juntar(resposta.items);
      return resposta.items.map(opcaoDoItem);
    },
    [juntar],
  );

  return { itens, opcoes: itens.map(opcaoDoItem), buscar };
}

export function SeletorDeItem({
  id,
  valor,
  aoEscolher,
  catalogo,
}: {
  id: string;
  valor: string;
  aoEscolher: (item: ItemDTO | null) => void;
  catalogo: ReturnType<typeof useCatalogoDeItens>;
}) {
  return (
    <SearchableEntitySelect
      id={id}
      value={valor}
      options={catalogo.opcoes}
      onSearch={catalogo.buscar}
      placeholder="Digite código ou nome do item…"
      onChange={(escolhido) => aoEscolher(catalogo.itens.find((item) => item.id === escolhido) ?? null)}
    />
  );
}

export interface PosicoesDoItem {
  carregando: boolean;
  erro: string | null;
  posicoes: StockCountPreviewPositionDTO[];
  retidas: StockCountHeldPositionDTO[];
}

/**
 * As posições de um item — o item sem lote é uma; o item com lote, uma por
 * lote, com ou sem saldo — lidas pela prévia no modo da contagem.
 */
export function usePosicoesDoItem(itemId: string | null, modo: StockCountMode): PosicoesDoItem {
  const [estado, setEstado] = useState<PosicoesDoItem & { chave: string }>({
    chave: "",
    carregando: false,
    erro: null,
    posicoes: [],
    retidas: [],
  });
  const chave = itemId ? `${itemId}:${modo}` : "";

  useEffect(() => {
    if (!itemId) return;
    let vivo = true;
    setEstado({ chave, carregando: true, erro: null, posicoes: [], retidas: [] });
    previewStockCount({ mode: modo, scope: { balance: "ANY", itemIds: [itemId] } })
      .then((previa) => {
        if (vivo) {
          setEstado({ chave, carregando: false, erro: null, posicoes: previa.positions, retidas: previa.heldByOpenCounts });
        }
      })
      .catch((erro: unknown) => {
        if (vivo) {
          setEstado({
            chave,
            carregando: false,
            erro: apiErrorMessage(erro, "Falha ao carregar os lotes do item"),
            posicoes: [],
            retidas: [],
          });
        }
      });
    return () => {
      vivo = false;
    };
  }, [itemId, modo, chave]);

  if (!itemId) return { carregando: false, erro: null, posicoes: [], retidas: [] };
  if (estado.chave !== chave) return { carregando: true, erro: null, posicoes: [], retidas: [] };
  return estado;
}
