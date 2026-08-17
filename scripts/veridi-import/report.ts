import fs from "node:fs";
import path from "node:path";
import type { ImportFindingLog } from "./findings.js";
import { SEVERITY_ORDER } from "./findings.js";
import { OUT_DIR, writeCsv } from "./sources.js";
import type { PipelineResult } from "./pipeline.js";

/**
 * Relatórios locais da migração. Tudo em `.local-data/veridi/out/` — o
 * corpus e seus derivados nunca entram no repositório.
 */

/** O que cada severidade significa na prática para quem conduz a migração. */
const SEVERITY_MEANING: Record<string, string> = {
  BLOCKING: "linha não importada",
  REVIEW: "importado o que era seguro; revisar depois",
  INFO: "transformação conhecida e aceita",
  EXCLUDED_BY_POLICY: "fora desta migração por decisão",
};

export function writeFindingsArtifacts(findings: ImportFindingLog): void {
  writeCsv(
    path.join(OUT_DIR, "findings.csv"),
    ["severidade", "codigo", "entidade", "referencia", "detalhe"],
    findings.all().map((finding) => [
      finding.severity,
      finding.code,
      finding.entity,
      finding.reference,
      finding.detail,
    ]),
  );

  const counts = findings.countBySeverity();
  const lines: string[] = [
    "# Findings da migração Veridi",
    "",
    "Finding não é defeito do importador: é dado legado que o ERP se recusa",
    "a adivinhar. A severidade diz o que aconteceu com a linha.",
    "",
    "| Severidade | Quantidade | Significado |",
    "| --- | ---: | --- |",
  ];
  for (const severity of SEVERITY_ORDER) {
    lines.push(`| ${severity} | ${counts[severity]} | ${SEVERITY_MEANING[severity]} |`);
  }

  lines.push("", "| Código | Severidade | Ocorrências | Importado? | Ação humana |", "| --- | --- | ---: | --- | --- |");
  for (const row of findings.summary()) {
    const imported =
      row.severity === "BLOCKING" || row.severity === "EXCLUDED_BY_POLICY" ? "Não" : "Sim";
    const action =
      row.severity === "REVIEW"
        ? "Revisar"
        : row.severity === "BLOCKING"
          ? "Decidir (override) ou aceitar a exclusão"
          : "Nenhuma";
    lines.push(`| ${row.code} | ${row.severity} | ${row.count} | ${imported} | ${action} |`);
  }

  fs.writeFileSync(path.join(OUT_DIR, "findings-summary.md"), `${lines.join("\n")}\n`, "utf8");
}

export function writeOpeningInventoryTemplate(result: PipelineResult): string {
  const filePath = path.join(OUT_DIR, "opening-inventory-template.csv");
  // Nunca sobrescreve: o arquivo pode já conter os lotes reconciliados.
  if (fs.existsSync(filePath)) return filePath;

  writeCsv(
    filePath,
    [
      "cutoverDate",
      "legacyItemCode",
      "itemCode",
      "itemName",
      "expectedLegacyTotal",
      "itemUom",
      "controlsLot",
      "internalLotCode",
      "supplierLot",
      "businessLotNumber",
      "ownerType",
      "ownerCustomerCode",
      "quantity",
      "expiryDate",
      "location",
      "qualityStatus",
      "coaStatus",
      "actualUnitCost",
      "notes",
    ],
    result.templates.openingInventory.map((row) => [
      "",
      row.legacyItemCode,
      row.itemCode,
      row.itemName,
      row.expectedLegacyTotal,
      row.itemUom,
      row.controlsLot ? "SIM" : "NAO",
      // Lote, validade e quantidade por lote são preenchidos por quem
      // conferiu o estoque físico. O importador não inventa lote.
      "",
      "",
      "",
      "VERIDI",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]),
  );
  return filePath;
}

function countsLine(label: string, counts: PipelineResult["domains"]["items"]): string {
  return `| ${label} | ${counts.created} | ${counts.updated} | ${counts.existing} | ${counts.skipped} |`;
}

export function writeImportReport(
  result: PipelineResult,
  extra: { sourceSummary: string[]; databaseLabel: string },
): string {
  const filePath = path.join(OUT_DIR, "import-report.md");
  const counts = result.findings.countBySeverity();

  const lines = [
    "# Migração Veridi — relatório",
    "",
    `Banco: ${extra.databaseLabel}`,
    `Execução: ${new Date().toISOString()} (${result.write ? "APPLY" : "PLAN / dry-run"})`,
    "",
    "## Fonte",
    ...extra.sourceSummary.map((line) => `- ${line}`),
    "",
    "## Importado",
    "| Domínio | Criados | Completados | Já existentes | Fora |",
    "| --- | ---: | ---: | ---: | ---: |",
    countsLine("Fornecedores", result.domains.suppliers),
    countsLine("Clientes", result.domains.customers),
    countsLine("Itens", result.domains.items),
    countsLine("Produtos", result.domains.products),
    countsLine("Itens de produto acabado", result.domains.finishedProductItems),
    countsLine("Formulações ACTIVE", result.domains.formulations),
    countsLine("Projetos", result.domains.projects),
    countsLine("Orçamentos legados", result.domains.quotes),
    countsLine("Amostras", result.domains.samples),
    countsLine("Item × Fornecedor", result.domains.supplierItems),
    countsLine("Ofertas de fornecedor", result.domains.supplierItemOffers),
    "",
    `Formulações: ${result.formulationDetail.perDose} PER_DOSE · ${result.formulationDetail.fixedBasis} FIXED_BASIS · ${result.formulationDetail.withoutUsableRows} sem linhas utilizáveis.`,
    `Golden da formulação: ${result.golden.comparable} comparáveis · ${result.golden.matched} dentro da tolerância · ${result.golden.divergent} divergentes.`,
    "",
    "## Estoque",
    `Saldos legados: ${result.stock.positive} positivos · ${result.stock.zero} zerados · ${result.stock.negative} NEGATIVOS · ${result.stock.unreadable} ilegíveis.`,
    "",
    "Importar master data **não** movimenta estoque. Saldo positivo vai para",
    "`opening-inventory-template.csv` e só entra depois da reconciliação por",
    "lote físico; saldo negativo nunca migra.",
    "",
    "## Findings",
    ...SEVERITY_ORDER.map((severity) => `- ${severity}: ${counts[severity]}`),
    "",
    "Detalhe em `findings.csv` e `findings-summary.md`.",
    "",
    "## Fora desta migração",
    "- `compras_recebimentos.csv`: histórico de recebimento não vira ledger (entradas sem as saídas correspondentes inflariam o On Hand).",
    "- `cmv_*.csv`: Bloco G.",
    "- `in28_limites.csv`: Bloco H (gate).",
    "- Usuários e revisões de documento controlado: não existem no corpus e não são inventados.",
    "",
  ];

  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}
