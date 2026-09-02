import type { ScopedList } from "./useScopedList";

/**
 * Contagem que fecha a tabela. Fica DENTRO de `.table-container`, como nas
 * listas operacionais — é a borda de baixo do quadro, não uma barra solta.
 */
export function ConsultationCount<T>({
  list,
  noun,
  pluralNoun,
}: {
  list: ScopedList<T>;
  noun: string;
  pluralNoun: string;
}) {
  return (
    <div className="table-foot">
      {list.total} {list.total === 1 ? noun : pluralNoun}
    </div>
  );
}

/** Paginação das listas da Consulta — mesmo desenho das listas operacionais. */
export function ConsultationPager<T>({ list }: { list: ScopedList<T> }) {
  return (
    <div className="pagination">
      <span>
        Página {list.page} de {list.totalPages}
      </span>
      <div className="table__actions">
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={list.page <= 1}
          onClick={() => list.setPage(list.page - 1)}
        >
          Anterior
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          disabled={list.page >= list.totalPages}
          onClick={() => list.setPage(list.page + 1)}
        >
          Próxima
        </button>
      </div>
    </div>
  );
}
