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
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { createIndustrialResource } from "../../lib/industrial-resources-api";

interface Props {
  onClose: () => void;
  onSaved: (resource: IndustrialResourceDetailDTO) => void;
}

/**
 * Cadastro de recurso. O tipo é definido na criação e não muda depois:
 * trocar "mão de obra" por "equipamento" mudaria o significado econômico de
 * todas as estruturas que já usam o recurso.
 */
export function IndustrialResourceFormModal({ onClose, onSaved }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<IndustrialResourceType>("LABOR");
  const [description, setDescription] = useState("");
  const [powerKw, setPowerKw] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await createIndustrialResource({
        name: name.trim(),
        type,
        ...(description.trim() ? { description: description.trim() } : {}),
        // Potência só vai quando informada — desconhecida continua desconhecida.
        ...(type === "EQUIPMENT" && powerKw.trim() ? { powerKw: powerKw.trim() } : {}),
      });
      onSaved(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar recurso");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FullWorkspaceModal
      open
      onClose={onClose}
      crumb="Gestão / Recursos industriais"
      crumbActive="Novo recurso"
      title="Novo recurso industrial"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={saving || !name.trim()}
            onClick={(event) => void handleSubmit(event)}
          >
            Criar recurso
          </button>
        </>
      }
    >
      <form onSubmit={(event) => void handleSubmit(event)}>
        {error && <p className="form-alert">{error}</p>}

        <FormSection
          title="Identificação"
          subtitle="Recurso é categoria econômica, não pessoa nem máquina individual."
        >
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="resource-name">Nome</label>
              <input
                id="resource-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Operador de produção"
              />
            </div>

            <div className="field">
              <label htmlFor="resource-type">Tipo</label>
              <select
                id="resource-type"
                value={type}
                onChange={(event) => setType(event.target.value as IndustrialResourceType)}
              >
                {INDUSTRIAL_RESOURCE_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {INDUSTRIAL_RESOURCE_TYPE_LABELS[option]}
                  </option>
                ))}
              </select>
              <span className="field__hint">
                Consumo medido em {INDUSTRIAL_RATE_UOM_LABELS[usageUomForResourceType(type)]}.
              </span>
            </div>

            <div className="field field--full">
              <label htmlFor="resource-description">Descrição</label>
              <input
                id="resource-description"
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            {type === "EQUIPMENT" && (
              <div className="field">
                <label htmlFor="resource-power">Potência (kW)</label>
                <input
                  id="resource-power"
                  type="text"
                  inputMode="decimal"
                  value={powerKw}
                  onChange={(event) => setPowerKw(event.target.value)}
                  placeholder="Deixe vazio se não souber"
                />
                <span className="field__hint">
                  Usada só para derivar energia. Vazio significa desconhecida — nunca zero.
                </span>
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
    </FullWorkspaceModal>
  );
}
