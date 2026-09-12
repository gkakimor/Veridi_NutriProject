import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  CostTemplateDTO,
  CostTemplateResourceUsageInput,
  CostTemplateVersionDTO,
  IndustrialResourceDTO,
  TemplateDiffDTO,
} from "@veridi/shared";
import {
  ENERGY_CALCULATION_MODE_LABELS,
  INDUSTRIAL_COST_BASIS_LABELS,
  INDUSTRIAL_COST_CATEGORY_LABELS,
  INDUSTRIAL_RATE_UOM_LABELS,
  INDUSTRIAL_USAGE_BASIS_LABELS,
  TEMPLATE_VERSION_STATUS_LABELS,
  acceptsResourceCount,
} from "@veridi/shared";
import {
  activateCostTemplateVersion,
  compareCostTemplateVersions,
  createCostTemplateVersionFrom,
  getCostTemplate,
  setCostTemplateArchived,
  updateCostTemplate,
  updateCostTemplateVersion,
} from "../../lib/cost-pricing-templates-api";
import { listIndustrialResources } from "../../lib/industrial-resources-api";
import { FormSection } from "../../components/FormSection";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { TemplateDiffTable } from "../../components/TemplateDiffTable";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { formatDateTime } from "../../lib/dates";
import { apiErrorMessage } from "../../lib/api-errors";
import { exigirDecimal } from "../../lib/decimal-field";
import {
  assinaturaDoDocumento,
  decimalComparavel,
  inteiroComparavel,
  textoComparavel,
} from "../../lib/dirty-fields";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
import {
  ResourceUsageAmount,
  exigirQuantidadeDeRecursos,
} from "../../components/ResourceUsageAmount";
import { useAuth } from "../../app/AuthProvider";

/**
 * Detalhe de um template de estrutura.
 *
 * Só configuração aparece aqui — quantas horas de cada recurso, qual modo de
 * energia, que premissas. Nenhum valor em reais de tarifa: mostrar "R$ 88/h"
 * faria parecer que o número pertence à matriz, quando ele pertence ao
 * cadastro do recurso e muda com o tempo.
 */

interface LinhaRecurso extends CostTemplateResourceUsageInput {
  chave: string;
  /** Texto do campo "Quantidade de recursos" — vira inteiro só ao salvar (§87). */
  quantidadeDeRecursos: string;
}

/** As linhas de recurso da versão, na forma que a tela edita. */
function linhasDaVersao(version: CostTemplateVersionDTO): LinhaRecurso[] {
  return version.resourceUsages.map((usage, index) => ({
    chave: `${usage.id}-${index}`,
    industrialResourceId: usage.industrialResourceId,
    usageQuantity: usage.usageQuantity,
    usageUom: usage.usageUom,
    usageBasis: usage.usageBasis,
    quantidadeDeRecursos: String(usage.resourceCount),
  }));
}

/**
 * A assinatura do rascunho — base, unidade, energia e recursos numa string.
 *
 * A chave da linha fica de fora: ela é identidade de renderização e muda a cada
 * recarga. Linha em branco também: "+ Adicionar recurso" sem preencher nada não
 * é trabalho a perder, e é o que o próprio salvamento já descarta.
 */
function assinaturaDasLinhas(linhas: LinhaRecurso[]): string {
  return assinaturaDoDocumento(
    linhas
      .filter((linha) => linha.industrialResourceId !== "" || linha.usageQuantity.trim() !== "")
      .map((linha) => ({
        recurso: linha.industrialResourceId,
        quantidade: decimalComparavel(linha.usageQuantity),
        unidade: linha.usageUom,
        base: linha.usageBasis ?? null,
        recursos: inteiroComparavel(linha.quantidadeDeRecursos),
      })),
  );
}

function assinaturaDoRascunho(
  base: string,
  unidade: string,
  modoEnergia: string,
  recursoEnergia: string,
  linhas: LinhaRecurso[],
): string {
  return assinaturaDoDocumento({
    base: decimalComparavel(base),
    unidade,
    modoEnergia,
    // Fora do modo derivado o campo nem é enviado: escolher e voltar atrás não deixa pendência.
    recursoEnergia: modoEnergia === "FROM_EQUIPMENT" ? recursoEnergia : "",
    linhas: assinaturaDasLinhas(linhas),
  });
}

export function CostTemplateDetailPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "PRODUCTION";

  const [template, setTemplate] = useState<CostTemplateDTO | null>(null);
  const [recursos, setRecursos] = useState<IndustrialResourceDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  /*
   * A ação em curso pelo nome, não um booleano — o mesmo desenho da Política
   * de Precificação: só o botão clicado diz "Salvando…", e todos recusam o
   * segundo clique enquanto a gravação está no ar.
   */
  const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null);
  const saving = acaoEmCurso !== null;
  /** O que a última ação gravou, no bloco que a disparou — uma frase, nunca uma pilha. */
  const [feito, setFeito] = useState<{ bloco: string; texto: string } | null>(null);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [base, setBase] = useState("1000");
  const [unidade, setUnidade] = useState("un");
  const [modoEnergia, setModoEnergia] = useState<"NONE" | "DIRECT" | "FROM_EQUIPMENT">("NONE");
  const [recursoEnergia, setRecursoEnergia] = useState<string>("");
  const [linhas, setLinhas] = useState<LinhaRecurso[]>([]);
  const [diff, setDiff] = useState<TemplateDiffDTO | null>(null);

  /*
   * O que o servidor devolveu na última leitura, campo a campo.
   *
   * Identificação e rascunho gravam separado, e as duas ações terminam em
   * `load()`: salvar a identificação reescrevia a base do rascunho com o valor
   * gravado, e a edição pendente do outro bloco sumia sem aviso. Com a leitura
   * anterior em mãos dá para separar "o campo ainda está como o servidor
   * deixou" de "a pessoa mexeu nele" — e só o primeiro recebe a leitura nova.
   *
   * Começa nos MESMOS valores iniciais do estado: na primeira carga ninguém
   * digitou nada e tudo tem de ser substituído.
   */
  const lido = useRef({
    nome: "",
    descricao: "",
    base: "1000",
    unidade: "un",
    modoEnergia: "NONE" as "NONE" | "DIRECT" | "FROM_EQUIPMENT",
    recursoEnergia: "",
    linhas: assinaturaDasLinhas([]),
  });

  const load = useCallback(() => {
    if (!templateId) return;
    getCostTemplate(templateId)
      .then((result) => {
        setTemplate(result);
        const anterior = lido.current;
        const rascunho = result.draftVersion;
        const novasLinhas = rascunho ? linhasDaVersao(rascunho) : [];
        lido.current = {
          nome: result.name,
          descricao: result.description ?? "",
          base: rascunho?.referenceOutputQuantity ?? anterior.base,
          unidade: rascunho?.referenceOutputUomCode ?? anterior.unidade,
          modoEnergia: rascunho?.energyCalculationMode ?? anterior.modoEnergia,
          recursoEnergia: rascunho?.energyResourceId ?? "",
          linhas: rascunho ? assinaturaDasLinhas(novasLinhas) : anterior.linhas,
        };
        setNome((atual) => (atual === anterior.nome ? lido.current.nome : atual));
        setDescricao((atual) => (atual === anterior.descricao ? lido.current.descricao : atual));
        if (rascunho) {
          setBase((atual) => (atual === anterior.base ? rascunho.referenceOutputQuantity : atual));
          setUnidade((atual) =>
            atual === anterior.unidade ? rascunho.referenceOutputUomCode : atual,
          );
          setModoEnergia((atual) =>
            atual === anterior.modoEnergia ? rascunho.energyCalculationMode : atual,
          );
          setRecursoEnergia((atual) =>
            atual === anterior.recursoEnergia ? (rascunho.energyResourceId ?? "") : atual,
          );
          setLinhas((atual) =>
            assinaturaDasLinhas(atual) === anterior.linhas ? novasLinhas : atual,
          );
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar o template"),
      );
  }, [templateId]);

  useEffect(() => load(), [load]);
  useEffect(() => {
    listIndustrialResources({ pageSize: 100 })
      .then((result) => setRecursos(result.resources))
      .catch(() => setRecursos([]));
  }, []);

  async function run(
    acao: string,
    action: () => Promise<unknown>,
    sucesso?: { bloco: string; texto: string },
  ) {
    setAcaoEmCurso(acao);
    setError(null);
    setFeito(null);
    try {
      await action();
      load();
      // Só depois de a ação passar: erro que caísse aqui deixaria a tela
      // dizendo "salvo" sobre o que não foi gravado.
      if (sucesso) setFeito(sucesso);
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao executar a ação"));
    } finally {
      setAcaoEmCurso(null);
    }
  }

  /*
   * Dois blocos gravam separado aqui — identificação e rascunho —, cada um com
   * o seu botão, e a guarda soma os dois: "Salvar identificação" não absolve a
   * base alterada, e "Salvar rascunho" não absolve o nome trocado.
   *
   * Fora da conta fica tudo que a tela apenas mostra: a versão ativa, o
   * histórico, quantas estruturas nasceram do template e a comparação entre
   * versões — nada disso é digitação pendente.
   */
  const rascunhoDoServidor = template?.draftVersion ?? null;
  const identificacaoAlterada =
    template !== null &&
    canEdit &&
    (textoComparavel(nome) !== textoComparavel(template.name) ||
      textoComparavel(descricao) !== textoComparavel(template.description));
  const rascunhoAlterado =
    rascunhoDoServidor !== null &&
    canEdit &&
    assinaturaDoRascunho(base, unidade, modoEnergia, recursoEnergia, linhas) !==
      assinaturaDoRascunho(
        rascunhoDoServidor.referenceOutputQuantity,
        rascunhoDoServidor.referenceOutputUomCode,
        rascunhoDoServidor.energyCalculationMode,
        rascunhoDoServidor.energyResourceId ?? "",
        linhasDaVersao(rascunhoDoServidor),
      );
  useUnsavedChangesGuard({
    isDirty: identificacaoAlterada || rascunhoAlterado,
    substantivo: "modelo de estrutura de custo",
  });

  /**
   * A frase de estado do bloco: o que falta gravar, ou o que acabou de gravar.
   *
   * Pendência vem primeiro — confirmação de "salvo" ao lado de campo já
   * alterado de novo mente sobre o que está no servidor.
   */
  function estadoDoBloco(bloco: string, alterado: boolean) {
    if (alterado) {
      return (
        <span className="form-status form-status--dirty" role="status">
          Alterações não salvas
        </span>
      );
    }
    if (feito?.bloco === bloco) {
      return (
        <span className="form-status" role="status">
          {feito.texto}
        </span>
      );
    }
    return null;
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
  // Mão de obra e equipamento se contam; energia não — o kWh já é o total (§87).
  const contaRecursosDaLinha = (industrialResourceId: string) => {
    const recurso = recursos.find((row) => row.id === industrialResourceId);
    return recurso ? acceptsResourceCount(recurso.type) : false;
  };

  const composicao = (version: CostTemplateVersionDTO) => (
    <>
      <dl className="definition-list">
        <dt>Base de produção sugerida</dt>
        <dd>
          {formatQuantity(version.referenceOutputQuantity)} {version.referenceOutputUomCode}
        </dd>
        <dt>Energia</dt>
        <dd>
          {ENERGY_CALCULATION_MODE_LABELS[version.energyCalculationMode]}
          {version.energyResourceName ? ` — ${version.energyResourceName}` : ""}
        </dd>
      </dl>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Recurso</th>
              <th className="is-numeric">Uso</th>
              <th>Unidade</th>
              <th>Modo</th>
            </tr>
          </thead>
          <tbody>
            {version.resourceUsages.map((usage) => (
              <tr key={usage.id}>
                <td>{usage.resourceName}</td>
                <td className="is-numeric">
                  <ResourceUsageAmount
                    resourceCount={usage.resourceCount}
                    usageQuantity={usage.usageQuantity}
                    totalUsageQuantity={usage.totalUsageQuantity}
                  />
                </td>
                <td>{INDUSTRIAL_RATE_UOM_LABELS[usage.usageUom]}</td>
                <td>{INDUSTRIAL_USAGE_BASIS_LABELS[usage.usageBasis]}</td>
              </tr>
            ))}
            {version.resourceUsages.length === 0 && (
              <tr>
                <td colSpan={4} className="table__empty">
                  Sem recursos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {version.additionalCosts.length > 0 && (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Premissa</th>
                <th>Categoria</th>
                <th>Base de cálculo</th>
                <th className="is-numeric">Valor</th>
              </tr>
            </thead>
            <tbody>
              {version.additionalCosts.map((cost) => (
                <tr key={cost.id}>
                  <td>{cost.description}</td>
                  <td>{INDUSTRIAL_COST_CATEGORY_LABELS[cost.category]}</td>
                  <td>{INDUSTRIAL_COST_BASIS_LABELS[cost.calculationBasis]}</td>
                  <td className="is-numeric">{cost.rateValue ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  return (
    <div className="doc-page">
      <div className="doc-header">
        <div>
          <PageBreadcrumbs items={[{ label: "Modelos de Estrutura de Custo", href: "/gestao/templates-estrutura" }, { label: "Detalhe" }]} />
          <h1 className="doc-title">
            <code>{template.code}</code> {template.name}
            {template.archived && <span className="badge badge--neutral">Arquivado</span>}
          </h1>
        </div>
        <div className="doc-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate("/gestao/templates-estrutura")}
          >
            ← Voltar
          </button>
        </div>
      </div>

      <div className="doc-body">
        {error && <p className="form-alert" role="alert">{error}</p>}

        {/* Versão ativa, rascunho, aplicar, arquivar — quatro palavras que só
            fazem sentido depois de a pessoa saber que o template é CÓPIA e
            que ele não carrega tarifa nenhuma. */}
        <ContextHelp topic={helpTopics["templateCusto.comoFunciona"]} />

        <FormSection
          title="Identificação"
          subtitle="Um template de estrutura é reutilizável entre produtos e clientes."
        >
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="tec-nome">Nome</label>
              <input
                id="tec-nome"
                type="text"
                disabled={!canEdit}
                value={nome}
                onChange={(event) => setNome(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="tec-descricao">Descrição</label>
              <input
                id="tec-descricao"
                type="text"
                disabled={!canEdit}
                value={descricao}
                onChange={(event) => setDescricao(event.target.value)}
              />
            </div>
          </div>
          {canEdit && (
            <div className="form-actions form-actions--split">
              <div className="form-actions__group">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={saving}
                  onClick={() =>
                    void run(
                      "identificacao",
                      () =>
                        updateCostTemplate(template.id, {
                          name: nome,
                          description: descricao || null,
                        }),
                      { bloco: "identificacao", texto: "Identificação salva." },
                    )
                  }
                >
                  {acaoEmCurso === "identificacao" ? "Salvando…" : "Salvar identificação"}
                </button>
                {estadoDoBloco("identificacao", identificacaoAlterada)}
              </div>
              <div className="form-actions__group">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={saving}
                  onClick={() =>
                    void run("arquivar", () =>
                      setCostTemplateArchived(template.id, !template.archived),
                    )
                  }
                >
                  {template.archived ? "Desarquivar" : "Arquivar"}
                </button>
              </div>
            </div>
          )}
        </FormSection>

        {ativa && (
          <FormSection
            title={`Versão ativa — ${ativa.versionLabel}`}
            subtitle="Versão ativa é histórica: para alterar, crie uma nova versão. As tarifas dos recursos não fazem parte do template — elas são resolvidas na data de cada cálculo."
          >
            {composicao(ativa)}
            {ativa.usageCount > 0 && (
              <p className="field__hint">
                {ativa.usageCount === 1
                  ? "1 estrutura de custos nasceu desta versão."
                  : `${ativa.usageCount} estruturas de custos nasceram desta versão.`}{" "}
                Nenhuma delas muda quando este template muda.
              </p>
            )}
            {/* A ativação é confirmada AQUI: ao dar certo, o bloco do rascunho
                deixa de existir e levaria a frase junto. */}
            {canEdit && !rascunho && (
              <div className="form-actions">
                <div className="form-actions__group">
                  <button
                    type="button"
                    className="btn btn--accent btn--sm"
                    disabled={saving}
                    onClick={() =>
                      void run("nova-versao", () => createCostTemplateVersionFrom(ativa.id))
                    }
                  >
                    {acaoEmCurso === "nova-versao" ? "Criando…" : "Criar nova versão"}
                  </button>
                  {estadoDoBloco("versao-ativa", false)}
                </div>
              </div>
            )}
          </FormSection>
        )}

        {rascunho && (
          <FormSection
            title={`Rascunho — ${rascunho.versionLabel}`}
            subtitle="Só o rascunho é editável. Ative quando a configuração estiver pronta para ser reutilizada."
          >
            <div className="field-grid-2">
              <div className="field field--narrow">
                <label htmlFor="tec-base">Base de produção</label>
                <input
                  id="tec-base"
                  type="text"
                  inputMode="decimal"
                  disabled={!editavel}
                  value={base}
                  onChange={(event) => setBase(event.target.value)}
                />
              </div>
              <div className="field field--narrow">
                <label htmlFor="tec-unidade">Unidade da base</label>
                <input
                  id="tec-unidade"
                  type="text"
                  disabled={!editavel}
                  value={unidade}
                  onChange={(event) => setUnidade(event.target.value)}
                />
              </div>
              <div className="field field--narrow">
                <label htmlFor="tec-energia">Modo de energia</label>
                <select
                  id="tec-energia"
                  disabled={!editavel}
                  value={modoEnergia}
                  onChange={(event) =>
                    setModoEnergia(event.target.value as "NONE" | "DIRECT" | "FROM_EQUIPMENT")
                  }
                >
                  <option value="NONE">Não estruturada</option>
                  <option value="DIRECT">Informada diretamente</option>
                  <option value="FROM_EQUIPMENT">Derivada dos equipamentos</option>
                </select>
              </div>
              {modoEnergia === "FROM_EQUIPMENT" && (
                <div className="field field--narrow">
                  <label htmlFor="tec-recurso-energia">Recurso de energia</label>
                  <select
                    id="tec-recurso-energia"
                    disabled={!editavel}
                    value={recursoEnergia}
                    onChange={(event) => setRecursoEnergia(event.target.value)}
                  >
                    <option value="">Selecione…</option>
                    {recursos
                      .filter((recurso) => recurso.type === "ENERGY")
                      .map((recurso) => (
                        <option key={recurso.id} value={recurso.id}>
                          {recurso.code} — {recurso.name}
                        </option>
                      ))}
                  </select>
                  <p className="field__hint">
                    Qual tarifa valoriza o consumo derivado — o valor dela vem do cadastro, na data
                    do cálculo.
                  </p>
                </div>
              )}
            </div>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Recurso</th>
                    <th className="is-numeric">Quantidade de recursos</th>
                    <th className="is-numeric">Uso por lote</th>
                    <th>Unidade</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((linha, index) => (
                    <tr key={linha.chave}>
                      <td>
                        <select
                          aria-label="Recurso industrial"
                          disabled={!editavel}
                          value={linha.industrialResourceId}
                          onChange={(event) =>
                            setLinhas((atual) =>
                              atual.map((l, i) =>
                                i === index
                                  ? { ...l, industrialResourceId: event.target.value }
                                  : l,
                              ),
                            )
                          }
                        >
                          <option value="">Selecione…</option>
                          {recursos.map((recurso) => (
                            <option key={recurso.id} value={recurso.id}>
                              {recurso.code} — {recurso.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="is-numeric">
                        {contaRecursosDaLinha(linha.industrialResourceId) ? (
                          <input
                            type="text"
                            inputMode="numeric"
                            aria-label="Quantidade de recursos"
                            disabled={!editavel}
                            value={linha.quantidadeDeRecursos}
                            onChange={(event) =>
                              setLinhas((atual) =>
                                atual.map((l, i) =>
                                  i === index ? { ...l, quantidadeDeRecursos: event.target.value } : l,
                                ),
                              )
                            }
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="is-numeric">
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={!editavel}
                          value={linha.usageQuantity}
                          onChange={(event) =>
                            setLinhas((atual) =>
                              atual.map((l, i) =>
                                i === index ? { ...l, usageQuantity: event.target.value } : l,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <select
                          aria-label="Unidade de uso"
                          disabled={!editavel}
                          value={linha.usageUom}
                          onChange={(event) =>
                            setLinhas((atual) =>
                              atual.map((l, i) =>
                                i === index
                                  ? { ...l, usageUom: event.target.value as "HOUR" | "KWH" }
                                  : l,
                              ),
                            )
                          }
                        >
                          <option value="HOUR">hora</option>
                          <option value="KWH">kWh</option>
                        </select>
                      </td>
                      <td>
                        {editavel && (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            aria-label="Remover recurso"
                            onClick={() => setLinhas((atual) => atual.filter((_, i) => i !== index))}
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
                        Nenhum recurso ainda.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {editavel && (
              <div className="form-actions form-actions--split">
                <div className="form-actions__group">
                  {/* Terciária: acrescentar recurso não grava nada. */}
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() =>
                      setLinhas((atual) => [
                        ...atual,
                        {
                          chave: `novo-${atual.length}-${Date.now()}`,
                          industrialResourceId: "",
                          usageQuantity: "",
                          usageUom: "HOUR",
                          quantidadeDeRecursos: "1",
                        },
                      ])
                    }
                  >
                    + Adicionar recurso
                  </button>
                </div>
                <div className="form-actions__group">
                  {estadoDoBloco("rascunho", rascunhoAlterado)}
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    // Sem alteração pendente não há o que gravar, e a gravação
                    // em curso não aceita um segundo clique.
                    disabled={saving || !rascunhoAlterado}
                    onClick={() =>
                      void run(
                        "rascunho",
                        () =>
                          updateCostTemplateVersion(rascunho.id, {
                            referenceOutputQuantity: exigirDecimal(base, "Base de produção"),
                            referenceOutputUomCode: unidade,
                            energyCalculationMode: modoEnergia,
                            energyResourceId:
                              modoEnergia === "FROM_EQUIPMENT" ? recursoEnergia : null,
                            resourceUsages: linhas
                              .filter((linha) => linha.industrialResourceId && linha.usageQuantity)
                              .map(({ chave: _chave, quantidadeDeRecursos, ...resto }) => ({
                                ...resto,
                                usageQuantity: exigirDecimal(resto.usageQuantity, "Uso por lote"),
                                // Energia não envia quantidade: para ela o domínio usa 1.
                                ...(contaRecursosDaLinha(resto.industrialResourceId)
                                  ? {
                                      resourceCount:
                                        exigirQuantidadeDeRecursos(quantidadeDeRecursos),
                                    }
                                  : {}),
                              })),
                          }),
                        { bloco: "rascunho", texto: "Rascunho salvo." },
                      )
                    }
                  >
                    {acaoEmCurso === "rascunho" ? "Salvando…" : "Salvar rascunho"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--accent btn--sm"
                    disabled={
                      saving ||
                      (rascunho.resourceUsages.length === 0 && rascunho.additionalCosts.length === 0)
                    }
                    onClick={() =>
                      void run("ativar", () => activateCostTemplateVersion(rascunho.id), {
                        bloco: "versao-ativa",
                        texto: "Versão ativada.",
                      })
                    }
                  >
                    {acaoEmCurso === "ativar" ? "Ativando…" : "Ativar versão"}
                  </button>
                </div>
              </div>
            )}
          </FormSection>
        )}

        <FormSection
          title="Histórico de versões"
          subtitle="Versões anteriores continuam existindo: estruturas criadas a partir delas apontam para elas."
        >
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Versão</th>
                  <th>Situação</th>
                  <th>Origem</th>
                  <th className="is-numeric">Recursos</th>
                  <th className="is-numeric">Usada por</th>
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
                        {TEMPLATE_VERSION_STATUS_LABELS[version.status]}
                      </span>
                    </td>
                    <td>
                      {version.sourceVersionNumber
                        ? `Criada a partir da V${version.sourceVersionNumber}`
                        : "—"}
                    </td>
                    <td className="is-numeric">{version.resourceUsages.length}</td>
                    <td className="is-numeric">{version.usageCount}</td>
                    <td>{formatDateTime(version.createdAt)}</td>
                    <td>
                      {version.sourceVersionId && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() =>
                            void compareCostTemplateVersions(version.sourceVersionId!, version.id)
                              .then(setDiff)
                              .catch((err: unknown) =>
                                setError(err instanceof Error ? err.message : "Falha ao comparar"),
                              )
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
              <TemplateDiffTable diff={diff} />
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
