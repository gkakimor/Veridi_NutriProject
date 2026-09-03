import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  FormulationTemplateComponentInput,
  FormulationTemplateDTO,
  FormulationTemplateDiffDTO,
  FormulationTemplateVersionDTO,
  ItemDTO,
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
import { getItem, listItems } from "../../lib/items-api";
import { useContextualCreateOrigin } from "../../lib/use-contextual-create";
import { FormSection } from "../../components/FormSection";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { TemplateDiff } from "./TemplateDiff";
import { formatDateTime } from "../../lib/dates";
import { apiErrorMessage } from "../../lib/api-errors";
import { exigirDecimal } from "../../lib/decimal-field";
import { useAuth } from "../../app/AuthProvider";
import { ContextHelp, InfoHint } from "../../components/help";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
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

/**
 * Primeira página do catálogo — o que a lista mostra antes de digitar.
 *
 * Era 200 sobre 2.729 itens: 2.529 existiam e não apareciam na busca, sem
 * aviso. Quem busca agora pergunta ao servidor (`buscarItens`), que conhece
 * o catálogo inteiro.
 */
const PRIMEIRA_PAGINA = 50;

/** Um formato só de rótulo: o da lista inicial e o da busca não podem divergir. */
function opcaoDoItem(item: ItemDTO): EntityOption {
  return { id: item.id, code: item.code, name: item.name };
}

/** Mescla sem duplicar e sem trocar a referência à toa. */
function mesclarItens(atual: ItemDTO[], novos: ItemDTO[]): ItemDTO[] {
  const conhecidos = new Set(atual.map((item) => item.id));
  const ineditos = novos.filter((item) => !conhecidos.has(item.id));
  return ineditos.length === 0 ? atual : [...atual, ...ineditos];
}

/**
 * O que a matriz leva junto ao sair para cadastrar um item.
 *
 * Só o rascunho editável: o template carregado, o catálogo de itens e a
 * comparação de versões voltam do servidor na remontagem.
 */
type RascunhoTemplate = {
  nome: string;
  descricao: string;
  base: string;
  unidade: string;
  linhas: LinhaEditavel[];
};

/**
 * A linha que pediu o cadastro.
 *
 * O contexto atravessa `sessionStorage` e o token viaja na URL: o conteúdo
 * é lido como dado desconhecido. Chave que não é string vira `null`, e aí o
 * item novo não é aplicado em linha nenhuma — melhor que aplicá-lo na
 * primeira, que é a linha errada.
 */
function lerChaveDaLinha(contexto: Record<string, unknown> | null | undefined): string | null {
  const chave = contexto?.["rowKey"];
  return typeof chave === "string" && chave.length > 0 ? chave : null;
}

export function FormulationTemplateDetailPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "PRODUCTION";

  const [template, setTemplate] = useState<FormulationTemplateDTO | null>(null);
  const [items, setItems] = useState<ItemDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [linhas, setLinhas] = useState<LinhaEditavel[]>([]);
  const [base, setBase] = useState("1");
  const [unidade, setUnidade] = useState("un");
  const [diff, setDiff] = useState<FormulationTemplateDiffDTO | null>(null);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");

  /**
   * O rascunho restaurado ganha do servidor — uma vez.
   *
   * Quem volta do cadastro de item chega junto com a carga do template, e
   * ela traz a matriz como está salva. Sem esta trava a resposta chegaria
   * depois e apagaria exatamente o que a pessoa tinha acabado de digitar.
   * Vale só para a primeira carga: `run()` recarrega depois de cada ação, e
   * aí o servidor é a verdade.
   */
  const rascunhoRestaurado = useRef(false);

  const load = useCallback(() => {
    if (!templateId) return;
    getFormulationTemplate(templateId)
      .then((result) => {
        setTemplate(result);
        if (rascunhoRestaurado.current) {
          rascunhoRestaurado.current = false;
          return;
        }
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
    listItems({ pageSize: PRIMEIRA_PAGINA })
      .then((result) => setItems(result.items))
      .catch(() => setItems([]));
  }, []);

  /**
   * Busca no servidor. A carga inicial desta tela não filtra nada — template
   * compõe com qualquer item de estoque, ativo ou não —, então a busca
   * também não filtra: quem não aparecia na lista passa a ser encontrável,
   * e ninguém que já era elegível deixa de ser.
   */
  async function buscarItens(termo: string): Promise<EntityOption[]> {
    const resposta = await listItems({ search: termo, pageSize: PRIMEIRA_PAGINA });
    // O achado entra no catálogo da tela: o rótulo do item escolhido sai
    // daqui, e uma linha com id sem rótulo lê como campo vazio.
    setItems((atual) => mesclarItens(atual, resposta.items));
    return resposta.items.map(opcaoDoItem);
  }

  /**
   * Rótulo do que a matriz JÁ referencia.
   *
   * A linha do rascunho guarda só o `itemId`; o nome vem do catálogo. Com o
   * catálogo paginado, componente de item fora da página aparecia como campo
   * em branco — parecia linha por preencher, e o caminho natural era
   * escolher outro item ou cadastrar de novo. Buscar pelos ids resolve
   * exatamente os que faltam, uma vez cada.
   */
  const rotulosPedidos = useRef(new Set<string>());
  useEffect(() => {
    const faltando = [
      ...new Set(
        linhas
          .map((linha) => linha.itemId)
          .filter(
            (itemId) =>
              itemId &&
              !items.some((item) => item.id === itemId) &&
              !rotulosPedidos.current.has(itemId),
          ),
      ),
    ];
    if (faltando.length === 0) return;
    for (const itemId of faltando) rotulosPedidos.current.add(itemId);
    listItems({ ids: faltando, pageSize: faltando.length })
      .then((resultado) => setItems((atual) => mesclarItens(atual, resultado.items)))
      .catch(() => undefined);
  }, [linhas, items]);

  /**
   * Cadastro de item na TELA OFICIAL, sem perder a matriz.
   *
   * A coluna Item vive em linha de tabela, então o contexto carrega QUAL
   * linha pediu: sem isso o item criado voltaria para a primeira, que é a
   * linha errada.
   */
  const origem = useContextualCreateOrigin<RascunhoTemplate>({
    collectDraft: () => ({ nome, descricao, base, unidade, linhas }),
    restoreDraft: (draft) => {
      // Antes de qualquer `setState`: a carga do template está a caminho e
      // não pode sobrescrever o que volta aqui.
      rascunhoRestaurado.current = true;
      setNome(draft.nome ?? "");
      setDescricao(draft.descricao ?? "");
      setBase(draft.base ?? "");
      setUnidade(draft.unidade ?? "");
      setLinhas(Array.isArray(draft.linhas) ? draft.linhas : []);
    },
    onCreated: (result, record) => {
      const chave = lerChaveDaLinha(record.context);
      if (!chave) return;
      // Pelo id, imediatamente. O nome é provisório: fica no lugar até o
      // item real chegar logo abaixo.
      setLinhas((atual) =>
        atual.map((l) => (l.chave === chave ? { ...l, itemId: result.entityId } : l)),
      );
      /*
       * O catálogo desta tela vem paginado (200 itens) e o item recém-criado
       * pode não estar nele. Buscá-lo pelo id resolve as duas coisas de uma
       * vez: a linha ganha a unidade que o cadastro definiu, e o seletor
       * passa a ter o que mostrar. Falha aqui não desfaz a seleção — o id
       * já está na linha.
       */
      void getItem(result.entityId)
        .then((item) => {
          setItems((atual) => [item, ...atual.filter((row) => row.id !== item.id)]);
          setLinhas((atual) =>
            atual.map((l) =>
              l.chave === chave ? { ...l, unitCode: l.unitCode || item.unitCode } : l,
            ),
          );
        })
        .catch(() => undefined);
    },
  });

  async function run(action: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await action();
      load();
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao executar a ação"));
    } finally {
      setSaving(false);
    }
  }

  if (!template) {
    return (
      <div className="doc-body">
        {error ? <p className="form-alert" role="alert">{error}</p> : <p>Carregando…</p>}
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
          <PageBreadcrumbs items={[{ label: "Templates de Formulação", href: "/producao/templates-formulacao" }, { label: "Detalhe" }]} />
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

        {error && <p className="form-alert" role="alert">{error}</p>}

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
                          options={items.map(opcaoDoItem)}
                          onSearch={buscarItens}
                          canCreate={editavel}
                          createLabel="Novo item de estoque"
                          onCreateNew={() =>
                            origem.goCreate({
                              route: "/cadastros/itens/novo",
                              fieldKey: "itemId",
                              entityType: "item",
                              // Qual linha pediu — o item volta para ela.
                              context: { rowKey: linha.chave },
                            })
                          }
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
                        basisQuantity: exigirDecimal(base, "Base da formulação"),
                        outputUnitCode: unidade,
                        components: linhas
                          .filter((linha) => linha.itemId && linha.quantity)
                          .map(({ chave: _chave, ...resto }) => ({
                            ...resto,
                            quantity: exigirDecimal(resto.quantity, "Quantidade"),
                          })),
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
    </div>
  );
}
