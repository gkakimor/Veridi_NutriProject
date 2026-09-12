import { formatQuantity } from "../../lib/quantity";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  FormulationComponentQuantityMode,
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
import { getItem, listItems } from "../../lib/items-api";
import { listUnits } from "../../lib/units-api";
import { unidadesDaDimensao } from "../../lib/uom-options";
import { useContextualCreateOrigin } from "../../lib/use-contextual-create";
import { FormSection } from "../../components/FormSection";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { TemplateDiff } from "./TemplateDiff";
import { formatDateTime } from "../../lib/dates";
import { apiErrorMessage } from "../../lib/api-errors";
import { exigirDecimal, exigirDecimalOpcional } from "../../lib/decimal-field";
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
} from "../formulations/AjustesDaQuantidade";
import type { AjustesDaQuantidade } from "../formulations/AjustesDaQuantidade";

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
 */
function linhasDaVersao(version: FormulationTemplateVersionDTO): LinhaEditavel[] {
  return version.components.map((component, index) => ({
    chave: `${component.id}-${index}`,
    itemId: component.itemId,
    quantity: component.quantity,
    unitCode: component.unitCode,
    basis: component.basis,
    supplyResponsibility: component.supplyResponsibility,
    purityPercentApplied: component.purityPercentApplied,
    overagePercent: component.overagePercent,
    quantityMode: component.quantityMode,
    applyPurityAdjustment: component.applyPurityAdjustment,
    applyOverageAdjustment: component.applyOverageAdjustment,
    notes: component.notes,
  }));
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
      .filter((linha) => linha.itemId !== "" || linha.quantity.trim() !== "")
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

function assinaturaDoRascunho(base: string, unidade: string, linhas: LinhaEditavel[]): string {
  return assinaturaDoDocumento({
    base: decimalComparavel(base),
    unidade,
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
  const [base, setBase] = useState("1");
  const [unidade, setUnidade] = useState("un");
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
        lido.current = {
          nome: result.name,
          descricao: result.description ?? "",
          base: rascunho?.basisQuantity ?? anterior.base,
          unidade: rascunho?.outputUnitCode ?? anterior.unidade,
          componentes: rascunho ? assinaturaDosComponentes(novasLinhas) : anterior.componentes,
        };
        setNome((atual) => (atual === anterior.nome ? result.name : atual));
        setDescricao((atual) =>
          atual === anterior.descricao ? (result.description ?? "") : atual,
        );
        if (rascunho) {
          setBase((atual) => (atual === anterior.base ? rascunho.basisQuantity : atual));
          setUnidade((atual) => (atual === anterior.unidade ? rascunho.outputUnitCode : atual));
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

  function trocarItem(index: number, itemId: string) {
    const item = items.find((candidato) => candidato.id === itemId);
    setLinhas((atual) =>
      atual.map((l, i) =>
        i === index
          ? // Sem Item não há dimensão: a unidade espera por ele.
            { ...l, itemId, unitCode: itemId ? unidadeParaOItem(l.unitCode, item) : "" }
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
    assinaturaDoRascunho(base, unidade, linhas) !==
      assinaturaDoRascunho(
        rascunhoDoServidor.basisQuantity,
        rascunhoDoServidor.outputUnitCode,
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
              <td>{resumoDosAjustes(ajustesDoModelo(component))}</td>
            </tr>
          ))}
          {version.components.length === 0 && (
            <tr>
              <td colSpan={5} className="table__empty">
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
                    <tr>
                      <td colSpan={6} className="table__empty">
                        Nenhum componente ainda.
                      </td>
                    </tr>
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
                            basisQuantity: exigirDecimal(base, "Base da formulação"),
                            outputUnitCode: unidade,
                            components: linhas
                              .filter((linha) => linha.itemId && linha.quantity)
                              .map(({ chave: _chave, ...resto }) => ({
                                ...resto,
                                quantity: exigirDecimal(resto.quantity, "Quantidade"),
                                // Vazio = não informado (null), nunca 0% nem 100%.
                                purityPercentApplied: exigirDecimalOpcional(
                                  resto.purityPercentApplied ?? "",
                                  "Pureza %",
                                ),
                                overagePercent: exigirDecimalOpcional(
                                  resto.overagePercent ?? "",
                                  "Overage %",
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
