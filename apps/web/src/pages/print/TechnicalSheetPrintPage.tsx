import { useParams } from "react-router-dom";
import type { FormulationVersionDTO, UnitOfMeasureDTO } from "@veridi/shared";
import { getFormulationVersion } from "../../lib/formulations-api";
import { listUnits } from "../../lib/units-api";
import { PdfScreen } from "../../pdf/PdfScreen";

type Carga = { version: FormulationVersionDTO; units: UnitOfMeasureDTO[] };

/**
 * Ficha Técnica do Produto — Formulação, em PDF.
 *
 * Rota fora do `AppShell`, como os demais documentos: carrega a VERSÃO pela
 * API autenticada, monta o arquivo no navegador e mostra o próprio PDF. Não há
 * endpoint de documento no servidor — nada da receita é alcançável sem sessão.
 *
 * As unidades vêm junto porque o resumo da dose soma em mg pelo motor
 * compartilhado, e ele precisa dos fatores de conversão. Tudo o mais já chega
 * calculado no DTO: o papel não refaz conta nenhuma.
 */
export function TechnicalSheetPrintPage() {
  const { productId, versionId } = useParams<{ productId: string; versionId: string }>();

  return (
    <PdfScreen<Carga>
      load={async () => {
        const [version, units] = await Promise.all([
          getFormulationVersion(versionId!),
          listUnits(),
        ]);
        return { version, units };
      }}
      build={async ({ version, units }) => {
        const [{ TechnicalSheetPdf, technicalSheetPdfFileName }, { fichaTecnicaDaVersao }] =
          await Promise.all([
            import("../../pdf/documents/TechnicalSheetPdf"),
            import("../../pdf/documents/technical-sheet-model"),
          ]);
        const ficha = fichaTecnicaDaVersao(version, units);
        return {
          document: <TechnicalSheetPdf ficha={ficha} generatedAt={new Date()} />,
          fileName: technicalSheetPdfFileName(ficha),
        };
      }}
      /*
       * Voltar é voltar para a versão. O `productId` da rota é o do endereço
       * aberto; quando a ficha é alcançada por um link externo que não o traz,
       * o da própria versão responde.
       */
      backTo={({ version }) =>
        `/producao/formulacoes/${productId ?? version.productId}/versoes/${version.id}`
      }
    />
  );
}
