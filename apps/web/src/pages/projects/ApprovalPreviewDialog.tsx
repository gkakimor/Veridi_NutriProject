import type { ProjectDTO } from "@veridi/shared";
import { ConfirmDialog } from "../../components/ConfirmDialog";

/**
 * Confirmação da aprovação do projeto.
 *
 * Num projeto com vários produtos, aprovar não é um botão óbvio: o que vira
 * operacional é o que o cliente aceitou, e o resto fica fora do escopo. Quem
 * aprova precisa ver essa divisão ANTES, não descobrir depois que o terceiro
 * sabor não pode entrar em pedido.
 */
export function ApprovalPreviewDialog({
  project,
  onCancel,
  onConfirm,
}: {
  project: ProjectDTO;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const accepted = project.quoteVersions.find((quote) => quote.status === "ACCEPTED") ?? null;
  const acceptedProductIds = new Set((accepted?.lines ?? []).map((line) => line.productId));

  const toApprove = project.products.filter((link) => acceptedProductIds.has(link.productId));
  const outOfScope = project.products.filter(
    (link) => link.status === "ACTIVE" && !acceptedProductIds.has(link.productId),
  );

  return (
    <ConfirmDialog
      open
      title="Aprovar projeto"
      confirmLabel="Aprovar projeto"
      confirmTone="accent"
      onCancel={onCancel}
      onConfirm={onConfirm}
      message={
        !accepted ? (
        <p>
          Este projeto ainda não tem uma proposta aceita. A aprovação depende do aceite do
          cliente.
        </p>
        ) : (
          <>
            <p>
            A proposta aceita ({accepted.versionLabel}) contém {toApprove.length} de{" "}
            {project.products.length}{" "}
            {project.products.length === 1 ? "produto deste projeto" : "produtos deste projeto"}.
          </p>

          {toApprove.length > 0 && (
            <>
              <p>
                <strong>Serão aprovados:</strong>
              </p>
              <ul>
                {toApprove.map((link) => (
                  <li key={link.id}>
                    <span className="code">{link.productCode}</span> {link.productName}
                  </li>
                ))}
              </ul>
            </>
          )}

          {outOfScope.length > 0 && (
            <>
              <p>
                <strong>Ficarão fora do escopo comercial:</strong>
              </p>
              <ul>
                {outOfScope.map((link) => (
                  <li key={link.id}>
                    <span className="code">{link.productCode}</span> {link.productName}
                  </li>
                ))}
              </ul>
              <p className="field__hint">
                Continuam em desenvolvimento, com a história técnica inteira — só não entram em
                pedido ou produção por esta aprovação.
              </p>
            </>
          )}
          </>
        )
      }
    />
  );
}
