import { useEffect, useRef, useState } from "react";
import type {
  MasterDataDeletionCheckDTO,
  MasterDataDeletionReferenceDTO,
  MasterDataDeletionResultDTO,
  MasterDataEntityType,
  UserRole,
} from "@veridi/shared";
import {
  MASTER_DATA_DELETION_ALTERNATIVE_LABELS,
  MASTER_DATA_DELETION_REASON_MAX_LENGTH,
  MASTER_DATA_HARD_DELETE_ROLES,
} from "@veridi/shared";
import { apiErrorMessage } from "../lib/api-errors";
import {
  CadastroEmUsoError,
  consultarExclusaoDefinitiva,
  excluirDefinitivamente,
} from "../lib/master-data-deletion-api";
import { perfilPermite } from "../lib/perfis";
import { useModalDialog } from "./useModalDialog";

/**
 * "Excluir definitivamente" — MASTER-DATA-HARD-DELETE-01.
 *
 * Só para cadastro criado por engano e nunca utilizado, e só do
 * Administrador. O diálogo pergunta à prévia ANTES de oferecer qualquer coisa
 * destrutiva:
 *
 *  - pode excluir: diz o que acontece, o que sai junto, e pede o motivo —
 *    obrigatório; a confirmação fica desligada enquanto ele estiver vazio;
 *  - não pode: mostra cada referência que impede e oferece a saída normal
 *    (Inativar ou Arquivar), nunca o botão de excluir.
 *
 * Se o cadastro ganhar uso entre a prévia e a confirmação, a API recusa (409)
 * e o diálogo troca a confirmação pela explicação, com as referências dela.
 */

/** O perfil da sessão pode excluir definitivamente? Só o Administrador (D1). */
export function podeExcluirDefinitivamente(role: UserRole | null | undefined): boolean {
  return perfilPermite(MASTER_DATA_HARD_DELETE_ROLES, role);
}

export const FRASE_DA_EXCLUSAO = "Esta ação remove definitivamente um cadastro criado por engano.";

type Estado =
  | { fase: "consultando" }
  | { fase: "falhou"; mensagem: string }
  | { fase: "pode"; previa: MasterDataDeletionCheckDTO }
  | { fase: "bloqueado"; previa: MasterDataDeletionCheckDTO; referencias: MasterDataDeletionReferenceDTO[] };

interface ExclusaoDefinitivaDialogProps {
  tipo: MasterDataEntityType;
  id: string;
  /** "fornecedor", "modelo de formulação" — na frase da confirmação. */
  rotulo: string;
  /**
   * A saída normal quando a exclusão é recusada (abrir o Inativar ou o
   * Arquivar da própria tela). Ausente: a tela não oferece o botão, só a frase.
   */
  onAlternativa?: (() => void) | undefined;
  onCancelar: () => void;
  onExcluido: (resultado: MasterDataDeletionResultDTO) => void;
}

export function ExclusaoDefinitivaDialog({
  tipo,
  id,
  rotulo,
  onAlternativa,
  onCancelar,
  onExcluido,
}: ExclusaoDefinitivaDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<Estado>({ fase: "consultando" });
  const [motivo, setMotivo] = useState("");
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useModalDialog(true, dialogRef, onCancelar);

  useEffect(() => {
    let vivo = true;
    consultarExclusaoDefinitiva(tipo, id)
      .then((previa) => {
        if (!vivo) return;
        setEstado(
          previa.canDelete ? { fase: "pode", previa } : { fase: "bloqueado", previa, referencias: previa.references },
        );
      })
      .catch((err: unknown) => {
        if (vivo) setEstado({ fase: "falhou", mensagem: apiErrorMessage(err, "Falha ao consultar a exclusão.") });
      });
    return () => {
      vivo = false;
    };
  }, [tipo, id]);

  async function confirmar(previa: MasterDataDeletionCheckDTO) {
    const reason = motivo.trim();
    if (reason.length === 0 || excluindo) return;
    setExcluindo(true);
    setErro(null);
    try {
      onExcluido(await excluirDefinitivamente(tipo, id, reason));
    } catch (err) {
      if (err instanceof CadastroEmUsoError) {
        setEstado({ fase: "bloqueado", previa, referencias: err.references });
      } else {
        setErro(apiErrorMessage(err, "Falha ao excluir o cadastro."));
      }
    } finally {
      setExcluindo(false);
    }
  }

  const identificacao =
    estado.fase === "pode" || estado.fase === "bloqueado"
      ? `${estado.previa.entityCode} — ${estado.previa.entityName}`
      : null;

  return (
    <>
      <div className="confirm-overlay" />
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="exclusao-definitiva-titulo"
        aria-busy={estado.fase === "consultando" || excluindo || undefined}
      >
        <h2 id="exclusao-definitiva-titulo">
          {estado.fase === "bloqueado" ? "Este cadastro não pode ser excluído" : `Excluir definitivamente o ${rotulo}?`}
        </h2>

        <div className="confirm-dialog__message">
          {identificacao && (
            <p>
              <strong>{identificacao}</strong>
            </p>
          )}

          {estado.fase === "consultando" && <p role="status">Conferindo se o cadastro já foi usado…</p>}

          {estado.fase === "falhou" && (
            <p className="form-alert" role="alert">
              {estado.mensagem}
            </p>
          )}

          {estado.fase === "pode" && (
            <>
              <p>{FRASE_DA_EXCLUSAO}</p>
              <p>
                Não há uso, referência nem histórico dele no sistema. A exclusão não pode ser desfeita: fica só o
                registro de quem excluiu, quando e por quê.
              </p>
              {estado.previa.removedTogether.length > 0 && (
                <>
                  <p>Sai junto:</p>
                  <ul className="confirm-dialog__list">
                    {estado.previa.removedTogether.map((removido) => (
                      <li key={removido.source}>{removido.source}</li>
                    ))}
                  </ul>
                </>
              )}
              <div className="field">
                <label htmlFor="exclusao-definitiva-motivo">Motivo da exclusão *</label>
                <textarea
                  id="exclusao-definitiva-motivo"
                  rows={3}
                  maxLength={MASTER_DATA_DELETION_REASON_MAX_LENGTH}
                  aria-required="true"
                  value={motivo}
                  onChange={(event) => setMotivo(event.target.value)}
                  placeholder="Por que este cadastro foi criado por engano?"
                />
              </div>
            </>
          )}

          {estado.fase === "bloqueado" && (
            <>
              <p>
                A exclusão definitiva é só para cadastro criado por engano e nunca utilizado. Este já tem uso,
                referência ou histórico:
              </p>
              <ul className="confirm-dialog__list" aria-label="O que impede a exclusão">
                {estado.referencias.map((referencia) => (
                  <li key={referencia.source}>
                    <strong>{referencia.source}</strong>
                    {referencia.count > 1 ? ` (${referencia.count})` : ""}: {referencia.reason}
                  </li>
                ))}
              </ul>
              <p>
                {estado.previa.alternativeAvailable
                  ? `A saída é ${MASTER_DATA_DELETION_ALTERNATIVE_LABELS[estado.previa.alternative]}: o cadastro sai das escolhas e o histórico continua.`
                  : `Ele já está ${estado.previa.alternative === "INACTIVATE" ? "inativo" : "arquivado"} — o histórico continua preservado.`}
              </p>
            </>
          )}

          {erro && (
            <p className="form-alert" role="alert">
              {erro}
            </p>
          )}
        </div>

        <div className="confirm-dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancelar}>
            {estado.fase === "pode" || estado.fase === "consultando" ? "Cancelar" : "Fechar"}
          </button>
          {estado.fase === "pode" && (
            <button
              type="button"
              className="btn btn--danger"
              disabled={motivo.trim().length === 0 || excluindo}
              onClick={() => void confirmar(estado.previa)}
            >
              {excluindo ? "Excluindo…" : "Excluir definitivamente"}
            </button>
          )}
          {estado.fase === "bloqueado" && estado.previa.alternativeAvailable && onAlternativa && (
            <button type="button" className="btn btn--secondary" onClick={onAlternativa}>
              {MASTER_DATA_DELETION_ALTERNATIVE_LABELS[estado.previa.alternative]}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
