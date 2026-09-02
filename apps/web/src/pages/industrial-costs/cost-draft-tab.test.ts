import { beforeEach, describe, expect, it } from "vitest";
import {
  readContextualCreate,
  startContextualCreate,
  takeContextualCreate,
} from "../../lib/contextual-create";

/**
 * A aba viaja com o rascunho da estrutura de custos.
 *
 * Produto com rascunho E versão ativa abre na aba "Ativa". Quem trocava para
 * "Rascunho", preenchia a linha e saía para cadastrar um recurso voltava na
 * aba "Ativa", onde os campos nem são renderizados — versão ativa não se
 * edita. O rascunho continuava intacto por baixo, mas a pessoa via o trabalho
 * sumido, o que na prática é a mesma coisa.
 *
 * O teste é sobre o CONTRATO do rascunho, não sobre a renderização: a tela de
 * custos precisa de uma estrutura carregada do servidor para montar, e o que
 * quebrou não foi o React — foi a lista de chaves que atravessa a navegação.
 */

const RASCUNHO_DA_LINHA = {
  lendoAtiva: false,
  referenceQuantity: "1000",
  category: "SECONDARY_PACKAGING",
  description: "Encapsulação",
  basis: "FIXED_PER_BATCH",
  rateValue: "120,00",
  usageResourceId: "",
  usageQuantity: "2",
};

beforeEach(() => {
  sessionStorage.clear();
});

describe("rascunho da estrutura de custos", () => {
  it("leva a aba junto com os campos da linha", () => {
    const token = startContextualCreate({
      originRoute: "/produtos/prod-1/custos",
      fieldKey: "usageResourceId",
      entityType: "industrialResource",
      draft: RASCUNHO_DA_LINHA,
    })!;

    const registro = readContextualCreate(token);
    // Sem esta chave, a volta cai na aba "Ativa" e os campos somem da tela.
    expect(registro?.draft).toHaveProperty("lendoAtiva", false);
    expect(registro?.draft).toEqual(RASCUNHO_DA_LINHA);
  });

  it("sobrevive à ida e à volta inteira", () => {
    const token = startContextualCreate({
      originRoute: "/produtos/prod-1/custos",
      fieldKey: "usageResourceId",
      entityType: "industrialResource",
      draft: RASCUNHO_DA_LINHA,
    })!;

    const retomada = takeContextualCreate(token)!;
    expect(retomada.record.draft["lendoAtiva"]).toBe(false);
    expect(retomada.record.draft["description"]).toBe("Encapsulação");
    retomada.commit();
  });

  /*
   * Rascunho gravado antes de a aba viajar junto continua válido: a chave
   * ausente tem de cair no padrão da tela, não virar `false` por
   * coincidência de tipo.
   */
  it("rascunho antigo, sem a aba, não decide a aba por acidente", () => {
    const { lendoAtiva: _omitida, ...semAba } = RASCUNHO_DA_LINHA;
    const token = startContextualCreate({
      originRoute: "/produtos/prod-1/custos",
      fieldKey: "usageResourceId",
      entityType: "industrialResource",
      draft: semAba,
    })!;

    const registro = readContextualCreate(token);
    expect(registro?.draft).not.toHaveProperty("lendoAtiva");
    expect(typeof registro?.draft["lendoAtiva"]).toBe("undefined");
  });
});
