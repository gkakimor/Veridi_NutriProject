import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  FormulationTemplateComponentDTO,
  FormulationTemplateDTO,
  FormulationTemplateDiffDTO,
  FormulationTemplateVersionDTO,
  SecaoDaFormula,
  SupplyResponsibility,
  UnitOfMeasureDTO,
  UpdateFormulationTemplateVersionInput,
} from "@veridi/shared";
import {
  FORMAS_DA_BANCADA,
  FORMULATION_CALCULATION_MODE_LABELS,
  FORMULATION_COMPONENT_BASIS_LABELS,
  FORMULATION_TEMPLATE_VERSION_STATUS_LABELS,
  PRESENTATION_TYPES,
  apresentacoesDaForma,
  capsulasPorEmbalagem,
  dosesPorEmbalagemDaApresentacao,
  formaDerivaDoses,
  receitaPorDose,
  rendimentoEsperado,
  resumirDoses,
  secaoDoItem,
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
import { getItem } from "../../lib/items-api";
import { listUnits } from "../../lib/units-api";
import { unidadesDaDimensao } from "../../lib/uom-options";
import { useContextualCreateOrigin } from "../../lib/use-contextual-create";
import { FormSection } from "../../components/FormSection";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { CalcHint } from "../../components/help/CalcHint";
import { TemplateDiff } from "./TemplateDiff";
import { formatDateTime } from "../../lib/dates";
import { ApiValidationError, apiErrorMessage } from "../../lib/api-errors";
import { decimalLegivel, exigirDecimal, exigirDecimalOpcional } from "../../lib/decimal-field";
import { lerInteiroOpcional } from "../../lib/integer-input";
import { toPtBrEditText, formatIntegerPtBr } from "../../lib/numeric-ptbr";
import {
  CASAS_QUANTIDADE,
  OPCOES_PERCENTUAL_TECNICO,
  OPCOES_QUANTIDADE,
} from "../../lib/numeric-scales";
import { DecimalField } from "../../components/NumericField";
import {
  assinaturaDoDocumento,
  decimalComparavel,
  textoComparavel,
} from "../../lib/dirty-fields";
import { formatQuantity } from "../../lib/quantity";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
import { useAuth } from "../../app/AuthProvider";
import { ContextHelp } from "../../components/help";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { helpTopics } from "../../help/help-content";
/*
  A BANCADA É A MESMA DA FORMULAÇÃO (FORMULATION-TEMPLATE-WORKBENCH-01, fatia 2).

  Esta tela deixou de ter tabela própria. A grade da receita, as premissas da
  forma, as premissas de produção, o resumo técnico, a prévia do cálculo e o
  catálogo de itens vêm de `formulation-workbench` — os MESMOS componentes que a
  Formulação de produto usa. O que continua daqui é o DOCUMENTO: nome, descrição,
  arquivamento, ciclo de vida das versões, histórico e comparação.
*/
import { Dica } from "../formulation-workbench/dicas";
import { PremissasDaForma } from "../formulation-workbench/PremissasDaForma";
import type { PremissasDaFormaValores } from "../formulation-workbench/PremissasDaForma";
import { PremissasDeProducao } from "../formulation-workbench/PremissasDeProducao";
import { ResumoDaReceita } from "../formulation-workbench/ResumoDaReceita";
import { StickyActionBar } from "../formulation-workbench/StickyActionBar";
import { TabelaDaReceita } from "../formulation-workbench/TabelaDaReceita";
import {
  itemDaBancada,
  itemElegivelParaSecao,
  opcaoDoItem,
  tipoDaSecao,
  useCatalogoDeItens,
} from "../formulation-workbench/catalogo-de-itens";
import { PendenciasDoModelo } from "./PendenciasDoModelo";
import type { ItemDaBancada } from "../formulation-workbench/catalogo-de-itens";
import {
  CAMPOS_DO_COMPONENTE,
  ROTULO_DA_RESERVA,
  absorverChaves,
  baseForaDaRegra,
  chaveDeErro,
  comAjustesDaBancada,
  comBaseDerivada,
  comItemEscolhido,
  errosDaLinha,
  idDoCampo,
  linhaNova,
  proximaChaveDaLinha,
  secaoDaLinha,
  unidadeLegadaDaLinha,
} from "../formulation-workbench/linha-da-receita";
import type { LinhaDaReceita } from "../formulation-workbench/linha-da-receita";
import { usePodeCriarItem } from "../items/item-permissions";
import {
  operandosDoFisico,
  previaDaDose,
  previaDoComponente,
  unidadesDoMotor,
} from "../formulation-workbench/previa-do-calculo";

/**
 * Detalhe de um template da biblioteca.
 *
 * Rascunho edita; versão ativa é histórica e só se lê. Para mudar uma matriz
 * ativa, cria-se uma versão nova — a anterior continua existindo porque
 * formulações de produto apontam para ela.
 */

/**
 * O componente da versão do Modelo como a bancada o edita.
 *
 * Os nomes já são os mesmos desde a fatia 1 — `stockUnitCode`,
 * `itemDefaultPurityPercent`, `itemExternalCode` —, então a conversão é direta.
 * O Modelo não tem servidor que calcule físico por embalagem: as grandezas
 * derivadas ficam `null` e quem responde por elas é a prévia, pelo MESMO motor
 * que a API da Formulação usa.
 */
function linhaDoModelo(component: FormulationTemplateComponentDTO): LinhaDaReceita {
  return {
    key: proximaChaveDaLinha(),
    itemId: component.itemId,
    itemCode: component.itemCode,
    itemName: component.itemName,
    itemActive: component.itemActive,
    stockUnitCode: component.stockUnitCode,
    // Números no texto do campo, em português: é o que os campos editam.
    quantity: toPtBrEditText(component.quantity, OPCOES_QUANTIDADE),
    unitCode: component.unitCode,
    basis: component.basis,
    supplyResponsibility: component.supplyResponsibility,
    purityPercentApplied: toPtBrEditText(component.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO),
    overagePercent: toPtBrEditText(component.overagePercent, OPCOES_PERCENTUAL_TECNICO),
    quantityMode: component.quantityMode,
    applyPurityAdjustment: component.applyPurityAdjustment,
    applyOverageAdjustment: component.applyOverageAdjustment,
    notes: component.notes ?? "",
    theoreticalPerUnit: null,
    physicalPerUnit: null,
    theoreticalPerDose: null,
    physicalPerDose: null,
    physicalPerCapsule: null,
    itemType: component.itemType,
    secao: secaoDoItem(component.itemType),
    itemSourceName: component.itemSourceName ?? null,
    itemDeclaredNutrient: component.itemDeclaredNutrient ?? null,
    itemFamily: component.itemFamily ?? null,
    itemPackagingSubtype: component.itemPackagingSubtype ?? null,
    itemDefaultPurityPercent: component.itemDefaultPurityPercent ?? null,
    itemExternalCode: component.itemExternalCode ?? null,
  };
}

function linhasDaVersao(version: FormulationTemplateVersionDTO): LinhaDaReceita[] {
  return version.components.map(linhaDoModelo);
}

/**
 * A assinatura do rascunho — base, unidade e componentes numa string.
 *
 * Quantidade, fornecimento, modo, pureza, reserva, unidade e notas entram
 * todos: são digitação que "Salvar rascunho" grava e que sair perde. O que a
 * tela apenas calcula — a prévia da linha, o resumo da receita, a comparação
 * entre versões — fica fora.
 *
 * A chave da linha não entra: é identidade de renderização e muda a cada
 * recarga. Linha em branco também — "+ Adicionar matéria-prima" sem preencher
 * nada não é trabalho a perder, e é o que o próprio salvamento já descarta.
 */
function assinaturaDosComponentes(linhas: LinhaDaReceita[]): string {
  return assinaturaDoDocumento(
    linhas
      .filter((linha) => !linhaEmBranco(linha))
      .map((linha) => ({
        item: linha.itemId,
        quantidade: decimalComparavel(linha.quantity),
        unidade: linha.unitCode,
        // Sem a base: ela é derivada, e o que a pessoa não digita não é pendência.
        fornecimento: linha.supplyResponsibility,
        modo: linha.quantityMode,
        pureza: decimalComparavel(linha.purityPercentApplied),
        overage: decimalComparavel(linha.overagePercent),
        aplicaPureza: linha.applyPurityAdjustment,
        aplicaOverage: linha.applyOverageAdjustment,
        notas: textoComparavel(linha.notes),
      })),
  );
}

/** Linha acrescentada e não preenchida: não é trabalho, e não vai ao servidor. */
function linhaEmBranco(linha: LinhaDaReceita): boolean {
  return linha.itemId === "" && linha.quantity.trim() === "";
}

/**
 * O que falta numa linha começada — `null` se ela está completa ou em branco.
 *
 * O salvar filtrava item sem quantidade e quantidade sem item: a linha ficava
 * na tela, a pendência continuava acesa e nada dizia por que ela não foi
 * gravada. Linha começada não some em silêncio — prende o salvar e diz o quê.
 */
function faltaNaLinha(linha: LinhaDaReceita): "item" | "quantidade" | null {
  if (linhaEmBranco(linha)) return null;
  if (linha.itemId === "") return "item";
  if (linha.quantity.trim() === "") return "quantidade";
  return null;
}

const MENSAGEM_DA_FALTA = {
  item: "Escolha o item deste componente ou remova a linha.",
  quantidade: "Informe a quantidade deste componente ou remova a linha.",
} as const;

/**
 * As premissas técnicas da matriz, na forma que a tela edita.
 *
 * Os MESMOS nomes da Formulação — é o contrato que as duas bancadas leem, e
 * renomear de um lado só criaria tradução a cada tela. Números em texto
 * português: é o que os campos editam e o que a pendência compara.
 */
interface PremissasEmEdicao extends PremissasDaFormaValores {
  expectedLossPercent: string;
}

const PREMISSAS_VAZIAS: PremissasEmEdicao = {
  dosageForm: "",
  presentationType: "",
  capsulesPerDose: "",
  capsulesPerPackage: "",
  doseAmount: "",
  doseUomCode: "",
  packageContentAmount: "",
  packageContentUomCode: "",
  expectedLossPercent: "",
};

/**
 * As premissas da versão como a tela as edita.
 *
 * Modelo antigo tem tudo `null` — e continua assim: ausência é NÃO INFORMADA, e
 * preencher forma na leitura decidiria pelo usuário o que ele nunca declarou.
 */
function premissasDaVersao(version: FormulationTemplateVersionDTO): PremissasEmEdicao {
  return {
    dosageForm: version.dosageForm ?? "",
    presentationType: version.presentationType ?? "",
    capsulesPerDose: version.capsulesPerDose == null ? "" : String(version.capsulesPerDose),
    capsulesPerPackage:
      version.capsulesPerPackage == null ? "" : String(version.capsulesPerPackage),
    doseAmount: toPtBrEditText(version.doseAmount, OPCOES_QUANTIDADE),
    doseUomCode: version.doseUomCode ?? "",
    packageContentAmount: toPtBrEditText(version.packageContentAmount, OPCOES_QUANTIDADE),
    packageContentUomCode: version.packageContentUomCode ?? "",
    expectedLossPercent: toPtBrEditText(version.expectedLossPercent, OPCOES_PERCENTUAL_TECNICO),
  };
}

/** As premissas como a pendência as compara — número pelo valor, não pelo texto. */
function assinaturaDasPremissas(premissas: PremissasEmEdicao): string {
  return assinaturaDoDocumento({
    forma: premissas.dosageForm,
    apresentacao: premissas.presentationType,
    capsulasPorDose: textoComparavel(premissas.capsulesPerDose),
    capsulasPorEmbalagem: textoComparavel(premissas.capsulesPerPackage),
    dose: decimalComparavel(premissas.doseAmount),
    doseUom: premissas.doseUomCode,
    conteudo: decimalComparavel(premissas.packageContentAmount),
    conteudoUom: premissas.packageContentUomCode,
    perda: decimalComparavel(premissas.expectedLossPercent),
  });
}

/**
 * As premissas no formato que a API recebe.
 *
 * Campo vazio vira `null` — NAO INFORMADA —, e nunca `0`: perda de 0% e uma
 * declaracao ("nao ha perda"), e transformar ausencia em zero inventaria a
 * premissa que ninguem escreveu. Premissa de outra forma vai como esta: o
 * servidor e quem decide o que cada forma guarda, e reescrever isso aqui
 * criaria uma segunda regra para divergir da primeira.
 */
function premissasParaAPI(premissas: PremissasEmEdicao): UpdateFormulationTemplateVersionInput {
  const inteiroOuNulo = (texto: string) => {
    const leitura = lerInteiroOpcional(texto);
    return leitura.tipo === "valido" ? leitura.valor : null;
  };
  return {
    dosageForm: premissas.dosageForm === "" ? null : premissas.dosageForm,
    presentationType: premissas.presentationType === "" ? null : premissas.presentationType,
    capsulesPerDose: inteiroOuNulo(premissas.capsulesPerDose),
    capsulesPerPackage: inteiroOuNulo(premissas.capsulesPerPackage),
    doseAmount: exigirDecimalOpcional(premissas.doseAmount, "Dose", OPCOES_QUANTIDADE),
    doseUomCode: premissas.doseUomCode === "" ? null : premissas.doseUomCode,
    packageContentAmount: exigirDecimalOpcional(
      premissas.packageContentAmount,
      "Conteúdo da embalagem",
      OPCOES_QUANTIDADE,
    ),
    packageContentUomCode:
      premissas.packageContentUomCode === "" ? null : premissas.packageContentUomCode,
    expectedLossPercent: exigirDecimalOpcional(
      premissas.expectedLossPercent,
      "Perda prevista de produção",
      OPCOES_PERCENTUAL_TECNICO,
    ),
  };
}

function assinaturaDoRascunho(
  base: string,
  unidade: string,
  premissas: PremissasEmEdicao,
  linhas: LinhaDaReceita[],
): string {
  return assinaturaDoDocumento({
    base: decimalComparavel(base),
    unidade,
    premissas: assinaturaDasPremissas(premissas),
    componentes: assinaturaDosComponentes(linhas),
  });
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
  /** Premissas técnicas digitadas — sair para cadastrar um Item não as perde. */
  premissas: PremissasEmEdicao;
  linhas: LinhaDaReceita[];
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

/**
 * A Ficha Técnica de UMA versão do Modelo. A rota guarda o nome técnico
 * `templates-formulacao`, que já é o endereço da biblioteca; a tela diz Modelo.
 */
function rotaDaFichaTecnica(templateId: string, versionId: string): string {
  return `/producao/templates-formulacao/${templateId}/versoes/${versionId}/ficha-tecnica`;
}

export function FormulationTemplateDetailPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "PRODUCTION";
  /* Cadastrar Item no meio do Modelo segue a lista do Item, não a do Modelo. */
  const podeCadastrarItem = usePodeCriarItem();

  const [template, setTemplate] = useState<FormulationTemplateDTO | null>(null);
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
  const [linhas, setLinhas] = useState<LinhaDaReceita[]>([]);
  /** Depois de um salvar recusado por linha incompleta, cada linha diz o que falta. */
  const [conferirLinhas, setConferirLinhas] = useState(false);
  const [base, setBase] = useState("1");
  const [unidade, setUnidade] = useState("un");
  /** Premissas técnicas da matriz — as mesmas da Formulação, num objeto só. */
  const [premissas, setPremissas] = useState<PremissasEmEdicao>(PREMISSAS_VAZIAS);
  /** Recusa da premissa vinda do servidor, campo a campo. */
  const [errosDeCampo, setErrosDeCampo] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<UnitOfMeasureDTO[]>([]);
  const [diff, setDiff] = useState<FormulationTemplateDiffDTO | null>(null);
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  /** O catálogo da bancada — o MESMO da Formulação, filtrado pela seção. */
  const catalogo = useCatalogoDeItens();

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

  /*
   * O que o servidor devolveu na última leitura, campo a campo.
   *
   * Identificação e rascunho gravam separado, e as duas ações terminam em
   * `load()`: salvar a identificação reescrevia base, unidade e componentes com
   * o que está gravado, e a edição pendente do outro bloco sumia sem aviso. Com
   * a leitura anterior em mãos dá para separar "ainda está como o servidor
   * deixou" de "a pessoa mexeu" — e só o primeiro recebe a leitura nova.
   *
   * Começa nos MESMOS valores iniciais do estado: na primeira carga ninguém
   * digitou nada e tudo tem de ser substituído.
   */
  const lido = useRef({
    nome: "",
    descricao: "",
    base: "1",
    unidade: "un",
    premissas: assinaturaDasPremissas(PREMISSAS_VAZIAS),
    componentes: assinaturaDosComponentes([]),
  });

  const load = useCallback(() => {
    if (!templateId) return;
    getFormulationTemplate(templateId)
      .then((result) => {
        setTemplate(result);
        if (rascunhoRestaurado.current) {
          rascunhoRestaurado.current = false;
          return;
        }
        const anterior = lido.current;
        const rascunho = result.draftVersion;
        const novasLinhas = rascunho ? linhasDaVersao(rascunho) : [];
        const novasPremissas = rascunho ? premissasDaVersao(rascunho) : PREMISSAS_VAZIAS;
        lido.current = {
          nome: result.name,
          descricao: result.description ?? "",
          base: rascunho ? toPtBrEditText(rascunho.basisQuantity, OPCOES_QUANTIDADE) : anterior.base,
          unidade: rascunho?.outputUnitCode ?? anterior.unidade,
          premissas: rascunho ? assinaturaDasPremissas(novasPremissas) : anterior.premissas,
          componentes: rascunho ? assinaturaDosComponentes(novasLinhas) : anterior.componentes,
        };
        setNome((atual) => (atual === anterior.nome ? result.name : atual));
        setDescricao((atual) =>
          atual === anterior.descricao ? (result.description ?? "") : atual,
        );
        if (rascunho) {
          const baseLida = toPtBrEditText(rascunho.basisQuantity, OPCOES_QUANTIDADE);
          setBase((atual) => (atual === anterior.base ? baseLida : atual));
          setUnidade((atual) => (atual === anterior.unidade ? rascunho.outputUnitCode : atual));
          setPremissas((atual) =>
            assinaturaDasPremissas(atual) === anterior.premissas ? novasPremissas : atual,
          );
          setLinhas((atual) =>
            assinaturaDosComponentes(atual) === anterior.componentes ? novasLinhas : atual,
          );
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar o modelo"),
      );
  }, [templateId]);

  useEffect(() => load(), [load]);
  /*
   * O catálogo de unidades chega uma vez, para todas as linhas — cada uma só
   * filtra pela dimensão do seu Item. É a mesma leitura da Formulação real
   * (FORM-UOM-01).
   */
  useEffect(() => {
    listUnits()
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  /**
   * Cadastro de item na TELA OFICIAL, sem perder a matriz.
   *
   * A coluna Item vive em linha de tabela, então o contexto carrega QUAL
   * linha pediu: sem isso o item criado voltaria para a primeira, que é a
   * linha errada.
   */
  const origem = useContextualCreateOrigin<RascunhoTemplate>({
    collectDraft: () => ({ nome, descricao, base, unidade, premissas, linhas }),
    restoreDraft: (draft) => {
      // Antes de qualquer `setState`: a carga do template está a caminho e
      // não pode sobrescrever o que volta aqui.
      rascunhoRestaurado.current = true;
      setNome(draft.nome ?? "");
      setDescricao(draft.descricao ?? "");
      setBase(draft.base ?? "");
      setUnidade(draft.unidade ?? "");
      // Rascunho vem de `sessionStorage`: é dado desconhecido até prova em
      // contrário, e premissa ausente volta vazia em vez de quebrar a tela.
      setPremissas({ ...PREMISSAS_VAZIAS, ...(draft.premissas ?? {}) });
      const restauradas = Array.isArray(draft.linhas) ? draft.linhas : [];
      absorverChaves(restauradas);
      setLinhas(restauradas);
    },
    onCreated: (result, record) => {
      const chave = lerChaveDaLinha(record.context);
      if (!chave) return;
      // Pelo id, imediatamente. O nome é provisório: fica no lugar até o
      // item real chegar logo abaixo.
      setLinhas((atual) =>
        atual.map((l) =>
          l.key === chave ? { ...l, itemId: result.entityId, itemName: result.label } : l,
        ),
      );
      /*
       * A linha precisa da unidade de estoque, e o resultado da criação traz
       * só id e rótulo. Buscar o item pelo id é o que completa a linha — e o
       * que põe a opção no seletor antes de o catálogo recarregar. Falha aqui
       * não desfaz a seleção: o id já está na linha.
       */
      void getItem(result.entityId)
        .then((item) => {
          const opcao = itemDaBancada(item);
          catalogo.adicionar(opcao);
          setLinhas((atual) =>
            atual.map((l) =>
              l.key === chave ? comItemEscolhido(comBaseDerivada(l, porDose), opcao, units) : l,
            ),
          );
        })
        .catch(() => undefined);
    },
  });

  async function run(
    acao: string,
    action: () => Promise<unknown>,
    sucesso?: { bloco: string; texto: string },
  ) {
    setAcaoEmCurso(acao);
    setErrosDeCampo({});
    setError(null);
    setFeito(null);
    try {
      await action();
      load();
      // Só depois de a ação passar: erro que caísse aqui deixaria a tela
      // dizendo "salvo" sobre o que não foi gravado.
      if (sucesso) setFeito(sucesso);
    } catch (err) {
      /*
       * Recusa de premissa vem COM ENDERECO (`issues[].path`): a tela marca o
       * campo em vez de mostrar a frase solta na faixa do topo, onde ela
       * obrigaria a procurar qual das premissas nao fechou.
       */
      if (err instanceof ApiValidationError) {
        const porCampo: Record<string, string> = {};
        for (const issue of err.issues) {
          if (issue.path && !porCampo[issue.path]) porCampo[issue.path] = issue.message;
        }
        setErrosDeCampo(porCampo);
      }
      setError(apiErrorMessage(err, "Falha ao executar a ação"));
      /*
       * Ativação recusada por componente: o cadastro do Item pode ter mudado
       * depois da última leitura. Reler traz as pendências de agora para o
       * painel — e a leitura só substitui o que ninguém editou desde então.
       */
      if (acao === "ativar") load();
    } finally {
      setAcaoEmCurso(null);
    }
  }

  /*
   * Duas pendências convivem nesta tela, e a guarda soma as duas.
   *
   * Identificação e rascunho gravam separado, cada um com o seu botão: salvar
   * o nome não absolve o componente meio digitado, e salvar o rascunho não
   * absolve o nome trocado.
   *
   * Nada do que a tela calcula entra: prévia da linha, resumo da receita e
   * comparação entre versões são resultado do que já está ali.
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
    assinaturaDoRascunho(base, unidade, premissas, linhas) !==
      assinaturaDoRascunho(
        toPtBrEditText(rascunhoDoServidor.basisQuantity, OPCOES_QUANTIDADE),
        rascunhoDoServidor.outputUnitCode,
        premissasDaVersao(rascunhoDoServidor),
        linhasDaVersao(rascunhoDoServidor),
      );
  const { liberarGuarda } = useUnsavedChangesGuard({
    isDirty: identificacaoAlterada || rascunhoAlterado,
    substantivo: "modelo de formulação",
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

  const rascunho = template?.draftVersion ?? null;
  const ativa = template?.activeVersion ?? null;
  const editavel = canEdit && rascunho !== null;

  /*
   * A VERSÃO QUE A TELA MOSTRA: o rascunho quando existe, senão a ativa.
   *
   * A bancada é a mesma nos dois casos — só o rascunho é editável. Sem esta
   * distinção, um Modelo sem rascunho abriria a grade vazia e sem premissa
   * nenhuma, como se a matriz ativa não tivesse receita.
   */
  const versaoExibida = rascunho ?? ativa;
  /*
   * As linhas da versão ATIVA nascem uma vez por versão:  gera
   * chave nova a cada chamada, e recalculá-las a cada render trocaria a
   * identidade de todas as linhas — a tabela remontaria sozinha.
   */
  const linhasDaAtiva = useMemo(
    () => (template?.activeVersion ? linhasDaVersao(template.activeVersion) : []),
    [template?.activeVersion?.id],
  );
  const premissasExibidas = rascunho
    ? premissas
    : ativa
      ? premissasDaVersao(ativa)
      : PREMISSAS_VAZIAS;
  const baseExibida = rascunho ? base : (ativa?.basisQuantity ?? "1");

  /*
   * PREMISSAS TÉCNICAS DA MATRIZ — a mesma leitura da Formulação.
   *
   * As formas que o seletor oferece são pó e cápsula, o que a Veridi produz.
   * Um Modelo gravado com outra forma — ou com forma nenhuma, que é todo Modelo
   * anterior a esta bancada — continua legível: a opção dele fica na lista
   * ENQUANTO for a dele, porque tirar a opção de um valor gravado faria o
   * seletor cair no traço e apagar a premissa no primeiro salvamento.
   */
  const forma = premissasExibidas.dosageForm;
  const formasOferecidas =
    forma === "" || FORMAS_DA_BANCADA.includes(forma)
      ? FORMAS_DA_BANCADA
      : [...FORMAS_DA_BANCADA, forma];
  const apresentacoesOferecidas = apresentacoesDaForma(
    forma === "" ? null : forma,
    premissasExibidas.presentationType === "" ? null : premissasExibidas.presentationType,
    PRESENTATION_TYPES,
  );
  /* Dose e conteúdo do pó são massa: o seletor só oferece unidade de massa. */
  const unidadesDeMassa = units.filter((unit) => unit.dimension === "MASS");
  const leituraDasCapsulasPorDose = lerInteiroOpcional(premissasExibidas.capsulesPerDose);
  const leituraDasCapsulasPorEmbalagem = lerInteiroOpcional(premissasExibidas.capsulesPerPackage);
  const capsulasPorDose =
    forma === "CAPSULE" && leituraDasCapsulasPorDose.tipo === "valido"
      ? leituraDasCapsulasPorDose.valor
      : null;
  const premissasDaTela = {
    dosageForm: forma === "" ? null : forma,
    capsulesPerDose: capsulasPorDose,
    capsulesPerPackage:
      leituraDasCapsulasPorEmbalagem.tipo === "valido" ? leituraDasCapsulasPorEmbalagem.valor : null,
    doseAmount: decimalLegivel(premissasExibidas.doseAmount, OPCOES_QUANTIDADE),
    doseUomCode: premissasExibidas.doseUomCode || null,
    packageContentAmount: decimalLegivel(premissasExibidas.packageContentAmount, OPCOES_QUANTIDADE),
    packageContentUomCode: premissasExibidas.packageContentUomCode || null,
  };
  /*
   * Doses por embalagem é RESULTADO nas duas formas da bancada — a tela mostra
   * o número em vez de pedi-lo de novo, pela MESMA função que a API usa.
   * Divisão que não fecha vira recusa no campo, nunca doses arredondadas.
   */
  const derivaDoses = formaDerivaDoses(premissasDaTela.dosageForm);
  const dosesDerivadas = derivaDoses
    ? dosesPorEmbalagemDaApresentacao(premissasDaTela, unidadesDoMotor(units))
    : null;
  /*
   * O número de doses que a prévia usa: derivado na cápsula e no pó, e o que
   * está GRAVADO nas formas que não derivam — inclusive o Modelo legado, que
   * não tem forma nenhuma e continua com as doses que declarou.
   */
  const dosesPorEmbalagem =
    typeof dosesDerivadas === "number" ? dosesDerivadas : (versaoExibida?.dosesPerPackage ?? null);
  const capsulasNaEmbalagem = capsulasPorEmbalagem(capsulasPorDose, dosesPorEmbalagem);
  const mostrarPorCapsula = forma === "CAPSULE";
  /*
   * A receita é por dose? — a mesma pergunta da Formulação e do servidor
   * (FORMULATION-COMPONENT-BASIS-AUTOMATION-01): modo "Por dose", ou forma que
   * deriva doses (cápsula e pó).
   */
  const porDose = receitaPorDose({
    calculationMode: versaoExibida?.calculationMode,
    dosageForm: premissasDaTela.dosageForm,
  });
  /*
   * A RECEITA QUE A BANCADA MOSTRA. No rascunho, cada linha com a base DERIVADA —
   * a que "Salvar rascunho" vai gravar; na versão ativa, a base GRAVADA, que é o
   * snapshot dela.
   */
  const receitaExibida = rascunho
    ? linhas.map((linha) => comBaseDerivada(linha, porDose))
    : linhasDaAtiva;

  /* As duas seções da bancada, pelo tipo real do Item. */
  const linhasDaComposicao = receitaExibida.filter((linha) => secaoDaLinha(linha) === "COMPOSICAO");
  const linhasDaEmbalagem = receitaExibida.filter((linha) => secaoDaLinha(linha) === "EMBALAGEM");

  /** Totais técnicos da dose, somados em mg pelo mesmo motor das linhas. */
  const resumoDaDose = resumirDoses(
    linhasDaComposicao
      .filter((linha) => linha.basis === "PER_DOSE")
      .map((linha) => {
        const valores = valoresDaDose(linha);
        return valores
          ? { teorica: valores.teorica, fisica: valores.fisica, unitCode: linha.unitCode }
          : null;
      })
      .filter(
        (linha): linha is { teorica: string; fisica: string; unitCode: string } => linha !== null,
      ),
    capsulasPorDose,
    unidadesDoMotor(units),
  );

  /* RENDIMENTO ESPERADO — 100% menos a perda, pela MESMA função da API. */
  const perdaDigitada = decimalLegivel(premissasExibidas.expectedLossPercent, OPCOES_PERCENTUAL_TECNICO);
  const rendimento = rendimentoEsperado(perdaDigitada);
  const rendimentoExibido =
    rendimento === null || typeof rendimento === "string" ? null : rendimento.toString();

  /** A recusa que o servidor pendurou no campo sai quando alguém o edita. */
  function limparRecusaDoCampo(campo: string) {
    setErrosDeCampo((atual) => {
      if (!(campo in atual)) return atual;
      const { [campo]: _removido, ...resto } = atual;
      return resto;
    });
  }

  /** Altera uma premissa da matriz e limpa a recusa pendurada nela. */
  function mudarPremissa<K extends keyof PremissasEmEdicao>(
    campo: K,
    valor: PremissasEmEdicao[K],
  ) {
    setPremissas((atual) => ({ ...atual, [campo]: valor }));
    limparRecusaDoCampo(campo);
  }

  /**
   * As unidades compatíveis com o Item da linha.
   *
   * A dimensão vem do catálogo quando o Item está na página carregada e, senão,
   * da UNIDADE DE ESTOQUE que a própria linha guarda — é a mesma leitura da
   * Formulação (FORM-UOM-01).
   */
  function unidadesDaLinha(linha: LinhaDaReceita): UnitOfMeasureDTO[] {
    const escolhido = catalogo.itens.find((item) => item.id === linha.itemId);
    const dimensao =
      escolhido?.unitDimension ??
      units.find((unit) => unit.code === linha.stockUnitCode)?.dimension ??
      null;
    if (dimensao === null) return units;
    return unidadesDaDimensao(units, dimensao);
  }

  /**
   * O que o seletor da linha oferece: a seção manda, e o já escolhido fica.
   *
   * Nova escolha só entre itens ATIVOS do tipo da seção — a API recusaria os
   * outros. O item que a linha já referencia continua na lista mesmo inativo,
   * com a marca, para a matriz antiga poder ser lida e corrigida.
   */
  function opcoesDaLinha(linha: LinhaDaReceita): ItemDaBancada[] {
    const secao = secaoDaLinha(linha);
    const usadosPorOutras = new Set(
      linhas.filter((outra) => outra.key !== linha.key).map((outra) => outra.itemId),
    );
    const base = catalogo.itens.filter(
      (item) =>
        !usadosPorOutras.has(item.id) &&
        (item.id === linha.itemId || itemElegivelParaSecao(item, secao)),
    );
    if (linha.itemId && !base.some((item) => item.id === linha.itemId)) {
      return [
        ...base,
        {
          id: linha.itemId,
          code: linha.itemCode,
          name: linha.itemName,
          type: linha.itemType ?? "RAW_MATERIAL",
          unitCode: linha.stockUnitCode,
          unitDimension: "",
          active: linha.itemActive,
          sourceName: linha.itemSourceName,
          declaredNutrient: linha.itemDeclaredNutrient,
          family: linha.itemFamily,
          packagingSubtype: linha.itemPackagingSubtype,
          defaultPurityPercent: linha.itemDefaultPurityPercent,
          externalCode: linha.itemExternalCode,
        },
      ];
    }
    return base;
  }

  async function buscarItens(linha: LinhaDaReceita, termo: string): Promise<EntityOption[]> {
    const secao = secaoDaLinha(linha);
    const encontrados = await catalogo.buscar(secao, termo);
    const usadosPorOutras = new Set(
      linhas.filter((outra) => outra.key !== linha.key).map((outra) => outra.itemId),
    );
    return encontrados
      .filter((item) => !usadosPorOutras.has(item.id) && itemElegivelParaSecao(item, secao))
      .map(opcaoDoItem);
  }

  /**
   * Os números por dose da linha — sempre pela PRÉVIA.
   *
   * O Modelo não tem servidor que calcule físico e equivalente: a matriz guarda
   * a receita, não o resultado dela. A conta é a MESMA função que a API da
   * Formulação chama, então o número que aparece aqui é o número que a
   * formulação nascida deste Modelo vai ter.
   */
  function valoresDaDose(linha: LinhaDaReceita) {
    return previaDaDose(linha, capsulasPorDose, units);
  }

  function valoresDaLinha(linha: LinhaDaReceita) {
    const previa = previaDoComponente(linha, baseExibida, dosesPorEmbalagem, units);
    return {
      fisicoExibido: previa?.fisico ?? null,
      equivalenteExibido: previa?.teorico ?? null,
      dose: valoresDaDose(linha),
    };
  }

  /** A conta do físico por embalagem, ao lado do número que ela produz. */
  function explicacaoDoFisico(linha: LinhaDaReceita, fisico: string | null) {
    if (fisico === null) return null;
    // Versão ativa gravada com base fora da regra: dito aqui, somente leitura.
    const baseGravada = rascunho ? null : baseForaDaRegra(linha, porDose);
    return (
      <CalcHint
        label="Quantidade física"
        operandos={operandosDoFisico(linha, baseExibida, dosesPorEmbalagem, units)}
        resultado={`${formatQuantity(fisico)} ${linha.stockUnitCode}`}
        nota={
          "Calculado pelo mesmo motor da Formulação — a pureza corrige a quantidade física." +
          (baseGravada
            ? ` Base de cálculo gravada nesta versão: ${FORMULATION_COMPONENT_BASIS_LABELS[baseGravada]} — diferente da que a configuração do modelo define hoje.`
            : "")
        }
      />
    );
  }

  function adicionarLinha(secao: SecaoDaFormula) {
    setLinhas((atual) => [...atual, linhaNova(secao, porDose)]);
  }

  function removerLinha(key: string) {
    setLinhas((atual) => atual.filter((linha) => linha.key !== key));
  }

  /**
   * Move a linha uma posição dentro da PRÓPRIA seção.
   *
   * O vizinho é procurado SALTANDO as linhas da outra seção: composição e
   * embalagem dividem um array só, e trocar com a linha imediatamente anterior
   * moveria uma matéria-prima para dentro da embalagem. A ordem vai ao servidor
   * como `position`, pelo índice do array.
   */
  function moverLinha(key: string, direcao: -1 | 1) {
    setLinhas((atual) => {
      const indice = atual.findIndex((linha) => linha.key === key);
      const alvo = atual[indice];
      if (!alvo) return atual;
      const secao = secaoDaLinha(alvo);
      let vizinho = indice + direcao;
      while (vizinho >= 0 && vizinho < atual.length && secaoDaLinha(atual[vizinho]!) !== secao) {
        vizinho += direcao;
      }
      const trocada = atual[vizinho];
      if (!trocada) return atual;
      const proximo = [...atual];
      proximo[indice] = trocada;
      proximo[vizinho] = alvo;
      return proximo;
    });
  }

  /**
   * Campo da linha, já sob o contrato da bancada.
   *
   * Digitar na coluna Pureza é o gesto INTEIRO: não há painel para abrir, modo
   * para trocar nem caixa para marcar. `comAjustesDaBancada` é idempotente e
   * vale para qualquer campo, então nenhum caminho de edição escapa dele.
   */
  function mudarCampoDaLinha<K extends keyof LinhaDaReceita>(
    key: string,
    campo: K,
    valor: LinhaDaReceita[K],
  ) {
    setLinhas((atual) =>
      atual.map((linha) =>
        linha.key === key ? comAjustesDaBancada({ ...linha, [campo]: valor }) : linha,
      ),
    );
  }

  function mudarFornecimentoDaLinha(key: string, supplyResponsibility: SupplyResponsibility) {
    setLinhas((atual) =>
      atual.map((linha) => (linha.key === key ? { ...linha, supplyResponsibility } : linha)),
    );
  }

  /**
   * A linha com o item escolhido — e com o que o cadastro do Item já sabe.
   *
   * A pureza padrão do Item entra como a APLICADA desta versão do Modelo: é
   * SNAPSHOT, e alterar o cadastro do Item depois não reescreve Modelo nenhum,
   * nem a Formulação que nascer dele. Embalagem não tem pureza: pote e tampa
   * não têm teor a corrigir.
   */
  function mudarItemDaLinha(key: string, itemId: string) {
    const item = catalogo.itens.find((candidato) => candidato.id === itemId);
    setLinhas((atual) =>
      atual.map((linha) =>
        linha.key === key ? comItemEscolhido(comBaseDerivada(linha, porDose), item, units) : linha,
      ),
    );
  }

  /**
   * O item escolhido na CONSULTA ASSISTIDA — inteiro, porque pode vir de fora
   * do catálogo que o seletor conhece. Mesmo caminho da Formulação: entra no
   * catálogo e vai para a linha por `comItemEscolhido`.
   */
  function escolherItemConsultado(escolhida: LinhaDaReceita, item: ItemDaBancada) {
    catalogo.mesclar([item]);
    setLinhas((atual) =>
      atual.map((linha) =>
        linha.key === escolhida.key
          ? comItemEscolhido(comBaseDerivada(linha, porDose), item, units)
          : linha,
      ),
    );
  }

  /* Unidade gravada que a lista não oferece: legado, e prende o salvar. */
  const temUnidadeInvalida = linhas.some(
    (linha) => unidadeLegadaDaLinha(linha, unidadesDaLinha(linha)) !== null,
  );

  /** As recusas por campo da linha, no mesmo endereço que a bancada marca. */
  const errosDasLinhas: Record<string, string> = {};
  if (conferirLinhas) {
    for (const linha of linhas) {
      if (linhaEmBranco(linha)) continue;
      /*
       * Linha COMEÇADA e não terminada tem a sua própria frase: ela diz o que
       * fazer com a linha ("informe ou remova"), não que o campo é obrigatório.
       * Só depois de completa é que valem as regras de valor da bancada —
       * pureza até 100, reserva não negativa, quantidade maior que zero.
       */
      if (faltaNaLinha(linha) === "quantidade") {
        errosDasLinhas[chaveDeErro(linha.key, "quantity")] = MENSAGEM_DA_FALTA.quantidade;
        continue;
      }
      if (!linha.itemId) continue;
      const daLinha = errosDaLinha(linha);
      for (const campo of CAMPOS_DO_COMPONENTE) {
        const mensagem = daLinha[campo];
        if (mensagem) errosDasLinhas[chaveDeErro(linha.key, campo)] = mensagem;
      }
    }
  }

  function salvarRascunho() {
    if (!rascunho) return;
    // Linha começada e não terminada prende o salvar, e o foco vai ao campo
    // que falta — nada é descartado nem inventado.
    const incompleta = linhas.find((linha) => faltaNaLinha(linha) !== null);
    if (incompleta) {
      const campoQueFalta =
        faltaNaLinha(incompleta) === "item"
          ? `componente-${incompleta.key}`
          : idDoCampo(incompleta.key, "quantity");
      setFeito(null);
      setError(null);
      setConferirLinhas(true);
      requestAnimationFrame(() => document.getElementById(campoQueFalta)?.focus());
      return;
    }
    /*
     * Pureza e reserva seguem as MESMAS regras das duas bancadas: pureza
     * 0 < x ≤ 100, reserva não negativa, vazio = não informado. A recusa
     * nomeia o componente e o campo, e para antes de qualquer chamada.
     */
    const comErro = linhas
      .filter((linha) => linha.itemId && !linhaEmBranco(linha))
      .find((linha) => Object.keys(errosDaLinha(linha)).length > 0);
    if (comErro) {
      setFeito(null);
      setError("Corrija os campos destacados.");
      setConferirLinhas(true);
      const primeiro = CAMPOS_DO_COMPONENTE.find((campo) => errosDaLinha(comErro)[campo]);
      if (primeiro) {
        const alvo = idDoCampo(comErro.key, primeiro);
        requestAnimationFrame(() => document.getElementById(alvo)?.focus());
      }
      return;
    }
    setConferirLinhas(false);
    void run(
      "rascunho",
      () =>
        updateFormulationTemplateVersion(rascunho.id, {
          basisQuantity: exigirDecimal(base, "Base da formulação", OPCOES_QUANTIDADE),
          outputUnitCode: unidade,
          /*
           * PREMISSAS TECNICAS — vao inteiras, inclusive as vazias: `null`
           * LIMPA a premissa, e omitir o campo deixaria o valor antigo gravado
           * depois de a pessoa ter apagado o campo na tela.
           *
           * `capsulesPerPackage` e entrada: o servidor deriva as doses por
           * embalagem dela e recusa a divisao que nao fecha, em vez de
           * arredondar doses.
           */
          ...premissasParaAPI(premissas),
          components: linhas
            // Só a linha em branco fica de fora: a incompleta já parou acima.
            .filter((linha) => !linhaEmBranco(linha))
            .map((linha) => ({
              itemId: linha.itemId,
              quantity: exigirDecimal(linha.quantity, "Quantidade", OPCOES_QUANTIDADE),
              unitCode: linha.unitCode,
              // Sem `basis`: o servidor a deriva da seção e das premissas.
              supplyResponsibility: linha.supplyResponsibility,
              // Vazio = não informado (null), nunca 0% nem 100%.
              purityPercentApplied: exigirDecimalOpcional(
                linha.purityPercentApplied,
                "Pureza %",
                OPCOES_PERCENTUAL_TECNICO,
              ),
              overagePercent: exigirDecimalOpcional(
                linha.overagePercent,
                ROTULO_DA_RESERVA,
                OPCOES_PERCENTUAL_TECNICO,
              ),
              quantityMode: linha.quantityMode,
              applyPurityAdjustment: linha.applyPurityAdjustment,
              applyOverageAdjustment: linha.applyOverageAdjustment,
              ...(linha.notes.trim() ? { notes: linha.notes.trim() } : {}),
            })),
        }),
      { bloco: "rascunho", texto: "Rascunho salvo." },
    );
  }

  /** O campo com recusa do servidor: `aria-invalid` e a mensagem, ligados. */
  function erroDoCampo(campo: string) {
    return errosDeCampo[campo] ? (
      <p className="field__error" id={`template-${campo}-error`}>
        {errosDeCampo[campo]}
      </p>
    ) : null;
  }

  if (!template) {
    return (
      <div className="doc-body">
        {error ? <p className="form-alert" role="alert">{error}</p> : <p>Carregando…</p>}
      </div>
    );
  }

  /**
   * A receita de uma versão, na bancada compartilhada.
   *
   * Rascunho edita; versão ativa é documento fechado e só se lê — e é a MESMA
   * grade, com as mesmas colunas: Pureza, Reserva, Física por dose e, na
   * cápsula, Por cápsula. A versão ativa não precisa de catálogo nem de
   * gestos, então recebe listas vazias e ações que não fazem nada: sem campo
   * para editar, nenhuma delas é alcançável.
   */
  function bancadaDaSecao(secao: SecaoDaFormula, comEdicao: boolean, daVersao: LinhaDaReceita[]) {
    const linhasDaSecao = daVersao.filter((linha) => secaoDaLinha(linha) === secao);
    return (
      <TabelaDaReceita
        secao={secao}
        linhas={linhasDaSecao}
        editavel={comEdicao}
        mostrarPorCapsula={mostrarPorCapsula}
        unidadesDaLinha={unidadesDaLinha}
        opcoesDeItem={(linha) => opcoesDaLinha(linha).map(opcaoDoItem)}
        onBuscarItem={buscarItens}
        onCriarItem={
          comEdicao && podeCadastrarItem
            ? (linha) =>
                liberarGuarda(() =>
                  origem.goCreate({
                    // O tipo da seção chega pré-escolhido, como na Formulação.
                    route: `/cadastros/itens/novo?tipo=${tipoDaSecao(secao)}`,
                    fieldKey: "itemId",
                    entityType: "item",
                    // Qual linha pediu — o item volta para ela.
                    context: { rowKey: linha.key },
                  }),
                )
            : undefined
        }
        consultaDeItem={
          comEdicao
            ? { origem: "Modelo de formulação", onEscolher: escolherItemConsultado }
            : undefined
        }
        erroDoItem={(linha) =>
          conferirLinhas && faltaNaLinha(linha) === "item"
            ? MENSAGEM_DA_FALTA.item
            : undefined
        }
        valoresDaLinha={valoresDaLinha}
        explicacaoDoFisico={explicacaoDoFisico}
        erros={errosDasLinhas}
        onCampo={mudarCampoDaLinha}
        onFornecimento={mudarFornecimentoDaLinha}
        onItem={mudarItemDaLinha}
        onMover={moverLinha}
        onRemover={removerLinha}
        onAdicionar={adicionarLinha}
        /* Os totais da dose fecham a COMPOSIÇÃO: a embalagem não soma massa. */
        totaisDaDose={secao === "COMPOSICAO" ? resumoDaDose : undefined}
        /* No Modelo o fornecimento é SUGESTÃO: a cópia leva o valor, e o produto
           muda sem mexer na biblioteca. O ⓘ da matriz diz isso. */
        dicaDoFornecimento="producao.template.fornecimentoPadrao"
      />
    );
  }

  return (
    <div className="doc-page">
      <div className="doc-header">
        <div>
          <PageBreadcrumbs items={[{ label: "Modelos de Formulação", href: "/producao/templates-formulacao" }, { label: "Detalhe" }]} />
          <h1 className="doc-title">
            <code>{template.code}</code> {template.name}
            {template.archived && <span className="badge badge--neutral">Arquivado</span>}
          </h1>
          {template.description && <p className="page__subtitle">{template.description}</p>}
        </div>
        {/*
          A FICHA TÉCNICA do Modelo, em PDF — documento técnico da matriz, sem
          custo. Fica no cabeçalho, como na Formulação, e é da versão que a
          bancada mostra: o rascunho quando há, senão a ativa. As outras versões
          têm a ficha delas no histórico.
        */}
        {versaoExibida && (
          <div className="table__actions">
            <button
              type="button"
              className="btn btn--secondary"
              aria-label={`Ficha técnica (PDF) da ${versaoExibida.versionLabel}`}
              title={`Ficha técnica da ${versaoExibida.versionLabel}`}
              onClick={() => navigate(rotaDaFichaTecnica(template.id, versaoExibida.id))}
            >
              Ficha técnica (PDF)
            </button>
          </div>
        )}
      </div>

      <div className="doc-body">
        {/* Rascunho, ativa e arquivada convivem nesta tela, e a diferença
            entre elas é a regra inteira da capacidade. A explicação vem
            antes da primeira seção. */}
        <ContextHelp topic={helpTopics["producao.templateDetalhe"]} />

        {error && <p className="form-alert" role="alert">{error}</p>}

        {/* O que o cadastro do Item invalidou: no rascunho é o que barra a
            ativação; sem rascunho, é o aviso de quem vai aplicar a ativa. */}
        {rascunho ? (
          <PendenciasDoModelo issues={rascunho.componentIssues} versao="rascunho" />
        ) : (
          ativa && <PendenciasDoModelo issues={ativa.componentIssues} versao="ativa" />
        )}

        <FormSection
          title="Identificação"
          subtitle="O nome é escolhido por quem cria — um modelo é reutilizável e não carrega o nome de nenhum cliente."
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
                        updateFormulationTemplate(template.id, {
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
                      setFormulationTemplateArchived(template.id, !template.archived),
                    )
                  }
                >
                  {template.archived ? "Desarquivar" : "Arquivar"}
                </button>
              </div>
            </div>
          )}
        </FormSection>

        {/*
          A VERSÃO ATIVA continua dizendo o que é, mesmo com rascunho aberto: é
          ela que vale para quem aplicar o Modelo hoje, e quantas formulações
          nasceram dela. A RECEITA dela aparece na bancada quando não há
          rascunho — com rascunho, a bancada edita o rascunho, que é o que se
          está montando; a versão ativa continua no histórico, intocada.
        */}
        {ativa && (
          <FormSection
            title={`Versão ativa — ${ativa.versionLabel}`}
            subtitle={`Base ${formatQuantity(ativa.basisQuantity)} ${ativa.outputUnitCode} · ${FORMULATION_CALCULATION_MODE_LABELS[ativa.calculationMode]} · ${ativa.components.length} componentes. Versão ativa é histórica: para alterar, crie uma nova versão.`}
          >
            {ativa.usageCount > 0 && (
              <p className="field__hint">
                {ativa.usageCount === 1
                  ? "1 formulação de produto nasceu desta versão."
                  : `${ativa.usageCount} formulações de produto nasceram desta versão.`}{" "}
                Nenhuma delas muda quando este modelo muda.
              </p>
            )}
            {/* Com rascunho aberto, a bancada é do rascunho: duas receitas
                inteiras na mesma página confundem mais do que ajudam. A ativa
                não some — continua aqui, no histórico e na comparação. */}
            {rascunho && (
              <p className="field__hint">
                A receita abaixo é a do rascunho {rascunho.versionLabel}. A da{" "}
                {ativa.versionLabel} continua valendo para quem aplicar o modelo até o rascunho
                ser ativado — compare as duas em “Comparar versões”, no histórico.
              </p>
            )}
          </FormSection>
        )}

        {rascunho && (
          <FormSection
            title={`Rascunho — ${rascunho.versionLabel}`}
            subtitle="Só o rascunho é editável. Ative quando a matriz estiver pronta para ser reutilizada."
          >
            <PremissasDaForma
              idPrefixo="template"
              valores={premissas}
              onChange={(campo, valor) => {
                /* O mesmo gesto de `mudarPremissa`, escrito aqui porque o campo
                   chega tipado pela bancada — que conhece as premissas da FORMA,
                   não a perda prevista que só a matriz guarda. */
                setPremissas((atual) => ({ ...atual, [campo]: valor }));
                limparRecusaDoCampo(campo);
              }}
              editavel={editavel}
              erros={errosDeCampo}
              formasOferecidas={formasOferecidas}
              apresentacoesOferecidas={apresentacoesOferecidas}
              unidadesDeMassa={unidadesDeMassa}
              derivaDoses={derivaDoses}
              dosesDerivadas={typeof dosesDerivadas === "number" ? dosesDerivadas : null}
              testIdDasDoses="modelo-doses-derivadas"
            >
              <div className="field field--narrow">
                <label htmlFor="template-base">
                  Base da formulação
                  <Dica id="producao.template.base" />
                </label>
                <DecimalField
                  id="template-base"
                  scale={CASAS_QUANTIDADE}
                  disabled={!editavel}
                  value={base}
                  onChangeValue={setBase}
                />
              </div>
              <div className="field field--narrow">
                <label htmlFor="template-unidade">Unidade da base</label>
                {/* O modelo não tem Item de saída: a unidade da base é a
                    dimensão da própria matriz, e o catálogo inteiro vale. */}
                <select
                  id="template-unidade"
                  disabled={!editavel}
                  value={unidade}
                  onChange={(event) => setUnidade(event.target.value)}
                >
                  {unidade && !units.some((unit) => unit.code === unidade) && (
                    <option value={unidade}>{unidade}</option>
                  )}
                  {units.map((unit) => (
                    <option key={unit.code} value={unit.code}>
                      {unit.code}
                    </option>
                  ))}
                </select>
              </div>
            </PremissasDaForma>

            <PremissasDeProducao
              idPrefixo="template"
              expectedLossPercent={premissas.expectedLossPercent}
              onChange={(valor) => mudarPremissa("expectedLossPercent", valor)}
              editavel={editavel}
              erro={errosDeCampo["expectedLossPercent"]}
              rendimentoExibido={rendimentoExibido}
            />
            {erroDoCampo("expectedLossPercent")}
          </FormSection>
        )}

        {/*
          COMPOSIÇÃO e EMBALAGEM separadas, pelo TIPO REAL do Item — a mesma
          divisão da Formulação, e nunca pelo nome do cadastro: "cápsula" é
          matéria-prima num produto e embalagem em outro.

          Quando há rascunho, é ele que se edita; sem rascunho, a versão ativa
          aparece na mesma grade, só para leitura.
        */}
        {bancadaDaSecao("COMPOSICAO", editavel, receitaExibida)}
        {bancadaDaSecao("EMBALAGEM", editavel, receitaExibida)}

        <ResumoDaReceita
          dosageForm={premissasExibidas.dosageForm}
          presentationType={premissasExibidas.presentationType}
          capsulasPorDose={capsulasPorDose}
          capsulasNaEmbalagem={capsulasNaEmbalagem}
          doseAmount={premissasExibidas.doseAmount}
          doseUomCode={premissasExibidas.doseUomCode}
          packageContentAmount={premissasExibidas.packageContentAmount}
          packageContentUomCode={premissasExibidas.packageContentUomCode}
          dosesPorEmbalagem={dosesPorEmbalagem}
          resumoDaDose={resumoDaDose}
          linhasNaComposicao={linhasDaComposicao.length}
          linhasNaEmbalagem={linhasDaEmbalagem.length}
        />

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
                    <td className="is-numeric">{formatIntegerPtBr(version.usageCount)}</td>
                    <td>{formatDateTime(version.createdAt)}</td>
                    <td>
                      <div className="table__actions">
                        {/* Toda versão tem ficha — a arquivada sai marcada como histórica. */}
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          aria-label={`Ficha técnica (PDF) da ${version.versionLabel}`}
                          onClick={() => navigate(rotaDaFichaTecnica(template.id, version.id))}
                        >
                          Ficha técnica (PDF)
                        </button>
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
                      </div>
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

      {/*
        A BARRA FIXA DAS AÇÕES — a mesma estrutura visual da Formulação, com as
        ações do MODELO. "Salvar identificação" e "Arquivar" continuam no bloco
        de identificação: são ações do cadastro, não da versão que se edita.
      */}
      <StickyActionBar
        rotulo="Ações do modelo de formulação"
        inicio={
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate("/producao/templates-formulacao")}
          >
            ← Voltar
          </button>
        }
        fim={
          <>
            {rascunho ? estadoDoBloco("rascunho", rascunhoAlterado) : estadoDoBloco("versao-ativa", false)}
            {editavel && rascunho && (
              <>
                <button
                  type="button"
                  className="btn btn--secondary"
                  /* Sem alteração pendente não há o que gravar. */
                  disabled={saving || temUnidadeInvalida || !rascunhoAlterado}
                  onClick={salvarRascunho}
                >
                  {acaoEmCurso === "rascunho" ? "Salvando…" : "Salvar rascunho"}
                </button>
                <button
                  type="button"
                  className="btn btn--accent"
                  disabled={saving || rascunho.components.length === 0}
                  onClick={() =>
                    void run("ativar", () => activateFormulationTemplateVersion(rascunho.id), {
                      bloco: "versao-ativa",
                      texto: "Versão ativada.",
                    })
                  }
                >
                  {acaoEmCurso === "ativar" ? "Ativando…" : "Ativar versão"}
                </button>
              </>
            )}
            {canEdit && !rascunho && ativa && (
              <button
                type="button"
                className="btn btn--accent"
                disabled={saving}
                onClick={() => void run("nova-versao", () => createTemplateVersionFrom(ativa.id))}
              >
                {acaoEmCurso === "nova-versao" ? "Criando…" : "Criar nova versão"}
              </button>
            )}
          </>
        }
      />
    </div>
  );
}
