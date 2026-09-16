import type { ReactNode } from "react";
import type { DosageForm, PresentationType, UnitOfMeasureDTO } from "@veridi/shared";
import { DOSAGE_FORM_LABELS, PRESENTATION_TYPE_LABELS } from "@veridi/shared";
import { DecimalField, IntegerField } from "../../components/NumericField";
import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { CASAS_QUANTIDADE } from "../../lib/numeric-scales";
import { Dica } from "./dicas";

/**
 * AS PREMISSAS DA FORMA — o que a receita assume antes de qualquer linha.
 *
 * Forma e apresentação são coisas diferentes: a forma é cápsula ou pó — o que
 * a bancada calcula por dose —, e a apresentação é a embalagem comercial.
 * Misturar as duas num campo só ("pote/cápsula") produz um vocabulário que não
 * descreve nem produto nem embalagem.
 *
 * As mesmas premissas valem na Formulação de produto e no Modelo: os nomes são
 * os do contrato (`dosageForm`, `capsulesPerDose`…), e o que muda entre as duas
 * telas é só o PREFIXO dos ids — nunca a regra.
 */
export interface PremissasDaFormaValores {
  dosageForm: DosageForm | "";
  presentationType: PresentationType | "";
  capsulesPerDose: string;
  capsulesPerPackage: string;
  doseAmount: string;
  doseUomCode: string;
  packageContentAmount: string;
  packageContentUomCode: string;
}

export interface PremissasDaFormaProps {
  /** Prefixo dos ids e das mensagens — `version-dosageForm`, `template-dosageForm`. */
  idPrefixo: string;
  valores: PremissasDaFormaValores;
  onChange: <K extends keyof PremissasDaFormaValores>(
    campo: K,
    valor: PremissasDaFormaValores[K],
  ) => void;
  editavel: boolean;
  /** Recusas por campo, no nome do contrato (`capsulesPerDose`, `doseAmount`…). */
  erros: Record<string, string>;
  /** Formas oferecidas — a gravada continua na lista mesmo fora da bancada. */
  formasOferecidas: readonly DosageForm[];
  apresentacoesOferecidas: readonly PresentationType[];
  /** Dose e conteúdo do pó são massa: o seletor só oferece unidade de massa. */
  unidadesDeMassa: UnitOfMeasureDTO[];
  /** A forma deriva as doses por embalagem? Então elas são RESULTADO. */
  derivaDoses: boolean;
  dosesDerivadas: number | null;
  /** Como o resultado é encontrado no teste da tela que o mostra. */
  testIdDasDoses: string;
  /** Campos da PRÓPRIA tela — base, modo de cálculo, doses digitadas. */
  children?: ReactNode;
}

export function PremissasDaForma({
  idPrefixo,
  valores,
  onChange,
  editavel,
  erros,
  formasOferecidas,
  apresentacoesOferecidas,
  unidadesDeMassa,
  derivaDoses,
  dosesDerivadas,
  testIdDasDoses,
  children,
}: PremissasDaFormaProps) {
  const id = (campo: string) => `${idPrefixo}-${campo}`;
  const idDoErro = (campo: string) => `${idPrefixo}-${campo}-error`;
  const acusar = (campo: string) =>
    erros[campo]
      ? ({ "aria-invalid": true as const, "aria-describedby": idDoErro(campo) })
      : {};
  const erro = (campo: string) =>
    erros[campo] ? (
      <p className="field__error" id={idDoErro(campo)}>
        {erros[campo]}
      </p>
    ) : null;

  return (
    /*
      AS PREMISSAS LADO A LADO, e não uma embaixo da outra.
      Empilhadas, cada campo ocupava 220px numa tela de 1900 e o resumo da
      apresentação — que é o que a pessoa confere de relance — virava uma
      coluna de rolagem com o texto de apoio entre um campo e o seguinte.
      A grade acomoda quantas colunas couberem e cai para uma só em tela
      estreita.
    */
    <div className="form-premissas">
      <div className="field field--narrow">
        <label htmlFor={id("dosageForm")}>
          Forma do produto <Dica id="formulacao.forma" />
        </label>
        {editavel ? (
          <select
            id={id("dosageForm")}
            value={valores.dosageForm}
            onChange={(event) => onChange("dosageForm", event.target.value as DosageForm | "")}
            {...acusar("dosageForm")}
          >
            <option value="">—</option>
            {formasOferecidas.map((forma) => (
              <option key={forma} value={forma}>
                {DOSAGE_FORM_LABELS[forma]}
              </option>
            ))}
          </select>
        ) : (
          <p className="field-readonly-value">
            {valores.dosageForm ? DOSAGE_FORM_LABELS[valores.dosageForm] : "—"}
          </p>
        )}
        {erro("dosageForm")}
      </div>

      <div className="field field--narrow">
        <label htmlFor={id("presentationType")}>
          Apresentação comercial <Dica id="formulacao.apresentacaoComercial" />
        </label>
        {editavel ? (
          <select
            id={id("presentationType")}
            value={valores.presentationType}
            onChange={(event) =>
              onChange("presentationType", event.target.value as PresentationType | "")
            }
          >
            <option value="">—</option>
            {apresentacoesOferecidas.map((tipo) => (
              <option key={tipo} value={tipo}>
                {PRESENTATION_TYPE_LABELS[tipo]}
              </option>
            ))}
          </select>
        ) : (
          <p className="field-readonly-value">
            {valores.presentationType ? PRESENTATION_TYPE_LABELS[valores.presentationType] : "—"}
          </p>
        )}
      </div>

      {valores.dosageForm === "CAPSULE" && (
        <>
          <div className="field field--narrow">
            <label htmlFor={id("capsulesPerDose")}>
              Cápsulas por dose <Dica id="formulacao.capsulasPorDose" />
            </label>
            {editavel ? (
              <IntegerField
                id={id("capsulesPerDose")}
                value={valores.capsulesPerDose}
                onChangeValue={(valor) => onChange("capsulesPerDose", valor)}
                {...acusar("capsulesPerDose")}
              />
            ) : (
              <p className="field-readonly-value">
                {valores.capsulesPerDose ? formatIntegerPtBr(Number(valores.capsulesPerDose)) : "—"}
              </p>
            )}
            {erro("capsulesPerDose")}
          </div>

          <div className="field field--narrow">
            <label htmlFor={id("capsulesPerPackage")}>
              Cápsulas por embalagem <Dica id="formulacao.capsulasPorEmbalagem" />
            </label>
            {editavel ? (
              <IntegerField
                id={id("capsulesPerPackage")}
                value={valores.capsulesPerPackage}
                onChangeValue={(valor) => onChange("capsulesPerPackage", valor)}
                {...acusar("capsulesPerPackage")}
              />
            ) : (
              <p className="field-readonly-value">
                {valores.capsulesPerPackage
                  ? formatIntegerPtBr(Number(valores.capsulesPerPackage))
                  : "—"}
              </p>
            )}
            {erro("capsulesPerPackage")}
          </div>
        </>
      )}

      {valores.dosageForm === "POWDER" && (
        <>
          <div className="field field--narrow">
            <label htmlFor={id("doseAmount")}>
              Dose <Dica id="formulacao.dose" />
            </label>
            {editavel ? (
              <div className="quantidade-unidade">
                <DecimalField
                  id={id("doseAmount")}
                  scale={CASAS_QUANTIDADE}
                  placeholder="0"
                  value={valores.doseAmount}
                  onChangeValue={(valor) => onChange("doseAmount", valor)}
                  {...acusar("doseAmount")}
                />
                <select
                  id={id("doseUomCode")}
                  aria-label="Unidade da dose"
                  value={valores.doseUomCode}
                  onChange={(event) => onChange("doseUomCode", event.target.value)}
                  {...acusar("doseUomCode")}
                >
                  <option value="">—</option>
                  {unidadesDeMassa.map((unit) => (
                    <option key={unit.code} value={unit.code}>
                      {unit.code}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="field-readonly-value">
                {valores.doseAmount ? `${valores.doseAmount} ${valores.doseUomCode}` : "—"}
              </p>
            )}
            {erro("doseAmount")}
            {erro("doseUomCode")}
          </div>

          <div className="field field--narrow">
            <label htmlFor={id("packageContentAmount")}>
              Conteúdo da embalagem <Dica id="formulacao.conteudo" />
            </label>
            {editavel ? (
              <div className="quantidade-unidade">
                <DecimalField
                  id={id("packageContentAmount")}
                  scale={CASAS_QUANTIDADE}
                  placeholder="0"
                  value={valores.packageContentAmount}
                  onChangeValue={(valor) => onChange("packageContentAmount", valor)}
                  {...acusar("packageContentAmount")}
                />
                <select
                  id={id("packageContentUomCode")}
                  aria-label="Unidade do conteúdo da embalagem"
                  value={valores.packageContentUomCode}
                  onChange={(event) => onChange("packageContentUomCode", event.target.value)}
                >
                  <option value="">—</option>
                  {unidadesDeMassa.map((unit) => (
                    <option key={unit.code} value={unit.code}>
                      {unit.code}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="field-readonly-value">
                {valores.packageContentAmount
                  ? `${valores.packageContentAmount} ${valores.packageContentUomCode}`
                  : "—"}
              </p>
            )}
            {erro("packageContentAmount")}
          </div>
        </>
      )}

      {derivaDoses && (
        <div className="field field--narrow field--calculado">
          <span className="field__label-static">
            Doses por embalagem <Dica id="formulacao.dosesPorEmbalagem" />
          </span>
          {/* Resultado, nunca segundo campo: dois números para a mesma
              premissa divergem no primeiro que alguém esquecer. */}
          <p
            className="field-readonly-value field-readonly-value--calculado"
            data-testid={testIdDasDoses}
          >
            {dosesDerivadas === null ? "—" : formatIntegerPtBr(dosesDerivadas)}
          </p>
        </div>
      )}

      {children}
    </div>
  );
}
