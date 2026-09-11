import type { ControlledDocumentRevisionDTO } from "@veridi/shared";
import { PdfDataGrid, PdfSection } from "../components";
import { formatDate, orDash } from "../format";

/**
 * Revisão de documento controlado — Ordem de Produção (R.PRO.002) e Folha de
 * Receita (R.COQ.003).
 *
 * A revisão impressa é a CONGELADA na ordem, nunca a ativa de hoje. É suporte
 * documental e de auditoria: o documento não declara certificação nem
 * conformidade em lugar nenhum.
 */
export function ControlledRevisionSection({
  documentCode,
  revision,
}: {
  documentCode: string;
  revision: ControlledDocumentRevisionDTO | null;
}) {
  return (
    <PdfSection title="Documento controlado">
      <PdfDataGrid
        fields={[
          { label: "Código do documento", value: documentCode, span: 4 },
          { label: "Revisão", value: revision ? revision.revision : "—", span: 4 },
          {
            label: "Data da revisão",
            value: revision?.revisionDate ? formatDate(revision.revisionDate) : "—",
            span: 4,
          },
          { label: "Elaboração", value: orDash(revision?.preparedByName), span: 6 },
          { label: "Aprovação", value: orDash(revision?.approvedByName), span: 6 },
        ]}
      />
    </PdfSection>
  );
}
