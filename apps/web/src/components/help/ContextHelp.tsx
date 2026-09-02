import { useId, useRef, useState } from "react";
import { FlowSteps } from "./FlowSteps";
import type { HelpTopic } from "../../help/help-content";

/**
 * Painel "Como funciona" — a explicação longa de uma regra de negócio.
 *
 * Nasce FECHADO e não abre sozinho: quem já conhece a regra usa a tela todo
 * dia, e um painel que se abre por conta própria empurra o trabalho para
 * baixo da dobra sem ninguém ter pedido. Não é modal — não rouba o foco nem
 * inertiza o fundo: a pessoa lê a explicação enquanto olha os dados.
 *
 * O conteúdo vem de `help/help-content.ts`, nunca escrito na tela.
 */
export function ContextHelp({
  topic,
  triggerLabel = "Como funciona",
}: {
  topic: HelpTopic;
  /** Só troque quando "Como funciona" não descrever o painel. */
  triggerLabel?: string;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <section
      className="context-help"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        // Não deixa o Escape subir: dentro de um modal, fechar a ajuda não
        // pode fechar o formulário junto.
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="btn btn--ghost btn--sm context-help__trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((atual) => !atual)}
      >
        <span aria-hidden="true" className="context-help__caret" />
        {triggerLabel}
      </button>

      {open && (
        <div id={panelId} className="context-help__panel">
          <h3 className="context-help__title">{topic.title}</h3>
          <p className="context-help__summary">{topic.summary}</p>

          {topic.flow && topic.flow.length > 0 && (
            <FlowSteps steps={topic.flow} label={`Fluxo: ${topic.title}`} />
          )}

          <ol className="context-help__steps">
            {topic.steps.map((step, index) => (
              <li key={`${index}-${step.label}`}>
                <b>{step.label}</b>
                {step.detail && <span className="context-help__step-detail">{step.detail}</span>}
              </li>
            ))}
          </ol>

          {topic.notes && topic.notes.length > 0 && (
            <>
              <h4 className="context-help__subtitle">Observações</h4>
              <ul className="context-help__notes">
                {topic.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </>
          )}

          {topic.doc && (
            <a
              className="context-help__doc"
              href={topic.doc.href}
              // Documentação externa abre fora: sair do ERP no meio de um
              // pedido custa o formulário em andamento.
              {...(/^https?:/i.test(topic.doc.href)
                ? { target: "_blank", rel: "noreferrer" }
                : {})}
            >
              {topic.doc.label}
            </a>
          )}
        </div>
      )}
    </section>
  );
}
