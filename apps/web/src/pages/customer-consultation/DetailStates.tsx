import { Link } from "react-router-dom";
import { ConsultationTrail } from "./ConsultationShell";

/**
 * Estados de um detalhe consultivo que ainda não tem conteúdo para mostrar.
 *
 * Os três acontecem DENTRO do shell: o cabeçalho do Cliente continua na tela
 * e a volta para a lista daquele Cliente continua a um clique. Perder o
 * contexto justamente no erro seria o oposto do que a Consulta existe para
 * fazer.
 */

export function ConsultationLoading({ listLabel, listTo }: { listLabel: string; listTo: string }) {
  return (
    <>
      <ConsultationTrail steps={[{ label: listLabel, to: listTo }, { label: "Carregando…" }]} />
      <p className="page__subtitle">Carregando…</p>
    </>
  );
}

/**
 * A entidade não é deste Cliente — ou não existe.
 *
 * A tela não distingue os dois casos porque a API também não distingue:
 * dizer "existe, mas é de outro cliente" entregaria a informação que o
 * escopo protege.
 */
export function ConsultationNotFound({
  noun,
  feminine = false,
  listLabel,
  listTo,
}: {
  noun: string;
  /**
   * Concordância do particípio: "Ordem de produção não encontradA".
   *
   * O texto é montado a partir do substantivo, então sem isto a tela de uma
   * entidade feminina erra o português na única frase que a pessoa lê.
   */
  feminine?: boolean;
  listLabel: string;
  listTo: string;
}) {
  const notFound = feminine ? "não encontrada" : "não encontrado";

  return (
    <>
      <ConsultationTrail
        steps={[{ label: listLabel, to: listTo }, { label: "Não encontrado" }]}
      />
      <div className="page__header">
        <div>
          <h1 className="page__title">
            {noun} {notFound} neste cliente
          </h1>
          <p className="page__subtitle">
            O registro não existe ou pertence a outro cliente.
          </p>
          <Link className="btn btn--secondary" to={listTo}>
            ← Voltar para {listLabel}
          </Link>
        </div>
      </div>
    </>
  );
}

export function ConsultationError({
  message,
  listLabel,
  listTo,
}: {
  message: string;
  listLabel: string;
  listTo: string;
}) {
  return (
    <>
      <ConsultationTrail steps={[{ label: listLabel, to: listTo }, { label: "Erro" }]} />
      <p className="form-alert">{message}</p>
      <Link className="btn btn--secondary" to={listTo}>
        ← Voltar para {listLabel}
      </Link>
    </>
  );
}
