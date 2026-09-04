import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { fixtureCustomerId } from "../../test-support/fixture-customer.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * A Formulação vigente manda no FUTURO; o passado é do documento.
 *
 * Uma nova versão da receita não pode reescrever uma Ordem de Produção que já
 * existe. Se reescrevesse, a ordem que a fábrica está separando mudaria de
 * necessidade no meio do caminho, e o CMV salvo — que orçamento e preço citam —
 * passaria a valer outro número sem ninguém ter decidido isso.
 *
 * Este arquivo prova a cadeia inteira com os dois modos da capability:
 *
 *   V1 (teórico, pureza aplicada) → OP-A congela
 *   V2 (mesma receita, ajuste desligado) → ativa
 *   OP-A continua exatamente como estava
 *   OP-B nasce com V2
 *
 * As duas ordens divergirem é o resultado CERTO, não um defeito.
 */

type App = ReturnType<typeof buildTestApp>;

const fixtureItemIds: string[] = [];
const fixtureProductIds: string[] = [];
const fixtureProductionOrderIds: string[] = [];

afterAll(async () => {
  const prisma = getPrisma();
  if (fixtureProductionOrderIds.length > 0) {
    await prisma.productionOrderRequirement.deleteMany({
      where: { productionOrderId: { in: fixtureProductionOrderIds } },
    });
    await prisma.productionOrder.deleteMany({ where: { id: { in: fixtureProductionOrderIds } } });
  }
  if (fixtureProductIds.length > 0) {
    await prisma.formulationComponent.deleteMany({
      where: { formulationVersion: { productId: { in: fixtureProductIds } } },
    });
    await prisma.formulationVersion.deleteMany({ where: { productId: { in: fixtureProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: fixtureProductIds } } });
  }
  if (fixtureItemIds.length > 0) {
    await prisma.item.deleteMany({ where: { id: { in: fixtureItemIds } } });
  }
});

function marca(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function criarItem(tipo: "RAW_MATERIAL" | "FINISHED_PRODUCT", unidade: string) {
  const item = await getPrisma().item.create({
    data: {
      type: tipo,
      code: `${tipo === "RAW_MATERIAL" ? "MP" : "PA"}-HIST-${marca()}`,
      name: `Item histórico ${marca()}`,
      unitCode: unidade,
      controlsLot: tipo === "FINISHED_PRODUCT",
      controlsExpiry: false,
      requiresQualityRelease: false,
    },
  });
  fixtureItemIds.push(item.id);
  return item;
}

async function criarProduto(app: App, finishedItemId: string) {
  const produto = (
    await app.inject({
      method: "POST",
      url: "/products",
      payload: {
        customerId: await fixtureCustomerId(),
        name: `Produto histórico ${marca()}`,
        finishedProductItemId: finishedItemId,
      },
    })
  ).json();
  fixtureProductIds.push(produto.id);
  return produto;
}

/**
 * Uma versão com um componente, no modo pedido, e já ativada.
 *
 * `anterior` distingue a PRIMEIRA versão da sucessora: criar a primeira é
 * `POST /products/:id/formulation-versions`, e uma nova a partir da ativa é
 * `POST /formulation-versions/:id/new-version`. Chamar a rota errada devolve
 * erro, e sem conferir isso o teste seguia com a versão antiga ainda ativa —
 * exatamente o falso verde que ele existe para impedir.
 */
async function versaoAtiva(
  app: App,
  produtoId: string,
  ingredienteId: string,
  ajustes: { modo: "PHYSICAL_DIRECT" | "THEORETICAL_WITH_ADJUSTMENTS"; pureza: boolean },
  anterior?: string,
) {
  const criada = await app.inject(
    anterior
      ? { method: "POST", url: `/formulation-versions/${anterior}/new-version` }
      : { method: "POST", url: `/products/${produtoId}/formulation-versions` },
  );
  const versao = criada.json();
  expect(versao.id, `criação da versão falhou: ${criada.statusCode} ${criada.body}`).toBeTruthy();

  await app.inject({
    method: "PATCH",
    url: `/formulation-versions/${versao.id}`,
    payload: {
      basisQuantity: "1",
      calculationMode: "FIXED_BASIS",
      components: [
        {
          itemId: ingredienteId,
          // 220 mg teóricos; com pureza 98% a física é 224,4898 mg.
          quantity: "220",
          unitCode: "mg",
          basis: "FIXED_BASIS",
          purityPercentApplied: "98",
          quantityMode: ajustes.modo,
          applyPurityAdjustment: ajustes.pureza,
          applyOverageAdjustment: false,
        },
      ],
    },
  });
  const ativada = await app.inject({
    method: "POST",
    url: `/formulation-versions/${versao.id}/activate`,
  });
  expect(ativada.statusCode, `ativação falhou: ${ativada.body}`).toBeLessThan(400);
  return versao;
}

async function ordemPlanejada(app: App, produtoId: string, quantidade: string) {
  const ordem = (
    await app.inject({
      method: "POST",
      url: "/production-orders",
      payload: { productId: produtoId, plannedQuantity: quantidade },
    })
  ).json();
  fixtureProductionOrderIds.push(ordem.id);
  return (await app.inject({ method: "POST", url: `/production-orders/${ordem.id}/plan` })).json();
}

function necessidade(planejada: { requirements: { itemId: string; requiredQuantity: string }[] }, itemId: string) {
  const linha = planejada.requirements.find((r) => r.itemId === itemId)!;
  // `Decimal(18, 6)` e a precisao que o dominio guarda — comparar em
  // nove casas mediria um digito que nao existe.
  return new Prisma.Decimal(linha.requiredQuantity).toFixed(6);
}

describe("Formulação vigente define o futuro; a OP guarda o passado", () => {
  it("V2 não reescreve a OP nascida em V1, e OP-B nasce com V2", async () => {
    const app = buildTestApp();
    await app.ready();

    const ingrediente = await criarItem("RAW_MATERIAL", "kg");
    const acabado = await criarItem("FINISHED_PRODUCT", "un");
    const produto = await criarProduto(app, acabado.id);

    // ── V1: quantidade teórica, pureza APLICADA ────────────────────────────
    const v1 = await versaoAtiva(app, produto.id, ingrediente.id, {
      modo: "THEORETICAL_WITH_ADJUSTMENTS",
      pureza: true,
    });

    const opA = await ordemPlanejada(app, produto.id, "1000");
    const necessidadeA = necessidade(opA, ingrediente.id);
    // 220 mg × 1000 = 220 g = 0,22 kg, ÷ 0,98 = 0,224489795… kg
    expect(necessidadeA).toBe("0.224490");

    // ── V2: MESMA receita, ajuste DESLIGADO ────────────────────────────────
    // O caso real da Coenzima Q10 é este: alguém percebe que a quantidade já
    // vinha corrigida e desliga a correção. É mudança de interpretação, e por
    // isso exige versão nova.
    await versaoAtiva(
      app,
      produto.id,
      ingrediente.id,
      { modo: "PHYSICAL_DIRECT", pureza: false },
      v1.id,
    );

    // ── OP-A: intocada ─────────────────────────────────────────────────────
    const opAdepois = (
      await app.inject({ method: "GET", url: `/production-orders/${opA.id}` })
    ).json();
    expect(necessidade(opAdepois, ingrediente.id)).toBe(necessidadeA);

    const congelado = await getPrisma().productionOrderRequirement.findFirstOrThrow({
      where: { productionOrderId: opA.id, itemId: ingrediente.id },
    });
    expect(congelado.requiredQuantity.toFixed(6)).toBe("0.224490");
    // A proveniência continua apontando para a versão que originou a conta.
    expect(opAdepois.formulationVersionId).toBe(opA.formulationVersionId);

    // ── OP-B: nasce com V2 ─────────────────────────────────────────────────
    const opB = await ordemPlanejada(app, produto.id, "1000");
    const necessidadeB = necessidade(opB, ingrediente.id);
    // Sem a correção: 220 mg × 1000 = 0,22 kg exatos.
    expect(necessidadeB).toBe("0.220000");

    // ── A divergência é o resultado certo ──────────────────────────────────
    expect(necessidadeA).not.toBe(necessidadeB);
    expect(opB.formulationVersionId).not.toBe(opA.formulationVersionId);

    await app.close();
  });

  it("a tela da Formulação e a OP chegam ao MESMO físico — um motor só", async () => {
    const app = buildTestApp();
    await app.ready();

    const ingrediente = await criarItem("RAW_MATERIAL", "kg");
    const acabado = await criarItem("FINISHED_PRODUCT", "un");
    const produto = await criarProduto(app, acabado.id);

    const versao = await versaoAtiva(app, produto.id, ingrediente.id, {
      modo: "THEORETICAL_WITH_ADJUSTMENTS",
      pureza: true,
    });

    /*
     * Dois consumidores diferentes de `computeComponentRequirement`: a tela da
     * Formulação, que mostra o físico por unidade, e a Ordem de Produção, que
     * congela a necessidade. Se divergissem, um dos dois teria matemática
     * própria — que é o que o motor único existe para impedir.
     *
     * O CMV é o terceiro consumidor e usa a mesma função, mas exige estrutura
     * de custos ativa para responder; provar a igualdade aqui não depende
     * disso.
     */
    const lida = (
      await app.inject({ method: "GET", url: `/formulation-versions/${versao.id}` })
    ).json();
    const componente = lida.components.find(
      (c: { itemId: string }) => c.itemId === ingrediente.id,
    );
    const fisicoPorUnidade = new Prisma.Decimal(componente.physicalPerUnit);

    const ordem = await ordemPlanejada(app, produto.id, "1000");
    const daOp = necessidade(ordem, ingrediente.id);

    expect(fisicoPorUnidade.times(1000).toFixed(6)).toBe(daOp);
    // E o número é o da conta, não um arredondamento conveniente.
    expect(daOp).toBe("0.224490");

    await app.close();
  });
});
