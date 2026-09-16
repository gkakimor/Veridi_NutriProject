import { useParams } from "react-router-dom";
import type {
  FormulationTemplateDTO,
  FormulationTemplateVersionDTO,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import { getFormulationTemplate } from "../../lib/formulation-templates-api";
import { listUnits } from "../../lib/units-api";
import { PdfScreen } from "../../pdf/PdfScreen";

type Carga = {
  template: FormulationTemplateDTO;
  version: FormulationTemplateVersionDTO;
  units: UnitOfMeasureDTO[];
};

/**
 * Ficha Técnica do Modelo de Formulação, em PDF.
 *
 * O mesmo caminho da ficha do Produto: rota fora do `AppShell`, carga pela API
 * autenticada e arquivo montado no navegador — sem endpoint de documento. O
 * Modelo vem inteiro porque é ele que diz se a biblioteca o arquivou, e a
 * versão pedida sai da lista dele: versão de outro Modelo não é desta ficha.
 *
 * As unidades vêm junto porque os derivados da linha e o resumo da dose saem
 * do motor compartilhado, que precisa dos fatores de conversão.
 */
export function FormulationTemplateTechnicalSheetPrintPage() {
  const { templateId, versionId } = useParams<{ templateId: string; versionId: string }>();

  return (
    <PdfScreen<Carga>
      load={async () => {
        const [template, units] = await Promise.all([
          getFormulationTemplate(templateId!),
          listUnits(),
        ]);
        const version = template.versions.find((candidata) => candidata.id === versionId);
        if (!version) throw new Error("esta versão não pertence ao modelo.");
        return { template, version, units };
      }}
      build={async ({ template, version, units }) => {
        const [{ TechnicalSheetPdf, technicalSheetPdfFileName }, { fichaTecnicaDoModelo }] =
          await Promise.all([
            import("../../pdf/documents/TechnicalSheetPdf"),
            import("../../pdf/documents/technical-sheet-template-model"),
          ]);
        /* Um instante só: o carimbo do papel e o "Gerado em" da identificação. */
        const geradaEm = new Date();
        const ficha = fichaTecnicaDoModelo(version, units, geradaEm, {
          modeloArquivado: template.archived,
        });
        return {
          document: <TechnicalSheetPdf ficha={ficha} generatedAt={geradaEm} />,
          fileName: technicalSheetPdfFileName(ficha),
        };
      }}
      backTo={`/producao/templates-formulacao/${templateId ?? ""}`}
    />
  );
}
