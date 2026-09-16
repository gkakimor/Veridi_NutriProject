import { Link } from "react-router-dom";
import type {
  CustomerOrderStatus,
  CustomerStatus,
  ProjectStatus,
  QuoteVersionDTO,
} from "@veridi/shared";
import { consultationPath } from "../customer-consultation/ConsultationShell";

/**
 * Aviso de situação cadastral no documento comercial em andamento —
 * CUSTOMER-STATUS-HARDENING-01, §95.
 *
 * O documento nasceu com o cliente ATIVO, e depois o cliente foi bloqueado ou
 * inativado. O documento não some nem muda — nada é cancelado por mudança de
 * situação —, mas quem o abre precisa saber, ANTES de tentar, que o próximo
 * passo comercial vai ser recusado.
 *
 * É aviso, não autoridade: quem recusa continua sendo a guarda de venda do
 * servidor, e nada aqui desabilita botão. A situação é a ATUAL, e vem na
 * própria leitura do documento (`customerStatus`): nada é gravado nele, e o
 * aviso some sozinho na leitura seguinte à reativação.
 *
 * Só aparece onde o documento ainda pode avançar por uma ação que a guarda
 * recusa (os predicados abaixo). Documento encerrado é histórico e não ganha
 * aviso.
 */

export type DocumentoComercial = "quote" | "order" | "project";

const DOCUMENTO: Record<DocumentoComercial, string> = {
  quote: "O orçamento",
  order: "O pedido",
  project: "O projeto",
};

/** O que a guarda recusa em cada documento — dito antes do clique, não depois. */
const PASSO_RECUSADO: Record<DocumentoComercial, string> = {
  quote: "enviar, registrar o aceite, gerar o pedido nem criar versão nova",
  order: "confirmá-lo",
  project: "criar orçamento nem versão nova",
};

/** Projeto não cancelado ainda recebe negociação — e orçamento novo passa pela guarda. */
export function projetoAindaAvanca(status: ProjectStatus): boolean {
  return status !== "CANCELLED";
}

/**
 * A versão ainda tem passo comercial pela frente: rascunho (enviar), enviada
 * (aceite) e aceita sem Pedido (gerar o pedido), em projeto não cancelado.
 * Recusada, substituída, arquivada e aceita com Pedido são histórico.
 */
export function orcamentoAindaAvanca(
  quote: Pick<QuoteVersionDTO, "status" | "sourcedOrder">,
  projectStatus: ProjectStatus,
): boolean {
  if (!projetoAindaAvanca(projectStatus)) return false;
  if (quote.status === "DRAFT" || quote.status === "SENT") return true;
  return quote.status === "ACCEPTED" && quote.sourcedOrder === null;
}

/**
 * Só o rascunho: o Pedido confirmado segue expedição e faturamento, que a
 * situação cadastral não interrompe.
 */
export function pedidoAindaAvanca(status: CustomerOrderStatus): boolean {
  return status === "DRAFT";
}

export function CustomerStatusNotice({
  documento,
  customerId,
  status,
}: {
  documento: DocumentoComercial;
  customerId: string;
  /** Situação ATUAL, da leitura do documento — nunca uma cópia guardada nele. */
  status: CustomerStatus;
}) {
  // Só as duas situações que a guarda recusa. Situação desconhecida (leitura
  // sem o campo) não vira aviso de "inativo" por exclusão.
  if (status !== "BLOCKED" && status !== "INACTIVE") return null;
  const bloqueado = status === "BLOCKED";

  return (
    <div className="pendency-panel" role="status">
      <p className="pendency-panel__title">{bloqueado ? "Cliente bloqueado" : "Cliente inativo"}</p>
      <p className="pendency-panel__sub">
        {bloqueado
          ? `Este cliente está bloqueado. ${DOCUMENTO[documento]} pode ser consultado, mas não é possível ${PASSO_RECUSADO[documento]} até a regularização.`
          : `Este cliente está inativo. ${DOCUMENTO[documento]} permanece disponível para consulta, mas não pode avançar no fluxo comercial enquanto o cadastro não for reativado.`}
      </p>
      {/* O motivo e o histórico moram na Visão do Cliente, aberta a todo
          perfil: o aviso aponta para lá em vez de repetir o que o documento
          não precisa carregar. */}
      <p className="pendency-panel__sub">
        <Link to={consultationPath(customerId, "resumo")}>Ver situação e histórico do cliente</Link>
      </p>
    </div>
  );
}
