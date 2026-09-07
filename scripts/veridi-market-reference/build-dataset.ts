import { PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";
import fs from "node:fs";
import path from "node:path";
import { parseCsv, readCorpusCsv } from "../veridi-data/corpus.js";
import { MARKET_REFERENCE_DIR } from "./load.js";

/**
 * Monta `market-prices.csv` a partir de três tiers de evidência, na ordem de
 * prioridade do handoff do PO (não do §53 de runtime — este é sobre QUAL
 * EVIDÊNCIA usar para preencher `ItemCostReference`, não sobre qual fonte o
 * motor de custo usa em tempo real):
 *
 *   1. COMPRA_REAL       — histórico real de compra da Veridi
 *                          (.local-data/veridi/csv/compras_recebimentos.csv).
 *                          MEDIDO mas NÃO gera linha: o arquivo não tem
 *                          coluna de valor/preço (ver seção tier1 abaixo) —
 *                          achado registrado, não resolvido em silêncio.
 *   2. OFERTA_FORNECEDOR — `supplier_item_offers` já importado no banco
 *                          (legado de precos_fornecedores.csv).
 *   3. PESQUISA_MERCADO  — pesquisa pública (arquivo `tier3-web-findings.tsv`,
 *                          preenchido por pesquisa manual/assistida).
 *
 * Regra de não-mistura: cada item recebe linhas de UM SÓ tier — o primeiro
 * que tiver evidência suficiente. Um item que já tem oferta de fornecedor
 * (tier 2) não recebe também linha de pesquisa de mercado (tier 3), e um
 * item que já tem `ItemCostReference` (os 12 já tratados antes desta rodada)
 * é preservado como está, não redenvolvido.
 *
 * Idempotente na geração: relê o estado do banco a cada execução. Escreve
 * SEMPRE o arquivo `market-prices.csv` inteiro (não faz append incremental) —
 * quem decide o que de fato entra no banco é `load.ts` (dry-run por padrão).
 *
 * Uso: pnpm exec tsx scripts/veridi-market-reference/build-dataset.ts
 */

// Entrada e saída vivem fora do repositório, ao lado do corpus — o dataset
// carrega preço negociado de fornecedor da Veridi. Ver `load.ts`.
const MARKET_PRICES_CSV = path.join(MARKET_REFERENCE_DIR, "market-prices.csv");
const TIER3_FINDINGS_TSV = path.join(MARKET_REFERENCE_DIR, "tier3-web-findings.tsv");

const HEADER = [
  "item_code",
  "item_name",
  "uom",
  "fonte",
  "url",
  "data_consulta",
  "embalagem",
  "quantidade",
  "unidade",
  "preco_brl",
  "preco_por_unidade_canonica",
  "incluido",
  "motivo_exclusao",
  "categoria_fonte",
] as const;

const HOJE = "2026-09-07";
const DATA_CONSULTA_LEGADO = HOJE;

interface LinhaSaida {
  item_code: string;
  item_name: string;
  uom: string;
  fonte: string;
  url: string;
  data_consulta: string;
  embalagem: string;
  quantidade: string;
  unidade: string;
  preco_brl: string;
  preco_por_unidade_canonica: string;
  incluido: "SIM" | "NAO";
  motivo_exclusao: string;
  categoria_fonte: "COMPRA_REAL" | "OFERTA_FORNECEDOR" | "PESQUISA_MERCADO";
}

function csvEscape(valor: string): string {
  if (valor.includes(",") || valor.includes('"') || valor.includes("\n")) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

function linhaParaCsv(linha: LinhaSaida): string {
  return HEADER.map((coluna) => csvEscape(linha[coluna])).join(",");
}

/* ─────────────── Tier 1 — histórico real de compra ─────────────── */

function medirTier1(externalCodesResiduais: Set<string>): void {
  const compras = readCorpusCsv("compras_recebimentos.csv");
  const cabecalhoEsperado = [
    "data_compra",
    "numero_nf",
    "cod_item",
    "item",
    "nutriente_fonte",
    "fornecedor",
    "eh_amostra",
    "qtd_kg",
    "validade",
    "lote_fornecedor",
    "laudo_recebido",
    "status",
  ];
  const temColunaPreco = compras.header.some((coluna) =>
    /valor|preco|preço/i.test(coluna),
  );

  const porCodigo = new Map<string, number>();
  for (const linha of compras.rows) {
    const codigo = linha["cod_item"]?.trim();
    if (!codigo) continue;
    porCodigo.set(codigo, (porCodigo.get(codigo) ?? 0) + 1);
  }

  console.log("\n=== TIER 1 — histórico real de compra (compras_recebimentos.csv) ===");
  console.log(`colunas do arquivo: ${compras.header.join(", ")}`);
  console.log(`colunas esperadas (mapping.ts/README):  ${cabecalhoEsperado.join(", ")}`);
  console.log(`total de linhas: ${compras.rows.length}`);
  console.log(`itens distintos comprados (cod_item): ${porCodigo.size}`);
  // Join por externalCode (Item.externalCode == compras.cod_item) — NÃO por Item.code
  // (MP-000372 é código interno; "380" é o código legado, outro espaço de nomes).
  const residuaisComprados = [...externalCodesResiduais].filter((codigo) => porCodigo.has(codigo));
  console.log(
    `itens residuais (sem referência/oferta) que aparecem aqui: ${residuaisComprados.length}`,
  );
  if (!temColunaPreco) {
    console.log(
      "ACHADO: o arquivo NÃO tem coluna de valor/preço monetário (só quantidade em kg, NF, " +
        "fornecedor, datas, lote, laudo, status). Tier 1 não pode gerar NENHUMA linha de " +
        "evidência de preço, mesmo para itens comprados várias vezes. Isto é medido e " +
        "registrado aqui — não é tentativa de contornar com outra fonte por conta própria.",
    );
  }
}

/* ─────────────── Tier 2 — oferta de fornecedor (banco) ─────────────── */

interface UnidadeInfo {
  dimensao: string;
  paraBase: Decimal;
}

/**
 * Canônico = (preço / quantidade) convertido de `unidade` para `uomAlvo`
 * pela razão dos fatores de base (mesma dimensão exigida — nunca "quilo vira
 * unidade" ou coisa parecida). `null` quando a conversão não é válida —
 * quem chama decide o `motivo_exclusao`.
 */
function converterCanonico(
  quantidade: Decimal,
  unidade: string,
  precoBrl: Decimal,
  uomAlvo: string,
  unidades: Map<string, UnidadeInfo>,
): { canonico: Decimal | null; motivo: string } {
  if (quantidade.lessThanOrEqualTo(0)) {
    return { canonico: null, motivo: "quantidade física não declarada (ou zero)" };
  }
  if (precoBrl.lessThanOrEqualTo(0)) {
    return { canonico: null, motivo: "preço não informado (ou zero)" };
  }
  const infoUnidade = unidades.get(unidade);
  const infoAlvo = unidades.get(uomAlvo);
  if (!infoUnidade) {
    return { canonico: null, motivo: `unidade não reconhecida: "${unidade}"` };
  }
  if (!infoAlvo) {
    return { canonico: null, motivo: `unidade alvo não reconhecida: "${uomAlvo}"` };
  }
  if (infoUnidade.dimensao !== infoAlvo.dimensao) {
    return {
      canonico: null,
      motivo:
        `dimensão incompatível (item é ${uomAlvo}/${infoAlvo.dimensao}, achado em ` +
        `${unidade}/${infoUnidade.dimensao}) — conversão de embalagem não é inventada aqui`,
    };
  }
  const precoPorUnidadeFonte = precoBrl.dividedBy(quantidade);
  // preço/kg = (preço/g) × (g por kg) = precoPorUnidadeFonte × (paraBase[alvo] / paraBase[fonte]).
  // Ex.: R$1,336/g × (1000 g-por-kg / 1 g-por-g) = R$1336/kg — NÃO o inverso.
  const canonico = precoPorUnidadeFonte.times(infoAlvo.paraBase.dividedBy(infoUnidade.paraBase));
  return { canonico, motivo: "" };
}

async function derivarTier2(
  prisma: PrismaClient,
  unidades: Map<string, UnidadeInfo>,
  itemIdsComReferencia: Set<string>,
): Promise<LinhaSaida[]> {
  const offers = await prisma.supplierItemOffer.findMany({
    include: {
      supplierItem: {
        include: {
          item: { select: { id: true, code: true, name: true, unitCode: true, type: true } },
          supplier: { select: { legalName: true, tradeName: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const linhas: LinhaSaida[] = [];
  let itensNovos = 0;
  const vistos = new Set<string>();
  for (const offer of offers) {
    const item = offer.supplierItem.item;
    if (itemIdsComReferencia.has(item.id)) continue; // já tem ItemCostReference — preservado, não redenvolvido

    const preco = new Decimal(offer.unitPrice.toString());
    const { canonico, motivo } = converterCanonico(
      new Decimal(1),
      offer.priceUomCode,
      preco,
      item.unitCode,
      unidades,
    );
    const nomeFornecedor = offer.supplierItem.supplier.tradeName ?? offer.supplierItem.supplier.legalName;
    if (!vistos.has(item.id)) {
      vistos.add(item.id);
      itensNovos += 1;
    }
    linhas.push({
      item_code: item.code,
      item_name: item.name,
      uom: item.unitCode,
      fonte: `${nomeFornecedor} (oferta homologada, legado precos_fornecedores.csv)`,
      url: "interno: supplier_item_offers (legado precos_fornecedores.csv, sem URL pública)",
      data_consulta: DATA_CONSULTA_LEGADO,
      embalagem: "cotação direta por " + offer.priceUomCode + " (sem embalagem física associada)",
      quantidade: "1",
      unidade: offer.priceUomCode,
      preco_brl: preco.toFixed(2),
      preco_por_unidade_canonica: canonico ? canonico.toFixed(6) : "",
      incluido: canonico ? "SIM" : "NAO",
      motivo_exclusao: motivo,
      categoria_fonte: "OFERTA_FORNECEDOR",
    });
  }
  console.log("\n=== TIER 2 — oferta de fornecedor homologado (supplier_item_offers) ===");
  console.log(`ofertas no banco: ${offers.length}`);
  console.log(`linhas geradas nesta rodada (exclui quem já tem ItemCostReference): ${linhas.length}`);
  console.log(`itens distintos cobertos nesta rodada: ${itensNovos}`);
  return linhas;
}

/* ─────────────── Tier 3 — pesquisa pública (arquivo de achados) ─────────────── */

interface ItemInfo {
  code: string;
  name: string;
  unitCode: string;
}

function derivarTier3(itensPorCodigo: Map<string, ItemInfo>, unidades: Map<string, UnidadeInfo>): LinhaSaida[] {
  if (!fs.existsSync(TIER3_FINDINGS_TSV)) {
    console.log(
      `\n=== TIER 3 — pesquisa pública ===\narquivo ${TIER3_FINDINGS_TSV} não existe ainda — 0 linhas geradas.`,
    );
    return [];
  }
  const conteudo = fs.readFileSync(TIER3_FINDINGS_TSV, "utf8");
  const linhasArquivo = conteudo.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));

  const linhas: LinhaSaida[] = [];
  let found = 0;
  let notfound = 0;
  let semItem = 0;
  const codigosVistos = new Set<string>();

  for (const linhaBruta of linhasArquivo) {
    const campos = linhaBruta.split("|").map((c) => c.trim());
    const tipo = campos[0];
    const itemCode = campos[1];
    if (!itemCode) continue;
    const item = itensPorCodigo.get(itemCode);
    if (!item) {
      semItem += 1;
      console.log(`  AVISO: código não encontrado no banco, ignorado: ${itemCode} (linha: ${linhaBruta})`);
      continue;
    }
    codigosVistos.add(itemCode);

    if (tipo === "NOTFOUND") {
      const motivo = campos[2] ?? "sem evidência encontrada";
      notfound += 1;
      linhas.push({
        item_code: item.code,
        item_name: item.name,
        uom: item.unitCode,
        fonte: "-",
        url: "",
        data_consulta: HOJE,
        embalagem: "",
        quantidade: "",
        unidade: "",
        preco_brl: "",
        preco_por_unidade_canonica: "",
        incluido: "NAO",
        motivo_exclusao: motivo,
        categoria_fonte: "PESQUISA_MERCADO",
      });
      continue;
    }

    if (tipo === "FOUND") {
      const [, , fonte, url, embalagem, quantidadeTexto, unidade, precoTexto] = campos;
      found += 1;
      let canonico: Decimal | null = null;
      let motivo = "";
      let incluido: "SIM" | "NAO" = "SIM";
      try {
        const quantidade = new Decimal((quantidadeTexto ?? "").replace(",", "."));
        const preco = new Decimal((precoTexto ?? "").replace(",", "."));
        const resultado = converterCanonico(quantidade, (unidade ?? "").trim(), preco, item.unitCode, unidades);
        canonico = resultado.canonico;
        motivo = resultado.motivo;
        incluido = canonico ? "SIM" : "NAO";
      } catch {
        incluido = "NAO";
        motivo = `valores não numéricos (quantidade="${quantidadeTexto}", preco="${precoTexto}")`;
      }
      linhas.push({
        item_code: item.code,
        item_name: item.name,
        uom: item.unitCode,
        fonte: fonte ?? "",
        url: url ?? "",
        data_consulta: HOJE,
        embalagem: embalagem ?? "",
        quantidade: quantidadeTexto ?? "",
        unidade: unidade ?? "",
        preco_brl: precoTexto ?? "",
        preco_por_unidade_canonica: canonico ? canonico.toFixed(6) : "",
        incluido,
        motivo_exclusao: motivo,
        categoria_fonte: "PESQUISA_MERCADO",
      });
      continue;
    }

    console.log(`  AVISO: linha com tipo desconhecido ignorada: ${linhaBruta}`);
  }

  console.log("\n=== TIER 3 — pesquisa pública (tier3-web-findings.tsv) ===");
  console.log(`linhas no arquivo: ${linhasArquivo.length}`);
  console.log(`FOUND: ${found} · NOTFOUND: ${notfound} · código não encontrado no banco: ${semItem}`);
  console.log(`itens distintos cobertos: ${codigosVistos.size}`);
  return linhas;
}

/* ─────────────── Preservar quem já tem ItemCostReference ─────────────── */

function lerLinhasJaTratadas(codigosComReferencia: Set<string>): LinhaSaida[] {
  if (!fs.existsSync(MARKET_PRICES_CSV)) return [];
  const linhas = parseCsv(fs.readFileSync(MARKET_PRICES_CSV, "utf8"));
  const cabecalho = linhas[0]!;
  const idx = (nome: string): number => cabecalho.indexOf(nome);
  const col = {
    item_code: idx("item_code"),
    item_name: idx("item_name"),
    uom: idx("uom"),
    fonte: idx("fonte"),
    url: idx("url"),
    data_consulta: idx("data_consulta"),
    embalagem: idx("embalagem"),
    quantidade: idx("quantidade"),
    unidade: idx("unidade"),
    preco_brl: idx("preco_brl"),
    canonico: idx("preco_por_unidade_canonica"),
    incluido: idx("incluido"),
    motivo: idx("motivo_exclusao"),
    categoria: idx("categoria_fonte"),
  };

  const resultado: LinhaSaida[] = [];
  for (const linha of linhas.slice(1)) {
    const codigo = (linha[col.item_code] ?? "").trim();
    if (!codigosComReferencia.has(codigo)) continue;
    resultado.push({
      item_code: codigo,
      item_name: (linha[col.item_name] ?? "").trim(),
      uom: (linha[col.uom] ?? "").trim(),
      fonte: (linha[col.fonte] ?? "").trim(),
      url: (linha[col.url] ?? "").trim(),
      data_consulta: (linha[col.data_consulta] ?? "").trim(),
      embalagem: (linha[col.embalagem] ?? "").trim(),
      quantidade: (linha[col.quantidade] ?? "").trim(),
      unidade: (linha[col.unidade] ?? "").trim(),
      preco_brl: (linha[col.preco_brl] ?? "").trim(),
      preco_por_unidade_canonica: (linha[col.canonico] ?? "").trim(),
      incluido: (linha[col.incluido] ?? "").trim().toUpperCase() === "SIM" ? "SIM" : "NAO",
      motivo_exclusao: (linha[col.motivo] ?? "").trim(),
      categoria_fonte:
        col.categoria >= 0 && (linha[col.categoria] ?? "").trim()
          ? ((linha[col.categoria] ?? "").trim() as LinhaSaida["categoria_fonte"])
          : "PESQUISA_MERCADO",
    });
  }
  console.log(`\n=== ITENS QUE JÁ TÊM ItemCostReference (preservados verbatim) ===`);
  console.log(`linhas preservadas: ${resultado.length} (esperado: ${codigosComReferencia.size} itens, pode ter mais de 1 linha cada)`);
  return resultado;
}

/* ─────────────── principal ─────────────── */

async function principal(): Promise<void> {
  const prisma = new PrismaClient();

  const unidadesDb = await prisma.unitOfMeasure.findMany();
  const unidades = new Map<string, UnidadeInfo>(
    unidadesDb.map((u) => [u.code, { dimensao: u.dimension, paraBase: new Decimal(u.toBaseFactor.toString()) }]),
  );

  const todosItens = await prisma.item.findMany({
    where: { type: { in: ["RAW_MATERIAL", "PACKAGING"] } },
    select: { id: true, code: true, externalCode: true, name: true, unitCode: true },
  });
  const itensPorCodigo = new Map<string, ItemInfo>(todosItens.map((i) => [i.code, i]));

  const itemIdsComReferencia = new Set(
    (await prisma.itemCostReference.findMany({ select: { itemId: true } })).map((r) => r.itemId),
  );
  // Único critério de "já tratado, preservar verbatim": ter ItemCostReference
  // DE VERDADE gravada no banco — não uma lista fixa. Um item com tentativa
  // de pesquisa anterior sem sucesso (ex.: MP-000120, MP-000349) NÃO entra
  // aqui, e por isso volta a ser candidato normal a tier 2/3 nesta rodada.
  const codigosComReferencia = new Set(
    todosItens.filter((i) => itemIdsComReferencia.has(i.id)).map((i) => i.code),
  );

  const jaTratadas = lerLinhasJaTratadas(codigosComReferencia);
  const linhasTier2 = await derivarTier2(prisma, unidades, itemIdsComReferencia);

  // Residual = sem referência E sem oferta — é quem tier 1 e tier 3 tentam cobrir.
  const offerItemIds = new Set(
    (await prisma.supplierItemOffer.findMany({ select: { supplierItem: { select: { itemId: true } } } })).map(
      (o) => o.supplierItem.itemId,
    ),
  );
  const externalCodesResiduais = new Set(
    todosItens
      .filter((i) => !itemIdsComReferencia.has(i.id) && !offerItemIds.has(i.id))
      .map((i) => i.externalCode)
      .filter((codigo): codigo is string => Boolean(codigo)),
  );

  medirTier1(externalCodesResiduais);
  const linhasTier3 = derivarTier3(itensPorCodigo, unidades);

  const todasLinhas = [...jaTratadas, ...linhasTier2, ...linhasTier3];
  todasLinhas.sort((a, b) => a.item_code.localeCompare(b.item_code));

  const csv = [HEADER.join(","), ...todasLinhas.map(linhaParaCsv)].join("\n") + "\n";
  fs.writeFileSync(MARKET_PRICES_CSV, csv, "utf8");

  console.log(`\n=== ARQUIVO GRAVADO ===`);
  console.log(`${MARKET_PRICES_CSV}`);
  console.log(`total de linhas de dados: ${todasLinhas.length}`);
  console.log(`itens distintos no arquivo: ${new Set(todasLinhas.map((l) => l.item_code)).size} de ${todosItens.length} (RAW_MATERIAL+PACKAGING)`);

  await prisma.$disconnect();
}

principal().catch((erro: unknown) => {
  console.error(erro instanceof Error ? erro.stack ?? erro.message : erro);
  process.exit(1);
});
