import { useEffect, useState } from "react";
import type { CustomerCnpjRegistrationEventDTO, CustomerDTO } from "@veridi/shared";
import { CNPJ_REGISTRATION_CHANGE_SOURCE_LABELS, formatCnpj } from "@veridi/shared";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { getCustomerCnpjRegistrationHistory } from "../../lib/customers-api";
import { formatDateTime } from "../../lib/dates";
import { DEFINICOES_DOS_DADOS_DO_CNPJ } from "./cnpj-lookup-fields";

/**
 * Histórico dos dados cadastrais do CNPJ — §122 (CUSTOMER-CNPJ-EDITABLE-HISTORY-01).
 *
 * Do mais recente para o mais antigo, uma linha por mudança de campo: data e
 * hora, quem gravou, a origem (Manual, OpenCNPJ ou CNPJ alterado), o campo, o
 * valor anterior e o novo. A consulta aplicada aparece como "Dados conferidos
 * via OpenCNPJ", com a data da consulta — inclusive quando nada mudou, que é
 * exatamente quando ela não deixa linha de campo.
 *
 * Diálogo, e não tabela aberta no formulário: o histórico se consulta quando
 * se precisa dele, e o cadastro continua sendo o que se edita.
 */

type Estado =
  | { tipo: "carregando" }
  | { tipo: "erro"; texto: string }
  | { tipo: "pronto"; eventos: CustomerCnpjRegistrationEventDTO[] };

type Linha =
  | { chave: string; origem: string; campo: string; anterior: string; novo: string }
  | { chave: string; origem: string; mensagem: string };

const vazioOu = (texto: string) => (texto.trim() === "" ? "—" : texto);

/** As linhas de UM evento, na ordem em que a tabela as mostra. */
function linhasDoEvento(evento: CustomerCnpjRegistrationEventDTO): Linha[] {
  const linhas: Linha[] = [];
  if (evento.kind === "CNPJ_CHANGED") {
    linhas.push({
      chave: `${evento.id}-cnpj`,
      origem: CNPJ_REGISTRATION_CHANGE_SOURCE_LABELS.CNPJ_CHANGED,
      campo: "CNPJ",
      anterior: evento.previousCnpj ? formatCnpj(evento.previousCnpj) : "—",
      novo: evento.cnpj ? formatCnpj(evento.cnpj) : "—",
    });
  }
  for (const mudanca of evento.changes) {
    const definicao = DEFINICOES_DOS_DADOS_DO_CNPJ[mudanca.field];
    linhas.push({
      chave: `${evento.id}-${mudanca.field}`,
      origem: CNPJ_REGISTRATION_CHANGE_SOURCE_LABELS[mudanca.source],
      campo: definicao.rotulo,
      anterior: vazioOu(definicao.exibir(mudanca.before)),
      novo: vazioOu(definicao.exibir(mudanca.after)),
    });
  }
  if (evento.consultedAt) {
    linhas.push({
      chave: `${evento.id}-consulta`,
      origem: CNPJ_REGISTRATION_CHANGE_SOURCE_LABELS.OPEN_CNPJ,
      mensagem: `Dados conferidos via OpenCNPJ · consulta de ${formatDateTime(evento.consultedAt)}`,
    });
  }
  return linhas;
}

export function CnpjRegistrationHistoryDialog({
  customer,
  onClose,
}: {
  customer: CustomerDTO;
  onClose: () => void;
}) {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });

  useEffect(() => {
    let vivo = true;
    getCustomerCnpjRegistrationHistory(customer.id)
      .then((resposta) => {
        if (vivo) setEstado({ tipo: "pronto", eventos: resposta.events });
      })
      .catch((erro: unknown) => {
        if (vivo) {
          setEstado({
            tipo: "erro",
            texto: erro instanceof Error ? erro.message : "Não foi possível carregar o histórico.",
          });
        }
      });
    return () => {
      vivo = false;
    };
  }, [customer.id]);

  return (
    <FullWorkspaceModal
      open
      onClose={onClose}
      crumb="Cadastros / Clientes"
      crumbActive="Histórico do CNPJ"
      title="Histórico dos dados cadastrais do CNPJ"
      codeChip={customer.code}
      closeHint="Fecha o histórico"
      footer={
        <>
          <span className="modal-fullscreen__foot-meta">
            Somente leitura. Cada gravação do cadastro que muda estes dados fica registrada aqui.
          </span>
          <div className="modal-fullscreen__actions">
            <button type="button" className="btn btn--secondary" onClick={onClose}>
              Fechar
            </button>
          </div>
        </>
      }
    >
      {estado.tipo === "carregando" && (
        <p className="field__hint" role="status">
          Carregando histórico…
        </p>
      )}

      {estado.tipo === "erro" && (
        <p className="form-alert" role="alert">
          {estado.texto}
        </p>
      )}

      {estado.tipo === "pronto" && estado.eventos.length === 0 && (
        <p className="field__hint" role="status">
          Nenhuma alteração registrada. O histórico começa nas gravações feitas depois da sua
          criação — dados anteriores não ganham histórico retroativo.
        </p>
      )}

      {estado.tipo === "pronto" && estado.eventos.length > 0 && (
        <div className="table-container">
          <table className="table table--cnpj-history">
            <thead>
              <tr>
                <th className="col-flex">Data/hora</th>
                <th className="col-flex">Usuário</th>
                <th className="col-flex">Origem</th>
                <th className="col-flex">Campo</th>
                <th className="col-flex">Anterior</th>
                <th className="col-flex">Novo</th>
              </tr>
            </thead>
            <tbody>
              {estado.eventos.flatMap((evento) =>
                linhasDoEvento(evento).map((linha) => (
                  <tr key={linha.chave}>
                    <td className="col-flex">{formatDateTime(evento.occurredAt)}</td>
                    <td className="col-flex">{evento.userName ?? "Não disponível"}</td>
                    <td className="col-flex">{linha.origem}</td>
                    {"mensagem" in linha ? (
                      <td className="col-flex" colSpan={3}>
                        {linha.mensagem}
                      </td>
                    ) : (
                      <>
                        <td className="col-flex">{linha.campo}</td>
                        <td className="col-flex">{linha.anterior}</td>
                        <td className="col-flex">{linha.novo}</td>
                      </>
                    )}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
    </FullWorkspaceModal>
  );
}
