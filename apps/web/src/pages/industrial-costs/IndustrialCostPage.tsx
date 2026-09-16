import { formatQuantity } from "../../lib/quantity";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProductRelatedLinks } from "../../components/ProductRelatedLinks";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useContextualCreateOrigin } from "../../lib/use-contextual-create";
import type {
  EnergyCalculationMode,
  IndustrialCostResourceUsageDTO,
  IndustrialCostVersionDTO,
  IndustrialResourceDTO,
  ProductIndustrialCostResponse,
} from "@veridi/shared";
import {
  DIRECT_INDUSTRIAL_COST_DEFINITION,
  INDUSTRIAL_COST_BASES,
  INDUSTRIAL_COST_BASIS_LABELS,
  INDUSTRIAL_COST_CATEGORIES,
  INDUSTRIAL_COST_CATEGORY_LABELS,
  INDUSTRIAL_COST_VERSION_STATUS_LABELS,
  ENERGY_CALCULATION_MODES,
  ENERGY_CALCULATION_MODE_LABELS,
  INDUSTRIAL_RATE_UOM_LABELS,
  INDUSTRIAL_RESOURCE_TYPE_LABELS,
  INDUSTRIAL_USAGE_BASIS_LABELS,
  FORMULATION_COMPONENT_BASIS_LABELS,
  INDUSTRIAL_RESOURCE_TYPES,
  acceptsResourceCount,
} from "@veridi/shared";
import type { IndustrialCostBasis, IndustrialCostCategory } from "@veridi/shared";
import { CostCalculationSection } from "./CostCalculationSection";
import { CostTemplateOrigin } from "../cost-templates/CostTemplateOrigin";
import { UseCostTemplateDialog } from "../cost-templates/UseCostTemplateDialog";
import { applyCostTemplateToProduct } from "../../lib/cost-pricing-templates-api";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { FormSection } from "../../components/FormSection";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { IndustrialCostPendencies } from "../../components/IndustrialCostPendencies";
import { RowActions } from "../../components/RowActions";
import { useAuth } from "../../app/AuthProvider";
import { apiErrorMessage } from "../../lib/api-errors";
import { exigirDecimal, exigirDecimalOpcional } from "../../lib/decimal-field";
import { toPtBrEditText, formatMoneyPtBr, formatPercentPtBr } from "../../lib/numeric-ptbr";
import {
  CASAS_QUANTIDADE,
  CASAS_VALOR_INDUSTRIAL,
  OPCOES_QUANTIDADE,
  OPCOES_VALOR_INDUSTRIAL,
  OPCOES_PERCENTUAL_TECNICO,
} from "../../lib/numeric-scales";
import { DecimalField, MoneyField, PercentField } from "../../components/NumericField";
import { decimalComparavel, textoComparavel } from "../../lib/dirty-fields";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
import {
  ResourceCountField,
  ResourceUsageAmount,
  exigirQuantidadeDeRecursos,
} from "../../components/ResourceUsageAmount";
import {
  activateIndustrialCostVersion,
  createIndustrialCostLine,
  createIndustrialCostVersion,
  createResourceUsage,
  deleteIndustrialCostLine,
  deleteResourceUsage,
  getProductIndustrialCosts,
  updateEnergyMode,
  updateIndustrialCostVersion,
  updateResourceUsage,
} from "../../lib/industrial-costs-api";
import { opcaoDeRecurso, useRecursosDoSeletor } from "../../lib/recursos-do-seletor";
import type { RecorteDeRecursos } from "../../lib/recursos-do-seletor";
import { ProjectOriginLink } from "../../components/ProjectOriginLink";
import { EntityLink } from "../../components/EntityLink";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { formatDateTime } from "../../lib/dates";
import { TableEmptyRow } from "../../components/TableEmptyRow";

/**
 * Energia ativa: a tarifa do kWh derivado e, no modo de consumo informado
 * diretamente, a energia do campo "Recurso" — o universo de quando as duas
 * saíam da lista de ativos.
 */
const ENERGIA_ATIVA: RecorteDeRecursos = { tipos: ["ENERGY"], somenteAtivos: true };

/**
 * O resto do campo "Recurso": todo tipo ativo que não é energia. A energia
 * entra por `ENERGIA_ATIVA`, e só no modo de consumo informado diretamente.
 * Só ativo entra numa estrutura nova; o inativo de uma versão antiga continua
 * listado pela própria versão.
 */
const ATIVOS_SEM_ENERGIA: RecorteDeRecursos = {
  tipos: INDUSTRIAL_RESOURCE_TYPES.filter((tipo) => tipo !== "ENERGY"),
  somenteAtivos: true,
};

/**
 * A base de produção que o servidor tem para esta estrutura.
 *
 * Rascunho primeiro, vigente depois, sugestão por último — a sugestão é do
 * sistema, não digitação de ninguém, e por isso o campo já nascer preenchido
 * com ela não é alteração pendente.
 *
 * Já no texto do campo, em português: é o que o campo recebe na carga e o que
 * a pendência compara com o que está nele.
 */
function baseDoServidor(dados: ProductIndustrialCostResponse): string {
  return toPtBrEditText(
    dados.draft?.referenceOutputQuantity ??
      dados.current?.referenceOutputQuantity ??
      dados.suggestedReferenceOutputQuantity,
    OPCOES_QUANTIDADE,
  );
}

function statusBadgeClass(status: string): string {
  if (status === "ACTIVE") return "badge badge--active";
  if (status === "INACTIVE") return "badge badge--neutral";
  return "badge badge--warn";
}

/**
 * Enquanto rascunho, a tarifa exibida é a vigente HOJE — referência que ainda
 * pode mudar. Depois de ativa, o que vale é o valor congelado na ativação.
 */
function describeRate(usage: IndustrialCostResourceUsageDTO, status: string): string {
  if (status === "DRAFT") {
    return usage.currentRate
      ? `${formatMoneyPtBr(usage.currentRate.rateValue, OPCOES_VALOR_INDUSTRIAL)} / ${INDUSTRIAL_RATE_UOM_LABELS[usage.currentRate.rateUom]} (referência atual)`
      : "Tarifa não informada";
  }
  if (!usage.rateValueSnapshot || !usage.rateUomSnapshot) return "Tarifa não informada";
  return `${formatMoneyPtBr(usage.rateValueSnapshot, OPCOES_VALOR_INDUSTRIAL)} / ${INDUSTRIAL_RATE_UOM_LABELS[usage.rateUomSnapshot]}`;
}

/**
 * Estrutura de custos industriais de um produto.
 *
 * É documento versionado, por isso página própria (não modal). Aqui se
 * declara o ESCOPO do custo — receita usada, base de produção e premissas
 * adicionais. O custo consolidado (CMV) é calculado em outra etapa: nada
 * nesta tela soma um total.
 */
/** "1 pendência" / "3 pendências" — plural sem parênteses de formulário. */
function pendencyBadgeLabel(pendencies: { severity: string }[]): string {
  const total = pendencies.filter((pendency) => pendency.severity === "BLOCKING").length;
  return total === 1 ? "1 pendência" : `${total} pendências`;
}

export function IndustrialCostPage() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [data, setData] = useState<ProductIndustrialCostResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * A ação em curso pelo nome: o freio de clique duplo continua um só
   * (`saving`), mas "Salvando…" aparece só no botão que está gravando.
   */
  const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null);
  const saving = acaoEmCurso !== null;
  /** O que a última ação confirmou — uma frase, substituída pela próxima. */
  const [feito, setFeito] = useState<{ acao: string; texto: string } | null>(null);

  const [activateConfirm, setActivateConfirm] = useState(false);
  const [newVersionConfirm, setNewVersionConfirm] = useState(false);
  const [usarTemplate, setUsarTemplate] = useState(false);

  /*
   * Qual versão está sendo lida.
   *
   * A tela abria sempre o rascunho e não oferecia caminho de volta para a
   * versão ATIVA — depois de criar uma V2, a estrutura que vale na produção
   * sumia da vista, sem link e sem histórico clicável, e quem só queria
   * conferir o custo oficial lia números de um rascunho sem perceber.
   *
   * O padrão passou a ser a versão ATIVA: é ela que vale na produção e é ela
   * que a maioria vem consultar. Editar é intenção declarada — quem vai
   * mexer no rascunho troca de aba, e criar um rascunho novo já leva para
   * ele automaticamente.
   */
  const [lendoAtiva, setLendoAtiva] = useState(true);
  const [referenceQuantity, setReferenceQuantity] = useState("");
  const [category, setCategory] = useState<IndustrialCostCategory>("SECONDARY_PACKAGING");
  const [description, setDescription] = useState("");
  const [basis, setBasis] = useState<IndustrialCostBasis>("FIXED_PER_BATCH");
  const [rateValue, setRateValue] = useState("");

  const [usageResourceId, setUsageResourceId] = useState("");
  /** Cadastro de recurso aberto a partir do campo de busca. */
  const [usageQuantity, setUsageQuantity] = useState("");
  /** Quantidade de recursos equivalentes (§87) — só mão de obra e equipamento. */
  const [usageResourceCount, setUsageResourceCount] = useState("1");
  /*
   * Linha de recurso em edição, na própria linha (COST-RESOURCE-EDIT-01): tempo
   * e quantidade de recursos, em texto de campo. Salvar atualiza a MESMA linha —
   * trocar a quantidade deixou de ser remover e declarar de novo.
   */
  const [edicaoDeUso, setEdicaoDeUso] = useState<
    { id: string; quantidade: string; recursos: string } | null
  >(null);
  /*
   * Recurso criado no contexto, à espera do tipo.
   *
   * A volta do cadastro monta a tela de novo, e o retorno chega antes da
   * estrutura e de qualquer página de recursos — a regra da energia precisa
   * dos dois. Até a conferência o criado fica escolhido, mas não vira opção.
   * `anterior` é o recurso que o rascunho trazia: é para ele que o campo volta
   * quando a energia não cabe.
   */
  const [criadoAConferir, setCriadoAConferir] = useState<{ id: string; anterior: string } | null>(null);

  /*
   * Sair para cadastrar um recurso desmonta esta tela. O rascunho que
   * importa é o da LINHA em edição — categoria, descrição, base, valor e
   * uso. `data` e os recursos oferecidos ficam de fora: vêm do servidor e
   * recarregam sozinhos, e serializá-los faria o retorno restaurar uma versão
   * da estrutura que pode ter mudado enquanto a pessoa estava fora.
   */
  const { goCreate } = useContextualCreateOrigin<Record<string, unknown>>({
    collectDraft: () => ({
      /*
       * A ABA vai junto, e não é detalhe de apresentação.
       *
       * Produto com rascunho E versão ativa abre na aba "Ativa". Quem troca
       * para "Rascunho", preenche a linha e sai para cadastrar o recurso
       * voltava na aba "Ativa" — onde os campos nem são renderizados, porque
       * versão ativa não se edita. O rascunho estava intacto por baixo, mas
       * a pessoa via o trabalho sumido, que dá no mesmo.
       */
      lendoAtiva,
      referenceQuantity,
      category,
      description,
      basis,
      rateValue,
      usageResourceId,
      usageQuantity,
      usageResourceCount,
    }),
    restoreDraft: (rascunho) => {
      const texto = (chave: string) =>
        typeof rascunho[chave] === "string" ? (rascunho[chave] as string) : "";
      // Rascunho antigo, gravado antes de a aba viajar junto: `undefined`
      // cai no padrão da tela em vez de virar `false` por coincidência.
      if (typeof rascunho["lendoAtiva"] === "boolean") setLendoAtiva(rascunho["lendoAtiva"]);
      setReferenceQuantity(texto("referenceQuantity"));
      setCategory(texto("category") as IndustrialCostCategory);
      setDescription(texto("description"));
      setBasis(texto("basis") as IndustrialCostBasis);
      setRateValue(texto("rateValue"));
      setUsageResourceId(texto("usageResourceId"));
      setUsageQuantity(texto("usageQuantity"));
      setUsageResourceCount(texto("usageResourceCount") || "1");
    },
    onCreated: (resultado, registro) => {
      /*
       * Energia fora do modo "consumo informado diretamente" não é
       * escolhível aqui — é a regra que evita contar energia duas vezes. Quem
       * decide é a conferência mais abaixo, com o recurso resolvido pelo id e
       * a estrutura já lida: neste instante nenhum dos dois chegou.
       */
      const anterior = registro.draft["usageResourceId"];
      setUsageResourceId(resultado.entityId);
      setCriadoAConferir({
        id: resultado.entityId,
        anterior: typeof anterior === "string" ? anterior : "",
      });
    },
  });

  const canEdit = user?.role === "COMMERCIAL" || user?.role === "ADMIN";
  /*
   * Recurso industrial é a exceção do cadastro no contexto: o gate existe
   * dos dois lados. A API exige ADMIN (`requireRole(request, "ADMIN")`), e
   * o botão da listagem checa o mesmo. Oferecer aqui a quem só pode editar
   * custo daria um CTA que termina em 403.
   */
  const canCreateResource = user?.role === "ADMIN";

  /*
   * A base que veio do servidor na última leitura.
   *
   * Recarregar não pode apagar o que a pessoa digitou: cada ação da tela
   * termina em `load()`, e adicionar uma premissa reescrevia o campo de base
   * com o valor gravado — a edição pendente da base sumia sem aviso porque
   * outro bloco foi salvo. Com a referência anterior em mãos dá para separar
   * "o campo ainda é o do servidor" de "a pessoa mexeu nele".
   */
  const baseLida = useRef("");

  const load = useCallback(() => {
    if (!productId) return;
    getProductIndustrialCosts(productId)
      .then((result) => {
        setData(result);
        const doServidor = baseDoServidor(result);
        /* A referência ANTERIOR é lida antes de ser trocada: o atualizador de
           estado roda depois desta função, e consultar a ref lá dentro já
           acharia o valor novo — o campo nunca receberia a carga. */
        const anterior = baseLida.current;
        baseLida.current = doServidor;
        setReferenceQuantity((atual) =>
          decimalComparavel(atual) === decimalComparavel(anterior) ? doServidor : atual,
        );
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar a estrutura de custos"),
      );
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  /*
   * O funil único da tela. A ação pode recusar antes de chamar a API — é o
   * que um valor decimal ilegível faz —, e a recusa chega aqui como
   * qualquer outra falha, sem que a requisição saia.
   */
  async function run(
    action: () => Promise<unknown>,
    retorno?: { acao: string; sucesso?: string },
  ) {
    setAcaoEmCurso(retorno?.acao ?? "acao");
    setError(null);
    setFeito(null);
    try {
      await action();
      load();
      // Só depois de a ação passar: recusa que caísse aqui deixaria a tela
      // dizendo "salva" sobre o que não foi gravado.
      if (retorno?.sucesso) setFeito({ acao: retorno.acao, texto: retorno.sucesso });
    } catch (err) {
      setError(apiErrorMessage(err, "Falha ao executar a ação"));
    } finally {
      setAcaoEmCurso(null);
    }
  }

  // A versão em edição é o rascunho; sem rascunho, mostra-se a vigente.
  const version: IndustrialCostVersionDTO | null =
    (lendoAtiva && data?.current ? data.current : (data?.draft ?? data?.current)) ?? null;
  const editable = canEdit && version?.status === "DRAFT";

  /*
   * Tarifa do kWh derivado: primeira página curta de energia ativa e busca no
   * servidor. As opções saíam dos 50 primeiros recursos ativos, que o servidor
   * ordena por tipo com energia por último — a partir de 50 recursos de mão de
   * obra e equipamento o campo não oferecia energia nenhuma, e a tarifa já
   * escolhida fora da página aparecia como "Selecione…".
   */
  const energiaDerivada = editable && version?.energyCalculationMode === "FROM_EQUIPMENT";
  // No modo de consumo informado diretamente, quem oferece energia é o campo "Recurso".
  const energiaDireta = editable && version?.energyCalculationMode === "DIRECT";
  const recursosDeEnergia = useRecursosDoSeletor(ENERGIA_ATIVA, {
    carregar: energiaDerivada || energiaDireta,
    escolhidos: energiaDerivada && version?.energyResourceId ? [version.energyResourceId] : [],
  });

  /*
   * Campo "Recurso": primeira página curta de cada tipo e busca no servidor,
   * com a energia ativa só no modo direto. As opções saíam dos 50 primeiros
   * ativos e do que a busca achava: o recurso criado no contexto, ou restaurado
   * do rascunho, fora deles voltava com o campo vazio e o id escolhido por
   * baixo — e, sem o tipo, "Quantidade de recursos" sumia e o envio ia sem ela.
   *
   * O id escolhido que não veio em página nenhuma é perguntado uma vez, depois
   * de TODAS as páginas que a tela pediu: antes disso ele podia estar na de
   * energia.
   */
  const paginaDeEnergiaPendente = (energiaDerivada || energiaDireta) && !recursosDeEnergia.respondeu;
  const recursosDoUso = useRecursosDoSeletor(ATIVOS_SEM_ENERGIA, {
    carregar: editable,
    escolhidos:
      !usageResourceId || paginaDeEnergiaPendente || recursosDeEnergia.recurso(usageResourceId)
        ? []
        : [usageResourceId],
  });
  const recursoDoUso = (id: string) => recursosDoUso.recurso(id) ?? recursosDeEnergia.recurso(id);

  /*
   * A conferência do recurso criado no contexto: com ele resolvido e a
   * estrutura lida, a mesma regra da energia de quando ele estava na lista.
   * Energia fora do modo direto não fica escolhida — o campo volta ao que o
   * rascunho trazia e a tela diz o que aconteceu, em vez de guardar um id que
   * nenhuma opção mostra.
   */
  const criado = criadoAConferir ? recursoDoUso(criadoAConferir.id) : undefined;
  useEffect(() => {
    if (!criadoAConferir) return;
    // Trocou de recurso antes da conferência: vale a escolha nova.
    if (usageResourceId !== criadoAConferir.id) {
      setCriadoAConferir(null);
      return;
    }
    if (!criado || !version || !editable) return;
    setCriadoAConferir(null);
    if (criado.type === "ENERGY" && version.energyCalculationMode !== "DIRECT") {
      setUsageResourceId(criadoAConferir.anterior);
      setError(
        `${criado.code} foi criado, mas recursos de energia só entram nesta estrutura no modo de consumo informado diretamente.`,
      );
    }
  }, [criadoAConferir, criado, usageResourceId, version, editable]);

  /*
   * Três blocos gravam separado nesta tela — base de produção, premissa nova e
   * recurso novo —, cada um com o seu botão. A guarda de saída é a SOMA do que
   * continua pendente: salvar a base não apaga a premissa meio digitada, e
   * adicionar o recurso não absolve a base alterada.
   *
   * Custo calculado, consumo de energia derivado, totais e a própria lista de
   * versões ficam de fora: são resultado do que já está gravado, não digitação
   * que se perde ao sair. Categoria e base de cálculo também não entram
   * sozinhas — nascem escolhidas e continuam escolhidas depois de gravar; sem
   * descrição nem valor não há premissa nenhuma sendo montada.
   *
   * A base tem campo antes de existir versão — é ela que "Criar estrutura de
   * custos" usa —, então não depende de rascunho editável como os outros dois.
   */
  const baseAlterada =
    data !== null &&
    canEdit &&
    (editable || data.versions.length === 0) &&
    decimalComparavel(referenceQuantity) !== decimalComparavel(baseDoServidor(data));
  const premissaEmAberto =
    Boolean(editable) &&
    (textoComparavel(description) !== null || decimalComparavel(rateValue) !== null);
  const recursoEmAberto =
    Boolean(editable) &&
    (usageResourceId !== "" ||
      decimalComparavel(usageQuantity) !== null ||
      decimalComparavel(usageResourceCount) !== "1");
  const usoEditado = edicaoDeUso
    ? version?.resourceUsages.find((usage) => usage.id === edicaoDeUso.id)
    : undefined;
  const edicaoDeUsoAlterada =
    Boolean(editable) &&
    usoEditado !== undefined &&
    edicaoDeUso !== null &&
    (decimalComparavel(edicaoDeUso.quantidade) !==
      decimalComparavel(toPtBrEditText(usoEditado.usageQuantity, OPCOES_QUANTIDADE)) ||
      decimalComparavel(edicaoDeUso.recursos) !== decimalComparavel(String(usoEditado.resourceCount)));
  const { liberarGuarda } = useUnsavedChangesGuard({
    isDirty: baseAlterada || premissaEmAberto || recursoEmAberto || edicaoDeUsoAlterada,
    substantivo: "estrutura de custos",
    genero: "a",
  });

  if (error && !data) return <p className="form-alert" role="alert">{error}</p>;
  if (!data || !productId) return <p>Carregando…</p>;

  const podeAlternar = Boolean(data.draft && data.current);

  // Primeira estrutura do produto precisa de base de produção: nunca se
  // assume 1000. Sem base informada nem sugerida, o botão fica bloqueado —
  // e agora diz por quê.
  /*
   * Estrutura de custos parte da formulação ATIVA do produto. Sem ela o
   * backend recusa com a razão certa — mas só depois de a pessoa preencher
   * a base e clicar; e a recusa cita uma tela que não é esta.
   */
  const missingActiveFormulation = data.activeFormulationVersionId === null;

  const missingProductionBase =
    data.versions.length === 0 &&
    !referenceQuantity.trim() &&
    !data.suggestedReferenceOutputQuantity;

  /* A receita ativa do produto já passou da que esta estrutura congelou. */
  const formulacaoDefasada =
    version != null &&
    data.activeFormulationVersionNumber != null &&
    data.activeFormulationVersionNumber !== version.formulationVersionNumber;

  // Energia direta só existe no modo correspondente; fora dele o recurso de
  // energia nem é oferecido, para não induzir dupla contagem.
  const usedResourceIds = new Set(version?.resourceUsages.map((usage) => usage.resourceId) ?? []);
  const cabeNaEstrutura = (resource: IndustrialResourceDTO) => !usedResourceIds.has(resource.id);
  /* O recurso escolhido, quando a tela já sabe qual é; o criado no contexto, só depois de conferido. */
  const selectedResource =
    usageResourceId && usageResourceId !== criadoAConferir?.id
      ? (recursoDoUso(usageResourceId) ?? null)
      : null;
  // Mão de obra e equipamento se contam; energia não — o kWh já é o total (§87).
  const contaRecursos = selectedResource ? acceptsResourceCount(selectedResource.type) : false;

  /** O catálogo que ainda cabe na estrutura e, se saiu dele, o recurso já escolhido. */
  const opcoesDeRecurso = (): EntityOption[] => {
    const lista = [
      ...recursosDoUso.catalogo,
      ...(energiaDireta ? recursosDeEnergia.catalogo : []),
    ].filter(cabeNaEstrutura);
    if (selectedResource && !lista.some((resource) => resource.id === selectedResource.id)) {
      lista.push(selectedResource);
    }
    return lista.map((resource) => opcaoDeRecurso(resource, { comTipo: true }));
  };
  // Achar não é poder usar: a busca tem o recorte da primeira página e a mesma exclusão.
  const buscarRecursos = async (termo: string): Promise<EntityOption[]> => {
    const [semEnergia, energia] = await Promise.all([
      recursosDoUso.buscar(termo),
      energiaDireta ? recursosDeEnergia.buscar(termo) : Promise.resolve([]),
    ]);
    return [...semEnergia, ...energia]
      .filter(cabeNaEstrutura)
      .map((resource) => opcaoDeRecurso(resource, { comTipo: true }));
  };

  /** Energia ativa do catálogo e, se saiu dele, a tarifa que a versão já usa. */
  const opcoesDeEnergia = (escolhida: string | null): EntityOption[] => {
    const opcoes = recursosDeEnergia.catalogo.map((recurso) => opcaoDeRecurso(recurso, { comTipo: false }));
    const atual = escolhida ? recursosDeEnergia.recurso(escolhida) : undefined;
    if (atual && !opcoes.some((opcao) => opcao.id === atual.id)) {
      opcoes.push(opcaoDeRecurso(atual, { comTipo: false }));
    }
    return opcoes;
  };
  const buscarEnergia = async (termo: string) =>
    (await recursosDeEnergia.buscar(termo)).map((recurso) => opcaoDeRecurso(recurso, { comTipo: false }));

  return (
    <>
      <div className="doc-header">
        <div>
          <PageBreadcrumbs items={[{ label: "Produtos Acabados", href: "/cadastros/produtos" }, { label: "Custos industriais" }]} />
          <div className="doc-title">
            <h1>
              <EntityLink kind="product" id={productId} code={data.productCode} /> ·{" "}
              {data.productName}
            </h1>
            {version && (
              <>
                <span className="code">{version.label}</span>
                <span className={statusBadgeClass(version.status)}>
                  {INDUSTRIAL_COST_VERSION_STATUS_LABELS[version.status]}
                </span>
                {/* O rótulo sozinho não dizia quanto falta nem onde olhar; o
                    número já separa "quase pronta" de "mal começada". */}
                <span className={version.complete ? "badge badge--active" : "badge badge--warn"}>
                  {version.complete ? "Completa" : pendencyBadgeLabel(version.pendencies)}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="table__actions">
          <ProjectOriginLink productId={productId} />
          {/* Produto sem lote mínimo cadastrado não tem base sugerida; sem
              este campo o botão só devolvia "Informe a base de produção" e o
              usuário não tinha onde informá-la. Continua valendo a regra de
              nunca assumir 1000. */}
          {canEdit && data.versions.length === 0 && (
            <div className="field">
              <label htmlFor="new-reference-output">
                Base de produção ({data.referenceOutputUomCode}){" "}
                <span aria-hidden="true">*</span>
                <span className="sr-only">(obrigatório)</span>
              </label>
              <DecimalField
                id="new-reference-output"
                scale={CASAS_QUANTIDADE}
                required
                aria-describedby="new-reference-output-hint"
                placeholder={
                  data.suggestedReferenceOutputQuantity
                    ? toPtBrEditText(data.suggestedReferenceOutputQuantity, OPCOES_QUANTIDADE)
                    : "ex.: 1000"
                }
                value={referenceQuantity}
                onChangeValue={setReferenceQuantity}
              />
              <p id="new-reference-output-hint" className="field__hint">
                Usada por “Criar estrutura de custos”. Ao usar um modelo, a base vem do próprio
                modelo e este campo é ignorado.
              </p>
            </div>
          )}
          {canEdit && (
            <button
              type="button"
              // Sem estrutura, criar a estrutura É a tela: o cabeçalho tinha
              // quatro botões de mesmo peso e nenhuma ação principal.
              className={
                data.versions.length === 0 ? "btn btn--accent" : "btn btn--secondary"
              }
              // Botão cinza sem explicação virava beco sem saída: o motivo
              // acompanha o controle, para leitor de tela e para quem vê.
              {...(missingProductionBase
                ? {
                    "aria-describedby": "create-cost-version-reason",
                    title: "Informe a base de produção para criar a estrutura.",
                  }
                : {})}
              disabled={saving || missingProductionBase || missingActiveFormulation}
              onClick={() => {
                // Criar versão grava documento com código, autor e data. Sem
                // confirmação, quem só queria olhar saía com uma V2 no banco.
                if (data.versions.length === 0) {
                  void run(() => {
                    const base = exigirDecimalOpcional(
                      referenceQuantity,
                      "Base de produção",
                      OPCOES_QUANTIDADE,
                    );
                    return createIndustrialCostVersion(
                      productId,
                      base ? { referenceOutputQuantity: base } : {},
                    );
                  });
                  return;
                }
                setNewVersionConfirm(true);
              }}
            >
              {data.versions.length === 0 ? "Criar estrutura de custos" : "Nova versão"}
            </button>
          )}
          {/* Partir de um template é alternativa a montar do zero, não ação
              principal: quem já tem estrutura raramente troca a base inteira. */}
          {canEdit && !missingActiveFormulation && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={saving}
              onClick={() => setUsarTemplate(true)}
            >
              Usar modelo
            </button>
          )}
          {canEdit && missingProductionBase && !missingActiveFormulation && (
            <p id="create-cost-version-reason" className="field__hint">
              Informe a base de produção para criar a estrutura.
            </p>
          )}

          {canEdit && missingActiveFormulation && (
            <p className="form-alert" role="status">
              Este produto ainda não tem formulação ativa, e a estrutura de custos parte dela.{" "}
              <Link
                className="btn btn--ghost btn--sm"
                to={`/producao/formulacoes/${data.productId}`}
              >
                Abrir formulação
              </Link>
            </p>
          )}
          {version && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => navigate(`/print/estrutura-custos/${version.id}`)}
            >
              PDF
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate("/cadastros/produtos")}
          >
            ← Voltar
          </button>
        </div>
      </div>

      <div className="doc-body">
      <ProductRelatedLinks productId={productId} current="costs" />

        {/* Duas versões coexistindo: a que vale na produção e a que está sendo
            escrita. Sem este seletor, criar um rascunho escondia a ativa. */}
        {podeAlternar && (
          <div className="toolbar__scope">
            <button
              type="button"
              className={!lendoAtiva ? "btn btn--secondary btn--sm" : "btn btn--ghost btn--sm"}
              onClick={() => setLendoAtiva(false)}
            >
              Rascunho {data.draft?.label}
            </button>
            <button
              type="button"
              className={lendoAtiva ? "btn btn--secondary btn--sm" : "btn btn--ghost btn--sm"}
              onClick={() => setLendoAtiva(true)}
            >
              Ativa {data.current?.label}
            </button>
          </div>
        )}
        {error && <p className="form-alert" role="alert">{error}</p>}

        {/* Materiais, recursos, energia e premissas são preenchidos aqui e só
            viram número na tela de CMV. Mesmo painel das duas telas: é um
            processo só, lido de pontos diferentes. */}
        <ContextHelp topic={helpTopics["estruturaCusto.comoFunciona"]} />

        {!version && (
          <FormSection title="Estrutura de custos">
            <p className="field__hint">
              Este produto ainda não tem estrutura de custos. A estrutura declara qual receita, qual
              base de produção e quais custos adicionais existem — o custo consolidado é calculado
              depois.
            </p>
          </FormSection>
        )}

        {version && (
          <>
            <FormSection
              title="Resumo"
              subtitle="Premissas da estrutura. Nenhum total é calculado aqui — isso é etapa do custo industrial consolidado."
            >
              <dl className="definition-list">
                <dt>Cliente</dt>
                <dd>{version.customerName ?? "—"}</dd>
                <dt>Formulação utilizada</dt>
                <dd>
                  V{version.formulationVersionNumber} ({version.formulationStatus === "ACTIVE"
                    ? "ativa"
                    : version.formulationStatus === "DRAFT"
                      ? "rascunho"
                      : "histórica"}
                  )
                </dd>
                <dt>Formulação ativa do produto</dt>
                <dd>
                  {version.activeFormulationVersionNumber
                    ? `V${version.activeFormulationVersionNumber}`
                    : "—"}
                </dd>
                <dt>Base de referência</dt>
                <dd>
                  {formatQuantity(version.referenceOutputQuantity)} {version.referenceOutputUomCode}
                </dd>
                <dt>Unidades por caixa</dt>
                <dd>{version.unitsPerShippingBox ?? "—"}</dd>
                <dt>Criada</dt>
                <dd>
                  {formatDateTime(version.createdAt)} — {version.createdByName ?? "—"}
                </dd>
                <dt>Ativada</dt>
                <dd>
                  {formatDateTime(version.activatedAt)}
                  {version.activatedByName ? ` — ${version.activatedByName}` : ""}
                </dd>
              </dl>

              <IndustrialCostPendencies
                pendencies={version.pendencies}
                productId={data.productId}
                onStructurePage
              />

              <CostTemplateOrigin
                version={version}
                productId={productId}
                canEdit={canEdit}
                onChanged={load}
              />

              {editable && (
                <>
                  <div className="field-grid-2">
                    <div className="field">
                      <label htmlFor="reference-output">
                        Base de produção ({version.referenceOutputUomCode})
                      </label>
                      <DecimalField
                        id="reference-output"
                        scale={CASAS_QUANTIDADE}
                        value={referenceQuantity}
                        onChangeValue={setReferenceQuantity}
                      />
                      <span className="field__hint">
                        Quantidade de produto acabado usada para estruturar o custo.
                      </span>
                    </div>
                  </div>
                  {/* A base, perto do campo que ela grava; a estrutura inteira
                      na outra ponta, com a ativação por último. */}
                  <div className="form-actions form-actions--split">
                    <div className="form-actions__group">
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        // Sem alteração pendente não há o que gravar.
                        disabled={saving || !referenceQuantity.trim() || !baseAlterada}
                        onClick={() =>
                          void run(
                            () =>
                              updateIndustrialCostVersion(version.id, {
                                referenceOutputQuantity: exigirDecimal(
                                  referenceQuantity,
                                  "Base de produção",
                                  OPCOES_QUANTIDADE,
                                ),
                              }),
                            { acao: "base", sucesso: "Base salva." },
                          )
                        }
                      >
                        {acaoEmCurso === "base" ? "Salvando…" : "Salvar base"}
                      </button>
                      {/* Pendência antes de confirmação — a mesma que a guarda
                          de saída já soma, não uma conta paralela. */}
                      {baseAlterada ? (
                        <span className="form-status form-status--dirty" role="status">
                          Alterações não salvas
                        </span>
                      ) : (
                        feito?.acao === "base" && (
                          <span className="form-status" role="status">
                            {feito.texto}
                          </span>
                        )
                      )}
                    </div>
                    <div className="form-actions__group">
                      {/* Rascunho SEGUE a receita ativa por padrão. Só fica para
                          trás quando o usuário escolheu outra versão de
                          propósito — e aí o caminho de volta precisa existir,
                          senão a fixação vira armadilha. */}
                      {version.formulationPinned && data.activeFormulationVersionId && (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={saving}
                          title="Volta a acompanhar a formulação ativa do produto. As premissas e recursos informados aqui não são apagados."
                          onClick={() =>
                            void run(() =>
                              updateIndustrialCostVersion(version.id, {
                                formulationVersionId: data.activeFormulationVersionId!,
                              }),
                            )
                          }
                        >
                          Voltar a seguir a formulação ativa V
                          {data.activeFormulationVersionNumber}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--accent btn--sm"
                        disabled={saving}
                        onClick={() => {
                          if (!version.complete) {
                            setActivateConfirm(true);
                            return;
                          }
                          void run(
                            () =>
                              activateIndustrialCostVersion(version.id, {
                                confirmIncomplete: false,
                              }),
                            { acao: "ativar" },
                          );
                        }}
                      >
                        {acaoEmCurso === "ativar" ? "Ativando…" : "Ativar estrutura"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </FormSection>

            <FormSection
              title="Matérias-primas e embalagens da formulação"
              subtitle="Vêm da formulação vinculada e não são redigitadas aqui. O custo de cada material é calculado na etapa de custo industrial."
            >
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="is-numeric">Quantidade</th>
                      <th>Un.</th>
                      <th>Base</th>
                      <th>Pureza</th>
                      <th>Overage</th>
                      <th>Fornecimento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {version.materials.map((material) => (
                      <tr key={material.itemId}>
                        <td>
                          <EntityLink kind="item" id={material.itemId} code={material.itemCode} name={material.itemName} />
                        </td>
                        <td className="is-numeric">{formatQuantity(material.quantity)}</td>
                        <td>{material.unitCode}</td>
                        {/* A base do componente é enum no banco; na tela é
                            frase em português, como no editor de formulação. */}
                        <td>
                          {FORMULATION_COMPONENT_BASIS_LABELS[
                            material.basis as keyof typeof FORMULATION_COMPONENT_BASIS_LABELS
                          ] ?? material.basis}
                        </td>
                        <td>{formatPercentPtBr(material.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO)}</td>
                        <td>{formatPercentPtBr(material.overagePercent, OPCOES_PERCENTUAL_TECNICO)}</td>
                        <td>
                          {material.customerSupplied ? (
                            // Pertence à estrutura física, não ao custo Veridi.
                            <span className="badge badge--warn">Fornecido pelo cliente</span>
                          ) : (
                            "Veridi"
                          )}
                        </td>
                      </tr>
                    ))}
                    {version.materials.length === 0 && (
                      <TableEmptyRow colSpan={7}>
                        A formulação vinculada não tem componentes.
                      </TableEmptyRow>
                    )}
                  </tbody>
                </table>
              </div>
            </FormSection>

            <FormSection
              id="secao-premissas"
              title="Premissas de custo adicionais"
              subtitle={`Custos que não estão na formulação. Percentual usa o custo industrial direto: ${DIRECT_INDUSTRIAL_COST_DEFINITION}`}
            >
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th>Descrição</th>
                      <th>Base de cálculo</th>
                      <th className="is-numeric">Valor</th>
                      {editable && <th aria-hidden="true" />}
                    </tr>
                  </thead>
                  <tbody>
                    {version.lines.map((line) => (
                      <tr key={line.id}>
                        <td>{INDUSTRIAL_COST_CATEGORY_LABELS[line.category]}</td>
                        <td>{line.description}</td>
                        <td>{INDUSTRIAL_COST_BASIS_LABELS[line.calculationBasis]}</td>
                        <td className="is-numeric">
                          {/* Não informado nunca vira zero. */}
                          {line.rateValue === null
                            ? "—"
                            : line.calculationBasis === "PERCENT_OF_DIRECT_INDUSTRIAL_COST"
                              ? formatPercentPtBr(line.rateValue, OPCOES_VALOR_INDUSTRIAL)
                              : formatMoneyPtBr(line.rateValue, OPCOES_VALOR_INDUSTRIAL)}
                        </td>
                        {editable && (
                          <td onClick={(event) => event.stopPropagation()}>
                            <RowActions
                              label={`Mais ações de ${line.description}`}
                              actions={[
                                {
                                  label: "Remover premissa",
                                  destructive: true,
                                  onSelect: () =>
                                    void run(() => deleteIndustrialCostLine(line.id)),
                                },
                              ]}
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                    {version.lines.length === 0 && (
                      <TableEmptyRow colSpan={editable ? 5 : 4}>
                        Nenhuma premissa adicional registrada.
                      </TableEmptyRow>
                    )}
                  </tbody>
                </table>
              </div>

              {editable && (
                <>
                  <div className="field-grid-2">
                    <div className="field">
                      <label htmlFor="cost-category">Categoria</label>
                      <select
                        id="cost-category"
                        value={category}
                        onChange={(event) =>
                          setCategory(event.target.value as IndustrialCostCategory)
                        }
                      >
                        {INDUSTRIAL_COST_CATEGORIES.map((option) => (
                          <option key={option} value={option}>
                            {INDUSTRIAL_COST_CATEGORY_LABELS[option]}
                          </option>
                        ))}
                      </select>
                      <span className="field__hint">
                        Mão de obra, equipamentos e energia entram com os recursos industriais.
                      </span>
                    </div>

                    <div className="field">
                      <label htmlFor="cost-description">Descrição</label>
                      <input
                        id="cost-description"
                        type="text"
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="Ex.: caixa de expedição"
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="cost-basis">Base de cálculo</label>
                      <select
                        id="cost-basis"
                        value={basis}
                        onChange={(event) => setBasis(event.target.value as IndustrialCostBasis)}
                      >
                        {INDUSTRIAL_COST_BASES.map((option) => (
                          <option key={option} value={option}>
                            {INDUSTRIAL_COST_BASIS_LABELS[option]}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="field">
                      <label htmlFor="cost-rate">Valor</label>
                      {/* Percentual em pontos (10 = 10%), sem conversão; os outros modos são R$. */}
                      {basis === "PERCENT_OF_DIRECT_INDUSTRIAL_COST" ? (
                        <PercentField
                          id="cost-rate"
                          scale={CASAS_VALOR_INDUSTRIAL}
                          value={rateValue}
                          onChangeValue={setRateValue}
                          placeholder="Deixe vazio se ainda não souber"
                        />
                      ) : (
                        <MoneyField
                          id="cost-rate"
                          scale={CASAS_VALOR_INDUSTRIAL}
                          value={rateValue}
                          onChangeValue={setRateValue}
                          placeholder="Deixe vazio se ainda não souber"
                        />
                      )}
                      <span className="field__hint">
                        Percentual é informado como número (10 = 10%). Vazio significa não
                        informado — nunca zero.
                      </span>
                    </div>
                  </div>

                  <div className="line-actions">
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      disabled={saving || !description.trim()}
                      onClick={() =>
                        void run(async () => {
                          // Vazio segue sendo "não informado" — nunca zero.
                          const valor = exigirDecimalOpcional(
                            rateValue,
                            "Valor",
                            OPCOES_VALOR_INDUSTRIAL,
                          );
                          await createIndustrialCostLine(version.id, {
                            category,
                            description: description.trim(),
                            calculationBasis: basis,
                            ...(valor ? { rateValue: valor } : {}),
                          });
                          setDescription("");
                          setRateValue("");
                        })
                      }
                    >
                      Adicionar premissa
                    </button>
                  </div>
                </>
              )}
            </FormSection>

            <FormSection
              id="secao-recursos"
              title="Recursos industriais"
              subtitle="Quanto de mão de obra, equipamento e energia esta base de produção consome. Nenhum valor é multiplicado aqui — o custo consolidado é etapa seguinte."
            >
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Recurso</th>
                      <th>Tipo</th>
                      <th>Consumo</th>
                      <th>Base</th>
                      <th>
                        {version.status === "DRAFT" ? "Tarifa de referência" : "Tarifa congelada"}
                      </th>
                      <th>Energia derivada</th>
                      {editable && <th aria-hidden="true" />}
                    </tr>
                  </thead>
                  <tbody>
                    {version.resourceUsages.map((usage) => (
                      <tr key={usage.id}>
                        <td>
                          {/* Nome congelado explica o documento antigo mesmo se o
                              cadastro for renomeado depois. */}
                          <EntityLink
                            kind="industrialResource"
                            id={usage.resourceId}
                            code={usage.resourceCode}
                            name={usage.resourceNameSnapshot ?? usage.resourceName}
                          />
                          {!usage.resourceActive && (
                            <span className="badge badge--warn"> Recurso inativo</span>
                          )}
                        </td>
                        <td>{INDUSTRIAL_RESOURCE_TYPE_LABELS[usage.resourceType]}</td>
                        <td>
                          {editable && edicaoDeUso?.id === usage.id ? (
                            <div>
                              <ResourceCountField
                                id={`uso-${usage.id}-recursos`}
                                label={`Quantidade de recursos de ${usage.resourceCode}`}
                                resourceType={usage.resourceType}
                                value={edicaoDeUso.recursos}
                                onChange={(recursos) =>
                                  setEdicaoDeUso((atual) => (atual ? { ...atual, recursos } : atual))
                                }
                                disabled={saving}
                              />
                              <div className="field">
                                <label htmlFor={`uso-${usage.id}-quantidade`}>
                                  {acceptsResourceCount(usage.resourceType)
                                    ? `Tempo por recurso de ${usage.resourceCode}`
                                    : `Consumo de ${usage.resourceCode}`}{" "}
                                  ({INDUSTRIAL_RATE_UOM_LABELS[usage.usageUom]})
                                </label>
                                <DecimalField
                                  id={`uso-${usage.id}-quantidade`}
                                  scale={CASAS_QUANTIDADE}
                                  value={edicaoDeUso.quantidade}
                                  disabled={saving}
                                  onChangeValue={(quantidade) =>
                                    setEdicaoDeUso((atual) => (atual ? { ...atual, quantidade } : atual))
                                  }
                                />
                              </div>
                              <div className="form-actions">
                                <button
                                  type="button"
                                  className="btn btn--secondary btn--sm"
                                  disabled={saving}
                                  onClick={() => {
                                    const edicao = edicaoDeUso;
                                    // Nada mudou: fechar não é gravar.
                                    if (!edicao || !edicaoDeUsoAlterada) {
                                      setEdicaoDeUso(null);
                                      return;
                                    }
                                    void run(async () => {
                                      await updateResourceUsage(usage.id, {
                                        usageQuantity: exigirDecimal(
                                          edicao.quantidade,
                                          acceptsResourceCount(usage.resourceType)
                                            ? "Tempo por recurso"
                                            : "Consumo por lote de referência",
                                          OPCOES_QUANTIDADE,
                                        ),
                                        // Energia não envia quantidade: para ela o domínio usa 1 (§87).
                                        ...(acceptsResourceCount(usage.resourceType)
                                          ? { resourceCount: exigirQuantidadeDeRecursos(edicao.recursos) }
                                          : {}),
                                      });
                                      setEdicaoDeUso(null);
                                    });
                                  }}
                                >
                                  Salvar recurso
                                </button>
                                <button
                                  type="button"
                                  className="btn btn--ghost btn--sm"
                                  disabled={saving}
                                  onClick={() => setEdicaoDeUso(null)}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <ResourceUsageAmount
                              resourceCount={usage.resourceCount}
                              usageQuantity={usage.usageQuantity}
                              totalUsageQuantity={usage.totalUsageQuantity}
                              usageUom={usage.usageUom}
                            />
                          )}
                        </td>
                        <td>{INDUSTRIAL_USAGE_BASIS_LABELS[usage.usageBasis]}</td>
                        <td>{describeRate(usage, version.status)}</td>
                        <td>
                          {/* Sem potência conhecida a energia fica em aberto, nunca zero. */}
                          {usage.derivedEnergyKwh ? `${usage.derivedEnergyKwh} kWh` : "—"}
                        </td>
                        {editable && (
                          <td onClick={(event) => event.stopPropagation()}>
                            <RowActions
                              label={`Mais ações de ${usage.resourceCode}`}
                              actions={[
                                {
                                  label: "Editar recurso",
                                  onSelect: () =>
                                    setEdicaoDeUso({
                                      id: usage.id,
                                      quantidade: toPtBrEditText(usage.usageQuantity, OPCOES_QUANTIDADE),
                                      recursos: String(usage.resourceCount),
                                    }),
                                },
                                {
                                  label: "Remover recurso",
                                  destructive: true,
                                  onSelect: () => void run(() => deleteResourceUsage(usage.id)),
                                },
                              ]}
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                    {version.resourceUsages.length === 0 && (
                      <TableEmptyRow colSpan={editable ? 7 : 6}>
                        Nenhum recurso declarado nesta estrutura.
                      </TableEmptyRow>
                    )}
                  </tbody>
                </table>
              </div>

              {editable && (
                <>
                  <div className="field-grid-2">
                    <div className={contaRecursos ? "field field--full" : "field"}>
                      <label htmlFor="usage-resource">Recurso</label>
                      <SearchableEntitySelect
                        id="usage-resource"
                        value={usageResourceId}
                        onChange={(selectedId) => setUsageResourceId(selectedId)}
                        placeholder="Digite código ou nome do recurso…"
                        onSearch={buscarRecursos}
                        options={opcoesDeRecurso()}
                        canCreate={canCreateResource}
                        createLabel="Novo recurso"
                        /* Sair para cadastrar o recurso NÃO é descartar: o
                           rascunho vai junto e volta aplicado no campo. */
                        onCreateNew={() =>
                          liberarGuarda(() =>
                            goCreate({
                              route: "/gestao/recursos-industriais/novo",
                              fieldKey: "usageResourceId",
                              entityType: "industrialResource",
                            }),
                          )
                        }
                      />
                      <span className="field__hint">
                        {version.energyCalculationMode === "DIRECT"
                          ? "Energia entra como consumo informado diretamente."
                          : "Recursos de energia só aparecem no modo de consumo informado diretamente."}
                      </span>
                    </div>

                    <ResourceCountField
                      id="usage-resource-count"
                      resourceType={selectedResource?.type}
                      value={usageResourceCount}
                      onChange={setUsageResourceCount}
                      disabled={saving}
                    />

                    <div className="field">
                      <label htmlFor="usage-quantity">
                        {contaRecursos
                          ? "Tempo por recurso, por lote de referência"
                          : "Consumo por lote de referência"}
                        {selectedResource
                          ? ` (${INDUSTRIAL_RATE_UOM_LABELS[selectedResource.defaultUsageUom]})`
                          : ""}
                      </label>
                      <DecimalField
                        id="usage-quantity"
                        scale={CASAS_QUANTIDADE}
                        value={usageQuantity}
                        onChangeValue={setUsageQuantity}
                      />
                      <span className="field__hint">
                        {contaRecursos
                          ? "O tempo de CADA um. O uso total é a quantidade de recursos × este tempo."
                          : "Recurso que não é usado simplesmente não entra na estrutura."}
                      </span>
                    </div>
                  </div>

                  <div className="line-actions">
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      // Recurso ainda sem tipo conhecido: a quantidade de recursos
                      // ficaria fora do envio e o servidor gravaria 1 (§87).
                      disabled={saving || !usageResourceId || !usageQuantity.trim() || !selectedResource}
                      onClick={() =>
                        void run(async () => {
                          await createResourceUsage(version.id, {
                            resourceId: usageResourceId,
                            usageQuantity: exigirDecimal(
                              usageQuantity,
                              contaRecursos ? "Tempo por recurso" : "Consumo por lote de referência",
                              OPCOES_QUANTIDADE,
                            ),
                            // Energia não envia quantidade: para ela o domínio usa 1 (§87).
                            ...(contaRecursos
                              ? { resourceCount: exigirQuantidadeDeRecursos(usageResourceCount) }
                              : {}),
                          });
                          setUsageResourceId("");
                          setUsageQuantity("");
                          setUsageResourceCount("1");
                        })
                      }
                    >
                      Adicionar recurso
                    </button>
                  </div>
                </>
              )}
            </FormSection>

            <FormSection
              id="secao-energia"
              title="Energia"
              subtitle="Consumo informado diretamente e consumo derivado dos equipamentos são exclusivos: somar os dois contaria a mesma energia duas vezes."
            >
              <dl className="definition-list">
                <dt>Modo de cálculo</dt>
                <dd>{ENERGY_CALCULATION_MODE_LABELS[version.energyCalculationMode]}</dd>
                <dt>Consumo derivado dos equipamentos</dt>
                <dd>
                  {version.energyCalculationMode !== "FROM_EQUIPMENT"
                    ? "—"
                    : version.derivedEnergyKwh
                      ? `${version.derivedEnergyKwh} kWh por lote de referência`
                      : "Em aberto — há equipamento sem potência informada"}
                </dd>
              </dl>

              {version.energyCalculationMode === "NONE" && (
                <p className="field__hint">
                  Energia ainda não estruturada. Isso não significa consumo zero.
                </p>
              )}

              {editable && (
                <div className="field-grid-2">
                  <div className="field">
                    <label htmlFor="energy-mode">Como a energia é apurada</label>
                    <select
                      id="energy-mode"
                      value={version.energyCalculationMode}
                      disabled={saving}
                      onChange={(event) =>
                        void run(() =>
                          updateEnergyMode(version.id, {
                            energyCalculationMode: event.target.value as EnergyCalculationMode,
                          }),
                        )
                      }
                    >
                      {ENERGY_CALCULATION_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {ENERGY_CALCULATION_MODE_LABELS[mode]}
                        </option>
                      ))}
                    </select>
                    <span className="field__hint">
                      Derivada usa horas de equipamento × potência declarada no recurso.
                    </span>
                  </div>

                  {version.energyCalculationMode === "FROM_EQUIPMENT" && (
                    <div className="field">
                      <label htmlFor="energy-resource">Tarifa que valoriza o kWh derivado</label>
                      <SearchableEntitySelect
                        id="energy-resource"
                        value={version.energyResourceId ?? ""}
                        disabled={saving}
                        onChange={(energyResourceId) => {
                          // Reescolher a tarifa que já vale não é alteração: nada a gravar.
                          if (energyResourceId === (version.energyResourceId ?? "")) return;
                          void run(() =>
                            updateEnergyMode(version.id, {
                              energyCalculationMode: version.energyCalculationMode,
                              energyResourceId: energyResourceId || null,
                            }),
                          );
                        }}
                        placeholder="Digite código ou nome da energia…"
                        options={opcoesDeEnergia(version.energyResourceId)}
                        onSearch={buscarEnergia}
                      />
                      <span className="field__hint">
                        Sem escolha explícita o kWh derivado não vira dinheiro: o sistema não elege
                        um recurso de energia sozinho.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </FormSection>
          </>
        )}

        {version && (
          <CostCalculationSection
            productId={productId}
            versionId={version.id}
            canSave={canEdit}
          />
        )}

        <FormSection title="Versões">
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Versão</th>
                  <th>Situação</th>
                  <th>Formulação</th>
                  <th>Base</th>
                  <th>Completude</th>
                  <th>Ativada em</th>
                </tr>
              </thead>
              <tbody>
                {data.versions.map((row) => (
                  <tr key={row.id}>
                    <td className="is-code">{row.label}</td>
                    <td>
                      <span className={statusBadgeClass(row.status)}>
                        {INDUSTRIAL_COST_VERSION_STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td>V{row.formulationVersionNumber}</td>
                    <td>
                      {formatQuantity(row.referenceOutputQuantity)} {row.referenceOutputUomCode}
                    </td>
                    <td>{row.complete ? "Completa" : "Com pendências"}</td>
                    <td>{formatDateTime(row.activatedAt)}</td>
                  </tr>
                ))}
                {data.versions.length === 0 && (
                  <TableEmptyRow colSpan={6}>
                    Nenhuma versão criada.
                  </TableEmptyRow>
                )}
              </tbody>
            </table>
          </div>
        </FormSection>
      </div>

        <ConfirmDialog
          open={newVersionConfirm}
          title="Criar uma nova versão da estrutura de custos?"
          confirmLabel="Criar versão"
          cancelLabel="Voltar"
          confirmTone="accent"
          message={
            <>
              <p>
                A nova versão nasce como <strong>rascunho</strong>, com código e autoria próprios,
                e passa a ser o que esta tela abre por padrão.
              </p>
              <p>
                A estrutura ativa continua valendo na produção e segue acessível pelo seletor de
                versões.
              </p>
              {formulacaoDefasada && (
                <p>
                  A nova versão nasce sobre a formulação ativa{" "}
                  <strong>V{data.activeFormulationVersionNumber}</strong> — esta usa a{" "}
                  <strong>V{version.formulationVersionNumber}</strong>.
                </p>
              )}
            </>
          }
          onCancel={() => setNewVersionConfirm(false)}
          onConfirm={() => {
            setNewVersionConfirm(false);
            setLendoAtiva(false);
            void run(() => {
              // Lida antes da requisição, como em "Criar estrutura de custos".
              const base = exigirDecimalOpcional(referenceQuantity, "Base de produção", OPCOES_QUANTIDADE);
              return createIndustrialCostVersion(
                productId,
                base ? { referenceOutputQuantity: base } : {},
              );
            });
          }}
        />

      {usarTemplate && (
        <UseCostTemplateDialog
          saving={saving}
          onCancel={() => setUsarTemplate(false)}
          onApply={(costTemplateVersionId) => {
            setUsarTemplate(false);
            setLendoAtiva(false);
            void run(() => applyCostTemplateToProduct(productId, costTemplateVersionId));
          }}
        />
      )}

      {version && (
        <ConfirmDialog
          open={activateConfirm}
          title="Ativar estrutura com pendências?"
          /* O rótulo repete a consequência. "Ativar" sozinho, num diálogo que
             a pessoa pode ter aberto sem ler, não distingue esta ativação da
             ativação normal — e as duas produzem custos muito diferentes. */
          confirmLabel="Ativar mesmo com pendências"
          confirmTone="accent"
          message={
            <>
              <p>
                Esta estrutura possui premissas de custo ainda não informadas. Ativar assim torna
                ela a base de custo vigente do produto, com as pendências que existem hoje.
              </p>
              <ul className="confirm-dialog__list">
                <li>
                  Estrutura: <span className="code">{version.label}</span>
                </li>
                <li>
                  Produto: <span className="code">{data.productCode}</span> {data.productName}
                </li>
              </ul>
              {/* Confirmar "com pendências" sem ver quais é decidir no escuro. */}
              <ul className="confirm-dialog__list">
                {version.pendencies
                  .filter((pendency) => pendency.severity === "BLOCKING")
                  .map((pendency, index) => (
                    <li key={`${pendency.code}-${index}`}>{pendency.description}</li>
                  ))}
              </ul>
            </>
          }
          onCancel={() => setActivateConfirm(false)}
          onConfirm={() => {
            setActivateConfirm(false);
            void run(
              () => activateIndustrialCostVersion(version.id, { confirmIncomplete: true }),
              { acao: "ativar" },
            );
          }}
        />
      )}

    </>
  );
}
