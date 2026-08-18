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

  /*
   * Linhas cujo preço não tem base de custo conhecida.
   *
   * Aprovar promove o produto a operacional: ele entra em pedido, produção e
   * faturamento com esse preço. Enviar a proposta já pede confirmação; a
   * aprovação era o único ponto da cadeia que não dizia nada sobre custo, e
   * é justamente o ponto sem volta.
   *
   * `pricing` é a proveniência econômica e só chega a quem negocia — para
   * Produção ela vem `null`, e aí este bloco simplesmente não aparece.
   */
  const semBaseDeCusto = (accepted?.lines ?? []).filter(
    (line) =>
      line.priceSource === "MANUAL" ||
      line.pricing?.costQuality === "NO_COST" ||
      line.pricing?.costQuality === "PARTIAL",
  );
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

          {semBaseDeCusto.length > 0 && (
            <>
              <p>
                <strong>Sem base de custo industrial:</strong>
              </p>
              <ul className="confirm-dialog__list">
                {semBaseDeCusto.map((line) => (
                  <li key={line.id}>
                    <span className="code">{line.productCode}</span> {line.productName} —{" "}
                    {line.priceSource === "MANUAL"
                      ? "preço manual, sem vínculo com cálculo de custo"
                      : line.pricing?.costQuality === "NO_COST"
                        ? "sem custo industrial conhecido"
                        : "custo industrial parcial"}
                  </li>
                ))}
              </ul>
              <p className="field__hint">
                A aprovação não depende do custo, e nada aqui é bloqueado — mas o produto passa a
                ser vendido e produzido com um preço que hoje não tem custo por trás.
              </p>
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
