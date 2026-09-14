import { describe, expect, it } from "vitest";
import { rotuloDaOrigem } from "./use-contextual-create";

/**
 * O "← Voltar para …" da criação contextual e do retorno de cadastro.
 * CONTEXT-ORIGIN-LABEL-ROUTE-01: o recurso aberto pelo Roteiro dizia "tela anterior".
 */
describe("rotuloDaOrigem", () => {
  it("Roteiro de Produção, na lista e na ficha, com ou sem busca", () => {
    expect(rotuloDaOrigem("/planejamento/perfis-producao")).toBe("Roteiro de produção");
    expect(rotuloDaOrigem("/planejamento/perfis-producao/perfil-1?aba=etapas")).toBe("Roteiro de produção");
  });

  it("as origens que já existiam continuam", () => {
    expect(rotuloDaOrigem("/comercial/projetos/prj-1?quoteVersionId=v2")).toBe("Projeto");
    expect(rotuloDaOrigem("/produtos/prod-1/custos")).toBe("Estrutura de custos");
  });

  it("a página própria do Orçamento (QUOTE-WORKSPACE-NAVIGATION-01)", () => {
    expect(rotuloDaOrigem("/comercial/orcamentos/qv-1")).toBe("Orçamento");
    expect(rotuloDaOrigem("/comercial/orcamentos/qv-1?quoteLineId=ql-1")).toBe("Orçamento");
  });

  it("a lista geral de Orçamentos, com ou sem filtros (QUOTES-HUB-01)", () => {
    expect(rotuloDaOrigem("/comercial/orcamentos")).toBe("Orçamentos");
    expect(rotuloDaOrigem("/comercial/orcamentos?status=todos&page=2")).toBe("Orçamentos");
    expect(rotuloDaOrigem("/comercial/orcamentos/")).toBe("Orçamentos");
  });

  it("rota desconhecida: tela anterior", () => {
    expect(rotuloDaOrigem("/planejamento/quadro")).toBe("tela anterior");
  });
});
