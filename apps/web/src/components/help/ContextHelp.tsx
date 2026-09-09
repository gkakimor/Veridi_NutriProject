import { useId, useRef, useState } from "react";
import { ModalDialog } from "../ModalDialog";
import { HelpTopicV1View } from "./HelpTopicV1View";
import { HelpTopicV2View } from "./HelpTopicV2View";
import { isHelpTopicV2 } from "../../help/help-content";
import type { AnyHelpTopic } from "../../help/help-content";

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
 *
 * O painel lê os DOIS modelos de conteúdo. O V2 traz os três níveis, com o
 * nível 1 no topo e a consulta recolhida; o V1 é o formato original — resumo,
 * glossário, fluxo e ressalvas — e continua renderizando enquanto os tópicos
 * são migrados um a um. A tela não sabe a diferença.
 */
export function ContextHelp({
  topic,
  triggerLabel = "Como funciona",
}: {
  topic: AnyHelpTopic;
  /** Só troque quando "Como funciona" não descrever o conteúdo. */
  triggerLabel?: string;
}) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

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
        <ModalDialog labelledBy={titleId} onClose={fechar} role="dialog" dismissOnBackdrop>
          <div className="help-modal">
            <h2 id={titleId} className="help-modal__title">
              {topic.title}
            </h2>

            {isHelpTopicV2(topic) ? (
              <HelpTopicV2View topic={topic} onNavegar={fechar} />
            ) : (
              <HelpTopicV1View topic={topic} />
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
