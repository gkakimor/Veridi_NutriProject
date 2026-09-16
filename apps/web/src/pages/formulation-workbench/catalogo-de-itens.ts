import { useCallback, useEffect, useState } from "react";
import type { ItemDTO, ItemFamily, ItemType, PackagingSubtype, SecaoDaFormula } from "@veridi/shared";
import { listItems } from "../../lib/items-api";
import type { EntityOption } from "../../components/SearchableEntitySelect";

/**
 * O CATÁLOGO DA BANCADA — o que a coluna Item oferece nas duas telas.
 *
 * A Formulação e o Modelo compõem a mesma receita com o mesmo estoque, e o
 * seletor precisa saber as mesmas coisas: a primeira página, a busca no
 * servidor, a mesclagem do que a busca trouxe, o item que a linha já referencia
 * mas não está na página, o rótulo de inativo e a unidade de estoque. Enquanto
 * cada tela tinha o seu, o Modelo abria a lista inteira sem filtro de tipo —
 * e o item encontrado na busca voltava sem dimensão para a coluna de unidade.
 */
export interface ItemDaBancada {
  id: string;
  code: string;
  name: string;
  type: ItemType;
  unitCode: string;
  unitDimension: string;
  active: boolean;
  /** Dados técnicos do cadastro — a linha nova nasce com eles preenchidos. */
  sourceName: string | null;
  declaredNutrient: string | null;
  family: ItemFamily | null;
  packagingSubtype: PackagingSubtype | null;
  defaultPurityPercent: string | null;
  externalCode: string | null;
}

/**
 * Primeira página do catálogo — o que a lista mostra antes de digitar.
 *
 * Era 1000 por tipo, e o catálogo tem 1.211 matérias-primas ativas: 211
 * existiam e não apareciam na busca, sem aviso. Quem digita agora pergunta
 * ao servidor (`buscar`), que conhece o catálogo inteiro.
 */
export const PRIMEIRA_PAGINA = 50;

/** Uma conversão só de item do catálogo para opção da tela. */
export function itemDaBancada(item: ItemDTO): ItemDaBancada {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    type: item.type,
    unitCode: item.unitCode,
    unitDimension: item.unit.dimension,
    active: item.active,
    sourceName: item.sourceName,
    declaredNutrient: item.declaredNutrient,
    family: item.family,
    packagingSubtype: item.packagingSubtype,
    defaultPurityPercent: item.defaultPurityPercent,
    externalCode: item.externalCode,
  };
}

/** Um formato só de rótulo: o da lista inicial e o da busca não podem divergir. */
export function opcaoDoItem(item: ItemDaBancada): EntityOption {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    ...(item.active ? {} : { hint: "inativo" }),
  };
}

/** A seção decide o TIPO: composição é matéria-prima, embalagem é embalagem. */
export function tipoDaSecao(secao: SecaoDaFormula): ItemType {
  return secao === "EMBALAGEM" ? "PACKAGING" : "RAW_MATERIAL";
}

/**
 * O catálogo da tela: primeira página, busca no servidor e mesclagem.
 *
 * O achado da busca ENTRA no catálogo porque a escolha é resolvida por ele: a
 * linha lê código, nome, unidade de estoque e pureza padrão daqui, e a coluna
 * de unidade limita as opções pela dimensão do item. Sem a mesclagem, escolher
 * um item de fora da primeira página deixaria a linha sem unidade.
 */
export function useCatalogoDeItens() {
  const [itens, setItens] = useState<ItemDaBancada[]>([]);

  useEffect(() => {
    Promise.all([
      listItems({ type: "RAW_MATERIAL", active: true, pageSize: PRIMEIRA_PAGINA }),
      listItems({ type: "PACKAGING", active: true, pageSize: PRIMEIRA_PAGINA }),
    ])
      .then(([raw, packaging]) =>
        setItens([...raw.items, ...packaging.items].map(itemDaBancada)),
      )
      .catch(() => setItens([]));
  }, []);

  const mesclar = useCallback((encontrados: ItemDaBancada[]) => {
    setItens((atual) => {
      const conhecidos = new Set(atual.map((item) => item.id));
      const ineditos = encontrados.filter((item) => !conhecidos.has(item.id));
      return ineditos.length === 0 ? atual : [...atual, ...ineditos];
    });
  }, []);

  /** Um item recém-criado entra na frente, substituindo o homônimo se houver. */
  const adicionar = useCallback((item: ItemDaBancada) => {
    setItens((atual) => [item, ...atual.filter((row) => row.id !== item.id)]);
  }, []);

  /**
   * Busca no servidor, com os MESMOS filtros de negócio da carga inicial: só o
   * tipo da seção e só ativos. Componente encontrado é componente que já era
   * elegível; nada passa a ser escolhível por causa da busca.
   */
  const buscar = useCallback(
    async (secao: SecaoDaFormula, termo: string): Promise<ItemDaBancada[]> => {
      const resposta = await listItems({
        type: tipoDaSecao(secao),
        active: true,
        search: termo,
        pageSize: PRIMEIRA_PAGINA,
      });
      const encontrados = resposta.items.map(itemDaBancada);
      mesclar(encontrados);
      return encontrados;
    },
    [mesclar],
  );

  return { itens, buscar, mesclar, adicionar };
}
