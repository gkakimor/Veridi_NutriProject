import { CORPUS_DIR, FindingLog, cleanText, corpusAvailable, readCorpusCsv, safeDecimal } from "./corpus.js";
import {
  groupLegacyProjects,
  legacyQuoteVersions,
  readLegacyProjectRows,
  readPipelineVocabulary,
} from "./project-analysis.js";
import { normalizeName, readLegacySampleRows, resolveSamples } from "./sample-analysis.js";
import {
  legacyOfferSourceKey,
  normalizeSupplierName,
  parseMinimumOrder,
  readLegacySupplierPriceRows,
} from "./supplier-price-analysis.js";
import {
  COMPARISON_TOLERANCE,
  readCmvProducts,
  reconstructGroup,
} from "./formulation-analysis.js";
import {
  mapCustomers,
  mapItems,
  mapProducts,
  mapSuppliers,
  readFormulationRows,
  selectLatestGroups,
} from "./mapping.js";

/**
 * `pnpm veridi:data:validate` — analisa o corpus real da Veridi e imprime
 * um relatório. **Nunca escreve no banco.**
 *
 * Falha (exit 1) apenas por problema ESTRUTURAL: arquivo ausente, cabeçalho
 * inválido, parser quebrado. Problema de QUALIDADE do dado legado vira
 * *finding* — o objetivo é justamente enxergá-los, não escondê-los.
 */
async function main(): Promise<void> {
  if (!corpusAvailable()) {
    console.error(`Corpus não encontrado em ${CORPUS_DIR}.`);
    console.error("Os CSVs reais ficam fora do repositório (.local-data/, no .gitignore).");
    process.exit(1);
  }

  const findings = new FindingLog();
  console.log(`Corpus: ${CORPUS_DIR}\n`);

  const suppliers = mapSuppliers(findings);
  const customers = mapCustomers(findings);
  const items = mapItems(findings);

  const formulationRows = readFormulationRows(findings);
  const latestGroups = selectLatestGroups(formulationRows, findings);
  const neededProducts = new Set(formulationRows.map((row) => row.productCode));
  const products = mapProducts(neededProducts, findings);

  const itemsByExternalCode = new Map(items.map((item) => [item.externalCode, item]));
  const cmvProducts = readCmvProducts();

  /* ── Estoque: só reconciliação, nunca importação ── */
  const stock = readCorpusCsv("estoque_saldos.csv");
  let positive = 0;
  let zero = 0;
  let negative = 0;
  let unreadable = 0;
  for (const row of stock.rows) {
    const value = safeDecimal(row["saldo_final_kg"]);
    if (!value) {
      // Erro de fórmula do Excel (#VALUE!) — conta como ilegível.
      unreadable += 1;
      continue;
    }
    if (value.greaterThan(0)) positive += 1;
    else if (value.isZero()) zero += 1;
    else negative += 1;
  }

  /* ── Formulações ── */
  let itemsResolved = 0;
  let itemsUnresolved = 0;
  let packagingRows = 0;
  let perDoseCandidates = 0;
  for (const row of formulationRows) {
    const item = itemsByExternalCode.get(row.itemCode);
    if (!item) {
      itemsUnresolved += 1;
      findings.add("FORMULATION_ITEM_UNRESOLVED", "Formulation", `${row.productCode}/${row.itemCode}`, "cod_item sem correspondência em itens.csv");
      continue;
    }
    itemsResolved += 1;
    if (item.type === "PACKAGING") packagingRows += 1;
    else if (row.quantityPerDose && row.doseUnit) perDoseCandidates += 1;
  }

  let reconstructed = 0;
  let consistentWithoutSplit = 0;
  let insufficient = 0;
  let comparable = 0;
  let matched = 0;
  const divergences = [];
  for (const group of latestGroups.values()) {
    const result = reconstructGroup(group, itemsByExternalCode, cmvProducts, findings);
    if (result.status === "PER_DOSE_RECONSTRUCTED") reconstructed += 1;
    else if (result.status === "CONSISTENT_WITHOUT_SPLIT") consistentWithoutSplit += 1;
    else insufficient += 1;
    comparable += result.comparableRows;
    matched += result.matchedRows;
    divergences.push(...result.divergences);
  }

  const productsWithCustomer = products.filter((product) => product.customerExternalCode !== null).length;
  const itemsWithPurity = items.filter((item) => item.defaultPurityPercent !== null).length;
  const ambiguousType = items.filter((item) => !item.typeIsCertain).length;

  /* ── Relatório ── */
  console.log("CUSTOMERS");
  console.log(`  ${readCorpusCsv("clientes.csv").rows.length} lidos · ${customers.length} mapeados · ${customers.filter((c) => c.cnpj).length} com CNPJ válido`);

  console.log("\nSUPPLIERS");
  console.log(`  ${suppliers.length} mapeados (somente nome — a planilha não tem CNPJ/contato)`);

  console.log("\nITEMS");
  console.log(`  ${items.length} mapeados · pureza conhecida ${itemsWithPurity} · tipo ambíguo ${ambiguousType}`);
  console.log(`  matéria-prima ${items.filter((i) => i.type === "RAW_MATERIAL").length} · embalagem ${items.filter((i) => i.type === "PACKAGING").length}`);

  console.log("\nPRODUCTS");
  console.log(`  ${products.length} códigos distintos necessários às formulações`);
  console.log(`  cliente resolvido ${productsWithCustomer} · não resolvido ${products.length - productsWithCustomer}`);

  console.log("\nFORMULATIONS");
  const rawFormulationRows = readCorpusCsv("formulacoes.csv").rows.length;
  console.log(`  ${rawFormulationRows} linhas no arquivo · ${formulationRows.length} referenciáveis (produto + item) · ${latestGroups.size} produtos com receita`);
  console.log(`  itens resolvidos ${itemsResolved} · não resolvidos ${itemsUnresolved}`);
  console.log(`  linhas por dose ${perDoseCandidates} · linhas de embalagem ${packagingRows}`);
  console.log(`  grupos reconstruídos PER_DOSE ${reconstructed} · consistentes sem split ${consistentWithoutSplit} · insuficientes ${insufficient}`);
  console.log(`  comparáveis ao golden ${comparable} · dentro da tolerância ${matched} · divergentes ${divergences.length}`);
  console.log(`  tolerância relativa aplicada: ${COMPARISON_TOLERANCE.toString()}`);

  if (divergences.length > 0) {
    console.log("\nDIVERGÊNCIAS (ERP × histórico)");
    for (const divergence of divergences.slice(0, 10)) {
      console.log(
        `  ${divergence.productCode}/${divergence.lot} item ${divergence.itemCode}: ` +
          `ERP ${divergence.erpQuantity} × histórico ${divergence.historicalQuantity} ` +
          `(Δ ${divergence.absoluteDifference}, ${divergence.percentDifference}%)`,
      );
    }
    if (divergences.length > 10) console.log(`  … +${divergences.length - 10}`);
  }

  console.log("\nSTOCK RECONCILIATION (somente leitura — nada é importado)");
  console.log(`  positivos ${positive} · zerados ${zero} · NEGATIVOS ${negative} · ilegíveis ${unreadable}`);

  // Capacidade 37 usa `compras_recebimentos.csv` só como VALIDAÇÃO DE
  // DADOS: confirma o vocabulário de laudo antes de qualquer importação.
  // Nada aqui altera a base, e `requiresCoa` do cadastro NUNCA é inferido
  // automaticamente deste histórico — essa classificação é decisão do
  // Product Owner (capacidade 41).
  const receipts = readCorpusCsv("compras_recebimentos.csv");
  let laudoYes = 0;
  let laudoNo = 0;
  let laudoEmpty = 0;
  let sampleRows = 0;
  const laudoVocabulary = new Map<string, number>();

  for (const row of receipts.rows) {
    const laudo = cleanText(row["laudo_recebido"]);
    const normalized = laudo?.toUpperCase() ?? "";
    if (!laudo) laudoEmpty += 1;
    else if (["SIM", "S", "OK", "TRUE"].includes(normalized)) laudoYes += 1;
    else if (["NAO", "NÃO", "N", "FALSE"].includes(normalized)) laudoNo += 1;
    if (laudo) laudoVocabulary.set(laudo, (laudoVocabulary.get(laudo) ?? 0) + 1);

    const sample = cleanText(row["eh_amostra"])?.toUpperCase();
    if (sample && ["SIM", "S", "TRUE", "1"].includes(sample)) sampleRows += 1;
  }

  console.log("\nQUALIDADE DOCUMENTAL NO HISTÓRICO (somente leitura)");
  console.log(`  linhas de recebimento ${receipts.rows.length}`);
  console.log(`  laudo SIM ${laudoYes} · laudo NÃO ${laudoNo} · vazio ${laudoEmpty}`);
  console.log(`  linhas marcadas como amostra ${sampleRows}`);
  console.log(
    `  vocabulário de laudo: ${[...laudoVocabulary.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([value, count]) => `${value} (${count})`)
      .join(", ")}`,
  );
  console.log("  nenhum Item foi classificado automaticamente a partir deste histórico.");

  // Capacidade 38 — pipeline comercial historico. So leitura/estatistica:
  // nada e importado aqui, e nenhum status e adivinhado.
  const pipeline = readPipelineVocabulary();
  const projectRows = readLegacyProjectRows(findings);
  const projectGroups = groupLegacyProjects(projectRows, findings);

  const customerCodes = new Set(projectRows.map((row) => row.customerExternalCode));
  const productCodes = new Set(projectRows.map((row) => row.productExternalCode));
  const quoteCodes = new Set(
    projectRows.map((row) => row.quoteExternalCode).filter((code): code is string => code !== null),
  );
  const channels = new Set(
    projectRows.map((row) => row.channel).filter((value): value is string => value !== null),
  );
  const legacyCustomerCodes = new Set(mapCustomers(new FindingLog()).map((row) => row.externalCode));
  const unresolvedCustomers = [...customerCodes].filter((code) => !legacyCustomerCodes.has(code));
  const legacyQuoteCount = [...projectGroups.values()].reduce(
    (total, group) => total + legacyQuoteVersions(group).length,
    0,
  );

  console.log("\nPIPELINE COMERCIAL (somente leitura)");
  console.log(`  linhas de projeto ${projectRows.length} - projetos distintos ${projectGroups.size}`);
  console.log(`  clientes distintos ${customerCodes.size} - nao resolvidos ${unresolvedCustomers.length}`);
  console.log(`  codigos de produto distintos ${productCodes.size}`);
  console.log(`  codigos de orcamento distintos ${quoteCodes.size} - versoes legadas ${legacyQuoteCount}`);
  console.log(`  canais no historico ${channels.size}: ${[...channels].sort().join(", ")}`);
  console.log(
    `  vocabulario do pipeline: ${pipeline.statuses.length} status, ${pipeline.cancelReasons.length} motivos de cancelamento, ${pipeline.concepts.length} conceitos, ${pipeline.channels.length} canais`,
  );
  console.log(
    "  ATENCAO: o export nao traz status nem motivo de cancelamento por projeto — o estagio do",
  );
  console.log(
    "  pipeline historico precisa ser reconciliado com o Product Owner (nada foi inferido).",
  );

  // Capacidade 39 — amostras historicas. O export nao traz cliente nem
  // codigo de produto: a unica ligacao aceita e igualdade EXATA do nome do
  // projeto. O resto vira finding, nunca palpite.
  const sampleRowsLegacy = readLegacySampleRows(findings);
  const projectsByName = new Map<string, string[]>();
  for (const group of projectGroups.values()) {
    const name = normalizeName(group.rows[0]!.productName);
    projectsByName.set(name, [...(projectsByName.get(name) ?? []), group.key]);
  }
  const resolutions = resolveSamples(sampleRowsLegacy, projectsByName, new FindingLog());
  const withTest = sampleRowsLegacy.filter((row) => row.testSequence !== null).length;
  const resolvedSamples = resolutions.filter((item) => item.reason === "RESOLVED").length;
  const ambiguousSamples = resolutions.filter((item) => item.reason === "AMBIGUOUS").length;
  const samplesWithoutDescription = resolutions.filter(
    (item) => item.reason === "NO_DESCRIPTION",
  ).length;

  console.log("\nAMOSTRAS HISTORICAS (somente leitura)");
  console.log(`  linhas ${sampleRowsLegacy.length} - com numero de teste ${withTest}`);
  console.log(`  sem descricao ${samplesWithoutDescription}`);
  console.log(
    `  resolviveis por nome exato de projeto ${resolvedSamples} - ambiguas ${ambiguousSamples}`,
  );
  console.log(
    `  nao resolviveis ${sampleRowsLegacy.length - resolvedSamples} — o export nao traz cod_cliente nem cod_produto`,
  );
  console.log(
    "  nenhum consumo historico de material foi reconstruido (o corpus nao tem essa informacao).",
  );

  // Capacidade 40 — precos de fornecedor. Somente leitura/estatistica: o
  // que nao for interpretavel com seguranca vira finding, nunca palpite.
  const priceRows = readLegacySupplierPriceRows(findings);
  const itemsByExternal = new Map(items.map((item) => [item.externalCode, item]));
  const supplierNames = new Set(suppliers.map((supplier) => normalizeSupplierName(supplier.legalName)));

  const distinctItemCodes = new Set(priceRows.map((row) => row.itemExternalCode));
  const distinctSupplierNames = new Set(priceRows.map((row) => normalizeSupplierName(row.supplierName)));
  const unresolvedItems = new Set<string>();
  const unresolvedSuppliers = new Set<string>();
  const pairs = new Map<string, { prices: Set<string>; moqs: Set<string>; rows: number }>();
  const sourceKeys = new Set<string>();

  let priceValid = 0;
  let priceInvalid = 0;
  let priceUomIncompatible = 0;
  let moqPresent = 0;
  let moqParsed = 0;
  let moqAssumedItemUnit = 0;
  let moqAmbiguous = 0;
  let qualifiedRows = 0;
  let bestPriceRows = 0;

  for (const row of priceRows) {
    const item = itemsByExternal.get(row.itemExternalCode);
    if (!item) unresolvedItems.add(row.itemExternalCode);
    const supplierKey = normalizeSupplierName(row.supplierName);
    if (!supplierNames.has(supplierKey)) unresolvedSuppliers.add(row.supplierName);

    if (row.qualified) qualifiedRows += 1;
    if (row.bestPriceFlag) bestPriceRows += 1;

    const pairKey = `${row.itemExternalCode}::${supplierKey}`;
    const pair = pairs.get(pairKey) ?? { prices: new Set<string>(), moqs: new Set<string>(), rows: 0 };
    pair.rows += 1;
    if (row.rawPrice) pair.prices.add(row.rawPrice);
    if (row.rawMinimumOrder) pair.moqs.add(row.rawMinimumOrder);
    pairs.set(pairKey, pair);

    if (row.price === null) {
      priceInvalid += 1;
      findings.add(
        "SUPPLIER_PRICE_INVALID",
        "SupplierItemOffer",
        `${row.itemExternalCode}/${row.supplierName}`,
        `preco nao interpretavel: "${row.rawPrice}" — oferta nao sera criada`,
      );
    } else {
      priceValid += 1;
      // O preco do corpus e SEMPRE por quilo (header preco_brl_kg). Item
      // que nao e de massa nao aceita esse preco sem adivinhar.
      if (item && item.unitCode !== "kg" && item.unitCode !== "g" && item.unitCode !== "mg") {
        priceUomIncompatible += 1;
        findings.add(
          "SUPPLIER_PRICE_UOM_INCOMPATIBLE",
          "SupplierItemOffer",
          `${row.itemExternalCode}/${row.supplierName}`,
          `preco por kg em item na unidade ${item.unitCode} — oferta nao sera criada`,
        );
      }
    }

    if (row.rawMinimumOrder) {
      moqPresent += 1;
      const parsed = parseMinimumOrder(row.rawMinimumOrder);
      if (!parsed) {
        moqAmbiguous += 1;
        findings.add(
          "SUPPLIER_MOQ_AMBIGUOUS",
          "SupplierItemOffer",
          `${row.itemExternalCode}/${row.supplierName}`,
          `pedido minimo nao interpretavel: "${row.rawMinimumOrder}" — oferta sem MOQ estruturado`,
        );
      } else {
        moqParsed += 1;
        if (parsed.uomCode === null) moqAssumedItemUnit += 1;
      }
    }

    sourceKeys.add(legacyOfferSourceKey(row));
  }

  const pairsWithMultiplePrices = [...pairs.values()].filter((pair) => pair.prices.size > 1).length;
  const pairsWithMultipleMoqs = [...pairs.values()].filter((pair) => pair.moqs.size > 1).length;
  const pairsWithMultipleRows = [...pairs.values()].filter((pair) => pair.rows > 1).length;

  console.log("\nPRECOS DE FORNECEDOR (somente leitura)");
  console.log(`  linhas ${priceRows.length}`);
  console.log(
    `  cod_item distintos ${distinctItemCodes.size} - nao resolvidos ${unresolvedItems.size}`,
  );
  console.log(
    `  fornecedores distintos ${distinctSupplierNames.size} - nao resolvidos ${unresolvedSuppliers.size}`,
  );
  console.log(
    `  pares item+fornecedor ${pairs.size} - com mais de uma observacao ${pairsWithMultipleRows}`,
  );
  console.log(
    `  pares com precos diferentes ${pairsWithMultiplePrices} - com MOQ diferente ${pairsWithMultipleMoqs}`,
  );
  console.log(
    `  precos validos ${priceValid} - invalidos ${priceInvalid} - unidade incompativel ${priceUomIncompatible}`,
  );
  console.log(
    `  MOQ informado ${moqPresent} - interpretado ${moqParsed} (sem unidade, assumida a do item ${moqAssumedItemUnit}) - ambiguo ${moqAmbiguous}`,
  );
  console.log(`  moeda: unica (BRL) - o corpus nao traz coluna de moeda`);
  console.log(
    `  vocabulario de homologacao: apenas "SIM" (${qualifiedRows} linhas); ausencia = PENDENTE, nunca BLOQUEADO`,
  );
  console.log(
    `  indicador "melhor_preco" em ${bestPriceRows} linhas — estatistica de snapshot de CMV, NAO vira fornecedor preferencial`,
  );
  console.log(
    `  chaves de idempotencia distintas ${sourceKeys.size} (observacoes identicas colapsam de proposito)`,
  );
  console.log(
    "  ATENCAO: o arquivo NAO tem data de cotacao — toda oferta legada entra sem vigencia e nunca vira preco atual.",
  );

  console.log("\nNÃO IMPORTADO NESTA CAPACIDADE");
  console.log("  estoque_saldos, compras_recebimentos,");
  console.log("  cmv_* e in28_limites — capacidades 40-41, Bloco G e Bloco H.");
  console.log("  amostras: só as resolvíveis por nome exato de projeto entram no seed.");

  // Presença/estrutura dos arquivos reservados é verificada, o conteúdo não
  // é persistido.
  for (const reserved of [
    "compras_recebimentos.csv",
    "precos_fornecedores.csv",
    "amostras.csv",
    "cmv_componentes.csv",
    "cmv_precificacao.csv",
    "in28_limites.csv",
    "dominios_pipeline.csv",
  ]) {
    const file = readCorpusCsv(reserved);
    console.log(`  ${reserved}: ${file.rows.length} linhas, ${file.header.length} colunas (estrutura ok)`);
  }

  findings.print();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
