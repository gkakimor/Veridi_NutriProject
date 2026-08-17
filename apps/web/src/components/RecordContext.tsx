import { useCallback, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

/**
 * Chegada por link contextual numa lista de cadastro.
 *
 * Cadastro simples não tem página própria: mora numa lista com modal. Quando
 * outra tela cita o registro (`EntityLink`), o link precisa entregar o
 * registro — não a lista inteira com a pessoa procurando de novo. Daí dois
 * parâmetros:
 *
 * - `ids` reduz a lista ao registro citado (identidade, nunca busca textual);
 * - `open` abre o modal daquele registro.
 *
 * Os dois são independentes de propósito: `ids` sozinho serve à exportação da
 * seleção, que precisa reduzir sem abrir nada.
 */
export function useRecordContext(listPath: string) {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const idsParam = params.get("ids");
  const contextIds = idsParam ? idsParam.split(",").filter(Boolean) : null;
  const openId = params.get("open");

  const clear = useCallback(() => navigate(listPath), [navigate, listPath]);

  return { contextIds, openId, clear, contextKey: idsParam ?? "" };
}

/**
 * Abre o registro apontado por `open` assim que ele aparece na lista.
 *
 * Roda uma vez por id: reabrir sozinho depois que a pessoa fechou o modal
 * seria prender ela na tela.
 */
export function useOpenRecord<T extends { id: string }>(
  openId: string | null,
  records: T[],
  open: (record: T) => void,
): void {
  const openedId = useRef<string | null>(null);
  useEffect(() => {
    if (!openId) return;
    const target = records.find((record) => record.id === openId);
    if (!target || openedId.current === openId) return;
    openedId.current = openId;
    open(target);
    // `open` muda a cada render nas telas que usam setState inline; incluir
    // na dependência reabriria o modal em loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, records]);
}

/**
 * Aviso de que a lista está reduzida — com a saída ao lado.
 *
 * Sem isso a tela mente: mostra uma linha e parece que o cadastro tem uma
 * linha só.
 */
export function RecordContextChip({
  noun,
  code,
  name,
  onClear,
}: {
  noun: string;
  code?: string | null | undefined;
  name?: string | null | undefined;
  onClear: () => void;
}) {
  return (
    <p className="context-chip">
      Mostrando apenas {noun} <span className="code">{code ?? "selecionado"}</span>
      {name ? ` · ${name}` : ""}{" "}
      <button type="button" className="btn btn--ghost btn--sm" onClick={onClear}>
        Limpar filtros
      </button>
    </p>
  );
}
