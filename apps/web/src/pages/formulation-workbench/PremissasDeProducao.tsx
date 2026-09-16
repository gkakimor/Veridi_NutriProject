import type { ReactNode } from "react";
import { PercentField } from "../../components/NumericField";
import { decimalLegivel } from "../../lib/decimal-field";
import { formatPercentPtBr } from "../../lib/numeric-ptbr";
import { CASAS_PERCENTUAL_TECNICO, OPCOES_PERCENTUAL_TECNICO } from "../../lib/numeric-scales";
import { Dica } from "./dicas";

/**
 * PREMISSAS DE PRODUÇÃO — a perda prevista e o rendimento que sai dela.
 *
 * Bloco próprio, e não mais um campo no meio da apresentação: a apresentação
 * descreve o que se vende, esta linha descreve o processo. Compacta de
 * propósito — é uma premissa e o seu resultado, não um assunto que mereça
 * cartão inteiro.
 *
 * O RENDIMENTO é calculado (100% menos a perda), nunca editável: dois campos
 * para a mesma premissa divergem no primeiro que alguém esquecer de atualizar.
 * A conta vem do motor compartilhado — a tela só a mostra.
 */
export interface PremissasDeProducaoProps {
  idPrefixo: string;
  /** Texto do campo, em português. Vazio = NÃO INFORMADA, nunca 0%. */
  expectedLossPercent: string;
  onChange: (valor: string) => void;
  editavel: boolean;
  erro?: string | undefined;
  /** Rendimento já calculado pelo motor — `null` quando a perda não é legível. */
  rendimentoExibido: string | null;
  /** O que só uma das telas mostra — a simulação de lote, por exemplo. */
  children?: ReactNode;
}

export function PremissasDeProducao({
  idPrefixo,
  expectedLossPercent,
  onChange,
  editavel,
  erro,
  rendimentoExibido,
  children,
}: PremissasDeProducaoProps) {
  const idDoErro = `${idPrefixo}-expectedLossPercent-error`;
  return (
    <div className="premissas-producao">
      <span className="premissas-producao__titulo">Premissas de produção</span>
      <div className="premissas-producao__campos">
        <div className="field field--narrow">
          <label htmlFor={`${idPrefixo}-expectedLoss`}>
            Perda prevista de produção (%) <Dica id="formulacao.perdaPrevista" />
          </label>
          {editavel ? (
            <PercentField
              id={`${idPrefixo}-expectedLoss`}
              scale={CASAS_PERCENTUAL_TECNICO}
              placeholder="—"
              /* 100% de perda não tem quantidade bruta: a seta para em 99. */
              stepper={{ min: "0", max: "99", nome: "Perda prevista de produção" }}
              value={expectedLossPercent}
              onChangeValue={onChange}
              {...(erro ? { "aria-invalid": true as const, "aria-describedby": idDoErro } : {})}
            />
          ) : (
            <p className="field-readonly-value">
              {expectedLossPercent.trim()
                ? formatPercentPtBr(
                    decimalLegivel(expectedLossPercent, OPCOES_PERCENTUAL_TECNICO),
                    OPCOES_PERCENTUAL_TECNICO,
                  )
                : "—"}
            </p>
          )}
          {erro && (
            <p className="field__error" id={idDoErro}>
              {erro}
            </p>
          )}
        </div>

        <div className="field field--narrow field--calculado">
          <span className="field__label-static">
            Rendimento esperado <Dica id="formulacao.rendimentoEsperado" />
          </span>
          <p
            className="field-readonly-value field-readonly-value--calculado"
            data-testid="rendimento-esperado"
          >
            {rendimentoExibido === null
              ? "—"
              : formatPercentPtBr(rendimentoExibido, OPCOES_PERCENTUAL_TECNICO)}
          </p>
        </div>

        {children}
      </div>
    </div>
  );
}
