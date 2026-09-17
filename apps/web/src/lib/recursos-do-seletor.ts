import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IndustrialResourceDTO, IndustrialResourceType } from "@veridi/shared";
import { INDUSTRIAL_RESOURCE_TYPE_LABELS } from "@veridi/shared";
import type { EntityOption } from "../components/SearchableEntitySelect";
import { getIndustrialResource, listIndustrialResources } from "./industrial-resources-api";

/**
 * Recursos industriais dos seletores de formulário (SELECTOR-CUTOFF-WAVE-02).
 *
 * Substitui os 100 primeiros recursos num `<select>` — linha e energia do
 * Modelo de Estrutura de Custo, etapa do Roteiro de Produção — e a energia que
 * a Estrutura de Custos tirava da primeira página de 50. O servidor ordena por
 * tipo e depois por código, com energia por último: do recurso 101 em diante
 * ele existia e o campo não o oferecia, e a energia era a primeira a sumir.
 *
 * Três perguntas, como no `EntityFilterSelect`: a primeira página, curta e uma
 * vez por tela; a busca no servidor, com o MESMO recorte; e o recurso de um id
 * já escolhido que não veio em nenhuma das duas.
 */

/** Primeira página e tamanho de cada busca. */
export const PAGINA_DE_RECURSOS = 20;

/** O recorte de domínio do campo — o mesmo na primeira página e na busca. */
export interface RecorteDeRecursos {
  /** Tipos aceitos, na ordem da lista. Ausente: todos, na ordem do servidor. */
  tipos?: readonly IndustrialResourceType[];
  somenteAtivos: boolean;
}

async function pedir(recorte: RecorteDeRecursos, termo?: string): Promise<IndustrialResourceDTO[]> {
  const filtros = {
    ...(recorte.somenteAtivos ? { active: true } : {}),
    ...(termo ? { search: termo } : {}),
    pageSize: PAGINA_DE_RECURSOS,
  };
  if (!recorte.tipos) return (await listIndustrialResources(filtros)).resources;
  // Um tipo por pergunta: o servidor filtra um tipo só, e uma página única
  // com vários tipos deixaria de fora justamente o último da ordem.
  const paginas = await Promise.all(
    recorte.tipos.map((type) => listIndustrialResources({ ...filtros, type })),
  );
  return paginas.flatMap((pagina) => pagina.resources);
}

/** O que a opção mostra ao lado do nome: o tipo, quando o campo mistura tipos, e se está inativo. */
export function opcaoDeRecurso(
  recurso: Pick<IndustrialResourceDTO, "id" | "code" | "name" | "type"> & { active?: boolean },
  { comTipo }: { comTipo: boolean },
): EntityOption {
  const hint = [
    comTipo ? INDUSTRIAL_RESOURCE_TYPE_LABELS[recurso.type] : "",
    recurso.active === false ? "inativo" : "",
  ]
    .filter(Boolean)
    .join(", ");
  return { id: recurso.id, code: recurso.code, name: recurso.name, ...(hint ? { hint } : {}) };
}

/** Junta sem duplicar e sem trocar a referência à toa. */
function mesclar(atual: IndustrialResourceDTO[], novos: IndustrialResourceDTO[]): IndustrialResourceDTO[] {
  const conhecidos = new Set(atual.map((recurso) => recurso.id));
  const ineditos = novos.filter((recurso) => {
    if (conhecidos.has(recurso.id)) return false;
    conhecidos.add(recurso.id);
    return true;
  });
  return ineditos.length === 0 ? atual : [...atual, ...ineditos];
}

/**
 * O catálogo de um campo de recurso, sem teto que finja ser completo.
 *
 * - `catalogo`: primeira página + o que a busca achou — sempre dentro do
 *   recorte, e é dele que saem as opções oferecidas;
 * - `recurso(id)`: o recurso do catálogo OU de um id já escolhido que veio de
 *   fora (rascunho restaurado, cadastro no contexto), resolvido pelo id
 *   esteja dentro do recorte ou não — é valor escolhido, não oferta;
 * - `buscar`: pergunta ao servidor com o recorte e junta o achado ao catálogo.
 *
 * `recorte` precisa ser estável (constante de módulo). `carregar` diz quando o
 * campo existe na tela: nada é pedido antes disso. `escolhidos` são os ids que
 * a tela precisa nomear e não conhece por conta própria; cada um é perguntado
 * uma vez só, e só depois de a primeira página responder — antes disso o id
 * podia estar nela, e a pergunta seria repetida. `respondeu` separa "catálogo
 * vazio" de "catálogo ainda não chegou".
 */
export function useRecursosDoSeletor(
  recorte: RecorteDeRecursos,
  { carregar, escolhidos }: { carregar: boolean; escolhidos: readonly string[] },
): {
  catalogo: IndustrialResourceDTO[];
  recurso: (id: string) => IndustrialResourceDTO | undefined;
  buscar: (termo: string) => Promise<IndustrialResourceDTO[]>;
  /**
   * Recursos que a tela já tem INTEIROS — escolhidos na consulta assistida,
   * talvez da terceira página — passam a ser nomeados pelo id, sem perguntar
   * de novo ao servidor. São valor escolhido, não oferta: não entram no
   * catálogo do campo.
   */
  guardarEscolhidos: (recursos: readonly IndustrialResourceDTO[]) => void;
  respondeu: boolean;
} {
  const [catalogo, setCatalogo] = useState<IndustrialResourceDTO[]>([]);
  const [porId, setPorId] = useState<Record<string, IndustrialResourceDTO>>({});
  const [paginaRespondeu, setPaginaRespondeu] = useState(false);
  const paginaPedida = useRef(false);
  const idsPedidos = useRef(new Set<string>());

  useEffect(() => {
    if (!carregar || paginaPedida.current) return;
    paginaPedida.current = true;
    pedir(recorte)
      .then((pagina) => setCatalogo((atual) => mesclar(atual, pagina)))
      .catch(() => {
        // Catálogo indisponível: o campo continua aceitando busca.
      })
      .finally(() => setPaginaRespondeu(true));
  }, [carregar, recorte]);

  const chaveDosEscolhidos = escolhidos.filter(Boolean).join("|");
  useEffect(() => {
    if (!paginaRespondeu) return;
    for (const id of chaveDosEscolhidos.split("|")) {
      if (!id || idsPedidos.current.has(id) || porId[id]) continue;
      if (catalogo.some((recurso) => recurso.id === id)) continue;
      idsPedidos.current.add(id);
      getIndustrialResource(id)
        .then((achado) => setPorId((atual) => ({ ...atual, [id]: achado })))
        .catch(() => {
          // Recurso que não existe mais: a escolha segue, só o nome falta.
        });
    }
  }, [paginaRespondeu, chaveDosEscolhidos, catalogo, porId]);

  const buscar = useCallback(
    async (termo: string) => {
      const achados = await pedir(recorte, termo);
      setCatalogo((atual) => mesclar(atual, achados));
      return achados;
    },
    [recorte],
  );

  const guardarEscolhidos = useCallback((recursos: readonly IndustrialResourceDTO[]) => {
    if (recursos.length === 0) return;
    // Já conhecido pelo id não é perguntado depois de a primeira página responder.
    for (const achado of recursos) idsPedidos.current.add(achado.id);
    setPorId((atual) => {
      const proximo = { ...atual };
      for (const achado of recursos) proximo[achado.id] = achado;
      return proximo;
    });
  }, []);

  const recurso = useMemo(() => {
    const mapa = new Map<string, IndustrialResourceDTO>(Object.entries(porId));
    for (const item of catalogo) mapa.set(item.id, item);
    return (id: string) => mapa.get(id);
  }, [catalogo, porId]);

  return { catalogo, recurso, buscar, guardarEscolhidos, respondeu: paginaRespondeu };
}
