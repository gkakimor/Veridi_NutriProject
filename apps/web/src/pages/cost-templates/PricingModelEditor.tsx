import type {
  CustomerTaxProfile,
  PricingEstimatedTaxMode,
  PricingIndustrialCostMode,
  PricingModelConfig,
  PricingModelValueField,
} from "@veridi/shared";
import {
  CUSTOMER_TAX_PROFILE_LABELS,
  PRICING_ESTIMATED_TAX_MODES,
  PRICING_ESTIMATED_TAX_MODE_FIELD,
  PRICING_ESTIMATED_TAX_MODE_LABELS,
  PRICING_INDUSTRIAL_COST_MODES,
  PRICING_INDUSTRIAL_COST_MODE_FIELD,
  PRICING_INDUSTRIAL_COST_MODE_LABELS,
  PRICING_MODEL_TAX_PROFILES,
  PRICING_MODEL_VALUE_LABELS,
  validarModeloDePrecificacao,
} from "@veridi/shared";
import { exigirDecimalOpcional } from "../../lib/decimal-field";
import { formatDecimalInput } from "../../lib/decimal-input";

/**
 * O que entra no custo que forma o preço — edição no rascunho do Modelo, §84.
 *
 * Cada modo com valor tem o SEU campo, e só o campo do modo escolhido fica
 * habilitado. Trocar de modo — ou escolher "Não considerar" — não apaga nada:
 * o valor digitado continua ali e volta a valer quando o modo voltar.
 */

type ValoresDigitados = Record<PricingModelValueField, string>;

export interface PricingModelDraft extends ValoresDigitados {
  industrialCostMode: PricingIndustrialCostMode;
  estimatedTaxMode: PricingEstimatedTaxMode;
  externalAdditionalCosts: boolean;
  applicableTaxProfiles: CustomerTaxProfile[];
}

export function rascunhoDoModelo(
  model: PricingModelConfig,
  perfis: CustomerTaxProfile[],
): PricingModelDraft {
  return {
    industrialCostMode: model.industrialCostMode,
    industrialCostPercentOfMaterials: formatDecimalInput(model.industrialCostPercentOfMaterials),
    industrialCostAmountPerUnit: formatDecimalInput(model.industrialCostAmountPerUnit),
    industrialCostAmountTotal: formatDecimalInput(model.industrialCostAmountTotal),
    estimatedTaxMode: model.estimatedTaxMode,
    estimatedTaxPercentOfSalePrice: formatDecimalInput(model.estimatedTaxPercentOfSalePrice),
    estimatedTaxAmountPerUnit: formatDecimalInput(model.estimatedTaxAmountPerUnit),
    estimatedTaxAmountTotal: formatDecimalInput(model.estimatedTaxAmountTotal),
    externalAdditionalCosts: model.externalAdditionalCosts,
    applicableTaxProfiles: perfis,
  };
}

/**
 * O digitado no formato da API — ou a ação interrompida com o motivo.
 *
 * Mesma leitura decimal do resto do ERP e a MESMA regra de coerência da API
 * (`validarModeloDePrecificacao`): a tela avisa antes, o servidor decide.
 */
export function modeloDoRascunho(draft: PricingModelDraft): PricingModelConfig {
  const valor = (campo: PricingModelValueField) =>
    exigirDecimalOpcional(draft[campo], PRICING_MODEL_VALUE_LABELS[campo]);
  const model: PricingModelConfig = {
    industrialCostMode: draft.industrialCostMode,
    industrialCostPercentOfMaterials: valor("industrialCostPercentOfMaterials"),
    industrialCostAmountPerUnit: valor("industrialCostAmountPerUnit"),
    industrialCostAmountTotal: valor("industrialCostAmountTotal"),
    estimatedTaxMode: draft.estimatedTaxMode,
    estimatedTaxPercentOfSalePrice: valor("estimatedTaxPercentOfSalePrice"),
    estimatedTaxAmountPerUnit: valor("estimatedTaxAmountPerUnit"),
    estimatedTaxAmountTotal: valor("estimatedTaxAmountTotal"),
    externalAdditionalCosts: draft.externalAdditionalCosts,
  };
  const problema = validarModeloDePrecificacao(model);
  if (problema) throw new Error(problema);
  return model;
}

interface Props {
  draft: PricingModelDraft;
  disabled: boolean;
  onChange: (draft: PricingModelDraft) => void;
}

export function PricingModelEditor({ draft, disabled, onChange }: Props) {
  const externo = draft.externalAdditionalCosts;

  function grupo<M extends string>(opcoes: {
    legenda: string;
    nome: string;
    modos: readonly M[];
    rotulos: Record<M, string>;
    campoDoModo: Record<M, PricingModelValueField | null>;
    atual: M;
    escolher: (modo: M) => void;
    dica: string;
  }) {
    return (
      <fieldset className="field">
        <legend>{opcoes.legenda}</legend>
        {opcoes.modos.map((modo) => {
          const campo = opcoes.campoDoModo[modo];
          return (
            <div key={modo} className="field-grid-2">
              <label className="checkbox">
                <input
                  type="radio"
                  name={opcoes.nome}
                  value={modo}
                  checked={opcoes.atual === modo}
                  disabled={disabled}
                  onChange={() => opcoes.escolher(modo)}
                />
                {opcoes.rotulos[modo]}
              </label>
              {campo ? (
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={PRICING_MODEL_VALUE_LABELS[campo]}
                  // Só o valor do modo escolhido vale; os outros ficam
                  // guardados, visíveis e intocados.
                  disabled={disabled || opcoes.atual !== modo}
                  value={draft[campo]}
                  onChange={(event) => onChange({ ...draft, [campo]: event.target.value })}
                />
              ) : (
                <span aria-hidden="true" />
              )}
            </div>
          );
        })}
        <p className="field__hint">{opcoes.dica}</p>
        {externo && (
          <p className="field__hint">
            Fora da conta enquanto os custos adicionais forem administrados externamente — os
            valores continuam guardados.
          </p>
        )}
      </fieldset>
    );
  }

  return (
    <>
      {grupo({
        legenda: "Custo industrial",
        nome: "tpp-custo-industrial",
        modos: PRICING_INDUSTRIAL_COST_MODES,
        rotulos: PRICING_INDUSTRIAL_COST_MODE_LABELS,
        campoDoModo: PRICING_INDUSTRIAL_COST_MODE_FIELD,
        atual: draft.industrialCostMode,
        escolher: (modo) => onChange({ ...draft, industrialCostMode: modo }),
        dica: "“Conforme a Estrutura de Custos” usa o cálculo do ERP inteiro — o comportamento de antes. O percentual é sempre sobre o custo de materiais da quantidade.",
      })}

      {grupo({
        legenda: "Impostos estimados",
        nome: "tpp-impostos",
        modos: PRICING_ESTIMATED_TAX_MODES,
        rotulos: PRICING_ESTIMATED_TAX_MODE_LABELS,
        campoDoModo: PRICING_ESTIMATED_TAX_MODE_FIELD,
        atual: draft.estimatedTaxMode,
        escolher: (modo) => onChange({ ...draft, estimatedTaxMode: modo }),
        dica: "O percentual sobre o preço de venda entra na formação do preço junto com margem e comissão; R$ por unidade e R$ total somam ao custo. O ERP não calcula imposto: o valor vem da Veridi.",
      })}

      <div className="field">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={externo}
            disabled={disabled}
            onChange={(event) => onChange({ ...draft, externalAdditionalCosts: event.target.checked })}
          />
          Custos adicionais administrados externamente
        </label>
        <p className="field__hint">
          Ligado: custo industrial e impostos deste Modelo ficam fora da conta, sem apagar os valores
          acima. O custo de materiais continua sendo calculado, e margem e comissão continuam no
          preço.
        </p>
      </div>

      <fieldset className="field">
        <legend>Perfis tributários aplicáveis</legend>
        {PRICING_MODEL_TAX_PROFILES.map((perfil) => (
          <label key={perfil} className="checkbox">
            <input
              type="checkbox"
              checked={draft.applicableTaxProfiles.includes(perfil)}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...draft,
                  applicableTaxProfiles: event.target.checked
                    ? [...draft.applicableTaxProfiles, perfil]
                    : draft.applicableTaxProfiles.filter((atual) => atual !== perfil),
                })
              }
            />
            {CUSTOMER_TAX_PROFILE_LABELS[perfil]}
          </label>
        ))}
        <p className="field__hint">
          {draft.applicableTaxProfiles.length === 0
            ? "Nenhum marcado: indicado para todos os perfis."
            : "Indicado só para os perfis marcados."}{" "}
          É sugestão de compatibilidade com o Cliente — não calcula imposto e não impede escolher
          outro Modelo.
        </p>
      </fieldset>
    </>
  );
}
