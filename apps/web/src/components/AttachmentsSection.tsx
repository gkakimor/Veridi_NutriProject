import { useCallback, useEffect, useRef, useState } from "react";
import type { AttachmentDTO, AttachmentType } from "@veridi/shared";
import { ATTACHMENT_TYPE_LABELS, MAX_ATTACHMENT_SIZE_BYTES } from "@veridi/shared";
import { FormSection } from "./FormSection";
import type { AttachmentContext } from "../lib/attachments-api";
import {
  archiveAttachment,
  attachmentDownloadUrl,
  listAttachments,
  uploadAttachment,
} from "../lib/attachments-api";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR");
}

/**
 * Bloco de documentos reutilizado por Lote, Recebimento e Produto.
 *
 * Documento anexado é evidência: nunca há exclusão, só arquivamento — com
 * quem arquivou e quando. O arquivo é aberto por endpoint autenticado,
 * nunca por URL pública.
 */
export function AttachmentsSection({
  context,
  contextId,
  title,
  subtitle,
  types,
  canUpload = true,
  canArchive = true,
  onChanged,
}: {
  context: AttachmentContext;
  contextId: string;
  title: string;
  subtitle?: string;
  types: readonly AttachmentType[];
  canUpload?: boolean;
  canArchive?: boolean;
  onChanged?: () => void;
}) {
  const [attachments, setAttachments] = useState<AttachmentDTO[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [documentType, setDocumentType] = useState<AttachmentType>(types[0] ?? "OTHER");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    listAttachments(context, contextId, includeArchived)
      .then((result) => setAttachments(result.attachments))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar documentos"),
      );
  }, [context, contextId, includeArchived]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleUpload(file: File) {
    setUploading(true);
    setError(null);
    try {
      await uploadAttachment(context, contextId, documentType, file);
      if (fileInput.current) fileInput.current.value = "";
      reload();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar documento");
    } finally {
      setUploading(false);
    }
  }

  async function handleArchive(id: string) {
    setError(null);
    try {
      await archiveAttachment(id);
      reload();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao arquivar documento");
    }
  }

  return (
    <FormSection title={title} {...(subtitle ? { subtitle } : {})}>
      {error && <p className="form-alert">{error}</p>}

      {canUpload && (
        <div className="toolbar">
          <label className="sr-only" htmlFor={`attachment-type-${context}`}>
            Tipo do documento
          </label>
          <select
            id={`attachment-type-${context}`}
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value as AttachmentType)}
          >
            {types.map((type) => (
              <option key={type} value={type}>
                {ATTACHMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>

          <input
            ref={fileInput}
            type="file"
            aria-label="Arquivo do documento"
            accept="application/pdf,image/png,image/jpeg"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleUpload(file);
            }}
          />
          <span className="field__hint">
            PDF, PNG ou JPEG · até {Math.round(MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024))} MB
          </span>
        </div>
      )}

      <label className="checkbox">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(event) => setIncludeArchived(event.target.checked)}
        />
        Mostrar arquivados
      </label>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Arquivo</th>
              <th>Tipo</th>
              <th>Tamanho</th>
              <th>Enviado em</th>
              <th>Enviado por</th>
              <th>Situação</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {attachments.map((attachment) => (
              <tr key={attachment.id}>
                <td>{attachment.originalFileName}</td>
                <td>{ATTACHMENT_TYPE_LABELS[attachment.documentType]}</td>
                <td>{formatSize(attachment.sizeBytes)}</td>
                <td>{formatDateTime(attachment.uploadedAt)}</td>
                <td>{attachment.uploadedByName}</td>
                <td>
                  <span className={attachment.active ? "badge badge--active" : "badge badge--neutral"}>
                    {attachment.active ? "Ativo" : `Arquivado por ${attachment.archivedByName ?? "—"}`}
                  </span>
                </td>
                <td>
                  <div className="table__actions">
                    <a
                      className="btn btn--ghost btn--sm"
                      href={attachmentDownloadUrl(attachment.id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Abrir
                    </a>
                    {canArchive && attachment.active && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => void handleArchive(attachment.id)}
                      >
                        Arquivar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}

            {attachments.length === 0 && (
              <tr>
                <td colSpan={7} className="table__empty">
                  Nenhum documento anexado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </FormSection>
  );
}
