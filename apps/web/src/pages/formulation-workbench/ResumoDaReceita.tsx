import type { DosageForm, PresentationType, ResumoDaDose } from "@veridi/shared";
import { DOSAGE_FORM_LABELS, PRESENTATION_TYPE_LABELS } from "@veridi/shared";
import { FormSection } from "../../components/FormSection";
import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { formatQuantity } from "../../lib/quantity";

/**
 * RESUMO DA RECEITA — os totais técnicos, pelo mesmo motor das linhas.
 *
 * O que uma dose pesa, o que cada cápsula leva e quantas doses a embalagem
 * entrega. Nada de custo, preço ou margem: o resumo descreve a receita, e ela é
 * a mesma na Formulação de produto e no Modelo.
 */
export interface ResumoDaReceitaProps {
  dosageForm: DosageForm | "";
  presentationType: PresentationType | "";
  /** Cápsula: por dose e por embalagem, as duas derivadas do que foi digitado. */
  capsulasPorDose: number | null;
  capsulasNaEmbalagem: number | null;
  /** Pó: a dose e o conteúdo como estão nos campos, com as unidades deles. */
  doseAmount: string;
  doseUomCode: string;
  packageContentAmount: string;
  packageContentUomCode: string;
  dosesPorEmbalagem: number | null;
  resumoDaDose: ResumoDaDose;
  linhasNaComposicao: number;
  linhasNaEmbalagem: number;
}

export function ResumoDaReceita({
  dosageForm,
  presentationType,
  capsulasPorDose,
  capsulasNaEmbalagem,
  doseAmount,
  doseUomCode,
  packageContentAmount,
  packageContentUomCode,
  dosesPorEmbalagem,
  resumoDaDose,
  linhasNaComposicao,
  linhasNaEmbalagem,
}: ResumoDaReceitaProps) {
  const mostrarPorCapsula = dosageForm === "CAPSULE";
  return (
    <FormSection
      title="Resumo da formulação"
      subtitle="Totais técnicos desta receita, pelo mesmo motor das linhas: o que uma dose pesa, o que cada cápsula leva e quantas doses a embalagem entrega."
    >
      <dl className="definition-list">
        <dt>Forma e apresentação</dt>
        <dd>
          {dosageForm ? DOSAGE_FORM_LABELS[dosageForm] : "—"}
          {presentationType ? ` · ${PRESENTATION_TYPE_LABELS[presentationType]}` : ""}
        </dd>

        {mostrarPorCapsula && (
          <>
            <dt>Cápsulas</dt>
            <dd>
              {capsulasPorDose === null ? "—" : formatIntegerPtBr(capsulasPorDose)} por dose ·{" "}
              {capsulasNaEmbalagem === null ? "—" : formatIntegerPtBr(capsulasNaEmbalagem)} por
              embalagem
            </dd>
          </>
        )}

        {dosageForm === "POWDER" && (
          <>
            <dt>Dose e conteúdo</dt>
            <dd>
              {doseAmount.trim() ? `${doseAmount} ${doseUomCode}` : "—"} por dose ·{" "}
              {packageContentAmount.trim()
                ? `${packageContentAmount} ${packageContentUomCode}`
                : "—"}{" "}
              por embalagem
            </dd>
          </>
        )}

        <dt>Doses por embalagem</dt>
        <dd>{dosesPorEmbalagem === null ? "—" : formatIntegerPtBr(dosesPorEmbalagem)}</dd>

        {/*
          Soma o que É massa, e diz quando deixou linha de fora: total que
          omite em silêncio parece completo. Sem linha somável o valor é
          travessão — zero seria "esta dose não pesa nada".
        */}
        <dt>Massa por dose</dt>
        <dd>
          {resumoDaDose.somadas === 0
            ? "—"
            : `${formatQuantity(resumoDaDose.fisicaTotal.toFixed())} mg físicos · alvo ativo ${formatQuantity(resumoDaDose.teoricaTotal.toFixed())} mg`}
        </dd>

        {mostrarPorCapsula && (
          <>
            <dt>Massa por cápsula</dt>
            <dd>
              {resumoDaDose.somadas > 0 && resumoDaDose.porCapsulaTotal
                ? `${formatQuantity(resumoDaDose.porCapsulaTotal.toFixed())} mg`
                : "—"}
            </dd>
          </>
        )}

        <dt>Linhas</dt>
        <dd>
          {formatIntegerPtBr(linhasNaComposicao)} na composição ·{" "}
          {formatIntegerPtBr(linhasNaEmbalagem)} na embalagem
        </dd>
      </dl>

      {resumoDaDose.foraDaSoma > 0 && (
        <p className="field__hint">
          {formatIntegerPtBr(resumoDaDose.foraDaSoma)} linha(s) por dose ficaram fora da soma
          porque a unidade não é de massa. O total diz só o que pôde somar.
        </p>
      )}
    </FormSection>
  );
}
