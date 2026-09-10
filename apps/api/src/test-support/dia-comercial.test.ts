import { describe, expect, it, vi } from "vitest";
import { hojeComercial } from "@veridi/shared";
import { diaDaColunaDeData, venceuEm } from "../lib/business-day.js";
import { diaComercialDeTeste, marcadorDoDiaComercialDeTeste } from "./dia-comercial.js";

/**
 * A fixture não pode gravar INSTANTE num campo de DATA CIVIL — D-17.
 *
 * O defeito não era do produto: era da fixture. Escrever
 * `new Date().toISOString()` num campo que o domínio lê com
 * `diaDaColunaDeData` (UTC) e compara contra `hojeComercial` (São Paulo) só
 * funciona enquanto os dois calendários concordam. Entre 00:00 e 03:00 UTC —
 * 21:00 às 23:59 em São Paulo — eles não concordam, e a fixture que queria
 * dizer "hoje" diz "amanhã".
 *
 * A suíte da API ficava vermelha nessas três horas: 63 casos em 19 arquivos.
 * Vinte e uma horas por dia ela era verde, o que fazia o defeito parecer
 * intermitente e do produto.
 *
 * Nada aqui depende do fuso da máquina. O relógio é fixado no instante da
 * borda, e o único fuso citado é o comercial, que vem da fundação.
 */

/**
 * A borda. 01:30 UTC de 10/09 é 22:30 de 09/09 em São Paulo: o calendário UTC
 * já virou, o comercial não. É o instante em que a Veridi ainda está no dia
 * anterior e o servidor já está no seguinte.
 */
const BORDA = new Date("2026-09-10T01:30:00.000Z");

/** Meio-dia UTC, quando os dois calendários concordam e o defeito se esconde. */
const MEIO_DIA = new Date("2026-09-10T15:00:00.000Z");

function comRelogioEm<T>(instante: Date, executar: () => T): T {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(instante);
  try {
    return executar();
  } finally {
    vi.useRealTimers();
  }
}

describe("D-17 — a borda entre o dia UTC e o dia comercial", () => {
  it("na borda, os dois calendários discordam: UTC diz 10, a Veridi diz 09", () => {
    comRelogioEm(BORDA, () => {
      expect(new Date().toISOString().slice(0, 10)).toBe("2026-09-10");
      expect(hojeComercial()).toBe("2026-09-09");
    });
  });

  it("a fixture antiga grava o marcador de AMANHÃ quando queria dizer hoje", () => {
    comRelogioEm(BORDA, () => {
      // Exatamente o que 19 arquivos faziam: o instante de agora, em ISO.
      const comoAFixtureFazia = new Date(new Date().toISOString());

      expect(diaDaColunaDeData(comoAFixtureFazia)).toBe("2026-09-10");
      // O domínio pergunta pelo dia comercial. Um é 10, o outro é 09.
      expect(diaDaColunaDeData(comoAFixtureFazia)).not.toBe(hojeComercial());
      expect(diaDaColunaDeData(comoAFixtureFazia) > hojeComercial()).toBe(true);
    });
  });

  it("o helper grava o marcador de HOJE, e o domínio concorda", () => {
    comRelogioEm(BORDA, () => {
      const marcador = marcadorDoDiaComercialDeTeste();

      expect(marcador.toISOString()).toBe("2026-09-09T00:00:00.000Z");
      expect(diaDaColunaDeData(marcador)).toBe("2026-09-09");
      expect(diaDaColunaDeData(marcador)).toBe(hojeComercial());
      // Nem futura nem passada: é o dia de hoje na operação.
      expect(diaDaColunaDeData(marcador) > hojeComercial()).toBe(false);
      expect(diaDaColunaDeData(marcador) < hojeComercial()).toBe(false);
    });
  });

  it("fora da borda o helper responde igual — ele não é um remendo da janela", () => {
    comRelogioEm(MEIO_DIA, () => {
      expect(diaComercialDeTeste()).toBe("2026-09-10");
      expect(diaDaColunaDeData(marcadorDoDiaComercialDeTeste())).toBe(hojeComercial());
    });
  });
});

describe('D-17 — "ontem" e "amanhã" são dias, não 24 horas de relógio', () => {
  it("na borda, `Date.now() - 24h` cai no dia comercial de HOJE", () => {
    comRelogioEm(BORDA, () => {
      // O que as fixtures de lote vencido faziam. 01:30 de 10/09 menos 24h é
      // 01:30 de 09/09 em UTC — que é o dia comercial de HOJE, não o de ontem.
      const comoAFixtureFazia = new Date(Date.now() - 24 * 60 * 60 * 1000);

      expect(diaDaColunaDeData(comoAFixtureFazia)).toBe("2026-09-09");
      expect(diaDaColunaDeData(comoAFixtureFazia)).toBe(hojeComercial());
      // Consequência: o lote "vencido ontem" ainda não venceu.
      expect(venceuEm(comoAFixtureFazia, new Date())).toBe(false);
    });
  });

  it("o helper anda um DIA para trás, e o vencimento acontece", () => {
    comRelogioEm(BORDA, () => {
      const ontem = marcadorDoDiaComercialDeTeste(-1);

      expect(diaComercialDeTeste(-1)).toBe("2026-09-08");
      expect(venceuEm(ontem, new Date())).toBe(true);
    });
  });

  it("amanhã é o dia seguinte ao comercial, e ainda não venceu", () => {
    comRelogioEm(BORDA, () => {
      expect(diaComercialDeTeste(1)).toBe("2026-09-10");
      expect(venceuEm(marcadorDoDiaComercialDeTeste(1), new Date())).toBe(false);
    });
  });

  it("o deslocamento atravessa a virada do mês pelo calendário, não por 30 dias", () => {
    comRelogioEm(new Date("2026-10-01T01:30:00.000Z"), () => {
      // 01:30 UTC de 01/10 é 22:30 de 30/09 em São Paulo.
      expect(hojeComercial()).toBe("2026-09-30");
      expect(diaComercialDeTeste(1)).toBe("2026-10-01");
      expect(diaComercialDeTeste(-30)).toBe("2026-08-31");
    });
  });
});

describe("D-17 — o resultado não depende do fuso da máquina", () => {
  /*
   * O defeito foi encontrado numa máquina em `America/Vancouver`, e em UTC ou
   * em São Paulo ele existe igual — só muda a hora local em que a janela cai.
   * O helper não lê o fuso do processo em lugar nenhum: sai de `hojeComercial`,
   * que nomeia `America/Sao_Paulo` explicitamente. Estas afirmações valem em
   * qualquer `TZ`, e é isso que elas provam.
   */
  it("o marcador é o mesmo em qualquer TZ do processo, porque não depende dele", () => {
    const original = process.env.TZ;
    const medidos: string[] = [];
    try {
      for (const fuso of ["UTC", "America/Vancouver", "America/Sao_Paulo", "Asia/Tokyo"]) {
        process.env.TZ = fuso;
        medidos.push(
          comRelogioEm(BORDA, () => marcadorDoDiaComercialDeTeste().toISOString()),
        );
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }

    expect(new Set(medidos).size).toBe(1);
    expect(medidos[0]).toBe("2026-09-09T00:00:00.000Z");
  });
});
