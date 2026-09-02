import { useEffect, useId, useRef } from "react";
import { useInertBackground } from "./useInertBackground";
import type { ReactNode } from "react";
import { CodeChip } from "./CodeChip";

interface FullWorkspaceModalProps {
  open: boolean;
  onClose: () => void;
  /** Trilha de navegacao, ex.: "Cadastros / Itens". O ultimo segmento vai em negrito. */
  crumb: string;
  crumbActive: string;
  title: ReactNode;
  codeChip?: string;
  footer: ReactNode;
  children: ReactNode;
  closeLabel?: string;
}

/**
 * Modais abertos, do fundo para o topo.
 *
 * Mora no módulo porque os dois modais empilhados não têm relação de props
 * entre si — o de dentro é aberto por um campo do de fora, e nenhum recebe o
 * outro. Sem uma lista compartilhada não há como saber quem está por cima.
 */
const pilha: object[] = [];

/**
 * Modal fullscreen dentro do workspace — padrao oficial de CRUD (Itens,
 * Fornecedores, Clientes, Produtos). Comeca abaixo da topbar, ocupa o
 * espaco do workspace, mantem topbar/sidebar visiveis, body rolavel,
 * footer fixo. Fecha com Escape ou pelo botao "Fechar".
 */
export function FullWorkspaceModal({
  open,
  onClose,
  crumb,
  crumbActive,
  title,
  codeChip,
  footer,
  children,
  closeLabel = "Fechar",
}: FullWorkspaceModalProps) {
  const dialog = useRef<HTMLDivElement>(null);
  /**
   * Identidade deste modal dentro da pilha.
   *
   * Cadastro dentro de cadastro é rotina agora: um campo de busca oferece
   * "+ Novo item de estoque" e abre o cadastro de Item por cima da relação
   * Item × Fornecedor. Com o listener de Escape no `document`, os DOIS
   * modais fechavam na mesma tecla — quem desistia do item perdia a relação
   * inteira junto, sem ter pedido.
   */
  const identidade = useRef({});
  /*
   * `id` fixo no título dava dois elementos com a mesma `id` quando um
   * cadastro abria por cima de outro, e o `aria-labelledby` do de cima
   * resolvia para o título do de baixo: quem usa leitor de tela abria
   * "Novo item de estoque" e ouvia "Nova relação Item × Fornecedor".
   */
  const tituloId = useId();

  // `aria-modal` sozinho não esconde a tela de trás de quem navega por
  // elementos: o fundo precisa ficar inerte de verdade.
  useInertBackground(true, dialog);

  useEffect(() => {
    if (!open) return;

    // Quem abriu o modal recebe o foco de volta ao fechar — sem isso, quem
    // usa só teclado sai do modal direto para o fim da página.
    const opener = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.offsetParent !== null);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        // Só o modal do topo responde. Um Escape fecha uma camada.
        if (pilha[pilha.length - 1] !== identidade.current) return;
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      // Foco preso no diálogo: Tab na tabela de fundo faria o usuário editar
      // um registro que não está mais visível.
      const elements = focusable();
      if (elements.length === 0) return;
      const first = elements[0]!;
      const last = elements[elements.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      if (!dialog.current?.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const initial = focusable()[0];
    (initial ?? dialog.current)?.focus();

    const eu = identidade.current;
    pilha.push(eu);

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      const posicao = pilha.lastIndexOf(eu);
      if (posicao !== -1) pilha.splice(posicao, 1);
      document.removeEventListener("keydown", handleKeyDown);
      // Só a última camada devolve a rolagem: um modal fechando por cima de
      // outro não pode destravar o fundo que o de baixo ainda esconde.
      if (pilha.length === 0) document.body.style.overflow = "";
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="modal-overlay" />
      <div
        className="modal-fullscreen"
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
      >
        <div className="modal-fullscreen__head">
          <div>
            <div className="modal-fullscreen__crumb">
              {crumb} / <b>{crumbActive}</b>
            </div>
            <div className="modal-fullscreen__title">
              <h2 id={tituloId}>{title}</h2>
              {codeChip && <CodeChip>{codeChip}</CodeChip>}
            </div>
          </div>
          {/*
              O ✕ e a palavra sempre foram um controle só, mas o aria-label
              trocava o nome acessível por outro texto: quem navega por voz
              dizia "Fechar" e nada acontecia, porque para a tecnologia
              assistiva o botão se chamava "Fechar sem salvar". O nome visível
              agora é o nome acessível, e o aviso vira title — informação, não
              substituição.
          */}
          <button
            type="button"
            className="modal-fullscreen__close"
            onClick={onClose}
            title="Fecha sem salvar as alterações"
          >
            <span aria-hidden="true">✕</span> {closeLabel}
          </button>
        </div>

        <div className="modal-fullscreen__body">
          <div className="modal-fullscreen__form-wrap">{children}</div>
        </div>

        <div className="modal-fullscreen__foot">{footer}</div>
      </div>
    </>
  );
}
