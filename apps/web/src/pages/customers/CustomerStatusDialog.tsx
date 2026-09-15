import { useState } from "react";
import type { CustomerDTO, CustomerStatusAction } from "@veridi/shared";
import { CUSTOMER_STATUS_REASON_MAX_LENGTH } from "@veridi/shared";
import { ConfirmDialog } from "../../components/ConfirmDialog";

/**
 * Bloquear, Desbloquear, Inativar e Reativar — §95.
 *
 * Um diálogo só para as quatro, porque as quatro pedem a mesma coisa: o
 * MOTIVO, obrigatório, que vai para o histórico e responde "por quê" seis
 * meses depois. Confirmar fica desabilitado enquanto o motivo estiver vazio —
 * a recusa do servidor existe, mas descobrir a regra só depois de clicar é
 * pior que não poder clicar.
 *
 * O que muda entre elas é o texto: cada ação diz o efeito real antes de
 * acontecer, e as que mexem em bloqueio mostram o motivo em vigor.
 */

interface TextoDaAcao {
  title: string;
  label: string;
  confirmLabel: string;
  tone: "danger" | "accent";
  placeholder: string;
}

const TEXTO: Record<CustomerStatusAction, TextoDaAcao> = {
  BLOCK: {
    title: "Bloquear cliente?",
    label: "Motivo do bloqueio",
    confirmLabel: "Bloquear cliente",
    tone: "danger",
    placeholder: "Por que este cliente não pode receber novas vendas?",
  },
  UNBLOCK: {
    title: "Desbloquear cliente?",
    label: "Motivo do desbloqueio",
    confirmLabel: "Desbloquear cliente",
    tone: "accent",
    placeholder: "O que mudou desde o bloqueio?",
  },
  DEACTIVATE: {
    title: "Inativar cliente?",
    label: "Motivo da inativação",
    confirmLabel: "Inativar cliente",
    tone: "danger",
    placeholder: "Por que este cadastro vai ser arquivado?",
  },
  ACTIVATE: {
    title: "Reativar cliente?",
    label: "Motivo da reativação",
    confirmLabel: "Reativar cliente",
    tone: "accent",
    placeholder: "Por que este cadastro volta a ser usado?",
  },
};

function efeito(action: CustomerStatusAction, customer: CustomerDTO, nome: string): string {
  if (action === "BLOCK") {
    return `“${nome}” fica bloqueado para novas vendas: projeto novo, versão nova de orçamento, envio, aceite e pedido novo passam a ser recusados. Pedidos, faturamentos e documentos que já existem continuam como estão.`;
  }
  if (action === "UNBLOCK") {
    return `“${nome}” volta a receber novas vendas.`;
  }
  if (action === "DEACTIVATE") {
    return `“${nome}” fica arquivado: sai da lista padrão de Clientes e não recebe operação comercial nova. Nada é excluído — o histórico continua, e ele segue consultável pelos filtros Inativos e Todos.`;
  }
  return customer.blocked
    ? `“${nome}” volta para a lista de Clientes como BLOQUEADO — como estava antes de ser inativado. Reativar não desfaz o bloqueio.`
    : `“${nome}” volta para a lista padrão de Clientes e a receber novas vendas.`;
}

export function CustomerStatusDialog({
  action,
  customer,
  error,
  saving,
  onCancel,
  onConfirm,
}: {
  action: CustomerStatusAction;
  customer: CustomerDTO;
  /** Recusa do servidor — o diálogo fica aberto com o motivo digitado. */
  error: string | null;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const texto = TEXTO[action];
  const nome = customer.tradeName ?? customer.legalName;
  const mostraBloqueioEmVigor =
    customer.block !== null && (action === "UNBLOCK" || action === "ACTIVATE");

  return (
    <ConfirmDialog
      open
      title={texto.title}
      confirmLabel={texto.confirmLabel}
      confirmTone={texto.tone}
      confirmDisabled={reason.trim().length === 0 || saving}
      onCancel={onCancel}
      onConfirm={() => onConfirm(reason.trim())}
      message={
        <>
          <p>{efeito(action, customer, nome)}</p>
          {mostraBloqueioEmVigor && customer.block && (
            <p>
              Motivo do bloqueio em vigor: “{customer.block.reason}”. Ele continua no
              histórico — nada aqui o apaga.
            </p>
          )}
          <div className="field">
            <label htmlFor="customer-status-reason">{texto.label} *</label>
            <textarea
              id="customer-status-reason"
              rows={3}
              maxLength={CUSTOMER_STATUS_REASON_MAX_LENGTH}
              aria-required="true"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={texto.placeholder}
            />
          </div>
          {error && (
            <p className="form-alert" role="alert">
              {error}
            </p>
          )}
        </>
      }
    />
  );
}
