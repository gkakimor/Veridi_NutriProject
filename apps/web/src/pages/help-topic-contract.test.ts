import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { helpTopics } from "../help/help-content";

/**
 * O CONTRATO entre a tela e a ajuda — verificado lendo os arquivos, não
 * renderizando.
 *
 * Existe por causa de um defeito real: a tela do Pedido abria um painel que
 * descrevia o Plano de Atendimento, e as telas de preço apontavam para o
 * tópico do CMV. Nos dois casos a chave era VÁLIDA — compilava, renderizava,
 * e explicava a tela do vizinho. Nenhum teste de renderização pegava isso,
 * porque cada um afirmava só que "o painel abre".
 *
 * Duas afirmações, e é a segunda que teria pegado o Pedido:
 *
 * 1. toda chave `helpTopics["…"]` escrita em qualquer arquivo existe de fato
 *    no conteúdo — pega chave digitada errada e tópico removido;
 * 2. cada tela principal abre o tópico da PRÓPRIA área, conforme a tabela
 *    explícita abaixo — pega chave certa na tela errada.
 *
 * A varredura é textual de propósito: ela enxerga arquivo que nenhum teste
 * de tela importa, que é justamente onde um erro de ligação se esconde.
 */

/*
 * Raiz da varredura. `import.meta.url` não serve aqui: sob jsdom o módulo
 * chega transformado e a URL não é `file:`. O Vitest roda com a raiz do
 * pacote como diretório de trabalho, e a última afirmação da suíte garante
 * que este caminho achou telas de verdade.
 */
const srcDir = join(process.cwd(), "src");

/** Chave de tópico escrita literalmente: `helpTopics["x"]`. */
const REFERENCIA = /helpTopics\[\s*["']([^"']+)["']\s*\]/g;

/**
 * O tópico do PRIMEIRO `<ContextHelp>` do arquivo — o painel da tela.
 *
 * `[^>]` impede atravessar o fim da tag: um `<ContextHelp>` sem tópico
 * literal não pode emprestar o tópico do próximo painel da página.
 */
const PAINEL_DA_TELA = /<ContextHelp\b[^>]*?topic=\{helpTopics\[\s*["']([^"']+)["']\s*\]/;

/** Este arquivo cita chaves de exemplo nos comentários; varrer a si mesmo daria falso positivo. */
const ESTE_ARQUIVO = "help-topic-contract.test.ts";

function arquivosDeCodigo(dir: string, encontrados: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    if (entrada === "node_modules" || entrada === "dist" || entrada === ESTE_ARQUIVO) continue;
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) {
      arquivosDeCodigo(caminho, encontrados);
      continue;
    }
    if (/\.tsx?$/.test(entrada)) encontrados.push(caminho);
  }
  return encontrados;
}

function ler(caminho: string): string {
  return readFileSync(caminho, "utf8");
}

function relativo(caminho: string): string {
  return caminho.slice(srcDir.length).replace(/\\/g, "/");
}

/**
 * Tela → tópico que ela DEVE abrir.
 *
 * A tabela é escrita à mão e não derivada do código: derivá-la do que as
 * telas fazem hoje transformaria o teste num espelho, e um espelho concorda
 * com qualquer coisa. Cada par aqui é uma decisão de produto — a tela de
 * preço explica preço, a de cálculo explica o cálculo congelado.
 */
const PARES: [arquivo: string, topico: string][] = [
  // Gestão — custo congelado, preço e as bibliotecas reutilizáveis.
  ["pages/pricing/PricingListPage.tsx", "precificacao.comoFunciona"],
  ["pages/pricing/PricingPage.tsx", "precificacao.comoFunciona"],
  ["pages/industrial-costs/CostCalculationPage.tsx", "calculo.comoFunciona"],
  ["pages/cost-templates/CostTemplatesPage.tsx", "templateCusto.comoFunciona"],
  ["pages/cost-templates/CostTemplateDetailPage.tsx", "templateCusto.comoFunciona"],
  ["pages/cost-templates/PricingPoliciesPage.tsx", "politicaPreco.comoFunciona"],
  ["pages/cost-templates/PricingPolicyDetailPage.tsx", "politicaPreco.comoFunciona"],
  ["pages/product-cmv/ProductCmvPage.tsx", "cmv.comoFunciona"],
  ["pages/reports/ReportsHubPage.tsx", "relatorios.comoFunciona"],
  ["pages/reports/ReportPage.tsx", "relatorio.comoFunciona"],
  ["pages/customer-consultation/ConsultationShell.tsx", "consultaCliente.comoFunciona"],
  ["pages/DashboardPage.tsx", "painel.comoFunciona"],

  // Comercial — o par que motivou o teste: o Pedido explicava o Plano.
  ["pages/customer-orders/CustomerOrdersPage.tsx", "comercial.pedidos"],
  ["pages/customer-orders/CustomerOrderPage.tsx", "comercial.pedido"],
  ["pages/projects/ProjectsPage.tsx", "comercial.projetos"],
  ["pages/projects/ProjectDetailPage.tsx", "comercial.projeto"],
  ["pages/samples/SamplesPage.tsx", "comercial.amostras"],
  ["pages/samples/SampleDetailPage.tsx", "comercial.amostra"],
  ["pages/shipments/ShipmentsPage.tsx", "comercial.expedicoes"],
  ["pages/shipments/ShipmentPage.tsx", "comercial.expedicao"],
  ["pages/billings/BillingsPage.tsx", "faturamento.comoFunciona"],
  ["pages/billings/BillingPage.tsx", "faturamento.comoFunciona"],

  // Produção, compras e estoque.
  ["pages/production-orders/ProductionOrdersPage.tsx", "ordemProducao.comoFunciona"],
  ["pages/production-orders/ProductionOrderPage.tsx", "ordemProducao.comoFunciona"],
  ["pages/production-orders/RecipeSheetPage.tsx", "producao.folhaReceita"],
  ["pages/production-orders/PickingConsumptionPage.tsx", "producao.picking"],
  ["pages/formulations/FormulationDetailPage.tsx", "formulacao.comoFunciona"],
  ["pages/finished-goods/FinishedGoodsPage.tsx", "producao.produtoAcabado"],
  ["pages/purchase-orders/PurchaseOrdersPage.tsx", "compras.ordens"],
  ["pages/purchase-orders/PurchaseOrderPage.tsx", "compras.ordens"],
  ["pages/receiving/ReceiptsPage.tsx", "compras.recebimentos"],
  ["pages/receiving/ReceiptDetailPage.tsx", "compras.recebimentos"],
  ["pages/inventory/InventoryOverviewPage.tsx", "estoque.posicao"],
  ["pages/inventory/InventoryMovementsPage.tsx", "estoque.movimentacoes"],
  ["pages/inventory/StockCountPage.tsx", "estoque.inventario"],
  ["pages/lots/LotsPage.tsx", "estoque.lotes"],
];

describe("contrato entre tela e ajuda contextual", () => {
  const arquivos = arquivosDeCodigo(srcDir);

  it("toda chave de tópico citada em código existe no conteúdo de ajuda", () => {
    const chaves = Object.keys(helpTopics);
    const desconhecidas: string[] = [];

    for (const arquivo of arquivos) {
      const conteudo = ler(arquivo);
      for (const encontro of conteudo.matchAll(REFERENCIA)) {
        const chave = encontro[1] ?? "";
        if (!chaves.includes(chave)) desconhecidas.push(`${relativo(arquivo)} → "${chave}"`);
      }
    }

    expect(desconhecidas).toEqual([]);
  });

  it("a varredura encontra as telas de verdade (guarda contra regex morta)", () => {
    const comReferencia = arquivos.filter((arquivo) => REFERENCIA.test(ler(arquivo)));
    REFERENCIA.lastIndex = 0;
    // Um erro de caminho ou de expressão devolveria zero arquivo, e as duas
    // afirmações acima passariam sem ter olhado nada.
    expect(comReferencia.length).toBeGreaterThan(PARES.length);
  });

  it.each(PARES)("%s abre o tópico da própria área: %s", (arquivo, topico) => {
    const conteudo = ler(join(srcDir, arquivo));
    const painel = PAINEL_DA_TELA.exec(conteudo);

    expect(painel, `${arquivo} não tem <ContextHelp> com tópico literal`).not.toBeNull();
    expect(painel?.[1]).toBe(topico);
  });

  it("os tópicos criados para as telas de Gestão existem e estão preenchidos", () => {
    const novos = [
      "precificacao.comoFunciona",
      "calculo.comoFunciona",
      "templateCusto.comoFunciona",
      "politicaPreco.comoFunciona",
      "relatorio.comoFunciona",
      "consultaCliente.comoFunciona",
    ] as const;

    for (const id of novos) {
      const topico = helpTopics[id];
      expect(topico, id).toBeDefined();
      expect(topico.module).toBe("gestao");
      // O vocabulário vem antes do caminho: quem não sabe o que é "base de
      // custo" não aproveita um fluxo que começa por ela.
      expect((topico.concepts ?? []).length, `${id}: conceitos`).toBeGreaterThanOrEqual(4);
      expect((topico.flow ?? []).length, `${id}: etapas`).toBeGreaterThanOrEqual(4);
      // As ressalvas são o valor real do painel — o que a tela NÃO faz.
      expect((topico.notes ?? []).length, `${id}: ressalvas`).toBeGreaterThanOrEqual(4);
      expect(
        (topico.flow ?? []).some((etapa) => etapa.tone === "accent"),
        `${id}: nenhuma etapa decisiva destacada`,
      ).toBe(true);
    }
  });

  /**
   * A regra que o defeito do Pedido violava, dita uma vez só: preço não é
   * custo. Enquanto não existia tópico de precificação, as duas telas de
   * preço citavam o CMV — chave válida, assunto do vizinho.
   */
  it("as telas de preço não citam mais o tópico do CMV", () => {
    for (const arquivo of ["pages/pricing/PricingPage.tsx", "pages/pricing/PricingListPage.tsx"]) {
      expect(ler(join(srcDir, arquivo))).not.toContain('helpTopics["cmv.comoFunciona"]');
    }
  });
});
