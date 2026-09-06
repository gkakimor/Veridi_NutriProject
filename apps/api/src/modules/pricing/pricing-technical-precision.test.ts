import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import type { UomDimension } from "@prisma/client";
import { calcularTotaisOrcamento } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import "../../lib/decimal.js";

/**
 * Preço TÉCNICO da precificação em alta precisão — PREC-P-TECH.
 *
 * A cadeia começa num motor de 40 dígitos e termina num documento comercial de
 * quatro casas, e entre os dois havia dois cortes que ninguém tinha decidido:
 * o INSERT da ativação, onde o PostgreSQL reduzia o preço do motor para seis
 * casas sem `.toFixed()` no código, e o congelamento da proveniência no envio
 * do Orçamento, que também parava em seis.
 *
 * O que este arquivo prova:
 *
 * - preço técnico — faixa manual, sugerido e selecionado — preserva oito casas,
 *   e acima disso a fronteira RECUSA em vez de deixar o banco arredondar;
 * - a proveniência congelada na linha do Orçamento carrega as mesmas oito;
 * - o fechamento comercial de oito para quatro é DELIBERADO, num ponto só
 *   (`fecharPrecoUnitarioComercial`), e não some no meio de um `update`;
 * - o preço comercial acima de quatro casas também é recusado;
 * - a mesma linha carrega dois números de propósito: `4.05318764` técnico e
 *   `4.0532` comercial, e nenhum elo comercial adiante volta para oito;
 * - o total do documento continua saindo da regra #15, sobre o preço
 *   COMERCIAL — o snapshot técnico não vira operando de total.
 *
 * Caminho REAL, pela API. Um `prisma.create` direto provaria que o PostgreSQL
 * guarda oito casas e nada sobre o caminho que o operador percorre.
 *
 * A massa leva o prefixo `PREC-PTECH` e é removida ao final.
 */

/** O preço técnico do acceptance: não pode virar `4.053188` em lugar nenhum. */
const PRECO_TECNICO = "4.05318764";
/** O mesmo preço depois do fechamento comercial. */
const PRECO_COMERCIAL = "4.0532";

type App = ReturnType<typeof buildTestApp>;

const projetos: string[] = [];
const produtos: string[] = [];
const itens: string[] = [];
const clientes: string[] = [];
const fornecedores: string[] = [];
const recursos: string[] = [];
const ordensDeCompra: string[] = [];
const recebimentos: string[] = [];
const pedidos: string[] = [];

let contador = 0;
const marca = () => `${Date.now().toString(36)}${(contador += 1)}`.toUpperCase();

beforeAll(async () => {
  const prisma = getPrisma();
  const unidades: { code: string; label: string; dimension: UomDimension; toBaseFactor: string }[] =
    [
      { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
      { code: "un", label: "Unidade", dimension: "COUNT", toBaseFactor: "1" },
    ];
  for (const u of unidades) {
    await prisma.unitOfMeasure.upsert({ where: { code: u.code }, update: {}, create: u });
  }
});

afterAll(async () => {
  const prisma = getPrisma();

  const todosPedidos = new Set(pedidos);
  if (projetos.length > 0) {
    const daOrigem = await prisma.customerOrder.findMany({
      where: { sourceProjectId: { in: projetos } },
      select: { id: true },
    });
    for (const pedido of daOrigem) todosPedidos.add(pedido.id);
  }
  const pedidoIds = [...todosPedidos];
  if (pedidoIds.length > 0) {
    await prisma.billingLine.deleteMany({
      where: { billing: { customerOrderId: { in: pedidoIds } } },
    });
    await prisma.billing.deleteMany({ where: { customerOrderId: { in: pedidoIds } } });
    await prisma.shipmentLine.deleteMany({
      where: { shipment: { customerOrderId: { in: pedidoIds } } },
    });
    await prisma.shipment.deleteMany({ where: { customerOrderId: { in: pedidoIds } } });
    await prisma.customerOrderReservationLine.deleteMany({
      where: { reservation: { customerOrderId: { in: pedidoIds } } },
    });
    await prisma.customerOrderReservation.deleteMany({
      where: { customerOrderId: { in: pedidoIds } },
    });
    await prisma.productionOrder.deleteMany({ where: { customerOrderId: { in: pedidoIds } } });
    await prisma.customerOrderLine.deleteMany({ where: { customerOrderId: { in: pedidoIds } } });
    await prisma.customerOrder.deleteMany({ where: { id: { in: pedidoIds } } });
  }

  if (projetos.length > 0) {
    await prisma.quoteLine.deleteMany({ where: { quoteVersion: { projectId: { in: projetos } } } });
    await prisma.quoteVersion.deleteMany({ where: { projectId: { in: projetos } } });
    await prisma.projectStatusHistory.deleteMany({ where: { projectId: { in: projetos } } });
  }

  const produtosDaMassa = await prisma.product.findMany({
    where: { OR: [{ id: { in: produtos } }, { originProjectId: { in: projetos } }] },
    select: { id: true, finishedProductItemId: true },
  });
  const produtoIds = produtosDaMassa.map((p) => p.id);
  const acabadosIds = produtosDaMassa
    .map((p) => p.finishedProductItemId)
    .filter((id): id is string => id !== null);

  if (produtoIds.length > 0) {
    await prisma.pricingTier.deleteMany({
      where: { pricingVersion: { productId: { in: produtoIds } } },
    });
    await prisma.pricingVersion.deleteMany({ where: { productId: { in: produtoIds } } });
    await prisma.industrialCostCalculation.deleteMany({ where: { productId: { in: produtoIds } } });
    await prisma.industrialCostResourceUsage.deleteMany({
      where: { industrialCostVersion: { productId: { in: produtoIds } } },
    });
    await prisma.industrialCostLine.deleteMany({
      where: { industrialCostVersion: { productId: { in: produtoIds } } },
    });
    await prisma.industrialCostVersion.deleteMany({ where: { productId: { in: produtoIds } } });
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: produtoIds } } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: produtoIds } } });
    await prisma.quoteLine.deleteMany({ where: { productId: { in: produtoIds } } });
    await prisma.projectProduct.deleteMany({ where: { productId: { in: produtoIds } } });
    await prisma.product.deleteMany({ where: { id: { in: produtoIds } } });
  }

  if (projetos.length > 0) await prisma.project.deleteMany({ where: { id: { in: projetos } } });
  if (recursos.length > 0) {
    await prisma.industrialResourceRate.deleteMany({
      where: { industrialResourceId: { in: recursos } },
    });
    await prisma.industrialResource.deleteMany({ where: { id: { in: recursos } } });
  }
  if (recebimentos.length > 0) {
    await prisma.receiptLine.deleteMany({ where: { receiptId: { in: recebimentos } } });
    await prisma.receipt.deleteMany({ where: { id: { in: recebimentos } } });
  }
  if (ordensDeCompra.length > 0) {
    await prisma.purchaseOrderLine.deleteMany({
      where: { purchaseOrderId: { in: ordensDeCompra } },
    });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: ordensDeCompra } } });
  }
  const itemIds = [...itens, ...acabadosIds];
  if (itemIds.length > 0) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.lot.deleteMany({ where: { itemId: { in: itemIds } } });
    await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
  }
  if (fornecedores.length > 0) {
    await prisma.supplier.deleteMany({ where: { id: { in: fornecedores } } });
  }
  if (clientes.length > 0) await prisma.customer.deleteMany({ where: { id: { in: clientes } } });
});

async function criarCliente() {
  const prisma = getPrisma();
  const m = marca();
  const cliente = await prisma.customer.create({
    data: { code: `CLI-PREC-PTECH-${m}`, legalName: `Cliente PREC-PTECH ${m}`, active: true },
  });
  clientes.push(cliente.id);
  return cliente;
}

async function criarProjeto(app: App) {
  const cliente = await criarCliente();
  const projeto = (
    await app.inject({
      method: "POST",
      url: "/projects",
      payload: {
        name: `Projeto PREC-PTECH ${marca()}`,
        customerId: cliente.id,
        entryDate: new Date().toISOString(),
      },
    })
  ).json();
  projetos.push(projeto.id);
  return projeto;
}

async function criarMaterial() {
  const prisma = getPrisma();
  const m = marca();
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-PREC-PTECH-${m}`,
      name: `Insumo PREC-PTECH ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  itens.push(item.id);
  return item;
}

/** Custo real de aquisição — a única origem legítima de custo do sistema. */
async function receberComCusto(
  app: App,
  params: { itemId: string; quantity: string; unitCost: string },
) {
  const prisma = getPrisma();
  const m = marca();
  const fornecedor = await prisma.supplier.create({
    data: { code: `FOR-PREC-PTECH-${m}`, legalName: `Fornecedor PREC-PTECH ${m}`, active: true },
  });
  fornecedores.push(fornecedor.id);

  const oc = (
    await app.inject({
      method: "POST",
      url: "/purchase-orders",
      payload: {
        supplierId: fornecedor.id,
        orderDate: new Date().toISOString(),
        lines: [{ itemId: params.itemId, orderedQuantity: params.quantity }],
      },
    })
  ).json();
  ordensDeCompra.push(oc.id);
  await app.inject({ method: "POST", url: `/purchase-orders/${oc.id}/confirm` });

  const recebimento = (
    await app.inject({
      method: "POST",
      url: `/purchase-orders/${oc.id}/receipts`,
      payload: {
        receivedAt: new Date().toISOString(),
        lines: [
          {
            purchaseOrderLineId: oc.lines[0].id,
            receivedQuantity: params.quantity,
            supplierLot: `SUP-${m}`,
            actualUnitCost: params.unitCost,
          },
        ],
      },
    })
  ).json();
  recebimentos.push(recebimento.id);
}

interface OpcoesDaCadeia {
  tierQuantity?: string;
  priceMode?: "MANUAL_PRICE" | "TARGET_MARGIN";
  manualUnitPrice?: string;
  targetContributionMarginPercent?: string;
  commissionPercent?: string;
  /** Custo unitário do insumo — o operando preciso que o motor consome. */
  materialUnitCost?: string;
  /** Ativar a versão ao final. Sem isso a faixa fica em rascunho. */
  ativar?: boolean;
}

/** Produto técnico → formulação → EC → CALC → PREC com uma faixa. */
async function cadeiaDePrecificacao(app: App, projectId: string, opcoes: OpcoesDaCadeia = {}) {
  const tecnico = (
    await app.inject({
      method: "POST",
      url: `/projects/${projectId}/technical-product`,
      payload: { finishedUnitCode: "un" },
    })
  ).json();
  const productId = tecnico.productId as string;
  produtos.push(productId);

  const material = await criarMaterial();
  await receberComCusto(app, {
    itemId: material.id,
    quantity: "1000",
    unitCost: opcoes.materialUnitCost ?? "10",
  });

  const formulacao = (
    await app.inject({ method: "GET", url: `/products/${productId}/formulations` })
  ).json();
  const rascunho = formulacao.versions[0].id as string;
  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${rascunho}`,
    payload: {
      basisQuantity: "1",
      components: [{ itemId: material.id, quantity: "0.1", unitCode: "kg" }],
    },
  });
  await app.inject({ method: "POST", url: `/formulation-versions/${rascunho}/activate` });

  const versaoDeCusto = (
    await app.inject({
      method: "POST",
      url: `/products/${productId}/industrial-costs`,
      payload: { referenceOutputQuantity: "1000" },
    })
  ).json();

  const energia = (
    await app.inject({
      method: "POST",
      url: "/industrial-resources",
      payload: { name: `Energia PREC-PTECH ${marca()}`, type: "ENERGY" },
    })
  ).json();
  recursos.push(energia.id);
  await app.inject({
    method: "POST",
    url: `/industrial-resources/${energia.id}/rates`,
    payload: { rateValue: "1" },
  });
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${versaoDeCusto.id}/energy-mode`,
    payload: { energyCalculationMode: "DIRECT" },
  });
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${versaoDeCusto.id}/resource-usages`,
    payload: { resourceId: energia.id, usageQuantity: "0.001", usageBasis: "PER_OUTPUT_UNIT" },
  });
  await app.inject({
    method: "POST",
    url: `/industrial-costs/${versaoDeCusto.id}/activate`,
    payload: { confirmIncomplete: true },
  });

  const calculo = (
    await app.inject({
      method: "POST",
      url: `/industrial-costs/${versaoDeCusto.id}/calculations`,
      payload: {},
    })
  ).json();

  const precificacao = (
    await app.inject({
      method: "POST",
      url: `/products/${productId}/pricing`,
      payload: { industrialCostCalculationId: calculo.id },
    })
  ).json();

  const modo = opcoes.priceMode ?? "MANUAL_PRICE";
  const faixa = await app.inject({
    method: "POST",
    url: `/pricing-versions/${precificacao.id}/tiers`,
    payload: {
      quantity: opcoes.tierQuantity ?? "500",
      priceMode: modo,
      commissionPercent: opcoes.commissionPercent ?? "5",
      ...(modo === "MANUAL_PRICE"
        ? { manualUnitPrice: opcoes.manualUnitPrice ?? PRECO_TECNICO }
        : {
            targetContributionMarginPercent: opcoes.targetContributionMarginPercent ?? "30",
          }),
    },
  });

  if (opcoes.ativar === false) {
    return { productId, calculo, precificacao, faixa, ativa: null };
  }

  const ativa = (
    await app.inject({
      method: "POST",
      url: `/pricing-versions/${precificacao.id}/activate`,
      payload: { confirmIncompleteCost: true },
    })
  ).json();

  return { productId, calculo, precificacao, faixa, ativa };
}

/** Versão de orçamento com a linha do produto do projeto. */
async function criarOrcamento(app: App, projectId: string) {
  const produtosDoProjeto = (
    await app.inject({ method: "GET", url: `/projects/${projectId}/products` })
  ).json().products as { id: string }[];
  const orcamento = (
    await app.inject({ method: "POST", url: `/projects/${projectId}/quote-versions` })
  ).json();
  if (orcamento.lines.length > 0) {
    return { ...orcamento, lineId: orcamento.lines[0].id as string };
  }
  const comLinha = (
    await app.inject({
      method: "POST",
      url: `/quote-versions/${orcamento.id}/lines`,
      payload: { projectProductId: produtosDoProjeto[0]!.id },
    })
  ).json();
  return { ...comLinha, lineId: comLinha.lines[0].id as string };
}

function faixaDe(pricing: { tiers: { id: string }[] }) {
  return pricing.tiers[0]!;
}

const decimal = (valor: string) => new Prisma.Decimal(valor);

describe("preço técnico da faixa preserva 8 casas", () => {
  it("grava, serializa e relê 4,05318764 sem virar 4,053188", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const projeto = await criarProjeto(app);

    const { ativa } = await cadeiaDePrecificacao(app, projeto.id);
    const tier = faixaDe(ativa);

    // API → o DTO devolve o scale da coluna, não menos.
    expect(ativa.tiers[0].manualUnitPrice).toBe(PRECO_TECNICO);
    expect(ativa.tiers[0].selectedUnitPrice).toBe(PRECO_TECNICO);

    // Banco → o valor íntegro, nas duas colunas migradas.
    const gravada = await getPrisma().pricingTier.findUniqueOrThrow({ where: { id: tier.id } });
    expect(gravada.manualUnitPrice!.equals(decimal(PRECO_TECNICO))).toBe(true);
    expect(gravada.selectedPriceSnapshot!.equals(decimal(PRECO_TECNICO))).toBe(true);
    // A prova de que a coluna antiga perdia: em 14,6 isto era 4,053188.
    expect(gravada.selectedPriceSnapshot!.toFixed(6)).toBe("4.053188");

    await app.close();
  });

  it.each([
    ["4 casas", "4.0531"],
    ["6 casas", "4.053187"],
    ["8 casas", PRECO_TECNICO],
    ["8 casas de valor pequeno", "0.00000001"],
    ["zero explícito", "0"],
  ])("preserva %s — %s", async (_nome, valor) => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const projeto = await criarProjeto(app);

    /*
     * Rascunho, de propósito. O que esta bateria mede é o ARMAZENAMENTO do
     * preço informado, e ativar com `0,00000001` sobre um custo de R$ 1,001
     * produz uma margem de contribuição de dez bilhões por cento negativos —
     * que estoura `contributionMarginSnapshot`, `Decimal(7,4)`. É um limite
     * de faixa de outro campo, anterior a esta capability, e misturá-lo aqui
     * faria o teste falhar por um motivo que ele não está investigando.
     */
    const { faixa } = await cadeiaDePrecificacao(app, projeto.id, {
      manualUnitPrice: valor,
      ativar: false,
    });
    const gravada = await getPrisma().pricingTier.findUniqueOrThrow({
      where: { id: faixa.json().tiers[0].id as string },
    });

    expect(gravada.manualUnitPrice!.equals(decimal(valor))).toBe(true);
    // Zero é preço zero explícito e continua distinto de "não informado".
    expect(gravada.manualUnitPrice).not.toBeNull();

    await app.close();
  });

  it("acima de 8 casas a API recusa — não deixa o banco arredondar em silêncio", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const projeto = await criarProjeto(app);

    const { precificacao, faixa } = await cadeiaDePrecificacao(app, projeto.id, {
      manualUnitPrice: "4.053187641",
      ativar: false,
    });
    expect(faixa.statusCode).toBe(400);
    expect(JSON.stringify(faixa.json())).toContain("8 casas decimais");

    // Recusa não é gravação parcial: a faixa não existe.
    const criadas = await getPrisma().pricingTier.count({
      where: { pricingVersionId: precificacao.id },
    });
    expect(criadas).toBe(0);

    await app.close();
  });

  it("acima de 8 casas a EDIÇÃO da faixa também recusa, e não grava nada", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const projeto = await criarProjeto(app);

    const { faixa } = await cadeiaDePrecificacao(app, projeto.id, { ativar: false });
    const tierId = faixa.json().tiers[0].id as string;

    const recusa = await app.inject({
      method: "PATCH",
      url: `/pricing-tiers/${tierId}`,
      payload: { manualUnitPrice: "4.053187641" },
    });
    expect(recusa.statusCode).toBe(400);
    expect(JSON.stringify(recusa.json())).toContain("8 casas decimais");

    const gravada = await getPrisma().pricingTier.findUniqueOrThrow({ where: { id: tierId } });
    expect(gravada.manualUnitPrice!.equals(decimal(PRECO_TECNICO))).toBe(true);

    await app.close();
  });

  it("abrir, não alterar e salvar preserva o valor — casa oculta sobrevive", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const projeto = await criarProjeto(app);

    const { faixa } = await cadeiaDePrecificacao(app, projeto.id, { ativar: false });
    const rascunho = faixa.json();
    const tierId = rascunho.tiers[0].id as string;

    // O que a tela recebe é exatamente o que ela devolve ao salvar sem editar.
    const doDto = rascunho.tiers[0].manualUnitPrice as string;
    expect(doDto).toBe(PRECO_TECNICO);
    const regravada = await app.inject({
      method: "PATCH",
      url: `/pricing-tiers/${tierId}`,
      payload: { manualUnitPrice: doDto },
    });
    expect(regravada.statusCode).toBe(200);

    const gravada = await getPrisma().pricingTier.findUniqueOrThrow({ where: { id: tierId } });
    expect(gravada.manualUnitPrice!.equals(decimal(PRECO_TECNICO))).toBe(true);

    await app.close();
  });

  it("round-trip: banco → Prisma → API → web → API → banco", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    for (const valor of ["4.0531", "4.053187", PRECO_TECNICO, "0.00000001"]) {
      const projeto = await criarProjeto(app);
      const { faixa } = await cadeiaDePrecificacao(app, projeto.id, {
        manualUnitPrice: valor,
        ativar: false,
      });
      const tierId = faixa.json().tiers[0].id as string;

      // A ida: o DTO carrega o valor íntegro, como string.
      const servido = faixa.json().tiers[0].manualUnitPrice as string;
      expect(typeof servido).toBe("string");
      expect(decimal(servido).equals(decimal(valor))).toBe(true);

      // A volta: o mesmo texto do DTO, sem reinterpretação da tela.
      await app.inject({
        method: "PATCH",
        url: `/pricing-tiers/${tierId}`,
        payload: { manualUnitPrice: servido },
      });
      const gravada = await getPrisma().pricingTier.findUniqueOrThrow({ where: { id: tierId } });
      expect(
        gravada.manualUnitPrice!.equals(decimal(valor)),
        `${valor} não sobreviveu ao round-trip`,
      ).toBe(true);
    }

    await app.close();
  });

  it("o preço técnico viaja como string no JSON — nunca como number", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const projeto = await criarProjeto(app);

    const { precificacao } = await cadeiaDePrecificacao(app, projeto.id);
    const cru = (await app.inject({ method: "GET", url: `/pricing-versions/${precificacao.id}` }))
      .body;

    expect(cru).toContain('"manualUnitPrice":"4.05318764"');
    expect(cru).toContain('"selectedUnitPrice":"4.05318764"');
    expect(cru).not.toContain('"manualUnitPrice":4.05318764');

    await app.close();
  });
});

describe("a ativação congela o preço do motor sem deixar o banco arredondar", () => {
  it("TARGET_MARGIN: o snapshot sai do motor com 8 casas, e mais que 4", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const projeto = await criarProjeto(app);

    /*
     * Custo real do acceptance — `3,14159265` por quilo, 0,1 kg por unidade,
     * mais 0,001 de energia. `P = C ÷ (1 − 0,30 − 0,05)` é uma dízima: é
     * exatamente o caso em que a redução para oito casas tem de ser uma
     * decisão do domínio, e não o que sobrar do PostgreSQL.
     */
    const rascunho = await cadeiaDePrecificacao(app, projeto.id, {
      priceMode: "TARGET_MARGIN",
      materialUnitCost: "3.14159265",
      targetContributionMarginPercent: "30",
      commissionPercent: "5",
      ativar: false,
    });

    /*
     * ANTES de gravar: em rascunho a faixa é recalculada ao vivo, e o número
     * servido vem do motor, sem passar pelo banco.
     */
    const aoVivo = (
      await app.inject({ method: "GET", url: `/pricing-versions/${rascunho.precificacao.id}` })
    ).json();
    const antesDeGravar = aoVivo.tiers[0].suggestedUnitPrice as string;
    expect(antesDeGravar.split(".")[1]).toHaveLength(8);

    // A PRÉVIA de uma faixa que ainda não existe segue a mesma escala — ela
    // é o que a tela mostra antes de "Adicionar faixa".
    const previa = (
      await app.inject({
        method: "POST",
        url: `/pricing-versions/${rascunho.precificacao.id}/tiers/preview`,
        payload: {
          quantity: "700",
          priceMode: "TARGET_MARGIN",
          targetContributionMarginPercent: "30",
          commissionPercent: "5",
        },
      })
    ).json();
    expect((previa.suggestedUnitPrice as string).split(".")[1]).toHaveLength(8);

    const ativa = (
      await app.inject({
        method: "POST",
        url: `/pricing-versions/${rascunho.precificacao.id}/activate`,
        payload: { confirmIncompleteCost: true },
      })
    ).json();

    const dto = ativa.tiers[0];
    const sugerido = dto.suggestedUnitPrice as string;
    const selecionado = dto.selectedUnitPrice as string;

    // Oito casas servidas, não seis: o DTO devolve o scale da coluna.
    expect(sugerido.split(".")[1]).toHaveLength(8);
    expect(selecionado).toBe(sugerido);
    // O valor do motor é mais longo que quatro casas — se não fosse, o teste
    // não estaria medindo nada.
    expect(sugerido.replace(/0+$/, "").split(".")[1]!.length).toBeGreaterThan(4);

    const gravada = await getPrisma().pricingTier.findUniqueOrThrow({
      where: { id: faixaDe(ativa).id },
    });
    expect(gravada.suggestedPriceSnapshot!.equals(decimal(sugerido))).toBe(true);
    expect(gravada.selectedPriceSnapshot!.equals(decimal(selecionado))).toBe(true);

    /*
     * O motor calcula em 40 dígitos; quem reduz para oito é o DOMÍNIO, na
     * gravação. A prova observável: o valor servido antes de gravar e o
     * servido depois de gravar são o mesmo, casa por casa. Se o banco fosse a
     * primeira camada de arredondamento, o rascunho mostraria um número e a
     * faixa ativa mostraria outro.
     */
    expect(sugerido).toBe(antesDeGravar);

    await app.close();
  });

  it("MANUAL: o selecionado é o manual, casa por casa — a política não muda", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const projeto = await criarProjeto(app);

    const { ativa } = await cadeiaDePrecificacao(app, projeto.id);
    const gravada = await getPrisma().pricingTier.findUniqueOrThrow({
      where: { id: faixaDe(ativa).id },
    });

    expect(gravada.selectedPriceSnapshot!.equals(decimal(PRECO_TECNICO))).toBe(true);
    // MANUAL não produz sugerido: o motor não foi consultado para preço.
    expect(gravada.suggestedPriceSnapshot).toBeNull();
    expect(ativa.tiers[0].priceMode).toBe("MANUAL_PRICE");

    await app.close();
  });

  it("comissão e contribuição por unidade continuam em 6 casas — PREC-MIG-D", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const projeto = await criarProjeto(app);

    const { ativa } = await cadeiaDePrecificacao(app, projeto.id, {
      priceMode: "TARGET_MARGIN",
      materialUnitCost: "3.14159265",
    });

    /*
     * A perda REGISTRADA, não corrigida. Os dois campos saem do mesmo motor
     * que o preço, mas a categoria é TECHNICAL_RESULT e a decisão é do
     * PREC-MIG-D. Ampliar por vizinhança de bloco seria escopo sem PO — este
     * teste existe para que a diferença seja deliberada e visível.
     */
    expect((ativa.tiers[0].commissionPerUnit as string).split(".")[1]).toHaveLength(6);
    expect((ativa.tiers[0].contributionPerUnit as string).split(".")[1]).toHaveLength(6);

    await app.close();
  });
});

describe("a fronteira técnica → comercial", () => {
  /** Cenário fechado: proposta enviada, aceita, projeto aprovado. */
  async function cenarioFechado(app: App, opcoes: OpcoesDaCadeia = {}) {
    const projeto = await criarProjeto(app);
    const cadeia = await cadeiaDePrecificacao(app, projeto.id, opcoes);
    const orcamento = await criarOrcamento(app, projeto.id);

    const vinculo = await app.inject({
      method: "POST",
      url: `/quote-lines/${orcamento.lineId}/apply-pricing`,
      payload: { pricingTierId: faixaDe(cadeia.ativa).id },
    });
    expect(vinculo.statusCode, vinculo.body).toBe(200);

    return { projeto, cadeia, orcamento };
  }

  it("a linha carrega DOIS números: técnico 4,05318764 e comercial 4,0532", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { orcamento } = await cenarioFechado(app);

    // Antes do envio, a proveniência é lida da faixa — já com oito casas.
    const rascunho = (
      await app.inject({ method: "GET", url: `/quote-versions/${orcamento.id}` })
    ).json();
    expect(rascunho.lines[0].pricing.selectedUnitPrice).toBe(PRECO_TECNICO);
    expect(rascunho.lines[0].unitPrice).toBe("4.0532");

    // E o preço COMERCIAL da linha já nasceu fechado em quatro casas.
    const linha = await getPrisma().quoteLine.findUniqueOrThrow({
      where: { id: orcamento.lineId },
    });
    expect(linha.unitPrice!.equals(decimal(PRECO_COMERCIAL))).toBe(true);

    await app.close();
  });

  it("o ENVIO congela a proveniência com as 8 casas, e o comercial com 4", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { orcamento } = await cenarioFechado(app);
    const enviado = await app.inject({
      method: "POST",
      url: `/quote-versions/${orcamento.id}/send`,
      payload: { confirmIncompleteCost: true },
    });
    expect(enviado.statusCode, enviado.body).toBe(200);

    const linha = await getPrisma().quoteLine.findUniqueOrThrow({
      where: { id: orcamento.lineId },
    });
    expect(linha.pricingSelectedUnitPriceSnapshot!.equals(decimal(PRECO_TECNICO))).toBe(true);
    expect(linha.unitPrice!.equals(decimal(PRECO_COMERCIAL))).toBe(true);

    // E a API serve a proveniência congelada nas mesmas oito casas.
    const depois = (
      await app.inject({ method: "GET", url: `/quote-versions/${orcamento.id}` })
    ).json();
    expect(depois.lines[0].pricing.frozen).toBe(true);
    expect(depois.lines[0].pricing.selectedUnitPrice).toBe(PRECO_TECNICO);
    expect(depois.lines[0].unitPrice).toBe("4.0532");

    await app.close();
  });

  it("o total do documento sai do preço COMERCIAL — regra #15 intocada", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const { orcamento } = await cenarioFechado(app);
    const detalhe = (
      await app.inject({ method: "GET", url: `/quote-versions/${orcamento.id}` })
    ).json();

    /*
     * 500 × 4,0532 = 2026,60. Com o preço TÉCNICO seria 500 × 4,05318764 =
     * 2026,59382 → 2026,59. Um centavo separa as duas contas, e é essa
     * diferença que prova qual dos dois números o total consome.
     */
    const pelaRegra = calcularTotaisOrcamento([
      { quotedQuantity: "500", unitPrice: PRECO_COMERCIAL },
    ]);
    expect(pelaRegra.subtotal).toBe("2026.60");
    expect(detalhe.subtotal).toBe("2026.60");

    const pelaTecnica = calcularTotaisOrcamento([
      { quotedQuantity: "500", unitPrice: PRECO_TECNICO },
    ]);
    expect(pelaTecnica.subtotal).toBe("2026.59");
    expect(detalhe.subtotal).not.toBe(pelaTecnica.subtotal);

    await app.close();
  });

  it("Pedido e Faturamento copiam 4,0532 — nenhum elo comercial volta a 8", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();
    const prisma = getPrisma();

    const { projeto, orcamento } = await cenarioFechado(app);
    await app.inject({
      method: "POST",
      url: `/quote-versions/${orcamento.id}/send`,
      payload: { confirmIncompleteCost: true },
    });
    await app.inject({ method: "POST", url: `/quote-versions/${orcamento.id}/accept` });
    await app.inject({ method: "POST", url: `/projects/${projeto.id}/approve`, payload: {} });

    const pedido = (
      await app.inject({ method: "POST", url: `/quote-versions/${orcamento.id}/create-order` })
    ).json();
    pedidos.push(pedido.id);
    expect(pedido.lines[0].agreedPrice.unitPrice).toBe("4.0532");

    const linhaDoPedido = await prisma.customerOrderLine.findFirstOrThrow({
      where: { customerOrderId: pedido.id },
    });
    expect(linhaDoPedido.agreedUnitPrice!.equals(decimal(PRECO_COMERCIAL))).toBe(true);

    // Estoque de produto acabado para expedir — o Faturamento nasce da
    // Expedição, e é lá que o preço acordado é copiado pela última vez.
    const produto = await prisma.product.findUniqueOrThrow({
      where: { id: linhaDoPedido.productId },
    });
    await prisma.item.update({
      where: { id: produto.finishedProductItemId! },
      data: { requiresQualityRelease: false, controlsExpiry: false },
    });
    const lote = await prisma.lot.create({
      data: {
        code: `LT-PREC-PTECH-${marca()}`,
        itemId: produto.finishedProductItemId!,
        origin: "PRODUCTION",
        initialReceivedQuantity: "500",
        status: "AVAILABLE",
        createdBy: "Teste",
      },
    });
    await prisma.inventoryMovement.create({
      data: {
        itemId: produto.finishedProductItemId!,
        lotId: lote.id,
        type: "FINISHED_GOOD_PRODUCTION",
        quantity: "500",
        occurredAt: new Date(),
        sourceType: "FINISHED_GOOD_PRODUCTION",
        createdBy: "Teste",
      },
    });

    await app.inject({ method: "POST", url: `/customer-orders/${pedido.id}/confirm` });
    await app.inject({
      method: "POST",
      url: `/customer-orders/${pedido.id}/apply-fulfillment-plan`,
      payload: {
        lines: [
          {
            customerOrderLineId: linhaDoPedido.id,
            reserveQuantity: "500",
            produceQuantity: "0",
          },
        ],
      },
    });

    const rascunhoDaExpedicao = (
      await app.inject({ method: "POST", url: `/customer-orders/${pedido.id}/shipments` })
    ).json();
    const atual = (
      await app.inject({ method: "GET", url: `/shipments/${rascunhoDaExpedicao.id}` })
    ).json();
    for (const l of atual.lines) {
      if (!l.requiresVerification) continue;
      await app.inject({
        method: "POST",
        url: `/shipments/${rascunhoDaExpedicao.id}/lines/${l.id}/verify`,
        payload: { lotCode: l.lotCode },
      });
    }
    const expedicao = (
      await app.inject({ method: "POST", url: `/shipments/${rascunhoDaExpedicao.id}/confirm` })
    ).json();

    const faturamento = (
      await app.inject({ method: "POST", url: "/billings", payload: { shipmentId: expedicao.id } })
    ).json();
    expect(faturamento.lines[0].agreedUnitPrice).toBe("4.0532");
    expect(faturamento.lines[0].unitPrice).toBe("4.0532");

    const linhaFaturada = await prisma.billingLine.findFirstOrThrow({
      where: { billingId: faturamento.id },
    });
    expect(linhaFaturada.agreedUnitPrice!.equals(decimal(PRECO_COMERCIAL))).toBe(true);
    expect(linhaFaturada.unitPrice!.equals(decimal(PRECO_COMERCIAL))).toBe(true);

    // E o snapshot TÉCNICO da origem continua com as oito casas.
    const linhaDoOrcamento = await prisma.quoteLine.findUniqueOrThrow({
      where: { id: orcamento.lineId },
    });
    expect(linhaDoOrcamento.pricingSelectedUnitPriceSnapshot!.equals(decimal(PRECO_TECNICO))).toBe(
      true,
    );

    await app.close();
  });

  it("preço comercial acima de 4 casas é recusado antes do PostgreSQL", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const projeto = await criarProjeto(app);
    await cadeiaDePrecificacao(app, projeto.id, { ativar: false });
    const orcamento = await criarOrcamento(app, projeto.id);

    const aceito = await app.inject({
      method: "PATCH",
      url: `/quote-lines/${orcamento.lineId}`,
      payload: { quotedQuantity: "500", uomCode: "un", unitPrice: "4.0531" },
    });
    expect(aceito.statusCode, aceito.body).toBe(200);

    const recusado = await app.inject({
      method: "PATCH",
      url: `/quote-lines/${orcamento.lineId}`,
      payload: { unitPrice: "4.05318" },
    });
    expect(recusado.statusCode).toBe(400);
    expect(JSON.stringify(recusado.json())).toContain("4 casas decimais");

    // Recusa não é gravação parcial: o valor anterior continua lá.
    const linha = await getPrisma().quoteLine.findUniqueOrThrow({
      where: { id: orcamento.lineId },
    });
    expect(linha.unitPrice!.equals(decimal("4.0531"))).toBe(true);

    await app.close();
  });

  it("abrir a linha, não editar e salvar preserva 4,0531", async () => {
    const app = buildTestApp("ADMIN");
    await app.ready();

    const projeto = await criarProjeto(app);
    await cadeiaDePrecificacao(app, projeto.id, { ativar: false });
    const orcamento = await criarOrcamento(app, projeto.id);
    await app.inject({
      method: "PATCH",
      url: `/quote-lines/${orcamento.lineId}`,
      payload: { quotedQuantity: "500", uomCode: "un", unitPrice: "4.0531" },
    });

    const servido = (
      await app.inject({ method: "GET", url: `/quote-versions/${orcamento.id}` })
    ).json().lines[0].unitPrice as string;
    expect(servido).toBe("4.0531");

    await app.inject({
      method: "PATCH",
      url: `/quote-lines/${orcamento.lineId}`,
      payload: { unitPrice: servido },
    });

    const linha = await getPrisma().quoteLine.findUniqueOrThrow({
      where: { id: orcamento.lineId },
    });
    expect(linha.unitPrice!.equals(decimal("4.0531"))).toBe(true);

    await app.close();
  });
});
