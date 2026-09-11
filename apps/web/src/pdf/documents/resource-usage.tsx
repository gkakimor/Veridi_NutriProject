import type { IndustrialRateUom } from "@veridi/shared";
import { descreverTotalDeUso, descreverUsoDeRecurso } from "../../components/ResourceUsageAmount";
import { PdfNote, PdfText } from "../components";

/**
 * Consumo de um recurso industrial com a quantidade de recursos (§87).
 *
 * Mesma leitura da tela e mesmas funções (`ResourceUsageAmount`): "2 × 2 hora"
 * com "Total: 4 hora" logo abaixo; com um recurso só, o consumo simples, como
 * sempre foi. O total é o do servidor — o PDF não multiplica nada. Energia
 * nunca passa de um recurso, então sai só o kWh.
 */
export function PdfResourceUsage(props: {
  resourceCount?: number | undefined;
  usageQuantity: string;
  totalUsageQuantity?: string | null | undefined;
  usageUom?: IndustrialRateUom | undefined;
}) {
  const total = descreverTotalDeUso(props);
  return (
    <>
      <PdfText>{descreverUsoDeRecurso(props)}</PdfText>
      {total ? <PdfNote>{total}</PdfNote> : null}
    </>
  );
}
