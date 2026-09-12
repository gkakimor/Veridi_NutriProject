import { useCallback, useEffect, useRef, useState } from "react";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
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
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { ApiValidationError, apiErrorMessage } from "../../lib/api-errors";
import { exigirDecimalOpcional } from "../../lib/decimal-field";
import { erroDeInteiro, lerInteiroOpcional } from "../../lib/integer-input";
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
 * Dois formulários com o mesmo conteúdo.
 *
 * Todo campo do `FormState` é texto, então comparar valor a valor responde
 * "há alteração?" sem serializar nada e sem instrumentar cada `onChange` —
 * que é o jeito que esquece o campo acrescentado na semana seguinte.
 */
function mesmoFormulario(a: FormState, b: FormState): boolean {
  return (Object.keys(a) as (keyof FormState)[]).every((chave) => a[chave] === b[chave]);
}

type ChaveInteira = "dosesPerPackage" | "shelfLifeMonths";

/**
 * Os dois inteiros do Projeto — contagens: doses e meses não têm casa decimal.
 *
 * Saíam por `Number(texto)`: `abc` virava `NaN`, o JSON escrevia `null`, e
 * salvar apagava o valor gravado (PROJECT-INT-FIELDS-01). Agora passam pela
 * leitura estrita das condições do Orçamento, e a regra é a da API
 * (`optionalPositiveInt`): inteiro maior que zero, sem teto.
 */
const INTEIROS: Record<ChaveInteira, { rotulo: string; erroId: string }> = {
  dosesPerPackage: { rotulo: "Doses por embalagem", erroId: "project-doses-error" },
  shelfLifeMonths: { rotulo: "Vida útil (meses)", erroId: "project-shelf-life-error" },
};
const INTEIRO_MAIOR_QUE_ZERO = { minimo: 1, maximo: null } as const;

/**
 * O inteiro como vai ao servidor. Vazio é `null` — "não informado". O que a
 * tela não lê não tem forma de envio: salvar fica preso antes, e chegar aqui
 * com texto ilegível é defeito, que falha alto em vez de apagar o gravado.
 */
function inteiroParaEnvio(texto: string): number | null {
  const leitura = lerInteiroOpcional(texto);
  if (leitura.tipo === "valido") return leitura.valor;
  if (leitura.tipo === "vazio") return null;
  throw new Error("Inteiro ilegível não vai ao servidor.");
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
   * O formulário como ele estava ao abrir — a referência da comparação.
   *
   * Criar parte do formulário em branco com os defaults da tela; editar parte
   * dos valores que vieram do servidor. Nos dois casos ABRIR não é alterar:
   * data de hoje preenchida sozinha e select em "—" não podem virar pergunta
   * de descarte, senão a guarda vira ruído e a pessoa aprende a ignorá-la.
   *
   * Vira o que acabou de ser gravado depois de um salvamento: o que está na
   * tela passou a ser o que está no servidor.
   */
  const baseline = useRef<FormState | null>(null);
  if (baseline.current === null) baseline.current = form;

  const isDirty = !mesmoFormulario(baseline.current, form);
  const { confirmarDescarte, liberarGuarda } = useUnsavedChangesGuard({
    isDirty,
    substantivo: "projeto",
  });

  /**
   * Cancelar, ✕ e Esc: o router não vê nada disso — a guarda vê.
   *
   * Memorizado porque vai para `onClose` do `FullWorkspaceModal`, e é
   * dependência do efeito que instala foco, trap e Escape lá dentro. Recriado
   * a cada render, o efeito se desmontava e remontava a CADA tecla digitada,
   * devolvendo o foco ao diálogo no meio da palavra — o campo ficava com a
   * primeira letra e o resto sumia.
   */
  const fechar = useCallback(() => confirmarDescarte(onClose), [confirmarDescarte, onClose]);

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
    listCustomers({ active: true, pageSize: 50 })
      .then((result) => setCustomers(result.customers))
      .catch(() => setCustomers([]));
    getProjectVocabulary()
      .then((vocabulary) => {
        setConcepts(vocabulary.concepts);
        setChannels(vocabulary.channels);
      })
      .catch(() => undefined);
  }, []);

  /*
   * Busca no SERVIDOR, com os MESMOS filtros da carga inicial: achar nao e o
   * mesmo que poder usar, e a busca torna encontravel quem ja era elegivel,
   * nunca quem nao era. O achado entra no estado de onde as opcoes derivam,
   * porque a escolha e resolvida por ele. A carga inicial passou a servir so
   * a abertura do campo — acima do teto o registro existia e nao aparecia,
   * com "+ Novo" logo acima convidando a duplicar.
   */
  async function buscarClientes(termo: string): Promise<EntityOption[]> {
    const resultado = await listCustomers({ active: true, search: termo, pageSize: 50 });
    const novos = resultado.customers;
    setCustomers((atual) => {
      const conhecidos = new Set(atual.map((x) => x.id));
      return [...atual, ...novos.filter((x) => !conhecidos.has(x.id))];
    });
    return novos.map((c) => ({ id: c.id, code: c.code, name: c.tradeName ?? c.legalName }));
  }

  /*
   * Inteiro ilegível fica no campo como foi digitado, com o erro ao lado, e
   * prende criar e salvar. Vazio segue: é "não informado".
   */
  const erroDoInteiro = (chave: ChaveInteira) =>
    erroDeInteiro(INTEIROS[chave].rotulo, form[chave], INTEIRO_MAIOR_QUE_ZERO);
  const temInteiroIlegivel = (Object.keys(INTEIROS) as ChaveInteira[]).some(
    (chave) => erroDoInteiro(chave) !== null,
  );
  /** Liga o campo ao seu erro: quem usa leitor de tela ouve a regra junto do campo. */
  const ariaDoInteiro = (chave: ChaveInteira) =>
    erroDoInteiro(chave) === null
      ? {}
      : { "aria-invalid": true, "aria-describedby": INTEIROS[chave].erroId };
  const avisoDoInteiro = (chave: ChaveInteira) => {
    const erro = erroDoInteiro(chave);
    return erro === null ? null : (
      <p className="field__error" id={INTEIROS[chave].erroId}>
        {erro}
      </p>
    );
  };

  async function handleSave() {
    // O botão já fica preso: o que a tela não lê não sai dela por caminho nenhum.
    if (temInteiroIlegivel) return;
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
        dosesPerPackage: inteiroParaEnvio(form.dosesPerPackage),
        targetAgeGroup: (form.targetAgeGroup || null) as never,
        // Único decimal do formulário. `dosesPerPackage` e `shelfLifeMonths`
        // são contagens inteiras e passam pela leitura estrita de inteiro.
        minimumBatchQuantity: exigirDecimalOpcional(form.minimumBatchQuantity, "Lote mínimo"),
        shelfLifeMonths: inteiroParaEnvio(form.shelfLifeMonths),
      };

      const saved = project
        ? await updateProject(project.id, payload)
        : await createProject(payload);
      /*
       * A pendência morre ANTES da navegação, não depois.
       *
       * `onSaved` fecha o modal e vai para a ficha do projeto, tudo na mesma
       * função — o estado desta renderização ainda diz "alterado", e a guarda
       * perguntaria se a pessoa quer descartar o que ela acabou de gravar.
       */
      baseline.current = form;
      liberarGuarda(() => onSaved(saved));
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
      onClose={fechar}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={fechar}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--accent"
            disabled={
              saving || !form.customerId || form.name.trim().length < 3 || temInteiroIlegivel
            }
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
            onSearch={buscarClientes}
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
            /* Sair para cadastrar o cliente NÃO é descartar: o rascunho vai
               junto e volta aplicado. Perguntar aqui seria a guarda avisando
               de uma perda que não acontece. */
            onCreateNew={() =>
              liberarGuarda(() =>
                origem.goCreate({
                  route: "/cadastros/clientes/novo",
                  fieldKey: "customerId",
                  entityType: "customer",
                }),
              )
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
            {...ariaDoInteiro("dosesPerPackage")}
          />
          {avisoDoInteiro("dosesPerPackage")}
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
            {...ariaDoInteiro("shelfLifeMonths")}
          />
          {avisoDoInteiro("shelfLifeMonths")}
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
