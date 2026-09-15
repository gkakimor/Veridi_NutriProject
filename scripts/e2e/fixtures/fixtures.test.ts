import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { corpoSeguro, ErroDeApi, exigir } from "./api.mjs";
import {
  criarCliente,
  criarFormulacaoAtiva,
  criarFornecedor,
  criarItem,
  criarProdutoOperacional,
} from "./cadastros.mjs";
import {
  adicionarLinha,
  criarProdutoDoProjeto,
  criarProjeto,
  criarVersao,
  gravarCondicoes,
  linhaDoProduto,
  precificarLinha,
} from "./comercial.mjs";
import { idDaRota, ROTA_DA_VERSAO, ROTA_DO_PROJETO, rotaDaVersao, rotaDoProjeto } from "./comercial-ui.mjs";
import { diaComercial, porExtenso } from "./datas.mjs";
import {
  aplicarRoteiro,
  aplicarRoteiroNaOrdem,
  criarOrdemDeProducao,
  criarRoteiroAtivo,
  planejarOrdem,
} from "./producao.mjs";
import { carimbar, criarRun } from "./run.mjs";
import { rotaCasa } from "./ui.mjs";

/**
 * E2E-BASELINE-REDESIGN-WAVE-01-02 — as fixtures das suítes, sem servidor.
 *
 * Fixture é pré-condição: carimba a massa com o runId, lê id e código da
 * resposta, não procura registro alheio e falha dizendo método, rota e status.
 * A API aqui é falsa e registra cada chamada — o contrato das rotas mora nos
 * testes de API; o que se prova é o que a fixture MANDA e o que ela DEVOLVE.
 */

type Resposta = { status: number; corpo?: unknown; erro?: unknown };
type Chamada = { metodo: string; caminho: string; corpo: any };

function apiFalsa(rotas: Record<string, (corpo: any) => Resposta>) {
  const chamadas: Chamada[] = [];
  const api = async (caminho: string, init: { method?: string; body?: string } = {}) => {
    const metodo = init.method ?? "GET";
    const corpo = init.body ? JSON.parse(init.body) : undefined;
    chamadas.push({ metodo, caminho, corpo });
    const rota = rotas[`${metodo} ${caminho}`];
    if (!rota) return { status: 404, corpo: null, erro: { error: "not_found" } };
    const resposta = rota(corpo);
    return resposta.status < 400
      ? { status: resposta.status, corpo: resposta.corpo, erro: null }
      : { status: resposta.status, corpo: null, erro: resposta.erro };
  };
  return { api, chamadas, rotasChamadas: () => chamadas.map((c) => `${c.metodo} ${c.caminho}`) };
}

describe("exigir: a chamada de preparação que não aceita falha", () => {
  it("devolve o corpo em sucesso", async () => {
    const { api } = apiFalsa({ "POST /customers": () => ({ status: 201, corpo: { id: "c1" } }) });
    await expect(exigir(api, "POST", "/customers", { legalName: "x" })).resolves.toEqual({ id: "c1" });
  });

  it("falha mostrando método, rota, status e corpo — sem o segredo", async () => {
    const { api } = apiFalsa({
      "POST /auth/login": () => ({
        status: 400,
        erro: { error: "validation_error", password: "segredo-que-nao-sai", issues: [{ path: "email" }] },
      }),
    });
    const erro = await exigir(api, "POST", "/auth/login", { email: "a", password: "segredo-que-nao-sai" }).catch(
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(ErroDeApi);
    expect((erro as ErroDeApi).message).toMatch(/^POST \/auth\/login → 400: .*validation_error/);
    expect((erro as ErroDeApi).message).not.toContain("segredo-que-nao-sai");
    expect((erro as ErroDeApi).status).toBe(400);
  });

  it("redige parâmetro sensível da rota e corta corpo longo", async () => {
    const { api } = apiFalsa({ "GET /x?token=abc&search=ok": () => ({ status: 500, erro: "x".repeat(2000) }) });
    const erro = (await exigir(api, "GET", "/x?token=abc&search=ok").catch((e: unknown) => e)) as Error;
    expect(erro.message).toContain("GET /x?token=[redigido]&search=ok → 500");
    expect(erro.message).not.toContain("abc");
    expect(corpoSeguro("x".repeat(2000)).length).toBeLessThanOrEqual(601);
    expect(corpoSeguro(null)).toBe("(sem corpo)");
  });
});

describe("fixtures de cadastro", () => {
  it("cliente e fornecedor: nome carimbado, id e código lidos da resposta", async () => {
    const run = criarRun();
    const { api, chamadas, rotasChamadas } = apiFalsa({
      "POST /customers": (corpo) => ({ status: 201, corpo: { id: "uuid-c", code: "CLI-000077", legalName: corpo.legalName } }),
      "POST /suppliers": (corpo) => ({ status: 201, corpo: { id: "uuid-f", code: "FOR-000114", legalName: corpo.legalName } }),
    });
    const cliente = await criarCliente(api, run, { email: "contato@empresa.com.br" });
    const fornecedor = await criarFornecedor(api, run, { nome: carimbar(run, "Fornecedor de lote") });

    expect(cliente).toEqual({ id: "uuid-c", codigo: "CLI-000077", nome: `Cliente ${run.carimbo}` });
    expect(fornecedor).toEqual({ id: "uuid-f", codigo: "FOR-000114", nome: `Fornecedor de lote ${run.carimbo}` });
    expect(rotasChamadas()).toEqual(["POST /customers", "POST /suppliers"]);
    expect(chamadas[0]!.corpo).toEqual({ email: "contato@empresa.com.br", legalName: `Cliente ${run.carimbo}` });
  });

  it("recusa nome sem o carimbo e fixture sem execução — antes de chamar a API", async () => {
    const run = criarRun();
    const { api, chamadas } = apiFalsa({});
    await expect(criarCliente(api, run, { nome: "Cliente de nome fixo" })).rejects.toThrow(/carimbo/);
    await expect(criarFornecedor(api, undefined as never)).rejects.toThrow(/sem execução/);
    await expect(criarItem(api, { runId: "X" } as never)).rejects.toThrow(/sem execução/);
    expect(chamadas).toEqual([]);
  });

  it("item leva só os controles pedidos e devolve o código do domínio", async () => {
    const run = criarRun();
    const { api, chamadas } = apiFalsa({
      "POST /items": (corpo) => ({
        status: 201,
        corpo: {
          id: "uuid-i",
          code: "MP-000817",
          name: corpo.name,
          type: corpo.type,
          unitCode: corpo.unitCode,
          controlsLot: true,
          controlsExpiry: true,
        },
      }),
    });
    const item = await criarItem(api, run, { controlaLote: true, controlaValidade: true, custoDeReferencia: 10 });
    expect(chamadas[0]!.corpo).toEqual({
      type: "RAW_MATERIAL",
      name: `Insumo ${run.carimbo}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: true,
      initialCostReference: { unitCost: "10", uomCode: "kg" },
    });
    expect(item).toMatchObject({ id: "uuid-i", codigo: "MP-000817", unidade: "kg", controlaLote: true, controlaValidade: true });

    await criarItem(api, run, { tipo: "PACKAGING", unidade: "un" });
    expect(chamadas[1]!.corpo).toEqual({ type: "PACKAGING", name: `Embalagem ${run.carimbo}`, unitCode: "un" });
  });

  it("produto operacional exige o cliente da execução e recusa ciclo de desenvolvimento", async () => {
    const run = criarRun();
    const cliente = { id: "uuid-c" };
    const aprovado = apiFalsa({
      "POST /products": (corpo) => ({
        status: 201,
        corpo: { id: "uuid-p", code: "PROD-000174", name: corpo.name, lifecycle: "APPROVED", finishedProductItemId: "uuid-pa" },
      }),
    });
    const produto = await criarProdutoOperacional(aprovado.api, run, { cliente, unidadesPorCaixa: "12" });
    expect(aprovado.chamadas[0]!.corpo).toEqual({
      name: `Produto ${run.carimbo}`,
      customerId: "uuid-c",
      finishedUnitCode: "un",
      unitsPerShippingBox: 12,
    });
    expect(produto).toEqual({
      id: "uuid-p",
      codigo: "PROD-000174",
      nome: `Produto ${run.carimbo}`,
      itemAcabadoId: "uuid-pa",
      unidade: "un",
    });

    const emDesenvolvimento = apiFalsa({
      "POST /products": () => ({ status: 201, corpo: { id: "p", code: "PROD-2", lifecycle: "DEVELOPMENT", finishedProductItemId: "i" } }),
    });
    await expect(criarProdutoOperacional(emDesenvolvimento.api, run, { cliente })).rejects.toThrow(/não nasceu operacional/);
    await expect(criarProdutoOperacional(aprovado.api, run, {})).rejects.toThrow(/exige o cliente/);
  });

  it("formulação ativa: rascunho novo, componentes pelos ids do item, ativação conferida", async () => {
    const run = criarRun();
    const { api, chamadas, rotasChamadas } = apiFalsa({
      "GET /products/uuid-p/formulations": () => ({ status: 200, corpo: { versions: [] } }),
      "POST /products/uuid-p/formulation-versions": () => ({ status: 201, corpo: { id: "uuid-v", status: "DRAFT", versionNumber: 1 } }),
      "PATCH /formulation-versions/uuid-v": () => ({ status: 200, corpo: { id: "uuid-v", status: "DRAFT" } }),
      "POST /formulation-versions/uuid-v/activate": () => ({ status: 200, corpo: { id: "uuid-v", status: "ACTIVE", versionNumber: 1 } }),
    });
    const formulacao = await criarFormulacaoAtiva(api, run, {
      produto: { id: "uuid-p" },
      componentes: [
        { item: { id: "uuid-i", unidade: "kg" }, quantidade: 0.5, unidade: "g" },
        { item: { id: "uuid-e", unidade: "un" }, quantidade: "1" },
      ],
    });
    expect(formulacao).toEqual({ id: "uuid-v", numero: 1, status: "ACTIVE" });
    expect(rotasChamadas()).toEqual([
      "GET /products/uuid-p/formulations",
      "POST /products/uuid-p/formulation-versions",
      "PATCH /formulation-versions/uuid-v",
      "POST /formulation-versions/uuid-v/activate",
    ]);
    expect(chamadas[2]!.corpo).toEqual({
      basisQuantity: "1",
      notes: `Massa E2E ${run.carimbo}`,
      components: [
        { itemId: "uuid-i", quantity: "0.5", unitCode: "g" },
        { itemId: "uuid-e", quantity: "1", unitCode: "un" },
      ],
    });
  });

  it("formulação reaproveita o rascunho do PRÓPRIO produto e lança se não ficar ativa", async () => {
    const run = criarRun();
    const { api, rotasChamadas } = apiFalsa({
      "GET /products/uuid-p/formulations": () => ({
        status: 200,
        corpo: { versions: [{ id: "uuid-velha", status: "ACTIVE" }, { id: "uuid-r", status: "DRAFT" }] },
      }),
      "PATCH /formulation-versions/uuid-r": () => ({ status: 200, corpo: {} }),
      "POST /formulation-versions/uuid-r/activate": () => ({ status: 200, corpo: { id: "uuid-r", status: "DRAFT", versionNumber: 2 } }),
    });
    await expect(
      criarFormulacaoAtiva(api, run, { produto: { id: "uuid-p", codigo: "PROD-9" }, componentes: [{ item: { id: "i", unidade: "g" }, quantidade: "1" }] }),
    ).rejects.toThrow(/V2 de PROD-9 ficou DRAFT, não ACTIVE/);
    expect(rotasChamadas()).not.toContain("POST /products/uuid-p/formulation-versions");
    await expect(criarFormulacaoAtiva(api, run, { produto: { id: "uuid-p" }, componentes: [] })).rejects.toThrow(/componente/);
  });

  it("nenhuma fixture navega, lista cadastro para pegar o primeiro ou cita código da carga", () => {
    for (const modulo of ["cadastros.mjs", "producao.mjs", "comercial.mjs"]) {
      const fonte = readFileSync(new URL(`./${modulo}`, import.meta.url), "utf8");
      expect(fonte, modulo).not.toMatch(/pagina|\.goto\(|\[0\]/);
      expect(fonte, modulo).not.toMatch(/"GET", "\/(customers|suppliers|items|products)[?"]/);
      expect(fonte, modulo).not.toMatch(/\b(CLI|FOR|MP|PROD|PED|ORC)-\d{4,}\b/);
    }
  });
});

describe("fixtures comerciais (E2E-BASELINE-REDESIGN-WAVE-03)", () => {
  const linhaDto = (id: string, productId: string, extra: Record<string, unknown> = {}) => ({
    id,
    productId,
    quotedQuantity: null,
    unitPrice: null,
    priceOrigin: null,
    inheritedFromQuoteLineId: null,
    priceOriginReason: null,
    ...extra,
  });
  const versaoDto = (lines: unknown[] = []) => ({
    id: "uuid-v",
    code: "ORC-000321",
    versionNumber: 2,
    versionLabel: "ORC-000321 · V2",
    status: "DRAFT",
    validUntil: null,
    lines,
  });

  it("projeto e produto do projeto: nome carimbado, id e código lidos da resposta", async () => {
    const run = criarRun();
    const { api, chamadas, rotasChamadas } = apiFalsa({
      "POST /projects": (corpo) => ({ status: 201, corpo: { id: "uuid-pj", code: "PROJ-000183", name: corpo.name } }),
      "POST /projects/uuid-pj/products": (corpo) => ({
        status: 201,
        corpo: { id: "uuid-pp", productId: "uuid-p", productCode: "PROD-000174", productName: corpo.name },
      }),
    });
    const projeto = await criarProjeto(api, run, { cliente: { id: "uuid-c" } });
    const produto = await criarProdutoDoProjeto(api, run, { projeto });

    expect(projeto).toEqual({ id: "uuid-pj", codigo: "PROJ-000183", nome: `Projeto ${run.carimbo}` });
    expect(produto).toEqual({
      vinculoId: "uuid-pp",
      id: "uuid-p",
      codigo: "PROD-000174",
      nome: `Produto ${run.carimbo}`,
      unidade: "un",
    });
    expect(rotasChamadas()).toEqual(["POST /projects", "POST /projects/uuid-pj/products"]);
    expect(chamadas[0]!.corpo).toEqual({ customerId: "uuid-c", name: `Projeto ${run.carimbo}` });
    expect(chamadas[1]!.corpo).toEqual({ operation: "create", name: `Produto ${run.carimbo}`, finishedUnitCode: "un" });
  });

  it("recusa projeto sem cliente, nome sem carimbo e versão sem projeto — antes de chamar a API", async () => {
    const run = criarRun();
    const { api, chamadas } = apiFalsa({});
    await expect(criarProjeto(api, run, {})).rejects.toThrow(/exige o cliente/);
    await expect(criarProjeto(api, run, { cliente: { id: "c" }, nome: "Projeto fixo" })).rejects.toThrow(/carimbo/);
    await expect(criarProdutoDoProjeto(api, run, {})).rejects.toThrow(/exige o projeto/);
    await expect(criarVersao(api, {})).rejects.toThrow(/exige o projeto/);
    expect(chamadas).toEqual([]);
  });

  it("a linha é achada pelo PRODUTO, não pela posição, e precificada pelo id dela", async () => {
    const outra = linhaDto("uuid-l0", "uuid-outro");
    const nossa = linhaDto("uuid-l1", "uuid-p");
    const { api, chamadas, rotasChamadas } = apiFalsa({
      "POST /projects/uuid-pj/quote-versions": () => ({ status: 201, corpo: versaoDto() }),
      "POST /quote-versions/uuid-v/lines": () => ({ status: 201, corpo: versaoDto([outra, nossa]) }),
      "PATCH /quote-lines/uuid-l1": (corpo) => ({
        status: 200,
        corpo: versaoDto([outra, { ...nossa, quotedQuantity: corpo.quotedQuantity, unitPrice: corpo.unitPrice }]),
      }),
      "PATCH /quote-versions/uuid-v": () => ({ status: 200, corpo: versaoDto([outra, nossa]) }),
    });
    const versao = await criarVersao(api, { projeto: { id: "uuid-pj" } });
    expect(versao).toMatchObject({ id: "uuid-v", codigo: "ORC-000321", numero: 2, rotulo: "ORC-000321 · V2", linhas: [] });

    const produto = { id: "uuid-p", vinculoId: "uuid-pp", codigo: "PROD-000174" };
    const comLinha = await adicionarLinha(api, { versao, produto, quantidade: 1000, preco: "12.5" });
    expect(chamadas[1]!.corpo).toEqual({ projectProductId: "uuid-pp" });
    expect(rotasChamadas().at(-1)).toBe("PATCH /quote-lines/uuid-l1");
    expect(chamadas.at(-1)!.corpo).toEqual({ quotedQuantity: "1000", unitPrice: "12.5" });
    expect(linhaDoProduto(comLinha, produto)).toMatchObject({ id: "uuid-l1", quantidade: "1000", preco: "12.5" });
    expect(() => linhaDoProduto(comLinha, { id: "uuid-x", codigo: "PROD-000999" })).toThrow(
      /PROD-000999 não está na ORC-000321 · V2/,
    );

    await gravarCondicoes(api, { versao, condicoes: { validUntil: "2099-12-31", quoteDate: "2026-08-06" } });
    expect(chamadas.at(-1)!.corpo).toEqual({ validUntil: "2099-12-31", quoteDate: "2026-08-06" });
    await expect(precificarLinha(api, { linha: { id: "uuid-l1" } })).rejects.toThrow(/sem quantidade nem preço/);
  });

  it("rota da versão e do projeto como a tela monta, e o id lido de volta da URL", () => {
    const id = "0c1d2e3f-4a5b-4c6d-8e7f-001122334455";
    expect(rotaDaVersao(id)).toBe(`/comercial/orcamentos/${id}`);
    expect(rotaDaVersao(id, { voltar: "/comercial/orcamentos?search=E2E&page=2" })).toBe(
      `/comercial/orcamentos/${id}?voltar=%2Fcomercial%2Forcamentos%3Fsearch%3DE2E%26page%3D2`,
    );
    const web = "http://127.0.0.1:5174";
    expect(idDaRota(`${web}${rotaDaVersao(id, { voltar: rotaDoProjeto("uuid-pj") })}`, ROTA_DA_VERSAO)).toBe(id);
    expect(idDaRota(`${web}/comercial/orcamentos/${id}/imprimir`, ROTA_DA_VERSAO)).toBeNull();
    expect(idDaRota(new URL(`${web}${rotaDoProjeto(id)}`), ROTA_DO_PROJETO)).toBe(id);
    expect(idDaRota(`${web}/comercial/orcamentos`, ROTA_DA_VERSAO)).toBeNull();
  });
});

describe("fixtures de produção", () => {
  const rotasDaProducao = () =>
    apiFalsa({
      "POST /production-orders": () => ({ status: 201, corpo: { id: "uuid-op", code: "OP-000001", status: "DRAFT", formulationVersionId: "uuid-v" } }),
      "POST /production-profiles": () => ({ status: 201, corpo: { id: "uuid-r", code: "ROT-000001", draftVersion: { id: "uuid-rv" } } }),
      "PATCH /production-profile-versions/uuid-rv": () => ({ status: 200, corpo: {} }),
      "POST /production-profile-versions/uuid-rv/activate": () => ({ status: 200, corpo: {} }),
      "GET /production-profiles/uuid-r": () => ({ status: 200, corpo: { id: "uuid-r", activeVersion: { id: "uuid-rv" } } }),
      "POST /production-orders/uuid-op/production-profile": () => ({ status: 200, corpo: { id: "uuid-op", status: "DRAFT" } }),
      "POST /production-orders/uuid-op/plan": () => ({ status: 200, corpo: { id: "uuid-op", status: "PLANNED" } }),
    });

  it("OP em rascunho, roteiro com a V1 conferida por GET, aplicação e planejamento", async () => {
    const run = criarRun();
    const { api, chamadas, rotasChamadas } = rotasDaProducao();
    const ordem = await criarOrdemDeProducao(api, run, { produto: { id: "uuid-p" }, quantidade: 100 });
    expect(ordem).toEqual({ id: "uuid-op", codigo: "OP-000001", status: "DRAFT", formulacaoId: "uuid-v" });
    expect(chamadas[0]!.corpo).toEqual({ productId: "uuid-p", plannedQuantity: "100", notes: `Massa E2E ${run.carimbo}` });

    const roteiro = await criarRoteiroAtivo(api, run, { unidade: "un" });
    expect(roteiro).toEqual({ id: "uuid-r", codigo: "ROT-000001", versaoId: "uuid-rv" });
    expect(chamadas[1]!.corpo).toEqual({ name: `Roteiro ${run.carimbo}`, referenceQuantity: "1", referenceUomCode: "un" });

    await aplicarRoteiro(api, ordem.id, roteiro.versaoId);
    expect((await planejarOrdem(api, ordem.id)).status).toBe("PLANNED");
    expect(rotasChamadas().slice(-2)).toEqual([
      "POST /production-orders/uuid-op/production-profile",
      "POST /production-orders/uuid-op/plan",
    ]);
    expect(chamadas.at(-2)!.corpo).toEqual({ productionProfileVersionId: "uuid-rv" });
  });

  it("roteiro que não fica ativo lança, e nome sem carimbo é recusado", async () => {
    const run = criarRun();
    const { api } = apiFalsa({
      "POST /production-profiles": () => ({ status: 201, corpo: { id: "uuid-r", code: "ROT-2", draftVersion: { id: "uuid-rv" } } }),
      "PATCH /production-profile-versions/uuid-rv": () => ({ status: 200, corpo: {} }),
      "POST /production-profile-versions/uuid-rv/activate": () => ({ status: 200, corpo: {} }),
      "GET /production-profiles/uuid-r": () => ({ status: 200, corpo: { id: "uuid-r", activeVersion: null } }),
    });
    await expect(criarRoteiroAtivo(api, run, { unidade: "un" })).rejects.toThrow(/não ficou ativa/);
    await expect(criarRoteiroAtivo(api, run, { unidade: "un", nome: "Roteiro fixo" })).rejects.toThrow(/carimbo/);
  });

  it("aplicarRoteiroNaOrdem mantém a assinatura antiga do golden path", async () => {
    const { api, rotasChamadas } = rotasDaProducao();
    const ordem = await aplicarRoteiroNaOrdem(api, "uuid-op", { unidade: "un", nome: "Roteiro GP123456" });
    expect(ordem).toEqual({ id: "uuid-op", status: "DRAFT" });
    expect(rotasChamadas()).toContain("POST /production-orders/uuid-op/production-profile");
  });
});

describe("datas e rota", () => {
  it("o dia comercial é o de São Paulo, não o da máquina", () => {
    expect(diaComercial(0, new Date("2026-09-15T02:30:00Z"))).toBe("2026-09-14");
    expect(diaComercial(0, new Date("2026-09-15T03:30:00Z"))).toBe("2026-09-15");
    expect(diaComercial(1, new Date("2026-12-31T12:00:00Z"))).toBe("2027-01-01");
    expect(diaComercial(-1, new Date("2026-03-01T12:00:00Z"))).toBe("2026-02-28");
    expect(porExtenso("2026-09-09")).toBe("09/09/2026");
  });

  it("esperarRota casa pelo pathname: a lista com ?ids= serve, o cadastro novo não", () => {
    const lista = "http://127.0.0.1:5174/cadastros/clientes";
    expect(rotaCasa(new URL(`${lista}?ids=uuid-c`), "/cadastros/clientes")).toBe(true);
    expect(rotaCasa(`${lista}/`, "/cadastros/clientes")).toBe(true);
    expect(rotaCasa(`${lista}/novo`, "/cadastros/clientes")).toBe(false);
    expect(rotaCasa("http://127.0.0.1:5174/produtos/uuid-p/custos?x=1", /^\/produtos\/[^/]+\/custos$/)).toBe(true);
    expect(rotaCasa(`${lista}?ids=uuid-c`, "/cadastros/clientes", (consulta) => consulta.has("ids"))).toBe(true);
    expect(rotaCasa(lista, "/cadastros/clientes", (consulta) => consulta.has("ids"))).toBe(false);
  });

  it("carimbar exige a execução", () => {
    expect(() => carimbar(undefined, "Cliente")).toThrow(/criarRun/);
  });
});
