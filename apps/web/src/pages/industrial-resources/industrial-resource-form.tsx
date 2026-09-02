import { useState } from "react";
import type { FormEvent } from "react";
import type { IndustrialResourceDetailDTO, IndustrialResourceType } from "@veridi/shared";
import {
  INDUSTRIAL_RATE_UOM_LABELS,
  INDUSTRIAL_RESOURCE_TYPES,
  INDUSTRIAL_RESOURCE_TYPE_LABELS,
  usageUomForResourceType,
} from "@veridi/shared";
import { FormSection } from "../../components/FormSection";
import { createIndustrialResource } from "../../lib/industrial-resources-api";
import { ApiValidationError } from "../../lib/api-errors";

/**
 * O formulário de Recurso industrial, uma vez só.
 *
 * Mesma divisão dos outros quatro cadastros: `useIndustrialResourceForm`
 * guarda estado, payload e submit; `IndustrialResourceFormFields` desenha os
 * campos dentro do `<form>`; e quem hospeda monta o próprio rodapé, que
 * precisa de uma coisa daqui — `saving`. O botão de commit aciona o
 * formulário pelo atributo `form`, sem estar aninhado nele.
 */

/** O `<form>` que o botão de commit aciona pelo atributo `form`. */
export const INDUSTRIAL_RESOURCE_FORM_ID = "industrial-resource-form";

interface FormState {
  name: string;
  type: IndustrialResourceType;
  description: string;
  powerKw: string;
}

export function useIndustrialResourceForm({
  onSaved,
}: {
  onSaved: (resource: IndustrialResourceDetailDTO) => void;
}) {
  const [form, setForm] = useState<FormState>({
    name: "",
    type: "LABOR",
    description: "",
    powerKw: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const created = await createIndustrialResource({
        name: form.name.trim(),
        type: form.type,
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        // Potência só vai quando informada — desconhecida continua desconhecida.
        ...(form.type === "EQUIPMENT" && form.powerKw.trim()
          ? { powerKw: form.powerKw.trim() }
          : {}),
      });
      onSaved(created);
    } catch (err) {
      /*
       * A recusa de campo vinha como faixa genérica: o servidor recusa
       * potência inválida com `invalid_power` apontando o campo, e o
       * `catch` de `Error` jogava tudo fora. Agora o erro pousa onde a
       * pessoa pode consertar, como nos outros quatro cadastros.
       */
      if (err instanceof ApiValidationError) {
        const proximos: Record<string, string> = {};
        for (const issue of err.issues) proximos[issue.path] = issue.message;
        setFieldErrors(proximos);
        setError("Corrija os campos destacados.");
      } else {
        setError(err instanceof Error ? err.message : "Falha ao criar recurso");
      }
    } finally {
      setSaving(false);
    }
  }

  return { form, setForm, saving, error, fieldErrors, handleSubmit };
}

export type IndustrialResourceFormController = ReturnType<typeof useIndustrialResourceForm>;

export function IndustrialResourceFormFields({
  form,
  setForm,
  error,
  fieldErrors,
  handleSubmit,
}: IndustrialResourceFormController) {
  return (
    <form id={INDUSTRIAL_RESOURCE_FORM_ID} onSubmit={handleSubmit}>
      {error && <p className="form-alert">{error}</p>}

      <FormSection
        title="Identificação"
        subtitle="Recurso é categoria econômica, não pessoa nem máquina individual."
      >
        <div className="field-grid-2">
          <div className="field">
            <label htmlFor="resource-name">
              Nome <span className="req">*</span>
            </label>
            <input
              id="resource-name"
              type="text"
              required
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Ex.: Operador de produção"
            />
            {fieldErrors["name"] && <p className="field__error">{fieldErrors["name"]}</p>}
          </div>

          <div className="field">
            <label htmlFor="resource-type">Tipo</label>
            <select
              id="resource-type"
              value={form.type}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  type: event.target.value as IndustrialResourceType,
                }))
              }
            >
              {INDUSTRIAL_RESOURCE_TYPES.map((option) => (
                <option key={option} value={option}>
                  {INDUSTRIAL_RESOURCE_TYPE_LABELS[option]}
                </option>
              ))}
            </select>
            <span className="field__hint">
              Consumo medido em {INDUSTRIAL_RATE_UOM_LABELS[usageUomForResourceType(form.type)]}.
            </span>
          </div>

          <div className="field field--full">
            <label htmlFor="resource-description">Descrição</label>
            <input
              id="resource-description"
              type="text"
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
            />
          </div>

          {form.type === "EQUIPMENT" && (
            <div className="field">
              <label htmlFor="resource-power">Potência (kW)</label>
              <input
                id="resource-power"
                type="text"
                inputMode="decimal"
                value={form.powerKw}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, powerKw: event.target.value }))
                }
                placeholder="Deixe vazio se não souber"
              />
              <span className="field__hint">
                Usada só para derivar energia. Vazio significa desconhecida — nunca zero.
              </span>
              {fieldErrors["powerKw"] && (
                <p className="field__error">{fieldErrors["powerKw"]}</p>
              )}
            </div>
          )}
        </div>
      </FormSection>

      <FormSection
        title="Tarifa"
        subtitle="A tarifa é registrada no recurso depois de criado e faz parte de um histórico imutável."
      >
        <p className="field__hint">
          Reajuste nunca sobrescreve: cada valor entra como tarifa nova, com vigência própria.
        </p>
      </FormSection>
    </form>
  );
}
