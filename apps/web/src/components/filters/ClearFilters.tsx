/**
 * "Limpar filtros" — a saída de qualquer lista filtrada.
 *
 * Existe como componente porque não é um botão: é a garantia de que nenhuma
 * tela deixa alguém preso num recorte que ele não sabe desfazer. Toda
 * listagem usa o mesmo texto, no mesmo peso visual, e o vazio filtrado repete
 * este mesmo botão dentro da tabela.
 */
export function ClearFilters({
  onClear,
  label = "Limpar filtros",
}: {
  onClear: () => void;
  label?: string;
}) {
  return (
    <button type="button" className="btn btn--ghost btn--sm" onClick={onClear}>
      {label}
    </button>
  );
}
