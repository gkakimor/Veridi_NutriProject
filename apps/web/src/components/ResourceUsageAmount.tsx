import type { IndustrialRateUom, IndustrialResourceType } from "@veridi/shared";
import { INDUSTRIAL_RATE_UOM_LABELS, acceptsResourceCount } from "@veridi/shared";
import { lerInteiroOpcional, mensagemInteiroInvalido } from "../lib/integer-input";
import { formatQuantity } from "../lib/quantity";

/**
 * Quantidade de recursos equivalentes (§87) — como a tela lê e escreve.
 *
 * A conta é do servidor: o total chega pronto no DTO (`totalUsageQuantity`,
 * ou `quantity` na composição do cálculo). Aqui só se decide a LEITURA —
 * "2 × 2 hora" com o total ao lado —, para que "4 hora" deixe de esconder
 * quantas pessoas ou máquinas trabalharam.
 */

export const RESOURCE_COUNT_LABEL = "Quantidade de recursos";

const LIMITES = { minimo: 1, maximo: null } as const;

interface UsoDeRecurso {
  /** Ausente em dado anterior ao campo — lê-se como 1. */
  resourceCount?: number | undefined;
  /** Uso POR recurso. */
  usageQuantity: string;
  /** Sem unidade quando a tabela já tem a coluna dela. */
  usageUom?: IndustrialRateUom | undefined;
}

function comUnidade(quantidade: string, unidade: IndustrialRateUom | undefined): string {
  const texto = formatQuantity(quantidade);
  return unidade ? `${texto} ${INDUSTRIAL_RATE_UOM_LABELS[unidade]}` : texto;
}

/** "2 × 2 hora" com mais de um recurso; "4 hora", como sempre foi, com um. */
export function descreverUsoDeRecurso(uso: UsoDeRecurso): string {
  const quantidade = comUnidade(uso.usageQuantity, uso.usageUom);
  return (uso.resourceCount ?? 1) > 1 ? `${uso.resourceCount} × ${quantidade}` : quantidade;
}

/** "Total: 4 hora" — só com mais de um recurso, e sempre o total do servidor. */
export function descreverTotalDeUso(
  uso: UsoDeRecurso & { totalUsageQuantity?: string | null | undefined },
): string | null {
  if ((uso.resourceCount ?? 1) <= 1 || !uso.totalUsageQuantity) return null;
  return `Total: ${comUnidade(uso.totalUsageQuantity, uso.usageUom)}`;
}

export function ResourceUsageAmount(
  props: UsoDeRecurso & { totalUsageQuantity?: string | null | undefined },
) {
  const total = descreverTotalDeUso(props);
  return (
    <>
      {descreverUsoDeRecurso(props)}
      {total && <span className="field__hint"> {total}</span>}
    </>
  );
}

/**
 * Lê o campo antes de enviar: inteiro ≥ 1, sem vírgula, sinal ou expoente.
 * Vazio não vira 1 em silêncio — o que a pessoa apagou não é decisão dela.
 */
export function exigirQuantidadeDeRecursos(texto: string): number {
  const leitura = lerInteiroOpcional(texto);
  if (leitura.tipo !== "valido" || leitura.valor < LIMITES.minimo) {
    throw new Error(mensagemInteiroInvalido(RESOURCE_COUNT_LABEL, LIMITES));
  }
  return leitura.valor;
}

/**
 * Campo "Quantidade de recursos". Só existe para o que se conta — mão de obra
 * e equipamento; para energia não aparece, porque o kWh já é o total.
 */
export function ResourceCountField(props: {
  id: string;
  resourceType: IndustrialResourceType | null | undefined;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  if (!props.resourceType || !acceptsResourceCount(props.resourceType)) return null;
  const dica =
    props.resourceType === "LABOR"
      ? "Operadores equivalentes trabalhando ao mesmo tempo. O tempo ao lado é o de cada um."
      : "Equipamentos iguais funcionando ao mesmo tempo. O tempo ao lado é o de cada um, e a energia derivada conta todos.";
  return (
    <div className="field">
      <label htmlFor={props.id}>{RESOURCE_COUNT_LABEL}</label>
      <input
        id={props.id}
        type="text"
        inputMode="numeric"
        aria-describedby={`${props.id}-dica`}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <span id={`${props.id}-dica`} className="field__hint">
        {dica}
      </span>
    </div>
  );
}
