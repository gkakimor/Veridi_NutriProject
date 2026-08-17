import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Seleção de linhas de tabela.
 *
 * Regra do produto: checkbox significa "posso agir sobre estes registros".
 * Onde não existe ação útil, a coluna não aparece — caixa decorativa ensina o
 * usuário a ignorar caixas.
 *
 * A seleção é da PÁGINA ATUAL. O cabeçalho marca o que está à vista e nada
 * mais: dizer "8 selecionados" quando a pessoa já não consegue ver quais seria
 * mentira útil para ninguém. Trocar filtro limpa a seleção pelo mesmo motivo.
 */
export function useTableSelection<T extends { id: string }>(rows: T[], resetKey: unknown) {
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    setSelected([]);
  }, [resetKey]);

  const pageIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const selectedOnPage = useMemo(
    () => selected.filter((id) => pageIds.includes(id)),
    [selected, pageIds],
  );

  const toggle = useCallback((id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    );
  }, []);

  const togglePage = useCallback(() => {
    setSelected((current) => {
      const allSelected = pageIds.length > 0 && pageIds.every((id) => current.includes(id));
      return allSelected ? current.filter((id) => !pageIds.includes(id)) : [...new Set([...current, ...pageIds])];
    });
  }, [pageIds]);

  const clear = useCallback(() => setSelected([]), []);

  return {
    selected: selectedOnPage,
    count: selectedOnPage.length,
    isSelected: (id: string) => selected.includes(id),
    allOnPageSelected: pageIds.length > 0 && pageIds.every((id) => selected.includes(id)),
    toggle,
    togglePage,
    clear,
  };
}

export function SelectionHeaderCell({
  checked,
  onToggle,
  label = "Selecionar todos desta página",
}: {
  checked: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <th className="table__select">
      <input type="checkbox" aria-label={label} checked={checked} onChange={onToggle} />
    </th>
  );
}

export function SelectionCell({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <td className="table__select" onClick={(event) => event.stopPropagation()}>
      <input
        type="checkbox"
        aria-label={`Selecionar ${label}`}
        checked={checked}
        onChange={onToggle}
      />
    </td>
  );
}

/** Barra que só existe quando há seleção — com o que dá para fazer com ela. */
export function SelectionBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children?: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="selection-bar">
      <span>
        <b>{count}</b> {count === 1 ? "selecionado nesta página" : "selecionados nesta página"}
      </span>
      {children}
      <button type="button" className="btn btn--ghost btn--sm" onClick={onClear}>
        Limpar seleção
      </button>
    </div>
  );
}
