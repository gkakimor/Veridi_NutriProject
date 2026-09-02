import type { HelpStep } from "../../help/help-content";

/**
 * Fluxo da tela em caixas numeradas — `1 Pedido → 2 Estoque → 3 Falta`.
 *
 * O número é o que amarra o desenho ao texto: a mesma etapa aparece como
 * caixa aqui e como item numerado no passo a passo logo abaixo, com o mesmo
 * número. Sem isso, quem lê a explicação precisa adivinhar de qual caixa ela
 * está falando.
 *
 * Só HTML e CSS com tokens: imagem, canvas ou biblioteca de diagrama
 * deixariam de responder ao tema, não seriam lidas por leitor de tela e
 * ainda precisariam ser regeradas a cada mudança de regra. O desenho é a
 * própria lista ordenada — a ordem é semântica, não decoração.
 *
 * As setas entre as caixas são pseudo-elementos SEM conteúdo textual: não
 * entram no texto lido em voz alta nem no `textContent`, porque o `<ol>` já
 * carrega a ordem.
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
            {/* O número é decorativo para quem ouve: o `<ol>` já anuncia a
                posição, e repeti-la faria o leitor dizer "1. 1. Pedido". */}
            <span className="help-flow__number" aria-hidden="true">
              {index + 1}
            </span>
            {/* A caixa carrega só o rótulo: a explicação é o item de mesmo
                número no passo a passo, logo abaixo. */}
            <span className="help-flow__label">{step.label}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
