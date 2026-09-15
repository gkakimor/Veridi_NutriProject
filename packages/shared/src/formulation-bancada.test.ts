import { describe, expect, it } from "vitest";
import { Decimal, type DecimalInstance } from "./decimal-config.js";
import {
  calcularQuantidadeDaDose,
  calcularQuantidadeDoComponente,
  capsulasPorEmbalagem,
  dosesPorEmbalagemDaApresentacao,
  formaDerivaDoses,
  resumirDoses,
  type ComponentQuantityInput,
  type PremissasDaApresentacao,
  type UomFactorLike,
} from "./formulation-quantity.js";

/**
 * FORMULATION-WORKBENCH-01 — a bancada contra as planilhas reais da Veridi.
 *
 * Os números de referência vêm das abas "Base Cálculo" de
 * `CMV ÁCIDO FÓLICO PT 120 CAPS CUSTO REAL.xlsx` e
 * `CMV BEEF PROTEIN ABACAXI 900G POTE.xlsx` (valores em cache das células,
 * copiados como estão; as planilhas não entram no repositório). Na planilha:
 *
 *   E = grau de pureza (fração)   F = mg/fórmula (alvo ativo por dose)
 *   G = F ÷ E (física por dose)   H = G ÷ cápsulas por dose (só cápsula)
 *   U6 = cápsulas por embalagem (cápsula) ou mg por embalagem (pó)
 *   H8 = dose do pó em mg         P8 = reserva de produção
 *
 * A pureza da planilha é fração (0,7); no Veridi é percentual (70). A reserva
 * de produção (P8) NÃO entra em G nem em H — prova, pela própria planilha, que
 * pureza e reserva/overage são ajustes distintos.
 */

const UNIDADES: UomFactorLike[] = [
  { code: "kg", dimension: "MASS", toBaseFactor: "1000" },
  { code: "g", dimension: "MASS", toBaseFactor: "1" },
  { code: "mg", dimension: "MASS", toBaseFactor: "0.001" },
  { code: "un", dimension: "COUNT", toBaseFactor: "1" },
];

/** Premissas em branco — cada caso preenche só o que a sua forma usa. */
const SEM_PREMISSAS: PremissasDaApresentacao = {
  dosageForm: null,
  capsulesPerDose: null,
  capsulesPerPackage: null,
  doseAmount: null,
  doseUomCode: null,
  packageContentAmount: null,
  packageContentUomCode: null,
};

/** Diferença absoluta máxima aceita contra o double da planilha. */
const TOLERANCIA = new Decimal("1e-9");

function bate(valor: DecimalInstance | null | undefined, planilha: string, rotulo: string) {
  expect(valor, `${rotulo}: sem valor`).toBeTruthy();
  const diferenca = valor!.minus(planilha).abs();
  expect(
    diferenca.lessThanOrEqualTo(TOLERANCIA),
    `${rotulo}: motor ${valor!.toFixed()} × planilha ${planilha}`,
  ).toBe(true);
}

/** Linha da bancada: alvo ativo por dose em mg, pureza aplicada. */
function linhaPorDose(alvoMg: string, purezaPercent: string | null): Omit<ComponentQuantityInput, "stockUnitCode"> {
  return {
    basis: "PER_DOSE",
    quantity: alvoMg,
    unitCode: "mg",
    purityPercent: purezaPercent,
    overagePercent: null,
    quantityMode: "THEORETICAL_WITH_ADJUSTMENTS",
    applyPurityAdjustment: true,
    applyOverageAdjustment: false,
  };
}

function dose(linha: Omit<ComponentQuantityInput, "stockUnitCode">, capsulas: number | null) {
  const resultado = calcularQuantidadeDaDose(linha, capsulas, UNIDADES);
  if (resultado === null || typeof resultado === "string") {
    throw new Error(`conta da dose impossível: ${String(resultado)}`);
  }
  return resultado;
}

/** Pureza da planilha (fração) em percentual, sem float. */
function percentual(fracao: string): string {
  return new Decimal(fracao).times(100).toFixed();
}

describe("Golden — Ácido Fólico PT 120 caps (planilha real)", () => {
  // Base Cálculo!C5 = CÁPSULA · C6 = POTE · H6 = 1 cápsula/dose · U6 = 120 cápsulas/embalagem.
  const CAPSULAS_POR_DOSE = 1;
  const CAPSULAS_POR_EMBALAGEM = 120;

  // [cód, MP, E pureza, F alvo mg, G física mg/dose, H mg/cápsula] — linhas 11 a 17.
  const LINHAS: [string, string, string, string, string, string][] = [
    ["30", "Ácido Fólico", "0.7", "0.4", "0.57142857142857151", "0.57142857142857151"],
    ["13", "Vitamina B6", "0.7", "1.9", "2.7142857142857144", "2.7142857142857144"],
    ["7", "Vitamina B12", "0.7", "0.0026", "0.0037142857142857142", "0.0037142857142857142"],
    ["371", "Dióxido de Silício", "1", "5", "5", "5"],
    ["372", "Estearato de Magnésio", "1", "20", "20", "20"],
    ["120", "Celulose microcristalina 101", "1", "5", "5", "5"],
    ["260", "Cálcio (carbonato)", "1", "500", "500", "500"],
  ];

  it("doses por embalagem: 120 cápsulas ÷ 1 cápsula por dose = 120", () => {
    expect(formaDerivaDoses("CAPSULE")).toBe(true);
    const doses = dosesPorEmbalagemDaApresentacao(
      { ...SEM_PREMISSAS, dosageForm: "CAPSULE", capsulesPerDose: 1, capsulesPerPackage: 120 },
      UNIDADES,
    );
    expect(doses).toBe(120);
    expect(capsulasPorEmbalagem(CAPSULAS_POR_DOSE, 120)).toBe(CAPSULAS_POR_EMBALAGEM);
  });

  it("Ácido Fólico: 0,400 mg a 70% = 0,571428… mg por dose e por cápsula", () => {
    const resultado = dose(linhaPorDose("0.4", "70"), CAPSULAS_POR_DOSE);
    expect(resultado.teorica.toFixed()).toBe("0.4");
    bate(resultado.fisica, "0.57142857142857151", "física por dose");
    bate(resultado.porCapsula, "0.57142857142857151", "por cápsula");
    expect(resultado.fisica.toFixed(6)).toBe("0.571429");
  });

  it.each(LINHAS)("linha %s %s reproduz G e H da planilha", (codigo, nome, e, f, g, h) => {
    const resultado = dose(linhaPorDose(f, percentual(e)), CAPSULAS_POR_DOSE);
    bate(resultado.fisica, g, `${codigo} ${nome} — física por dose (G)`);
    bate(resultado.porCapsula, h, `${codigo} ${nome} — mg por cápsula (H)`);
  });

  it("subtotais: F = 532,3026 mg; G = H = 533,289428… mg", () => {
    const linhas = LINHAS.map(([, , e, f]) => {
      const r = dose(linhaPorDose(f, percentual(e)), CAPSULAS_POR_DOSE);
      return { teorica: r.teorica, fisica: r.fisica, unitCode: "mg" };
    });
    const resumo = resumirDoses(linhas, CAPSULAS_POR_DOSE, UNIDADES);
    bate(resumo.teoricaTotal, "532.30259999999998", "subtotal F");
    bate(resumo.fisicaTotal, "533.28942857142852", "subtotal G");
    bate(resumo.porCapsulaTotal, "533.28942857142852", "subtotal H");
    expect(resumo.somadas).toBe(7);
    expect(resumo.foraDaSoma).toBe(0);
  });

  it("massa do lote da planilha (O) = motor por embalagem × lote × (1 + reserva) — reserva fica fora da fórmula", () => {
    // O11 = H11 × U6 × C8 × (1 + P8) / 1.000.000, com C8 = 5.000 potes e P8 = 10%.
    const porLote = calcularQuantidadeDoComponente(
      { ...linhaPorDose("0.4", "70"), stockUnitCode: "kg" },
      5000,
      { basisQuantity: 1, dosesPerPackage: 120 },
      UNIDADES,
    );
    if (typeof porLote === "string") throw new Error(porLote);
    bate(porLote.physical.times("1.1"), "0.37714285714285722", "O11 (kg/lote com reserva)");
  });
});

describe("Golden — Beef Protein Abacaxi 900 g pote (planilha real)", () => {
  // Base Cálculo!C5 = PÓ · C6 = POTE · H8 = 30.000 mg de dose · U6 = 900.000 mg por embalagem.
  const PREMISSAS: PremissasDaApresentacao = {
    ...SEM_PREMISSAS,
    dosageForm: "POWDER",
    doseAmount: "30000",
    doseUomCode: "mg",
    packageContentAmount: "900",
    packageContentUomCode: "g",
  };

  // [cód, MP, E pureza, F alvo mg, G física mg/dose] — linhas 11 a 18.
  const LINHAS: [string, string, string, string, string][] = [
    ["628", "BEEF PROTEIN", "0.95", "26000", "27368.42105263158"],
    ["540", "Goma Xantana", "1", "30", "30"],
    ["380", "Ácido Cítrico", "1", "2100", "2100"],
    ["385", "Sucralose", "1", "60", "60"],
    ["371", "Dióxido de Silício", "1", "1320", "1320"],
    ["433", "Aroma AIN Abacaxi", "1", "450", "450"],
    ["655", "Corante amarelo (Corantec)", "1", "460", "460"],
    ["656", "Corante verde (Oterra)", "1", "40", "40"],
  ];

  it("doses por embalagem: 900 g ÷ 30.000 mg = 30", () => {
    expect(formaDerivaDoses("POWDER")).toBe(true);
    expect(dosesPorEmbalagemDaApresentacao(PREMISSAS, UNIDADES)).toBe(30);
  });

  it("BEEF PROTEIN: 26.000 mg a 95% = 27.368,421… mg por dose, sem valor por cápsula", () => {
    const resultado = dose(linhaPorDose("26000", "95"), null);
    bate(resultado.fisica, "27368.42105263158", "física por dose");
    expect(resultado.porCapsula).toBeNull();
    expect(resultado.fisica.toFixed(3)).toBe("27368.421");
  });

  it.each(LINHAS)("linha %s %s reproduz G da planilha", (codigo, nome, e, f, g) => {
    const resultado = dose(linhaPorDose(f, percentual(e)), null);
    bate(resultado.fisica, g, `${codigo} ${nome} — física por dose (G)`);
    expect(resultado.porCapsula, `${codigo} — pó não tem mg por cápsula`).toBeNull();
  });

  it("subtotais: F = 30.460 mg; G = 31.828,421… mg — e a dose declarada é outra (30.000 mg)", () => {
    const linhas = LINHAS.map(([, , e, f]) => {
      const r = dose(linhaPorDose(f, percentual(e)), null);
      return { teorica: r.teorica, fisica: r.fisica, unitCode: "mg" };
    });
    const resumo = resumirDoses(linhas, null, UNIDADES);
    bate(resumo.teoricaTotal, "30460", "subtotal F");
    bate(resumo.fisicaTotal, "31828.42105263158", "subtotal G");
    expect(resumo.porCapsulaTotal).toBeNull();
  });

  it("massa do lote da planilha (O) = motor por embalagem × (1 + reserva de 2%)", () => {
    // O11 = G11 × C8 × (U6 ÷ H8) / 1.000.000 × (1 + P8), com C8 = 1 pote.
    const porLote = calcularQuantidadeDoComponente(
      { ...linhaPorDose("26000", "95"), stockUnitCode: "kg" },
      1,
      { basisQuantity: 1, dosesPerPackage: 30 },
      UNIDADES,
    );
    if (typeof porLote === "string") throw new Error(porLote);
    bate(porLote.physical.times("1.02"), "0.83747368421052637", "O11 (kg/lote com reserva)");
  });
});

describe("Pureza na bancada", () => {
  it("100% não corrige; 95% e 70% dividem; o motor é o mesmo da embalagem", () => {
    expect(dose(linhaPorDose("500", "100"), null).fisica.toFixed()).toBe("500");
    bate(dose(linhaPorDose("26000", "95"), null).fisica, "27368.421052631578947368", "95%");
    bate(dose(linhaPorDose("0.4", "70"), null).fisica, "0.571428571428571428", "70%");
  });

  it("pureza zero ou ausente não corrige — nunca divide por zero nem assume 100% para fechar número", () => {
    expect(dose(linhaPorDose("10", "0"), null).fisica.toFixed()).toBe("10");
    expect(dose(linhaPorDose("10", null), null).fisica.toFixed()).toBe("10");
  });

  it("pureza registrada sob quantidade física informada não altera a dose", () => {
    const fisicaInformada = { ...linhaPorDose("10", "50"), quantityMode: "PHYSICAL_DIRECT" as const };
    expect(dose(fisicaInformada, null).fisica.toFixed()).toBe("10");
  });

  it("pureza não é overage: overage só entra autorizado, e separado da pureza", () => {
    const comOverageRegistrado = { ...linhaPorDose("70", "70"), overagePercent: "10" };
    expect(dose(comOverageRegistrado, null).fisica.toFixed()).toBe("100");
    const comOverageAutorizado = { ...comOverageRegistrado, applyOverageAdjustment: true };
    expect(dose(comOverageAutorizado, null).fisica.toFixed()).toBe("110");
  });
});

describe("Cápsulas por dose", () => {
  it("1 cápsula por dose: por cápsula = por dose", () => {
    const resultado = dose(linhaPorDose("500", "100"), 1);
    expect(resultado.porCapsula?.toFixed()).toBe("500");
  });

  it("2 cápsulas por dose: cada cápsula leva metade da dose", () => {
    const resultado = dose(linhaPorDose("500", "100"), 2);
    expect(resultado.fisica.toFixed()).toBe("500");
    expect(resultado.porCapsula?.toFixed()).toBe("250");
  });

  it("2 cápsulas por dose com 120 por embalagem fecham 60 doses; 7 por dose não dividem 120", () => {
    const base = { ...SEM_PREMISSAS, dosageForm: "CAPSULE" as const, capsulesPerPackage: 120 };
    expect(dosesPorEmbalagemDaApresentacao({ ...base, capsulesPerDose: 2 }, UNIDADES)).toBe(60);
    expect(dosesPorEmbalagemDaApresentacao({ ...base, capsulesPerDose: 7 }, UNIDADES)).toBe(
      "CAPSULAS_NAO_DIVIDEM",
    );
  });

  it("premissa em branco é ausência, não zero", () => {
    expect(
      dosesPorEmbalagemDaApresentacao(
        { ...SEM_PREMISSAS, dosageForm: "CAPSULE", capsulesPerDose: 1, capsulesPerPackage: null },
        UNIDADES,
      ),
    ).toBeNull();
    expect(capsulasPorEmbalagem(1, null)).toBeNull();
  });
});

describe("Pó e demais formas", () => {
  it("conteúdo que não fecha doses inteiras é recusado, não arredondado", () => {
    expect(
      dosesPorEmbalagemDaApresentacao(
        { ...SEM_PREMISSAS, dosageForm: "POWDER", doseAmount: "35", doseUomCode: "g", packageContentAmount: "900", packageContentUomCode: "g" },
        UNIDADES,
      ),
    ).toBe("DOSES_NAO_INTEIRAS");
  });

  it("dose ou conteúdo fora de massa é recusado", () => {
    expect(
      dosesPorEmbalagemDaApresentacao(
        { ...SEM_PREMISSAS, dosageForm: "POWDER", doseAmount: "1", doseUomCode: "un", packageContentAmount: "30", packageContentUomCode: "un" },
        UNIDADES,
      ),
    ).toBe("UOM_INCOMPATIVEL");
  });

  it("comprimido, líquido e outras formas não derivam doses — o número segue digitado", () => {
    for (const forma of ["TABLET", "LIQUID", "OTHER", null] as const) {
      expect(formaDerivaDoses(forma)).toBe(false);
      expect(dosesPorEmbalagemDaApresentacao({ ...SEM_PREMISSAS, dosageForm: forma }, UNIDADES)).toBeNull();
    }
  });

  it("linha fora da base por dose não tem grandeza por dose", () => {
    expect(
      calcularQuantidadeDaDose({ ...linhaPorDose("1", null), basis: "PER_FINISHED_UNIT" }, 1, UNIDADES),
    ).toBeNull();
  });

  it("soma por dose deixa fora, e conta, o que não é massa", () => {
    const resumo = resumirDoses(
      [
        { teorica: "500", fisica: "500", unitCode: "mg" },
        { teorica: "1", fisica: "1", unitCode: "g" },
        { teorica: "2", fisica: "2", unitCode: "un" },
      ],
      null,
      UNIDADES,
    );
    expect(resumo.fisicaTotal.toFixed()).toBe("1500");
    expect(resumo.somadas).toBe(2);
    expect(resumo.foraDaSoma).toBe(1);
  });
});
