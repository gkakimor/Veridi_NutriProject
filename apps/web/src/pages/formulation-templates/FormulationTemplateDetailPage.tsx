import { formatQuantity } from "../../lib/quantity";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  DosageForm,
  FormulationComponentQuantityMode,
  FormulationTemplateComponentInput,
  FormulationTemplateDTO,
  FormulationTemplateDiffDTO,
  FormulationTemplateVersionDTO,
  ItemDTO,
  PresentationType,
  UnitOfMeasureDTO,
  UpdateFormulationTemplateVersionInput,
} from "@veridi/shared";
import {
  DOSAGE_FORM_LABELS,
  FORMAS_DA_BANCADA,
  FORMULATION_CALCULATION_MODE_LABELS,
  FORMULATION_TEMPLATE_VERSION_STATUS_LABELS,
  PRESENTATION_TYPES,
  PRESENTATION_TYPE_LABELS,
  SUPPLY_RESPONSIBILITY_LABELS,
  apresentacoesDaForma,
  dosesPorEmbalagemDaApresentacao,
  baseSugeridaDaSecao,
  formaDerivaDoses,
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
import { getItem, listItems } from "../../lib/items-api";
import { listUnits } from "../../lib/units-api";
import { unidadesDaDimensao } from "../../lib/uom-options";
import { useContextualCreateOrigin } from "../../lib/use-contextual-create";
import { FormSection } from "../../components/FormSection";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { TemplateDiff } from "./TemplateDiff";
import { formatDateTime } from "../../lib/dates";
import { ApiValidationError, apiErrorMessage } from "../../lib/api-errors";
import { decimalLegivel, exigirDecimal, exigirDecimalOpcional } from "../../lib/decimal-field";
import { lerInteiroOpcional } from "../../lib/integer-input";
import { toPtBrEditText, formatIntegerPtBr } from "../../lib/numeric-ptbr";
import {
  CASAS_PERCENTUAL_TECNICO,
  CASAS_QUANTIDADE,
  OPCOES_PERCENTUAL_TECNICO,
  OPCOES_QUANTIDADE,
} from "../../lib/numeric-scales";
import { DecimalField, IntegerField, PercentField } from "../../components/NumericField";
import {
  assinaturaDoDocumento,
  decimalComparavel,
  textoComparavel,
} from "../../lib/dirty-fields";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
import { useAuth } from "../../app/AuthProvider";
import { ContextHelp, InfoHint } from "../../components/help";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";
import {
  PainelDeAjustes,
  errosDosAjustes,
  normalizarAjustes,
  resumoDosAjustes,
  useAjustesEmEdicao,
} from "../formulation-workbench/AjustesDaQuantidade";
import type { AjustesDaQuantidade } from "../formulation-workbench/AjustesDaQuantidade";
import { TableEmptyRow } from "../../components/TableEmptyRow";

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
 * Os componentes da versão, na forma que a tela edita.
 *
 * A linha carrega TUDO o que o componente é — salvar recria os componentes, e
 * o que não viesse aqui voltava ao padrão do banco: base por dose virava base
 * da fórmula, e pureza, overage e notas sumiam.
 *
 * Números no texto do campo, em português (`toPtBrEditText`): é o que os
 * campos editam e o que a pendência compara.
 */
function linhasDaVersao(version: FormulationTemplateVersionDTO): LinhaEditavel[] {
  return version.components.map((component, index) => ({
    chave: `${component.id}-${index}`,
    itemId: component.itemId,
    quantity: toPtBrEditText(component.quantity, OPCOES_QUANTIDADE),
    unitCode: component.unitCode,
    basis: component.basis,
    supplyResponsibility: component.supplyResponsibility,
    ...percentuaisEmTexto(component),
    quantityMode: component.quantityMode,
    applyPurityAdjustment: component.applyPurityAdjustment,
    applyOverageAdjustment: component.applyOverageAdjustment,
    notes: component.notes,
  }));
}

/** Pureza e overage da API no texto do campo; ausente continua ausente. */
function percentuaisEmTexto(componente: {
  purityPercentApplied: string | null;
  overagePercent: string | null;
}): { purityPercentApplied: string | null; overagePercent: string | null } {
  return {
    purityPercentApplied:
      componente.purityPercentApplied === null
        ? null
        : toPtBrEditText(componente.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO),
    overagePercent:
      componente.overagePercent === null
        ? null
        : toPtBrEditText(componente.overagePercent, OPCOES_PERCENTUAL_TECNICO),
  };
}

/**
 * A assinatura do rascunho — base, unidade e componentes numa string.
 *
 * Quantidade física, modo de cálculo, pureza, overage, unidade e notas entram
 * todos: são digitação que "Salvar rascunho" grava e que sair perde. O que a
 * tela apenas calcula — a quantidade equivalente que o painel de ajustes
 * mostra, o resumo da linha, a comparação entre versões — fica fora.
 *
 * A chave da linha não entra: é identidade de renderização e muda a cada
 * recarga. Linha em branco também — "+ Adicionar componente" sem preencher
 * nada não é trabalho a perder, e é o que o próprio salvamento já descarta.
 */
function assinaturaDosComponentes(linhas: LinhaEditavel[]): string {
  return assinaturaDoDocumento(
    linhas
      .filter((linha) => !linhaEmBranco(linha))
      .map((linha) => ({
        item: linha.itemId,
        quantidade: decimalComparavel(linha.quantity),
        unidade: linha.unitCode,
        base: linha.basis ?? null,
        fornecimento: linha.supplyResponsibility ?? null,
        modo: linha.quantityMode ?? null,
        pureza: decimalComparavel(linha.purityPercentApplied),
        overage: decimalComparavel(linha.overagePercent),
        aplicaPureza: linha.applyPurityAdjustment ?? false,
        aplicaOverage: linha.applyOverageAdjustment ?? false,
        notas: textoComparavel(linha.notes),
      })),
  );
}

/** "+ Adicionar componente" sem nada preenchido: não é trabalho, e não vai ao servidor. */
function linhaEmBranco(linha: LinhaEditavel): boolean {
  return linha.itemId === "" && linha.quantity.trim() === "";
}

/**
 * O que falta numa linha começada — `null` se ela está completa ou em branco.
 *
 * O salvar filtrava item sem quantidade e quantidade sem item: a linha ficava
 * na tela, a pendência continuava acesa e nada dizia por que ela não foi
 * gravada. Linha começada não some em silêncio — prende o salvar e diz o quê.
 */
function faltaNaLinha(linha: LinhaEditavel): "item" | "quantidade" | null {
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
interface PremissasEmEdicao {
  dosageForm: DosageForm | "";
  presentationType: PresentationType | "";
  capsulesPerDose: string;
  capsulesPerPackage: string;
  doseAmount: string;
  doseUomCode: string;
  packageContentAmount: string;
  packageContentUomCode: string;
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
  linhas: LinhaEditavel[],
): string {
  return assinaturaDoDocumento({
    base: decimalComparavel(base),
    unidade,
    premissas: assinaturaDasPremissas(premissas),
    componentes: assinaturaDosComponentes(linhas),
  });
}

/**
 * A configuração de ajustes de uma linha ou componente do Modelo, no formato
 * do painel — o mesmo da Formulação real. Pureza e overage ausentes ficam
 * vazios: nunca 0% nem 100%. Modelo antigo, sem modo gravado, é física
 * informada sem ajuste, que é o que ele sempre significou.
 */
function ajustesDoModelo(componente: {
  quantityMode?: FormulationComponentQuantityMode | undefined;
  purityPercentApplied?: string | null | undefined;
  overagePercent?: string | null | undefined;
  applyPurityAdjustment?: boolean | undefined;
  applyOverageAdjustment?: boolean | undefined;
}): AjustesDaQuantidade {
  return {
    quantityMode: componente.quantityMode ?? "PHYSICAL_DIRECT",
    purityPercentApplied: componente.purityPercentApplied ?? "",
    overagePercent: componente.overagePercent ?? "",
    applyPurityAdjustment: componente.applyPurityAdjustment ?? false,
    applyOverageAdjustment: componente.applyOverageAdjustment ?? false,
  };
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
  /** Premissas técnicas digitadas — sair para cadastrar um Item não as perde. */
  premissas: PremissasEmEdicao;
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
  /*
   * A ação em curso pelo nome, não um booleano — o mesmo desenho da Política
   * de Precificação: só o botão clicado diz "Salvando…", e todos recusam o
   * segundo clique enquanto a gravação está no ar.
   */
  const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null);
  const saving = acaoEmCurso !== null;
  /** O que a última ação gravou, no bloco que a disparou — uma frase, nunca uma pilha. */
  const [feito, setFeito] = useState<{ bloco: string; texto: string } | null>(null);
  const [linhas, setLinhas] = useState<LinhaEditavel[]>([]);
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
  /** Painel de ajustes por linha, com rascunho local — o mesmo da Formulação. */
  const ajustes = useAjustesEmEdicao();

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
        setError(err instanceof Error ? err.message : "Falha ao carregar o template"),
      );
  }, [templateId]);

  useEffect(() => load(), [load]);
  useEffect(() => {
    listItems({ pageSize: PRIMEIRA_PAGINA })
      .then((result) => setItems(result.items))
      .catch(() => setItems([]));
  }, []);
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
              l.chave === chave ? { ...l, unitCode: unidadeParaOItem(l.unitCode, item) } : l,
            ),
          );
        })
        .catch(() => undefined);
    },
  });

  /**
   * A unidade da linha quando o Item muda. A escolhida continua se o Item novo
   * é da mesma dimensão: trocar pela de estoque dele mudaria o que a quantidade
   * digitada quer dizer, e quantidade não se converte sozinha. De outra
   * dimensão, ela não pode ficar — entra a de estoque do Item novo.
   */
  function unidadeParaOItem(atual: string, item: ItemDTO | undefined): string {
    if (!item) return atual;
    const dimensao = dimensaoDoItem(item);
    const serve = units.some((unit) => unit.code === atual && unit.dimension === dimensao);
    return serve ? atual : item.unitCode;
  }

  /** A dimensão do Item é a da sua unidade de estoque, lida do catálogo — como a API compara. */
  function dimensaoDoItem(item: ItemDTO): string | undefined {
    return units.find((unit) => unit.code === item.unitCode)?.dimension;
  }

  /**
   * A linha com o item escolhido — e com o que o cadastro do Item já sabe.
   *
   * A pureza padrão do Item entra como a APLICADA desta versão do Modelo:
   * redigitar o que já está cadastrado é trabalho repetido e é divergência
   * esperando acontecer. É SNAPSHOT — salvar congela o valor na versão, e
   * alterar o cadastro do Item depois não reescreve Modelo nenhum, nem a
   * Formulação que nascer dele.
   *
   * A pureza é do ITEM: trocar o item não mantém a do anterior, e item sem
   * pureza cadastrada deixa o campo VAZIO — desconhecida nunca vira 100%.
   * Embalagem não tem pureza: pote e tampa não têm teor a corrigir.
   */
  function trocarItem(index: number, itemId: string) {
    const item = items.find((candidato) => candidato.id === itemId);
    const daComposicao = item ? secaoDoItem(item.type) === "COMPOSICAO" : false;
    /* Cápsula e pó calculam por dose, e o modo por dose também: é o que a linha nova assume. */
    const receitaPorDose =
      formaDerivaDoses(premissas.dosageForm === "" ? null : premissas.dosageForm) ||
      template?.draftVersion?.calculationMode === "PER_DOSE";
    setLinhas((atual) =>
      atual.map((l, i) =>
        i === index
          ? // Sem Item não há dimensão: a unidade espera por ele.
            {
              ...l,
              itemId,
              unitCode: itemId ? unidadeParaOItem(l.unitCode, item) : "",
              /*
               * A base da linha NOVA sai da seção do Item: embalagem conta por
               * unidade acabada, composição conta por dose quando a receita é
               * por dose. Linha que já declarou base não é tocada — matriz
               * histórica escrita sobre a base continua sobre a base.
               */
              ...(l.basis === undefined && item
                ? { basis: baseSugeridaDaSecao(secaoDoItem(item.type), receitaPorDose) }
                : {}),
              purityPercentApplied:
                itemId && daComposicao && item?.defaultPurityPercent
                  ? toPtBrEditText(item.defaultPurityPercent, OPCOES_PERCENTUAL_TECNICO)
                  : null,
            }
          : l,
      ),
    );
  }

  /**
   * O que a linha oferece e o que ela diz. Só se julga com o Item e o catálogo
   * na mão: antes disso, "não está na lista" é só "ainda não chegou". Unidade
   * gravada fora da lista — legado — aparece como está, nunca trocada em
   * silêncio, e prende o salvar até alguém escolher.
   */
  function unidadeDaLinha(linha: LinhaEditavel) {
    const item = items.find((candidato) => candidato.id === linha.itemId);
    const dimensao = item ? dimensaoDoItem(item) : undefined;
    const opcoes = dimensao ? unidadesDaDimensao(units, dimensao) : [];
    const oferecida = opcoes.some((unit) => unit.code === linha.unitCode);
    const erro =
      item && units.length > 0 && !oferecida
        ? linha.unitCode
          ? `Unidade inválida ou legada: ${linha.unitCode}. Escolha uma unidade da lista.`
          : "Escolha a unidade do componente."
        : null;
    return { item, opcoes, oferecida, erro };
  }

  /**
   * "Aplicar ajustes" no Modelo: o rascunho vira a linha, normalizado como na
   * Formulação (§52), e o painel recolhe. Gravar continua sendo "Salvar
   * rascunho" da versão.
   */
  function aplicarAjustesDoModelo(linha: LinhaEditavel) {
    const rascunhoDeAjuste = ajustes.rascunhoDe(linha.chave);
    if (!rascunhoDeAjuste) return;
    const codigo = items.find((item) => item.id === linha.itemId)?.code ?? "Componente";
    if (Object.keys(errosDosAjustes(rascunhoDeAjuste, codigo)).length > 0) return;
    const aplicado = normalizarAjustes(rascunhoDeAjuste);
    setLinhas((atual) =>
      atual.map((l) =>
        l.chave === linha.chave
          ? {
              ...l,
              quantityMode: aplicado.quantityMode,
              purityPercentApplied: aplicado.purityPercentApplied.trim() || null,
              overagePercent: aplicado.overagePercent.trim() || null,
              applyPurityAdjustment: aplicado.applyPurityAdjustment,
              applyOverageAdjustment: aplicado.applyOverageAdjustment,
            }
          : l,
      ),
    );
    ajustes.fechar(linha.chave);
  }

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
    } finally {
      setAcaoEmCurso(null);
    }
  }

  /*
   * Três pendências convivem nesta tela, e a guarda soma as três.
   *
   * Identificação e rascunho gravam separado, cada um com o seu botão: salvar
   * o nome não absolve o componente meio digitado, e salvar o rascunho não
   * absolve o nome trocado. A terceira é o painel de ajustes aberto e ainda
   * não aplicado — a mesma pendência que já prende "Salvar rascunho", contada
   * pela MESMA comparação, para que não divirjam no primeiro campo novo.
   *
   * Nada do que a tela calcula entra: quantidade equivalente, resumo da linha
   * e comparação entre versões são resultado do que já está ali.
   */
  const rascunhoDoServidor = template?.draftVersion ?? null;
  const ajustePendente = linhas.some((linha) =>
    ajustes.alterado(linha.chave, ajustesDoModelo(linha)),
  );
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
    isDirty: identificacaoAlterada || rascunhoAlterado || ajustePendente,
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

  /*
   * PREMISSAS TÉCNICAS DA MATRIZ — a mesma leitura da Formulação.
   *
   * As formas que o seletor oferece são pó e cápsula, o que a Veridi produz.
   * Um Modelo gravado com outra forma — ou com forma nenhuma, que é todo Modelo
   * anterior a esta bancada — continua legível: a opção dele fica na lista
   * ENQUANTO for a dele, porque tirar a opção de um valor gravado faria o
   * seletor cair no traço e apagar a premissa no primeiro salvamento.
   */
  const forma = premissas.dosageForm;
  const formasOferecidas =
    forma === "" || FORMAS_DA_BANCADA.includes(forma)
      ? FORMAS_DA_BANCADA
      : [...FORMAS_DA_BANCADA, forma];
  const apresentacoesOferecidas = apresentacoesDaForma(
    forma === "" ? null : forma,
    premissas.presentationType === "" ? null : premissas.presentationType,
    PRESENTATION_TYPES,
  );
  /* Dose e conteúdo do pó são massa: o seletor só oferece unidade de massa. */
  const unidadesDeMassa = units.filter((unit) => unit.dimension === "MASS");
  const leituraDasCapsulasPorDose = lerInteiroOpcional(premissas.capsulesPerDose);
  const leituraDasCapsulasPorEmbalagem = lerInteiroOpcional(premissas.capsulesPerPackage);
  const premissasDaTela = {
    dosageForm: forma === "" ? null : forma,
    capsulesPerDose:
      forma === "CAPSULE" && leituraDasCapsulasPorDose.tipo === "valido"
        ? leituraDasCapsulasPorDose.valor
        : null,
    capsulesPerPackage:
      leituraDasCapsulasPorEmbalagem.tipo === "valido"
        ? leituraDasCapsulasPorEmbalagem.valor
        : null,
    doseAmount: decimalLegivel(premissas.doseAmount, OPCOES_QUANTIDADE),
    doseUomCode: premissas.doseUomCode || null,
    packageContentAmount: decimalLegivel(premissas.packageContentAmount, OPCOES_QUANTIDADE),
    packageContentUomCode: premissas.packageContentUomCode || null,
  };
  /*
   * Doses por embalagem é RESULTADO nas duas formas da bancada — a tela mostra
   * o número em vez de pedi-lo de novo, pela MESMA função que a API usa.
   * Divisão que não fecha vira recusa no campo, nunca doses arredondadas.
   */
  const derivaDoses = formaDerivaDoses(premissasDaTela.dosageForm);
  const dosesDerivadas = derivaDoses
    ? dosesPorEmbalagemDaApresentacao(
        premissasDaTela,
        units.map((unit) => ({
          code: unit.code,
          dimension: unit.dimension,
          toBaseFactor: unit.toBaseFactor,
        })),
      )
    : null;

  /** Altera uma premissa e limpa a recusa que o servidor tinha pendurado nela. */
  function mudarPremissa<K extends keyof PremissasEmEdicao>(
    campo: K,
    valor: PremissasEmEdicao[K],
  ) {
    setPremissas((atual) => ({ ...atual, [campo]: valor }));
    setErrosDeCampo((atual) => {
      if (!(campo in atual)) return atual;
      const { [campo]: _removido, ...resto } = atual;
      return resto;
    });
  }

  /** O campo com recusa do servidor: `aria-invalid` e a mensagem, ligados. */
  function acusarCampo(campo: string) {
    return errosDeCampo[campo]
      ? ({ "aria-invalid": true, "aria-describedby": `template-${campo}-error` } as const)
      : {};
  }

  function erroDoCampo(campo: string) {
    return errosDeCampo[campo] ? (
      <p className="field__error" id={`template-${campo}-error`}>
        {errosDeCampo[campo]}
      </p>
    ) : null;
  }
  const temUnidadeInvalida = linhas.some((linha) => unidadeDaLinha(linha).erro !== null);

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
            <th>Ajustes da quantidade</th>
          </tr>
        </thead>
        <tbody>
          {version.components.map((component) => (
            <tr key={component.id}>
              <td>
                {component.itemCode} — {component.itemName}
              </td>
              <td className="is-numeric">{formatQuantity(component.quantity)}</td>
              <td>{component.unitCode}</td>
              <td>{SUPPLY_RESPONSIBILITY_LABELS[component.supplyResponsibility]}</td>
              <td>
                {resumoDosAjustes(ajustesDoModelo({ ...component, ...percentuaisEmTexto(component) }))}
              </td>
            </tr>
          ))}
          {version.components.length === 0 && (
            <TableEmptyRow colSpan={5}>
              Sem componentes.
            </TableEmptyRow>
          )}
        </tbody>
      </table>
    </div>
  );

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

        {ativa && (
          <FormSection
            title={`Versão ativa — ${ativa.versionLabel}`}
            subtitle={`Base ${formatQuantity(ativa.basisQuantity)} ${ativa.outputUnitCode} · ${FORMULATION_CALCULATION_MODE_LABELS[ativa.calculationMode]} · ${ativa.components.length} componentes. Versão ativa é histórica: para alterar, crie uma nova versão.`}
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
                      void run("nova-versao", () => createTemplateVersionFrom(ativa.id))
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
            subtitle="Só o rascunho é editável. Ative quando a matriz estiver pronta para ser reutilizada."
          >
            <div className="field-grid-2">
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
            </div>

            {/*
              PREMISSAS TECNICAS DA MATRIZ — a receita, nao o comercio.
              Forma e apresentacao sao coisas diferentes: a forma e capsula ou
              po, o que a bancada calcula por dose; a apresentacao e a embalagem
              em que o produto sai. As duas viajam para a Formulacao como
              DEFAULT quando o Modelo e aplicado, e la continuam editaveis.
            */}
            <div className="form-premissas">
              <div className="field field--narrow">
                <label htmlFor="template-dosageForm">
                  Forma do produto <Dica id="formulacao.forma" />
                </label>
                <select
                  id="template-dosageForm"
                  disabled={!editavel}
                  value={premissas.dosageForm}
                  onChange={(event) =>
                    mudarPremissa("dosageForm", event.target.value as DosageForm | "")
                  }
                  {...acusarCampo("dosageForm")}
                >
                  <option value="">—</option>
                  {formasOferecidas.map((opcao) => (
                    <option key={opcao} value={opcao}>
                      {DOSAGE_FORM_LABELS[opcao]}
                    </option>
                  ))}
                </select>
                {erroDoCampo("dosageForm")}
              </div>

              <div className="field field--narrow">
                <label htmlFor="template-presentationType">
                  Apresentação comercial <Dica id="formulacao.apresentacaoComercial" />
                </label>
                <select
                  id="template-presentationType"
                  disabled={!editavel}
                  value={premissas.presentationType}
                  onChange={(event) =>
                    mudarPremissa("presentationType", event.target.value as PresentationType | "")
                  }
                >
                  <option value="">—</option>
                  {apresentacoesOferecidas.map((tipo) => (
                    <option key={tipo} value={tipo}>
                      {PRESENTATION_TYPE_LABELS[tipo]}
                    </option>
                  ))}
                </select>
              </div>

              {forma === "CAPSULE" && (
                <>
                  <div className="field field--narrow">
                    <label htmlFor="template-capsulesPerDose">
                      Cápsulas por dose <Dica id="formulacao.capsulasPorDose" />
                    </label>
                    <IntegerField
                      id="template-capsulesPerDose"
                      disabled={!editavel}
                      value={premissas.capsulesPerDose}
                      onChangeValue={(valor) => mudarPremissa("capsulesPerDose", valor)}
                      {...acusarCampo("capsulesPerDose")}
                    />
                    {erroDoCampo("capsulesPerDose")}
                  </div>

                  <div className="field field--narrow">
                    <label htmlFor="template-capsulesPerPackage">
                      Cápsulas por embalagem <Dica id="formulacao.capsulasPorEmbalagem" />
                    </label>
                    <IntegerField
                      id="template-capsulesPerPackage"
                      disabled={!editavel}
                      value={premissas.capsulesPerPackage}
                      onChangeValue={(valor) => mudarPremissa("capsulesPerPackage", valor)}
                      {...acusarCampo("capsulesPerPackage")}
                    />
                    {erroDoCampo("capsulesPerPackage")}
                  </div>
                </>
              )}

              {forma === "POWDER" && (
                <>
                  <div className="field field--narrow">
                    <label htmlFor="template-doseAmount">
                      Dose <Dica id="formulacao.dose" />
                    </label>
                    <div className="quantidade-unidade">
                      <DecimalField
                        id="template-doseAmount"
                        scale={CASAS_QUANTIDADE}
                        placeholder="0"
                        disabled={!editavel}
                        value={premissas.doseAmount}
                        onChangeValue={(valor) => mudarPremissa("doseAmount", valor)}
                        {...acusarCampo("doseAmount")}
                      />
                      <select
                        id="template-doseUomCode"
                        aria-label="Unidade da dose"
                        disabled={!editavel}
                        value={premissas.doseUomCode}
                        onChange={(event) => mudarPremissa("doseUomCode", event.target.value)}
                        {...acusarCampo("doseUomCode")}
                      >
                        <option value="">—</option>
                        {unidadesDeMassa.map((unit) => (
                          <option key={unit.code} value={unit.code}>
                            {unit.code}
                          </option>
                        ))}
                      </select>
                    </div>
                    {erroDoCampo("doseAmount")}
                    {erroDoCampo("doseUomCode")}
                  </div>

                  <div className="field field--narrow">
                    <label htmlFor="template-packageContentAmount">
                      Conteúdo da embalagem <Dica id="formulacao.conteudo" />
                    </label>
                    <div className="quantidade-unidade">
                      <DecimalField
                        id="template-packageContentAmount"
                        scale={CASAS_QUANTIDADE}
                        placeholder="0"
                        disabled={!editavel}
                        value={premissas.packageContentAmount}
                        onChangeValue={(valor) => mudarPremissa("packageContentAmount", valor)}
                        {...acusarCampo("packageContentAmount")}
                      />
                      <select
                        id="template-packageContentUomCode"
                        aria-label="Unidade do conteúdo da embalagem"
                        disabled={!editavel}
                        value={premissas.packageContentUomCode}
                        onChange={(event) =>
                          mudarPremissa("packageContentUomCode", event.target.value)
                        }
                      >
                        <option value="">—</option>
                        {unidadesDeMassa.map((unit) => (
                          <option key={unit.code} value={unit.code}>
                            {unit.code}
                          </option>
                        ))}
                      </select>
                    </div>
                    {erroDoCampo("packageContentAmount")}
                  </div>
                </>
              )}

              {derivaDoses && (
                <div className="field field--narrow field--calculado">
                  <span className="field__label-static">
                    Doses por embalagem <Dica id="formulacao.dosesPorEmbalagem" />
                  </span>
                  {/* Resultado, nunca segundo campo: dois numeros para a mesma
                      premissa divergem no primeiro que alguem esquecer. */}
                  <p
                    className="field-readonly-value field-readonly-value--calculado"
                    data-testid="modelo-doses-derivadas"
                  >
                    {typeof dosesDerivadas === "number" ? formatIntegerPtBr(dosesDerivadas) : "—"}
                  </p>
                </div>
              )}
            </div>

            {/*
              PREMISSAS DE PRODUCAO — a perda prevista da matriz.
              Bloco proprio: a apresentacao descreve o que se vende, esta linha
              descreve o processo. Vazio e NAO INFORMADA, nunca 0%.
            */}
            <div className="premissas-producao">
              <span className="premissas-producao__titulo">Premissas de produção</span>
              <div className="premissas-producao__campos">
                <div className="field field--narrow">
                  <label htmlFor="template-expectedLoss">
                    Perda prevista de produção (%) <Dica id="formulacao.perdaPrevista" />
                  </label>
                  <PercentField
                    id="template-expectedLoss"
                    scale={CASAS_PERCENTUAL_TECNICO}
                    placeholder="—"
                    /* 100% de perda nao tem quantidade bruta: a seta para em 99. */
                    stepper={{ min: "0", max: "99", nome: "Perda prevista de produção" }}
                    disabled={!editavel}
                    value={premissas.expectedLossPercent}
                    onChangeValue={(valor) => mudarPremissa("expectedLossPercent", valor)}
                    {...acusarCampo("expectedLossPercent")}
                  />
                  {erroDoCampo("expectedLossPercent")}
                </div>
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
                    <th>Ajustes da quantidade</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((linha, index) => {
                    const daLinha = unidadeDaLinha(linha);
                    const erroDaUnidade = `template-unidade-erro-${linha.chave}`;
                    const configuracao = ajustesDoModelo(linha);
                    const abertoAjuste = ajustes.aberto(linha.chave);
                    const falta = conferirLinhas ? faltaNaLinha(linha) : null;
                    const erroDaLinha = `template-linha-erro-${linha.chave}`;
                    const acusarFalta = { "aria-invalid": true, "aria-describedby": erroDaLinha } as const;
                    return (
                      <Fragment key={linha.chave}>
                      <tr>
                        <td>
                          <SearchableEntitySelect
                            id={`template-item-${linha.chave}`}
                            value={linha.itemId}
                            onChange={(itemId) => trocarItem(index, itemId)}
                            placeholder="Digite código ou nome do item…"
                            /* Era o único campo do rascunho sem o `disabled` dos
                               vizinhos: quem não edita trocava o item na tela e
                               só descobria a recusa ao salvar. */
                            disabled={!editavel}
                            options={items.map(opcaoDoItem)}
                            onSearch={buscarItens}
                            canCreate={editavel}
                            {...(falta === "item" ? acusarFalta : {})}
                            createLabel="Novo item de estoque"
                            /* Sair para cadastrar o item NÃO é descartar: o
                               rascunho vai junto e volta aplicado na linha. */
                            onCreateNew={() =>
                              liberarGuarda(() =>
                                origem.goCreate({
                                  route: "/cadastros/itens/novo",
                                  fieldKey: "itemId",
                                  entityType: "item",
                                  // Qual linha pediu — o item volta para ela.
                                  context: { rowKey: linha.chave },
                                }),
                              )
                            }
                          />
                          {falta === "item" && (
                            <p className="field__error" id={erroDaLinha}>
                              {MENSAGEM_DA_FALTA.item}
                            </p>
                          )}
                        </td>
                        <td className="is-numeric">
                          <DecimalField
                            id={`template-quantidade-${linha.chave}`}
                            scale={CASAS_QUANTIDADE}
                            disabled={!editavel}
                            value={linha.quantity}
                            onChangeValue={(quantity) =>
                              setLinhas((atual) =>
                                atual.map((l, i) => (i === index ? { ...l, quantity } : l)),
                              )
                            }
                            {...(falta === "quantidade" ? acusarFalta : {})}
                          />
                          {falta === "quantidade" && (
                            <p className="field__error" id={erroDaLinha}>
                              {MENSAGEM_DA_FALTA.quantidade}
                            </p>
                          )}
                        </td>
                        <td>
                          {/* Mesma lista da Formulação: o catálogo, na dimensão do
                              Item. Sem Item, não há dimensão — e não há unidade. */}
                          <select
                            aria-label={daLinha.item ? `Unidade de ${daLinha.item.code}` : "Unidade"}
                            disabled={!editavel || !daLinha.item}
                            value={linha.unitCode}
                            onChange={(event) =>
                              setLinhas((atual) =>
                                atual.map((l, i) =>
                                  i === index ? { ...l, unitCode: event.target.value } : l,
                                ),
                              )
                            }
                            {...(daLinha.erro
                              ? { "aria-invalid": true, "aria-describedby": erroDaUnidade }
                              : {})}
                          >
                            <option value="">Selecione</option>
                            {linha.unitCode && !daLinha.oferecida && (
                              <option value={linha.unitCode} disabled={Boolean(daLinha.item)}>
                                {linha.unitCode}
                              </option>
                            )}
                            {daLinha.opcoes.map((unit) => (
                              <option key={unit.code} value={unit.code}>
                                {unit.code}
                              </option>
                            ))}
                          </select>
                          {daLinha.erro && (
                            <p className="field__error" id={erroDaUnidade}>
                              {daLinha.erro}
                            </p>
                          )}
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
                          {/* Mesmo resumo e mesmo painel da Formulação real: a
                              intenção física do componente, não só os números. */}
                          <button
                            type="button"
                            className="ajuste-quantidade__botao"
                            aria-expanded={abertoAjuste}
                            aria-controls={`modelo-ajustes-${linha.chave}`}
                            onClick={() => ajustes.alternar(linha.chave, configuracao)}
                          >
                            <span aria-hidden="true">{abertoAjuste ? "▾" : "▸"}</span>{" "}
                            {resumoDosAjustes(configuracao)}
                          </button>
                        </td>
                        <td>
                          {editavel && (
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              aria-label="Remover componente"
                              onClick={() => {
                                ajustes.fechar(linha.chave);
                                setLinhas((atual) => atual.filter((_, i) => i !== index));
                              }}
                            >
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                      {abertoAjuste && (
                        <tr className="ajuste-quantidade__linha">
                          <td colSpan={6} id={`modelo-ajustes-${linha.chave}`}>
                            {editavel ? (
                              <PainelDeAjustes
                                contexto="MODELO"
                                idBase={`modelo-${linha.chave}`}
                                idDoCampo={(campo) => `modelo-${linha.chave}-${campo}`}
                                nomeDoItem={daLinha.item?.code ?? "Componente"}
                                rascunho={ajustes.rascunhoDe(linha.chave) ?? configuracao}
                                confirmado={configuracao}
                                onChange={(proximo) => ajustes.mudar(linha.chave, proximo)}
                                onAplicar={() => aplicarAjustesDoModelo(linha)}
                                onCancelar={() => ajustes.fechar(linha.chave)}
                                avisoDePendencia={ajustes.aviso(linha.chave)}
                              />
                            ) : (
                              <p className="field__hint">{resumoDosAjustes(configuracao)}</p>
                            )}
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                  {linhas.length === 0 && (
                    <TableEmptyRow colSpan={6}>
                      Nenhum componente ainda.
                    </TableEmptyRow>
                  )}
                </tbody>
              </table>
            </div>

            {editavel && (
              <div className="form-actions form-actions--split">
                <div className="form-actions__group">
                  {/* Terciária: acrescentar componente não grava nada. */}
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() =>
                      setLinhas((atual) => [
                        ...atual,
                        {
                          chave: `nova-${atual.length}-${Date.now()}`,
                          itemId: "",
                          quantity: "",
                          // A unidade vem do Item: antes dele, não há dimensão.
                          unitCode: "",
                          supplyResponsibility: "VERIDI",
                        },
                      ])
                    }
                  >
                    + Adicionar componente
                  </button>
                </div>
                <div className="form-actions__group">
                  {estadoDoBloco("rascunho", rascunhoAlterado || ajustePendente)}
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    /* Sem alteração pendente não há o que gravar. Ajuste aberto
                       e não aplicado CONTA como pendência aqui: é o clique que
                       diz qual linha espera decisão. */
                    disabled={saving || temUnidadeInvalida || (!rascunhoAlterado && !ajustePendente)}
                    onClick={() => {
                      // Linha começada e não terminada prende o salvar, e o foco
                      // vai ao campo que falta — nada é descartado nem inventado.
                      const incompleta = linhas.find((linha) => faltaNaLinha(linha) !== null);
                      if (incompleta) {
                        const campoQueFalta =
                          faltaNaLinha(incompleta) === "item"
                            ? `template-item-${incompleta.chave}`
                            : `template-quantidade-${incompleta.chave}`;
                        setFeito(null);
                        setError(null);
                        setConferirLinhas(true);
                        requestAnimationFrame(() => document.getElementById(campoQueFalta)?.focus());
                        return;
                      }
                      setConferirLinhas(false);
                      // Ajuste aberto e não aplicado não vai junto — e não se perde
                      // em silêncio: a tela diz qual linha espera decisão.
                      const pendente = linhas.find((linha) =>
                        ajustes.alterado(linha.chave, ajustesDoModelo(linha)),
                      );
                      if (pendente) {
                        const codigo =
                          items.find((item) => item.id === pendente.itemId)?.code ?? "componente";
                        setFeito(null);
                        setError(`Aplique ou cancele os ajustes de ${codigo} antes de salvar.`);
                        ajustes.avisar(pendente.chave);
                        return;
                      }
                      void run(
                        "rascunho",
                        () =>
                          updateFormulationTemplateVersion(rascunho.id, {
                            basisQuantity: exigirDecimal(base, "Base da formulação", OPCOES_QUANTIDADE),
                            outputUnitCode: unidade,
                            /*
                             * PREMISSAS TECNICAS — vao inteiras, inclusive as
                             * vazias: `null` LIMPA a premissa, e omitir o campo
                             * deixaria o valor antigo gravado depois de a
                             * pessoa ter apagado o campo na tela.
                             *
                             * `capsulesPerPackage` e entrada: o servidor deriva
                             * as doses por embalagem dela e recusa a divisao
                             * que nao fecha, em vez de arredondar doses.
                             */
                            ...premissasParaAPI(premissas),
                            components: linhas
                              // Só a linha em branco fica de fora: a incompleta já parou acima.
                              .filter((linha) => !linhaEmBranco(linha))
                              .map(({ chave: _chave, ...resto }) => ({
                                ...resto,
                                quantity: exigirDecimal(resto.quantity, "Quantidade", OPCOES_QUANTIDADE),
                                // Vazio = não informado (null), nunca 0% nem 100%.
                                purityPercentApplied: exigirDecimalOpcional(
                                  resto.purityPercentApplied ?? "",
                                  "Pureza %",
                                  OPCOES_PERCENTUAL_TECNICO,
                                ),
                                overagePercent: exigirDecimalOpcional(
                                  resto.overagePercent ?? "",
                                  "Overage %",
                                  OPCOES_PERCENTUAL_TECNICO,
                                ),
                              })),
                          }),
                        { bloco: "rascunho", texto: "Rascunho salvo." },
                      );
                    }}
                  >
                    {acaoEmCurso === "rascunho" ? "Salvando…" : "Salvar rascunho"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--accent btn--sm"
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
                </div>
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
                    <td className="is-numeric">{formatIntegerPtBr(version.usageCount)}</td>
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
