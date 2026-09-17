import { describe, expect, it } from "vitest";
import type { CnpjLookupCompany } from "@veridi/shared";
import {
  CAMPOS_DA_CONSULTA_DE_CNPJ,
  compararComOCadastro,
  selecaoInicial,
  valoresParaAplicar,
} from "./cnpj-lookup-fields";
import type { LinhaDaComparacao, ValoresDoFormulario } from "./cnpj-lookup-fields";

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
    openedAt: "2019-03-08",
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
