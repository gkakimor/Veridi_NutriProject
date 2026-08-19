import type { ReactNode } from "react";

/**
 * Uma linha de biblioteca é sempre a mesma pergunta: qual matriz é esta, em
 * que versão, e vale a pena abrir? As três bibliotecas respondem isso com as
 * mesmas peças, então a moldura é compartilhada e cada uma preenche as
 * colunas do seu domínio.
 */

export function LibraryStatus({
  archived,
  activeVersionNumber,
}: {
  archived: boolean;
  activeVersionNumber: number | null;
}) {
  if (archived) return <span className="badge badge--neutral">Arquivado</span>;
  if (activeVersionNumber !== null) {
    return <span className="badge badge--active">Ativa (V{activeVersionNumber})</span>;
  }
  return <span className="badge badge--warn">Rascunho, sem versão ativa</span>;
}

export function LibraryToolbar({
  id,
  label,
  placeholder,
  value,
  onChange,
  showArchived,
  onToggleArchived,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  showArchived: boolean;
  onToggleArchived: (value: boolean) => void;
}) {
  return (
    <div className="toolbar">
      <div className="toolbar__search">
        <label className="sr-only" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          type="search"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <label className="toolbar__checkbox">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(event) => onToggleArchived(event.target.checked)}
        />
        Mostrar arquivados
      </label>
    </div>
  );
}

export function LibraryPagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}): ReactNode {
  if (totalPages <= 1) return null;
  return (
    <div className="pagination">
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Anterior
      </button>
      <span className="field__hint">
        Página {page} de {totalPages}
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Próxima
      </button>
    </div>
  );
}
