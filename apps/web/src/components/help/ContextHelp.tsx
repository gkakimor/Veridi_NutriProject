import { useId, useRef, useState } from "react";
import { ModalDialog } from "../ModalDialog";
import { FlowSteps } from "./FlowSteps";
import type { HelpTopic } from "../../help/help-content";

/**
 * Ajuda da tela — o que ela faz, por quais caminhos, e o que costuma pegar.
 *
 * É um MODAL, não um painel embutido: a explicação de uma tela inteira é
 * longa, e aberta no meio do conteúdo empurrava a operação para debaixo da
 * dobra. Em modal ela ocupa o espaço que precisa, é lida, e a tela volta
 * exatamente como estava.
 *
 * Nasce fechado e nunca abre sozinho — quem usa a tela todo dia não quer ser
 * interrompido. A casca (foco preso, Escape, retorno de foco) vem do
 * `ModalDialog` já usado nas confirmações; aqui não se reimplementa nada
 * disso.
 *
 * Todo o texto vem de `help/help-content`, nunca escrito na tela.
 */
export function ContextHelp({
  topic,
  triggerLabel = "Como funciona",
}: {
  topic: HelpTopic;
  /** Só troque quando "Como funciona" não descrever o conteúdo. */
  triggerLabel?: string;
}) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  /** Etapa em destaque, por fluxo. Nasce sem seleção: nada grita antes de ler. */
  const [selecionada, setSelecionada] = useState<Record<string, number>>({});
  const trigger = useRef<HTMLButtonElement>(null);
  /**
   * Os itens do passo a passo, por fluxo e posição. Clicar numa caixa
   * destaca um texto que pode estar fora da vista — o modal rola. Sem
   * trazer o item destacado para a tela, o clique parece não ter efeito.
   */
  const passos = useRef(new Map<string, HTMLLIElement | null>());

  /*
   * Duas formas para a mesma coisa: `flows` nomeia cada caminho, `flow` é a
   * forma curta de quem só tem um. A tela não precisa saber a diferença.
   */
  const flows =
    topic.flows ?? (topic.flow ? [{ name: "Fluxo da tela", steps: topic.flow }] : []);

  function fechar() {
    setOpen(false);
    // O foco volta para onde estava: quem leu a ajuda continua de onde parou.
    trigger.current?.focus();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="btn btn--ghost btn--sm context-help__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true" className="context-help__icon">
          ⓘ
        </span>
        {triggerLabel}
      </button>

      {open && (
        <ModalDialog labelledBy={titleId} onClose={fechar}>
          <div className="help-modal">
            <h2 id={titleId} className="help-modal__title">
              {topic.title}
            </h2>
            <p className="help-modal__summary">{topic.summary}</p>

            {/*
              O vocabulário da tela vem antes do caminho: quem não sabe o que
              é "versão ativa" não aproveita um fluxo que começa por ela.
            */}
            {topic.concepts && topic.concepts.length > 0 && (
              <>
                <h3 className="help-modal__subtitle">Nesta tela</h3>
                <dl className="help-modal__concepts">
                  {topic.concepts.map((concept) => (
                    <div key={concept.term}>
                      <dt>{concept.term}</dt>
                      <dd>{concept.text}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}

            {/*
              Vários caminhos = a tela é usada de mais de um jeito. Cada um
              recebe nome e a condição em que vale, porque "qual dos dois é o
              meu caso?" é a pergunta que vem antes de qualquer etapa.
            */}
            {flows.map((flow) => (
              <section key={flow.name} className="help-modal__flow">
                {flows.length > 1 && (
                  <h3 className="help-modal__flow-name">{flow.name}</h3>
                )}
                {flow.when && <p className="help-modal__flow-when">{flow.when}</p>}
                <FlowSteps
                  steps={flow.steps}
                  label={`Fluxo: ${flow.name}`}
                  {...(selecionada[flow.name] !== undefined
                    ? { selected: selecionada[flow.name] }
                    : {})}
                  onSelect={(index) => {
                    setSelecionada((atual) => ({
                      ...atual,
                      // Clicar de novo na mesma caixa tira o destaque: a
                      // pessoa volta a ler o texto inteiro sem nada em peso.
                      [flow.name]: atual[flow.name] === index ? -1 : index,
                    }));
                    // `nearest`: rola o mínimo para o item aparecer, sem
                    // jogar as caixas do fluxo para fora da tela — é a
                    // correspondência entre as duas coisas que importa.
                    passos.current
                      .get(`${flow.name}:${index}`)
                      ?.scrollIntoView?.({ block: "nearest" });
                  }}
                />
                {/*
                  A MESMA lista, agora com a explicação de cada etapa — a
                  numeração casa com as caixas acima, e é por ela que a pessoa
                  liga o desenho ao texto. Some quando nenhuma etapa tem
                  detalhe: repetir os rótulos logo abaixo das caixas não
                  acrescenta nada.
                */}
                {flow.steps.some((step) => step.detail) && (
                <ol className="help-modal__steps">
                  {flow.steps.map((step, index) => (
                    <li
                      key={`${index}-${step.label}`}
                      ref={(node) => {
                        passos.current.set(`${flow.name}:${index}`, node);
                      }}
                      className={selecionada[flow.name] === index ? "is-selected" : undefined}
                    >
                      <b>{step.label}</b>
                      {step.detail && (
                        <span className="help-modal__step-detail">{step.detail}</span>
                      )}
                    </li>
                  ))}
                </ol>
                )}
              </section>
            ))}

            {topic.steps && topic.steps.length > 0 && (
              <>
                <h3 className="help-modal__subtitle">Passo a passo</h3>
                <ol className="help-modal__steps">
                  {topic.steps.map((step, index) => (
                    <li key={`${index}-${step.label}`}>
                      <b>{step.label}</b>
                      {step.detail && (
                        <span className="help-modal__step-detail">{step.detail}</span>
                      )}
                    </li>
                  ))}
                </ol>
              </>
            )}

            {topic.notes && topic.notes.length > 0 && (
              <>
                <h3 className="help-modal__subtitle">O que costuma pegar</h3>
                <ul className="help-modal__notes">
                  {topic.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </>
            )}

            {topic.doc && (
              <a
                className="help-modal__doc"
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

            <div className="help-modal__actions">
              <button type="button" className="btn btn--secondary" onClick={fechar}>
                Fechar
              </button>
            </div>
          </div>
        </ModalDialog>
      )}
    </>
  );
}
