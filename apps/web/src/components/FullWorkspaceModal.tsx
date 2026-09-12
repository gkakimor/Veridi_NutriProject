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
 * O que continua clicável atrás de um modal de workspace.
 *
 * Decisão do PO: a navegação lateral é SAÍDA legítima de um cadastro em
 * andamento — o modal cobria o workspace e deixava a sidebar inerte, então
 * quem abriu "Novo projeto" e quis ir para Pedidos não tinha como, e fechar o
 * modal era o único caminho. Sair dali agora passa pela guarda de alterações
 * não salvas, que pergunta quando há o que perder.
 *
 * O masthead continua protegido por inteiro: a busca global do topo não é
 * saída de navegação, é outra ação, e disparar uma consulta de lote por baixo
 * de um cadastro aberto não ajuda ninguém.
 *
 * Os dois fundos acompanham a sidebar porque são o jeito de FECHAR o que ela
 * abriu — o drawer do celular e a espiada do trilho compacto. Inertes, o menu
 * abriria e não teria como sair dele a não ser navegando.
 */
const SAIDAS_DE_NAVEGACAO = "#sidebar, .sidebar-backdrop, .sidebar-peek-backdrop";

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
  useInertBackground(true, dialog, SAIDAS_DE_NAVEGACAO);

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
