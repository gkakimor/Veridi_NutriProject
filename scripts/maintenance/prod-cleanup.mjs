import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const require = createRequire(process.cwd() + "/apps/api/package.json");
const { PrismaClient, Prisma } = require("@prisma/client");

/**
 * Limpeza dos DADOS DE NEGÓCIO do banco de produção.
 *
 *   dry-run:  railway run --service Postgres node scripts/maintenance/prod-cleanup.mjs
 *   aplicar:  railway run --service Postgres node scripts/maintenance/prod-cleanup.mjs --apply
 *
 * Regras não negociáveis:
 *  - NUNCA reseta sequence. Sequence avançada não é sujeira: depois da
 *    limpeza o próximo pedido ser PED-000006 é o comportamento correto.
 *  - Preserva contas de login, sessões, unidades de medida e documentos
 *    controlados.
 *  - Aborta se algum model do schema não estiver classificado — tabela
 *    órfã é decisão de gente, não do script.
 */

const APLICAR = process.argv.includes("--apply");
const ARQUIVO_PLANO = process.argv.find((a) => a.startsWith("--plano="))?.slice("--plano=".length);

const url = process.env.DATABASE_PUBLIC_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("Sem DATABASE_URL/DATABASE_PUBLIC_URL no ambiente");
const prisma = new PrismaClient({ datasources: { db: { url } } });

/**
 * Tabelas a esvaziar. É um CONJUNTO, não uma ordem: a ordem de remoção é
 * calculada em `calcularOrdem()` a partir das FKs REAIS do banco.
 *
 * Confiar no schema Prisma aqui seria errado — o Prisma documenta várias
 * dessas relações como opcionais (o que sugeriria SET NULL), mas a migration
 * criou `ON DELETE RESTRICT` no Postgres. Foi exatamente isso que derrubou a
 * primeira tentativa em `lots_productionOrderId_fkey`. A fonte da verdade é
 * o `pg_constraint`, não o `schema.prisma`.
 */
const ALVOS = [
  // Razão de estoque e anexos: folhas puras. Vão primeiro para a contagem
  // sair honesta — se fossem depois, o CASCADE dos pais levaria as linhas
  // embora e o relatório diria "0 removidos".
  "InventoryMovement",
  "Attachment",

  // Faturamento e expedição
  "BillingLine",
  "Billing",
  "ShipmentLine",
  "Shipment",

  // Reservas do pedido de venda
  "CustomerOrderReservationLine",
  "CustomerOrderReservation",

  // Produção (pesagens, snapshots, saídas, consumos, reservas, ordens)
  "RecipeWeighing",
  "ProductionOrderCostSnapshot",
  "ProductionOutput",
  "ProductionConsumption",
  "MaterialReservationLine",
  "MaterialReservation",
  "ProductionOrderPart",
  "ProductionOrderRequirement",
  "ProductionOrder",

  // Pedidos de venda
  "CustomerOrderLine",
  "CustomerOrder",

  // Orçamentos
  "QuoteLine",
  "QuoteVersion",

  // Precificação
  "PricingTier",
  "PricingVersion",

  // Custo industrial
  "IndustrialCostCalculation",
  "IndustrialCostResourceUsage",
  "IndustrialCostLine",
  "IndustrialCostVersion",

  // Projetos e amostras
  "SampleConsumption",
  "ProjectSample",
  "ProjectProduct",
  "ProjectStatusHistory",
  "Project",

  // Formulação
  "FormulationComponent",
  "FormulationVersion",

  // Recebimento e compras
  "ReceiptLine",
  "Receipt",
  "PurchaseOrderLine",
  "PurchaseOrder",

  // Relação item x fornecedor
  "SupplierItemOffer",
  "SupplierItemQualificationHistory",
  "SupplierItem",

  // Estoque físico
  "Lot",

  // Cadastros de produto
  "Product",

  // Templates (antes de Item e IndustrialResource: apontam para eles)
  "FormulationTemplateComponent",
  "FormulationTemplateVersion",
  "FormulationTemplate",
  "IndustrialCostTemplateResourceUsage",
  "IndustrialCostTemplateAdditionalCost",
  "IndustrialCostTemplateVersion",
  "IndustrialCostTemplate",
  "PricingPolicyTemplateTier",
  "PricingPolicyTemplateVersion",
  "PricingPolicyTemplate",

  // Cadastros base
  "Item",
  "Supplier",
  "Customer",
  "IndustrialResourceRate",
  "IndustrialResource",
];

/** Contas de login, configuração do sistema e documentação controlada. */
const PRESERVAR = ["User", "UserSession", "UnitOfMeasure", "ControlledDocumentRevision"];

/**
 * Não constam de nenhuma das duas listas do contrato. Preservados por
 * decisão explícita, não por esquecimento:
 * `ProductionOrderNumberCounter` é o contador anual da numeração oficial da
 * OP (001/26) — é uma sequence com outro nome, e sequence não se reseta.
 */
const PRESERVAR_POR_SER_CONTADOR = ["ProductionOrderNumberCounter"];

const propDoModel = (nome) => nome.charAt(0).toLowerCase() + nome.slice(1);

/** Nome do model -> nome real da tabela (@@map). */
const tabelaDoModel = new Map(
  Prisma.dmmf.datamodel.models.map((m) => [m.name, m.dbName ?? m.name]),
);
const modelDaTabela = new Map([...tabelaDoModel].map(([m, t]) => [t, m]));

/** Nenhum model do schema pode ficar sem classificação. */
function validarCobertura() {
  const todos = Prisma.dmmf.datamodel.models.map((m) => m.name);
  const classificados = new Set([...ALVOS, ...PRESERVAR, ...PRESERVAR_POR_SER_CONTADOR]);
  return todos.filter((m) => !classificados.has(m));
}

/**
 * Ordem de remoção calculada a partir das FKs REAIS (`pg_constraint`).
 *
 * Aresta `filho -> pai` significa "filho sai antes do pai". Entram no grafo
 * RESTRICT/NO ACTION (que travam de verdade) e também CASCADE — CASCADE não
 * travaria, mas se o pai fosse primeiro o banco levaria o filho junto e a
 * contagem informada viraria mentira. SET NULL não impõe ordem.
 */
async function calcularOrdem() {
  const alvoTabelas = new Set(ALVOS.map((m) => tabelaDoModel.get(m)));

  const fks = await prisma.$queryRawUnsafe(`
    SELECT src.relname AS src, tgt.relname AS tgt, c.confdeltype AS acao
    FROM pg_constraint c
    JOIN pg_class src ON src.oid = c.conrelid
    JOIN pg_class tgt ON tgt.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = src.relnamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'
  `);

  // `libera`: ao remover o filho, o pai fica um pré-requisito mais perto de
  // poder sair. `pendentes[pai]` = quantos filhos ainda precisam sair antes.
  const libera = new Map([...alvoTabelas].map((t) => [t, new Set()]));
  const pendentes = new Map([...alvoTabelas].map((t) => [t, 0]));

  for (const fk of fks) {
    if (!alvoTabelas.has(fk.src) || !alvoTabelas.has(fk.tgt)) continue;
    if (fk.src === fk.tgt) continue; // auto-referência: some no mesmo DELETE
    if (!["r", "a", "c"].includes(fk.acao)) continue; // 'n' = SET NULL não ordena
    if (libera.get(fk.src).has(fk.tgt)) continue; // aresta repetida
    libera.get(fk.src).add(fk.tgt);
    pendentes.set(fk.tgt, pendentes.get(fk.tgt) + 1);
  }

  // Kahn, com desempate alfabético para a ordem ser reproduzível.
  // Sai primeiro quem ninguém referencia (folha), por último a raiz.
  const ordem = [];
  const prontos = [...alvoTabelas].filter((t) => pendentes.get(t) === 0).sort();
  while (prontos.length) {
    const t = prontos.shift();
    ordem.push(t);
    for (const pai of [...libera.get(t)].sort()) {
      pendentes.set(pai, pendentes.get(pai) - 1);
      if (pendentes.get(pai) === 0) {
        prontos.push(pai);
        prontos.sort();
      }
    }
  }

  if (ordem.length !== alvoTabelas.size) {
    const presas = [...alvoTabelas].filter((t) => !ordem.includes(t));
    throw new Error(`Ciclo de FK impede ordenar: ${presas.join(", ")}`);
  }

  return ordem.map((t) => modelDaTabela.get(t));
}

async function main() {
  console.log(APLICAR ? "=== MODO: APLICAR (DESTRUTIVO) ===" : "=== MODO: DRY RUN ===");

  const semClassificacao = validarCobertura();
  if (semClassificacao.length) {
    throw new Error(
      `Models sem classificação (não apago às cegas): ${semClassificacao.join(", ")}`,
    );
  }
  console.log(`Cobertura: todos os ${Prisma.dmmf.datamodel.models.length} models classificados.`);

  const ORDEM_REMOCAO = await calcularOrdem();
  console.log(`Ordem: ${ORDEM_REMOCAO.length} tabelas, ordenadas pelas FKs reais do banco.`);

  // ---- Plano ----
  const plano = [];
  let totalPrevisto = 0;
  for (const model of ORDEM_REMOCAO) {
    const n = await prisma[propDoModel(model)].count();
    plano.push({ model, linhas: n });
    totalPrevisto += n;
  }

  const preservado = [];
  for (const model of [...PRESERVAR, ...PRESERVAR_POR_SER_CONTADOR]) {
    preservado.push({ model, linhas: await prisma[propDoModel(model)].count() });
  }

  const linhasPlano = [];
  linhasPlano.push("PLANO DE LIMPEZA — banco de produção Veridi");
  linhasPlano.push(`gerado em: ${new Date().toISOString()}`);
  linhasPlano.push("");
  linhasPlano.push(`REMOVER (${ORDEM_REMOCAO.length} tabelas, na ordem abaixo):`);
  for (const [i, p] of plano.entries()) {
    linhasPlano.push(`  ${String(i + 1).padStart(2, "0")}. ${p.model.padEnd(38)} ${p.linhas}`);
  }
  linhasPlano.push("");
  linhasPlano.push(`TOTAL A REMOVER: ${totalPrevisto} linhas`);
  linhasPlano.push("");
  linhasPlano.push("PRESERVAR:");
  for (const p of preservado) linhasPlano.push(`  ${p.model.padEnd(38)} ${p.linhas}`);
  linhasPlano.push("");
  linhasPlano.push("SEQUENCES: nenhuma é resetada. Numeração continua de onde parou.");

  const texto = linhasPlano.join("\n");
  console.log("\n" + texto);

  if (ARQUIVO_PLANO) {
    mkdirSync(dirname(ARQUIVO_PLANO), { recursive: true });
    writeFileSync(ARQUIVO_PLANO, texto + "\n", "utf8");
    console.log(`\nPlano salvo em: ${ARQUIVO_PLANO}`);
  }

  if (!APLICAR) {
    console.log("\nDry run. Nada foi apagado. Use --apply para executar.");
    return;
  }

  // ---- Execução ----
  console.log("\n=== EXECUTANDO ===");
  const removidos = await prisma.$transaction(
    async (tx) => {
      const resultado = [];
      for (const model of ORDEM_REMOCAO) {
        const { count } = await tx[propDoModel(model)].deleteMany({});
        resultado.push({ model, removidos: count });
        console.log(`  ${model.padEnd(38)} ${count}`);
      }
      return resultado;
    },
    { timeout: 180000, maxWait: 60000 },
  );

  const total = removidos.reduce((a, r) => a + r.removidos, 0);
  console.log(`\nTOTAL REMOVIDO: ${total} linhas`);

  // ---- Conferência pós-limpeza ----
  console.log("\n=== CONFERÊNCIA ===");
  let sobras = 0;
  for (const model of ORDEM_REMOCAO) {
    const n = await prisma[propDoModel(model)].count();
    if (n !== 0) {
      console.log(`  ! ${model}: ainda tem ${n} linhas`);
      sobras += n;
    }
  }
  console.log(sobras === 0 ? "  Todas as tabelas removidas estão zeradas." : `  SOBRARAM ${sobras} linhas`);

  for (const model of [...PRESERVAR, ...PRESERVAR_POR_SER_CONTADOR]) {
    console.log(`  preservado ${model.padEnd(34)} ${await prisma[propDoModel(model)].count()}`);
  }
}

main()
  .catch((e) => {
    console.error("FALHOU:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
