import { InfoHint } from "../../components/help";
import { helpHints } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

/** ⓘ de um conceito da bancada — o texto vive no registro central de ajuda. */
export function Dica({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}
