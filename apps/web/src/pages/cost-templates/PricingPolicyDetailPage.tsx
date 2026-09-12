import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  PricingPolicyDTO,
  PricingPolicyTierInput,
  PricingPolicyVersionDTO,
  TemplateDiffDTO,
} from "@veridi/shared";
import { TEMPLATE_VERSION_STATUS_LABELS } from "@veridi/shared";
import {
  activatePricingPolicyVersion,
  comparePricingPolicyVersions,
  createPolicyVersionFrom,
  getPricingPolicy,
  setPricingPolicyArchived,
  updatePricingPolicy,
  updatePricingPolicyVersion,
} from "../../lib/cost-pricing-templates-api";
import { FormSection } from "../../components/FormSection";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { TemplateDiffTable } from "../../components/TemplateDiffTable";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { formatPercent } from "../../lib/percent";
import { formatDateTime } from "../../lib/dates";
import { apiErrorMessage } from "../../lib/api-errors";
import { exigirDecimal, exigirDecimalOpcional } from "../../lib/decimal-field";
import { useAuth } from "../../app/AuthProvider";
import {
  PricingModelEditor,
  assinaturaDoModelo,
  modeloDoRascunho,
  rascunhoDoModelo,
  type PricingModelDraft,
} from "./PricingModelEditor";
import { assinaturaDoDocumento, decimalComparavel, textoComparavel } from "../../lib/dirty-fields";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
import { PricingModelSummary } from "./PricingModelSummary";

/**
 * Detalhe de uma política de precificação.
 *
 * Só regra aparece aqui: faixa, margem alvo, comissão. Nenhum preço — o preço
 * de cada faixa depende do custo do produto e nasce quando a política é
 * aplicada. Mostrar um valor aqui daria a impressão de que a política tem
 * preço próprio, e a primeira aplicação num produto mais caro desmentiria.
 */

interface LinhaFaixa extends PricingPolicyTierInput {
  chave: string;
}

/** As faixas da versão, na forma que a tela edita. */
function linhasDaVersao(version: PricingPolicyVersionDTO): LinhaFaixa[] {
  return version.tiers.map((tier, index) => ({
    chave: `${tier.id}-${index}`,
    quantity: tier.quantity,
    uomCode: tier.uomCode,
    targetContributionMarginPercent: tier.targetContributionMarginPercent ?? "",
    commissionPercent: tier.commissionPercent,
  }));
}

/**
 * A assinatura do rascunho — Modelo e faixas numa string.
 *
 * A chave da linha fica de fora: é identidade de renderização e muda a cada
 * recarga. Faixa em branco também — "+ Adicionar faixa" sem preencher nada não
 * é trabalho a perder, e é o que o próprio salvamento já descarta.
 */
function assinaturaDasFaixas(linhas: LinhaFaixa[]): string {
  return assinaturaDoDocumento(
    linhas
      /* Quantidade ou margem em branco nas DUAS é faixa que ainda não começou
         — a comissão nasce em 5% e não é digitação de ninguém. É também o que
         o próprio salvamento descarta. */
      .filter(
        (linha) =>
          linha.quantity.trim() !== "" ||
          (linha.targetContributionMarginPercent ?? "").trim() !== "",
      )
      .map((linha) => ({
        quantidade: decimalComparavel(linha.quantity),
        unidade: linha.uomCode,
        margem: decimalComparavel(linha.targetContributionMarginPercent),
        comissao: decimalComparavel(linha.commissionPercent),
      })),
  );
}

function assinaturaDoRascunho(modelo: PricingModelDraft | null, linhas: LinhaFaixa[]): string {
  return assinaturaDoDocumento({
    modelo: modelo ? assinaturaDoModelo(modelo) : null,
    faixas: assinaturaDasFaixas(linhas),
  });
}

export function PricingPolicyDetailPage() {
  const { policyId } = useParams<{ policyId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "COMMERCIAL";

  const [policy, setPolicy] = useState<PricingPolicyDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * A ação em curso pelo nome, não um booleano.
   *
   * O booleano desabilitava os três botões — certo — mas não sabia dizer qual
   * deles está gravando, e "Salvando…" aparecia no botão errado. Com o nome
   * em mãos, só o botão clicado troca de rótulo.
   */
  const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null);
  const saving = acaoEmCurso !== null;
  /*
   * O que a última ação gravou, no bloco que a disparou.
   *
   * Um estado só: salvar de novo substitui a frase, nunca empilha aviso. E
   * cada bloco mostra o seu — "Rascunho salvo." não pode ser lido como
   * "Versão ativada.".
   */
  const [feito, setFeito] = useState<{ bloco: string; texto: string } | null>(null);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [linhas, setLinhas] = useState<LinhaFaixa[]>([]);
  const [diff, setDiff] = useState<TemplateDiffDTO | null>(null);
  const [modelo, setModelo] = useState<PricingModelDraft | null>(null);

  /*
   * O que o servidor devolveu na última leitura, bloco a bloco.
   *
   * Identificação e rascunho gravam separado, e as duas ações terminam em
   * `load()`: salvar a identificação reescrevia as faixas e o Modelo com o que
   * está gravado, e a edição pendente do outro bloco sumia sem aviso. Com a
   * leitura anterior em mãos dá para separar "ainda está como o servidor
   * deixou" de "a pessoa mexeu" — e só o primeiro recebe a leitura nova.
   *
   * Começa nos MESMOS valores iniciais do estado: na primeira carga ninguém
   * digitou nada e tudo tem de ser substituído.
   */
  const lido = useRef<{
    nome: string;
    descricao: string;
    modelo: string | null;
    faixas: string;
  }>({ nome: "", descricao: "", modelo: null, faixas: assinaturaDasFaixas([]) });

  const load = useCallback(() => {
    if (!policyId) return;
    getPricingPolicy(policyId)
      .then((result) => {
        setPolicy(result);
        const anterior = lido.current;
        const rascunho = result.draftVersion;
        const novoModelo = rascunho
          ? rascunhoDoModelo(rascunho.pricingModel, rascunho.applicableTaxProfiles)
          : null;
        const novasFaixas = rascunho ? linhasDaVersao(rascunho) : [];
        lido.current = {
          nome: result.name,
          descricao: result.description ?? "",
          modelo: novoModelo ? assinaturaDoModelo(novoModelo) : null,
          faixas: rascunho ? assinaturaDasFaixas(novasFaixas) : anterior.faixas,
        };
        setNome((atual) => (atual === anterior.nome ? result.name : atual));
        setDescricao((atual) =>
          atual === anterior.descricao ? (result.description ?? "") : atual,
        );
        setModelo((atual) =>
          (atual ? assinaturaDoModelo(atual) : null) === anterior.modelo ? novoModelo : atual,
        );
        if (rascunho) {
          setLinhas((atual) =>
            assinaturaDasFaixas(atual) === anterior.faixas ? novasFaixas : atual,
          );
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar a política"),
      );
  }, [policyId]);

  useEffect(() => load(), [load]);

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
   * faixa meio digitada, e "Salvar rascunho" não absolve o nome trocado.
   *
   * Ativar e arquivar gravam na hora e não deixam pendência; a comparação
   * entre versões e o histórico são leitura. Preço não existe nesta tela: ele
   * nasce quando a política é aplicada a um produto.
   */
  const rascunhoDoServidor = policy?.draftVersion ?? null;
  const identificacaoAlterada =
    policy !== null &&
    canEdit &&
    (textoComparavel(nome) !== textoComparavel(policy.name) ||
      textoComparavel(descricao) !== textoComparavel(policy.description));
  const rascunhoAlterado =
    rascunhoDoServidor !== null &&
    canEdit &&
    assinaturaDoRascunho(modelo, linhas) !==
      assinaturaDoRascunho(
        rascunhoDoModelo(
          rascunhoDoServidor.pricingModel,
          rascunhoDoServidor.applicableTaxProfiles,
        ),
        linhasDaVersao(rascunhoDoServidor),
      );
  useUnsavedChangesGuard({
    isDirty: identificacaoAlterada || rascunhoAlterado,
    substantivo: "política de precificação",
    genero: "a",
  });

  /**
   * A frase de estado do bloco: o que falta gravar, ou o que acabou de gravar.
   *
   * Pendência vem primeiro — uma confirmação de "salvo" ao lado de campo já
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

  if (!policy) {
    return (
      <div className="doc-body">
        {error ? <p className="form-alert" role="alert">{error}</p> : <p>Carregando…</p>}
      </div>
    );
  }

  const rascunho = policy.draftVersion;
  const ativa = policy.activeVersion;
  const editavel = canEdit && rascunho !== null;

  const faixasDaVersao = (version: PricingPolicyVersionDTO) => (
    <div className="table-container">
      <table className="table">
        <thead>
          <tr>
            <th className="is-numeric">Quantidade</th>
            <th>Unidade</th>
            <th className="is-numeric">Margem alvo</th>
            <th className="is-numeric">Comissão</th>
          </tr>
        </thead>
        <tbody>
          {version.tiers.map((tier) => (
            <tr key={tier.id}>
              <td className="is-numeric">{formatQuantity(tier.quantity)}</td>
              <td>{tier.uomCode}</td>
              <td className="is-numeric">
                {formatPercent(tier.targetContributionMarginPercent)}
              </td>
              <td className="is-numeric">{formatPercent(tier.commissionPercent)}</td>
            </tr>
          ))}
          {version.tiers.length === 0 && (
            <tr>
              <td colSpan={4} className="table__empty">
                Sem faixas.
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
          <PageBreadcrumbs items={[{ label: "Políticas de Precificação", href: "/gestao/politicas-precificacao" }, { label: "Detalhe" }]} />
          <h1 className="doc-title">
            <code>{policy.code}</code> {policy.name}
            {policy.archived && <span className="badge badge--neutral">Arquivada</span>}
          </h1>
        </div>
        <div className="doc-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate("/gestao/politicas-precificacao")}
          >
            ← Voltar
          </button>
        </div>
      </div>

      <div className="doc-body">
        {error && <p className="form-alert" role="alert">{error}</p>}

        {/* A tela mostra faixa, margem e comissão, e nenhum preço. Sem dizer
            por que, a ausência parece falta de cadastro — quando é a regra:
            o preço nasce do custo do produto, não da política. */}
        <ContextHelp topic={helpTopics["politicaPreco.comoFunciona"]} />

        <FormSection
          title="Identificação"
          subtitle="Uma política é reutilizável entre produtos e clientes — o nome não carrega o de nenhum deles."
        >
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="tpp-nome">Nome</label>
              <input
                id="tpp-nome"
                type="text"
                disabled={!canEdit}
                value={nome}
                onChange={(event) => setNome(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="tpp-descricao">Descrição</label>
              <input
                id="tpp-descricao"
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
                        updatePricingPolicy(policy.id, {
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
                      setPricingPolicyArchived(policy.id, !policy.archived),
                    )
                  }
                >
                  {policy.archived ? "Desarquivar" : "Arquivar"}
                </button>
              </div>
            </div>
          )}
        </FormSection>

        {ativa && (
          <FormSection
            title={`Versão ativa — ${ativa.versionLabel}`}
            subtitle="Versão ativa é histórica: para alterar, crie uma nova versão. A política define margem e comissão; o preço de cada faixa é calculado sobre o custo do produto no momento da aplicação."
          >
            {faixasDaVersao(ativa)}
            <PricingModelSummary model={ativa.pricingModel} profiles={ativa.applicableTaxProfiles} />
            {ativa.usageCount > 0 && (
              <p className="field__hint">
                {ativa.usageCount === 1
                  ? "1 precificação nasceu desta versão."
                  : `${ativa.usageCount} precificações nasceram desta versão.`}{" "}
                Nenhuma delas muda quando esta política muda.
              </p>
            )}
            {/* A ativação é confirmada AQUI: ao dar certo, o bloco do rascunho
                deixa de existir e levaria a frase junto. */}
            {canEdit && !rascunho && (
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn--accent btn--sm"
                  disabled={saving}
                  onClick={() =>
                    void run("nova-versao", () => createPolicyVersionFrom(ativa.id))
                  }
                >
                  {acaoEmCurso === "nova-versao" ? "Criando…" : "Criar nova versão"}
                </button>
                {estadoDoBloco("versao-ativa", false)}
              </div>
            )}
          </FormSection>
        )}

        {rascunho && (
          <FormSection
            title={`Rascunho — ${rascunho.versionLabel}`}
            subtitle="Cada faixa é uma quantidade com sua margem alvo e comissão."
          >
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th className="is-numeric">Quantidade</th>
                    <th className="is-numeric">Margem alvo (%)</th>
                    <th className="is-numeric">Comissão (%)</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((linha, index) => (
                    <tr key={linha.chave}>
                      <td className="is-numeric">
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label="Quantidade da faixa"
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
                      <td className="is-numeric">
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label="Margem alvo"
                          disabled={!editavel}
                          value={linha.targetContributionMarginPercent}
                          onChange={(event) =>
                            setLinhas((atual) =>
                              atual.map((l, i) =>
                                i === index
                                  ? { ...l, targetContributionMarginPercent: event.target.value }
                                  : l,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="is-numeric">
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label="Comissão"
                          disabled={!editavel}
                          value={linha.commissionPercent ?? ""}
                          onChange={(event) =>
                            setLinhas((atual) =>
                              atual.map((l, i) =>
                                i === index ? { ...l, commissionPercent: event.target.value } : l,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        {editavel && (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            aria-label="Remover faixa"
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
                      <td colSpan={4} className="table__empty">
                        Nenhuma faixa ainda.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="field__hint">
              A política não guarda preço. Preço informado à mão é decisão de uma negociação sobre
              um custo específico — não vira regra reutilizável.
            </p>

            {modelo && (
              <>
                <h3>Custos e impostos do Modelo</h3>
                <PricingModelEditor draft={modelo} disabled={!editavel} onChange={setModelo} />
              </>
            )}

            {editavel && (
              <div className="form-actions form-actions--split">
                <div className="form-actions__group">
                  {/* Terciária: acrescentar faixa não grava nada. */}
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() =>
                      setLinhas((atual) => [
                        ...atual,
                        {
                          chave: `nova-${atual.length}-${Date.now()}`,
                          quantity: "",
                          targetContributionMarginPercent: "",
                          commissionPercent: "5",
                        },
                      ])
                    }
                  >
                    + Adicionar faixa
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
                          updatePricingPolicyVersion(rascunho.id, {
                            // O Modelo inteiro vai junto, valores de modos
                            // desligados inclusive — desligar não apaga.
                            ...(modelo
                              ? {
                                  pricingModel: modeloDoRascunho(modelo),
                                  applicableTaxProfiles: modelo.applicableTaxProfiles,
                                }
                              : {}),
                            tiers: linhas
                              .filter(
                                (linha) => linha.quantity && linha.targetContributionMarginPercent,
                              )
                              .map(({ chave: _chave, ...resto }) => {
                                // Comissão em branco continua em branco — só o
                                // que foi digitado precisa ser legível.
                                const comissao = exigirDecimalOpcional(
                                  resto.commissionPercent ?? "",
                                  "Comissão (%)",
                                );
                                return {
                                  ...resto,
                                  quantity: exigirDecimal(resto.quantity, "Quantidade"),
                                  targetContributionMarginPercent: exigirDecimal(
                                    resto.targetContributionMarginPercent,
                                    "Margem alvo (%)",
                                  ),
                                  ...(comissao === null ? {} : { commissionPercent: comissao }),
                                };
                              }),
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
                    disabled={saving || rascunho.tiers.length === 0}
                    onClick={() =>
                      void run("ativar", () => activatePricingPolicyVersion(rascunho.id), {
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
          subtitle="Versões anteriores continuam existindo: precificações criadas a partir delas apontam para elas."
        >
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Versão</th>
                  <th>Situação</th>
                  <th>Origem</th>
                  <th className="is-numeric">Faixas</th>
                  <th className="is-numeric">Usada por</th>
                  <th>Criada em</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {[...policy.versions].reverse().map((version) => (
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
                    <td className="is-numeric">{version.tiers.length}</td>
                    <td className="is-numeric">{version.usageCount}</td>
                    <td>{formatDateTime(version.createdAt)}</td>
                    <td>
                      {version.sourceVersionId && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() =>
                            void comparePricingPolicyVersions(version.sourceVersionId!, version.id)
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
