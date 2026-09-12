/**
 * Um grupo de status como UMA escolha operacional.
 *
 * Existe por causa da fila do Picking/Consumo: "em aberto" não é um status do
 * domínio, são dois (`RELEASED` e `IN_PRODUCTION`), e é essa a pergunta que a
 * produção faz ao abrir a tela. A alternativa que estava no lugar era pedir
 * um status por vez e juntar as respostas no navegador — o que perde linhas
 * silenciosamente a partir do teto de página.
 *
 * Nenhum status novo é inventado: cada grupo é uma LISTA dos status que já
 * existem, e o valor que vai para a API é essa lista. Um grupo de um único
 * status é legítimo e é como "Liberada" e "Em produção" continuam
 * disponíveis sozinhas.
 *
 * Só o Picking usa isto nesta wave. As outras listagens têm um `<select>` de
 * status simples, e agrupar onde não há necessidade operacional só
 * acrescentaria um conceito a mais para aprender.
 */
export interface StatusGroup<T extends string> {
  /** Valor na URL — `em-aberto`, `liberada`. Estável e legível. */
  key: string;
  label: string;
  /** Os status do domínio que o grupo cobre. Vazio = sem filtro de status. */
  statuses: T[];
}

export function StatusGroupFilter<T extends string>({
  id,
  label,
  groups,
  value,
  onChange,
}: {
  id: string;
  /** Rótulo acessível — a barra de filtros não mostra rótulo visível. */
  label: string;
  groups: StatusGroup<T>[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {groups.map((group) => (
          <option key={group.key} value={group.key}>
            {group.label}
          </option>
        ))}
      </select>
    </>
  );
}

/** Os status que uma chave de grupo representa — `[]` quando não filtra. */
export function statusesOfGroup<T extends string>(
  groups: StatusGroup<T>[],
  key: string,
): T[] {
  return groups.find((group) => group.key === key)?.statuses ?? [];
}

/** O rótulo de uma chave de grupo — para o chip. */
export function labelOfGroup<T extends string>(groups: StatusGroup<T>[], key: string): string {
  return groups.find((group) => group.key === key)?.label ?? key;
}
