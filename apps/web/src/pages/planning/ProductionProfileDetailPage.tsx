import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  IndustrialResourceType,
  ProductDTO,
  ProductionPlan,
  ProductionPlanStepInput,
  ProductionProfileDTO,
  ProductionProfileStepInput,
  ProductionProfileVersionDTO,
  ProductionStepScalingMode,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import {
  INDUSTRIAL_RESOURCE_TYPE_LABELS,
  PRODUCTION_STEP_LIMITS,
  PRODUCTION_STEP_SCALING_MODE_LABELS,
  ProductionPlanInputError,
  TEMPLATE_VERSION_STATUS_LABELS,
  isCapacityResourceType,
  planProductionProfile,
} from "@veridi/shared";
import {
  activateProductionProfileVersion,
  createProductionProfileVersionFrom,
  getProductionProfile,
  setProductProductionProfile,
  updateProductionProfile,
  updateProductionProfileVersion,
} from "../../lib/production-profiles-api";
import { listIndustrialResources } from "../../lib/industrial-resources-api";
import { listUnits } from "../../lib/units-api";
import { listProducts } from "../../lib/products-api";
import { apiErrorMessage } from "../../lib/api-errors";
import { AJUDA_DECIMAL, parseDecimalInput } from "../../lib/decimal-input";
import { exigirDecimal } from "../../lib/decimal-field";
import { lerInteiroOpcional } from "../../lib/integer-input";
import { formatQuantity } from "../../lib/quantity";
import { formatDateTime } from "../../lib/dates";
import { formatMinutes, formatMinutesPlain } from "../../lib/duration";
import { FormSection } from "../../components/FormSection";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { ContextHelp } from "../../components/help";
import { CalcHint } from "../../components/help/CalcHint";
import { helpTopics } from "../../help/help-content";
import { useAuth } from "../../app/AuthProvider";
import "./planning.css";

/**
 * Detalhe de um Perfil de Produção (`PRODUCT_RULES.md` §89).
 *
 * A versão ativa é congelada e só se lê; o rascunho se edita inteiro — etapas
 * em cartões, ordem por ↑ ↓, recursos com a quantidade que trabalha AO MESMO
 * TEMPO. A simulação usa o mesmo motor do servidor (`planProductionProfile`)
 * e não grava nada.
 */

/** Recurso que a tela conhece — do catálogo ou de uma etapa já gravada. */
interface RecursoConhecido {
  id: string;
  code: string;
  name: string;
  type: IndustrialResourceType;
  active: boolean;
}

interface RecursoRascunho {
  chave: string;
  industrialResourceId: string;
  quantidade: string;
}

interface EtapaRascunho {
  chave: string;
  name: string;
  description: string;
  preparacao: string;
  execucao: string;
  scalingMode: ProductionStepScalingMode;
  recursos: RecursoRascunho[];
}

let sequenciaDeChave = 0;
const novaChave = (prefixo: string) => `${prefixo}-${++sequenciaDeChave}`;

function etapasDoDTO(version: ProductionProfileVersionDTO): EtapaRascunho[] {
  return version.steps.map((step) => ({
    chave: novaChave("etapa"),
    name: step.name,
    description: step.description ?? "",
    preparacao: String(step.setupDurationMinutes),
    execucao: String(step.runDurationMinutes),
    scalingMode: step.scalingMode,
    recursos: step.resources.map((recurso) => ({
      chave: novaChave("recurso"),
      industrialResourceId: recurso.industrialResourceId,
      quantidade: String(recurso.resourceQuantity),
    })),
  }));
}

const etapaNova = (): EtapaRascunho => ({
  chave: novaChave("etapa"),
  name: "",
  description: "",
  preparacao: "0",
  execucao: "",
  scalingMode: "PROPORTIONAL",
  recursos: [],
});

/** Só o que o servidor grava — a chave de lista não é alteração. */
function assinatura(base: string, unidade: string, etapas: EtapaRascunho[]): string {
  return JSON.stringify({
    base: base.trim(),
    unidade,
    etapas: etapas.map(({ chave: _chave, recursos, ...resto }) => ({
      ...resto,
      recursos: recursos.map(({ chave: _chaveRecurso, ...recurso }) => recurso),
    })),
  });
}

function minutosDoCampo(texto: string, rotulo: string): number {
  const leitura = lerInteiroOpcional(texto);
  if (leitura.tipo !== "valido" || leitura.valor > PRODUCTION_STEP_LIMITS.maxMinutes) {
    throw new Error(
      `${rotulo}: informe minutos inteiros, de 0 a ${PRODUCTION_STEP_LIMITS.maxMinutes.toLocaleString("pt-BR")}.`,
    );
  }
  return leitura.valor;
}

function quantidadeDoCampo(texto: string, rotulo: string): number {
  const leitura = lerInteiroOpcional(texto);
  if (
    leitura.tipo !== "valido" ||
    leitura.valor < 1 ||
    leitura.valor > PRODUCTION_STEP_LIMITS.maxResourceQuantity
  ) {
    throw new Error(`${rotulo}: informe um número inteiro maior ou igual a 1.`);
  }
  return leitura.valor;
}

/**
 * A leitura ESTRITA do rascunho — a mesma para salvar e para simular. Campo
 * vazio nunca vira zero nem 1 em silêncio: a tela diz qual etapa falta.
 */
function lerEtapas(
  etapas: EtapaRascunho[],
  nomeDoRecurso: (id: string) => string,
): ProductionProfileStepInput[] {
  return etapas.map((etapa, indice) => {
    const rotulo = `Etapa ${indice + 1}`;
    const nome = etapa.name.trim();
    if (!nome) throw new Error(`${rotulo}: informe o nome.`);
    const preparacao = minutosDoCampo(etapa.preparacao, `${rotulo} — preparação`);
    const execucao = minutosDoCampo(etapa.execucao, `${rotulo} — execução`);
    if (preparacao + execucao === 0) {
      throw new Error(`${rotulo}: informe o tempo de preparação ou o de execução.`);
    }
    return {
      name: nome,
      description: etapa.description.trim() || null,
      setupDurationMinutes: preparacao,
      runDurationMinutes: execucao,
      scalingMode: etapa.scalingMode,
      resources: etapa.recursos.map((recurso, linha) => {
        if (!recurso.industrialResourceId) {
          throw new Error(`${rotulo}: escolha o recurso da linha ${linha + 1} ou remova a linha.`);
        }
        return {
          industrialResourceId: recurso.industrialResourceId,
          resourceQuantity: quantidadeDoCampo(
            recurso.quantidade,
            `${rotulo} — quantidade de recursos (${nomeDoRecurso(recurso.industrialResourceId)})`,
          ),
        };
      }),
    };
  });
}

function simulacaoDoRascunho(
  etapas: ProductionProfileStepInput[],
  recurso: (id: string) => RecursoConhecido | undefined,
): ProductionPlanStepInput[] {
  return etapas.map((etapa, indice) => ({
    sequence: indice + 1,
    name: etapa.name,
    setupDurationMinutes: etapa.setupDurationMinutes,
    runDurationMinutes: etapa.runDurationMinutes,
    scalingMode: etapa.scalingMode,
    resources: etapa.resources.map((linha) => ({
      industrialResourceId: linha.industrialResourceId,
      resourceName: recurso(linha.industrialResourceId)?.name ?? "Recurso",
      resourceType: recurso(linha.industrialResourceId)?.type ?? null,
      resourceQuantity: linha.resourceQuantity,
    })),
  }));
}

function simulacaoDaVersao(version: ProductionProfileVersionDTO): ProductionPlanStepInput[] {
  return version.steps.map((step) => ({
    sequence: step.sequence,
    name: step.name,
    setupDurationMinutes: step.setupDurationMinutes,
    runDurationMinutes: step.runDurationMinutes,
    scalingMode: step.scalingMode,
    resources: step.resources.map((recurso) => ({
      industrialResourceId: recurso.industrialResourceId,
      resourceName: recurso.resourceName,
      resourceType: recurso.resourceType,
      resourceQuantity: recurso.resourceQuantity,
    })),
  }));
}

const opcaoDeProduto = (product: ProductDTO): EntityOption => ({
  id: product.id,
  code: product.code,
  name: product.name,
});

/**
 * Simulação para uma quantidade — conta local, nada é gravado.
 *
 * Premissa ausente vira aviso e travessão, nunca zero.
 */
function ProfilePreview({
  idPrefix,
  referenceQuantity,
  referenceUomCode,
  steps,
  motivo,
}: {
  idPrefix: string;
  referenceQuantity: string | null;
  referenceUomCode: string;
  steps: ProductionPlanStepInput[] | null;
  motivo: string | null;
}) {
  const [quantidade, setQuantidade] = useState(referenceQuantity ?? "");

  let plano: ProductionPlan | null = null;
  let aviso = motivo;
  if (!aviso) {
    const alvo = parseDecimalInput(quantidade);
    if (!alvo) aviso = "Informe a quantidade para simular.";
    else if (!referenceQuantity) aviso = "Informe a quantidade-base do perfil.";
    else if (!steps || steps.length === 0) aviso = "Adicione etapas para simular.";
    else {
      try {
        plano = planProductionProfile({ referenceQuantity, steps }, alvo);
      } catch (err) {
        aviso =
          err instanceof ProductionPlanInputError
            ? err.message
            : "Não foi possível simular com estes valores.";
      }
    }
  }

  return (
    <section className="profile-preview" aria-label="Simulação">
      <div className="field field--narrow">
        <label htmlFor={`${idPrefix}-quantidade`}>Quantidade para simular ({referenceUomCode})</label>
        <input
          id={`${idPrefix}-quantidade`}
          type="text"
          inputMode="decimal"
          value={quantidade}
          onChange={(event) => setQuantidade(event.target.value)}
        />
        <p className="field__hint">Só simula: nada é gravado. {AJUDA_DECIMAL}</p>
      </div>

      {aviso && (
        <p className="field__hint" role="status">
          {aviso}
        </p>
      )}

      {plano && (
        <>
          <ol className="profile-preview__steps">
            {plano.steps.map((etapa) => {
              const origem = steps?.find((step) => step.sequence === etapa.sequence);
              const execucaoBase = Number(origem?.runDurationMinutes ?? 0);
              return (
                <li key={`${etapa.sequence}-${etapa.name}`} className="profile-preview__step">
                  <p className="profile-preview__name">
                    {etapa.sequence}. {etapa.name}{" "}
                    <span className="cell-sub">
                      {PRODUCTION_STEP_SCALING_MODE_LABELS[etapa.scalingMode]}
                      {etapa.batches !== null
                        ? ` · ${etapa.batches} ${etapa.batches === 1 ? "lote" : "lotes"}`
                        : ""}
                    </span>
                  </p>
                  <dl className="profile-preview__values">
                    <div>
                      <dt>Preparação</dt>
                      <dd>{formatMinutes(etapa.setupMinutes)}</dd>
                    </div>
                    <div>
                      <dt>Execução</dt>
                      <dd>
                        {formatMinutes(etapa.runMinutes)}{" "}
                        {etapa.batches !== null ? (
                          <CalcHint
                            label={`Execução — ${etapa.name}`}
                            operandos={[
                              {
                                valor: formatMinutesPlain(execucaoBase),
                                papel: "execução por lote",
                                numero: execucaoBase,
                              },
                              {
                                valor: String(etapa.batches),
                                papel: "lotes",
                                operador: "×",
                                numero: etapa.batches,
                              },
                            ]}
                            resultado={formatMinutesPlain(etapa.runMinutes)}
                            nota={`${etapa.batches} ${etapa.batches === 1 ? "lote" : "lotes"}: ${formatQuantity(plano.quantity)} ÷ ${formatQuantity(plano.referenceQuantity)}, arredondado para cima — lote começado é lote inteiro.`}
                          />
                        ) : (
                          <CalcHint
                            label={`Execução — ${etapa.name}`}
                            operandos={[
                              {
                                valor: formatMinutesPlain(execucaoBase),
                                papel: "execução da base",
                                numero: execucaoBase,
                              },
                              {
                                valor: formatQuantity(plano.quantity),
                                papel: "quantidade",
                                operador: "×",
                                numero: Number(plano.quantity),
                              },
                              {
                                valor: formatQuantity(plano.referenceQuantity),
                                papel: "quantidade-base",
                                operador: "÷",
                                numero: Number(plano.referenceQuantity),
                              },
                            ]}
                            resultado={formatMinutesPlain(etapa.runMinutes)}
                          />
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Duração</dt>
                      <dd>{formatMinutes(etapa.durationMinutes)}</dd>
                    </div>
                  </dl>
                  {etapa.resources.length > 0 && (
                    <ul className="profile-preview__resources">
                      {etapa.resources.map((recurso) => (
                        <li key={recurso.industrialResourceId}>
                          {recurso.resourceQuantity} × {recurso.resourceName}:{" "}
                          {formatMinutes(recurso.demandMinutes)} de recurso{" "}
                          <CalcHint
                            label={`Horas-recurso — ${recurso.resourceName} em ${etapa.name}`}
                            operandos={[
                              {
                                valor: formatMinutesPlain(etapa.durationMinutes),
                                papel: "duração da etapa",
                                numero: Number(etapa.durationMinutes),
                              },
                              {
                                valor: String(recurso.resourceQuantity),
                                papel: "recursos ao mesmo tempo",
                                operador: "×",
                                numero: recurso.resourceQuantity,
                              },
                            ]}
                            resultado={formatMinutesPlain(recurso.demandMinutes)}
                            nota="Os recursos trabalham juntos: a etapa não fica mais longa, ela ocupa mais recurso."
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>

          <p className="profile-preview__total">
            <strong>Tempo sequencial total: {formatMinutes(plano.totalDurationMinutes)}</strong>
          </p>

          {plano.resources.length > 0 && (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Recurso</th>
                    <th className="is-numeric">Horas-recurso</th>
                  </tr>
                </thead>
                <tbody>
                  {plano.resources.map((recurso) => (
                    <tr key={recurso.industrialResourceId}>
                      <td>{recurso.resourceName}</td>
                      <td className="is-numeric">{formatMinutes(recurso.demandMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Versão congelada: só leitura, cada valor com o próprio rótulo. */
function StepsReadOnly({ version }: { version: ProductionProfileVersionDTO }) {
  if (version.steps.length === 0) return <p className="field__hint">Sem etapas.</p>;
  const base = `${formatQuantity(version.referenceQuantity)} ${version.referenceUomCode}`;
  return (
    <ol className="profile-steps-readonly">
      {version.steps.map((step) => (
        <li key={step.id} className="profile-step">
          <p className="profile-step__title">
            <span className="profile-step__seq">Etapa {step.sequence}</span> {step.name}
          </p>
          {step.description && <p className="field__hint">{step.description}</p>}
          <dl className="profile-step__facts">
            <div>
              <dt>Modo de escala</dt>
              <dd>{PRODUCTION_STEP_SCALING_MODE_LABELS[step.scalingMode]}</dd>
            </div>
            <div>
              <dt>Preparação</dt>
              <dd>{formatMinutes(step.setupDurationMinutes)}</dd>
            </div>
            <div>
              <dt>Execução</dt>
              <dd>
                {formatMinutes(step.runDurationMinutes)}{" "}
                {step.scalingMode === "BY_BATCH" ? `por lote de ${base}` : `para ${base}`}
              </dd>
            </div>
            <div>
              <dt>Recursos</dt>
              <dd>
                {step.resources.length === 0
                  ? "—"
                  : step.resources
                      .map((recurso) => `${recurso.resourceQuantity} × ${recurso.resourceName}`)
                      .join(" · ")}
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ol>
  );
}

export function ProductionProfileDetailPage() {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "PRODUCTION";

  const [profile, setProfile] = useState<ProductionProfileDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [base, setBase] = useState("1000");
  const [unidade, setUnidade] = useState("un");
  const [etapas, setEtapas] = useState<EtapaRascunho[]>([]);
  const [salvo, setSalvo] = useState("");
  const [catalogo, setCatalogo] = useState<RecursoConhecido[]>([]);
  const [unidades, setUnidades] = useState<UnitOfMeasureDTO[]>([]);
  const [opcoesProduto, setOpcoesProduto] = useState<EntityOption[]>([]);
  const [produtoEscolhido, setProdutoEscolhido] = useState("");

  const load = useCallback(() => {
    if (!profileId) return;
    getProductionProfile(profileId)
      .then((result) => {
        setProfile(result);
        setNome(result.name);
        setDescricao(result.description ?? "");
        const rascunho = result.draftVersion;
        if (rascunho) {
          const lidas = etapasDoDTO(rascunho);
          setBase(rascunho.referenceQuantity);
          setUnidade(rascunho.referenceUomCode);
          setEtapas(lidas);
          setSalvo(assinatura(rascunho.referenceQuantity, rascunho.referenceUomCode, lidas));
        } else {
          setEtapas([]);
          setSalvo("");
        }
      })
      .catch((err: unknown) => setError(apiErrorMessage(err, "Falha ao carregar o perfil")));
  }, [profileId]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    // Só mão de obra e equipamento ativos: energia não é capacidade (§89).
    listIndustrialResources({ pageSize: 100, active: true })
      .then((result) =>
        setCatalogo(
          result.resources
            .filter((recurso) => isCapacityResourceType(recurso.type))
            .map((recurso) => ({
              id: recurso.id,
              code: recurso.code,
              name: recurso.name,
              type: recurso.type,
              active: recurso.active,
            })),
        ),
      )
      .catch(() => setCatalogo([]));
    listUnits()
      .then(setUnidades)
      .catch(() => setUnidades([]));
  }, []);

  useEffect(() => {
    if (!canEdit) return;
    listProducts({ pageSize: 20 })
      .then((result) => setOpcoesProduto(result.products.map(opcaoDeProduto)))
      .catch(() => setOpcoesProduto([]));
  }, [canEdit]);

  /** Catálogo + recursos já gravados nas etapas (um inativo continua com nome). */
  const conhecidos = useMemo(() => {
    const mapa = new Map<string, RecursoConhecido>();
    for (const version of profile?.versions ?? []) {
      for (const step of version.steps) {
        for (const recurso of step.resources) {
          mapa.set(recurso.industrialResourceId, {
            id: recurso.industrialResourceId,
            code: recurso.resourceCode,
            name: recurso.resourceName,
            type: recurso.resourceType,
            active: recurso.resourceActive,
          });
        }
      }
    }
    for (const recurso of catalogo) mapa.set(recurso.id, recurso);
    return mapa;
  }, [profile, catalogo]);

  const buscarProdutos = useCallback(async (termo: string) => {
    const resultado = await listProducts({ search: termo, pageSize: 20 });
    const opcoes = resultado.products.map(opcaoDeProduto);
    setOpcoesProduto((atual) => {
      const mapa = new Map(atual.map((opcao) => [opcao.id, opcao]));
      for (const opcao of opcoes) mapa.set(opcao.id, opcao);
      return [...mapa.values()];
    });
    return opcoes;
  }, []);

  if (!profile) {
    return (
      <div className="doc-body">
        {error ? (
          <p className="form-alert" role="alert">
            {error}
          </p>
        ) : (
          <p>Carregando…</p>
        )}
      </div>
    );
  }

  const rascunho = profile.draftVersion;
  const ativa = profile.activeVersion;
  const editavel = canEdit && rascunho !== null;
  const alterado = rascunho !== null && assinatura(base, unidade, etapas) !== salvo;
  const recurso = (id: string) => conhecidos.get(id);
  const nomeDoRecurso = (id: string) => recurso(id)?.name ?? "recurso";
  const baseLida = parseDecimalInput(base);
  const baseTexto = `${baseLida ? formatQuantity(baseLida) : "—"} ${unidade}`;

  let passosSimulados: ProductionPlanStepInput[] | null = null;
  let motivoSimulacao: string | null = null;
  if (rascunho) {
    try {
      passosSimulados = simulacaoDoRascunho(lerEtapas(etapas, nomeDoRecurso), recurso);
    } catch (err) {
      motivoSimulacao = err instanceof Error ? err.message : "Complete as etapas para simular.";
    }
  }

  /** Opções do select: capacidade ativa do catálogo + o já escolhido, se saiu dele. */
  const opcoesDeRecurso = (escolhido: string) => {
    const lista = [...catalogo];
    const atual = escolhido ? recurso(escolhido) : undefined;
    if (atual && !lista.some((item) => item.id === atual.id)) lista.push(atual);
    return lista;
  };

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

  const alterarEtapa = (indice: number, mudanca: Partial<EtapaRascunho>) =>
    setEtapas((atual) => atual.map((etapa, i) => (i === indice ? { ...etapa, ...mudanca } : etapa)));

  const moverEtapa = (indice: number, direcao: -1 | 1) =>
    setEtapas((atual) => {
      const destino = indice + direcao;
      const movida = atual[indice];
      if (!movida || destino < 0 || destino >= atual.length) return atual;
      const copia = atual.filter((_, i) => i !== indice);
      copia.splice(destino, 0, movida);
      return copia;
    });

  const alterarRecurso = (indiceEtapa: number, indiceRecurso: number, mudanca: Partial<RecursoRascunho>) =>
    setEtapas((atual) =>
      atual.map((etapa, i) =>
        i !== indiceEtapa
          ? etapa
          : {
              ...etapa,
              recursos: etapa.recursos.map((linha, j) => (j === indiceRecurso ? { ...linha, ...mudanca } : linha)),
            },
      ),
    );

  const adicionarRecurso = (indiceEtapa: number) =>
    setEtapas((atual) =>
      atual.map((etapa, i) =>
        i !== indiceEtapa
          ? etapa
          : {
              ...etapa,
              recursos: [
                ...etapa.recursos,
                { chave: novaChave("recurso"), industrialResourceId: "", quantidade: "1" },
              ],
            },
      ),
    );

  const removerRecurso = (indiceEtapa: number, indiceRecurso: number) =>
    setEtapas((atual) =>
      atual.map((etapa, i) =>
        i !== indiceEtapa
          ? etapa
          : { ...etapa, recursos: etapa.recursos.filter((_, j) => j !== indiceRecurso) },
      ),
    );

  const salvarRascunho = () => {
    if (!rascunho) return;
    void run(() =>
      updateProductionProfileVersion(rascunho.id, {
        referenceQuantity: exigirDecimal(base, "Quantidade-base"),
        referenceUomCode: unidade,
        steps: lerEtapas(etapas, nomeDoRecurso),
      }),
    );
  };

  const unidadesDoSelect =
    unidades.length > 0 ? unidades : [{ code: unidade, label: unidade } as UnitOfMeasureDTO];

  return (
    <div className="doc-page">
      <div className="doc-header">
        <div>
          <PageBreadcrumbs
            items={[
              { label: "Perfis de Produção", href: "/planejamento/perfis-producao" },
              { label: "Detalhe" },
            ]}
          />
          <h1 className="doc-title">
            <code>{profile.code}</code> {profile.name}
          </h1>
        </div>
        <div className="doc-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate("/planejamento/perfis-producao")}
          >
            ← Voltar
          </button>
        </div>
      </div>

      <div className="doc-body">
        {error && (
          <p className="form-alert" role="alert">
            {error}
          </p>
        )}

        <ContextHelp topic={helpTopics["planejamento.perfisProducao"]} />

        <FormSection
          title="Identificação"
          subtitle="O perfil é reutilizável: vários produtos podem ter a mesma versão como padrão."
        >
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="ppr-nome">Nome</label>
              <input
                id="ppr-nome"
                type="text"
                disabled={!canEdit}
                value={nome}
                onChange={(event) => setNome(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="ppr-descricao">Descrição</label>
              <input
                id="ppr-descricao"
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
                disabled={saving || !nome.trim()}
                onClick={() =>
                  void run(() =>
                    updateProductionProfile(profile.id, { name: nome, description: descricao || null }),
                  )
                }
              >
                Salvar identificação
              </button>
            </div>
          )}
        </FormSection>

        {ativa && (
          <FormSection
            title={`Versão ativa — ${ativa.versionLabel}`}
            subtitle="Congelada: para mudar o roteiro, crie uma nova versão. As etapas acontecem uma depois da outra."
          >
            <dl className="definition-list">
              <dt>Quantidade-base</dt>
              <dd>
                {formatQuantity(ativa.referenceQuantity)} {ativa.referenceUomCode}
              </dd>
              {ativa.activatedAt && (
                <>
                  <dt>Ativada em</dt>
                  <dd>
                    {formatDateTime(ativa.activatedAt)}
                    {ativa.activatedBy ? ` por ${ativa.activatedBy}` : ""}
                  </dd>
                </>
              )}
            </dl>
            <StepsReadOnly version={ativa} />
            {canEdit && !rascunho && (
              <div className="line-actions">
                <button
                  type="button"
                  className="btn btn--accent btn--sm"
                  disabled={saving}
                  onClick={() => void run(() => createProductionProfileVersionFrom(ativa.id))}
                >
                  Criar nova versão
                </button>
              </div>
            )}
            <h4 className="profile-subtitle">Simulação — {ativa.versionLabel}</h4>
            <ProfilePreview
              idPrefix="ppr-ativa"
              referenceQuantity={ativa.referenceQuantity}
              referenceUomCode={ativa.referenceUomCode}
              steps={simulacaoDaVersao(ativa)}
              motivo={null}
            />
          </FormSection>
        )}

        {rascunho && (
          <FormSection
            title={`Rascunho — ${rascunho.versionLabel}`}
            subtitle="Só o rascunho se edita. A ordem da lista é a ordem de execução: cada etapa começa depois da anterior."
          >
            <div className="field-grid-2">
              <div className="field field--narrow">
                <label htmlFor="ppr-base">Quantidade-base</label>
                <input
                  id="ppr-base"
                  type="text"
                  inputMode="decimal"
                  disabled={!editavel}
                  value={base}
                  onChange={(event) => setBase(event.target.value)}
                />
                <p className="field__hint">Os tempos de execução se referem a esta quantidade.</p>
              </div>
              <div className="field field--narrow">
                <label htmlFor="ppr-unidade">Unidade da base</label>
                <select
                  id="ppr-unidade"
                  disabled={!editavel}
                  value={unidade}
                  onChange={(event) => setUnidade(event.target.value)}
                >
                  {unidadesDoSelect.map((unit) => (
                    <option key={unit.code} value={unit.code}>
                      {unit.code} — {unit.label}
                    </option>
                  ))}
                </select>
                <p className="field__hint">
                  Mesma dimensão da unidade do produto que usar o perfil.
                </p>
              </div>
            </div>

            {etapas.length === 0 ? (
              <p className="field__hint">Nenhuma etapa ainda.</p>
            ) : (
              <ol className="profile-steps">
                {etapas.map((etapa, indice) => {
                  const numero = indice + 1;
                  const prefixo = `ppr-${etapa.chave}`;
                  return (
                    <li key={etapa.chave} className="profile-step">
                      <div className="profile-step__head">
                        <span className="profile-step__seq">Etapa {numero}</span>
                        {editavel && (
                          <div className="profile-step__order">
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              aria-label={`Mover etapa ${numero} para cima`}
                              disabled={indice === 0}
                              onClick={() => moverEtapa(indice, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              aria-label={`Mover etapa ${numero} para baixo`}
                              disabled={indice === etapas.length - 1}
                              onClick={() => moverEtapa(indice, 1)}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              aria-label={`Remover etapa ${numero}`}
                              onClick={() =>
                                setEtapas((atual) => atual.filter((_, i) => i !== indice))
                              }
                            >
                              Remover
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="profile-step__fields">
                        <div className="field">
                          <label htmlFor={`${prefixo}-nome`}>Nome da etapa</label>
                          <input
                            id={`${prefixo}-nome`}
                            type="text"
                            disabled={!editavel}
                            value={etapa.name}
                            onChange={(event) => alterarEtapa(indice, { name: event.target.value })}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`${prefixo}-modo`}>Modo de escala</label>
                          <select
                            id={`${prefixo}-modo`}
                            disabled={!editavel}
                            value={etapa.scalingMode}
                            onChange={(event) =>
                              alterarEtapa(indice, {
                                scalingMode: event.target.value as ProductionStepScalingMode,
                              })
                            }
                          >
                            <option value="PROPORTIONAL">
                              {PRODUCTION_STEP_SCALING_MODE_LABELS.PROPORTIONAL}
                            </option>
                            <option value="BY_BATCH">{PRODUCTION_STEP_SCALING_MODE_LABELS.BY_BATCH}</option>
                          </select>
                          <p className="field__hint">
                            {etapa.scalingMode === "BY_BATCH"
                              ? `Em lotes de ${baseTexto}: lote começado conta inteiro.`
                              : `Proporcional à quantidade, a partir de ${baseTexto}.`}
                          </p>
                        </div>
                        <div className="field">
                          <label htmlFor={`${prefixo}-preparacao`}>Preparação (min)</label>
                          <input
                            id={`${prefixo}-preparacao`}
                            type="text"
                            inputMode="numeric"
                            disabled={!editavel}
                            value={etapa.preparacao}
                            onChange={(event) =>
                              alterarEtapa(indice, { preparacao: event.target.value })
                            }
                          />
                          <p className="field__hint">Não escala com a quantidade.</p>
                        </div>
                        <div className="field">
                          <label htmlFor={`${prefixo}-execucao`}>
                            {etapa.scalingMode === "BY_BATCH"
                              ? "Execução por lote (min)"
                              : "Execução da base (min)"}
                          </label>
                          <input
                            id={`${prefixo}-execucao`}
                            type="text"
                            inputMode="numeric"
                            disabled={!editavel}
                            value={etapa.execucao}
                            onChange={(event) =>
                              alterarEtapa(indice, { execucao: event.target.value })
                            }
                          />
                          <p className="field__hint">
                            {etapa.scalingMode === "BY_BATCH"
                              ? `Tempo de um lote de ${baseTexto}.`
                              : `Tempo para ${baseTexto}.`}
                          </p>
                        </div>
                        <div className="field profile-step__wide">
                          <label htmlFor={`${prefixo}-descricao`}>Descrição (opcional)</label>
                          <input
                            id={`${prefixo}-descricao`}
                            type="text"
                            disabled={!editavel}
                            value={etapa.description}
                            onChange={(event) =>
                              alterarEtapa(indice, { description: event.target.value })
                            }
                          />
                        </div>
                      </div>

                      <div className="profile-step__resources">
                        <p className="profile-step__subtitle">Recursos da etapa</p>
                        {etapa.recursos.length === 0 && (
                          <p className="field__hint">Nenhum recurso: a etapa só conta tempo.</p>
                        )}
                        {etapa.recursos.map((linha, j) => (
                          <div key={linha.chave} className="profile-step__resource">
                            <div className="field">
                              <label htmlFor={`${prefixo}-recurso-${linha.chave}`}>Recurso</label>
                              <select
                                id={`${prefixo}-recurso-${linha.chave}`}
                                disabled={!editavel}
                                value={linha.industrialResourceId}
                                onChange={(event) =>
                                  alterarRecurso(indice, j, { industrialResourceId: event.target.value })
                                }
                              >
                                <option value="">Selecione…</option>
                                {opcoesDeRecurso(linha.industrialResourceId).map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.code} — {item.name} ({INDUSTRIAL_RESOURCE_TYPE_LABELS[item.type]}
                                    {item.active ? "" : ", inativo"})
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="field field--narrow">
                              <label htmlFor={`${prefixo}-quantidade-${linha.chave}`}>
                                Quantidade de recursos
                              </label>
                              <input
                                id={`${prefixo}-quantidade-${linha.chave}`}
                                type="text"
                                inputMode="numeric"
                                disabled={!editavel}
                                value={linha.quantidade}
                                onChange={(event) =>
                                  alterarRecurso(indice, j, { quantidade: event.target.value })
                                }
                              />
                            </div>
                            {editavel && (
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                aria-label={`Remover recurso ${j + 1} da etapa ${numero}`}
                                onClick={() => removerRecurso(indice, j)}
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        ))}
                        {editavel && etapa.recursos.length < PRODUCTION_STEP_LIMITS.maxResourcesPerStep && (
                          <div>
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              onClick={() => adicionarRecurso(indice)}
                            >
                              + Adicionar recurso
                            </button>
                          </div>
                        )}
                        <p className="field__hint">
                          Quantos trabalham ao mesmo tempo. 2 operadores por 2 h: a etapa dura 2 h e
                          ocupa 4 horas-recurso. Energia não entra — ela fica na Estrutura de Custos.
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {editavel && (
              <div className="line-actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={etapas.length >= PRODUCTION_STEP_LIMITS.maxSteps}
                  onClick={() => setEtapas((atual) => [...atual, etapaNova()])}
                >
                  + Adicionar etapa
                </button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={saving}
                  onClick={salvarRascunho}
                >
                  Salvar rascunho
                </button>
                <button
                  type="button"
                  className="btn btn--accent btn--sm"
                  disabled={saving || alterado}
                  onClick={() => void run(() => activateProductionProfileVersion(rascunho.id))}
                >
                  Ativar versão
                </button>
              </div>
            )}
            {editavel && alterado && (
              <p className="field__hint" role="status">
                Alterações não salvas — salve o rascunho antes de ativar.
              </p>
            )}

            <h4 className="profile-subtitle">Simulação — rascunho em edição</h4>
            <ProfilePreview
              idPrefix="ppr-rascunho"
              referenceQuantity={baseLida}
              referenceUomCode={unidade}
              steps={passosSimulados}
              motivo={motivoSimulacao}
            />
          </FormSection>
        )}

        {(ativa || profile.defaultProducts.length > 0) && (
          <FormSection
            title="Produtos com este perfil como padrão"
            subtitle="O produto aponta para a versão ativa, e ativar uma versão nova leva junto quem usava a anterior deste perfil. Produto de outro perfil, ou sem perfil, não é tocado."
          >
            {profile.defaultProducts.length === 0 ? (
              <p className="field__hint">Nenhum produto usa este perfil como padrão.</p>
            ) : (
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Versão</th>
                      <th aria-hidden="true" />
                    </tr>
                  </thead>
                  <tbody>
                    {profile.defaultProducts.map((item) => (
                      <tr key={item.productId}>
                        <td>
                          <code>{item.productCode}</code> {item.productName}
                        </td>
                        <td>
                          V{item.versionNumber} · {TEMPLATE_VERSION_STATUS_LABELS[item.versionStatus]}
                        </td>
                        <td>
                          {canEdit && (
                            <div className="line-actions">
                              <button
                                type="button"
                                className="btn btn--ghost btn--sm"
                                disabled={saving}
                                onClick={() =>
                                  void run(() => setProductProductionProfile(item.productId, null))
                                }
                              >
                                Tirar padrão
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {canEdit && ativa && (
              <div className="planning-product-picker">
                <div className="field">
                  <label htmlFor="ppr-produto">Produto</label>
                  <SearchableEntitySelect
                    id="ppr-produto"
                    options={opcoesProduto}
                    value={produtoEscolhido}
                    onChange={setProdutoEscolhido}
                    onSearch={buscarProdutos}
                    placeholder="Digite código ou nome do produto…"
                  />
                </div>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={!produtoEscolhido || saving}
                  onClick={() =>
                    void run(async () => {
                      await setProductProductionProfile(produtoEscolhido, ativa.id);
                      setProdutoEscolhido("");
                    })
                  }
                >
                  Definir {ativa.versionLabel} como padrão
                </button>
                <p className="field__hint">
                  A quantidade-base ({formatQuantity(ativa.referenceQuantity)} {ativa.referenceUomCode})
                  precisa estar na mesma dimensão da unidade do produto.
                </p>
              </div>
            )}
          </FormSection>
        )}

        <FormSection
          title="Versões"
          subtitle="A ativa é congelada; ao ativar uma nova, a anterior fica arquivada, com o histórico inteiro."
        >
          <ul className="profile-versions">
            {profile.versions.map((version) => (
              <li key={version.id}>
                {version.versionLabel} · {TEMPLATE_VERSION_STATUS_LABELS[version.status]}
                {version.activatedAt ? ` · ativada em ${formatDateTime(version.activatedAt)}` : ""}
                {version.sourceVersionNumber ? ` · copiada da V${version.sourceVersionNumber}` : ""}
              </li>
            ))}
          </ul>
        </FormSection>
      </div>
    </div>
  );
}
