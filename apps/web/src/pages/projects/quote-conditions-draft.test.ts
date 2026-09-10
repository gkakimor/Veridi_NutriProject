import { describe, expect, it } from "vitest";
import type { QuoteVersionDTO } from "@veridi/shared";
import {
  type CamposDasCondicoes,
  type ChaveDaCondicao,
  camposDe,
  condicoesAlteradas,
  hidratarRascunho,
  paraEnvio,
  rascunhoDe,
} from "./quote-conditions-draft";

/**
 * O rascunho das condições cobre as NOVE condições — QUOTE-DRAFT-STATE-01.
 *
 * O defeito derrubava os nove campos pelo mesmo efeito, e corrigir só a
 * validade deixaria oito com o mesmo defeito. Estes casos provam pela
 * ESTRUTURA: a conversão do servidor, o envio, a comparação e a hidratação
 * passam pelas mesmas nove chaves — e uma décima condição que nasça sem passar
 * por elas quebra o primeiro teste, em vez de ficar de fora em silêncio.
 */

const NOVE: ChaveDaCondicao[] = [
  "validUntil",
  "leadTimeDays",
  "commercialNotes",
  "discountPercent",
  "paymentMethod",
  "downPaymentPercent",
  "installmentCount",
  "installmentIntervalDays",
  "monthlyInterestPercent",
];

const ordenadas = (chaves: string[]) => [...chaves].sort();

/** Só o que o rascunho lê da versão. */
function versao(overrides: Partial<QuoteVersionDTO> = {}): QuoteVersionDTO {
  return {
    id: "q1",
    status: "DRAFT",
    validUntil: "2026-09-15T00:00:00.000Z",
    leadTimeDays: 30,
    commercialNotes: "Gravada",
    discountPercent: "5.0000",
    paymentMethod: "CASH",
    downPaymentPercent: "10.0000",
    installmentCount: 2,
    installmentIntervalDays: 30,
    monthlyInterestPercent: "1.0000",
    ...overrides,
  } as QuoteVersionDTO;
}

/** O que a pessoa digitou — diferente do gravado nas nove. */
const DIGITADO: CamposDasCondicoes = {
  validUntil: "2026-09-20",
  leadTimeDays: "15",
  commercialNotes: "Digitada",
  discountPercent: "7,5",
  paymentMethod: "INSTALLMENTS",
  downPaymentPercent: "20",
  installmentCount: "3",
  installmentIntervalDays: "28",
  monthlyInterestPercent: "1,5",
};

/** Uma leitura em que o servidor mudou as nove — diferente do gravado E do digitado. */
const OUTRA_LEITURA = versao({
  validUntil: "2026-10-01T00:00:00.000Z",
  leadTimeDays: 45,
  commercialNotes: "Do servidor",
  discountPercent: "3.0000",
  paymentMethod: "INSTALLMENTS",
  downPaymentPercent: "30.0000",
  installmentCount: 4,
  installmentIntervalDays: 15,
  monthlyInterestPercent: "2.0000",
});

/**
 * Forma de pagamento tem dois valores: para a leitura discordar do Parcelado
 * digitado, ela continua À vista.
 */
function leituraQueDiscordaDe(chave: ChaveDaCondicao): QuoteVersionDTO {
  return chave === "paymentMethod" ? { ...OUTRA_LEITURA, paymentMethod: "CASH" } : OUTRA_LEITURA;
}

describe("as nove condições passam pelo mesmo caminho", () => {
  it("conversão, envio e comparação cobrem exatamente as nove", () => {
    expect(ordenadas(Object.keys(camposDe(versao())))).toEqual(ordenadas(NOVE));
    expect(ordenadas(Object.keys(paraEnvio(DIGITADO)))).toEqual(ordenadas(NOVE));
    // Diferir em todos os campos é diferir nas nove — nem uma a mais, nem uma a menos.
    expect(ordenadas(condicoesAlteradas(camposDe(versao()), DIGITADO))).toEqual(ordenadas(NOVE));
  });

  it.each(NOVE)("%s alterado sobrevive à releitura; as outras oito acompanham o servidor", (chave) => {
    const inicial = rascunhoDe(versao());
    const digitado = { ...inicial, campos: { ...inicial.campos, [chave]: DIGITADO[chave] } };
    const leitura = leituraQueDiscordaDe(chave);
    const servidor = camposDe(leitura);

    const depois = hidratarRascunho(digitado, leitura, true);

    expect(depois.campos[chave]).toBe(DIGITADO[chave]);
    for (const outra of NOVE.filter((k) => k !== chave)) {
      expect(depois.campos[outra], outra).toBe(servidor[outra]);
    }
    expect(depois.base).toEqual(servidor);
    expect(condicoesAlteradas(depois.base, depois.campos)).toEqual([chave]);
  });

  it("as nove alteradas juntas sobrevivem a uma releitura que não mudou nada no servidor", () => {
    const inicial = rascunhoDe(versao());
    const digitado = { ...inicial, campos: DIGITADO };

    const depois = hidratarRascunho(digitado, versao(), true);

    // Nada mudou no servidor: o rascunho é o MESMO objeto, e nada re-renderiza.
    expect(depois).toBe(digitado);
    expect(ordenadas(condicoesAlteradas(depois.base, depois.campos))).toEqual(ordenadas(NOVE));
  });

  it("salvar as nove: o gravado vira a base, a tela mostra o gravado e nada fica pendente", () => {
    const inicial = rascunhoDe(versao());
    const salvo = versao({
      validUntil: "2026-09-20T00:00:00.000Z",
      leadTimeDays: 15,
      commercialNotes: "Digitada",
      discountPercent: "7.5000",
      paymentMethod: "INSTALLMENTS",
      downPaymentPercent: "20.0000",
      installmentCount: 3,
      installmentIntervalDays: 28,
      monthlyInterestPercent: "1.5000",
    });

    const depois = hidratarRascunho({ ...inicial, campos: DIGITADO }, salvo, true);

    expect(condicoesAlteradas(depois.base, depois.campos)).toEqual([]);
    expect(depois.campos).toEqual(camposDe(salvo));
  });
});

describe("alteração é de VALOR, não de texto", () => {
  const gravado = camposDe(versao());

  it("o mesmo número escrito de outro jeito não é alteração", () => {
    expect(condicoesAlteradas(gravado, { ...gravado, discountPercent: "5,0" })).toEqual([]);
    expect(condicoesAlteradas(gravado, { ...gravado, discountPercent: "5.00" })).toEqual([]);
    expect(condicoesAlteradas(gravado, { ...gravado, leadTimeDays: " 30 " })).toEqual([]);
    expect(condicoesAlteradas(gravado, { ...gravado, commercialNotes: "Gravada  " })).toEqual([]);
  });

  it("texto não é número: observação “10” e “10.0” são textos diferentes", () => {
    expect(
      condicoesAlteradas(
        { ...gravado, commercialNotes: "10" },
        { ...gravado, commercialNotes: "10.0" },
      ),
    ).toEqual(["commercialNotes"]);
  });

  it("percentual ilegível é alteração — o formulário trava o envio por outro caminho", () => {
    expect(condicoesAlteradas(gravado, { ...gravado, discountPercent: "5,0,0" })).toEqual([
      "discountPercent",
    ]);
  });
});

describe("identidade da versão, nunca do objeto", () => {
  it("outra versão: o rascunho passa a ser o gravado DELA", () => {
    const inicial = rascunhoDe(versao());
    const outra = versao({ id: "q2", validUntil: "2026-11-30T00:00:00.000Z" });

    const depois = hidratarRascunho({ ...inicial, campos: DIGITADO }, outra, true);

    expect(depois.versaoId).toBe("q2");
    expect(depois.campos).toEqual(camposDe(outra));
    expect(condicoesAlteradas(depois.base, depois.campos)).toEqual([]);
  });

  it("a mesma versão, sem edição possível, mostra o gravado", () => {
    const inicial = rascunhoDe(versao());

    const depois = hidratarRascunho({ ...inicial, campos: DIGITADO }, versao({ status: "SENT" }), false);

    expect(depois.campos).toEqual(camposDe(versao()));
    // E uma leitura igual da versão já limpa não produz objeto novo.
    expect(hidratarRascunho(depois, versao({ status: "SENT" }), false)).toBe(depois);
  });
});
