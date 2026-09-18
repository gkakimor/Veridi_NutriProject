import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
import { useContextualCreateOrigin } from "../../lib/use-contextual-create";
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
  CAPACITY_RESOURCE_TYPES,
  PRODUCTION_STEP_LIMITS,
  PRODUCTION_STEP_SCALING_MODE_LABELS,
  ProductionPlanInputError,
  TEMPLATE_VERSION_STATUS_LABELS,
  planProductionProfile,
} from "@veridi/shared";
import {
  activateProductionProfileVersion,
  createProductionProfileVersionFrom,
  getProductionProfile,
  setProductProductionProfile,
  setProductionProfileArchived,
  updateProductionProfile,
  updateProductionProfileVersion,
} from "../../lib/production-profiles-api";
import { opcaoDeRecurso, useRecursosDoSeletor } from "../../lib/recursos-do-seletor";
import type { RecorteDeRecursos } from "../../lib/recursos-do-seletor";
import { listUnits } from "../../lib/units-api";
import { listProducts } from "../../lib/products-api";
import { apiErrorMessage } from "../../lib/api-errors";
import { decimalComparavel, inteiroComparavel, textoComparavel } from "../../lib/dirty-fields";
import { decimalLegivel, exigirDecimal } from "../../lib/decimal-field";
import { lerInteiroOpcional } from "../../lib/integer-input";
import { toPtBrEditText, formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { CASAS_QUANTIDADE, OPCOES_QUANTIDADE } from "../../lib/numeric-scales";
import { DecimalField, IntegerField } from "../../components/NumericField";
import { formatQuantity } from "../../lib/quantity";
import { formatDateTime } from "../../lib/dates";
import { formatMinutes, formatMinutesPlain } from "../../lib/duration";
import { ConfirmDialog } from "../../components/ConfirmDialog";
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
 * Detalhe de um Roteiro de Produção (`PRODUCT_RULES.md` §89).
 *
 * O nome técnico continua `ProductionProfile` — rota, API e schema inclusive.
 * Só a palavra que o usuário lê virou "roteiro" (PRODUCTION-ROUTE-UX-01),
 * porque "perfil" não diz a ninguém que a tela responde "como se fabrica".
 *
 * A versão ativa é congelada e só se lê; o rascunho se edita inteiro — etapas
 * em cartões, ordem por ↑ ↓, recursos com a quantidade que trabalha AO MESMO
 * TEMPO. A simulação usa o mesmo motor do servidor (`planProductionProfile`)
 * e não grava nada.
 */

/** Só mão de obra e equipamento ativos entram numa etapa: energia não é capacidade (§89). */
const RECURSOS_DE_CAPACIDADE: RecorteDeRecursos = {
  tipos: CAPACITY_RESOURCE_TYPES,
  somenteAtivos: true,
};

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

/**
 * As ações que gravam o rascunho no servidor. Depois delas a releitura traz
 * base, unidade e etapas como o servidor as deixou — normalizadas: `250,5` vira
 * `250.5`, `030` vira `30` —, e é isso que passa a valer na tela. As outras
 * (identificação, padrão dos produtos) não tocam no rascunho, e a releitura que
 * vem depois delas não o traz por cima de uma pendência.
 */
const ACOES_QUE_GRAVAM_O_RASCUNHO = new Set(["rascunho", "ativar", "nova-versao"]);

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

/**
 * Só o que o servidor grava — a chave de lista não é alteração. Os números
 * comparam pelo valor (PTBR-NUMERIC-INPUT-ROLLOUT-01): `250,5` e `250,50` são a
 * mesma base, `030` e `30` o mesmo tempo, e sair do campo não é pendência.
 */
function assinatura(base: string, unidade: string, etapas: EtapaRascunho[]): string {
  return JSON.stringify({
    base: decimalComparavel(base),
    unidade,
    etapas: etapas.map(({ chave: _chave, recursos, ...resto }) => ({
      ...resto,
      preparacao: inteiroComparavel(resto.preparacao),
      execucao: inteiroComparavel(resto.execucao),
      recursos: recursos.map(({ chave: _chaveRecurso, ...recurso }) => ({
        ...recurso,
        quantidade: inteiroComparavel(recurso.quantidade),
      })),
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
            `${rotulo} — quantidade necessária (${nomeDoRecurso(recurso.industrialResourceId)})`,
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
 * Simulação do roteiro para uma quantidade — conta local, nada é gravado.
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
  // A base chega canônica (da API ou já lida): no campo, em português.
  const [quantidade, setQuantidade] = useState(() =>
    toPtBrEditText(referenceQuantity, OPCOES_QUANTIDADE),
  );

  let plano: ProductionPlan | null = null;
  let aviso = motivo;
  if (!aviso) {
    const alvo = decimalLegivel(quantidade, OPCOES_QUANTIDADE);
    if (!alvo) aviso = "Informe a quantidade para simular.";
    else if (!referenceQuantity) aviso = "Informe a quantidade de referência do roteiro.";
    else if (!steps || steps.length === 0) aviso = "Adicione etapas para simular o roteiro.";
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
    <section className="profile-preview" aria-label="Simulação do roteiro">
      <p className="field__hint">
        Veja quanto tempo e quanto recurso seriam necessários para outra quantidade. A simulação não
        grava nada.
      </p>
      <div className="field field--narrow">
        <label htmlFor={`${idPrefix}-quantidade`}>Quantidade para simular ({referenceUomCode})</label>
        <DecimalField
          id={`${idPrefix}-quantidade`}
          scale={CASAS_QUANTIDADE}
          value={quantidade}
          onChangeValue={setQuantidade}
        />
        <p className="field__hint">Só simula: nada é gravado. Use vírgula para as casas decimais.</p>
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
                                papel: "quantidade de referência",
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
                          {formatIntegerPtBr(recurso.resourceQuantity)} × {recurso.resourceName}:{" "}
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
                                valor: formatIntegerPtBr(recurso.resourceQuantity),
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

/**
 * O resumo do roteiro — o mesmo motor, nenhuma conta nova.
 *
 * Quatro fatos que se leem antes de abrir etapa por etapa: quantas etapas, o
 * tempo sequencial para a PRÓPRIA quantidade de referência, e quantos tipos de
 * mão de obra e de equipamento o roteiro usa. Nada de capacidade nem de pico
 * simultâneo: isso não sai do plano, e inventar aqui seria número sem lastro.
 */
function ResumoDoRoteiro({
  referenceQuantity,
  referenceUomCode,
  steps,
}: {
  referenceQuantity: string | null;
  referenceUomCode: string;
  steps: ProductionPlanStepInput[] | null;
}) {
  if (!referenceQuantity || !steps || steps.length === 0) return null;
  let plano: ProductionPlan;
  try {
    plano = planProductionProfile({ referenceQuantity, steps }, referenceQuantity);
  } catch {
    // Rascunho incompleto já é avisado campo a campo; resumo some, não mente.
    return null;
  }
  const tipos = (tipo: IndustrialResourceType) =>
    plano.resources.filter((recurso) => recurso.resourceType === tipo).length;
  const maoDeObra = tipos("LABOR");
  const equipamento = tipos("EQUIPMENT");
  const base = `${formatQuantity(plano.referenceQuantity)} ${referenceUomCode}`;
  return (
    <>
      <h4 className="profile-subtitle">Resumo do roteiro</h4>
      <dl className="profile-summary" role="group" aria-label="Resumo do roteiro">
        <div>
          <dt>Etapas</dt>
          <dd>{plano.steps.length}</dd>
        </div>
        <div>
          <dt>Tempo para {base}</dt>
          <dd>{formatMinutes(plano.totalDurationMinutes)}</dd>
        </div>
        <div>
          <dt>Tipos de mão de obra</dt>
          <dd>{maoDeObra}</dd>
        </div>
        <div>
          <dt>Tipos de equipamento</dt>
          <dd>{equipamento}</dd>
        </div>
      </dl>
    </>
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
                      .map((recurso) => `${formatIntegerPtBr(recurso.resourceQuantity)} × ${recurso.resourceName}`)
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
  /*
   * A ação em curso pelo NOME, não um booleano: o booleano desabilitava os
   * três botões — certo — mas fazia "Salvando…" aparecer no botão errado.
   */
  const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null);
  const saving = acaoEmCurso !== null;
  /** O que a última ação gravou, no bloco que a disparou. Um estado só. */
  const [feito, setFeito] = useState<{ bloco: string; texto: string } | null>(null);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [base, setBase] = useState("1000");
  const [unidade, setUnidade] = useState("un");
  const [etapas, setEtapas] = useState<EtapaRascunho[]>([]);
  const [salvo, setSalvo] = useState("");
  const [unidades, setUnidades] = useState<UnitOfMeasureDTO[]>([]);
  const [opcoesProduto, setOpcoesProduto] = useState<EntityOption[]>([]);
  const [produtoEscolhido, setProdutoEscolhido] = useState("");
  /* Arquivar pede confirmação: tira o roteiro das ordens novas dos produtos que o usam. */
  const [confirmarArquivar, setConfirmarArquivar] = useState(false);

  /*
   * A identificação que o servidor devolveu na última leitura — `null` antes
   * da primeira.
   *
   * Identificação e rascunho gravam separado: salvar o rascunho recarrega o
   * roteiro, e a leitura reescrevia por cima o nome que a pessoa acabara de
   * digitar e ainda não salvou. Com a leitura anterior em mãos dá para
   * separar "ainda está como o servidor deixou" de "a pessoa mexeu".
   */
  const lido = useRef<{ nome: string; descricao: string } | null>(null);

  /**
   * O rascunho restaurado ganha do servidor na carga inicial.
   *
   * Quem volta do cadastro de recurso chega junto com a carga do roteiro, e ela
   * traz o rascunho como está gravado: sem esta trava a resposta, que chega
   * depois, trocaria base, unidade e etapas pelas do servidor. A carga inicial é
   * a que sai sem leitura anterior — no dev o StrictMode pede duas, e a segunda
   * não pode escrever por cima só porque a primeira voltou antes. Salvar, ativar
   * e criar versão recarregam depois da primeira leitura: aí o servidor é a
   * verdade, e a trava não precisa ser desarmada.
   */
  const rascunhoRestaurado = useRef(false);

  /**
   * O `alteradoNaTela` do último render, para a releitura que volta depois de
   * uma ação.
   *
   * "Salvar identificação" recarregava o roteiro, e a leitura trocava base,
   * unidade e etapas digitadas pelas do servidor: a pendência sumia e a guarda
   * deixava sair calada. A pendência é lida quando a resposta chega, não no
   * clique — o que se digitou enquanto a identificação gravava também é da
   * pessoa.
   */
  const rascunhoPendente = useRef(false);

  /**
   * A assinatura do rascunho no último render.
   *
   * "Salvar rascunho" recarrega o roteiro, e a leitura trocava pelo gravado o que
   * se digitou DEPOIS do clique: salvou 500, digitou 700 durante a gravação, a
   * resposta devolvia 500 e a pendência sumia. A ação que grava o rascunho guarda
   * a tela do clique; na resposta, tela igual à do clique recebe o servidor
   * (normalizado), tela diferente fica como está — e pendente contra o gravado.
   */
  const assinaturaNaTela = useRef("");

  const load = useCallback((recarga: { manterRascunhoPendente?: boolean; telaNoClique?: string } = {}) => {
    if (!profileId) return;
    const cargaInicial = lido.current === null;
    getProductionProfile(profileId)
      .then((result) => {
        setProfile(result);
        const anterior = lido.current ?? { nome: "", descricao: "" };
        lido.current = { nome: result.name, descricao: result.description ?? "" };
        // A tela tem o rascunho de quem voltou: a leitura só diz o que está gravado.
        const manterRestaurado = cargaInicial && rascunhoRestaurado.current;
        if (!manterRestaurado) {
          setNome((atual) => (atual === anterior.nome ? result.name : atual));
          setDescricao((atual) =>
            atual === anterior.descricao ? (result.description ?? "") : atual,
          );
        }
        const rascunho = result.draftVersion;
        if (rascunho) {
          const lidas = etapasDoDTO(rascunho);
          // `salvo` continua sendo o servidor: o que ficou na tela segue pendente.
          const manterPendente =
            recarga.manterRascunhoPendente === true
              ? rascunhoPendente.current
              : recarga.telaNoClique !== undefined && assinaturaNaTela.current !== recarga.telaNoClique;
          if (!manterRestaurado && !manterPendente) {
            setBase(toPtBrEditText(rascunho.referenceQuantity, OPCOES_QUANTIDADE));
            setUnidade(rascunho.referenceUomCode);
            setEtapas(lidas);
          }
          setSalvo(
            assinatura(
              toPtBrEditText(rascunho.referenceQuantity, OPCOES_QUANTIDADE),
              rascunho.referenceUomCode,
              lidas,
            ),
          );
        } else {
          setEtapas([]);
          setSalvo("");
        }
      })
      .catch((err: unknown) => setError(apiErrorMessage(err, "Falha ao carregar o roteiro")));
  }, [profileId]);

  useEffect(() => load(), [load]);

  useEffect(() => {
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

  /** Recursos já gravados nas etapas (um inativo continua com nome). */
  const gravados = useMemo(() => {
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
    return mapa;
  }, [profile]);

  /*
   * Recurso da etapa: primeira página curta e busca no servidor, só entre mão
   * de obra e equipamento ativos. Eram os 100 primeiros recursos ativos num
   * `<select>`: do 101º em diante o recurso existia e a etapa não o aceitava.
   * O que o rascunho já tem e a tela não conhece — restaurado da volta de um
   * cadastro, ou o recurso recém-criado — é resolvido pelo id.
   */
  const recursosDaEtapa = useRecursosDoSeletor(RECURSOS_DE_CAPACIDADE, {
    carregar: canEdit && profile?.draftVersion != null,
    escolhidos: etapas
      .flatMap((etapa) => etapa.recursos.map((linha) => linha.industrialResourceId))
      .filter((id) => !gravados.has(id)),
  });

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

  /*
   * A mesma assinatura que desenha "Alterações não salvas" alimenta a guarda
   * de saída — base, unidade, etapas, recursos e tempos, tudo numa string.
   *
   * Fica ACIMA do retorno de carregamento porque hook não pode nascer depois
   * de um `return`, e sem perfil carregado ela dá `false`: sem rascunho não há
   * o que perder. Salvar recarrega o perfil e a assinatura gravada volta a ser
   * a da tela.
   */
  const alteradoNaTela =
    profile?.draftVersion != null && assinatura(base, unidade, etapas) !== salvo;
  rascunhoPendente.current = alteradoNaTela;
  assinaturaNaTela.current = assinatura(base, unidade, etapas);
  /*
   * Identificação grava separado do rascunho, e por isso tem pendência
   * própria. É a MESMA guarda — nenhum `dirty` paralelo —, só somando o
   * segundo bloco: "Salvar rascunho" não absolve o nome trocado.
   */
  const identificacaoAlterada =
    profile !== null &&
    canEdit &&
    (textoComparavel(nome) !== textoComparavel(profile.name) ||
      textoComparavel(descricao) !== textoComparavel(profile.description));
  const { liberarGuarda } = useUnsavedChangesGuard({
    isDirty: alteradoNaTela || identificacaoAlterada,
    substantivo: "roteiro de produção",
  });

  /*
   * Sair para cadastrar um recurso desmonta esta tela. O rascunho inteiro vai
   * junto — identificação, quantidade de referência e as etapas com os
   * recursos —, e volta aplicado. O recurso criado entra na linha que pediu.
   */
  const { goCreate } = useContextualCreateOrigin<Record<string, unknown>>({
    collectDraft: () => ({ nome, descricao, base, unidade, etapas }),
    restoreDraft: (rascunho) => {
      // Antes de qualquer `setState`: a carga do roteiro está a caminho.
      rascunhoRestaurado.current = true;
      const texto = (chave: string) =>
        typeof rascunho[chave] === "string" ? (rascunho[chave] as string) : "";
      setNome(texto("nome"));
      setDescricao(texto("descricao"));
      setBase(texto("base"));
      setUnidade(texto("unidade"));
      if (Array.isArray(rascunho["etapas"])) setEtapas(rascunho["etapas"] as EtapaRascunho[]);
    },
    onCreated: (resultado, registro) => {
      // A volta monta a tela de novo e a primeira página já sai depois do
      // cadastro; fora dela, o recurso posto na linha é resolvido pelo id.
      const contexto = registro.context ?? {};
      const etapa = contexto["etapa"];
      const linha = contexto["recurso"];
      if (typeof etapa !== "number" || typeof linha !== "number") return;
      setEtapas((atual) =>
        atual.map((item, i) =>
          i !== etapa
            ? item
            : {
                ...item,
                recursos: item.recursos.map((recurso, j) =>
                  j === linha ? { ...recurso, industrialResourceId: resultado.entityId } : recurso,
                ),
              },
        ),
      );
    },
  });

  /** Sai para o cadastro oficial de recurso guardando o rascunho desta tela. */
  const cadastrarRecurso = (contexto?: { etapa: number; recurso: number }) =>
    liberarGuarda(() =>
      goCreate({
        route: "/gestao/recursos-industriais/novo",
        fieldKey: "industrialResourceId",
        entityType: "industrialResource",
        ...(contexto ? { context: contexto } : {}),
      }),
    );

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
  const alterado = alteradoNaTela;
  // O catálogo vem antes: traz o `active` de agora, e o gravado, o da leitura.
  const recurso = (id: string): RecursoConhecido | undefined =>
    recursosDaEtapa.recurso(id) ?? gravados.get(id);
  const nomeDoRecurso = (id: string) => recurso(id)?.name ?? "recurso";
  const baseLida = decimalLegivel(base, OPCOES_QUANTIDADE);
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

  /** Opções do campo: capacidade ativa do catálogo + o já escolhido, se saiu dele. */
  const opcoesDeRecurso = (escolhido: string): EntityOption[] => {
    const lista: RecursoConhecido[] = [...recursosDaEtapa.catalogo];
    const atual = escolhido ? recurso(escolhido) : undefined;
    if (atual && !lista.some((item) => item.id === atual.id)) lista.push(atual);
    return lista.map((item) => opcaoDeRecurso(item, { comTipo: true }));
  };
  const buscarRecursoDaEtapa = async (termo: string) =>
    (await recursosDaEtapa.buscar(termo)).map((item) => opcaoDeRecurso(item, { comTipo: true }));

  async function run(
    acao: string,
    action: () => Promise<unknown>,
    sucesso?: { bloco: string; texto: string },
  ) {
    // A tela que a ação levou: o que mudar depois disto é da pessoa, não do servidor.
    const telaNoClique = assinaturaNaTela.current;
    setAcaoEmCurso(acao);
    setError(null);
    setFeito(null);
    try {
      await action();
      load(
        ACOES_QUE_GRAVAM_O_RASCUNHO.has(acao)
          ? { telaNoClique }
          : { manterRascunhoPendente: true },
      );
      // Só depois de a ação passar: erro que caísse aqui deixaria a tela
      // dizendo "salvo" sobre o que não foi gravado.
      if (sucesso) setFeito(sucesso);
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao executar a ação"));
    } finally {
      setAcaoEmCurso(null);
    }
  }

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
    void run(
      "rascunho",
      () =>
        updateProductionProfileVersion(rascunho.id, {
          referenceQuantity: exigirDecimal(base, "Quantidade de referência", OPCOES_QUANTIDADE),
          referenceUomCode: unidade,
          steps: lerEtapas(etapas, nomeDoRecurso),
        }),
      { bloco: "rascunho", texto: "Rascunho salvo." },
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
              { label: "Roteiros de Produção", href: "/planejamento/perfis-producao" },
              { label: "Detalhe" },
            ]}
          />
          <h1 className="doc-title">
            <code>{profile.code}</code> {profile.name}
            {profile.archived && <span className="badge badge--neutral">Arquivado</span>}
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

        {/* Arquivado é do cadastro pai: nada some da consulta, só deixa de ser
            oferecido para compromisso novo (PRODUCTION-PROFILE-ARCHIVE-01). */}
        {profile.archived && (
          <div className="pendency-panel" role="status">
            <p className="pendency-panel__title">Roteiro arquivado</p>
            <p className="pendency-panel__sub">
              {profile.archivedAt
                ? `Arquivado em ${formatDateTime(profile.archivedAt)}${profile.archivedBy ? ` por ${profile.archivedBy}` : ""}. `
                : ""}
              Não é oferecido como roteiro padrão de produto nem para ordem nova. Versões, histórico e as
              cópias já feitas nas ordens continuam como estão; os produtos que ainda o têm como padrão
              recebem ordens novas sem roteiro.
            </p>
          </div>
        )}

        <ContextHelp topic={helpTopics["planejamento.perfisProducao"]} />

        <FormSection
          title="Identificação"
          subtitle="O roteiro pode ser reutilizado por diferentes produtos que sigam o mesmo processo de fabricação: vários produtos podem ter a mesma versão como padrão."
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
            <div className="form-actions form-actions--split">
              <div className="form-actions__group">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={saving || !nome.trim()}
                  onClick={() =>
                    void run(
                      "identificacao",
                      () =>
                        updateProductionProfile(profile.id, {
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
                {estadoDoBloco("situacao", false)}
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={saving}
                  onClick={() =>
                    profile.archived
                      ? void run("desarquivar", () => setProductionProfileArchived(profile.id, false), {
                          bloco: "situacao",
                          texto: "Roteiro desarquivado.",
                        })
                      : setConfirmarArquivar(true)
                  }
                >
                  {acaoEmCurso === "arquivar"
                    ? "Arquivando…"
                    : acaoEmCurso === "desarquivar"
                      ? "Desarquivando…"
                      : profile.archived
                        ? "Desarquivar"
                        : "Arquivar"}
                </button>
              </div>
            </div>
          )}
        </FormSection>

        {ativa && (
          <FormSection
            title={`Versão ativa — ${ativa.versionLabel}`}
            subtitle="Congelada: para mudar o roteiro, crie uma nova versão. As etapas acontecem uma depois da outra."
          >
            <ResumoDoRoteiro
              referenceQuantity={ativa.referenceQuantity}
              referenceUomCode={ativa.referenceUomCode}
              steps={simulacaoDaVersao(ativa)}
            />
            <dl className="definition-list">
              <dt>Quantidade de referência</dt>
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
                      void run("nova-versao", () => createProductionProfileVersionFrom(ativa.id))
                    }
                  >
                    {acaoEmCurso === "nova-versao" ? "Criando…" : "Criar nova versão"}
                  </button>
                  {estadoDoBloco("versao-ativa", false)}
                </div>
              </div>
            )}
            <h4 className="profile-subtitle">Simulação do roteiro — {ativa.versionLabel}</h4>
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
            subtitle="Defina as etapas, os tempos e os recursos necessários para fabricar uma quantidade de referência. Só o rascunho se edita."
          >
            <div className="field-grid-2">
              <div className="field field--narrow">
                <label htmlFor="ppr-base">Quantidade de referência</label>
                <DecimalField
                  id="ppr-base"
                  scale={CASAS_QUANTIDADE}
                  disabled={!editavel}
                  value={base}
                  onChangeValue={setBase}
                />
                <p className="field__hint">
                  Quantidade usada como referência para os tempos de execução abaixo. Ex.: se
                  encapsular 1000 un leva 60 min, informe 1000.
                </p>
              </div>
              <div className="field field--narrow">
                <label htmlFor="ppr-unidade">Unidade de referência</label>
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
                  Use a mesma unidade do produto que utilizará este roteiro.
                </p>
              </div>
            </div>

            <h4 className="profile-subtitle">Etapas do processo</h4>
            <p className="field__hint">
              As etapas acontecem na ordem abaixo. Cada etapa começa depois que a anterior termina.
            </p>
            {/* Catálogo vazio não é "escolha alguma coisa": é cadastro que
                ainda não existe, e a tela diz onde fazê-lo sem perder o
                rascunho. Vale para a tela, não para cada cartão. */}
            {editavel && recursosDaEtapa.respondeu && recursosDaEtapa.catalogo.length === 0 ? (
              <div className="profile-empty">
                <p className="profile-empty__title">Nenhum recurso de produção cadastrado.</p>
                <p className="field__hint">
                  Cadastre mão de obra ou equipamento para vinculá-los às etapas do roteiro.
                </p>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  onClick={() => cadastrarRecurso()}
                >
                  Cadastrar recurso
                </button>
              </div>
            ) : (
              <p className="field__hint">
                Os recursos são cadastrados em Modelos e parâmetros →{" "}
                <Link to="/gestao/recursos-industriais">Recursos industriais</Link>.
              </p>
            )}

            {etapas.length === 0 ? (
              <div className="profile-empty">
                <p className="profile-empty__title">Nenhuma etapa cadastrada.</p>
                <p className="field__hint">
                  Comece adicionando uma etapa como Pesagem, Mistura, Encapsulamento ou Embalagem.
                </p>
                {editavel && (
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    onClick={() => setEtapas((atual) => [...atual, etapaNova()])}
                  >
                    + Adicionar etapa
                  </button>
                )}
              </div>
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
                              ? `O tempo de execução cresce a cada lote de ${baseTexto} — lote começado conta inteiro.`
                              : `O tempo de execução cresce proporcionalmente à quantidade, a partir de ${baseTexto}.`}
                          </p>
                        </div>
                        <div className="field">
                          <label htmlFor={`${prefixo}-preparacao`}>Preparação (min)</label>
                          <IntegerField
                            id={`${prefixo}-preparacao`}
                            disabled={!editavel}
                            value={etapa.preparacao}
                            onChangeValue={(preparacao) => alterarEtapa(indice, { preparacao })}
                          />
                          <p className="field__hint">
                            Tempo fixo da etapa. Não aumenta com a quantidade.
                          </p>
                        </div>
                        <div className="field">
                          <label htmlFor={`${prefixo}-execucao`}>
                            {etapa.scalingMode === "BY_BATCH"
                              ? "Execução por lote (min)"
                              : "Execução da base (min)"}
                          </label>
                          <IntegerField
                            id={`${prefixo}-execucao`}
                            disabled={!editavel}
                            value={etapa.execucao}
                            onChangeValue={(execucao) => alterarEtapa(indice, { execucao })}
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
                        <p className="profile-step__subtitle">Recursos necessários para a etapa</p>
                        <p className="field__hint">
                          Informe a mão de obra e os equipamentos que precisam estar disponíveis ao
                          mesmo tempo durante esta etapa.
                        </p>
                        {etapa.recursos.length === 0 && (
                          <p className="field__hint">Nenhum recurso: a etapa só conta tempo.</p>
                        )}
                        {etapa.recursos.map((linha, j) => (
                          <div key={linha.chave} className="profile-step__resource">
                            <div className="field">
                              <label htmlFor={`${prefixo}-recurso-${linha.chave}`}>Recurso</label>
                              <SearchableEntitySelect
                                id={`${prefixo}-recurso-${linha.chave}`}
                                disabled={!editavel}
                                value={linha.industrialResourceId}
                                onChange={(industrialResourceId) =>
                                  alterarRecurso(indice, j, { industrialResourceId })
                                }
                                placeholder="Digite código ou nome do recurso…"
                                options={opcoesDeRecurso(linha.industrialResourceId)}
                                onSearch={buscarRecursoDaEtapa}
                              />
                            </div>
                            <div className="field field--narrow">
                              <label htmlFor={`${prefixo}-quantidade-${linha.chave}`}>
                                Quantidade necessária
                              </label>
                              <IntegerField
                                id={`${prefixo}-quantidade-${linha.chave}`}
                                disabled={!editavel}
                                value={linha.quantidade}
                                onChangeValue={(quantidade) =>
                                  alterarRecurso(indice, j, { quantidade })
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
                        {editavel &&
                          recursosDaEtapa.catalogo.length > 0 &&
                          etapa.recursos.length < PRODUCTION_STEP_LIMITS.maxResourcesPerStep && (
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
                          A quantidade representa recursos simultâneos. Ex.: 2 operadores durante uma
                          etapa de 2 h ocupam 4 horas-recurso, mas a etapa continua durando 2 h.
                          Energia não é selecionada aqui: ela permanece na Estrutura de Custos.
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}

            {editavel && (
              <div className="form-actions form-actions--split">
                <div className="form-actions__group">
                  {/* Terciária: acrescentar etapa não grava nada. Com a lista
                      vazia, o botão já está no estado vazio acima. */}
                  {etapas.length > 0 && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={etapas.length >= PRODUCTION_STEP_LIMITS.maxSteps}
                      onClick={() => setEtapas((atual) => [...atual, etapaNova()])}
                    >
                      + Adicionar etapa
                    </button>
                  )}
                </div>
                <div className="form-actions__group">
                  {estadoDoBloco("rascunho", alterado)}
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    // Sem alteração pendente não há o que gravar, e a gravação
                    // em curso não aceita um segundo clique.
                    disabled={saving || !alterado}
                    onClick={salvarRascunho}
                  >
                    {acaoEmCurso === "rascunho" ? "Salvando…" : "Salvar rascunho"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--accent btn--sm"
                    disabled={saving || alterado}
                    onClick={() =>
                      void run("ativar", () => activateProductionProfileVersion(rascunho.id), {
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
            {editavel && alterado && (
              <p className="field__hint" role="status">
                Salve o rascunho antes de ativar a versão.
              </p>
            )}

            <ResumoDoRoteiro
              referenceQuantity={baseLida}
              referenceUomCode={unidade}
              steps={passosSimulados}
            />

            <h4 className="profile-subtitle">Simulação do roteiro — rascunho em edição</h4>
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
            title="Produtos que usam este roteiro como padrão"
            subtitle="O produto aponta para a versão ativa, e ativar uma versão nova leva junto quem usava a anterior deste roteiro. Produto de outro roteiro, ou sem roteiro, não é tocado."
          >
            {profile.defaultProducts.length === 0 ? (
              <p className="field__hint">Nenhum produto usa este roteiro como padrão.</p>
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
                                  void run("tirar-padrao", () => setProductProductionProfile(item.productId, null))
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

            {canEdit && ativa && profile.archived && (
              <p className="field__hint">
                Roteiro arquivado não é definido como padrão de produto. Desarquive para voltar a
                oferecê-lo.
              </p>
            )}

            {canEdit && ativa && !profile.archived && (
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
                    void run("definir-padrao", async () => {
                      await setProductProductionProfile(produtoEscolhido, ativa.id);
                      setProdutoEscolhido("");
                    })
                  }
                >
                  Definir {ativa.versionLabel} como padrão
                </button>
                <p className="field__hint">
                  A quantidade de referência ({formatQuantity(ativa.referenceQuantity)}{" "}
                  {ativa.referenceUomCode}) precisa estar na mesma dimensão da unidade do produto.
                </p>
              </div>
            )}
          </FormSection>
        )}

        <FormSection
          title="Versões"
          subtitle="A versão ativa fica congelada. Ao ativar uma nova versão, a anterior permanece no histórico."
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

      <ConfirmDialog
        open={confirmarArquivar}
        title="Arquivar este roteiro?"
        confirmLabel="Arquivar"
        cancelLabel="Cancelar"
        message={
          <>
            <p>
              <b>
                {profile.code} {profile.name}
              </b>{" "}
              deixa de ser oferecido como roteiro padrão de produto e para ordens novas. Nada é apagado:
              versões, histórico e as cópias já feitas nas ordens continuam como estão, e desarquivar
              devolve o roteiro às escolhas.
            </p>
            {profile.defaultProducts.length > 0 && (
              <p>
                {profile.defaultProducts.length === 1
                  ? "1 produto tem este roteiro como padrão."
                  : `${formatIntegerPtBr(profile.defaultProducts.length)} produtos têm este roteiro como padrão.`}{" "}
                O padrão continua gravado, mas as novas ordens desses produtos vão nascer sem roteiro até
                alguém escolher um roteiro ativo.
              </p>
            )}
          </>
        }
        onCancel={() => setConfirmarArquivar(false)}
        onConfirm={() => {
          setConfirmarArquivar(false);
          void run("arquivar", () => setProductionProfileArchived(profile.id, true), {
            bloco: "situacao",
            texto: "Roteiro arquivado.",
          });
        }}
      />
    </div>
  );
}
