import { execFileSync } from "node:child_process";

/**
 * Métrica da ajuda contextual — antes e depois da reescrita.
 *
 * A auditoria UX-HELP-01 mediu o conteúdo antigo em palavras por tópico, e é
 * nessa mesma unidade que a Fase 1 tem de ser comparada. Este script lê os
 * doze tópicos P0 nas DUAS versões: a de hoje, importando o registro, e a
 * anterior, lendo do Git o arquivo de módulo de onde cada um saiu.
 *
 * Os dois lados são contados do mesmo jeito: todo texto que a pessoa lê,
 * separado por espaço, descartando o que é só pontuação. No lado antigo isso
 * são as cadeias de caracteres do bloco do tópico — no modelo V1 todo o
 * conteúdo visível é literal —, menos os valores de enumeração (`"producao"`,
 * `"accent"`), que a tela não mostra.
 *
 *   node scripts/help-metrics.mjs [revisão]
 */

const REVISAO = process.argv[2] ?? "origin/main";

/** Onde cada P0 morava antes da migração. */
const ORIGEM = {
  "formulacao.comoFunciona": "apps/web/src/help/content/base.ts",
  "ordemProducao.comoFunciona": "apps/web/src/help/content/base.ts",
  "faturamento.comoFunciona": "apps/web/src/help/content/base.ts",
  "comercial.pedido": "apps/web/src/help/content/comercial.ts",
  "comercial.expedicao": "apps/web/src/help/content/comercial.ts",
  "precificacao.comoFunciona": "apps/web/src/help/content/gestao.ts",
  "estruturaCusto.comoFunciona": "apps/web/src/help/content/gestao.ts",
  "compras.recebimentos": "apps/web/src/help/content/suprimentos.ts",
  "estoque.lotes": "apps/web/src/help/content/suprimentos.ts",
  // Sem linha aqui: tópico que não existia antes.
  "comercial.orcamento": null,
  "comercial.reservarProdutoAcabado": null,
  "faturamento.alterarPreco": null,
};

/** Valores de enumeração que aparecem como literal e não são texto lido. */
const NAO_E_TEXTO = new Set([
  "comercial", "producao", "compras", "estoque", "qualidade", "gestao",
  "cadastros", "administracao", "neutral", "accent", "warn", "S", "M", "L",
]);

function palavras(texto) {
  return texto
    .split(/\s+/)
    .filter((palavra) => /[\p{L}\p{N}]/u.test(palavra)).length;
}

function arquivoNaRevisao(caminho) {
  return execFileSync("git", ["show", `${REVISAO}:${caminho}`], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** O bloco de um tópico dentro do arquivo de módulo, do `"chave": {` ao `},`. */
function blocoDoTopico(conteudo, chave) {
  const linhas = conteudo.split(/\r?\n/);
  const inicio = linhas.findIndex((linha) => linha.startsWith(`  "${chave}": {`));
  if (inicio < 0) return null;
  const fim = linhas.findIndex((linha, i) => i > inicio && linha === "  },");
  return fim < 0 ? null : linhas.slice(inicio, fim + 1).join("\n");
}

/** As cadeias de caracteres de um bloco — é o texto que a tela mostrava. */
function palavrasDoBloco(bloco) {
  const literais = [...bloco.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  return literais
    .filter((literal) => !NAO_E_TEXTO.has(literal))
    .reduce((soma, literal) => soma + palavras(literal.replace(/\\"/g, '"')), 0);
}

const { helpTopics, isHelpTopicV2 } = await import("../apps/web/src/help/help-content.ts");
const { topicosV2 } = await import("../apps/web/src/help/content/v2.ts");
const { helpHints } = await import("../apps/web/src/help/help-content.ts");
const { helpConcepts } = await import("../apps/web/src/help/concepts/index.ts");

const TETO = { S: 250, M: 500, L: 800 };

function textoDoV2(topico) {
  const partes = [
    topico.title,
    topico.oneLiner,
    ...topico.whenToUse,
    ...topico.nextSteps.map((p) => p.label),
    ...(topico.prerequisites ?? []).map((p) => p.text),
    ...topico.steps.flatMap((e) => [e.you, e.system ?? ""]),
    ...(topico.automations ?? []),
    ...(topico.process ? [...topico.process.before, topico.process.here, ...topico.process.after] : []),
    ...(topico.terms ?? []).flatMap((t) =>
      typeof t === "string" ? [helpHints[t].label, helpHints[t].text] : [t.term, t.text],
    ),
    ...(topico.states ?? []).flatMap((s) => [s.name, s.allows]),
    ...(topico.cautions ?? []),
    topico.example ?? "",
    ...(topico.learnMore ?? []).map((l) => l.label ?? ""),
  ];
  return partes.filter(Boolean).join(" ");
}

const linhas = [];
let antesTotal = 0;
let depoisTotal = 0;

for (const [chave, arquivo] of Object.entries(ORIGEM)) {
  const topico = topicosV2[chave];
  const depois = palavras(textoDoV2(topico));
  let antes = 0;
  if (arquivo) {
    const bloco = blocoDoTopico(arquivoNaRevisao(arquivo), chave);
    if (!bloco) throw new Error(`bloco de ${chave} não encontrado em ${REVISAO}:${arquivo}`);
    antes = palavrasDoBloco(bloco);
  }
  antesTotal += antes;
  depoisTotal += depois;
  linhas.push({
    chave,
    classe: topico.size,
    antes: antes || "—",
    depois,
    teto: TETO[topico.size],
    acimaDoTeto: depois > TETO[topico.size],
    exemplo: Boolean(topico.example),
    proximoPasso: topico.nextSteps.length,
  });
}

const semExemplo = linhas.filter((l) => !l.exemplo).map((l) => l.chave);
const semProximoPasso = linhas.filter((l) => l.proximoPasso === 0).map((l) => l.chave);
const acimaDoTeto = linhas.filter((l) => l.acimaDoTeto).map((l) => l.chave);

const totalDeTopicos = Object.keys(helpTopics).length;
const migrados = Object.values(helpTopics).filter(isHelpTopicV2).length;

console.log(`Comparação com ${REVISAO}\n`);
console.table(
  linhas.map((l) => ({
    tópico: l.chave,
    classe: l.classe,
    antes: l.antes,
    depois: l.depois,
    teto: l.teto,
    exemplo: l.exemplo ? "sim" : "não",
  })),
);
console.log(`tópicos no registro:      ${totalDeTopicos}`);
console.log(`tópicos no modelo V2:     ${migrados}`);
console.log(`conceitos compartilhados: ${Object.keys(helpConcepts).length}`);
console.log(`palavras dos P0 antes:    ${antesTotal}`);
console.log(`palavras dos P0 depois:   ${depoisTotal}`);
console.log(`média antes (9 que existiam): ${Math.round(antesTotal / 9)}`);
console.log(`média depois (12):        ${Math.round(depoisTotal / linhas.length)}`);
console.log(`P0 sem próximo passo:     ${semProximoPasso.length ? semProximoPasso.join(", ") : "nenhum"}`);
console.log(`P0 acima do teto:         ${acimaDoTeto.length ? acimaDoTeto.join(", ") : "nenhum"}`);
console.log(`P0 com exemplo numérico:  ${linhas.length - semExemplo.length} de ${linhas.length}`);
if (semExemplo.length) console.log(`  sem exemplo: ${semExemplo.join(", ")}`);
