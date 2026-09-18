import { describe, expect, it } from "vitest";
import type { CnpjLookupCompany, CustomerCnpjRegistration } from "@veridi/shared";
import { CNPJ_REGISTRATION_FIELDS } from "@veridi/shared";
import {
  CAMPOS_DA_CONSULTA_DE_CNPJ,
  DADOS_DO_CNPJ_VAZIOS,
  compararComOCadastro,
  compararDadosDoCnpj,
  dadosDoCnpjDoFormulario,
  dadosDoCnpjNoFormulario,
  dadosDoCnpjParaAplicar,
  linhaSelecionavel,
  selecaoInicial,
  simNaoOuNaoInformado,
  valoresParaAplicar,
} from "./cnpj-lookup-fields";
import type {
  LinhaDaComparacao,
  LinhaDosDadosDoCnpj,
  ValoresDoFormulario,
  ValoresDosDadosDoCnpj,
} from "./cnpj-lookup-fields";

/**
 * As regras de comparação da consulta de CNPJ — §111 e §122
 * (CUSTOMER-CNPJ-LOOKUP-01, CUSTOMER-CNPJ-EDITABLE-HISTORY-01).
 *
 * Sem tela e sem rede: é aqui que se prova "a fonte pode trocar este valor?".
 * A consulta é ADITIVA: completa o vazio (marcado), troca o preenchido só por
 * escolha ("Substituir", desmarcado), deixa confirmar o equivalente, e nunca
 * apaga com o vazio da fonte.
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

  it("cadastro em branco: tudo que a fonte trouxe completa o cadastro, e nasce marcado", () => {
    const linhas = compararComOCadastro(VAZIO, fonte());

    expect(linhas.every((item) => item.situacao === "preencher")).toBe(true);
    expect(selecaoInicial(linhas).size).toBe(CAMPOS_DA_CONSULTA_DE_CNPJ.length);
    expect(linha(linhas, "legalName").retornado).toBe("VERIDI NUTRITION LTDA");
  });

  it("valor já preenchido e a fonte diferente: 'Substituir', e NÃO nasce marcado", () => {
    const linhas = compararComOCadastro({ ...VAZIO, legalName: "VERIDI TESTE LTDA" }, fonte());

    expect(linha(linhas, "legalName")).toMatchObject({
      rotulo: "Razão Social / Nome",
      atual: "VERIDI TESTE LTDA",
      retornado: "VERIDI NUTRITION LTDA",
      situacao: "substituir",
    });
    expect(selecaoInicial(linhas).has("legalName")).toBe(false);
  });
});

describe("equivalentes: 'Confirmar', selecionável e nunca escondido", () => {
  it.each([
    ["mesma cidade em caixa e acento diferentes", { city: "Tatuí" }, { city: "TATUÍ" }, "city"],
    ["a base pública escreve sem acento", { city: "São Paulo" }, { city: "SAO PAULO" }, "city"],
    ["espaço sobrando", { street: "  Avenida   Paulista " }, { street: "AVENIDA PAULISTA" }, "street"],
    ["CEP com e sem máscara", { zipCode: "01310-100" }, { postalCode: "01310100" }, "zipCode"],
    ["telefone com e sem máscara", { phone: "(11) 98765-4321" }, { phone: "11987654321" }, "phone"],
    ["e-mail só muda de caixa", { email: "contato@veridi.com.br" }, { email: "CONTATO@VERIDI.COM.BR" }, "email"],
  ] as const)("%s", (_caso, atual, daFonte, campo) => {
    const linhas = compararComOCadastro({ ...VAZIO, ...atual }, fonte(daFonte));
    const item = linha(linhas, campo);

    expect(item.situacao, campo).toBe("confirmar");
    expect(linhaSelecionavel(item.situacao)).toBe(true);
    expect(selecaoInicial(linhas).has(campo)).toBe(false);
  });

  it("confirmar aplica o valor da fonte, no formato do campo", () => {
    const linhas = compararComOCadastro({ ...VAZIO, city: "Tatuí" }, fonte({ city: "TATUÍ" }));
    expect(valoresParaAplicar(linhas, new Set(["city"]))).toEqual({ city: "TATUÍ" });
  });

  it("uma diferença de verdade continua sendo diferença", () => {
    const linhas = compararComOCadastro({ ...VAZIO, city: "Sorocaba" }, fonte({ city: "SAO PAULO" }));
    expect(linha(linhas, "city").situacao).toBe("substituir");
  });
});

describe("valor vazio da fonte nunca apaga valor existente", () => {
  it("campo nulo na fonte não oferece operação nenhuma", () => {
    const preenchido: ValoresDoFormulario = {
      ...VAZIO,
      tradeName: "Nome que a operação escreveu",
      phone: "(11) 98765-4321",
      complement: "Sala 2",
    };
    const linhas = compararComOCadastro(preenchido, fonte({ tradeName: null, phone: null, complement: null }));

    for (const campo of ["tradeName", "phone", "complement"]) {
      expect(linha(linhas, campo).situacao, campo).toBe("sem_valor");
      expect(linha(linhas, campo).retornado, campo).toBe("");
      expect(linhaSelecionavel(linha(linhas, campo).situacao), campo).toBe(false);
    }
    // Nem marcando à força: a linha sem valor não aplica.
    expect(valoresParaAplicar(linhas, new Set(["tradeName", "phone", "complement"]))).toEqual({});
  });

  it("string vazia e só espaços valem o mesmo que ausente", () => {
    const linhas = compararComOCadastro({ ...VAZIO, tradeName: "Fantasia atual" }, fonte({ tradeName: "   " }));
    expect(linha(linhas, "tradeName").situacao).toBe("sem_valor");
  });
});

describe("o que o cadastro não guardaria não é oferecido", () => {
  it("CEP incompleto aparece com o motivo, e não se aplica", () => {
    const linhas = compararComOCadastro(VAZIO, fonte({ postalCode: "0131010" }));
    const item = linha(linhas, "zipCode");

    expect(item.situacao).toBe("nao_aplicavel");
    expect(item.retornado).toBe("0131010");
    expect(item.motivo).toBe("A fonte devolveu um CEP incompleto.");
    expect(valoresParaAplicar(linhas, new Set(["zipCode"]))).toEqual({});
  });

  it("UF desconhecida, telefone inválido e e-mail inválido não se aplicam", () => {
    const linhas = compararComOCadastro(VAZIO, fonte({ state: "XX", phone: "1012345678", email: "SEM EMAIL" }));
    expect(linha(linhas, "state").situacao).toBe("nao_aplicavel");
    expect(linha(linhas, "phone").situacao).toBe("nao_aplicavel");
    expect(linha(linhas, "email").situacao).toBe("nao_aplicavel");
  });

  it("texto mais longo do que o campo aceita não se aplica, e o motivo diz o limite", () => {
    const linhas = compararComOCadastro(VAZIO, fonte({ complement: "A".repeat(150) }));
    const item = linha(linhas, "complement");

    expect(item.situacao).toBe("nao_aplicavel");
    expect(item.motivo).toContain("150");
    expect(item.motivo).toContain("100");
  });

  it("no limite exato ainda cabe", () => {
    const linhas = compararComOCadastro(VAZIO, fonte({ complement: "A".repeat(100) }));
    expect(linha(linhas, "complement").situacao).toBe("preencher");
  });
});

describe("seleção e aplicação", () => {
  it("só o que completa nasce marcado; substituir, confirmar, sem valor e não aplicável, não", () => {
    const linhas = compararComOCadastro(
      { ...VAZIO, city: "SAO PAULO", number: "999" },
      fonte({ tradeName: null, state: "XX" }),
    );
    const marcados = selecaoInicial(linhas);

    expect(marcados.has("legalName")).toBe(true);
    expect(marcados.has("number")).toBe(false); // substituir
    expect(marcados.has("city")).toBe(false); // confirmar
    expect(marcados.has("tradeName")).toBe(false); // sem valor
    expect(marcados.has("state")).toBe(false); // não aplicável
  });

  it("substituição explícita aplica o valor da fonte por cima do existente", () => {
    const linhas = compararComOCadastro({ ...VAZIO, number: "999" }, fonte());
    expect(valoresParaAplicar(linhas, new Set(["number"]))).toEqual({ number: "1000" });
  });

  it("o valor aplicado é o do campo — CEP e telefone com a máscara da tela", () => {
    const linhas = compararComOCadastro(VAZIO, fonte());
    const aplicar = valoresParaAplicar(linhas, selecaoInicial(linhas));

    expect(aplicar.zipCode).toBe("01310-100");
    expect(aplicar.phone).toBe("(11) 98765-4321");
    expect(aplicar.legalName).toBe("VERIDI NUTRITION LTDA");
  });

  it("nada marcado, nada aplicado", () => {
    const linhas = compararComOCadastro(VAZIO, fonte());
    expect(valoresParaAplicar(linhas, new Set())).toEqual({});
  });
});

/* ------------------------------------------------------------------------ */
/* Dados cadastrais do CNPJ — §119 e §122.                                   */
/* ------------------------------------------------------------------------ */

/** Os dados como o formulário os guarda: texto por campo. */
function formulario(overrides: Partial<ValoresDosDadosDoCnpj> = {}): ValoresDosDadosDoCnpj {
  return {
    mainCnaeCode: "1099-6/99",
    mainCnaeDescription: "Fabricação de outros produtos alimentícios",
    legalNature: "Sociedade Empresária Limitada",
    companySize: "Empresa de Pequeno Porte (EPP)",
    openedAt: "2019-03-08",
    establishmentType: "HEADQUARTERS",
    simplesOptIn: "true",
    meiOptIn: "false",
    registrationStatus: "Ativa",
    registrationStatusDate: "2020-01-15",
    ...overrides,
  };
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

describe("dados cadastrais: texto do formulário × contrato", () => {
  const gravados: CustomerCnpjRegistration = {
    mainCnaeCode: "1099699",
    mainCnaeDescription: "Fabricação de outros produtos alimentícios",
    legalNature: "Sociedade Empresária Limitada",
    companySize: null,
    openedAt: "2019-03-08",
    establishmentType: "BRANCH",
    simplesOptIn: false,
    meiOptIn: null,
    registrationStatus: "Ativa",
    registrationStatusDate: null,
    lastConsultedAt: "2026-09-17T12:30:00.000Z",
  };

  it("vai e volta sem perder nada: CNAE com máscara na tela, dígitos no contrato; null continua null", () => {
    const naTela = dadosDoCnpjNoFormulario(gravados);
    expect(naTela).toMatchObject({ mainCnaeCode: "1099-6/99", simplesOptIn: "false", meiOptIn: "", companySize: "" });

    const { lastConsultedAt: _metadado, ...valores } = gravados;
    expect(dadosDoCnpjDoFormulario(naTela)).toEqual(valores);
  });

  it("sem dados gravados, todos os campos começam vazios", () => {
    expect(dadosDoCnpjNoFormulario(null)).toEqual(DADOS_DO_CNPJ_VAZIOS);
    expect(Object.values(dadosDoCnpjDoFormulario(DADOS_DO_CNPJ_VAZIOS)).every((valor) => valor === null)).toBe(true);
  });
});

describe("dados cadastrais: Atual × Retornado, aditivo", () => {
  it("compara os dez dados cadastrais, na ordem do contrato", () => {
    const linhas = compararDadosDoCnpj(DADOS_DO_CNPJ_VAZIOS, fonte());
    expect(linhas.map((item) => item.campo)).toEqual([...CNPJ_REGISTRATION_FIELDS]);
  });

  it("tudo vazio: tudo que a fonte trouxe completa, marcado, com datas em pt-BR e CNAE com máscara", () => {
    const linhas = compararDadosDoCnpj(DADOS_DO_CNPJ_VAZIOS, fonte());

    expect(linhas.every((item) => item.situacao === "preencher" && item.atual === "")).toBe(true);
    expect(selecaoInicial(linhas).size).toBe(10);
    expect(dado(linhas, "openedAt").retornado).toBe("08/03/2019");
    expect(dado(linhas, "mainCnaeCode").retornado).toBe("1099-6/99");
    expect(dado(linhas, "establishmentType").retornado).toBe("Matriz");
    expect(dado(linhas, "simplesOptIn").retornado).toBe("Sim");
    expect(dado(linhas, "meiOptIn").retornado).toBe("Não");
  });

  it("mesmos valores: todos 'Confirmar', nenhum marcado", () => {
    const linhas = compararDadosDoCnpj(formulario(), fonte());
    expect(linhas.every((item) => item.situacao === "confirmar")).toBe(true);
    expect(selecaoInicial(linhas).size).toBe(0);
  });

  it("porte preenchido e a fonte diferente: 'Substituir', desmarcado", () => {
    const linhas = compararDadosDoCnpj(formulario({ companySize: "Microempresa (ME)" }), fonte());
    expect(dado(linhas, "companySize")).toMatchObject({
      atual: "Microempresa (ME)",
      retornado: "Empresa de Pequeno Porte (EPP)",
      situacao: "substituir",
    });
    expect(selecaoInicial(linhas).has("companySize")).toBe(false);
  });

  it("Simples Sim no cadastro e Não na fonte: substituir; Não informado e Sim: preencher", () => {
    const linhas = compararDadosDoCnpj(
      formulario({ simplesOptIn: "true", meiOptIn: "" }),
      fonte({ simplesOptIn: false, meiOptIn: true }),
    );
    expect(dado(linhas, "simplesOptIn")).toMatchObject({ atual: "Sim", retornado: "Não", situacao: "substituir" });
    expect(dado(linhas, "meiOptIn")).toMatchObject({ atual: "", retornado: "Sim", situacao: "preencher" });
  });

  it("MEI Sim no cadastro e não informado na fonte: '—', sem operação — não apaga", () => {
    const linhas = compararDadosDoCnpj(formulario({ meiOptIn: "true" }), fonte({ meiOptIn: null }));
    expect(dado(linhas, "meiOptIn")).toMatchObject({ atual: "Sim", retornado: "", situacao: "sem_valor" });
  });

  it("CNAE digitado com máscara é o mesmo código da fonte", () => {
    const linhas = compararDadosDoCnpj(formulario({ mainCnaeCode: "1099-6/99" }), fonte({ mainCnaeCode: "1099699" }));
    expect(dado(linhas, "mainCnaeCode").situacao).toBe("confirmar");
  });
});

describe("aplicar os dados cadastrais", () => {
  it("só o marcado vai para o formulário, já no texto do campo", () => {
    const linhas = compararDadosDoCnpj(
      formulario({ companySize: "Microempresa (ME)", legalNature: "" }),
      fonte({ companySize: "Demais" }),
    );

    // Natureza jurídica vazia: marcada por padrão; o porte, só se a pessoa marcar.
    expect(dadosDoCnpjParaAplicar(linhas, selecaoInicial(linhas), fonte({ companySize: "Demais" }))).toEqual({
      legalNature: "Sociedade Empresária Limitada",
    });
    expect(dadosDoCnpjParaAplicar(linhas, new Set(["companySize"]), fonte({ companySize: "Demais" }))).toEqual({
      companySize: "Demais",
    });
  });

  it("Sim/Não e CNAE chegam ao formulário no formato dos campos", () => {
    const linhas = compararDadosDoCnpj(DADOS_DO_CNPJ_VAZIOS, fonte());
    const aplicado = dadosDoCnpjParaAplicar(linhas, selecaoInicial(linhas), fonte());
    expect(aplicado).toMatchObject({ simplesOptIn: "true", meiOptIn: "false", mainCnaeCode: "1099-6/99", openedAt: "2019-03-08" });
  });

  it("linha sem valor na fonte não aplica, nem marcada", () => {
    const linhas = compararDadosDoCnpj(formulario(), fonte({ companySize: null }));
    expect(dadosDoCnpjParaAplicar(linhas, new Set(["companySize"]), fonte({ companySize: null }))).toEqual({});
  });
});
