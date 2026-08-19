import type { FormulationTemplateDiffDTO } from "@veridi/shared";
import { TemplateDiffTable } from "../../components/TemplateDiffTable";

/**
 * Diff de template de formulação.
 *
 * A tabela é a mesma das outras duas bibliotecas — a pergunta "o que muda
 * nesta versão" não depende de qual matriz está sendo comparada.
 */
export function TemplateDiff({ diff }: { diff: FormulationTemplateDiffDTO }) {
  return <TemplateDiffTable diff={diff} />;
}
