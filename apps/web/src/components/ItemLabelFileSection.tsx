import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { ItemLabelFileResponse, ItemLabelFileVersionDTO, UserRole } from "@veridi/shared";
import {
  ITEM_LABEL_FILE_ACCEPT,
  ITEM_LABEL_FILE_MAX_SIZE_BYTES,
  ITEM_LABEL_FILE_NOTE_MAX_LENGTH,
  ITEM_LABEL_FILE_RESTORE_ROLES,
  ITEM_LABEL_FILE_TYPE_LABELS,
  ITEM_LABEL_FILE_UPLOAD_ROLES,
  ITEM_LABEL_FILE_VERSION_STATUS_LABELS,
  ITEM_LABEL_FILE_VOID_REASON_MAX_LENGTH,
  ITEM_LABEL_FILE_VOID_ROLES,
  itemLabelFileMimeTypeByExtension,
} from "@veridi/shared";
import { useOptionalAuth } from "../app/AuthProvider";
import { useUnsavedChangesGuard } from "../app/use-unsaved-changes-guard";
import { apiErrorMessage } from "../lib/api-errors";
import { formatDateTime } from "../lib/dates";
import { formatFileSize } from "../lib/file-size";
import {
  getItemLabelFile,
  itemLabelFileDownloadUrl,
  restoreItemLabelFileVersion,
  uploadItemLabelFileVersion,
  voidItemLabelFileVersion,
} from "../lib/item-label-files-api";
import { perfilPermite, perfisPorExtenso } from "../lib/perfis";
import { ConfirmDialog } from "./ConfirmDialog";
import { FormSection } from "./FormSection";
import { TableEmptyRow } from "./TableEmptyRow";

const LIMITE_EM_MB = Math.round(ITEM_LABEL_FILE_MAX_SIZE_BYTES / (1024 * 1024));

const CLASSE_DA_SITUACAO: Record<ItemLabelFileVersionDTO["status"], string> = {
  CURRENT: "badge badge--active",
  HISTORICAL: "badge badge--inactive",
  VOIDED: "badge badge--err",
};

interface AutoridadeNoArquivo {
  enviar: boolean;
  restaurar: boolean;
  anular: boolean;
}

/**
 * A MESMA lista que a API aplica decide o que a tela oferece. Fora do
 * `AuthProvider` (teste de tela isolado) não há sessão para julgar, e a tela
 * oferece tudo — o mesmo acordo do cadastro do Item; a recusa, se vier, é da API.
 */
function useAutoridadeNoArquivo(): AutoridadeNoArquivo {
  const sessao = useOptionalAuth();
  if (sessao === null) return { enviar: true, restaurar: true, anular: true };
  const role: UserRole | undefined = sessao.user?.role;
  return {
    enviar: perfilPermite(ITEM_LABEL_FILE_UPLOAD_ROLES, role),
    restaurar: perfilPermite(ITEM_LABEL_FILE_RESTORE_ROLES, role),
    anular: perfilPermite(ITEM_LABEL_FILE_VOID_ROLES, role),
  };
}

/** Recusa na tela antes de mandar: o que a API recusaria pelo nome ou pelo tamanho. */
function problemaDoArquivo(arquivo: File | null): string | null {
  if (!arquivo) return "Escolha o arquivo do rótulo.";
  if (!itemLabelFileMimeTypeByExtension(arquivo.name)) {
    return "Tipo de arquivo não aceito. Envie PDF, PNG ou JPEG.";
  }
  if (arquivo.size === 0) return "O arquivo escolhido está vazio.";
  if (arquivo.size > ITEM_LABEL_FILE_MAX_SIZE_BYTES) return `Arquivo acima do limite de ${LIMITE_EM_MB} MB.`;
  return null;
}

function rotuloDaVersao(versao: ItemLabelFileVersionDTO): string {
  return `V${versao.versionNumber}`;
}

/**
 * Arquivo do rótulo — LABEL-ATTACHMENTS-01, dentro do cadastro do Item Rótulo.
 *
 * Cada envio vira uma versão nova (V1, V2...), e nada é sobrescrito: por isso
 * "Adicionar nova versão", nunca "substituir". Anular tira a versão de
 * vigência com motivo e deixa o arquivo no histórico; restaurar cria versão
 * nova com o arquivo de uma antiga. A seção tem permissão própria e aparece
 * também em consulta — quem não edita o Item pode enviar arte, e quem só
 * consulta baixa o arquivo.
 */
export function ItemLabelFileSection({ itemId }: { itemId: string }) {
  const autoridade = useAutoridadeNoArquivo();

  const [data, setData] = useState<ItemLabelFileResponse | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [adicionando, setAdicionando] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [nota, setNota] = useState("");
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const campoArquivo = useRef<HTMLInputElement>(null);

  const [anulando, setAnulando] = useState<ItemLabelFileVersionDTO | null>(null);
  const [motivo, setMotivo] = useState("");
  const [restaurando, setRestaurando] = useState<ItemLabelFileVersionDTO | null>(null);
  const [notaDaRestauracao, setNotaDaRestauracao] = useState("");
  const [processando, setProcessando] = useState(false);

  const carregar = useCallback(() => {
    getItemLabelFile(itemId)
      .then((resposta) => {
        setData(resposta);
        setErroCarga(null);
      })
      .catch((err: unknown) =>
        setErroCarga(apiErrorMessage(err, "Falha ao carregar o arquivo do rótulo.")),
      );
  }, [itemId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // Arquivo escolhido e não enviado é trabalho que se perde ao fechar o Item.
  useUnsavedChangesGuard({
    isDirty: adicionando && (arquivo !== null || nota.trim() !== ""),
    substantivo: "nova versão do arquivo do rótulo",
    genero: "a",
  });

  function fecharFormulario() {
    setAdicionando(false);
    setArquivo(null);
    setNota("");
    setErroArquivo(null);
    if (campoArquivo.current) campoArquivo.current.value = "";
  }

  async function enviar(event: FormEvent) {
    event.preventDefault();
    const problema = problemaDoArquivo(arquivo);
    if (problema || !arquivo) {
      setErroArquivo(problema);
      return;
    }
    setErroArquivo(null);
    setErroAcao(null);
    setAviso(null);
    setEnviando(true);
    try {
      const resposta = await uploadItemLabelFileVersion(itemId, arquivo, nota);
      setData(resposta);
      fecharFormulario();
      setAviso(
        resposta.current ? `${rotuloDaVersao(resposta.current)} enviada e vigente.` : "Nova versão enviada.",
      );
    } catch (err) {
      setErroArquivo(apiErrorMessage(err, "Falha ao enviar o arquivo."));
    } finally {
      setEnviando(false);
    }
  }

  async function confirmarAnulacao() {
    if (!anulando) return;
    const razao = motivo.trim();
    if (!razao) return;
    setProcessando(true);
    setErroAcao(null);
    setAviso(null);
    try {
      const resposta = await voidItemLabelFileVersion(itemId, anulando.id, razao);
      setData(resposta);
      setAviso(`${rotuloDaVersao(anulando)} anulada. O arquivo continua no histórico.`);
      setAnulando(null);
      setMotivo("");
    } catch (err) {
      setErroAcao(apiErrorMessage(err, "Falha ao anular a versão."));
      setAnulando(null);
    } finally {
      setProcessando(false);
    }
  }

  async function confirmarRestauracao() {
    if (!restaurando) return;
    setProcessando(true);
    setErroAcao(null);
    setAviso(null);
    try {
      const resposta = await restoreItemLabelFileVersion(itemId, restaurando.id, notaDaRestauracao);
      setData(resposta);
      setAviso(
        resposta.current
          ? `${rotuloDaVersao(resposta.current)} criada a partir da ${rotuloDaVersao(restaurando)}.`
          : "Versão restaurada.",
      );
      setRestaurando(null);
      setNotaDaRestauracao("");
    } catch (err) {
      setErroAcao(apiErrorMessage(err, "Falha ao restaurar a versão."));
      setRestaurando(null);
    } finally {
      setProcessando(false);
    }
  }

  // O servidor diz que o Item não é Rótulo (mudou por fora): a seção sai.
  if (data && !data.labelItem) return null;

  const vigente = data?.current ?? null;
  const proximoNumero = (data?.versions[0]?.versionNumber ?? 0) + 1;
  const podeReceberVersao = Boolean(data?.acceptsNewVersion);

  return (
    <FormSection
      title="Arquivo do rótulo"
      subtitle={`Arte do rótulo em PDF, PNG ou JPEG, até ${LIMITE_EM_MB} MB. Cada envio cria uma nova versão; as anteriores ficam no histórico.`}
      id="arquivo-do-rotulo"
    >
      {erroCarga && <p className="form-alert" role="alert">{erroCarga}</p>}
      {erroAcao && <p className="form-alert" role="alert">{erroAcao}</p>}

      {data && (
        <>
          {vigente ? (
            <dl className="definition-list" aria-label="Versão atual do arquivo do rótulo">
              <dt>Versão atual</dt>
              <dd>
                <b>{rotuloDaVersao(vigente)}</b>
                {vigente.restoredFromVersionNumber !== null &&
                  ` — restaurada da V${vigente.restoredFromVersionNumber}`}
              </dd>
              <dt>Arquivo</dt>
              <dd>{vigente.originalFileName}</dd>
              <dt>Tipo</dt>
              <dd>{ITEM_LABEL_FILE_TYPE_LABELS[vigente.mimeType] ?? vigente.mimeType}</dd>
              <dt>Tamanho</dt>
              <dd>{formatFileSize(vigente.sizeBytes)}</dd>
              <dt>Enviado em</dt>
              <dd>{formatDateTime(vigente.createdAt)}</dd>
              <dt>Enviado por</dt>
              <dd>{vigente.createdByName}</dd>
              {vigente.note && (
                <>
                  <dt>Observação</dt>
                  <dd>{vigente.note}</dd>
                </>
              )}
            </dl>
          ) : (
            <p>
              <span className="badge badge--warn">Sem arquivo vigente</span>{" "}
              <span className="field__hint">
                {data.versions.length > 0
                  ? "Todas as versões foram anuladas. O histórico continua abaixo."
                  : "Nenhum arquivo enviado para este rótulo."}
              </span>
            </p>
          )}

          {!data.itemActive && (
            <p className="field__hint">
              Item inativo: o histórico continua disponível para consulta, mas o item não recebe nova
              versão.
            </p>
          )}
          {data.itemActive && !autoridade.enviar && (
            <p className="field__hint">
              Para enviar nova versão, solicite a {perfisPorExtenso(ITEM_LABEL_FILE_UPLOAD_ROLES, "ou")}.
            </p>
          )}

          <div className="line-actions">
            <div className="table__actions">
              {vigente && (
                <a
                  className="btn btn--secondary btn--sm"
                  href={itemLabelFileDownloadUrl(itemId, vigente.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Visualizar/baixar
                </a>
              )}
              {autoridade.enviar && podeReceberVersao && !adicionando && (
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => {
                    setAviso(null);
                    setAdicionando(true);
                  }}
                >
                  Adicionar nova versão
                </button>
              )}
              {aviso && !adicionando && (
                <span className="form-status" role="status">
                  {aviso}
                </span>
              )}
            </div>
          </div>

          {adicionando && (
            <form className="field-grid-2" onSubmit={enviar} aria-label="Nova versão do arquivo do rótulo">
              <div className="field">
                <label htmlFor="label-file-input">
                  Arquivo (será a V{proximoNumero}) <span className="req">*</span>
                </label>
                <input
                  ref={campoArquivo}
                  id="label-file-input"
                  type="file"
                  accept={ITEM_LABEL_FILE_ACCEPT}
                  disabled={enviando}
                  aria-describedby="label-file-input-hint"
                  {...(erroArquivo ? { "aria-invalid": true as const } : {})}
                  onChange={(event) => {
                    setErroArquivo(null);
                    setArquivo(event.target.files?.[0] ?? null);
                  }}
                />
                <p id="label-file-input-hint" className="field__hint">
                  PDF, PNG ou JPEG · até {LIMITE_EM_MB} MB. O arquivo atual não é apagado: vira histórico.
                </p>
                {erroArquivo && (
                  <p className="field__error" role="alert">
                    {erroArquivo}
                  </p>
                )}
              </div>
              <div className="field">
                <label htmlFor="label-file-note">Observação</label>
                <input
                  id="label-file-note"
                  type="text"
                  maxLength={ITEM_LABEL_FILE_NOTE_MAX_LENGTH}
                  placeholder="Ex.: arte aprovada pela gráfica em 10/09"
                  value={nota}
                  disabled={enviando}
                  onChange={(event) => setNota(event.target.value)}
                />
              </div>
              <div className="field field--full">
                <div className="table__actions">
                  <button type="submit" className="btn btn--accent btn--sm" disabled={enviando}>
                    {enviando ? "Enviando…" : "Enviar nova versão"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={enviando}
                    onClick={fecharFormulario}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </form>
          )}

          <div className="table-container table-container--spaced">
            <table className="table" aria-label="Histórico do arquivo do rótulo">
              <thead>
                <tr>
                  <th>Versão</th>
                  <th>Arquivo</th>
                  <th>Tipo</th>
                  <th>Tamanho</th>
                  <th>Enviado em</th>
                  <th>Por</th>
                  <th>Observação</th>
                  <th>Situação</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {data.versions.map((versao) => (
                  <tr key={versao.id}>
                    <td>
                      <b>{rotuloDaVersao(versao)}</b>
                      {versao.restoredFromVersionNumber !== null && (
                        <span className="field__hint"> da V{versao.restoredFromVersionNumber}</span>
                      )}
                    </td>
                    <td>{versao.originalFileName}</td>
                    <td>{ITEM_LABEL_FILE_TYPE_LABELS[versao.mimeType] ?? versao.mimeType}</td>
                    <td>{formatFileSize(versao.sizeBytes)}</td>
                    <td>{formatDateTime(versao.createdAt)}</td>
                    <td>{versao.createdByName}</td>
                    <td>{versao.note ?? "—"}</td>
                    <td>
                      <span className={CLASSE_DA_SITUACAO[versao.status]}>
                        {ITEM_LABEL_FILE_VERSION_STATUS_LABELS[versao.status]}
                      </span>
                      {versao.status === "VOIDED" && (
                        <span className="field__hint">
                          {" "}
                          por {versao.voidedByName ?? "—"} em {formatDateTime(versao.voidedAt)}:{" "}
                          {versao.voidReason}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="table__actions">
                        <a
                          className="btn btn--ghost btn--sm"
                          href={itemLabelFileDownloadUrl(itemId, versao.id)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Visualizar ou baixar a ${rotuloDaVersao(versao)}`}
                        >
                          Baixar
                        </a>
                        {autoridade.restaurar && podeReceberVersao && versao.status !== "CURRENT" && (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            aria-label={`Restaurar a ${rotuloDaVersao(versao)} como nova versão`}
                            onClick={() => {
                              setAviso(null);
                              setNotaDaRestauracao("");
                              setRestaurando(versao);
                            }}
                          >
                            Restaurar
                          </button>
                        )}
                        {autoridade.anular && versao.status !== "VOIDED" && (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            aria-label={`Anular a ${rotuloDaVersao(versao)}`}
                            onClick={() => {
                              setAviso(null);
                              setMotivo("");
                              setAnulando(versao);
                            }}
                          >
                            Anular
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}

                {data.versions.length === 0 && (
                  <TableEmptyRow colSpan={9}>Nenhuma versão enviada.</TableEmptyRow>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {anulando && (
        <ConfirmDialog
          open
          title={`Anular a ${rotuloDaVersao(anulando)}?`}
          confirmLabel={processando ? "Anulando…" : "Anular versão"}
          cancelLabel="Voltar"
          confirmDisabled={processando || motivo.trim() === ""}
          onCancel={() => {
            if (processando) return;
            setAnulando(null);
            setMotivo("");
          }}
          onConfirm={() => void confirmarAnulacao()}
          message={
            <>
              <p>
                A {rotuloDaVersao(anulando)} ({anulando.originalFileName}) deixa de valer
                {anulando.status === "CURRENT" ? " e sai de vigência" : ""}. O arquivo não é apagado:
                continua no histórico, com o motivo.
              </p>
              <div className="field">
                <label htmlFor="label-file-void-reason">Motivo da anulação</label>
                <textarea
                  id="label-file-void-reason"
                  rows={3}
                  maxLength={ITEM_LABEL_FILE_VOID_REASON_MAX_LENGTH}
                  value={motivo}
                  onChange={(event) => setMotivo(event.target.value)}
                  placeholder="O que está errado nesta versão?"
                  aria-describedby="label-file-void-reason-hint"
                />
                <p id="label-file-void-reason-hint" className="field__hint">
                  Obrigatório: fica registrado com o seu nome e a data.
                </p>
              </div>
            </>
          }
        />
      )}

      {restaurando && (
        <ConfirmDialog
          open
          title={`Restaurar a ${rotuloDaVersao(restaurando)} como V${proximoNumero}?`}
          confirmLabel={processando ? "Restaurando…" : `Restaurar como V${proximoNumero}`}
          cancelLabel="Voltar"
          confirmTone="accent"
          confirmDisabled={processando}
          onCancel={() => {
            if (processando) return;
            setRestaurando(null);
          }}
          onConfirm={() => void confirmarRestauracao()}
          message={
            <>
              <p>
                Cria a V{proximoNumero}, vigente, com o mesmo arquivo da{" "}
                {rotuloDaVersao(restaurando)} ({restaurando.originalFileName}). Nenhuma versão é
                apagada nem alterada.
                {restaurando.status === "VOIDED" &&
                  ` A ${rotuloDaVersao(restaurando)} continua anulada (motivo: ${restaurando.voidReason ?? "—"}).`}
              </p>
              <div className="field">
                <label htmlFor="label-file-restore-note">Observação da nova versão</label>
                <input
                  id="label-file-restore-note"
                  type="text"
                  maxLength={ITEM_LABEL_FILE_NOTE_MAX_LENGTH}
                  value={notaDaRestauracao}
                  onChange={(event) => setNotaDaRestauracao(event.target.value)}
                  placeholder="Ex.: volta a arte anterior a pedido do cliente"
                />
              </div>
            </>
          }
        />
      )}
    </FormSection>
  );
}
