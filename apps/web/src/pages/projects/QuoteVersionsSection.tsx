import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type {
  ProjectDTO,
  ProjectStatus,
  QuoteLineAgreementDTO,
  QuoteLineDTO,
  QuoteVersionDTO,
} from "@veridi/shared";
import {
  Decimal,
  QUOTE_STATUS_LABELS,
  QUOTE_PRICE_SOURCE_LABELS,
  buildPaymentSchedule,
  calcularTotaisOrcamento,
} from "@veridi/shared";
import {
  acceptQuoteVersion,
  addQuoteLine,
  adjustQuotePrice,
  applyQuotePricing,
  createOrderFromQuote,
  createQuoteVersion,
  duplicateQuoteVersion,
  getQuotePricingOptions,
  inheritQuotePrice,
  rejectQuoteVersion,
  removeQuoteLine,
  sendQuoteVersion,
  updateQuoteLine,
  updateQuoteVersion,
  useManualQuotePrice,
} from "../../lib/projects-api";
import type { PricingVersionDTO } from "@veridi/shared";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { EntityLink, entityHref } from "../../components/EntityLink";
import { QuoteClosingSection } from "./QuoteClosingSection";
import { FormSection } from "../../components/FormSection";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { IncompleteCostApiError, apiErrorMessage } from "../../lib/api-errors";
import { exigirDecimalOpcional } from "../../lib/decimal-field";
import { mensagemDecimalInvalido, parseDecimalInput } from "../../lib/decimal-input";
import { formatBRL, formatUnitPriceBRL } from "../../lib/currency";
import { QuoteConditionsForm } from "./QuoteConditionsForm";
import { DuplicateQuoteDialog } from "./DuplicateQuoteDialog";
import { formatQuantity } from "../../lib/quantity";

/**
 * Orçamentos do projeto.
 *
 * A negociação acontece por versão, e a proposta cobre vários produtos: uma
 * linha por produto, cada uma com a própria origem de preço. Toda versão
 * abre — inclusive as antigas —, porque conferir o que foi proposto em V1 é
 * trabalho normal de quem negocia, não arqueologia.
 *
 * Versão enviada é somente leitura: renegociar cria versão nova.
 */

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

/**
 * O preço que o reajuste produziria — PRÉVIA, não autoridade.
 *
 * Quem fecha o valor gravado é o servidor, pela fronteira comercial de quatro
 * casas. Isto existe para quem negocia ver o efeito antes de aplicar; se a
 * conta divergir por um centavo, o número certo é o que voltar da API.
 * Percentual negativo não tem prévia: ele nem é aceito.
 */
function previaDoReajuste(base: string, percentual: string | undefined): string | null {
  if (!percentual || percentual.trim() === "") return null;
  const lido = parseDecimalInput(percentual);
  if (lido === null) return null;
  const fator = Number(lido);
  if (!Number.isFinite(fator) || fator < 0) return null;
  const valor = Number(base) * (1 + fator / 100);
  if (!Number.isFinite(valor)) return null;
  return valor.toFixed(4);
}

/**
 * Faixa vigente para EXATAMENTE esta quantidade.
 *
 * Comparação numérica, não textual: "1000" e "1000.000000" são a mesma
 * quantidade e vêm do banco em formatos diferentes. O que nunca acontece é
 * casar por aproximação — faixa é acordo comercial registrado para uma
 * quantidade, e escolher a vizinha inventaria negociação.
 */
function exactTier(pricing: PricingVersionDTO | null, quantity: string | null) {
  if (!pricing || !quantity) return null;
  const alvo = Number(quantity);
  if (!Number.isFinite(alvo)) return null;
  return pricing.tiers.find((tier) => Number(tier.quantity) === alvo) ?? null;
}

function quoteBadgeClass(status: QuoteVersionDTO["status"]): string {
  if (status === "ACCEPTED") return "badge badge--active";
  if (status === "REJECTED") return "badge badge--err";
  if (status === "DRAFT") return "badge badge--warn";
  return "badge badge--neutral";
}

/**
 * Por que o envio espera: uma frase diz o que fazer, a outra o mecanismo —
 * para que "salvar antes" não pareça regra arbitrária. Condições e produtos
 * têm cada um a sua; os dois pendentes juntos ganham uma só, simples.
 */
const ESPERA_CONDICOES = {
  titulo: "Salve as alterações das condições antes de enviar o orçamento.",
  complemento: "O envio usa somente as condições já salvas.",
};
const ESPERA_PRODUTOS = {
  titulo: "Salve as alterações dos produtos antes de enviar o orçamento.",
  complemento: "O envio usa somente os valores já salvos.",
};
const ESPERA_TUDO = {
  titulo: "Salve as alterações do orçamento antes de enviar.",
  complemento: "O envio usa somente o que já está salvo.",
};

function motivoDaEspera(condicoes: boolean, produtos: boolean) {
  if (condicoes && produtos) return ESPERA_TUDO;
  if (condicoes) return ESPERA_CONDICOES;
  if (produtos) return ESPERA_PRODUTOS;
  return null;
}

/** Os campos da linha que se digitam na proposta e gravam ao sair do campo. */
type CampoDaLinha = "quotedQuantity" | "unitPrice" | "uomCode";
const CAMPOS_DA_LINHA: readonly CampoDaLinha[] = ["quotedQuantity", "unitPrice", "uomCode"];

/** Como cada campo da linha se chama na tela — o nome que o erro de leitura usa. */
const ROTULO_DO_CAMPO: Record<CampoDaLinha, string> = {
  quotedQuantity: "Quantidade",
  unitPrice: "Preço unitário",
  uomCode: "Unidade",
};

/**
 * O texto que está no campo da linha É o valor gravado? Por VALOR — `1000,0`
 * e `1000.000000000000` são a mesma quantidade —, e com `Decimal`, nunca
 * `Number` (§66). Campo vazio é ausência e só equivale a gravado ausente;
 * texto ilegível não equivale a nada. Unidade é texto, comparado sem os
 * espaços das pontas, como o salvamento grava.
 */
function digitadoIgualAoGravado(
  campo: CampoDaLinha,
  digitado: string,
  gravado: string | null,
): boolean {
  if (campo === "uomCode") return (digitado.trim() || null) === gravado;
  const legivel = parseDecimalInput(digitado);
  if (legivel === null) return gravado === null && digitado.trim() === "";
  return gravado !== null && new Decimal(legivel).equals(new Decimal(gravado));
}

export function QuoteVersionsSection({
  project,
  canEdit,
  projectStatus,
  onChanged,
}: {
  project: ProjectDTO;
  canEdit: boolean;
  /** Só para explicar por que a ação sumiu — nunca para liberar a ação. */
  projectStatus?: ProjectStatus;
  onChanged: () => void;
}) {
  /*
   * Projeto APROVADO recebe negociação nova; cancelado, não.
   *
   * Aprovado significa que o desenvolvimento inicial foi aprovado — não que a
   * relação com o cliente acabou. Quem comprou em janeiro e volta em março
   * negocia no mesmo projeto, com os mesmos produtos. Cancelado continua
   * fechado, e a explicação toma o lugar do botão: ação impossível não deve
   * ser oferecida, e a recusa depois do clique chegava no fim de um caminho em
   * que a pessoa já tinha conferido custo e preço.
   */
  const projectOpen = projectStatus !== "CANCELLED";
  const versions = project.quoteVersions;
  const draft = versions.find((quote) => quote.status === "DRAFT") ?? null;

  /*
   * Quem volta da simulação de CMV volta para a versão de onde saiu — e para
   * a linha de onde saiu. Sem isso, "voltar ao orçamento" devolveria a
   * pessoa ao rascunho corrente, que pode não ser a versão que ela estava
   * lendo, e a busca recomeçaria do zero.
   */
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returningToQuoteId = params.get("quoteVersionId");
  const returningToLineId = params.get("quoteLineId");

  const [openId, setOpenId] = useState<string | null>(
    returningToQuoteId ?? draft?.id ?? versions.at(-1)?.id ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Condição comercial alterada e ainda não salva, dita pelo formulário de
   * condições — a mesma pendência de "Alterações não salvas", nunca uma
   * segunda comparação. Enviar congela o que está GRAVADO: com pendência, a
   * tela mostraria uma condição e o cliente receberia outra
   * (QUOTE-SEND-DIRTY-01). O estado desenha o botão; a ref é o que o envio
   * confere no instante do clique, seja qual for o render que criou o handler.
   */
  const [condicoesPendentes, setCondicoesPendentes] = useState(false);
  const condicoesPendentesRef = useRef(false);
  const reportarCondicoes = useCallback((pendente: boolean) => {
    condicoesPendentesRef.current = pendente;
    setCondicoesPendentes(pendente);
  }, []);
  const [addProductId, setAddProductId] = useState("");
  const [sendConfirm, setSendConfirm] = useState<{
    quote: QuoteVersionDTO;
    /** Vazio quando a proposta não tem custo incompleto a declarar. */
    lines: QuoteLineDTO[];
    incompleteCost: boolean;
  } | null>(null);
  const [pricingLineId, setPricingLineId] = useState<string | null>(null);
  /** A versão escolhida para "Duplicar como nova versão" — QUOTE-DUPLICATE-01. */
  const [duplicando, setDuplicando] = useState<QuoteVersionDTO | null>(null);
  const [pricingOptions, setPricingOptions] = useState<PricingVersionDTO | null>(null);
  /** Precificação ativa por linha — consultada, nunca aplicada sozinha. */
  const [tierByLine, setTierByLine] = useState<Record<string, PricingVersionDTO | null>>({});
  /** A condição comercial anterior de cada linha — `null` é primeira compra. */
  const [acordoPorLinha, setAcordoPorLinha] = useState<Record<string, QuoteLineAgreementDTO | null>>(
    {},
  );
  /** Percentual digitado no campo de reajuste, por linha. */
  const [reajustePorLinha, setReajustePorLinha] = useState<Record<string, string>>({});
  /**
   * A exceção que o servidor recusou por falta de motivo, e o motivo sendo
   * escrito. A tela não decide quando o motivo é necessário: ela pergunta
   * depois que o domínio disse que é.
   */
  const [excecao, setExcecao] = useState<
    { lineId: string; tipo: "MANTER" | "REAJUSTAR"; sourceQuoteLineId: string; percentual?: string; aviso: string; motivo: string } | null
  >(null);
  /*
   * O que está sendo digitado nas linhas, antes de gravar.
   *
   * Os campos eram não-controlados e só salvavam ao perder o foco: enquanto
   * a pessoa trocava a quantidade, o total da linha e o "Total da proposta"
   * continuavam mostrando a conta do salvamento ANTERIOR — número velho
   * apresentado como consequência dos campos atuais. Guardar o texto aqui
   * permite recalcular a prévia com a mesma função que a API usa, sem gravar
   * nada e sem tirar o foco de quem digita. A unidade entrou aqui também: é
   * o que deixa a tela saber que o que está no campo ainda não é o gravado
   * (QUOTE-SEND-LINE-DRAFT-01).
   */
  const [rascunhoDeLinha, setRascunhoDeLinha] = useState<
    Record<string, Partial<Record<CampoDaLinha, string>>>
  >({});

  /*
   * Abre a versão pedida — e só escolhe sozinho quando ninguém pediu nada.
   *
   * Antes o efeito voltava para a última versão sempre que o id aberto não
   * estava na lista. Criar a V2 caía exatamente nesse buraco: o id novo era
   * selecionado, a lista ainda era a antiga por um render, e a tela voltava
   * para a V1 enviada — parecendo que a nova versão nasceu bloqueada.
   */
  useEffect(() => {
    if (openId !== null) return;
    setOpenId(draft?.id ?? versions.at(-1)?.id ?? null);
  }, [versions, draft, openId]);

  const open = versions.find((quote) => quote.id === openId) ?? null;
  const editable = canEdit && projectOpen && open?.status === "DRAFT";

  // Voltar do CMV traz a linha de volta ao campo de visão — a versão pode ter
  // muitas linhas, e "está aberta" não é o mesmo que "está visível".
  useEffect(() => {
    if (!returningToLineId) return;
    document.getElementById(`quote-line-${returningToLineId}`)?.scrollIntoView({ block: "center" });
  }, [returningToLineId, openId]);

  /*
   * Consulta a precificação vigente de cada linha assim que produto e
   * quantidade existem. É CONSULTA: o preço da linha continua sendo o que
   * alguém decidiu, e nada aqui escreve `unitPrice`.
   */
  const linesSignature = (open?.lines ?? [])
    .map((line) => `${line.id}:${line.quotedQuantity ?? ""}`)
    .join("|");
  useEffect(() => {
    if (!open || open.status !== "DRAFT") {
      setTierByLine({});
      setAcordoPorLinha({});
      return;
    }
    let active = true;
    /*
     * Todas as linhas, não só as que já têm quantidade: a CONDIÇÃO ANTERIOR
     * existe mesmo antes de alguém digitar a quantidade, e é ela que responde
     * "quanto foi acordado da última vez".
     */
    void Promise.all(
      open.lines.map(async (line) => {
        // Sem precificação ativa (ou sem permissão) a resposta é ausência de
        // opção, não erro técnico.
        const options = await getQuotePricingOptions(line.id).catch(() => null);
        return [line.id, options] as const;
      }),
    ).then((pares) => {
      if (!active) return;
      setTierByLine(Object.fromEntries(pares.map(([id, o]) => [id, o?.pricing ?? null])));
      setAcordoPorLinha(Object.fromEntries(pares.map(([id, o]) => [id, o?.agreement ?? null])));
    });
    return () => {
      active = false;
    };
    // `linesSignature` cobre produto+quantidade de cada linha: mudar a
    // quantidade reconsulta, digitar em outro campo não.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.id, open?.status, linesSignature]);

  /*
   * Campo da linha como está NA TELA agora: o que foi digitado, quando há
   * digitação em curso; senão, o que está gravado. Texto ilegível (ou vazio)
   * vira `null` — ausência não é zero, e um total falso é pior que nenhum.
   */
  function campoDaLinha(
    line: QuoteLineDTO,
    campo: "quotedQuantity" | "unitPrice",
  ): string | null {
    const digitado = rascunhoDeLinha[line.id]?.[campo];
    if (digitado === undefined) return line[campo];
    return parseDecimalInput(digitado);
  }

  /** `true` quando o texto digitado existe e não dá para ler como número. */
  function campoIlegivel(line: QuoteLineDTO, campo: "quotedQuantity" | "unitPrice"): boolean {
    const digitado = rascunhoDeLinha[line.id]?.[campo];
    return digitado !== undefined && digitado.trim() !== "" && parseDecimalInput(digitado) === null;
  }

  function digitarNaLinha(lineId: string, campo: CampoDaLinha, valor: string) {
    setRascunhoDeLinha((atual) => ({
      ...atual,
      [lineId]: { ...atual[lineId], [campo]: valor },
    }));
  }

  function descartarRascunhoDoCampo(lineId: string, campo: CampoDaLinha) {
    setRascunhoDeLinha((atual) => {
      if (atual[lineId]?.[campo] === undefined) return atual;
      const daLinha = { ...atual[lineId] };
      delete daLinha[campo];
      const proximo = { ...atual };
      if (Object.keys(daLinha).length > 0) proximo[lineId] = daLinha;
      else delete proximo[lineId];
      return proximo;
    });
  }

  /*
   * Sair do campo grava — mas só o que MUDOU (QUOTE-LINE-NOOP-BLUR-01).
   * Gravar o mesmo valor não era inofensivo: o servidor tratava a presença da
   * quantidade no pedido como mudança e soltava o preço herdado da linha, e um
   * Tab por cima do campo desfazia a decisão "manter condição". Igual ao
   * gravado — pelo mesmo critério que decide a pendência do envio —, nada sai
   * para o servidor, e o campo volta a mostrar o gravado.
   *
   * Campo em branco apaga o valor: ausência é resposta legítima. Só o que foi
   * digitado precisa ser legível.
   */
  function sairDoCampoDaLinha(line: QuoteLineDTO, campo: CampoDaLinha, texto: string) {
    if (digitadoIgualAoGravado(campo, texto, line[campo])) {
      descartarRascunhoDoCampo(line.id, campo);
      return;
    }
    void run(() => {
      const valor =
        campo === "uomCode"
          ? texto.trim() || null
          : exigirDecimalOpcional(texto, `${ROTULO_DO_CAMPO[campo]} de ${line.productCode}`);
      return updateQuoteLine(line.id, { [campo]: valor } as Parameters<typeof updateQuoteLine>[1]);
    });
  }

  /*
   * O rascunho de tela some quando o gravado o alcança.
   *
   * Salvar é assíncrono e a recarga da proposta vem depois: limpar o texto
   * digitado assim que o PATCH volta faria o campo piscar o valor antigo até
   * o servidor responder. Aqui o campo sai do rascunho só quando o valor
   * gravado É o que foi digitado — e continua na tela, com o erro, quando o
   * salvamento falha.
   */
  const linhasGravadas = (open?.lines ?? [])
    .map(
      (line) =>
        `${line.id}:${line.quotedQuantity ?? ""}:${line.unitPrice ?? ""}:${line.uomCode ?? ""}`,
    )
    .join("|");
  useEffect(() => {
    setRascunhoDeLinha((atual) => {
      const proximo: typeof atual = {};
      let mudou = false;
      for (const [lineId, campos] of Object.entries(atual)) {
        const line = (open?.lines ?? []).find((row) => row.id === lineId);
        if (!line) {
          mudou = true;
          continue;
        }
        const restante: Partial<Record<CampoDaLinha, string>> = {};
        for (const campo of CAMPOS_DA_LINHA) {
          const digitado = campos[campo];
          if (digitado === undefined) continue;
          if (digitadoIgualAoGravado(campo, digitado, line[campo])) {
            mudou = true;
            continue;
          }
          restante[campo] = digitado;
        }
        if (Object.keys(restante).length > 0) proximo[lineId] = restante;
      }
      return mudou ? proximo : atual;
    });
    // `linhasGravadas` cobre quantidade, preço e unidade de cada linha da versão aberta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.id, linhasGravadas]);

  // Trocar de versão descarta qualquer digitação pendente da anterior.
  useEffect(() => {
    setRascunhoDeLinha({});
  }, [openId]);

  /*
   * Linhas cujo valor NA TELA ainda não é o gravado: digitado e não salvo, em
   * salvamento, ou salvamento que falhou e deixou o digitado no campo. Por
   * valor, não por foco — o campo focado com o valor gravado não está
   * pendente. É a mesma pergunta que o rodapé e o envio fazem: enviar congela
   * o gravado, e com linha pendente a tela mostraria um preço e o cliente
   * receberia outro (QUOTE-SEND-LINE-DRAFT-01).
   */
  const linhasPendentes = (open?.lines ?? []).filter((line) =>
    CAMPOS_DA_LINHA.some((campo) => {
      const digitado = rascunhoDeLinha[line.id]?.[campo];
      return digitado !== undefined && !digitadoIgualAoGravado(campo, digitado, line[campo]);
    }),
  );
  /** Por que o envio espera agora — `null` quando nada espera. */
  const motivo = motivoDaEspera(condicoesPendentes, linhasPendentes.length > 0);

  async function run(action: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, "Falha na operação"));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Aplica a decisão e, se o servidor pedir motivo, ABRE a confirmação.
   *
   * Quem decide se a exceção precisa ser justificada é o domínio — quantidade
   * diferente ou condição vencida. A tela não repete essa regra: ela tenta,
   * e quando o servidor recusa por falta de motivo, pergunta com a frase que
   * o próprio servidor mandou. Duplicar a condição aqui daria duas respostas
   * para a mesma pergunta, e uma delas ficaria desatualizada.
   */
  async function aplicarComExcecao(
    pendente: {
      lineId: string;
      tipo: "MANTER" | "REAJUSTAR";
      sourceQuoteLineId: string;
      percentual?: string;
    },
    motivo?: string,
  ) {
    setSaving(true);
    setError(null);
    try {
      if (pendente.tipo === "MANTER") {
        await inheritQuotePrice(pendente.lineId, {
          sourceQuoteLineId: pendente.sourceQuoteLineId,
          ...(motivo ? { reason: motivo } : {}),
        });
      } else {
        await adjustQuotePrice(pendente.lineId, {
          sourceQuoteLineId: pendente.sourceQuoteLineId,
          adjustmentPercent: pendente.percentual ?? "",
          ...(motivo ? { reason: motivo } : {}),
        });
      }
      setExcecao(null);
      onChanged();
    } catch (err) {
      const mensagem = apiErrorMessage(err, "Falha na operação");
      if (mensagem.includes("Informe o motivo")) {
        setExcecao({ ...pendente, aviso: mensagem, motivo: motivo ?? "" });
      } else {
        setError(mensagem);
      }
    } finally {
      setSaving(false);
    }
  }

  async function manterCondicao(lineId: string, acordo: QuoteLineAgreementDTO) {
    await aplicarComExcecao({
      lineId,
      tipo: "MANTER",
      sourceQuoteLineId: acordo.sourceQuoteLineId,
    });
  }

  async function reajustarCondicao(
    lineId: string,
    acordo: QuoteLineAgreementDTO,
    percentual: string,
  ) {
    await aplicarComExcecao({
      lineId,
      tipo: "REAJUSTAR",
      sourceQuoteLineId: acordo.sourceQuoteLineId,
      percentual: parseDecimalInput(percentual) ?? percentual,
    });
  }

  async function confirmarExcecao() {
    if (!excecao) return;
    await aplicarComExcecao(excecao, excecao.motivo.trim());
  }

  /** Linhas cujo preço veio de uma faixa com custo industrial incompleto. */
  function incompleteCostLines(quote: QuoteVersionDTO): QuoteLineDTO[] {
    return quote.lines.filter(
      (line) =>
        line.pricing?.costQuality === "PARTIAL" || line.pricing?.costQuality === "NO_COST",
    );
  }

  /**
   * Confere as pendências — condições e linhas — no instante do envio, além
   * do botão desabilitado. Protege a confirmação que já estava aberta, o
   * clique que chega entre dois renders e quem um dia ligar o envio por outro
   * caminho. Bloqueia sem oferecer "enviar mesmo assim": o que se envia é o
   * que se vê.
   */
  function alteracoesImpedemEnvio(): boolean {
    const espera = motivoDaEspera(condicoesPendentesRef.current, linhasPendentes.length > 0);
    if (!espera) return false;
    setSendConfirm(null);
    setError(`${espera.titulo} ${espera.complemento}`);
    return true;
  }

  /**
   * Envio do orçamento.
   *
   * Enviar é ato comercial com data: a versão sai do rascunho, congela a
   * proveniência e vira o documento que o cliente recebe. Sempre confirma —
   * antes só o custo incompleto perguntava, e uma proposta de preço manual
   * saía no primeiro clique, sem volta.
   *
   * A proveniência da linha permite ANTECIPAR o custo incompleto e dizer
   * QUAIS linhas estão sem base. O 409 continua tratado: o backend é a
   * autoridade final sobre o que é incompleto, então uma recusa inesperada
   * reabre a confirmação já no tom certo.
   */
  function trySend(quote: QuoteVersionDTO) {
    if (alteracoesImpedemEnvio()) return;
    const incomplete = incompleteCostLines(quote);
    setSendConfirm({ quote, lines: incomplete, incompleteCost: incomplete.length > 0 });
  }

  async function confirmSend(target: {
    quote: QuoteVersionDTO;
    lines: QuoteLineDTO[];
    incompleteCost: boolean;
  }) {
    if (alteracoesImpedemEnvio()) return;
    setSaving(true);
    setError(null);
    try {
      await sendQuoteVersion(
        target.quote.id,
        target.incompleteCost ? { confirmIncompleteCost: true } : {},
      );
      onChanged();
    } catch (err) {
      if (err instanceof IncompleteCostApiError) {
        // O servidor viu um custo incompleto que a tela não antecipou.
        setSendConfirm({ quote: target.quote, lines: [], incompleteCost: true });
        return;
      }
      setError(apiErrorMessage(err, "Falha na operação"));
    } finally {
      setSaving(false);
    }
  }

  async function openPricing(line: QuoteLineDTO) {
    setPricingLineId(line.id);
    setPricingOptions(null);
    setError(null);
    try {
      setPricingOptions((await getQuotePricingOptions(line.id)).pricing);
    } catch {
      // Sem precificação ativa para o produto: a mensagem é a ausência de
      // opções, não um erro técnico.
      setPricingOptions(null);
    }
  }

  const linkedProducts = project.products;
  const usedProductIds = new Set((open?.lines ?? []).map((line) => line.productId));
  const availableProducts = linkedProducts.filter((link) => !usedProductIds.has(link.productId));
  const missingPrice = (open?.lines ?? []).some((line) => line.unitPrice === null);

  /*
   * A proposta como está NA TELA — total de linha, subtotal e total.
   *
   * `calcularTotaisOrcamento` e `buildPaymentSchedule` são as MESMAS funções
   * que a API usa para montar o documento; o desconto e as condições entram
   * como estão gravados (mudá-los é o formulário de condições, que tem o
   * próprio "Simular"). Nada aqui é enviado ao servidor: quem grava é o blur
   * do campo, e o servidor recalcula ao gravar.
   */
  const previaDasLinhas = calcularTotaisOrcamento(
    (open?.lines ?? []).map((line) => ({
      quotedQuantity: campoDaLinha(line, "quotedQuantity"),
      unitPrice: campoDaLinha(line, "unitPrice"),
    })),
  );
  const previaDoTotal =
    open && previaDasLinhas.subtotal !== null
      ? buildPaymentSchedule({
          subtotal: previaDasLinhas.subtotal,
          discountPercent: open.discountPercent,
          method: open.paymentMethod,
          downPaymentPercent: open.downPaymentPercent,
          installmentCount: open.installmentCount,
          installmentIntervalDays: open.installmentIntervalDays,
          monthlyInterestPercent: open.monthlyInterestPercent,
        }).total
      : null;
  /** Alguma linha mostra o que ainda não foi gravado — a mesma pendência que segura o envio. */
  const linhasComEdicaoPendente = linhasPendentes.length > 0;
  const alguemIlegivel = (open?.lines ?? []).some(
    (line) => campoIlegivel(line, "quotedQuantity") || campoIlegivel(line, "unitPrice"),
  );

  return (
    <FormSection
      title="Orçamentos"
      subtitle="Cada negociação é uma versão. Enviado congela o snapshot e vira histórico — que continua acessível."
    >
      {/*
        O Orçamento tem ajuda PRÓPRIA. Até aqui o único botão da ficha
        explicava o Projeto inteiro, e quem estava numa linha de proposta lia
        antes sobre produto técnico, amostra e documento — é nesta seção que
        o preço é decidido.
      */}
      <ContextHelp
        topic={helpTopics["comercial.orcamento"]}
        triggerLabel="Como funciona o Orçamento"
      />

      {error && <p className="form-alert" role="alert">{error}</p>}

      <div className="table-container">
        <table className="table table--clickable-rows">
          <thead>
            <tr>
              <th>Versão</th>
              <th>Data</th>
              <th>Produtos</th>
              {/* Lista de versões = documentos gravados. Enquanto a versão
                  aberta está sendo editada, o total dela aqui continua sendo o
                  do último salvamento — e o rotulo diz isso. */}
              <th className="is-numeric">Total salvo</th>
              <th>Validade</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {versions.length === 0 && (
              <tr>
                <td colSpan={6}>Nenhuma versão de orçamento.</td>
              </tr>
            )}
            {versions.map((quote) => (
              <tr
                key={quote.id}
                className={quote.id === openId ? "is-selected" : undefined}
                onClick={() => setOpenId(quote.id)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter") setOpenId(quote.id);
                }}
              >
                <td className="is-code">{quote.versionLabel}</td>
                <td>{formatDate(quote.quoteDate)}</td>
                <td>{quote.lines.length}</td>
                <td className="is-numeric">{quote.total ? formatBRL(quote.total) : "—"}</td>
                <td>
                  {formatDate(quote.validUntil)}
                  {/* Vencida é estado derivado, dito pelo servidor. Sem isto a
                      linha some no meio das outras e alguem tenta aceitar. */}
                  {quote.expired && <span className="badge badge--warn"> Vencido</span>}
                </td>
                <td>
                  <span className={quoteBadgeClass(quote.status)}>
                    {QUOTE_STATUS_LABELS[quote.status]}
                  </span>
                  {/* Com varias aceitas no mesmo projeto, o que diferencia uma
                      da outra e o Pedido que cada uma originou. */}
                  {quote.sourcedOrder && (
                    <span className="field__hint"> · originou {quote.sourcedOrder.code}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="line-actions">
        {canEdit && projectOpen && (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={saving}
            onClick={() =>
              void run(async () => {
                const created = await createQuoteVersion(project.id);
                setOpenId(created.id);
              })
            }
          >
            {draft
              ? "Abrir rascunho"
              : projectStatus === "APPROVED"
                ? "Novo orçamento"
                : "Criar nova versão"}
          </button>
        )}
      </div>

      {canEdit && projectOpen && projectStatus === "APPROVED" && !draft && (
        <p className="field__hint">
          Cada nova compra deste cliente é um orçamento novo, aqui mesmo — os produtos aprovados
          deste projeto continuam disponíveis, e as propostas anteriores permanecem no histórico
          com os pedidos que originaram.
        </p>
      )}

      {canEdit && !projectOpen && (
        <p className="field__hint">Projeto cancelado é histórico e não recebe proposta nova.</p>
      )}

      {open && (
        <div className="quote-workspace">
          <div className="quote-workspace__head">
            <h4>
              <span className="code">{open.versionLabel}</span>{" "}
              <span className={quoteBadgeClass(open.status)}>
                {QUOTE_STATUS_LABELS[open.status]}
              </span>
            </h4>
            {open.status !== "DRAFT" && (
              <p className="field__hint">
                Proposta apresentada é histórico: os valores são os que o cliente recebeu, não os
                de hoje. Para renegociar, crie uma nova versão.
              </p>
            )}
            {/* Partir DESTA versão, não da mais recente — QUOTE-DUPLICATE-01.
                Com outro rascunho em edição a ação fica indisponível e diz por
                quê: o projeto tem uma proposta em edição por vez. */}
            {canEdit && projectOpen && open.status !== "DRAFT" && (
              <div className="line-actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={saving || draft !== null}
                  onClick={() => setDuplicando(open)}
                >
                  Duplicar como nova versão
                </button>
                {draft && (
                  <span className="field__hint">
                    Já existe a V{draft.versionNumber} em rascunho — continue nela ou envie antes de
                    duplicar outra versão.
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="table-container">
            <table className="table table--quote-lines">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th className="is-numeric">Quantidade</th>
                  <th>Unidade</th>
                  <th>Origem do preço</th>
                  <th className="is-numeric">Preço unitário</th>
                  <th className="is-numeric">Total</th>
                  {editable && <th aria-label="Ações" />}
                </tr>
              </thead>
              <tbody>
                {open.lines.length === 0 && (
                  <tr>
                    <td colSpan={editable ? 7 : 6}>
                      Nenhum produto na proposta. Adicione ao menos um para poder enviar.
                    </td>
                  </tr>
                )}
                {open.lines.map((line, indice) => {
                  const options = tierByLine[line.id] ?? null;
                  const tier = exactTier(options, line.quotedQuantity);
                  const acordo = acordoPorLinha[line.id] ?? null;
                  /*
                   * O total da linha é o da PRÉVIA em versão editável: sai dos
                   * valores que estão nos campos agora, pela mesma função da
                   * API. Sem digitação pendente ele é idêntico ao gravado.
                   * Versão enviada/aceita é histórico e nunca recalcula.
                   */
                  const totalDaLinha = editable
                    ? (previaDasLinhas.lineTotals[indice] ?? null)
                    : line.total;
                  const cmvHref =
                    `/produtos/${line.productId}/cmv` +
                    `?quantity=${encodeURIComponent(line.quotedQuantity ?? "")}` +
                    `&projectId=${project.id}&quoteVersionId=${open.id}&quoteLineId=${line.id}`;
                  return (
                    <Fragment key={line.id}>
                  <tr
                    id={`quote-line-${line.id}`}
                    className={returningToLineId === line.id ? "is-selected" : undefined}
                  >
                    <td>
                      <EntityLink
                        kind="product"
                        id={line.productId}
                        code={line.productCode}
                        name={line.productName}
                      />
                    </td>
                    <td className="is-numeric">
                      {editable ? (
                        <>
                          <input
                            /*
                             * Campo CONTROLADO pelo rascunho de tela.
                             *
                             * Enquanto era não-controlado, o DOM guardava o que
                             * fora digitado e a tela não tinha como recalcular
                             * nada: o total da linha e o total da proposta
                             * seguiam mostrando o salvamento ANTERIOR. Agora o
                             * texto vive no componente, a prévia sai dele, e o
                             * valor gravado volta a mandar assim que o servidor
                             * confirma — inclusive quando aplicar uma faixa
                             * define quantidade, unidade e preço de uma vez.
                             */
                            type="text"
                            inputMode="decimal"
                            aria-label={`Quantidade de ${line.productCode}`}
                            aria-invalid={campoIlegivel(line, "quotedQuantity") || undefined}
                            className={
                              campoIlegivel(line, "quotedQuantity") ? "is-invalid" : undefined
                            }
                            value={
                              rascunhoDeLinha[line.id]?.quotedQuantity ?? line.quotedQuantity ?? ""
                            }
                            onChange={(event) =>
                              digitarNaLinha(line.id, "quotedQuantity", event.target.value)
                            }
                            onBlur={(event) =>
                              sairDoCampoDaLinha(line, "quotedQuantity", event.target.value)
                            }
                          />
                          {campoIlegivel(line, "quotedQuantity") && (
                            <p className="field__error">
                              {mensagemDecimalInvalido(`Quantidade de ${line.productCode}`)}
                            </p>
                          )}
                        </>
                      ) : (
                        (line.quotedQuantity ?? "—")
                      )}
                    </td>
                    <td>
                      {editable ? (
                        <input
                          /*
                           * Controlado pelo rascunho, como quantidade e preço.
                           * Não-controlado, o texto de um salvamento que falhou
                           * ficava no campo sem que a tela soubesse — e o envio
                           * congelaria a unidade gravada.
                           */
                          type="text"
                          aria-label={`Unidade de ${line.productCode}`}
                          value={rascunhoDeLinha[line.id]?.uomCode ?? line.uomCode ?? ""}
                          onChange={(event) =>
                            digitarNaLinha(line.id, "uomCode", event.target.value)
                          }
                          onBlur={(event) => sairDoCampoDaLinha(line, "uomCode", event.target.value)}
                        />
                      ) : (
                        (line.uomCode ?? "—")
                      )}
                    </td>
                    <td>
                      {QUOTE_PRICE_SOURCE_LABELS[line.priceSource]}
                      {line.pricing?.pricingCode && (
                        <div className="field__hint">
                          <span className="code">{line.pricing.pricingCode}</span>
                          {line.pricing.tierQuantity ? ` · faixa ${formatQuantity(line.pricing.tierQuantity)}` : ""}
                        </div>
                      )}
                    </td>
                    <td className="is-numeric">
                      {editable && line.priceSource === "MANUAL" ? (
                        <>
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`Preço unitário de ${line.productCode}`}
                            aria-invalid={campoIlegivel(line, "unitPrice") || undefined}
                            className={campoIlegivel(line, "unitPrice") ? "is-invalid" : undefined}
                            value={rascunhoDeLinha[line.id]?.unitPrice ?? line.unitPrice ?? ""}
                            onChange={(event) =>
                              digitarNaLinha(line.id, "unitPrice", event.target.value)
                            }
                            onBlur={(event) =>
                              sairDoCampoDaLinha(line, "unitPrice", event.target.value)
                            }
                          />
                          {campoIlegivel(line, "unitPrice") && (
                            <p className="field__error">
                              {mensagemDecimalInvalido(`Preço unitário de ${line.productCode}`)}
                            </p>
                          )}
                        </>
                      ) : line.unitPrice ? (
                        formatUnitPriceBRL(line.unitPrice)
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="is-numeric">
                      {totalDaLinha ? formatBRL(totalDaLinha) : "—"}
                    </td>
                    {editable && (
                      <td className="table__actions">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={saving}
                          onClick={() => void openPricing(line)}
                        >
                          Usar precificação
                        </button>
                        {line.priceSource !== "MANUAL" && (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={saving}
                            onClick={() => void run(() => useManualQuotePrice(line.id))}
                          >
                            Usar preço manual
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={saving}
                          onClick={() => void run(() => removeQuoteLine(line.id))}
                        >
                          Remover
                        </button>
                      </td>
                    )}
                  </tr>

                  {/* Como formar o preço: informa e OFERECE. Nada aqui escreve
                      `unitPrice` sozinho — o preço muda por decisão de quem
                      negocia, e cada decisão vira uma origem gravada. */}
                  {editable && (
                    <tr className="quote-suggestion">
                      <td colSpan={7}>
                        <p className="field__label">Como formar o preço?</p>

                        {acordo && (
                          <div className="quote-suggestion__row">
                            <span>
                              <strong>Condição acordada</strong>{" "}
                              {formatUnitPriceBRL(acordo.unitPrice)}
                              {acordo.uomCode ? ` / ${acordo.uomCode}` : ""} ·{" "}
                              <span className="code">{acordo.quoteCode}</span> · V
                              {acordo.quoteVersionNumber}
                              {acordo.quotedQuantity
                                ? ` · ${formatQuantity(acordo.quotedQuantity)} ${acordo.uomCode ?? ""}`
                                : ""}
                              {acordo.validUntil
                                ? acordo.expired
                                  ? ` · vencida em ${formatDate(acordo.validUntil)}`
                                  : ` · válida até ${formatDate(acordo.validUntil)}`
                                : ""}
                            </span>
                            <button
                              type="button"
                              className={
                                acordo.safeDefault
                                  ? "btn btn--secondary btn--sm"
                                  : "btn btn--ghost btn--sm"
                              }
                              disabled={saving}
                              onClick={() => void manterCondicao(line.id, acordo)}
                            >
                              Manter condição
                            </button>
                          </div>
                        )}

                        {/* Os dois avisos que impedem herança silenciosa. Eles
                            informam; quem decide continua sendo quem negocia. */}
                        {acordo && !acordo.sameQuantity && line.quotedQuantity && (
                          <p className="field__hint">
                            A condição anterior foi negociada para{" "}
                            {acordo.quotedQuantity
                              ? `${formatQuantity(acordo.quotedQuantity)} ${acordo.uomCode ?? ""}`
                              : "outra quantidade"}
                            . Este orçamento está em {formatQuantity(line.quotedQuantity)}{" "}
                            {line.uomCode ?? ""}.
                          </p>
                        )}
                        {acordo?.expired && (
                          <p className="field__hint">
                            Condição vencida em{" "}
                            {acordo.validUntil ? formatDate(acordo.validUntil) : "—"} — vale como
                            referência, não como recomendação.
                          </p>
                        )}

                        {acordo && (
                          <div className="quote-suggestion__row">
                            <span>
                              <strong>Reajustar condição</strong> · base{" "}
                              {formatUnitPriceBRL(acordo.unitPrice)}
                            </span>
                            <input
                              type="text"
                              inputMode="decimal"
                              aria-label={`Percentual de reajuste de ${line.productCode}`}
                              value={reajustePorLinha[line.id] ?? ""}
                              onChange={(event) =>
                                setReajustePorLinha((atual) => ({
                                  ...atual,
                                  [line.id]: event.target.value,
                                }))
                              }
                            />
                            <span>%</span>
                            {/* Prévia, nunca autoridade: quem fecha o valor é o
                                servidor, pela mesma fronteira comercial. */}
                            {previaDoReajuste(acordo.unitPrice, reajustePorLinha[line.id]) && (
                              <span>
                                Novo preço{" "}
                                <strong>
                                  {formatUnitPriceBRL(
                                    previaDoReajuste(acordo.unitPrice, reajustePorLinha[line.id])!,
                                  )}
                                </strong>
                              </span>
                            )}
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={saving || !(reajustePorLinha[line.id] ?? "").trim()}
                              onClick={() =>
                                void reajustarCondicao(
                                  line.id,
                                  acordo,
                                  reajustePorLinha[line.id] ?? "",
                                )
                              }
                            >
                              Aplicar reajuste
                            </button>
                          </div>
                        )}

                        {line.quotedQuantity && tier && tier.selectedUnitPrice ? (
                          <div className="quote-suggestion__row">
                            {/* O código da PREC já aparece na coluna de origem
                                da linha — repeti-lo aqui só duplicaria. */}
                            <span>
                              <strong>Usar precificação atual</strong>
                            </span>
                            <span>
                              Existe uma precificação vigente para {formatQuantity(tier.quantity)}{" "}
                              {tier.uomCode}:{" "}
                              <strong>{formatUnitPriceBRL(tier.selectedUnitPrice)}</strong> /{" "}
                              {tier.uomCode}.
                            </span>
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              disabled={saving}
                              onClick={() => void run(() => applyQuotePricing(line.id, tier.id))}
                            >
                              Aplicar preço calculado
                            </button>
                            <Link className="btn btn--ghost btn--sm" to={cmvHref}>
                              Simular CMV
                            </Link>
                          </div>
                        ) : (
                          <div className="quote-suggestion__row">
                            <span>Não existe precificação vigente para esta quantidade.</span>
                            <Link className="btn btn--ghost btn--sm" to={cmvHref}>
                              Simular CMV
                            </Link>
                          </div>
                        )}

                        {/* Preço manual continua sendo o campo da própria linha:
                            não há dois lugares para digitar o mesmo número. */}
                        {line.priceSource !== "MANUAL" && (
                          <div className="quote-suggestion__row">
                            <span>
                              <strong>Preço manual</strong> — assumir o valor à mão nesta linha.
                            </span>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={saving}
                              onClick={() => void run(() => useManualQuotePrice(line.id))}
                            >
                              Usar preço manual
                            </button>
                          </div>
                        )}

                        {/* A exceção comercial é permitida — em voz alta. O
                            servidor recusou por falta de motivo, e é o motivo
                            que a tela pede aqui. */}
                        {excecao?.lineId === line.id && (
                          <div className="quote-suggestion__row">
                            <span>{excecao.aviso}</span>
                            <input
                              type="text"
                              aria-label={`Motivo para a condição de ${line.productCode}`}
                              value={excecao.motivo}
                              onChange={(event) =>
                                setExcecao((atual) =>
                                  atual ? { ...atual, motivo: event.target.value } : atual,
                                )
                              }
                            />
                            <button
                              type="button"
                              className="btn btn--secondary btn--sm"
                              disabled={saving || excecao.motivo.trim() === ""}
                              onClick={() => void confirmarExcecao()}
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={saving}
                              onClick={() => setExcecao(null)}
                            >
                              Cancelar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  {/*
                    Em versão editável o rodapé é a PRÉVIA — o que os campos
                    dizem agora, com o desconto gravado aplicado pela mesma
                    função do documento. O gravado aparece ao lado, nomeado,
                    quando difere: dois números de momentos diferentes só podem
                    conviver se estiver dito qual é qual.
                  */}
                  <td colSpan={editable ? 5 : 4}>
                    {editable ? "Total da proposta (prévia)" : "Total da proposta"}
                  </td>
                  <td colSpan={2}>
                    {/* Total parcial não existe: com linha sem preço, não há total. */}
                    <strong>
                      {editable
                        ? previaDoTotal
                          ? formatBRL(previaDoTotal)
                          : "—"
                        : open.total
                          ? formatBRL(open.total)
                          : "—"}
                    </strong>
                    {editable && linhasComEdicaoPendente && (
                      <div className="field__hint">
                        Total salvo: {open.total ? formatBRL(open.total) : "—"} — alterações são
                        gravadas ao sair do campo.
                      </div>
                    )}
                    {alguemIlegivel && (
                      <div className="field__hint">
                        Existe valor que não dá para ler — corrija antes de gravar.
                      </div>
                    )}
                    {missingPrice && !alguemIlegivel && (
                      <div className="field__hint">Existem produtos sem preço definido.</div>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {pricingLineId && (
            <div className="inline-form">
              <h5>Faixas de precificação do produto</h5>
              {!pricingOptions ? (
                <p className="field__hint">
                  Nenhuma precificação ativa para este produto. Feche uma precificação antes de
                  vincular o preço.
                </p>
              ) : (
                <ul className="plain-list">
                  {pricingOptions.tiers.map((tier) => (
                    <li key={tier.id}>
                      {formatQuantity(tier.quantity)} {tier.uomCode} ·{" "}
                      {tier.selectedUnitPrice ? formatUnitPriceBRL(tier.selectedUnitPrice) : "sem preço"}{" "}
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={saving || !tier.selectedUnitPrice}
                        onClick={() =>
                          void run(async () => {
                            await applyQuotePricing(pricingLineId, tier.id);
                            setPricingLineId(null);
                          })
                        }
                      >
                        Usar esta faixa
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="field__hint">
                A quantidade da linha precisa corresponder exatamente à faixa — o sistema não
                escolhe faixa aproximada nem interpola preço.
              </p>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setPricingLineId(null)}
              >
                Fechar
              </button>
            </div>
          )}

          {editable && availableProducts.length > 0 && (
            <div className="inline-form">
              <label htmlFor="quote-add-product">Adicionar produto à proposta</label>
              <select
                id="quote-add-product"
                value={addProductId}
                onChange={(event) => setAddProductId(event.target.value)}
              >
                <option value="">Selecione…</option>
                {availableProducts.map((link) => (
                  <option key={link.id} value={link.id}>
                    {link.productCode} · {link.productName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={saving || addProductId === ""}
                onClick={() =>
                  void run(async () => {
                    await addQuoteLine(open.id, addProductId);
                    setAddProductId("");
                  })
                }
              >
                Adicionar
              </button>
            </div>
          )}

          {editable && availableProducts.length === 0 && linkedProducts.length === 0 && (
            <p className="field__hint">
              O projeto ainda não tem produtos. Adicione um produto ao projeto para poder orçá-lo.
            </p>
          )}

          <QuoteConditionsForm
            quote={open}
            editable={editable}
            saving={saving}
            onSave={(input) => void run(() => updateQuoteVersion(open.id, input))}
            onPendenciaChange={reportarCondicoes}
          />

          <div className="line-actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => window.open(`/comercial/orcamentos/${open.id}/imprimir`, "_blank")}
            >
              Imprimir
            </button>

            {editable && (
              <button
                type="button"
                className="btn btn--accent"
                /* Rascunho pode nao ter validade; documento do cliente, nao.
                   A tela previne, e o servidor continua sendo a autoridade.
                   Condição ou linha por salvar também bloqueia: o envio
                   congela o gravado, e o gravado não é o que está nos campos. */
                disabled={saving || open.lines.length === 0 || !open.validUntil || motivo !== null}
                title={
                  motivo
                    ? motivo.titulo
                    : !open.validUntil
                      ? "Informe a validade da proposta antes de enviar ao cliente."
                      : undefined
                }
                aria-describedby={motivo ? "quote-send-pending" : undefined}
                onClick={() => void trySend(open)}
              >
                Enviar ao cliente
              </button>
            )}

            {canEdit && open.status === "SENT" && (
              <>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={saving || open.expired}
                  title={
                    open.expired
                      ? `Proposta vencida em ${formatDate(open.validUntil)} — crie uma nova versão.`
                      : undefined
                  }
                  onClick={() => void run(() => acceptQuoteVersion(open.id))}
                >
                  Registrar aceite
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={saving}
                  onClick={() => void run(() => rejectQuoteVersion(open.id, {}))}
                >
                  Registrar recusa
                </button>
              </>
            )}
          </div>

          {/* Uma razão por vez, a que se resolve primeiro: com alteração por
              salvar, "informe a validade" pode estar pedindo o que já foi
              digitado. */}
          {editable && motivo && (
            <p className="field__hint" id="quote-send-pending">
              {motivo.titulo} {motivo.complemento}
            </p>
          )}
          {editable && !motivo && !open.validUntil && (
            <p className="field__hint">
              Informe a validade da proposta antes de enviar ao cliente.
            </p>
          )}

          {open.expired && (
            <p className="field__hint" role="alert">
              Proposta vencida em {formatDate(open.validUntil)}: a janela de aceite fechou. Crie uma
              nova versão com preço e validade atualizados — o documento continua no histórico.
            </p>
          )}

          {/* O que falta depois do "sim" do cliente. */}
          <QuoteClosingSection
            quote={open}
            projectId={project.id}
            projectStatus={projectStatus}
            canEdit={canEdit}
            saving={saving}
            onGenerate={() =>
              void run(async () => {
                const pedido = await createOrderFromQuote(open.id);
                navigate(entityHref("customerOrder", pedido.id));
              })
            }
          />
        </div>
      )}

      <ConfirmDialog
        open={sendConfirm !== null}
        title={
          sendConfirm?.incompleteCost
            ? "Enviar com custo incompleto?"
            : "Enviar esta proposta ao cliente?"
        }
        confirmLabel={sendConfirm?.incompleteCost ? "Enviar mesmo assim" : "Enviar ao cliente"}
        cancelLabel="Voltar e revisar"
        confirmTone="accent"
        message={
          <>
            {sendConfirm?.incompleteCost ? (
              <>
                <p>
                  Uma ou mais linhas desta proposta usam um custo industrial incompleto ou
                  estimado.
                </p>
                <p>
                  O preço comercial pode ser enviado, mas a base de custo ainda possui informações
                  pendentes. Confirme somente se deseja enviar esta versão mesmo assim.
                </p>
              </>
            ) : (
              <>
                <p>
                  A versão <span className="code">{sendConfirm?.quote.code}</span> sai do rascunho e
                  passa a ser o documento enviado ao cliente, com data de envio registrada.
                </p>
                <p>
                  Depois disso a versão fica somente leitura: renegociar exige criar uma versão
                  nova.
                </p>
              </>
            )}
            {sendConfirm && sendConfirm.lines.length > 0 && (
              <ul className="confirm-dialog__list">
                {sendConfirm.lines.map((line) => (
                  <li key={line.id}>
                    <span className="code">{line.productCode}</span> {line.productName} —{" "}
                    {line.pricing?.costQuality === "NO_COST"
                      ? "sem custo industrial conhecido"
                      : "custo industrial parcial"}
                    {/* Avisos reais da faixa, quando a precificação registrou algum. */}
                    {line.pricing?.warnings?.length ? (
                      <ul>
                        {line.pricing.warnings.map((warning, index) => (
                          <li key={index}>{warning.message}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        }
        onCancel={() => setSendConfirm(null)}
        onConfirm={() => {
          const target = sendConfirm;
          setSendConfirm(null);
          if (target) void confirmSend(target);
        }}
      />

      <DuplicateQuoteDialog
        key={duplicando?.id ?? "fechado"}
        source={duplicando}
        saving={saving}
        onCancel={() => setDuplicando(null)}
        onConfirm={(priceStrategy) => {
          const origem = duplicando;
          setDuplicando(null);
          if (!origem) return;
          void run(async () => {
            const created = await duplicateQuoteVersion(origem.id, priceStrategy);
            setOpenId(created.id);
          });
        }}
      />
    </FormSection>
  );
}
