import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { helpHints, helpTopics, isHelpTopicV2 } from "../help/help-content";
import type { AnyHelpTopic, HelpConcept, HelpTopicV2 } from "../help/help-content";
import { helpConcepts } from "../help/concepts";
import { topicosV2 } from "../help/content/v2";
import { TERMOS_ESTRANGEIROS } from "../help/glossario/siglas";

/**
 * O PADRÃO EDITORIAL da ajuda, cobrado por teste.
 *
 * A auditoria UX-HELP-01 mediu trinta e um mil palavras de ajuda e encontrou
 * o mesmo conjunto de defeitos em quase toda tela: painel que abre por
 * glossário, tópico de mil palavras, nenhum próximo passo, nenhum exemplo com
 * número, e termo em inglês solto no texto que o usuário final lê.
 *
 * Nenhum desses defeitos é pego por revisão de código — todos passam por
 * `tsc` e renderizam bem. O que os pega é uma régua escrita uma vez: nível 1
 * curto e obrigatório, teto de palavras por classe de tamanho, destino que
 * existe, e o inglês só com glosa. As regras estão em `docs/UX_HELP_GUIDE.md`;
 * este arquivo é a versão executável delas.
 *
 * A régua vale para o modelo V2. Tópico ainda no modelo original continua
 * sendo cobrado pelo contrato antigo, em `help-topic-contract.test.ts` — a
 * migração é por tela, e travar as quarenta e oito de uma vez pararia a
 * entrega em vez de melhorá-la.
 */

/** Teto de palavras por classe de tamanho — o tópico INTEIRO, os três níveis. */
const TETO: Record<HelpTopicV2["size"], number> = { S: 250, M: 500, L: 800 };

/** Teto do nível 1: o que a pessoa lê antes de decidir se continua lendo. */
const TETO_NIVEL_1 = 80;

/** Ressalvas demais deixam de ser ressalva e viram parede de texto. */
const MAXIMO_DE_RESSALVAS = 5;

const v2: [string, HelpTopicV2][] = Object.entries(topicosV2);

/**
 * Palavras de um texto.
 *
 * Conta o que é lido: pontuação sozinha não é palavra, e "R$ 15,38" é uma.
 * Vale para o texto inteiro do tópico, sem descontar título de seção — o teto
 * existe para a pessoa que lê, não para quem escreve.
 */
function palavras(...textos: (string | undefined)[]): number {
  return textos
    .filter((texto): texto is string => Boolean(texto))
    .join(" ")
    .split(/\s+/)
    .filter((palavra) => /[\p{L}\p{N}]/u.test(palavra)).length;
}

/** O nível 1 — o que fica visível sem abrir nada. */
function textoNivel1(topico: HelpTopicV2): string[] {
  return [topico.oneLiner, ...topico.whenToUse, ...topico.nextSteps.map((passo) => passo.label)];
}

/** Os termos do tópico, com as chaves de dica ⓘ já resolvidas. */
function termos(topico: HelpTopicV2): HelpConcept[] {
  return (topico.terms ?? []).map((termo) => {
    if (typeof termo !== "string") return termo;
    const dica = helpHints[termo];
    return { term: dica.label, text: dica.text };
  });
}

/** Todo o texto do tópico, na ordem em que ele é lido. */
function textoCompleto(topico: HelpTopicV2): string[] {
  const partes = [topico.title, ...textoNivel1(topico)];
  for (const pre of topico.prerequisites ?? []) partes.push(pre.text);
  for (const etapa of topico.steps) partes.push(etapa.you, etapa.system ?? "");
  partes.push(...(topico.automations ?? []));
  if (topico.process) {
    partes.push(...topico.process.before, topico.process.here, ...topico.process.after);
  }
  for (const termo of termos(topico)) partes.push(termo.term, termo.text);
  for (const situacao of topico.states ?? []) partes.push(situacao.name, situacao.allows);
  partes.push(...(topico.cautions ?? []));
  if (topico.example) partes.push(topico.example);
  for (const item of topico.learnMore ?? []) partes.push(item.label ?? "");
  return partes.filter(Boolean);
}

/**
 * As rotas reais da aplicação, lidas do `App.tsx`.
 *
 * Link interno da ajuda tem de chegar em algum lugar. Uma lista escrita à mão
 * aqui envelheceria em silêncio junto com a primeira rota renomeada — por
 * isso ela é lida do arquivo que define as rotas de verdade.
 */
function rotasDaAplicacao(): string[] {
  const app = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
  return [...app.matchAll(/path="([^"]+)"/g)].map((encontro) => encontro[1]!);
}

/** Um destino interno resolve quando existe rota com o mesmo formato. */
function resolve(href: string, rotas: string[]): boolean {
  const alvo = href.split("?")[0]!.split("/").filter(Boolean);
  return rotas.some((rota) => {
    const partes = rota.split("/").filter(Boolean);
    if (partes.length !== alvo.length) return false;
    return partes.every((parte, i) => parte.startsWith(":") || parte === alvo[i]);
  });
}

/** Todos os destinos internos de um tópico, com o campo de onde vieram. */
function destinos(topico: HelpTopicV2): [origem: string, href: string][] {
  const achados: [string, string][] = [];
  for (const passo of topico.nextSteps) if (passo.href) achados.push(["nextSteps", passo.href]);
  for (const pre of topico.prerequisites ?? []) {
    if (pre.href) achados.push(["prerequisites", pre.href]);
  }
  for (const item of topico.learnMore ?? []) {
    if (item.href) achados.push(["learnMore", item.href]);
  }
  return achados.filter(([, href]) => !/^https?:/i.test(href));
}

describe("padrão editorial da ajuda (modelo V2)", () => {
  it("a migração está em andamento e os dois modelos convivem", () => {
    const registro = Object.values(helpTopics) as AnyHelpTopic[];
    const migrados = registro.filter(isHelpTopicV2);
    const originais = registro.filter((topico) => !isHelpTopicV2(topico));

    // Guarda contra suíte vazia: uma régua que não mede nada passa sempre.
    expect(migrados.length).toBe(v2.length);
    expect(migrados.length).toBeGreaterThanOrEqual(12);
    // E contra o oposto: os tópicos ainda no formato antigo continuam vivos.
    expect(originais.length).toBeGreaterThan(0);
  });

  it.each(v2)("%s tem nível 1 completo: em uma frase, quando usar e próximo passo", (id, topico) => {
    expect(topico.oneLiner.trim(), `${id}: oneLiner`).not.toBe("");
    expect(topico.whenToUse.length, `${id}: quando usar`).toBeGreaterThanOrEqual(2);
    expect(topico.nextSteps.length, `${id}: próximo passo`).toBeGreaterThanOrEqual(1);
    for (const passo of topico.nextSteps) {
      expect(passo.label.trim(), `${id}: próximo passo sem rótulo`).not.toBe("");
    }
  });

  it.each(v2)("%s cabe em 80 palavras no nível 1", (id, topico) => {
    const total = palavras(...textoNivel1(topico));
    expect(total, `${id}: nível 1 com ${total} palavras`).toBeLessThanOrEqual(TETO_NIVEL_1);
  });

  it.each(v2)("%s respeita o teto de palavras da sua classe", (id, topico) => {
    const total = palavras(...textoCompleto(topico));
    const teto = TETO[topico.size];
    expect(total, `${id}: classe ${topico.size} com ${total} palavras (teto ${teto})`).toBeLessThanOrEqual(teto);
  });

  it.each(v2)("%s tem passo a passo e nenhuma seção vazia", (id, topico) => {
    expect(topico.steps.length, `${id}: passos`).toBeGreaterThanOrEqual(2);
    for (const [indice, etapa] of topico.steps.entries()) {
      expect(etapa.you.trim(), `${id}: passo ${indice + 1} sem "você faz"`).not.toBe("");
    }

    // Seção declarada e vazia é pior que seção ausente: o painel desenha o
    // título e não entrega nada embaixo dele.
    const vazias = Object.entries({
      whenToUse: topico.whenToUse,
      nextSteps: topico.nextSteps,
      prerequisites: topico.prerequisites,
      automations: topico.automations,
      terms: topico.terms,
      states: topico.states,
      cautions: topico.cautions,
      learnMore: topico.learnMore,
    }).filter(([, valor]) => Array.isArray(valor) && valor.length === 0);
    expect(vazias.map(([campo]) => `${id}: ${campo} vazio`)).toEqual([]);
  });

  it.each(v2)("%s tem no máximo cinco ressalvas, e marca o irreversível", (id, topico) => {
    const ressalvas = topico.cautions ?? [];
    expect(ressalvas.length, `${id}: ressalvas`).toBeLessThanOrEqual(MAXIMO_DE_RESSALVAS);
    /*
     * "Não tem volta:" é o prefixo combinado para o ato irreversível. Não é
     * obrigatório — tela de consulta não tem nenhum —, mas quando o texto
     * fala em irreversibilidade, é essa forma que ele usa.
     */
    for (const ressalva of ressalvas) {
      if (/irrevers/i.test(ressalva)) {
        expect(ressalva, `${id}: irreversibilidade sem o prefixo combinado`).toMatch(
          /^Não tem volta:/,
        );
      }
    }
  });

  it.each(v2)("%s tem próximo passo e todo link interno resolve", (id, topico) => {
    const rotas = rotasDaAplicacao();
    expect(rotas.length).toBeGreaterThan(40);

    const mortos = destinos(topico)
      .filter(([, href]) => !resolve(href, rotas))
      .map(([origem, href]) => `${id}: ${origem} → ${href}`);
    expect(mortos).toEqual([]);
  });

  it.each(v2)("%s aponta para conceito compartilhado que existe", (id, topico) => {
    for (const item of topico.learnMore ?? []) {
      if (item.concept) {
        expect(helpConcepts[item.concept], `${id}: conceito ${item.concept}`).toBeDefined();
      } else {
        expect(item.label?.trim(), `${id}: item de "Saiba mais" sem rótulo`).toBeTruthy();
      }
    }
  });

  it.each(v2)("%s traz a data da última revisão", (id, topico) => {
    expect(topico.revisedAt, `${id}: revisedAt`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /**
   * Termo de negócio em inglês só entra glosado — e a glosa vem na PRIMEIRA vez.
   *
   * O gate percorre o texto na ordem em que ele é lido. Na primeira aparição
   * do termo, a forma glosada tem de estar ali: "Laudo (CoA)", "overage
   * (excesso planejado)". Depois disso o termo pode circular sozinho, que é
   * como qualquer manual escreve — glosar de novo a cada citação atravanca a
   * leitura de quem já leu a definição três linhas acima.
   *
   * Termo sem nenhuma glosa na lista não entra de jeito nenhum: para "modelo",
   * "rascunho" e "separação" existe palavra em português e ela é o padrão.
   */
  it.each(v2)("%s não usa termo de negócio em inglês sem glosa", (id, topico) => {
    const achados: string[] = [];
    const textos = textoCompleto(topico);

    for (const { termo, glosas } of TERMOS_ESTRANGEIROS) {
      const solto = new RegExp(`\\b${termo}\\b`);
      for (const texto of textos) {
        const minusculo = texto.toLowerCase();
        if (!solto.test(minusculo)) continue;
        // Primeira aparição: ou ela traz a glosa, ou é defeito. Achada a
        // glosa, o termo está apresentado e o resto do tópico pode citá-lo.
        if (!glosas.some((glosa) => minusculo.includes(glosa))) {
          achados.push(`${id}: "${termo}" sem glosa na primeira aparição, em "${texto.slice(0, 60)}"`);
        }
        break;
      }
    }
    expect(achados).toEqual([]);
  });

  /**
   * Onde o número é obrigatório.
   *
   * A auditoria: "trinta e um mil palavras sem um número é a marca mais clara
   * de que a ajuda foi escrita para quem já sabe". Nestas quatro telas a conta
   * É o assunto, e explicá-la sem um exemplo não explica nada.
   */
  it.each([
    "formulacao.comoFunciona",
    "precificacao.comoFunciona",
    "comercial.orcamento",
    "faturamento.comoFunciona",
  ])("%s traz exemplo com número", (id) => {
    const topico: HelpTopicV2 = topicosV2[id as keyof typeof topicosV2];
    expect(topico.example, `${id}: sem exemplo`).toBeDefined();
    expect(topico.example, `${id}: exemplo sem número`).toMatch(/\d/);
  });

  it("os sete conceitos compartilhados existem, com texto e sem duplicar título", () => {
    const ids = Object.keys(helpConcepts);
    expect(ids.length).toBe(7);

    for (const [id, conceito] of Object.entries(helpConcepts)) {
      expect(conceito.title.trim(), `${id}: title`).not.toBe("");
      expect(conceito.oneLiner.trim(), `${id}: oneLiner`).not.toBe("");
      expect(palavras(conceito.text), `${id}: text raso`).toBeGreaterThan(20);
    }

    const titulos = Object.values(helpConcepts).map((conceito) => conceito.title);
    expect(new Set(titulos).size).toBe(titulos.length);
  });

  /**
   * O conceito compartilhado tem de ser usado.
   *
   * Uma página de conceito que nenhum tópico cita é documentação órfã: ela
   * envelhece sem ninguém notar, e a explicação volta a ser copiada dentro
   * dos tópicos, que é o defeito que ela existe para resolver.
   */
  it("todo conceito compartilhado é citado por pelo menos um tópico", () => {
    const citados = new Set(
      v2.flatMap(([, topico]) =>
        (topico.learnMore ?? []).map((item) => item.concept).filter(Boolean),
      ),
    );
    const orfaos = Object.keys(helpConcepts).filter((id) => !citados.has(id as never));
    expect(orfaos).toEqual([]);
  });
});
