import { describe, expect, it } from "vitest";
import type { CnpjLookupCompany, CnpjLookupResult, CustomerCnpjRegistration } from "@veridi/shared";
import { CNPJ_REGISTRATION_FIELDS } from "@veridi/shared";
import {
  CAMPOS_DA_CONSULTA_DE_CNPJ,
  assinaturaDosDadosDoCnpj,
  compararComOCadastro,
  compararDadosDoCnpj,
  dadosDoCnpjParaAplicar,
  selecaoInicial,
  selecaoInicialDosDadosDoCnpj,
  simNaoOuNaoInformado,
  valoresParaAplicar,
} from "./cnpj-lookup-fields";
import type {
  LinhaDaComparacao,
  LinhaDosDadosDoCnpj,
  ValoresDoFormulario,
} from "./cnpj-lookup-fields";

/**
 * As regras de comparação da consulta de CNPJ — CUSTOMER-CNPJ-LOOKUP-01.
 *
 * Sem tela e sem rede: é aqui que se prova "este valor pode substituir
 * aquele?", que é a decisão de negócio da capacidade. A tela só desenha o
 * resultado.
 */

const VAZIO: ValoresDoFormulario = {
  legalName: "",
  tradeName: "",
  zipCode: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "",
  phone: "",
  email: "",
};

function fonte(overrides: Partial<CnpjLookupCompany> = {}): CnpjLookupCompany {
  return {
    legalName: "VERIDI NUTRITION LTDA",
    tradeName: "VERIDI NUTRITION",
    registrationStatus: "Ativa",
    registrationStatusDate: "2020-01-15",
    openedAt: "2019-03-08",
    establishmentType: "HEADQUARTERS",
    simplesOptIn: true,
    meiOptIn: false,
    postalCode: "01310100",
    street: "AVENIDA PAULISTA",
    number: "1000",
    complement: "CONJUNTO 12",
    neighborhood: "BELA VISTA",
    city: "SAO PAULO",
    state: "SP",
    phone: "11987654321",
    email: "CONTATO@VERIDI.COM.BR",
    mainCnaeCode: "1099699",
    mainCnaeDescription: "Fabricação de outros produtos alimentícios",
    legalNature: "Sociedade Empresária Limitada",
    companySize: "Empresa de Pequeno Porte (EPP)",
    ...overrides,
  };
}

function linha(linhas: LinhaDaComparacao[], campo: string): LinhaDaComparacao {
  const achada = linhas.find((item) => item.campo === campo);
  if (!achada) throw new Error(`linha ausente: ${campo}`);
  return achada;
}

describe("comparação Atual × Retornado", () => {
  it("compara todos os campos mapeados, na ordem da tela", () => {
    const linhas = compararComOCadastro(VAZIO, fonte());
    expect(linhas.map((item) => item.campo)).toEqual([...CAMPOS_DA_CONSULTA_DE_CNPJ]);
  });

  it("cadastro em branco: tudo que a fonte trouxe é aplicável", () => {
    const linhas = compararComOCadastro(VAZIO, fonte());

    expect(linhas.every((item) => item.situacao === "aplicavel")).toBe(true);
    expect(linha(linhas, "legalName").atual).toBe("");
    expect(linha(linhas, "legalName").retornado).toBe("VERIDI NUTRITION LTDA");
  });

  it("valor diferente vira diferença aplicável, com os dois lados à vista", () => {
    const linhas = compararComOCadastro(
      { ...VAZIO, legalName: "VERIDI TESTE LTDA" },
      fonte(),
    );

    expect(linha(linhas, "legalName")).toMatchObject({
      rotulo: "Razão Social / Nome",
      atual: "VERIDI TESTE LTDA",
      retornado: "VERIDI NUTRITION LTDA",
      situacao: "aplicavel",
    });
  });
});

describe("o que conta como 'Sem alteração'", () => {
  it("mesma cidade em caixa e acentuação diferentes não é alteração", () => {
    // O caso do handoff: "Tatuí" no cadastro, "TATUÍ" na fonte.
    const linhas = compararComOCadastro({ ...VAZIO, city: "Tatuí" }, fonte({ city: "TATUÍ" }));
    expect(linha(linhas, "city").situacao).toBe("igual");
  });

  it("a base pública escreve sem acento, e isso também não é alteração", () => {
    const linhas = compararComOCadastro(
      { ...VAZIO, city: "São Paulo" },
      fonte({ city: "SAO PAULO" }),
    );
    expect(linha(linhas, "city").situacao).toBe("igual");
  });

  it("espaço sobrando e espaço repetido não são alteração", () => {
    const linhas = compararComOCadastro(
      { ...VAZIO, street: "  Avenida   Paulista " },
      fonte({ street: "AVENIDA PAULISTA" }),
    );
    expect(linha(linhas, "street").situacao).toBe("igual");
  });

  it("CEP com e sem máscara é o mesmo CEP", () => {
    const linhas = compararComOCadastro(
      { ...VAZIO, zipCode: "01310-100" },
      fonte({ postalCode: "01310100" }),
    );
    expect(linha(linhas, "zipCode").situacao).toBe("igual");
  });

  it("telefone com e sem máscara é o mesmo telefone", () => {
    const linhas = compararComOCadastro(
      { ...VAZIO, phone: "(11) 98765-4321" },
      fonte({ phone: "11987654321" }),
    );
    expect(linha(linhas, "phone").situacao).toBe("igual");
  });

  it("e-mail só muda de caixa: mesmo endereço", () => {
    const linhas = compararComOCadastro(
      { ...VAZIO, email: "contato@veridi.com.br" },
      fonte({ email: "CONTATO@VERIDI.COM.BR" }),
    );
    expect(linha(linhas, "email").situacao).toBe("igual");
  });

  it("uma diferença de verdade continua sendo diferença", () => {
    const linhas = compararComOCadastro(
      { ...VAZIO, city: "Sorocaba" },
      fonte({ city: "SAO PAULO" }),
    );
    expect(linha(linhas, "city").situacao).toBe("aplicavel");
  });
});

describe("valor vazio da fonte nunca apaga valor existente", () => {
  it("campo nulo na fonte não oferece substituição", () => {
    const preenchido: ValoresDoFormulario = {
      ...VAZIO,
      tradeName: "Nome que a operação escreveu",
      phone: "(11) 98765-4321",
      complement: "Sala 2",
    };
    const linhas = compararComOCadastro(
      preenchido,
      fonte({ tradeName: null, phone: null, complement: null }),
    );

    for (const campo of ["tradeName", "phone", "complement"]) {
      expect(linha(linhas, campo).situacao, campo).toBe("sem_valor");
      expect(linha(linhas, campo).retornado, campo).toBe("");
    }

    // A prova final: nem marcada por padrão, nem aplicável em hipótese nenhuma.
    const marcados = selecaoInicial(linhas);
    expect(marcados.has("tradeName")).toBe(false);
    const aplicar = valoresParaAplicar(linhas, new Set(["tradeName", "phone", "complement"]));
    expect(aplicar).toEqual({});
  });

  it("string vazia e só espaços valem o mesmo que ausente", () => {
    const linhas = compararComOCadastro(
      { ...VAZIO, tradeName: "Fantasia atual" },
      fonte({ tradeName: "   " }),
    );
    expect(linha(linhas, "tradeName").situacao).toBe("sem_valor");
  });
});

describe("o que o cadastro não guardaria não é oferecido", () => {
  it("CEP incompleto aparece com o motivo, e não se aplica", () => {
    const linhas = compararComOCadastro(VAZIO, fonte({ postalCode: "0131010" }));
    const item = linha(linhas, "zipCode");

    expect(item.situacao).toBe("nao_aplicavel");
    // O valor continua à vista: quem consultou vê o que está deixando de usar.
    expect(item.retornado).toBe("0131010");
    expect(item.motivo).toBe("A fonte devolveu um CEP incompleto.");
    expect(selecaoInicial(linhas).has("zipCode")).toBe(false);
  });

  it("UF que o cadastro não reconhece não se aplica", () => {
    const linhas = compararComOCadastro(VAZIO, fonte({ state: "XX" }));
    expect(linha(linhas, "state").situacao).toBe("nao_aplicavel");
  });

  it("telefone que a validação do Cliente recusaria não se aplica", () => {
    // DDD 10 não existe: o "Salvar" devolveria "Informe um telefone com DDD".
    const linhas = compararComOCadastro(VAZIO, fonte({ phone: "1012345678" }));
    expect(linha(linhas, "phone").situacao).toBe("nao_aplicavel");
  });

  it("e-mail em formato inválido não se aplica", () => {
    const linhas = compararComOCadastro(VAZIO, fonte({ email: "SEM EMAIL" }));
    expect(linha(linhas, "email").situacao).toBe("nao_aplicavel");
  });

  it("texto mais longo do que o campo aceita não se aplica, e o motivo diz o limite", () => {
    // O complemento do Cliente aceita 100; a fonte pode devolver até 200.
    const linhas = compararComOCadastro(VAZIO, fonte({ complement: "A".repeat(150) }));
    const item = linha(linhas, "complement");

    expect(item.situacao).toBe("nao_aplicavel");
    expect(item.motivo).toContain("150");
    expect(item.motivo).toContain("100");
  });

  it("no limite exato ainda cabe", () => {
    const linhas = compararComOCadastro(VAZIO, fonte({ complement: "A".repeat(100) }));
    expect(linha(linhas, "complement").situacao).toBe("aplicavel");
  });
});

describe("seleção e aplicação", () => {
  it("toda diferença aplicável começa marcada; o resto, não", () => {
    const linhas = compararComOCadastro(
      { ...VAZIO, city: "SAO PAULO" },
      fonte({ tradeName: null, state: "XX" }),
    );
    const marcados = selecaoInicial(linhas);

    expect(marcados.has("legalName")).toBe(true);
    // Igual, sem valor e não aplicável ficam de fora.
    expect(marcados.has("city")).toBe(false);
    expect(marcados.has("tradeName")).toBe(false);
    expect(marcados.has("state")).toBe(false);
  });

  it("aplicar devolve só o que foi marcado", () => {
    const linhas = compararComOCadastro(VAZIO, fonte());
    const aplicar = valoresParaAplicar(linhas, new Set(["legalName", "city"]));

    expect(aplicar).toEqual({ legalName: "VERIDI NUTRITION LTDA", city: "SAO PAULO" });
  });

  it("o valor aplicado é o do campo — CEP e telefone com a máscara da tela", () => {
    const linhas = compararComOCadastro(VAZIO, fonte());
    const aplicar = valoresParaAplicar(linhas, selecaoInicial(linhas));

    expect(aplicar.zipCode).toBe("01310-100");
    expect(aplicar.phone).toBe("(11) 98765-4321");
    // O texto NÃO é reescrito: vai como a fonte publicou.
    expect(aplicar.legalName).toBe("VERIDI NUTRITION LTDA");
    expect(aplicar.state).toBe("SP");
  });

  it("nada marcado, nada aplicado", () => {
    const linhas = compararComOCadastro(VAZIO, fonte());
    expect(valoresParaAplicar(linhas, new Set())).toEqual({});
  });
});

/* ------------------------------------------------------------------------ */
/* Dados cadastrais do CNPJ — CUSTOMER-CNPJ-PERSISTED-DATA-01, §119.         */
/* ------------------------------------------------------------------------ */

const CONSULTADO_EM = "2026-09-17T12:30:00.000Z";

/** O bloco que o formulário já tem para o CNPJ — o da consulta anterior. */
function dadosAtuais(overrides: Partial<CustomerCnpjRegistration> = {}): CustomerCnpjRegistration {
  return {
    mainCnaeCode: "1099699",
    mainCnaeDescription: "Fabricação de outros produtos alimentícios",
    legalNature: "Sociedade Empresária Limitada",
    companySize: "Empresa de Pequeno Porte (EPP)",
    openedAt: "2019-03-08",
    establishmentType: "HEADQUARTERS",
    simplesOptIn: true,
    meiOptIn: false,
    registrationStatus: "Ativa",
    registrationStatusDate: "2020-01-15",
    consultedAt: "2026-01-10T10:00:00.000Z",
    ...overrides,
  };
}

function resultado(overrides: Partial<CnpjLookupCompany> = {}): CnpjLookupResult {
  return { provider: "OPEN_CNPJ", consultedAt: CONSULTADO_EM, cnpj: "11444777000161", company: fonte(overrides) };
}

function dado(linhas: LinhaDosDadosDoCnpj[], campo: string): LinhaDosDadosDoCnpj {
  const achada = linhas.find((item) => item.campo === campo);
  if (!achada) throw new Error(`linha ausente: ${campo}`);
  return achada;
}

describe("Sim / Não / Não informado", () => {
  it("null nunca é Não", () => {
    expect(simNaoOuNaoInformado(true)).toBe("Sim");
    expect(simNaoOuNaoInformado(false)).toBe("Não");
    expect(simNaoOuNaoInformado(null)).toBe("Não informado");
    expect(simNaoOuNaoInformado(undefined)).toBe("Não informado");
  });
});

describe("dados cadastrais: Atual × Retornado", () => {
  it("compara os dez dados cadastrais, na ordem do contrato", () => {
    const linhas = compararDadosDoCnpj(null, fonte());
    expect(linhas.map((item) => item.campo)).toEqual([...CNPJ_REGISTRATION_FIELDS]);
  });

  it("sem consulta anterior: tudo que a fonte trouxe é aplicável, e o atual fica vazio", () => {
    const linhas = compararDadosDoCnpj(null, fonte());
    expect(linhas.every((item) => item.situacao === "aplicavel")).toBe(true);
    expect(linhas.every((item) => item.atual === "")).toBe(true);
  });

  it("datas em pt-BR, CNAE com máscara, Matriz/Filial por extenso", () => {
    const linhas = compararDadosDoCnpj(null, fonte());
    expect(dado(linhas, "openedAt").retornado).toBe("08/03/2019");
    expect(dado(linhas, "registrationStatusDate").retornado).toBe("15/01/2020");
    expect(dado(linhas, "mainCnaeCode").retornado).toBe("1099-6/99");
    expect(dado(linhas, "establishmentType").retornado).toBe("Matriz");
    expect(dado(linhas, "simplesOptIn").retornado).toBe("Sim");
    expect(dado(linhas, "meiOptIn").retornado).toBe("Não");
  });

  it("mesma consulta de novo: tudo 'Sem alteração'", () => {
    const linhas = compararDadosDoCnpj(dadosAtuais(), fonte());
    expect(linhas.map((item) => [item.campo, item.situacao])).toEqual(
      CNPJ_REGISTRATION_FIELDS.map((campo) => [campo, "igual"]),
    );
    expect(selecaoInicialDosDadosDoCnpj(linhas).size).toBe(0);
  });

  it("situação em outra caixa é a mesma situação", () => {
    const linhas = compararDadosDoCnpj(dadosAtuais(), fonte({ registrationStatus: "ATIVA" }));
    expect(dado(linhas, "registrationStatus").situacao).toBe("igual");
  });

  it("Simples: Sim → Não é diferença útil, marcada por padrão", () => {
    const linhas = compararDadosDoCnpj(dadosAtuais({ simplesOptIn: true }), fonte({ simplesOptIn: false }));
    expect(dado(linhas, "simplesOptIn")).toMatchObject({ atual: "Sim", retornado: "Não", situacao: "aplicavel" });
    expect(selecaoInicialDosDadosDoCnpj(linhas).has("simplesOptIn")).toBe(true);
  });

  it("Simples não informado no cadastro e Sim na fonte: aplicável", () => {
    const linhas = compararDadosDoCnpj(dadosAtuais({ simplesOptIn: null }), fonte({ simplesOptIn: true }));
    expect(dado(linhas, "simplesOptIn")).toMatchObject({
      atual: "Não informado",
      retornado: "Sim",
      situacao: "aplicavel",
    });
  });

  it("MEI Sim no cadastro e não informado na fonte: não apaga — 'Não informado pela fonte'", () => {
    const linhas = compararDadosDoCnpj(dadosAtuais({ meiOptIn: true }), fonte({ meiOptIn: null }));
    expect(dado(linhas, "meiOptIn")).toMatchObject({ atual: "Sim", retornado: "", situacao: "sem_valor" });
  });

  it("MEI Não dos dois lados é 'Sem alteração' — false é valor, não ausência", () => {
    const linhas = compararDadosDoCnpj(dadosAtuais({ meiOptIn: false }), fonte({ meiOptIn: false }));
    expect(dado(linhas, "meiOptIn").situacao).toBe("igual");
  });

  it("porte que a fonte não informou fica como 'sem valor'", () => {
    const linhas = compararDadosDoCnpj(dadosAtuais(), fonte({ companySize: null }));
    expect(dado(linhas, "companySize").situacao).toBe("sem_valor");
  });
});

describe("aplicar os dados cadastrais", () => {
  it("sem diferença nenhuma o bloco ainda é aplicado — com a data DESTA consulta", () => {
    const atual = dadosAtuais();
    const linhas = compararDadosDoCnpj(atual, fonte());

    const aplicado = dadosDoCnpjParaAplicar(atual, resultado(), linhas, selecaoInicialDosDadosDoCnpj(linhas));

    expect(aplicado).toEqual({ ...atual, consultedAt: CONSULTADO_EM });
  });

  it("vazio da fonte não apaga: o porte que já estava fica", () => {
    const atual = dadosAtuais();
    const r = resultado({ companySize: null, simplesOptIn: null });
    const linhas = compararDadosDoCnpj(atual, r.company);

    const aplicado = dadosDoCnpjParaAplicar(atual, r, linhas, selecaoInicialDosDadosDoCnpj(linhas));

    expect(aplicado.companySize).toBe("Empresa de Pequeno Porte (EPP)");
    // O Simples que era Sim continua Sim: "não informado" não vira "Não".
    expect(aplicado.simplesOptIn).toBe(true);
  });

  it("marcado vem da fonte; desmarcado fica como estava", () => {
    const atual = dadosAtuais();
    const r = resultado({ companySize: "Demais", registrationStatus: "Baixada" });
    const linhas = compararDadosDoCnpj(atual, r.company);

    const aplicado = dadosDoCnpjParaAplicar(atual, r, linhas, new Set(["registrationStatus"]));

    expect(aplicado.registrationStatus).toBe("Baixada");
    expect(aplicado.companySize).toBe("Empresa de Pequeno Porte (EPP)");
  });

  it("sem bloco anterior: aplica o que a fonte trouxe, e o que ela não trouxe fica null", () => {
    const r = resultado({ meiOptIn: null, legalNature: null });
    const linhas = compararDadosDoCnpj(null, r.company);

    const aplicado = dadosDoCnpjParaAplicar(null, r, linhas, selecaoInicialDosDadosDoCnpj(linhas));

    expect(aplicado).toMatchObject({
      mainCnaeCode: "1099699",
      establishmentType: "HEADQUARTERS",
      simplesOptIn: true,
      meiOptIn: null,
      legalNature: null,
      openedAt: "2019-03-08",
      consultedAt: CONSULTADO_EM,
    });
  });
});

describe("assinatura do bloco", () => {
  it("não depende da ordem das chaves, e muda com a data da consulta", () => {
    const atual = dadosAtuais();
    const reordenado = Object.fromEntries(Object.entries(atual).reverse()) as CustomerCnpjRegistration;

    expect(assinaturaDosDadosDoCnpj(reordenado)).toBe(assinaturaDosDadosDoCnpj(atual));
    expect(assinaturaDosDadosDoCnpj({ ...atual, consultedAt: CONSULTADO_EM })).not.toBe(
      assinaturaDosDadosDoCnpj(atual),
    );
    expect(assinaturaDosDadosDoCnpj(null)).toBe(assinaturaDosDadosDoCnpj(undefined));
  });
});
