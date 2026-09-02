import type { HelpStep } from "../../help/help-content";

/**
 * Fluxo curto em uma linha — `Pedido → Estoque → Falta → Produção/Compra`.
 *
 * Só HTML e CSS com tokens: imagem, canvas ou biblioteca de diagrama
 * deixariam de responder ao tema, não seriam lidos por leitor de tela e
 * ainda precisariam ser regerados a cada mudança de regra. Aqui o desenho é
 * a própria lista ordenada — a ordem é semântica, não decoração.
 *
 * As setas entre as caixas são pseudo-elementos SEM conteúdo textual
 * (chevron desenhado com borda): não entram no texto lido em voz alta nem no
 * `textContent`, porque `<ol>` já carrega a ordem.
 */
export function FlowSteps({
  steps,
  /** Nome acessível da lista — diga de QUAL fluxo se trata quando houver mais de um. */
  label = "Etapas do fluxo",
}: {
  steps: HelpStep[];
  label?: string;
}) {
  if (steps.length === 0) return null;

  return (
    <ol className="help-flow" aria-label={label}>
      {steps.map((step, index) => (
        <li key={`${index}-${step.label}`} className="help-flow__step">
          <span className={`help-flow__box help-flow__box--${step.tone ?? "neutral"}`}>
            <span className="help-flow__label">{step.label}</span>
            {step.detail && <span className="help-flow__detail">{step.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
