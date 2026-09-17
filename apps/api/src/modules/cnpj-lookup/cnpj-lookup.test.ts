import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import type { CnpjLookupResult } from "@veridi/shared";
import {
  CNPJ_LOOKUP_UNAVAILABLE_MESSAGE,
  CNPJ_NOT_FOUND_MESSAGE,
  CUSTOMER_EDIT_ROLES,
} from "@veridi/shared";
import { buildApp } from "../../app.js";
import { buildTestApp } from "../../test-support/authenticated-app.js";
import { uniqueCnpj } from "../../test-support/br-documents.js";

/**
 * Consulta assistida de CNPJ — CUSTOMER-CNPJ-LOOKUP-01.
 *
 * NENHUM caso aqui toca a internet: o `fetch` global é substituído em cada
 * teste. Suíte que depende de serviço público de terceiro não mede o código —
 * mede a rede do dia, e falha vermelha sem defeito nenhum ensina a equipe a
 * ignorar a suíte.
 *
 * O que estes casos protegem é a fronteira: o que sai da máquina, o que a
 * tela recebe e o que ela NUNCA recebe (payload cru, stack, detalhe do
 * provedor).
 */

const CNPJ_VALIDO = "11444777000161";
const CNPJ_COM_MASCARA = "11.444.777/0001-61";
/** Dígitos verificadores errados de propósito. */
const CNPJ_INVALIDO = "11444777000100";

/** A resposta da Receita pelo OpenCNPJ, no formato real conferido na fonte. */
function respostaDoOpenCnpj(extra: Record<string, unknown> = {}) {
  return {
    cnpj: CNPJ_VALIDO,
    razao_social: "VERIDI NUTRITION LTDA",
    nome_fantasia: "VERIDI NUTRITION",
    situacao_cadastral: "Ativa",
    data_situacao_cadastral: "2020-01-15",
    matriz_filial: "Matriz",
    data_inicio_atividade: "2019-03-08",
    cnae_principal: "1099699",
    cnaes_secundarios: ["4632001"],
    cnaes: [
      { codigo: "1099699", descricao: "Fabricação de outros produtos alimentícios", is_principal: true },
      { codigo: "4632001", descricao: "Comércio atacadista de cereais", is_principal: false },
    ],
    natureza_juridica: "Sociedade Empresária Limitada",
    tipo_logradouro: "AVENIDA",
    logradouro: "PAULISTA",
    numero: "1000",
    complemento: "CONJUNTO 12",
    bairro: "BELA VISTA",
    cep: "01310100",
    uf: "sp",
    municipio: "SAO PAULO",
    email: "CONTATO@VERIDI.COM.BR",
    telefones: [
      { ddd: "11", numero: "40028922", is_fax: true },
      { ddd: "11", numero: "987654321", is_fax: false },
    ],
    capital_social: "100000,00",
    porte_empresa: "Empresa de Pequeno Porte (EPP)",
    opcao_simples: "S",
    opcao_mei: "N",
    QSA: [],
    ...extra,
  };
}

/** Substitui o `fetch` global e devolve o espião, para conferir se saiu chamada. */
function fingirFetch(responder: (url: string) => Promise<Response>) {
  // O tipo do primeiro parâmetro vem do próprio `fetch`: `RequestInfo` é do
  // `lib.dom`, que a API não carrega.
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: Parameters<typeof fetch>[0]) => responder(String(input)));
}

let fetchEspiao: ReturnType<typeof fingirFetch> | null = null;

beforeEach(() => {
  fetchEspiao = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /cnpj-lookup/:cnpj", () => {
  it("A — CNPJ inválido é recusado aqui: o provedor externo não chega a ser chamado", async () => {
    fetchEspiao = fingirFetch(async () => new Response("{}", { status: 200 }));
    const app = buildTestApp("COMMERCIAL");

    const response = await app.inject({ url: `/cnpj-lookup/${CNPJ_INVALIDO}` });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "validation_error",
      issues: [{ path: "cnpj", message: "CNPJ inválido" }],
    });
    // A prova da regra: nada saiu da máquina.
    expect(fetchEspiao).not.toHaveBeenCalled();
    await app.close();
  });

  it("A — CNPJ com tamanho errado também morre antes de sair da máquina", async () => {
    fetchEspiao = fingirFetch(async () => new Response("{}", { status: 200 }));
    const app = buildTestApp("COMMERCIAL");

    const response = await app.inject({ url: "/cnpj-lookup/1144477" });

    expect(response.statusCode).toBe(400);
    expect(response.json().issues[0].message).toBe("CNPJ deve conter 14 caracteres");
    expect(fetchEspiao).not.toHaveBeenCalled();
    await app.close();
  });

  it("B — sucesso: devolve o contrato normalizado, com a proveniência junto", async () => {
    fetchEspiao = fingirFetch(
      async () => new Response(JSON.stringify(respostaDoOpenCnpj()), { status: 200 }),
    );
    const app = buildTestApp("COMMERCIAL");

    const response = await app.inject({ url: `/cnpj-lookup/${CNPJ_VALIDO}` });

    expect(response.statusCode).toBe(200);
    const corpo = response.json() as CnpjLookupResult;

    expect(corpo.provider).toBe("OPEN_CNPJ");
    expect(corpo.cnpj).toBe(CNPJ_VALIDO);
    expect(Number.isNaN(Date.parse(corpo.consultedAt))).toBe(false);
    expect(corpo.company).toEqual({
      legalName: "VERIDI NUTRITION LTDA",
      tradeName: "VERIDI NUTRITION",
      registrationStatus: "Ativa",
      openedAt: "2019-03-08",
      postalCode: "01310100",
      // Tipo e nome do logradouro chegam separados e formam um campo só.
      street: "AVENIDA PAULISTA",
      number: "1000",
      complement: "CONJUNTO 12",
      neighborhood: "BELA VISTA",
      city: "SAO PAULO",
      state: "SP",
      // O fax é pulado: o cadastro guarda telefone de contato.
      phone: "11987654321",
      email: "CONTATO@VERIDI.COM.BR",
      mainCnaeCode: "1099699",
      mainCnaeDescription: "Fabricação de outros produtos alimentícios",
      legalNature: "Sociedade Empresária Limitada",
      companySize: "Empresa de Pequeno Porte (EPP)",
    });

    // O endpoint oficial, com o dataset declarado — e nada mais no caminho.
    expect(fetchEspiao).toHaveBeenCalledTimes(1);
    expect(fetchEspiao!.mock.calls[0]![0]).toBe(
      `https://api.opencnpj.org/${CNPJ_VALIDO}?datasets=receita`,
    );
    await app.close();
  });

  it("B — o CNPJ mascarado consulta o mesmo número, normalizado", async () => {
    fetchEspiao = fingirFetch(
      async () => new Response(JSON.stringify(respostaDoOpenCnpj()), { status: 200 }),
    );
    const app = buildTestApp("COMMERCIAL");

    const response = await app.inject({
      url: `/cnpj-lookup/${encodeURIComponent(CNPJ_COM_MASCARA)}`,
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as CnpjLookupResult).cnpj).toBe(CNPJ_VALIDO);
    expect(fetchEspiao!.mock.calls[0]![0]).toBe(
      `https://api.opencnpj.org/${CNPJ_VALIDO}?datasets=receita`,
    );
    await app.close();
  });

  it("C — CNPJ não encontrado: 404 tipado, com a frase que não interrompe o cadastro", async () => {
    fingirFetch(async () => new Response('{"error":"not found"}', { status: 404 }));
    const app = buildTestApp("COMMERCIAL");

    const response = await app.inject({ url: `/cnpj-lookup/${uniqueCnpj()}` });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "cnpj_not_found",
      message: CNPJ_NOT_FOUND_MESSAGE,
    });
    await app.close();
  });

  it("D — provedor fora do ar: 503 com a frase amigável, sem detalhe técnico", async () => {
    fingirFetch(async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    const app = buildTestApp("COMMERCIAL");

    const response = await app.inject({ url: `/cnpj-lookup/${CNPJ_VALIDO}` });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "cnpj_lookup_unavailable",
      message: CNPJ_LOOKUP_UNAVAILABLE_MESSAGE,
    });
    expect(response.body).not.toContain("502 Bad Gateway");
    await app.close();
  });

  it("D — limite de uso do provedor (429) é indisponibilidade, não erro do usuário", async () => {
    fingirFetch(async () => new Response('{"error":"rate limited"}', { status: 429 }));
    const app = buildTestApp("COMMERCIAL");

    const response = await app.inject({ url: `/cnpj-lookup/${CNPJ_VALIDO}` });

    expect(response.statusCode).toBe(503);
    expect(response.json().message).toBe(CNPJ_LOOKUP_UNAVAILABLE_MESSAGE);
    await app.close();
  });

  it("D — timeout: o `AbortError` do relógio próprio vira a mesma resposta amigável", async () => {
    fingirFetch(async () => {
      const abortado = new Error("The operation was aborted");
      abortado.name = "AbortError";
      throw abortado;
    });
    const app = buildTestApp("COMMERCIAL");

    const response = await app.inject({ url: `/cnpj-lookup/${CNPJ_VALIDO}` });

    expect(response.statusCode).toBe(503);
    expect(response.json().message).toBe(CNPJ_LOOKUP_UNAVAILABLE_MESSAGE);
    await app.close();
  });

  it("D — rede caída (o `fetch` rejeita) não vira 500", async () => {
    fingirFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const app = buildTestApp("COMMERCIAL");

    const response = await app.inject({ url: `/cnpj-lookup/${CNPJ_VALIDO}` });

    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it("E — payload parcial: o que a fonte não informou fica `null`, e nada é inventado", async () => {
    fingirFetch(
      async () =>
        new Response(
          JSON.stringify({
            cnpj: CNPJ_VALIDO,
            razao_social: "EMPRESA SEM ENDERECO LTDA",
            // Tudo o mais ausente ou vazio, como a base pública costuma vir.
            nome_fantasia: "",
            complemento: "   ",
            telefones: [],
          }),
          { status: 200 },
        ),
    );
    const app = buildTestApp("COMMERCIAL");

    const response = await app.inject({ url: `/cnpj-lookup/${CNPJ_VALIDO}` });

    expect(response.statusCode).toBe(200);
    const { company } = response.json() as CnpjLookupResult;
    expect(company.legalName).toBe("EMPRESA SEM ENDERECO LTDA");
    // Vazio e só-espaços são a mesma coisa que ausente: a fonte não informou.
    expect(company.tradeName).toBeNull();
    expect(company.complement).toBeNull();
    expect(company.phone).toBeNull();
    expect(company.postalCode).toBeNull();
    expect(company.street).toBeNull();
    expect(company.city).toBeNull();
    expect(company.state).toBeNull();
    expect(company.email).toBeNull();
    expect(company.mainCnaeDescription).toBeNull();
    await app.close();
  });

  it("E — só um fax na lista não vira telefone do cadastro", async () => {
    fingirFetch(
      async () =>
        new Response(
          JSON.stringify(
            respostaDoOpenCnpj({ telefones: [{ ddd: "11", numero: "40028922", is_fax: true }] }),
          ),
          { status: 200 },
        ),
    );
    const app = buildTestApp("COMMERCIAL");

    const response = await app.inject({ url: `/cnpj-lookup/${CNPJ_VALIDO}` });

    expect((response.json() as CnpjLookupResult).company.phone).toBeNull();
    await app.close();
  });

  it("E — telefone que o cadastro recusaria não é oferecido", async () => {
    fingirFetch(
      async () =>
        new Response(
          // DDD "10" não existe no Brasil: o `PATCH` do Cliente recusaria.
          JSON.stringify(respostaDoOpenCnpj({ telefones: [{ ddd: "10", numero: "12345678", is_fax: false }] })),
          { status: 200 },
        ),
    );
    const app = buildTestApp("COMMERCIAL");

    const response = await app.inject({ url: `/cnpj-lookup/${CNPJ_VALIDO}` });

    expect((response.json() as CnpjLookupResult).company.phone).toBeNull();
    await app.close();
  });

  it("F — payload malformado não chega cru à Web: tipos errados viram `null`", async () => {
    fingirFetch(
      async () =>
        new Response(
          JSON.stringify({
            razao_social: { nome: "objeto onde deveria haver texto" },
            nome_fantasia: 12345,
            cep: null,
            uf: ["SP"],
            telefones: "(11) 99999-8888",
            cnaes: { codigo: "1099699" },
            campo_que_nao_existe_no_contrato: "valor que não pode vazar",
          }),
          { status: 200 },
        ),
    );
    const app = buildTestApp("COMMERCIAL");

    const response = await app.inject({ url: `/cnpj-lookup/${CNPJ_VALIDO}` });

    expect(response.statusCode).toBe(200);
    const corpo = response.json() as CnpjLookupResult;
    expect(corpo.company.legalName).toBeNull();
    expect(corpo.company.tradeName).toBeNull();
    expect(corpo.company.state).toBeNull();
    expect(corpo.company.phone).toBeNull();
    expect(corpo.company.mainCnaeDescription).toBeNull();
    // Chave do provedor que o contrato não declara não atravessa.
    expect(response.body).not.toContain("campo_que_nao_existe_no_contrato");
    expect(response.body).not.toContain("razao_social");
    await app.close();
  });

  it("F — resposta que não é JSON vira indisponibilidade, não 500", async () => {
    fingirFetch(async () => new Response("<html>manutenção</html>", { status: 200 }));
    const app = buildTestApp("COMMERCIAL");

    const response = await app.inject({ url: `/cnpj-lookup/${CNPJ_VALIDO}` });

    expect(response.statusCode).toBe(503);
    expect(response.json().message).toBe(CNPJ_LOOKUP_UNAVAILABLE_MESSAGE);
    await app.close();
  });

  it("F — JSON que não é objeto vira indisponibilidade", async () => {
    fingirFetch(async () => new Response('["lista","onde","deveria","haver","objeto"]', { status: 200 }));
    const app = buildTestApp("COMMERCIAL");

    const response = await app.inject({ url: `/cnpj-lookup/${CNPJ_VALIDO}` });

    expect(response.statusCode).toBe(503);
    await app.close();
  });

  it("F — resposta acima do teto de tamanho é abortada, não virada memória da API", async () => {
    const gigante = JSON.stringify({
      cnpj: CNPJ_VALIDO,
      razao_social: "X".repeat(1024 * 1024),
    });
    fingirFetch(async () => new Response(gigante, { status: 200 }));
    const app = buildTestApp("COMMERCIAL");

    const response = await app.inject({ url: `/cnpj-lookup/${CNPJ_VALIDO}` });

    expect(response.statusCode).toBe(503);
    expect(response.json().message).toBe(CNPJ_LOOKUP_UNAVAILABLE_MESSAGE);
    await app.close();
  });

  it("não aceita fonte fora do registro conhecido — não existe proxy genérico", async () => {
    fetchEspiao = fingirFetch(
      async () => new Response(JSON.stringify(respostaDoOpenCnpj()), { status: 200 }),
    );
    const app = buildTestApp("COMMERCIAL");

    const response = await app.inject({
      url: `/cnpj-lookup/${CNPJ_VALIDO}?provider=https://evil.example.com`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().issues[0].message).toBe("Fonte de consulta inválida");
    expect(fetchEspiao).not.toHaveBeenCalled();
    await app.close();
  });

  it("a fonte pedida explicitamente é respeitada", async () => {
    fingirFetch(async () => new Response(JSON.stringify(respostaDoOpenCnpj()), { status: 200 }));
    const app = buildTestApp("COMMERCIAL");

    const response = await app.inject({ url: `/cnpj-lookup/${CNPJ_VALIDO}?provider=OPEN_CNPJ` });

    expect(response.statusCode).toBe(200);
    expect((response.json() as CnpjLookupResult).provider).toBe("OPEN_CNPJ");
    await app.close();
  });
});

describe("G — quem pode consultar", () => {
  it("sem sessão não consulta, e nada sai da máquina", async () => {
    fetchEspiao = fingirFetch(
      async () => new Response(JSON.stringify(respostaDoOpenCnpj()), { status: 200 }),
    );
    const app = buildApp();

    const response = await app.inject({ url: `/cnpj-lookup/${CNPJ_VALIDO}` });

    expect(response.statusCode).toBe(401);
    expect(fetchEspiao).not.toHaveBeenCalled();
    await app.close();
  });

  const PODEM = ["ADMIN", "COMMERCIAL"] as const satisfies readonly UserRole[];
  const NAO_PODEM = [
    "PRODUCTION",
    "QUALITY",
    "PURCHASING",
    "VIEWER",
  ] as const satisfies readonly UserRole[];

  /* A lista da rota é a MESMA do cadastro: se o PO mudar quem edita o Cliente,
     quem consulta muda junto, sem uma segunda decisão escondida aqui. */
  it("a rota usa a lista do cadastro do Cliente, não uma lista própria", () => {
    expect([...CUSTOMER_EDIT_ROLES].sort()).toEqual([...PODEM].sort());
  });

  it.each(PODEM)("%s consulta", async (role) => {
    fingirFetch(async () => new Response(JSON.stringify(respostaDoOpenCnpj()), { status: 200 }));
    const app = buildTestApp(role);

    const response = await app.inject({ url: `/cnpj-lookup/${CNPJ_VALIDO}` });

    expect(response.statusCode, `${role} deveria consultar`).toBe(200);
    await app.close();
  });

  it.each(NAO_PODEM)("%s recebe 403 e nada sai da máquina", async (role) => {
    fetchEspiao = fingirFetch(
      async () => new Response(JSON.stringify(respostaDoOpenCnpj()), { status: 200 }),
    );
    const app = buildTestApp(role);

    const response = await app.inject({ url: `/cnpj-lookup/${CNPJ_VALIDO}` });

    expect(response.statusCode, `${role} não deveria consultar`).toBe(403);
    expect(response.json()).toEqual({
      error: "forbidden",
      message: "Seu perfil não permite esta ação.",
    });
    expect(fetchEspiao, `${role} não deveria alcançar o provedor`).not.toHaveBeenCalled();
    await app.close();
  });
});
