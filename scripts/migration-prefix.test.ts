import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PrefixoInvalidoError,
  incrementarPrefixo,
  maiorPrefixo,
  migrationsValidas,
  partesDaPasta,
  proximoPrefixoLivre,
  resolverRenomeacao,
  sanitizarNome,
} from "./migration-prefix.mjs";

/**
 * O algoritmo de renumeracao — MIG-ORDER-01.
 *
 * Tudo aqui roda em fixtures e em diretorio temporario: nenhuma migration de
 * mentira entra em `apps/api/prisma/migrations` so para exercitar tooling.
 * O ultimo bloco le a cadeia REAL do repositorio, mas so para afirmar
 * invariantes — nao escreve nada.
 */

const PONTA_REAL = "20260925093008_quote_line_price_origin";
const MIGRATIONS_REAIS = join(process.cwd(), "apps", "api", "prisma", "migrations");

const temporarios: string[] = [];
afterEach(() => {
  while (temporarios.length > 0) rmSync(temporarios.pop()!, { recursive: true, force: true });
});

/** Um diretorio de migrations descartavel, com as pastas pedidas. */
function fixture(pastas: string[]): string {
  const raiz = mkdtempSync(join(tmpdir(), "veridi-mig-"));
  temporarios.push(raiz);
  for (const pasta of pastas) {
    mkdirSync(join(raiz, pasta));
    writeFileSync(join(raiz, pasta, "migration.sql"), "-- fixture\n");
  }
  return raiz;
}

describe("incremento do prefixo", () => {
  it("avanca um segundo civil, com carry", () => {
    expect(incrementarPrefixo("20260925093008")).toBe("20260925093009");
    expect(incrementarPrefixo("20260925093059")).toBe("20260925093100");
    expect(incrementarPrefixo("20260925235959")).toBe("20260926000000");
    expect(incrementarPrefixo("20261231235959")).toBe("20270101000000");
  });

  it("o resultado e sempre estritamente maior, em ordem lexicografica", () => {
    for (const p of ["20260925093008", "20260925235959", "20260228235959", "20240229235959"]) {
      expect(incrementarPrefixo(p) > p).toBe(true);
    }
  });

  it("recusa prefixo que nao e carimbo real, em vez de normalizar em silencio", () => {
    // `Date.UTC` transformaria mes 00 em dezembro do ano anterior — um numero
    // MENOR. Recusar aqui e o que garante a monotonicidade.
    expect(() => incrementarPrefixo("20260025000000")).toThrow(PrefixoInvalidoError);
    expect(() => incrementarPrefixo("20260931000000")).toThrow(PrefixoInvalidoError);
    expect(() => incrementarPrefixo("2026092509300")).toThrow(PrefixoInvalidoError);
  });
});

describe("resolverRenomeacao", () => {
  it("A. relogio ATRAS da ponta: renumera para depois dela", () => {
    const outras = [PONTA_REAL, "20260909090000_opening_balance"];
    const decisao = resolverRenomeacao("20260909010101_quote_delivery_schedule", outras);

    expect(decisao.acao).toBe("renomear");
    expect(decisao.para).toBe("20260925093009_quote_delivery_schedule");
    expect(decisao.prefixo > "20260925093008").toBe(true);
    // O nome legivel sobrevive inteiro.
    expect(decisao.para.endsWith("_quote_delivery_schedule")).toBe(true);
  });

  it("B. relogio A FRENTE da ponta: nao renumera", () => {
    const decisao = resolverRenomeacao("20261001120000_algo_novo", [PONTA_REAL]);
    expect(decisao.acao).toBe("manter");
    expect(decisao.para).toBe("20261001120000_algo_novo");
  });

  it("B2. empate com a ponta ainda renumera — a regra e ESTRITAMENTE maior", () => {
    const decisao = resolverRenomeacao("20260925093008_outro_nome", [PONTA_REAL]);
    expect(decisao.acao).toBe("renomear");
    expect(decisao.para).toBe("20260925093009_outro_nome");
  });

  it("C. colisao com o proximo prefixo: pula para o seguinte", () => {
    const outras = [PONTA_REAL, "20260925093009_ja_ocupado", "20260925093010_tambem_ocupado"];
    const decisao = resolverRenomeacao("20260909010101_novo", outras);
    expect(decisao.para).toBe("20260925093011_novo");
  });

  it("D. repositorio sem migration nenhuma: mantem o carimbo do Prisma", () => {
    const decisao = resolverRenomeacao("20260909010101_primeira", []);
    expect(decisao.acao).toBe("manter");
    expect(decisao.ponta).toBe(null);
  });

  it("E. nome fora da convencao nao renomeia nada — lanca antes de decidir", () => {
    expect(() => resolverRenomeacao("sem_prefixo_nenhum", [PONTA_REAL])).toThrow(
      PrefixoInvalidoError,
    );
    expect(() => resolverRenomeacao("20260925093009_Maiuscula", [PONTA_REAL])).toThrow(
      PrefixoInvalidoError,
    );
  });

  it("ignora pastas fora da convencao ao calcular a ponta", () => {
    const decisao = resolverRenomeacao("20260909010101_novo", [PONTA_REAL, "migration_lock.toml"]);
    expect(decisao.para).toBe("20260925093009_novo");
  });
});

describe("F. ordenacao final no disco", () => {
  it("depois do rename a migration nova e a ultima em ordem lexicografica", () => {
    const historico = [
      "20260815090000_items_and_uom",
      "20260909090000_opening_balance",
      PONTA_REAL,
    ];
    const gerada = "20260909010101_quote_delivery_schedule";
    const raiz = fixture([...historico, gerada]);

    const decisao = resolverRenomeacao(gerada, historico);
    renameSync(join(raiz, decisao.de), join(raiz, decisao.para));

    const finais = migrationsValidas(readdirSync(raiz));
    expect(finais[finais.length - 1]).toBe(decisao.para);
    expect(maiorPrefixo(finais)).toBe(decisao.prefixo);
    // E a cadeia inteira segue estritamente crescente.
    for (let i = 1; i < finais.length; i += 1) {
      expect(finais[i]! > finais[i - 1]!).toBe(true);
    }
  });

  it("E. o alvo do rename e sempre livre: nada existente e sobrescrito", () => {
    const historico = [PONTA_REAL, "20260925093009_ja_ocupado"];
    const raiz = fixture([...historico, "20260909010101_novo"]);

    const decisao = resolverRenomeacao("20260909010101_novo", historico);
    expect(readdirSync(raiz)).not.toContain(decisao.para);
    renameSync(join(raiz, decisao.de), join(raiz, decisao.para));

    expect(readdirSync(raiz)).toContain("20260925093009_ja_ocupado");
    expect(readdirSync(raiz)).toHaveLength(3);
  });
});

describe("sanitizarNome", () => {
  it("normaliza para o padrao ja adotado pelo repositorio", () => {
    expect(sanitizarNome("quote_delivery_schedule")).toBe("quote_delivery_schedule");
    expect(sanitizarNome("Quote Delivery Schedule")).toBe("quote_delivery_schedule");
    expect(sanitizarNome("  add--column  ")).toBe("add_column");
  });

  it("recusa nome que nao sobra nada, antes de qualquer efeito colateral", () => {
    expect(() => sanitizarNome("   ")).toThrow(PrefixoInvalidoError);
    expect(() => sanitizarNome("///")).toThrow(PrefixoInvalidoError);
    expect(() => sanitizarNome(undefined)).toThrow(PrefixoInvalidoError);
  });
});

describe("a cadeia real do repositorio", () => {
  /*
   * Um par historico compartilha o prefixo `20260904090000`
   * (`component_quantity_mode` e `gmp_production_execution`). Nao quebra
   * nada — o `migrate deploy` ordena pelo NOME inteiro, e os dois sufixos
   * ordenam de forma deterministica —, e migration ja publicada nunca e
   * renomeada para arrumar a sequencia. Fica listado para que um empate NOVO
   * reprove: `proximoPrefixoLivre` existe justamente para nao criar outro.
   */
  const DUPLICATA_HISTORICA = ["20260904090000"];

  it("nao ganha prefixo repetido novo", () => {
    const validas = migrationsValidas(readdirSync(MIGRATIONS_REAIS));
    const prefixos = validas.map((nome) => partesDaPasta(nome)!.prefixo);
    const repetidos = [...new Set(prefixos.filter((p, i) => prefixos.indexOf(p) !== i))];
    expect(repetidos).toEqual(DUPLICATA_HISTORICA);
  });

  it("e estritamente crescente, e a ponta e a maior", () => {
    const validas = migrationsValidas(readdirSync(MIGRATIONS_REAIS));
    expect(validas.length).toBeGreaterThan(40);
    for (let i = 1; i < validas.length; i += 1) {
      expect(validas[i]! > validas[i - 1]!).toBe(true);
    }
    expect(maiorPrefixo(validas)).toBe(partesDaPasta(validas[validas.length - 1]!)!.prefixo);
  });

  it("a proxima migration criada hoje ficaria depois da ponta", () => {
    const validas = migrationsValidas(readdirSync(MIGRATIONS_REAIS));
    const ponta = maiorPrefixo(validas)!;
    // O carimbo do relogio real — o que o Prisma geraria sozinho.
    const agora = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const decisao = resolverRenomeacao(`${agora}_com_04_delivery_schedule`, validas);
    expect(decisao.prefixo > ponta).toBe(true);
    expect(proximoPrefixoLivre(ponta, validas) > ponta).toBe(true);
  });
});
