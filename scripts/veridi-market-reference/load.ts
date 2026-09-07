import { PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CORPUS_DIR, parseCsv } from "../veridi-data/corpus.js";
import { assertImportEnvironment, hasApplyFlag } from "../veridi-import/environment.js";

/**
 * Referência de custo por Item — carrega `market-prices.csv`, que por sua vez
 * é montado por `build-dataset.ts` a partir de três tiers (ver aquele
 * arquivo): histórico real de compra da Veridi, oferta de fornecedor
 * homologado (legado) e pesquisa pública de preço — nessa ordem de
 * prioridade, sem misturar tiers dentro do mesmo item. A coluna
 * `categoria_fonte` do CSV diz de qual tier cada linha veio, e é o que faz a
 * nota gravada (`montarNota`) dizer a verdade em vez de chamar tudo de
 * "pesquisa pública".
 *
 * O que entra aqui é `ItemCostReference`: a estimativa/referência declarada
 * de PRODUCT_RULES.md §53 — "não é compra, recebimento, custo real histórico
 * nem valor pago", **mesmo** quando o número usado veio de compra ou oferta
 * real. É o penúltimo degrau do seletor canônico de custo, abaixo de toda
 * compra real e de toda oferta de fornecedor homologado, e um cálculo que a
 * usa nasce "completo com estimativas", nunca "referências reais de compra".
 *
 * O que NUNCA acontece por este script: criar Receipt, ReceiptLine,
 * `actualUnitCost`, oferta de fornecedor ou qualquer movimento de estoque.
 * Preço de mercado pode existir sem fingir que alguém comprou.
 *
 * Idempotência: a referência é append-only por vigência (§53). Este carregador
 * NÃO insere uma vigência nova quando já existe, para o mesmo item e a mesma
 * data, uma referência com a mesma marca de origem. Rodar duas vezes não
 * empilha histórico falso.
 */

/**
 * O dataset vive FORA do repositório, ao lado do corpus de onde ele deriva.
 *
 * Não é organização: é política. A maior parte das linhas vem de
 * `precos_fornecedores.csv` — nome de fornecedor homologado e preço negociado
 * da Veridi —, exatamente a classe de dado que o `.gitignore` protege em
 * `.local-data/`. Versionar o CSV publicaria a tabela de preços do cliente.
 * O código vai para o Git; o dado, nunca.
 */
export const MARKET_REFERENCE_DIR =
  process.env["VERIDI_MARKET_REFERENCE_DIR"] ??
  path.resolve(CORPUS_DIR, "..", "market-reference");
const ARQUIVO = path.join(MARKET_REFERENCE_DIR, "market-prices.csv");

/** Marca que identifica a origem no `note` — é ela que dá a idempotência. */
const MARCA = "REFERENCIA_DE_MERCADO";

type Confianca = "HIGH_CONFIDENCE" | "MEDIUM_CONFIDENCE" | "LOW_CONFIDENCE" | "NO_REFERENCE";

/**
 * De onde a linha realmente vem — não é decorativo: é o que faz a nota
 * dizer a verdade em vez de chamar tudo de "pesquisa pública".
 *
 * COMPRA_REAL e OFERTA_FORNECEDOR são dado interno da Veridi (histórico de
 * compra / oferta de fornecedor homologado, ambos de prioridade MAIOR que
 * referência manual em PRODUCT_RULES.md §53); PESQUISA_MERCADO é pesquisa
 * pública de preço. Nas três, a linha gravada em ItemCostReference continua
 * sendo "referência manual" por definição do schema — nunca substitui
 * Receipt.actualUnitCost nem SupplierItemOffer.
 */
type CategoriaFonte = "COMPRA_REAL" | "OFERTA_FORNECEDOR" | "PESQUISA_MERCADO";

const ROTULO_CATEGORIA: Record<CategoriaFonte, string> = {
  COMPRA_REAL: "histórico real de compra da Veridi",
  OFERTA_FORNECEDOR: "oferta de fornecedor homologado (dados legados)",
  PESQUISA_MERCADO: "pesquisa pública de mercado",
};

const ROTULO_METODO: Record<CategoriaFonte, string> = {
  COMPRA_REAL: "compra(s) real(is) registrada(s) no histórico da Veridi",
  OFERTA_FORNECEDOR: "oferta(s) de fornecedor homologado (importadas do legado)",
  PESQUISA_MERCADO: "pesquisa pública de preço (distribuidores/varejo)",
};

function categoriaValida(valor: string): CategoriaFonte {
  return valor === "COMPRA_REAL" || valor === "OFERTA_FORNECEDOR" || valor === "PESQUISA_MERCADO"
    ? valor
    : "PESQUISA_MERCADO";
}

interface Fonte {
  fonte: string;
  url: string;
  dataConsulta: string;
  embalagem: string;
  quantidade: string;
  unidade: string;
  precoBrl: string;
  porUnidadeCanonica: Decimal | null;
  incluido: boolean;
  motivoExclusao: string;
  /** Default PESQUISA_MERCADO quando a coluna não existe (CSV antigo) ou vem vazia. */
  categoriaFonte: CategoriaFonte;
}

interface Agrupado {
  /** Código interno do ambiente em que o CSV foi montado. NÃO identifica o item. */
  itemCode: string;
  /**
   * Código da planilha original — a ÚNICA chave estável entre ambientes.
   *
   * `Item.code` (`MP-000372`) sai de uma sequence do Postgres, e cada banco
   * corre a sua: o mesmo código nomeia itens diferentes em DEV e em produção.
   * Resolver por `code` grava o preço do Ácido Cítrico no Extrato de alho —
   * foi exatamente o que aconteceu na primeira carga desta rodada, e é por
   * isso que a resolução passou a ser por `externalCode`, que o importador
   * copia da planilha e nunca regenera.
   */
  externalCode: string;
  itemName: string;
  uom: string;
  fontes: Fonte[];
}

interface Estatistica {
  n: number;
  media: Decimal | null;
  mediana: Decimal | null;
  minimo: Decimal | null;
  maximo: Decimal | null;
  dispersao: Decimal | null;
}

function ler(): Agrupado[] {
  const linhas = parseCsv(fs.readFileSync(ARQUIVO, "utf8"));
  const cabecalho = linhas[0]!;
  const indice = (nome: string): number => {
    const posicao = cabecalho.indexOf(nome);
    if (posicao < 0) throw new Error(`Coluna ausente no CSV: ${nome}`);
    return posicao;
  };
  /** Coluna opcional — CSV anterior a esta versão não tem `categoria_fonte`. */
  const indiceOpcional = (nome: string): number => cabecalho.indexOf(nome);

  const colunas = {
    itemCode: indice("item_code"),
    itemName: indice("item_name"),
    uom: indice("uom"),
    fonte: indice("fonte"),
    url: indice("url"),
    data: indice("data_consulta"),
    embalagem: indice("embalagem"),
    quantidade: indice("quantidade"),
    unidade: indice("unidade"),
    preco: indice("preco_brl"),
    canonico: indice("preco_por_unidade_canonica"),
    incluido: indice("incluido"),
    motivo: indice("motivo_exclusao"),
    categoria: indiceOpcional("categoria_fonte"),
    externo: indiceOpcional("external_code"),
  };

  const porItem = new Map<string, Agrupado>();
  for (const linha of linhas.slice(1)) {
    if (linha.length < 2 || !linha[colunas.itemCode]) continue;
    const itemCode = linha[colunas.itemCode]!.trim();
    const grupo = porItem.get(itemCode) ?? {
      itemCode,
      externalCode: (colunas.externo >= 0 ? linha[colunas.externo] : "")?.trim() ?? "",
      itemName: linha[colunas.itemName]!.trim(),
      uom: linha[colunas.uom]!.trim(),
      fontes: [],
    };
    const canonicoTexto = (linha[colunas.canonico] ?? "").trim();
    grupo.fontes.push({
      fonte: (linha[colunas.fonte] ?? "").trim(),
      url: (linha[colunas.url] ?? "").trim(),
      dataConsulta: (linha[colunas.data] ?? "").trim(),
      embalagem: (linha[colunas.embalagem] ?? "").trim(),
      quantidade: (linha[colunas.quantidade] ?? "").trim(),
      unidade: (linha[colunas.unidade] ?? "").trim(),
      precoBrl: (linha[colunas.preco] ?? "").trim(),
      porUnidadeCanonica: canonicoTexto ? new Decimal(canonicoTexto) : null,
      incluido: (linha[colunas.incluido] ?? "").trim().toUpperCase() === "SIM",
      motivoExclusao: (linha[colunas.motivo] ?? "").trim(),
      categoriaFonte: categoriaValida((colunas.categoria >= 0 ? linha[colunas.categoria] : "")?.trim() ?? ""),
    });
    porItem.set(itemCode, grupo);
  }
  return [...porItem.values()];
}

/**
 * Mediana como referência principal: com três fontes de varejo e uma de
 * distribuidor, a média persegue o outlier e a mediana não.
 */
function estatistica(valores: Decimal[]): Estatistica {
  if (valores.length === 0) {
    return { n: 0, media: null, mediana: null, minimo: null, maximo: null, dispersao: null };
  }
  const ordenado = [...valores].sort((a, b) => a.comparedTo(b));
  const meio = Math.floor(ordenado.length / 2);
  const mediana =
    ordenado.length % 2 === 1
      ? ordenado[meio]!
      : ordenado[meio - 1]!.plus(ordenado[meio]!).dividedBy(2);
  const soma = ordenado.reduce((total, valor) => total.plus(valor), new Decimal(0));
  const minimo = ordenado[0]!;
  const maximo = ordenado[ordenado.length - 1]!;
  return {
    n: ordenado.length,
    media: soma.dividedBy(ordenado.length),
    mediana,
    minimo,
    maximo,
    dispersao: minimo.isZero() ? null : maximo.dividedBy(minimo),
  };
}

/**
 * Confiança pela EVIDÊNCIA, não pelo desejo de ter um número:
 * três fontes coerentes é uma coisa, uma fonte solta é outra, e nenhuma
 * fonte não vira preço.
 */
function classificar(stat: Estatistica): Confianca {
  if (stat.n === 0) return "NO_REFERENCE";
  if (stat.n >= 3 && stat.dispersao !== null && stat.dispersao.lessThanOrEqualTo(2)) {
    return "HIGH_CONFIDENCE";
  }
  if (stat.n === 2 && stat.dispersao !== null && stat.dispersao.lessThanOrEqualTo(2)) {
    return "MEDIUM_CONFIDENCE";
  }
  return "LOW_CONFIDENCE";
}

function montarNota(grupo: Agrupado, stat: Estatistica, confianca: Confianca): string {
  const incluidas = grupo.fontes.filter((fonte) => fonte.incluido);
  const excluidas = grupo.fontes.filter((fonte) => !fonte.incluido);
  // Todas as fontes incluídas de um item vêm do mesmo tier (o carregador do
  // dataset não mistura tier — ver scripts/veridi-market-reference/build-dataset.ts);
  // a primeira representa o grupo inteiro.
  const categoria = incluidas[0]?.categoriaFonte ?? "PESQUISA_MERCADO";
  const partes = [
    `${MARCA} · ${confianca} · fonte: ${ROTULO_CATEGORIA[categoria]} · registrado em ${incluidas[0]?.dataConsulta ?? "-"}.`,
    "NÃO é custo real de aquisição, de recebimento nem de compra: é referência manual/declarada " +
      "(PRODUCT_RULES.md §53) — mesmo quando o valor vem de compra ou oferta real, esta linha " +
      "nunca substitui Receipt.actualUnitCost nem SupplierItemOffer.",
    `Método: preço convertido para R$/${grupo.uom} a partir de ${ROTULO_METODO[categoria]}; mediana de ${stat.n} fonte(s).`,
    `mediana ${stat.mediana?.toFixed(6)} · média ${stat.media?.toFixed(6)} · ` +
      `mín ${stat.minimo?.toFixed(6)} · máx ${stat.maximo?.toFixed(6)}.`,
    "Fontes: " +
      incluidas
        .map((fonte) => `${fonte.fonte} (${fonte.embalagem}, R$ ${fonte.precoBrl}) ${fonte.url}`)
        .join(" | "),
  ];
  if (excluidas.length > 0) {
    partes.push(
      "Excluídas: " +
        excluidas.map((fonte) => `${fonte.fonte} — ${fonte.motivoExclusao}`).join(" | "),
    );
  }
  return partes.join(" ");
}

async function principal(): Promise<void> {
  const escrever = hasApplyFlag();
  const ambiente = assertImportEnvironment({ write: escrever });
  const prisma = new PrismaClient();

  const vigenteDesdeTexto =
    process.argv.find((argumento) => argumento.startsWith("--effective-from="))?.split("=")[1] ??
    new Date().toISOString().slice(0, 10);
  const vigenteDesde = new Date(`${vigenteDesdeTexto}T00:00:00.000Z`);

  console.log(
    `\nREFERÊNCIA DE MERCADO — banco ${ambiente.database}@${ambiente.host}` +
      `${escrever ? " (APPLY)" : " (dry-run — nada é escrito)"}`,
  );
  console.log(`Vigente desde: ${vigenteDesdeTexto}\n`);

  const grupos = ler();
  let criadas = 0;
  let existentes = 0;
  let semReferencia = 0;
  let semItem = 0;
  const porConfianca = new Map<Confianca, number>();

  for (const grupo of grupos) {
    const incluidas = grupo.fontes
      .filter((fonte) => fonte.incluido && fonte.porUnidadeCanonica !== null)
      .map((fonte) => fonte.porUnidadeCanonica!);
    const stat = estatistica(incluidas);
    const confianca = classificar(stat);
    porConfianca.set(confianca, (porConfianca.get(confianca) ?? 0) + 1);

    // Resolução SEMPRE por `externalCode`. Sem ele a linha não entra: gravar
    // pelo código interno é o que colocou preço no item errado uma vez.
    if (!grupo.externalCode) {
      console.log(
        `  SKIP  ${grupo.itemCode} — sem external_code no arquivo; ` +
          "resolver por código interno não é seguro entre ambientes",
      );
      semItem += 1;
      continue;
    }
    const candidatos = await prisma.item.findMany({
      where: { externalCode: grupo.externalCode },
      select: { id: true, code: true, name: true, unitCode: true },
    });
    if (candidatos.length !== 1) {
      console.log(
        `  SKIP  ${grupo.itemCode} (externo ${grupo.externalCode}) — ` +
          `${candidatos.length} item(ns) com esse código de planilha`,
      );
      semItem += 1;
      continue;
    }
    const item = candidatos[0]!;

    if (confianca === "NO_REFERENCE" || stat.mediana === null) {
      console.log(
        `  ---   ${grupo.itemCode} ${grupo.itemName} — NO_REFERENCE ` +
          `(${grupo.fontes.filter((fonte) => !fonte.incluido).length} fonte(s) descartada(s))`,
      );
      semReferencia += 1;
      continue;
    }

    if (item.unitCode !== grupo.uom) {
      console.log(
        `  SKIP  ${grupo.itemCode} — unidade do item (${item.unitCode}) difere da pesquisada ` +
          `(${grupo.uom}); conversão de embalagem não é inventada aqui`,
      );
      semItem += 1;
      continue;
    }

    const jaExiste = await prisma.itemCostReference.findFirst({
      where: {
        itemId: item.id,
        effectiveFrom: vigenteDesde,
        note: { startsWith: MARCA },
      },
    });
    if (jaExiste) {
      console.log(
        `  =     ${grupo.itemCode} ${grupo.itemName} — referência de mercado já vigente nesta data`,
      );
      existentes += 1;
      continue;
    }

    const nota = montarNota(grupo, stat, confianca);
    console.log(
      `  +     ${grupo.itemCode} ${grupo.itemName} — R$ ${stat.mediana.toFixed(6)}/${grupo.uom} ` +
        `· ${confianca} · ${stat.n} fonte(s)`,
    );
    if (escrever) {
      await prisma.itemCostReference.create({
        data: {
          itemId: item.id,
          unitCost: stat.mediana.toFixed(8),
          currencyCode: "BRL",
          uomCode: grupo.uom,
          effectiveFrom: vigenteDesde,
          note: nota,
          createdByNameSnapshot: "Carga de referência de mercado",
        },
      });
    }
    criadas += 1;
  }

  console.log(`\nRESUMO`);
  console.log(`  itens no arquivo: ${grupos.length}`);
  console.log(`  referências ${escrever ? "criadas" : "a criar"}: ${criadas}`);
  console.log(`  já existentes (idempotência): ${existentes}`);
  console.log(`  sem referência suficiente: ${semReferencia}`);
  console.log(`  ignorados (item ausente ou unidade divergente): ${semItem}`);
  for (const nivel of [
    "HIGH_CONFIDENCE",
    "MEDIUM_CONFIDENCE",
    "LOW_CONFIDENCE",
    "NO_REFERENCE",
  ] as const) {
    console.log(`  ${nivel}: ${porConfianca.get(nivel) ?? 0}`);
  }
  if (!escrever) console.log(`\nNada foi escrito. Para aplicar: --apply`);

  await prisma.$disconnect();
}

principal().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
