import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { helpHints, helpTopics } from "../help/help-content";
import type { HelpTopic } from "../help/help-content";

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
  ["pages/industrial-costs/IndustrialCostPage.tsx", "estruturaCusto.comoFunciona"],
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
  // Lista e documento explicam coisas diferentes: a fila de expedições a
  // faturar não emite nem altera preço.
  ["pages/billings/BillingsPage.tsx", "faturamento.lista"],
  ["pages/billings/BillingPage.tsx", "faturamento.comoFunciona"],

  // Produção, compras e estoque.
  ["pages/production-orders/ProductionOrdersPage.tsx", "producao.ordens"],
  ["pages/production-orders/ProductionOrderPage.tsx", "ordemProducao.comoFunciona"],
  ["pages/production-orders/RecipeSheetPage.tsx", "producao.folhaReceita"],
  ["pages/production-orders/PickingConsumptionPage.tsx", "producao.picking"],
  ["pages/formulations/FormulationsPage.tsx", "formulacao.lista"],
  ["pages/formulations/FormulationDetailPage.tsx", "formulacao.comoFunciona"],
  ["pages/formulations/FormulationVersionPage.tsx", "formulacao.comoFunciona"],
  ["pages/finished-goods/FinishedGoodsPage.tsx", "producao.produtoAcabado"],
  ["pages/purchase-orders/PurchaseOrdersPage.tsx", "compras.ordens"],
  ["pages/purchase-orders/PurchaseOrderPage.tsx", "compras.ordens"],
  ["pages/receiving/ReceiptsPage.tsx", "compras.recebimentos"],
  ["pages/receiving/ReceiptDetailPage.tsx", "compras.recebimentos"],
  ["pages/inventory/InventoryOverviewPage.tsx", "estoque.posicao"],
  ["pages/inventory/InventoryMovementsPage.tsx", "estoque.movimentacoes"],
  ["pages/inventory/StockCountPage.tsx", "estoque.inventario"],
  ["pages/lots/LotsPage.tsx", "estoque.lotes"],
  ["pages/lots/LotDetailPage.tsx", "estoque.lotes"],
  ["pages/lots/LotScanPage.tsx", "estoque.escanear"],

  // Cadastros — a tela de criação abre a MESMA ajuda da lista: é o fluxo
  // "cadastrar" dela que descreve o formulário.
  ["pages/items/ItemsPage.tsx", "item.comoFunciona"],
  ["pages/items/ItemCreatePage.tsx", "item.comoFunciona"],
  ["pages/products/ProductsPage.tsx", "produto.comoFunciona"],
  ["pages/products/ProductCreatePage.tsx", "produto.comoFunciona"],
  ["pages/customers/CustomersPage.tsx", "cliente.comoFunciona"],
  ["pages/customers/CustomerCreatePage.tsx", "cliente.comoFunciona"],
  ["pages/suppliers/SuppliersPage.tsx", "fornecedor.comoFunciona"],
  ["pages/suppliers/SupplierCreatePage.tsx", "fornecedor.comoFunciona"],
  ["pages/industrial-resources/IndustrialResourcesPage.tsx", "recursoIndustrial.comoFunciona"],
  ["pages/industrial-resources/IndustrialResourceCreatePage.tsx", "recursoIndustrial.comoFunciona"],
  ["pages/quality/CoaQueuePage.tsx", "qualidadeDocumentos.comoFunciona"],
  ["pages/product-cmv/ProductCmvPage.tsx", "cmv.comoFunciona"],
];

/**
 * Palavras que não podem aparecer no texto que o usuário final lê.
 *
 * Termo técnico na ajuda é sinal de que quem escreveu explicou o código, não
 * a tela. A lista é curta e literal: siglas em maiúscula e palavras inteiras.
 */
const TERMOS_PROIBIDOS = [
  /\bDTO\b/,
  /\bendpoint\b/i,
  /\bsnapshot\b/i,
  /\bfallback\b/i,
  /\boverride\b/i,
  /\bbackend\b/i,
  /\bfrontend\b/i,
  /\bpayload\b/i,
  /\bupload\b/i,
  /\blayout\b/i,
  /\bgate\b/i,
  /\bcockpit\b/i,
  /\bBI\b/,
  /\bCRM\b/,
  /\bbarcode\b/i,
  /\bMOQ\b/,
];

/** Todo texto de um tópico, concatenado — é o que a pessoa lê. */
function textoDoTopico(topico: HelpTopic): string[] {
  const partes: string[] = [topico.title, topico.summary];
  for (const conceito of topico.concepts ?? []) partes.push(conceito.term, conceito.text);
  const fluxos = topico.flows ?? (topico.flow ? [{ name: "", steps: topico.flow }] : []);
  for (const fluxo of fluxos) {
    partes.push(fluxo.name);
    if ("when" in fluxo && fluxo.when) partes.push(fluxo.when);
    for (const etapa of fluxo.steps) partes.push(etapa.label, etapa.detail ?? "");
  }
  for (const etapa of topico.steps ?? []) partes.push(etapa.label, etapa.detail ?? "");
  for (const nota of topico.notes ?? []) partes.push(nota);
  return partes.filter(Boolean);
}

/**
 * Componentes RELEVANTES de cada tela principal, nomeados como o glossário
 * os nomeia. É a cobertura que importa: uma ajuda pode ter quantos termos a
 * tela pedir, mas não pode deixar de fora o que está na frente da pessoa.
 * Substring, case-sensitive, contra os termos do glossário.
 */
const ESSENCIAIS: Record<string, string[]> = {
  "formulacao.comoFunciona": [
    "Modo de cálculo",
    "Doses por embalagem",
    "Quantidade informada",
    "Ajustes da quantidade",
    "Pureza e overage",
    "dupla correção",
    "Fornecimento",
    "Custo estimado",
  ],
  "item.comoFunciona": ["Tipo do item", "Unidade", "Controla lote", "Custo de referência", "Fonte selecionada hoje", "Fornecedores"],
  "cmv.comoFunciona": ["Fonte do custo", "Referência manual", "Qualidade do custo", "Precificação vigente", "Data de referência"],
  "estruturaCusto.comoFunciona": ["Rascunho × Ativa", "Recursos industriais", "Energia", "Premissas", "Cálculo padrão", "Fonte do custo por material", "Cálculos salvos"],
  "calculo.comoFunciona": ["Data de referência", "Fonte do custo", "Referência manual forçada", "Qualidade do custo"],
  "precificacao.comoFunciona": ["Faixa de quantidade", "Margem de contribuição", "Comissão", "Markup", "Modo de preço", "Lista de precificações"],
  "comercial.pedido": ["Reserva", "Produzir", "Sugestão de Compra", "Materiais aguardando cliente", "Reservar Produto Acabado", "Preço acordado"],
  "ordemProducao.comoFunciona": ["Necessidade de materiais", "Liberação", "Consumo extra", "Justificar diferença", "Lote interno × Lote Veridi", "Custo industrial"],
  "estoque.posicao": ["Físico", "Reservado", "Disponível", "Em Compra"],
  "estoque.lotes": ["Lote interno", "Lote do fornecedor", "Situação", "Laudo", "Expedições", "Custo de aquisição", "Destino comercial", "Auditoria"],
  "compras.ordens": ["Rascunho × confirmada", "Quantidade em aberto", "Preço previsto", "Recebimentos"],
  "compras.recebimentos": ["Lote do fornecedor × lote interno", "Custo efetivo", "Material do cliente", "Localização"],
  "qualidadeDocumentos.comoFunciona": ["CoA", "Situação do CoA", "Situação do lote", "Pendências"],
  "comercial.expedicao": ["Separação", "Reservado disponível", "Enviar agora", "Conferência", "Confirmar", "Folha de separação"],
  "faturamento.comoFunciona": ["Quantidade faturada", "Preço acordado", "Preço faturado", "Alteração de preço", "Situação"],
  "comercial.projeto": ["Versão de orçamento", "Faixa de precificação", "Aceite", "Produtos do projeto", "Condições comerciais", "Documentos do projeto"],
  "consultaCliente.comoFunciona": ["Abas", "Trocar cliente", "Resumo", "Abrir … completo"],
};

/**
 * Telas do menu que NÃO precisam de "Como funciona": entrada, erro e
 * espaço reservado. Toda outra tela roteada dentro da casca precisa abrir
 * uma ajuda — é o inventário que impede uma tela nova de nascer sem ela.
 */
const SEM_AJUDA_POR_DECISAO = new Set([
  // A casca é layout, não tela.
  "AppShell",
  "LoginPage",
  "NotFoundPage",
  "PlaceholderPage",
]);

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

  /**
   * Inventário: toda tela roteada dentro da casca abre uma ajuda.
   *
   * Lê o `App.tsx` de verdade — a lista de rotas — e confere que o arquivo
   * de cada página renderiza `<ContextHelp>` (ou o `<ReportPage>` que já o
   * renderiza). Uma tela nova sem ajuda quebra aqui, antes de chegar a
   * alguém.
   */
  it("toda tela roteada na casca do sistema abre um Como funciona", () => {
    const app = ler(join(srcDir, "App.tsx"));
    const casca = app.slice(app.indexOf("<Route element={<AppShell />}>"));
    const importados = new Map<string, string>();
    for (const bloco of app.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'](\.\/[^"']+)["']/g)) {
      for (const nome of bloco[1]!.split(",")) {
        const limpo = nome.trim().split(/\s+as\s+/).pop()?.trim();
        if (limpo) importados.set(limpo, bloco[2]!);
      }
    }

    const semAjuda: string[] = [];
    const vistos = new Set<string>();
    for (const encontro of casca.matchAll(/element=\{<(\w+)\s*\/>\}/g)) {
      const componente = encontro[1]!;
      if (vistos.has(componente) || SEM_AJUDA_POR_DECISAO.has(componente)) continue;
      vistos.add(componente);
      const modulo = importados.get(componente);
      if (!modulo) continue;
      const caminho = join(srcDir, `${modulo.replace(/^\.\//, "")}.tsx`);
      let conteudo: string;
      try {
        conteudo = ler(caminho);
      } catch {
        continue;
      }
      if (!conteudo.includes("<ContextHelp") && !conteudo.includes("<ReportPage")) {
        semAjuda.push(`${componente} (${relativo(caminho)})`);
      }
    }

    expect(vistos.size).toBeGreaterThan(40);
    expect(semAjuda).toEqual([]);
  });

  it("todo tópico explica a tela: resumo, vocabulário, caminho e o que costuma pegar", () => {
    const rasos: string[] = [];
    for (const [id, topico] of Object.entries(helpTopics) as [string, HelpTopic][]) {
      const etapas =
        (topico.flows ?? []).reduce((soma, fluxo) => soma + fluxo.steps.length, 0) +
        (topico.flow ?? []).length;
      if (topico.summary.length < 120) rasos.push(`${id}: resumo curto`);
      if ((topico.concepts ?? []).length < 3) rasos.push(`${id}: menos de 3 conceitos`);
      if (etapas < 3) rasos.push(`${id}: menos de 3 etapas`);
      if ((topico.notes ?? []).length < 2) rasos.push(`${id}: menos de 2 ressalvas`);
    }
    expect(rasos).toEqual([]);
  });

  it.each(Object.entries(ESSENCIAIS))("%s nomeia os componentes relevantes da tela", (id, termos) => {
    const topico: HelpTopic = helpTopics[id as keyof typeof helpTopics];
    const glossario = (topico.concepts ?? []).map((conceito) => `${conceito.term} ${conceito.text}`).join("\n");
    const faltando = termos.filter((termo) => !glossario.includes(termo));
    expect(faltando).toEqual([]);
  });

  it("nenhum tópico ou dica fala em vocabulário técnico", () => {
    const achados: string[] = [];
    for (const [id, topico] of Object.entries(helpTopics) as [string, HelpTopic][]) {
      for (const texto of textoDoTopico(topico)) {
        for (const termo of TERMOS_PROIBIDOS) {
          if (termo.test(texto)) achados.push(`${id}: ${termo} em "${texto.slice(0, 60)}"`);
        }
      }
    }
    for (const [id, dica] of Object.entries(helpHints)) {
      for (const texto of [dica.label, dica.text]) {
        for (const termo of TERMOS_PROIBIDOS) {
          if (termo.test(texto)) achados.push(`${id}: ${termo} em "${texto.slice(0, 60)}"`);
        }
      }
    }
    expect(achados).toEqual([]);
  });

  it("os tópicos criados para as telas de Gestão existem e estão preenchidos", () => {
    const novos = [
      "estruturaCusto.comoFunciona",
      "precificacao.comoFunciona",
      "calculo.comoFunciona",
      "templateCusto.comoFunciona",
      "politicaPreco.comoFunciona",
      "relatorio.comoFunciona",
      "consultaCliente.comoFunciona",
    ] as const;

    for (const id of novos) {
      const topico: HelpTopic = helpTopics[id];
      expect(topico, id).toBeDefined();
      expect(topico.module).toBe("gestao");
      // O vocabulário vem antes do caminho: quem não sabe o que é "base de
      // custo" não aproveita um fluxo que começa por ela.
      expect((topico.concepts ?? []).length, `${id}: conceitos`).toBeGreaterThanOrEqual(4);
      const etapas = [...(topico.flow ?? []), ...(topico.flows ?? []).flatMap((fluxo) => fluxo.steps)];
      expect(etapas.length, `${id}: etapas`).toBeGreaterThanOrEqual(4);
      // As ressalvas são o valor real do painel — o que a tela NÃO faz.
      expect((topico.notes ?? []).length, `${id}: ressalvas`).toBeGreaterThanOrEqual(4);
      expect(
        etapas.some((etapa) => etapa.tone === "accent"),
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
