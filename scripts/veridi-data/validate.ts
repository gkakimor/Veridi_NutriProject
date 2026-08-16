import { CORPUS_DIR, FindingLog, corpusAvailable, readCorpusCsv, safeDecimal } from "./corpus.js";
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

  console.log("\nNÃO IMPORTADO NESTA CAPACIDADE");
  console.log("  estoque_saldos, compras_recebimentos, precos_fornecedores, amostras,");
  console.log("  projetos (como Project), cmv_* e in28_limites — capacidades 37-41, Bloco G e Bloco H.");

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
