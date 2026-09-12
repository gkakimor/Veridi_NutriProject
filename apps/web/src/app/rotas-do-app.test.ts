import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A migração para router de dados não pode mudar endereço nenhum.
 *
 * `BrowserRouter` + `Routes` virou `createBrowserRouter` +
 * `RouterProvider` porque a guarda de alterações não salvas depende de
 * `useBlocker`, que só existe em router de dados. É troca de MECANISMO: o que
 * a pessoa digita na barra de endereços, o que está nos favoritos e o que foi
 * colado num chamado continua resolvendo na mesma tela.
 *
 * A lista abaixo é a de `origin/main` antes da migração. Rota nova é
 * bem-vinda — mas passa por aqui deliberadamente, não de carona.
 *
 * Lê o FONTE em vez de montar o router porque montar importaria as mais de
 * cem telas do ERP, e o motor de PDF junto, para conferir strings.
 */
const ROTAS_ANTES_DA_MIGRACAO = [
  "*",
  "/administracao/documentos",
  "/administracao/usuarios",
  "/cadastros/clientes",
  "/cadastros/clientes/novo",
  "/cadastros/fornecedores",
  "/cadastros/fornecedores/novo",
  "/cadastros/itens",
  "/cadastros/itens/novo",
  "/cadastros/produtos",
  "/cadastros/produtos/novo",
  "/calculos-custo/:id",
  "/comercial/amostras",
  "/comercial/amostras/:id",
  "/comercial/amostras/:id/etiqueta",
  "/comercial/expedicoes",
  "/comercial/expedicoes/:id",
  "/comercial/expedicoes/:id/imprimir",
  "/comercial/faturamento",
  "/comercial/faturamento/:id",
  "/comercial/faturamento/:id/imprimir",
  "/comercial/orcamentos/:id/imprimir",
  "/comercial/pedidos",
  "/comercial/pedidos/:id",
  "/comercial/pedidos/:id/imprimir",
  "/comercial/pedidos/novo",
  "/comercial/projetos",
  "/comercial/projetos/:id",
  "/compras/item-fornecedor",
  "/compras/ordens",
  "/compras/ordens/:id",
  "/compras/ordens/:id/imprimir",
  "/compras/ordens/nova",
  "/compras/recebimentos",
  "/compras/recebimentos/:id",
  "/compras/recebimentos/:id/imprimir",
  "/compras/recebimentos/material-do-cliente",
  "/compras/recebimentos/novo",
  "/estoque",
  "/estoque/:itemId",
  "/estoque/inventario",
  "/estoque/lotes",
  "/estoque/lotes/:id",
  "/estoque/lotes/:id/etiqueta",
  "/estoque/lotes/:id/rastreabilidade/imprimir",
  "/estoque/lotes/escanear",
  "/estoque/materiais-de-clientes",
  "/estoque/movimentacoes",
  "/gestao/politicas-precificacao",
  "/gestao/politicas-precificacao/:policyId",
  "/gestao/precificacao",
  "/gestao/precificacao/:pricingId",
  "/gestao/recursos-industriais",
  "/gestao/recursos-industriais/:id",
  "/gestao/recursos-industriais/novo",
  "/gestao/templates-estrutura",
  "/gestao/templates-estrutura/:templateId",
  // PLANNING-CALENDAR-01: rota nova, declarada aqui de propósito.
  "/planejamento/calendario",
  "/planejamento/quadro",
  "/planejamento/perfis-producao",
  "/planejamento/perfis-producao/:profileId",
  "/print/calculo-custo/:id",
  "/print/cmv/:productId",
  "/print/contagem-fisica",
  "/print/custo-producao/:id",
  "/print/estrutura-custos/:id",
  "/print/expedicao-separacao/:id",
  "/print/posicao-estoque",
  "/print/precificacao/:id",
  "/print/producao-picking/:id",
  "/print/qualidade-pendencias",
  "/print/relatorios/:reportCode",
  "/print/relatorios/R-06",
  "/print/relatorios/R-14",
  "/producao/formulacoes",
  "/producao/formulacoes/:productId",
  "/producao/formulacoes/:productId/versoes/:versionId",
  "/producao/ordens",
  "/producao/ordens/:id",
  "/producao/ordens/:id/imprimir",
  "/producao/ordens/:id/receita",
  "/producao/ordens/:id/receita/imprimir",
  "/producao/ordens/nova",
  "/producao/picking",
  "/producao/produto-acabado",
  "/producao/templates-formulacao",
  "/producao/templates-formulacao/:templateId",
  "/produtos/:productId/cmv",
  "/produtos/:productId/custos",
  "/qualidade/documentos",
  "/relatorios",
  "/relatorios/comercial/atendimento",
  "/relatorios/comercial/orcamento-precificacao",
  "/relatorios/comercial/pedido-operacao",
  "/relatorios/comercial/pedidos",
  "/relatorios/compras/atrasadas",
  "/relatorios/compras/em-compra",
  "/relatorios/compras/ordens",
  "/relatorios/compras/recebimentos",
  "/relatorios/custos/industrial-por-produto",
  "/relatorios/custos/precificacao-por-produto",
  "/relatorios/estoque/movimentacoes",
  "/relatorios/estoque/posicao",
  "/relatorios/estoque/vencimentos",
  "/relatorios/faturamento/pedido-entregue-faturado",
  "/relatorios/faturamento/pendentes",
  "/relatorios/faturamento/periodo",
  "/relatorios/producao/consumo",
  "/relatorios/producao/necessidades",
  "/relatorios/producao/planejado-realizado",
  "/relatorios/producao/rastreabilidade",
];

function rotasDeclaradas(fonte: string): string[] {
  return [...fonte.matchAll(/path="([^"]*)"/g)].map((achado) => achado[1] as string).sort();
}

describe("rotas do app", () => {
  const fonte = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");

  it("nenhum endereço mudou na migração para router de dados", () => {
    expect(rotasDeclaradas(fonte)).toEqual([...ROTAS_ANTES_DA_MIGRACAO].sort());
  });

  it("o router é de dados — é o que faz useBlocker existir", () => {
    expect(fonte).toContain("createBrowserRouter");
    expect(fonte).toContain("RouterProvider");
    expect(fonte).not.toContain("<BrowserRouter>");
  });

  it("a guarda de alterações não salvas é uma só, na raiz da árvore", () => {
    expect([...fonte.matchAll(/<UnsavedChangesProvider>/g)]).toHaveLength(1);
  });
});
