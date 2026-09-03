import { useEffect, useState } from "react";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import type { CustomerDTO, ProjectDTO } from "@veridi/shared";
import {
  DOSAGE_FORMS,
  DOSAGE_FORM_LABELS,
  PRESENTATION_TYPES,
  PRESENTATION_TYPE_LABELS,
  TARGET_AGE_GROUPS,
  TARGET_AGE_GROUP_LABELS,
} from "@veridi/shared";
import { FormSection } from "../../components/FormSection";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { ApiValidationError, apiErrorMessage } from "../../lib/api-errors";
import { exigirDecimalOpcional } from "../../lib/decimal-field";
import { listCustomers } from "../../lib/customers-api";
import { useContextualCreateOrigin } from "../../lib/use-contextual-create";
import { createProject, getProjectVocabulary, updateProject } from "../../lib/projects-api";

type FormState = {
  customerId: string;
  name: string;
  concept: string;
  channel: string;
  externalCode: string;
  entryDate: string;
  notes: string;
  dosageForm: string;
  presentationType: string;
  doseAmount: string;
  dosesPerPackage: string;
  targetAgeGroup: string;
  minimumBatchQuantity: string;
  shelfLifeMonths: string;
};

function initialState(project: ProjectDTO | null): FormState {
  return {
    customerId: project?.customerId ?? "",
    name: project?.name ?? "",
    concept: project?.concept ?? "",
    channel: project?.channel ?? "",
    externalCode: project?.externalCode ?? "",
    entryDate: (project?.entryDate ?? new Date().toISOString()).slice(0, 10),
    notes: project?.notes ?? "",
    dosageForm: project?.dosageForm ?? "",
    presentationType: project?.presentationType ?? "",
    doseAmount: project?.doseAmount ?? "",
    dosesPerPackage: project?.dosesPerPackage ? String(project.dosesPerPackage) : "",
    targetAgeGroup: project?.targetAgeGroup ?? "",
    minimumBatchQuantity: project?.minimumBatchQuantity ?? "",
    shelfLifeMonths: project?.shelfLifeMonths ? String(project.shelfLifeMonths) : "",
  };
}

/**
 * Cadastro/edição dos dados básicos do projeto.
 *
 * Conceito e canal são vocabulário ABERTO: o campo é texto livre com
 * sugestões dos valores já usados na base — o vocabulário do negócio
 * evolui, e um enum fechado o congelaria.
 */
export function ProjectFormModal({
  project,
  onClose,
  onSaved,
}: {
  project: ProjectDTO | null;
  onClose: () => void;
  onSaved: (project: ProjectDTO) => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(project));
  const [customers, setCustomers] = useState<CustomerDTO[]>([]);
  const [concepts, setConcepts] = useState<string[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Cadastro de cliente na TELA OFICIAL, sem perder o projeto.
   *
   * Sair daqui DESMONTA este formulário — é modal, não rota. Quem o reabre
   * na volta é a tela hospedeira, que mantém `?novo=1` (listagem) ou
   * `?editar=1` (ficha) na URL enquanto ele está aberto; o rascunho volta
   * pelo contexto e é reaplicado assim que o formulário monta de novo.
   */
  const origem = useContextualCreateOrigin<FormState>({
    // Só o formulário: clientes, conceitos e canais vêm do servidor e são
    // recarregados na volta.
    collectDraft: () => form,
    restoreDraft: (draft) => setForm((prev) => ({ ...prev, ...draft })),
    // Pelo id: o nome digitado na busca escolheria o cliente errado.
    onCreated: (result) => setForm((prev) => ({ ...prev, customerId: result.entityId })),
  });

  useEffect(() => {
    listCustomers({ active: true, pageSize: 1000 })
      .then((result) => setCustomers(result.customers))
      .catch(() => setCustomers([]));
    getProjectVocabulary()
      .then((vocabulary) => {
        setConcepts(vocabulary.concepts);
        setChannels(vocabulary.channels);
      })
      .catch(() => undefined);
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        customerId: form.customerId,
        name: form.name.trim(),
        concept: form.concept.trim() || null,
        channel: form.channel.trim() || null,
        externalCode: form.externalCode.trim() || null,
        entryDate: new Date(`${form.entryDate}T12:00:00`).toISOString(),
        notes: form.notes.trim() || null,
        dosageForm: (form.dosageForm || null) as never,
        presentationType: (form.presentationType || null) as never,
        doseAmount: form.doseAmount.trim() || null,
        dosesPerPackage: form.dosesPerPackage.trim() ? Number(form.dosesPerPackage) : null,
        targetAgeGroup: (form.targetAgeGroup || null) as never,
        // Único decimal do formulário. `dosesPerPackage` e `shelfLifeMonths`
        // são contagens inteiras — doses e meses não têm casa decimal — e
        // continuam como estão.
        minimumBatchQuantity: exigirDecimalOpcional(form.minimumBatchQuantity, "Lote mínimo"),
        shelfLifeMonths: form.shelfLifeMonths.trim() ? Number(form.shelfLifeMonths) : null,
      };

      const saved = project
        ? await updateProject(project.id, payload)
        : await createProject(payload);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiValidationError) {
        setError(err.issues.map((issue) => issue.message).join("; "));
      } else {
        setError(apiErrorMessage(err, "Falha ao salvar projeto"));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <FullWorkspaceModal
      open
      crumb="Comercial"
      crumbActive="Projetos"
      title={project ? project.name : "Novo projeto"}
      {...(project ? { codeChip: project.code } : {})}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--accent"
            disabled={saving || !form.customerId || form.name.trim().length < 3}
            onClick={() => void handleSave()}
          >
            {saving ? "Salvando…" : project ? "Salvar alterações" : "Criar projeto"}
          </button>
        </>
      }
    >
      {error && <p className="form-alert" role="alert">{error}</p>}

      <FormSection title="Projeto" subtitle="Projeto private label sempre pertence a um cliente.">
        <div className="field">
          <label htmlFor="project-customer">
            Cliente <span className="req">*</span>
          </label>
          <SearchableEntitySelect
            id="project-customer"
            value={form.customerId}
            onChange={(selectedId) => setForm((prev) => ({ ...prev, customerId: selectedId }))}
            placeholder="Digite código ou nome do cliente…"
            options={customers.map((customer) => ({
              id: customer.id,
              code: customer.code,
              name: customer.legalName,
              // Nome fantasia é como o cliente se chama no telefone; a
              // razão social é como ele assina contrato. Quem procura usa
              // o primeiro, e o CNPJ quando não lembra nenhum dos dois.
              ...(customer.tradeName ? { hint: customer.tradeName } : {}),
              searchTerms: [customer.tradeName ?? "", customer.cnpj ?? ""]
                .filter(Boolean)
                .join(" "),
            }))}
            canCreate
            createLabel="Novo cliente"
            onCreateNew={() =>
              origem.goCreate({
                route: "/cadastros/clientes/novo",
                fieldKey: "customerId",
                entityType: "customer",
              })
            }
          />
        </div>

        <div className="field">
          <label htmlFor="project-name">
            Nome do projeto <span className="req">*</span>
          </label>
          <input
            id="project-name"
            type="text"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
          />
        </div>

        <div className="field field--narrow">
          <label htmlFor="project-concept">Conceito</label>
          <input
            id="project-concept"
            type="text"
            list="project-concepts"
            placeholder="Detox, Sono, Massa Muscular…"
            value={form.concept}
            onChange={(event) => setForm((prev) => ({ ...prev, concept: event.target.value }))}
          />
          <datalist id="project-concepts">
            {concepts.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <p className="field__hint">Sugestões vêm dos valores já usados — novos são aceitos.</p>
        </div>

        <div className="field field--narrow">
          <label htmlFor="project-channel">Canal</label>
          <input
            id="project-channel"
            type="text"
            list="project-channels"
            placeholder="Academia, Distribuidora, Farm. Manip.…"
            value={form.channel}
            onChange={(event) => setForm((prev) => ({ ...prev, channel: event.target.value }))}
          />
          <datalist id="project-channels">
            {channels.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </div>

        <div className="field field--narrow">
          <label htmlFor="project-entry-date">Data de entrada</label>
          <input
            id="project-entry-date"
            type="date"
            value={form.entryDate}
            onChange={(event) => setForm((prev) => ({ ...prev, entryDate: event.target.value }))}
          />
        </div>

        <div className="field field--narrow">
          <label htmlFor="project-external-code">Código legado</label>
          <input
            id="project-external-code"
            type="text"
            placeholder="0001PL"
            value={form.externalCode}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, externalCode: event.target.value }))
            }
          />
        </div>
      </FormSection>

      <FormSection
        title="Perfil técnico pretendido"
        subtitle="Briefing do produto — ainda não é o cadastro do Produto. É copiado na aprovação."
      >
        <div className="field field--narrow">
          <label htmlFor="project-dosage-form">Forma farmacêutica</label>
          <select
            id="project-dosage-form"
            value={form.dosageForm}
            onChange={(event) => setForm((prev) => ({ ...prev, dosageForm: event.target.value }))}
          >
            <option value="">—</option>
            {DOSAGE_FORMS.map((option) => (
              <option key={option} value={option}>
                {DOSAGE_FORM_LABELS[option]}
              </option>
            ))}
          </select>
        </div>

        <div className="field field--narrow">
          <label htmlFor="project-presentation">Apresentação</label>
          <select
            id="project-presentation"
            value={form.presentationType}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, presentationType: event.target.value }))
            }
          >
            <option value="">—</option>
            {PRESENTATION_TYPES.map((option) => (
              <option key={option} value={option}>
                {PRESENTATION_TYPE_LABELS[option]}
              </option>
            ))}
          </select>
        </div>

        <div className="field field--narrow">
          <label htmlFor="project-doses">Doses por embalagem</label>
          <input
            id="project-doses"
            type="text"
            inputMode="numeric"
            value={form.dosesPerPackage}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, dosesPerPackage: event.target.value }))
            }
          />
        </div>

        <div className="field field--narrow">
          <label htmlFor="project-age-group">Público-alvo</label>
          <select
            id="project-age-group"
            value={form.targetAgeGroup}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, targetAgeGroup: event.target.value }))
            }
          >
            <option value="">—</option>
            {TARGET_AGE_GROUPS.map((option) => (
              <option key={option} value={option}>
                {TARGET_AGE_GROUP_LABELS[option]}
              </option>
            ))}
          </select>
        </div>

        <div className="field field--narrow">
          <label htmlFor="project-minimum-batch">Lote mínimo</label>
          <input
            id="project-minimum-batch"
            type="text"
            inputMode="decimal"
            value={form.minimumBatchQuantity}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, minimumBatchQuantity: event.target.value }))
            }
          />
        </div>

        <div className="field field--narrow">
          <label htmlFor="project-shelf-life">Vida útil (meses)</label>
          <input
            id="project-shelf-life"
            type="text"
            inputMode="numeric"
            value={form.shelfLifeMonths}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, shelfLifeMonths: event.target.value }))
            }
          />
        </div>
      </FormSection>

      <FormSection title="Observações">
        <div className="field">
          <label htmlFor="project-notes">Notas internas</label>
          <textarea
            id="project-notes"
            rows={3}
            value={form.notes}
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
          />
        </div>
      </FormSection>
    </FullWorkspaceModal>
  );
}
