import { useCallback, useEffect, useState } from "react";
import type { EntityOption } from "../SearchableEntitySelect";
import { SearchableEntitySelect } from "../SearchableEntitySelect";

/**
 * De onde saem as opções de um filtro por entidade.
 *
 * Três perguntas, porque o filtro faz três coisas diferentes: abrir sem
 * digitar, procurar, e dizer o nome de quem já está escolhido.
 */
export interface EntityFilterSource {
  /** A primeira página do catálogo — o que a lista mostra sem digitar nada. */
  inicial: () => Promise<EntityOption[]>;
  /** Busca no SERVIDOR, que conhece o catálogo inteiro. */
  buscar: (termo: string) => Promise<EntityOption[]>;
  /** O rótulo de UM id. Pode vir da URL, fora da primeira página. */
  porId: (id: string) => Promise<EntityOption | null>;
}

/**
 * Filtro por entidade de uma listagem — com busca no servidor.
 *
 * O padrão que isto substitui era `listX({ pageSize: 1000 })` num `<select>`
 * nativo: catálogo com teto fixo, apresentado como se fosse completo. Do
 * registro 1001 em diante a entidade existia no sistema e não existia no
 * filtro, sem aviso nenhum — e aumentar o teto para 10.000 só move a
 * fronteira, não a remove.
 *
 * A terceira função da `source` é o que faz este componente valer: um filtro
 * pode chegar pela URL (`?productId=…`) apontando para um registro que não
 * está na primeira página. Sem resolver esse id, o campo mostraria vazio —
 * ou o próprio UUID — enquanto a lista já estava filtrada por ele, e a
 * pessoa não teria como saber por que a tela está mostrando um recorte.
 */
export function EntityFilterSelect({
  id,
  value,
  onChange,
  source,
  placeholder,
  label,
}: {
  id: string;
  value: string;
  onChange: (id: string) => void;
  source: EntityFilterSource;
  placeholder: string;
  /** Rótulo acessível — a barra de filtros não mostra rótulo visível. */
  label: string;
}) {
  const [opcoes, setOpcoes] = useState<EntityOption[]>([]);

  const acumular = useCallback((novas: EntityOption[]) => {
    setOpcoes((atuais) => {
      const mapa = new Map(atuais.map((opcao) => [opcao.id, opcao]));
      for (const opcao of novas) mapa.set(opcao.id, opcao);
      return [...mapa.values()];
    });
  }, []);

  useEffect(() => {
    let vivo = true;
    source
      .inicial()
      .then((iniciais) => {
        if (vivo) acumular(iniciais);
      })
      .catch(() => {
        // Catálogo indisponível: o campo continua aceitando busca.
      });
    return () => {
      vivo = false;
    };
    // `source` é estável nos chamadores (literal de módulo ou `useMemo`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acumular]);

  /* O escolhido que não veio na primeira página — quase sempre da URL. */
  useEffect(() => {
    if (!value || opcoes.some((opcao) => opcao.id === value)) return;
    let vivo = true;
    source
      .porId(value)
      .then((opcao) => {
        if (vivo && opcao) acumular([opcao]);
      })
      .catch(() => {
        // Sem o rótulo o filtro continua valendo; só o nome fica ausente.
      });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, opcoes, acumular]);

  const buscar = useCallback(
    async (termo: string) => {
      const encontradas = await source.buscar(termo);
      acumular(encontradas);
      return encontradas;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [acumular],
  );

  return (
    <div className="toolbar__entity">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <SearchableEntitySelect
        id={id}
        options={opcoes}
        value={value}
        onChange={onChange}
        onSearch={buscar}
        placeholder={placeholder}
      />
    </div>
  );
}
