import { beforeEach, describe, expect, it } from "vitest";
import {
  createRouteWithContext,
  discardContextualCreate,
  findPendingForRoute,
  finishContextualCreate,
  isRotaInterna,
  originRouteWithReturn,
  pruneContextualCreates,
  readContextualCreate,
  startContextualCreate,
  takeContextualCreate,
} from "./contextual-create";

/**
 * O que estes testes protegem é a promessa do fluxo: quem sai do meio de um
 * formulário para cadastrar uma entidade volta com tudo como estava. Perder o
 * rascunho aqui não é defeito cosmético — é o produto inteiro digitado de
 * novo.
 */

const rascunho = {
  name: "Coenzima Q10 60 cápsulas",
  dosesPerPackage: "60",
  notes: "amostra para validação",
};

function pedido(over: Partial<Parameters<typeof startContextualCreate>[0]> = {}) {
  return {
    originRoute: "/cadastros/produtos/novo",
    fieldKey: "customerId",
    entityType: "customer",
    draft: rascunho,
    ...over,
  };
}

beforeEach(() => {
  sessionStorage.clear();
});

describe("ida", () => {
  it("guarda o rascunho e devolve um token para a URL", () => {
    const token = startContextualCreate(pedido())!;

    expect(token).toBeTruthy();
    const registro = readContextualCreate(token);
    expect(registro?.originRoute).toBe("/cadastros/produtos/novo");
    expect(registro?.fieldKey).toBe("customerId");
    expect(registro?.draft).toEqual(rascunho);
    expect(registro?.version).toBe(1);
  });

  it("guarda contexto extra quando a origem precisa lembrar de mais que o campo", () => {
    // A linha da tabela que pediu, o tipo que aquele campo aceita.
    const token = startContextualCreate(pedido({ context: { rowKey: "linha-3" } }))!;
    expect(readContextualCreate(token)?.context).toEqual({ rowKey: "linha-3" });
  });

  it("ler não consome — a tela de criação sobrevive a um refresh", () => {
    const token = startContextualCreate(pedido())!;

    expect(readContextualCreate(token)).not.toBeNull();
    // Segunda leitura é o F5: o contexto tem de continuar lá.
    expect(readContextualCreate(token)?.draft).toEqual(rascunho);
  });

  it("token desconhecido não explode nem inventa contexto", () => {
    expect(readContextualCreate("nao-existe")).toBeNull();
    expect(readContextualCreate(null)).toBeNull();
    expect(takeContextualCreate(undefined)).toBeNull();
  });
});

describe("volta", () => {
  it("sucesso devolve o rascunho e a entidade criada", () => {
    const token = startContextualCreate(pedido())!;
    finishContextualCreate(token, {
      entityType: "customer",
      entityId: "cli-1",
      label: "THE KING SUPLEMENTOS",
    });

    const retomada = takeContextualCreate(token)!;
    expect(retomada.record.draft).toEqual(rascunho);
    expect(retomada.record.result?.entityId).toBe("cli-1");
  });

  it("cancelamento devolve o rascunho e nenhum resultado", () => {
    const token = startContextualCreate(pedido())!;

    // Cancelar não grava `result` — é essa ausência que a origem lê como
    // "restaure o rascunho e não selecione nada".
    const retomada = takeContextualCreate(token)!;
    expect(retomada.record.draft).toEqual(rascunho);
    expect(retomada.record.result).toBeUndefined();
  });

  /*
   * A remoção é separada da leitura de propósito. Apagar junto com o `read`
   * perderia o rascunho se a restauração falhasse no meio — e o formulário
   * ficaria vazio sem ter como voltar atrás.
   */
  it("o contexto só some depois que a origem confirma a restauração", () => {
    const token = startContextualCreate(pedido())!;

    const retomada = takeContextualCreate(token)!;
    expect(readContextualCreate(token)).not.toBeNull();

    retomada.commit();
    expect(readContextualCreate(token)).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("descartar limpa sem deixar lixo", () => {
    const token = startContextualCreate(pedido())!;
    discardContextualCreate(token);

    expect(readContextualCreate(token)).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });
});

describe("botão Voltar do navegador", () => {
  /*
   * Voltar sem usar "Cancelar" chega à origem SEM o parâmetro de retomada.
   * Sem o ponteiro de contexto ativo, o rascunho ficaria órfão no
   * armazenamento enquanto o formulário aparecia vazio na tela.
   */
  it("a origem acha o contexto pendente pela própria rota", () => {
    const token = startContextualCreate(pedido())!;

    expect(findPendingForRoute("/cadastros/produtos/novo")).toBe(token);
  });

  it("não restaura o rascunho de outro formulário", () => {
    startContextualCreate(pedido());

    expect(findPendingForRoute("/cadastros/fornecedores")).toBeNull();
  });

  it("depois de consumido não há mais pendência", () => {
    const token = startContextualCreate(pedido())!;
    takeContextualCreate(token)!.commit();

    expect(findPendingForRoute("/cadastros/produtos/novo")).toBeNull();
  });
});

describe("isolamento entre contextos", () => {
  it("dois tokens não se atropelam", () => {
    const tokenA = startContextualCreate(pedido({ draft: { name: "A" } }))!;
    const tokenB = startContextualCreate(
      pedido({ draft: { name: "B" }, entityType: "supplier", fieldKey: "supplierId" }),
    )!;

    expect(tokenA).not.toBe(tokenB);

    finishContextualCreate(tokenB, {
      entityType: "supplier",
      entityId: "forn-9",
      label: "Fornecedor Nove",
    });

    // Terminar B não pode marcar A como concluído.
    expect(readContextualCreate(tokenA)?.result).toBeUndefined();
    expect(readContextualCreate(tokenA)?.draft).toEqual({ name: "A" });

    // Nem consumir A pode levar o rascunho de B junto.
    takeContextualCreate(tokenA)!.commit();
    expect(readContextualCreate(tokenB)?.draft).toEqual({ name: "B" });
  });

  it("chave é por token, não global por entidade", () => {
    const primeiro = startContextualCreate(pedido({ draft: { name: "primeiro" } }))!;
    const segundo = startContextualCreate(pedido({ draft: { name: "segundo" } }))!;

    // Uma chave global tipo `productDraft` faria o segundo apagar o primeiro.
    expect(readContextualCreate(primeiro)?.draft).toEqual({ name: "primeiro" });
    expect(readContextualCreate(segundo)?.draft).toEqual({ name: "segundo" });
  });
});

describe("rota de retorno", () => {
  /*
   * O token viaja na URL e a URL é editável. Sem esta guarda, um registro
   * forjado transformaria o "Voltar" num redirecionamento para fora do
   * sistema — a forma clássica de fazer uma tela confiável entregar o
   * usuário a outra.
   */
  it("recusa destino que sai do sistema", () => {
    expect(isRotaInterna("https://exemplo.invalido/roubo")).toBe(false);
    expect(isRotaInterna("//exemplo.invalido/roubo")).toBe(false);
    expect(isRotaInterna("/\\exemplo.invalido")).toBe(false);
    expect(isRotaInterna("/caminho\\com\\barra-invertida")).toBe(false);
    expect(isRotaInterna("javascript:alert(1)")).toBe(false);
    expect(isRotaInterna("/http:/exemplo")).toBe(false);
    expect(isRotaInterna("")).toBe(false);
    expect(isRotaInterna(undefined)).toBe(false);
  });

  it("aceita caminho interno, com query e âncora", () => {
    expect(isRotaInterna("/cadastros/produtos/novo")).toBe(true);
    expect(isRotaInterna("/comercial/pedidos/novo?cliente=1")).toBe(true);
  });

  it("origem externa nem chega a virar contexto", () => {
    expect(startContextualCreate(pedido({ originRoute: "https://exemplo.invalido" }))).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("registro adulterado no armazenamento é descartado, não seguido", () => {
    sessionStorage.setItem(
      "contextual-create:forjado",
      JSON.stringify({
        version: 1,
        token: "forjado",
        originRoute: "https://exemplo.invalido/roubo",
        fieldKey: "customerId",
        entityType: "customer",
        draft: {},
        createdAt: Date.now(),
      }),
    );

    expect(readContextualCreate("forjado")).toBeNull();
    expect(sessionStorage.getItem("contextual-create:forjado")).toBeNull();
  });
});

describe("validade", () => {
  it("rascunho vencido não volta dias depois", () => {
    const token = startContextualCreate(pedido())!;

    // Sete horas depois: a pessoa nunca voltou daquela saída.
    sessionStorage.setItem(
      `contextual-create:${token}`,
      JSON.stringify({
        ...JSON.parse(sessionStorage.getItem(`contextual-create:${token}`)!),
        createdAt: Date.now() - 7 * 60 * 60 * 1000,
      }),
    );

    expect(readContextualCreate(token)).toBeNull();
    // E some do armazenamento em vez de esperar outra leitura o rejeitar.
    expect(sessionStorage.getItem(`contextual-create:${token}`)).toBeNull();
  });

  it("a varredura some com o vencido e poupa o que ainda vale", () => {
    const token = startContextualCreate(pedido())!;

    pruneContextualCreates(Date.now() + 60 * 1000);
    expect(readContextualCreate(token)?.draft).toEqual(rascunho);

    pruneContextualCreates(Date.now() + 7 * 60 * 60 * 1000);
    expect(readContextualCreate(token)).toBeNull();
  });

  it("formato antigo é descartado, não interpretado a esmo", () => {
    sessionStorage.setItem(
      "contextual-create:antigo",
      JSON.stringify({ token: "antigo", originRoute: "/x", fieldKey: "y", entityType: "z" }),
    );

    expect(readContextualCreate("antigo")).toBeNull();
  });

  it("registro corrompido não quebra a leitura", () => {
    sessionStorage.setItem("contextual-create:quebrado", "{ isto não é json");

    pruneContextualCreates();

    expect(sessionStorage.getItem("contextual-create:quebrado")).toBeNull();
  });
});

describe("URLs do fluxo", () => {
  it("leva o token para a tela de criação sem perder a query que já existia", () => {
    expect(createRouteWithContext("/cadastros/clientes/novo", "abc")).toBe(
      "/cadastros/clientes/novo?origem=abc",
    );
    expect(createRouteWithContext("/cadastros/itens/novo?tipo=RAW_MATERIAL", "abc")).toBe(
      "/cadastros/itens/novo?tipo=RAW_MATERIAL&origem=abc",
    );
  });

  it("volta para a rota exata de origem, com o token de retomada", () => {
    const token = startContextualCreate(pedido())!;
    const registro = readContextualCreate(token)!;

    expect(originRouteWithReturn(registro)).toBe(
      `/cadastros/produtos/novo?retomar=${token}`,
    );
  });
});
