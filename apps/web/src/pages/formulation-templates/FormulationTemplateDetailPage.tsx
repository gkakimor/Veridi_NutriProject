import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  FormulationTemplateComponentInput,
  FormulationTemplateDTO,
  FormulationTemplateDiffDTO,
  FormulationTemplateVersionDTO,
  ItemDTO,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import {
  FORMULATION_CALCULATION_MODE_LABELS,
  FORMULATION_TEMPLATE_VERSION_STATUS_LABELS,
  SUPPLY_RESPONSIBILITY_LABELS,
} from "@veridi/shared";
import {
  activateFormulationTemplateVersion,
  compareTemplateVersions,
  createTemplateVersionFrom,
  getFormulationTemplate,
  setFormulationTemplateArchived,
  updateFormulationTemplate,
  updateFormulationTemplateVersion,
} from "../../lib/formulation-templates-api";
import { listItems } from "../../lib/items-api";
import { listUnits } from "../../lib/units-api";
import { ItemFormModal } from "../items/ItemFormModal";
import { FormSection } from "../../components/FormSection";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { TemplateDiff } from "./TemplateDiff";
import { formatDateTime } from "../../lib/dates";
import { useAuth } from "../../app/AuthProvider";
import { ContextHelp, InfoHint } from "../../components/help";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";

/**
 * Detalhe de um template da biblioteca.
 *
 * Rascunho edita; versão ativa é histórica e só se lê. Para mudar uma matriz
 * ativa, cria-se uma versão nova — a anterior continua existindo porque
 * formulações de produto apontam para ela.
 */

/** ⓘ de um conceito da matriz, lido do registro central. */
function Dica({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

interface LinhaEditavel extends FormulationTemplateComponentInput {
  chave: string;
}

export function FormulationTemplateDetailPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "PRODUCTION";

  const [template, setTemplate] = useState<FormulationTemplateDTO | null>(null);
  const [items, setItems] = useState<ItemDTO[]>([]);
  const [units, setUnits] = useState<UnitOfMeasureDTO[]>([]);
  /**
   * Cadastro no contexto: guarda QUAL linha do rascunho pediu o item novo.
   * Sem a chave, o item criado voltaria para a primeira linha da matriz.
   */
  const [itemModalChave, setItemModalChave] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [linhas, setLinhas] = useState<LinhaEditavel[]>([]);
  const [base, setBase] = useState("1");
  const [unidade, setUnidade] = useState("un");
  const [diff, setDiff] = useState<FormulationTemplateDiffDTO | null>(null);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");

  const load = useCallback(() => {
    if (!templateId) return;
    getFormulationTemplate(templateId)
      .then((result) => {
        setTemplate(result);
        setNome(result.name);
        setDescricao(result.description ?? "");
        const rascunho = result.draftVersion;
        if (rascunho) {
          setBase(rascunho.basisQuantity);
          setUnidade(rascunho.outputUnitCode);
          setLinhas(
            rascunho.components.map((component, index) => ({
              chave: `${component.id}-${index}`,
              itemId: component.itemId,
              quantity: component.quantity,
              unitCode: component.unitCode,
              supplyResponsibility: component.supplyResponsibility,
            })),
          );
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar o template"),
      );
  }, [templateId]);

  useEffect(() => load(), [load]);
  useEffect(() => {
    listItems({ pageSize: 200 })
      .then((result) => setItems(result.items))
      .catch(() => setItems([]));
    // O cadastro de item no contexto pede as unidades do catálogo.
    listUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  async function run(action: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await action();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao executar a ação");
    } finally {
      setSaving(false);
    }
  }

  if (!template) {
    return (
      <div className="doc-body">
        {error ? <p className="form-alert">{error}</p> : <p>Carregando…</p>}
      </div>
    );
  }

  const rascunho = template.draftVersion;
  const ativa = template.activeVersion;
  const editavel = canEdit && rascunho !== null;

  const composicaoDaVersao = (version: FormulationTemplateVersionDTO) => (
    <div className="table-container">
      <table className="table">
        <thead>
          <tr>
            <th>Item</th>
            <th className="is-numeric">Quantidade</th>
            <th>Unidade</th>
            <th>
              Fornecimento padrão
              <Dica id="producao.template.fornecimentoPadrao" />
            </th>
          </tr>
        </thead>
        <tbody>
          {version.components.map((component) => (
            <tr key={component.id}>
              <td>
                {component.itemCode} — {component.itemName}
              </td>
              <td className="is-numeric">{component.quantity}</td>
              <td>{component.unitCode}</td>
              <td>{SUPPLY_RESPONSIBILITY_LABELS[component.supplyResponsibility]}</td>
            </tr>
          ))}
          {version.components.length === 0 && (
            <tr>
              <td colSpan={4} className="table__empty">
                Sem componentes.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="doc-page">
      <div className="doc-header">
        <div>
          <div className="doc-crumb">Produção / Templates de Formulação</div>
          <h1 className="doc-title">
            <code>{template.code}</code> {template.name}
            {template.archived && <span className="badge badge--neutral">Arquivado</span>}
          </h1>
          {template.description && <p className="page__subtitle">{template.description}</p>}
        </div>
        <div className="doc-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate("/producao/templates-formulacao")}
          >
            ← Voltar
          </button>
        </div>
      </div>

      <div className="doc-body">
        {/* Rascunho, ativa e arquivada convivem nesta tela, e a diferença
            entre elas é a regra inteira da capacidade. A explicação vem
            antes da primeira seção. */}
        <ContextHelp topic={helpTopics["producao.templateDetalhe"]} />

        {error && <p className="form-alert">{error}</p>}

        <FormSection
          title="Identificação"
          subtitle="O nome é escolhido por quem cria — um template é reutilizável e não carrega o nome de nenhum cliente."
        >
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="template-nome">Nome</label>
              <input
                id="template-nome"
                type="text"
                disabled={!canEdit}
                value={nome}
                onChange={(event) => setNome(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="template-descricao">Descrição</label>
              <input
                id="template-descricao"
                type="text"
                disabled={!canEdit}
                value={descricao}
                onChange={(event) => setDescricao(event.target.value)}
              />
            </div>
          </div>
          {canEdit && (
            <div className="line-actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={saving}
                onClick={() =>
                  void run(() =>
                    updateFormulationTemplate(template.id, {
                      name: nome,
                      description: descricao || null,
                    }),
                  )
                }
              >
                Salvar identificação
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={saving}
                onClick={() =>
                  void run(() => setFormulationTemplateArchived(template.id, !template.archived))
                }
              >
                {template.archived ? "Desarquivar" : "Arquivar"}
              </button>
            </div>
          )}
        </FormSection>

        {ativa && (
          <FormSection
            title={`Versão ativa — ${ativa.versionLabel}`}
            subtitle={`Base ${ativa.basisQuantity} ${ativa.outputUnitCode} · ${FORMULATION_CALCULATION_MODE_LABELS[ativa.calculationMode]} · ${ativa.components.length} componentes. Versão ativa é histórica: para alterar, crie uma nova versão.`}
          >
            {composicaoDaVersao(ativa)}
            {ativa.usageCount > 0 && (
              <p className="field__hint">
                {ativa.usageCount === 1
                  ? "1 formulação de produto nasceu desta versão."
                  : `${ativa.usageCount} formulações de produto nasceram desta versão.`}{" "}
                Nenhuma delas muda quando este template muda.
              </p>
            )}
            {canEdit && !rascunho && (
              <div className="line-actions">
                <button
                  type="button"
                  className="btn btn--accent btn--sm"
                  disabled={saving}
                  onClick={() => void run(() => createTemplateVersionFrom(ativa.id))}
                >
                  Criar nova versão
                </button>
              </div>
            )}
          </FormSection>
        )}

        {rascunho && (
          <FormSection
            title={`Rascunho — ${rascunho.versionLabel}`}
            subtitle="Só o rascunho é editável. Ative quando a matriz estiver pronta para ser reutilizada."
          >
            <div className="field-grid-2">
              <div className="field field--narrow">
                <label htmlFor="template-base">
                  Base da formulação
                  <Dica id="producao.template.base" />
                </label>
                <input
                  id="template-base"
                  type="text"
                  inputMode="decimal"
                  disabled={!editavel}
                  value={base}
                  onChange={(event) => setBase(event.target.value)}
                />
              </div>
              <div className="field field--narrow">
                <label htmlFor="template-unidade">Unidade da base</label>
                <input
                  id="template-unidade"
                  type="text"
                  disabled={!editavel}
                  value={unidade}
                  onChange={(event) => setUnidade(event.target.value)}
                />
              </div>
            </div>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="is-numeric">Quantidade</th>
                    <th>Unidade</th>
                    <th>Fornecimento padrão</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((linha, index) => (
                    <tr key={linha.chave}>
                      <td>
                        <SearchableEntitySelect
                          id={`template-item-${linha.chave}`}
                          value={linha.itemId}
                          onChange={(itemId) =>
                            setLinhas((atual) =>
                              atual.map((l, i) => (i === index ? { ...l, itemId } : l)),
                            )
                          }
                          placeholder="Digite código ou nome do item…"
                          /* Era o único campo do rascunho sem o `disabled` dos
                             vizinhos: quem não edita trocava o item na tela e
                             só descobria a recusa ao salvar. */
                          disabled={!editavel}
                          options={items.map((item) => ({
                            id: item.id,
                            code: item.code,
                            name: item.name,
                          }))}
                          canCreate={editavel}
                          createLabel="Novo item de estoque"
                          onCreateNew={() => setItemModalChave(linha.chave)}
                        />
                      </td>
                      <td className="is-numeric">
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={!editavel}
                          value={linha.quantity}
                          onChange={(event) =>
                            setLinhas((atual) =>
                              atual.map((l, i) =>
                                i === index ? { ...l, quantity: event.target.value } : l,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          disabled={!editavel}
                          value={linha.unitCode}
                          onChange={(event) =>
                            setLinhas((atual) =>
                              atual.map((l, i) =>
                                i === index ? { ...l, unitCode: event.target.value } : l,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <select
                          aria-label="Fornecimento padrão"
                          disabled={!editavel}
                          value={linha.supplyResponsibility ?? "VERIDI"}
                          onChange={(event) =>
                            setLinhas((atual) =>
                              atual.map((l, i) =>
                                i === index
                                  ? {
                                      ...l,
                                      supplyResponsibility: event.target.value as "VERIDI" | "CUSTOMER",
                                    }
                                  : l,
                              ),
                            )
                          }
                        >
                          <option value="VERIDI">Veridi</option>
                          <option value="CUSTOMER">Cliente</option>
                        </select>
                      </td>
                      <td>
                        {editavel && (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            aria-label="Remover componente"
                            onClick={() =>
                              setLinhas((atual) => atual.filter((_, i) => i !== index))
                            }
                          >
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {linhas.length === 0 && (
                    <tr>
                      <td colSpan={5} className="table__empty">
                        Nenhum componente ainda.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {editavel && (
              <div className="line-actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() =>
                    setLinhas((atual) => [
                      ...atual,
                      {
                        chave: `nova-${atual.length}-${Date.now()}`,
                        itemId: "",
                        quantity: "",
                        unitCode: "g",
                        supplyResponsibility: "VERIDI",
                      },
                    ])
                  }
                >
                  + Adicionar componente
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={saving}
                  onClick={() =>
                    void run(() =>
                      updateFormulationTemplateVersion(rascunho.id, {
                        basisQuantity: base,
                        outputUnitCode: unidade,
                        components: linhas
                          .filter((linha) => linha.itemId && linha.quantity)
                          .map(({ chave: _chave, ...resto }) => resto),
                      }),
                    )
                  }
                >
                  Salvar rascunho
                </button>
                <button
                  type="button"
                  className="btn btn--accent btn--sm"
                  disabled={saving || rascunho.components.length === 0}
                  onClick={() => void run(() => activateFormulationTemplateVersion(rascunho.id))}
                >
                  Ativar versão
                </button>
              </div>
            )}
          </FormSection>
        )}

        <FormSection
          title="Histórico de versões"
          subtitle="Versões anteriores continuam existindo: formulações criadas a partir delas apontam para elas."
        >
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Versão</th>
                  <th>Situação</th>
                  <th>Origem</th>
                  <th className="is-numeric">Componentes</th>
                  <th className="is-numeric">
                    Usada por
                    <Dica id="producao.template.usadaPor" />
                  </th>
                  <th>Criada em</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {[...template.versions].reverse().map((version) => (
                  <tr key={version.id}>
                    <td>{version.versionLabel}</td>
                    <td>
                      <span
                        className={
                          version.status === "ACTIVE"
                            ? "badge badge--active"
                            : version.status === "DRAFT"
                              ? "badge badge--warn"
                              : "badge badge--neutral"
                        }
                      >
                        {FORMULATION_TEMPLATE_VERSION_STATUS_LABELS[version.status]}
                      </span>
                    </td>
                    <td>
                      {version.sourceVersionNumber
                        ? `Criada a partir da V${version.sourceVersionNumber}`
                        : "—"}
                    </td>
                    <td className="is-numeric">{version.components.length}</td>
                    <td className="is-numeric">{version.usageCount}</td>
                    <td>{formatDateTime(version.createdAt)}</td>
                    <td>
                      {version.sourceVersionId && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={saving}
                          onClick={() =>
                            void (async () => {
                              try {
                                setDiff(
                                  await compareTemplateVersions(version.sourceVersionId!, version.id),
                                );
                              } catch (err) {
                                setError(
                                  err instanceof Error ? err.message : "Falha ao comparar",
                                );
                              }
                            })()
                          }
                        >
                          Comparar versões
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {diff && (
            <div className="template-diff-wrapper">
              <TemplateDiff diff={diff} />
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDiff(null)}>
                Fechar comparação
              </button>
            </div>
          )}
        </FormSection>
      </div>

      {itemModalChave !== null && (
        <ItemFormModal
          mode="create"
          item={null}
          units={units}
          onClose={() => setItemModalChave(null)}
          onSaved={(created) => {
            const chave = itemModalChave;
            setItemModalChave(null);
            if (!created || !chave) return;
            // O item novo entra no catálogo e já fica escolhido na linha que
            // pediu por ele — o resto do rascunho continua como estava.
            setItems((atual) => [created, ...atual.filter((item) => item.id !== created.id)]);
            setLinhas((atual) =>
              atual.map((l) =>
                l.chave === chave
                  ? { ...l, itemId: created.id, unitCode: l.unitCode || created.unitCode }
                  : l,
              ),
            );
          }}
        />
      )}
    </div>
  );
}
