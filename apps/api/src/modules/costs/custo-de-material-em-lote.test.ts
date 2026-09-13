import { PrismaClient, Prisma } from "@prisma/client";
import type { CostQuality, CostSource, ProductionOrderMaterialCostDTO } from "@veridi/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPrisma } from "../../db/prisma.js";
import { marcadorDoDiaComercialDe } from "../../lib/business-day.js";
import { limitesDaJanelaDeCusto } from "../../lib/cost-reference.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getProductionOrdersWithIncompleteCost } from "../dashboard/dashboard.queries.js";
import { findProductionOrderMaterialCost, findProductionOrderMaterialCosts } from "./costs.service.js";

/*
 * Custo de material de muitas OPs de uma vez (DASHBOARD-COST-BATCH-01).
 *
 * O Painel resolvia o custo de cada uma das 200 OPs concluídas pela função
 * unitária: uma leitura da OP e até quatro consultas por consumo — ~2.600 SQL
 * por requisição. O lote lê as OPs numa consulta e as referências de custo de
 * todos os consumos em até três, e faz a MESMA conta. Aqui cada caso da regra
 * sai do lote igual ao da função unitária — que continua sendo a autoridade —
 * e igual ao que a regra diz, escrito à mão: desconhecido nunca vira zero,
 * zero informado nunca vira desconhecido, material do cliente nunca entra no
 * custo da Veridi.
 *
 * Os consumos são de 2031 e as OPs concluídas em 2098: nenhum "hoje" escondido
 * passa verde, e as OPs estão entre as 200 mais recentes que o Painel lê.
 */
const registro = vi.hoisted(() => ({
  ligado: false,
  operacoes: [] as { model: string; operation: string }[],
}));

vi.mock("../../db/prisma.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../db/prisma.js")>();
  const cliente = real.getPrisma().$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (registro.ligado) registro.operacoes.push({ model, operation });
          return query(args);
        },
      },
    },
  });
  return { ...real, getPrisma: () => cliente };
});

async function anotando<T>(fn: () => Promise<T>) {
  registro.operacoes = [];
  registro.ligado = true;
  try {
    const resultado = await fn();
    return { resultado, operacoes: [...registro.operacoes] };
  } finally {
    registro.ligado = false;
  }
}

/** 10:00 em São Paulo. */
const CONSUMO = new Date("2031-03-10T13:00:00.000Z");
const CONSUMO_ANTIGO = new Date("2031-01-01T13:00:00.000Z");
const DIA = 86_400_000;
const JANELA_30 = limitesDaJanelaDeCusto(marcadorDoDiaComercialDe(CONSUMO), 30);
const JANELA_90 = limitesDaJanelaDeCusto(marcadorDoDiaComercialDe(CONSUMO), 90);
const INEXISTENTE = "00000000-0000-0000-0000-000000000000";

const ORDENS = [
  "semConsumo",
  "completo",
  "ausente",
  "parcial",
  "clienteEVeridi",
  "soCliente",
  "multiplos",
  "loteCompartilhado",
  "extra",
  "decimais",
  "diaComercial",
  "bordas",
  "ultimoAntigo",
  "quantidadeZero",
  "loteSemCusto",
  "custoZero",
  "recebimentoDepois",
  "doisDiasRecente",
  "doisDiasAntiga",
  "noIntervalo",
  "semLoteSemCusto",
] as const;
type Ordem = (typeof ORDENS)[number];

const QUALIDADE: Record<Ordem, CostQuality> = {
  semConsumo: "NO_COST",
  completo: "REAL",
  ausente: "NO_COST",
  parcial: "PARTIAL",
  clienteEVeridi: "REAL",
  soCliente: "NO_COST",
  multiplos: "ESTIMATED",
  loteCompartilhado: "REAL",
  extra: "REAL",
  decimais: "ESTIMATED",
  diaComercial: "PARTIAL",
  bordas: "ESTIMATED",
  ultimoAntigo: "ESTIMATED",
  quantidadeZero: "ESTIMATED",
  loteSemCusto: "ESTIMATED",
  custoZero: "REAL",
  recebimentoDepois: "NO_COST",
  doisDiasRecente: "ESTIMATED",
  doisDiasAntiga: "NO_COST",
  noIntervalo: "ESTIMATED",
  semLoteSemCusto: "NO_COST",
};

type Materia = { id: string; code: string; name: string };

const op = {} as Record<Ordem, string>;
const fixture = {} as {
  mpSemCusto: Materia;
  mpSemLoteSemCusto: Materia;
  mpDepois: Materia;
  loteSemCusto: string;
  loteDoLoteSemCusto: string;
  oc: string;
  fornecedor: string;
};
const criados = {
  itens: [] as string[],
  recebimentos: [] as string[],
  ocs: [] as string[],
  ordens: [] as string[],
  produtos: [] as string[],
  clientes: [] as string[],
  fornecedores: [] as string[],
};

/** A "segunda conexão" do teste de retrato: outro cliente, outro pool. */
const escritor = new PrismaClient();

beforeAll(async () => {
  const prisma = getPrisma();
  const m = `LOTE${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  let sequencia = 0;
  const proximo = () => String((sequencia += 1)).padStart(3, "0");

  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });
  const fornecedor = await prisma.supplier.create({ data: { code: `FOR-${m}`, legalName: `Fornecedor ${m}`, active: true } });
  criados.fornecedores.push(fornecedor.id);
  const cliente = await prisma.customer.create({ data: { code: `CLI-${m}`, legalName: `Dono do Material ${m}`, active: true } });
  criados.clientes.push(cliente.id);
  const oc = await prisma.purchaseOrder.create({
    data: {
      code: `OC-${m}`,
      supplierId: fornecedor.id,
      supplierCode: fornecedor.code,
      supplierName: fornecedor.legalName,
      orderDate: new Date("2030-01-01T12:00:00.000Z"),
      status: "RECEIVED",
    },
  });
  criados.ocs.push(oc.id);
  Object.assign(fixture, { oc: oc.id, fornecedor: fornecedor.id });

  const item = async (nome: string, controlsLot = true): Promise<Materia> => {
    const criado = await prisma.item.create({
      data: {
        type: "RAW_MATERIAL",
        code: `MP-${nome}-${m}`,
        name: `Matéria ${nome} ${m}`,
        unitCode: "kg",
        controlsLot,
        controlsExpiry: false,
        requiresQualityRelease: false,
        active: true,
      },
      select: { id: true, code: true, name: true },
    });
    criados.itens.push(criado.id);
    return criado;
  };
  const acabado = await prisma.item.create({
    data: {
      type: "FINISHED_PRODUCT",
      code: `PA-${m}`,
      name: `Acabado ${m}`,
      unitCode: "kg",
      controlsLot: false,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  criados.itens.push(acabado.id);
  const produto = await prisma.product.create({
    data: { code: `PROD-${m}`, name: `Produto ${m}`, customerId: await fixtureCustomerId(), finishedProductItemId: acabado.id },
  });
  criados.produtos.push(produto.id);

  const loteDeAbertura = async (mp: Materia) =>
    (
      await prisma.lot.create({
        data: { code: `LT-${m}-${proximo()}`, origin: "OPENING_BALANCE", itemId: mp.id, initialReceivedQuantity: "1000", status: "AVAILABLE" },
      })
    ).id;
  /** Recebimento de uma linha; com `comLote`, a linha cria o lote e devolve o id dele. */
  const receber = async (
    mp: Materia,
    receivedAt: Date,
    linha: { quantidade: string; custo: string | null; comLote?: boolean; doCliente?: boolean },
  ) => {
    const origem = linha.doCliente
      ? ({ sourceType: "CUSTOMER_SUPPLIED", customerId: cliente.id } as const)
      : ({ sourceType: "PURCHASE_ORDER", purchaseOrderId: oc.id, supplierId: fornecedor.id } as const);
    const recebimento = await prisma.receipt.create({ data: { code: `REC-${m}-${proximo()}`, receivedAt, ...origem } });
    criados.recebimentos.push(recebimento.id);
    const lote = linha.comLote
      ? await prisma.lot.create({
          data: {
            code: `LT-${m}-${proximo()}`,
            origin: "RECEIPT",
            itemId: mp.id,
            initialReceivedQuantity: "1000",
            status: "AVAILABLE",
            ...(linha.doCliente ? ({ ownerType: "CUSTOMER", ownerCustomerId: cliente.id } as const) : { supplierId: fornecedor.id }),
          },
        })
      : null;
    await prisma.receiptLine.create({
      data: {
        receiptId: recebimento.id,
        itemId: mp.id,
        itemCode: mp.code,
        itemName: mp.name,
        receivedQuantity: linha.quantidade,
        unitCode: "kg",
        lotId: lote?.id ?? null,
        actualUnitCost: linha.custo,
      },
    });
    return lote?.id ?? null;
  };

  const antes = (dias: number) => new Date(CONSUMO.getTime() - dias * DIA);

  const mpReal1 = await item("REAL1");
  const loteReal1 = (await receber(mpReal1, antes(20), { quantidade: "500", custo: "12.5", comLote: true }))!;
  const mpReal2 = await item("REAL2");
  const loteReal2 = (await receber(mpReal2, antes(20), { quantidade: "500", custo: "7.25", comLote: true }))!;
  const mpSemCusto = await item("SEMCUSTO");
  const loteSemCusto = await loteDeAbertura(mpSemCusto);
  const mpCliente = await item("CLIENTE");
  // O cliente mandou o material COM custo na linha: nem assim é custo da Veridi.
  const loteCliente = (await receber(mpCliente, antes(15), { quantidade: "80", custo: "99.99", comLote: true, doCliente: true }))!;
  const mp30 = await item("D30");
  await receber(mp30, antes(10), { quantidade: "10.5", custo: "4" });
  await receber(mp30, antes(10), { quantidade: "30.25", custo: "5.5" });
  const lote30 = await loteDeAbertura(mp30);
  const mp90SemLote = await item("D90SEMLOTE", false);
  await receber(mp90SemLote, antes(60), { quantidade: "8", custo: "3" });
  const mpDecimal = await item("DECIMAL");
  const loteDecimal = (await receber(mpDecimal, antes(20), { quantidade: "900000", custo: "0.00000001", comLote: true }))!;
  // Fim do dia comercial do consumo: 23:59:59.999 entra; 00:00:00.000 do dia seguinte, não.
  const mpFimDoDia = await item("FIMDODIA");
  await receber(mpFimDoDia, JANELA_30.fim, { quantidade: "5", custo: "2" });
  const loteFimDoDia = await loteDeAbertura(mpFimDoDia);
  const mpDiaSeguinte = await item("DIASEGUINTE");
  await receber(mpDiaSeguinte, new Date(JANELA_30.fim.getTime() + 1), { quantidade: "5", custo: "2" });
  const loteDiaSeguinte = await loteDeAbertura(mpDiaSeguinte);
  const mpBorda30 = await item("BORDA30");
  await receber(mpBorda30, JANELA_30.inicio, { quantidade: "1", custo: "30" });
  const loteBorda30 = await loteDeAbertura(mpBorda30);
  const mpBorda90 = await item("BORDA90");
  await receber(mpBorda90, new Date(JANELA_30.inicio.getTime() - 1), { quantidade: "1", custo: "90" });
  const loteBorda90 = await loteDeAbertura(mpBorda90);
  const mpBordaUltimo = await item("BORDAULTIMO");
  await receber(mpBordaUltimo, new Date(JANELA_90.inicio.getTime() - 1), { quantidade: "1", custo: "91" });
  const loteBordaUltimo = await loteDeAbertura(mpBordaUltimo);
  const mpUltimo = await item("ULTIMO");
  await receber(mpUltimo, antes(300), { quantidade: "5", custo: "100" });
  await receber(mpUltimo, antes(200), { quantidade: "5", custo: "150.5" });
  const loteUltimo = await loteDeAbertura(mpUltimo);
  const mpQtdZero = await item("QTDZERO");
  await receber(mpQtdZero, antes(5), { quantidade: "0", custo: "5" });
  const loteQtdZero = await loteDeAbertura(mpQtdZero);
  const mpLoteSemCusto = await item("LOTESEMCUSTO");
  const loteDoLoteSemCusto = (await receber(mpLoteSemCusto, antes(40), { quantidade: "90", custo: null, comLote: true }))!;
  await receber(mpLoteSemCusto, antes(10), { quantidade: "15", custo: "6.6" });
  const mpZero = await item("ZERO");
  const loteZero = (await receber(mpZero, antes(25), { quantidade: "60", custo: "0", comLote: true }))!;
  const mpDepois = await item("DEPOIS");
  await receber(mpDepois, new Date(CONSUMO.getTime() + 2 * DIA), { quantidade: "40", custo: "8.25" });
  const loteDepois = await loteDeAbertura(mpDepois);
  const mpDoisDias = await item("DOISDIAS");
  await receber(mpDoisDias, new Date("2031-02-01T15:00:00.000Z"), { quantidade: "12", custo: "4.4" });
  const loteDoisDias = await loteDeAbertura(mpDoisDias);
  const mpNoIntervalo = await item("NOINTERVALO");
  await receber(mpNoIntervalo, new Date("2030-11-01T15:00:00.000Z"), { quantidade: "3", custo: "33" });
  const loteNoIntervalo = await loteDeAbertura(mpNoIntervalo);
  const mpSemLoteSemCusto = await item("SEMLOTESEMCUSTO", false);
  Object.assign(fixture, { mpSemCusto, mpSemLoteSemCusto, mpDepois, loteSemCusto, loteDoLoteSemCusto });

  // createdAt distinto por consumo: a ordem dos consumos no DTO é a da criação.
  let criadoEm = Date.UTC(2031, 5, 1);
  let concluidaEm = Date.UTC(2098, 0, 1);
  type Consumo = { mp: Materia; lotId: string | null; quantidade: string; em?: Date; extraDoAnterior?: boolean };
  const ordem = async (nome: Ordem, consumos: Consumo[], producao?: string) => {
    const criada = await prisma.productionOrder.create({
      data: {
        code: `OP-${m}-${proximo()}`,
        productId: produto.id,
        productCode: produto.code,
        productName: produto.name,
        plannedQuantity: "10",
        outputUnitCode: "kg",
        status: "COMPLETED",
        completedAt: new Date((concluidaEm += 60_000)),
      },
    });
    criados.ordens.push(criada.id);
    op[nome] = criada.id;
    const reserva = consumos.length > 0 ? await prisma.materialReservation.create({ data: { productionOrderId: criada.id, status: "RELEASED" } }) : null;
    let anterior: { requisito: string; linha: string } | null = null;
    for (const [posicao, consumo] of consumos.entries()) {
      if (!consumo.extraDoAnterior || !anterior) {
        const requisito = await prisma.productionOrderRequirement.create({
          data: {
            productionOrderId: criada.id,
            itemId: consumo.mp.id,
            itemCode: consumo.mp.code,
            itemName: consumo.mp.name,
            itemType: "RAW_MATERIAL",
            formulaQuantity: "1",
            formulaUnitCode: "kg",
            requiredQuantity: consumo.quantidade,
            stockUnitCode: "kg",
            position: posicao,
          },
        });
        const linha = await prisma.materialReservationLine.create({
          data: { reservationId: reserva!.id, productionOrderRequirementId: requisito.id, itemId: consumo.mp.id, lotId: consumo.lotId, quantity: consumo.quantidade },
        });
        anterior = { requisito: requisito.id, linha: linha.id };
      }
      await prisma.productionConsumption.create({
        data: {
          productionOrderId: criada.id,
          productionOrderRequirementId: anterior.requisito,
          reservationLineId: anterior.linha,
          itemId: consumo.mp.id,
          lotId: consumo.lotId,
          quantity: consumo.quantidade,
          consumedAt: consumo.em ?? CONSUMO,
          createdAt: new Date((criadoEm += 1_000)),
        },
      });
    }
    if (producao) await prisma.productionOutput.create({ data: { productionOrderId: criada.id, quantity: producao, producedAt: CONSUMO } });
  };

  const doLote = (mp: Materia, lotId: string, quantidade: string, extra: Partial<Consumo> = {}): Consumo => ({ mp, lotId, quantidade, ...extra });
  await ordem("semConsumo", [], "3.5");
  await ordem("completo", [doLote(mpReal1, loteReal1, "2.5"), doLote(mpReal2, loteReal2, "2")], "4");
  await ordem("ausente", [doLote(mpSemCusto, loteSemCusto, "3")]);
  await ordem("parcial", [doLote(mpReal1, loteReal1, "1"), doLote(mpSemCusto, loteSemCusto, "2")]);
  await ordem("clienteEVeridi", [doLote(mpCliente, loteCliente, "5"), doLote(mpReal2, loteReal2, "2")]);
  await ordem("soCliente", [doLote(mpCliente, loteCliente, "1")]);
  await ordem("multiplos", [doLote(mpReal1, loteReal1, "1"), doLote(mp30, lote30, "2"), { mp: mp90SemLote, lotId: null, quantidade: "3" }]);
  await ordem("loteCompartilhado", [doLote(mpReal1, loteReal1, "4")]);
  await ordem("extra", [doLote(mpReal2, loteReal2, "1"), doLote(mpReal2, loteReal2, "0.333333", { extraDoAnterior: true })]);
  await ordem("decimais", [doLote(mpDecimal, loteDecimal, "123456.789012345678"), doLote(mp30, lote30, "0.100000000001")], "9.876543210123");
  await ordem("diaComercial", [doLote(mpFimDoDia, loteFimDoDia, "1"), doLote(mpDiaSeguinte, loteDiaSeguinte, "1")]);
  await ordem("bordas", [doLote(mpBorda30, loteBorda30, "1"), doLote(mpBorda90, loteBorda90, "1"), doLote(mpBordaUltimo, loteBordaUltimo, "1")]);
  await ordem("ultimoAntigo", [doLote(mpUltimo, loteUltimo, "1")]);
  await ordem("quantidadeZero", [doLote(mpQtdZero, loteQtdZero, "2")]);
  await ordem("loteSemCusto", [doLote(mpLoteSemCusto, loteDoLoteSemCusto, "1")]);
  await ordem("custoZero", [doLote(mpZero, loteZero, "3")]);
  await ordem("recebimentoDepois", [doLote(mpDepois, loteDepois, "1")]);
  await ordem("doisDiasRecente", [doLote(mpDoisDias, loteDoisDias, "1")]);
  await ordem("doisDiasAntiga", [doLote(mpDoisDias, loteDoisDias, "1", { em: CONSUMO_ANTIGO })]);
  await ordem("noIntervalo", [doLote(mpNoIntervalo, loteNoIntervalo, "1")]);
  await ordem("semLoteSemCusto", [{ mp: mpSemLoteSemCusto, lotId: null, quantidade: "2" }]);
}, 120_000);

afterAll(async () => {
  const prisma = getPrisma();
  const ordens = { productionOrderId: { in: criados.ordens } };
  await prisma.productionOutput.deleteMany({ where: ordens });
  await prisma.productionConsumption.deleteMany({ where: ordens });
  await prisma.materialReservationLine.deleteMany({ where: { reservation: ordens } });
  await prisma.materialReservation.deleteMany({ where: ordens });
  await prisma.productionOrderRequirement.deleteMany({ where: ordens });
  await prisma.productionOrder.deleteMany({ where: { id: { in: criados.ordens } } });
  await prisma.receiptLine.deleteMany({ where: { receiptId: { in: criados.recebimentos } } });
  await prisma.receipt.deleteMany({ where: { id: { in: criados.recebimentos } } });
  await prisma.purchaseOrder.deleteMany({ where: { id: { in: criados.ocs } } });
  await prisma.lot.deleteMany({ where: { itemId: { in: criados.itens } } });
  await prisma.product.deleteMany({ where: { id: { in: criados.produtos } } });
  await prisma.item.deleteMany({ where: { id: { in: criados.itens } } });
  await prisma.customer.deleteMany({ where: { id: { in: criados.clientes } } });
  await prisma.supplier.deleteMany({ where: { id: { in: criados.fornecedores } } });
  await escritor.$disconnect();
});

const ids = () => ORDENS.map((nome) => op[nome]);
const qualidades = (custos: Map<string, ProductionOrderMaterialCostDTO>) =>
  Object.fromEntries(ORDENS.map((nome) => [nome, custos.get(op[nome])?.quality]));
const fontes = (custo: ProductionOrderMaterialCostDTO | undefined): CostSource[] =>
  (custo?.consumptions ?? []).map((consumo) => consumo.costSource);

describe("custo de material em lote — o mesmo custo da função unitária, OP por OP", () => {
  it("cada caso da regra sai do lote igual à função unitária e ao que a regra diz", { timeout: 60_000 }, async () => {
    const unitario = new Map<string, ProductionOrderMaterialCostDTO | null>();
    for (const id of [...ids(), INEXISTENTE]) unitario.set(id, await findProductionOrderMaterialCost(id));
    const emLote = await findProductionOrderMaterialCosts([...ids(), INEXISTENTE, op.completo]);

    // OP que não existe: fora do mapa, como o null da função unitária.
    expect(unitario.get(INEXISTENTE)).toBeNull();
    expect(emLote.has(INEXISTENTE)).toBe(false);
    expect(emLote.size).toBe(ORDENS.length);
    for (const nome of ORDENS) expect(emLote.get(op[nome]), nome).toEqual(unitario.get(op[nome]));

    expect(qualidades(emLote)).toEqual(QUALIDADE);

    // A) sem consumo: sem custo, sem linha, com a produção somada.
    expect(emLote.get(op.semConsumo)).toMatchObject({ consumptions: [], totalMaterialCost: null, knownMaterialCostSubtotal: null, producedQuantity: "3.5", materialUnitCost: null });
    // B) completo: 2,5 × 12,5 + 2 × 7,25 = 45,75, sobre 4 produzidos.
    expect(emLote.get(op.completo)).toMatchObject({ totalMaterialCost: "45.75", knownMaterialCostSubtotal: "45.75", materialUnitCost: "11.43750000", missingCostItems: [] });
    // C) ausente: desconhecido é null, nunca zero.
    expect(emLote.get(op.ausente)).toMatchObject({ totalMaterialCost: null, knownMaterialCostSubtotal: null, materialUnitCost: null, missingCostItems: [fixture.mpSemCusto.code] });
    expect(emLote.get(op.ausente)!.consumptions[0]).toMatchObject({ unitCost: null, costSource: "NO_COST", materialCost: null });
    expect(emLote.get(op.parcial)).toMatchObject({ totalMaterialCost: null, knownMaterialCostSubtotal: "12.50", missingCostItems: [fixture.mpSemCusto.code] });
    // D) cliente: fora do total e da qualidade, mesmo com custo na linha do recebimento.
    expect(emLote.get(op.clienteEVeridi)).toMatchObject({ totalMaterialCost: "14.50", hasCustomerSuppliedMaterials: true, customerSuppliedConsumptionCount: 1, missingCostItems: [] });
    expect(emLote.get(op.clienteEVeridi)!.consumptions[0]).toMatchObject({ ownerType: "CUSTOMER", unitCost: null, costSource: "NO_COST", materialCost: null });
    expect(emLote.get(op.soCliente)).toMatchObject({ totalMaterialCost: null, knownMaterialCostSubtotal: null, hasCustomerSuppliedMaterials: true, missingCostItems: [] });
    // E) mais de um consumo, cada um com a sua fonte.
    expect(fontes(emLote.get(op.multiplos))).toEqual(["REAL", "ESTIMATED_30D", "ESTIMATED_90D"]);
    // F) o mesmo lote em outra OP. G) consumo além do reservado, no mesmo lote.
    expect(emLote.get(op.loteCompartilhado)).toMatchObject({ totalMaterialCost: "50.00" });
    expect(emLote.get(op.extra)).toMatchObject({ totalMaterialCost: "9.67" });
    expect(emLote.get(op.extra)!.consumptions.map((consumo) => consumo.quantity)).toEqual(["1", "0.333333"]);
    // H) decimais nas duas pontas.
    expect(emLote.get(op.decimais)!.consumptions.map((consumo) => [consumo.quantity, consumo.unitCost])).toEqual([
      ["123456.789012345678", "0.00000001"],
      ["0.100000000001", "5.11349693"],
    ]);
    // Dia comercial do consumo e bordas das janelas.
    expect(fontes(emLote.get(op.diaComercial))).toEqual(["ESTIMATED_30D", "NO_COST"]);
    expect(fontes(emLote.get(op.bordas))).toEqual(["ESTIMATED_30D", "ESTIMATED_90D", "LAST_REAL_COST"]);
    expect(emLote.get(op.ultimoAntigo)!.consumptions[0]).toMatchObject({ costSource: "LAST_REAL_COST", unitCost: "150.50000000" });
    expect(emLote.get(op.quantidadeZero)!.consumptions[0]).toMatchObject({ costSource: "LAST_REAL_COST", unitCost: "5.00000000", materialCost: "10.00" });
    expect(emLote.get(op.loteSemCusto)!.consumptions[0]).toMatchObject({ costSource: "ESTIMATED_30D", unitCost: "6.60000000" });
    // Zero informado é custo conhecido.
    expect(emLote.get(op.custoZero)).toMatchObject({ totalMaterialCost: "0.00", knownMaterialCostSubtotal: "0.00" });
    expect(emLote.get(op.custoZero)!.consumptions[0]).toMatchObject({ costSource: "REAL", unitCost: "0.00000000", materialCost: "0.00" });
    // Compra depois do dia do consumo não vale; o mesmo item, em dias diferentes, na mesma chamada.
    expect(fontes(emLote.get(op.recebimentoDepois))).toEqual(["NO_COST"]);
    expect(fontes(emLote.get(op.doisDiasRecente))).toEqual(["ESTIMATED_90D"]);
    expect(fontes(emLote.get(op.doisDiasAntiga))).toEqual(["NO_COST"]);
    expect(fontes(emLote.get(op.noIntervalo))).toEqual(["LAST_REAL_COST"]);
    expect(fontes(emLote.get(op.semLoteSemCusto))).toEqual(["NO_COST"]);
  });

  it("qualquer recorte de OPs dá o mesmo custo — o intervalo carregado muda, a conta não", { timeout: 60_000 }, async () => {
    const todas = await findProductionOrderMaterialCosts(ids());
    for (const nome of ORDENS) {
      const sozinha = await findProductionOrderMaterialCosts([op[nome]]);
      expect(sozinha.get(op[nome]), nome).toEqual(todas.get(op[nome]));
    }
    const recorte = await findProductionOrderMaterialCosts([op.noIntervalo, op.bordas, op.ultimoAntigo, op.doisDiasAntiga]);
    for (const id of recorte.keys()) expect(recorte.get(id)).toEqual(todas.get(id));
  });

  it("resolve em lote: as consultas não crescem com o número de OPs", { timeout: 60_000 }, async () => {
    const umaOp = await anotando(() => findProductionOrderMaterialCosts([op.bordas]));
    const todas = await anotando(() => findProductionOrderMaterialCosts(ids()));
    for (const { operacoes } of [umaOp, todas]) {
      expect(operacoes.filter((o) => o.operation === "findUnique" || o.operation === "findFirst")).toEqual([]);
      expect(operacoes.filter((o) => o.model === "ProductionOrder")).toEqual([{ model: "ProductionOrder", operation: "findMany" }]);
      expect(operacoes.filter((o) => o.model === "ReceiptLine").length).toBeLessThanOrEqual(3);
    }
    // 21 OPs e 30 consumos: o mesmo número de consultas de uma OP com três fontes.
    expect(todas.operacoes.length).toBe(umaOp.operacoes.length);
  });

  it("o Painel lista como custo incompleto exatamente as OPs com consumo PARTIAL ou NO_COST", { timeout: 60_000 }, async () => {
    const lista = await getProductionOrdersWithIncompleteCost(getPrisma());
    const nossas = lista.filter((ordem) => criados.ordens.includes(ordem.id)).map((ordem) => ordem.id);
    const esperadas = ORDENS.filter((nome) => nome !== "semConsumo" && ["PARTIAL", "NO_COST"].includes(QUALIDADE[nome]))
      .map((nome) => op[nome])
      .reverse(); // concluídas por último primeiro
    expect(nossas).toEqual(esperadas);
  });

  it("dentro de um retrato, o lote lê do contexto recebido: escrita de outra conexão no meio não entra", { timeout: 60_000 }, async () => {
    const prisma = getPrisma();
    const novos: { recebimentos: string[]; consumo: string | null } = { recebimentos: [], consumo: null };
    const receberComOutraConexao = async (mp: Materia, receivedAt: Date, custo: string) => {
      const recebimento = await escritor.receipt.create({
        data: {
          code: `REC-RETRATO-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          sourceType: "PURCHASE_ORDER",
          purchaseOrderId: fixture.oc,
          supplierId: fixture.fornecedor,
          receivedAt,
          lines: { create: [{ itemId: mp.id, itemCode: mp.code, itemName: mp.name, receivedQuantity: "10", unitCode: "kg", actualUnitCost: custo }] },
        },
      });
      novos.recebimentos.push(recebimento.id);
      criados.recebimentos.push(recebimento.id);
    };

    try {
      const retrato = await prisma.$transaction(
        async (tx) => {
          const antes = await findProductionOrderMaterialCosts(ids(), tx);
          const listaAntes = await getProductionOrdersWithIncompleteCost(tx);

          // Uma escrita por caminho do lote: custo do lote, janela do item, último
          // real anterior ao intervalo e os consumos da OP.
          await escritor.receiptLine.updateMany({ where: { lotId: fixture.loteDoLoteSemCusto }, data: { actualUnitCost: "3.3" } });
          await receberComOutraConexao(fixture.mpSemCusto, new Date(CONSUMO.getTime() - 5 * DIA), "2");
          await receberComOutraConexao(fixture.mpDepois, new Date(CONSUMO.getTime() - 400 * DIA), "9");
          const doCompleto = await escritor.productionConsumption.findFirstOrThrow({ where: { productionOrderId: op.completo } });
          novos.consumo = (
            await escritor.productionConsumption.create({
              data: {
                productionOrderId: op.completo,
                productionOrderRequirementId: doCompleto.productionOrderRequirementId,
                reservationLineId: doCompleto.reservationLineId,
                itemId: fixture.mpSemLoteSemCusto.id,
                lotId: null,
                quantity: "1",
                consumedAt: CONSUMO,
                createdAt: new Date(Date.UTC(2031, 11, 31)),
              },
            })
          ).id;

          return {
            antes,
            durante: await findProductionOrderMaterialCosts(ids(), tx),
            listaAntes,
            listaDurante: await getProductionOrdersWithIncompleteCost(tx),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 },
      );

      expect(retrato.durante).toEqual(retrato.antes);
      expect(retrato.listaDurante).toEqual(retrato.listaAntes);

      // Fora do retrato a escrita aparece exatamente nessas OPs — o teste não é vazio.
      const depois = await findProductionOrderMaterialCosts(ids());
      expect(qualidades(depois)).toEqual({
        ...QUALIDADE,
        loteSemCusto: "REAL",
        ausente: "ESTIMATED",
        parcial: "ESTIMATED",
        recebimentoDepois: "ESTIMATED",
        completo: "PARTIAL",
      });
    } finally {
      if (novos.consumo) await escritor.productionConsumption.delete({ where: { id: novos.consumo } });
      await escritor.receiptLine.deleteMany({ where: { receiptId: { in: novos.recebimentos } } });
      await escritor.receipt.deleteMany({ where: { id: { in: novos.recebimentos } } });
      await escritor.receiptLine.updateMany({ where: { lotId: fixture.loteDoLoteSemCusto }, data: { actualUnitCost: null } });
    }
  });
});
