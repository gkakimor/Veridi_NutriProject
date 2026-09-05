import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Um banco VAZIO precisa conseguir aplicar as migrations na ordem dos nomes.
 *
 * `prisma migrate deploy` aplica as pendentes em ordem lexicográfica de pasta.
 * Num banco que já existe isso nunca dói — ele só aplica o que falta, na ordem
 * em que as pastas foram chegando. Num banco novo (clone, staging, restauração
 * sem dump) a ordem dos nomes é a ordem real, e uma migration que altera uma
 * tabela criada por outra de nome MAIOR quebra ali. Foi o que aconteceu com
 * `20260904093000_template_component_quantity_mode`: alterava
 * `formulation_template_components`, criada só em `20260921090000`, e
 * produção nem percebeu porque lá a ordem de chegada era outra.
 *
 * Este teste é a versão estática, barata, da prova em banco descartável
 * (`pnpm validate:migrations:fresh`): lê o SQL de cada migration e exige que
 * toda tabela, tipo e coluna referidos já existam numa migration de nome
 * menor ou igual. Não roda banco nenhum.
 */

const MIGRATIONS_DIR = join(process.cwd(), "apps", "api", "prisma", "migrations");

const semComentarios = (sql: string) => sql.replace(/--[^\n]*/g, "");

const TIPOS_NATIVOS = new Set([
  "TEXT", "BOOLEAN", "INTEGER", "DECIMAL", "TIMESTAMP", "VARCHAR", "JSONB", "JSON", "SERIAL",
  "BIGINT", "DOUBLE", "DATE", "NUMERIC", "CHAR", "UUID", "INT", "REAL", "SMALLINT", "BIGSERIAL",
]);

interface Objetos {
  tabelas: Map<string, string>;
  tipos: Map<string, string>;
  colunas: Map<string, Map<string, string>>;
}

interface Referencia {
  migration: string;
  tipo: "tabela" | "tipo" | "coluna";
  alvo: string;
}

/** Percorre as migrations em ordem, registrando o que cada uma cria e o que ela usa. */
function auditar(): { pastas: string[]; fora: string[] } {
  const pastas = readdirSync(MIGRATIONS_DIR).filter((nome) => /^\d{14}_/.test(nome)).sort();
  const objetos: Objetos = { tabelas: new Map(), tipos: new Map(), colunas: new Map() };
  const fora: string[] = [];

  const existe = (criadaEm: string | undefined, atual: string) =>
    criadaEm !== undefined && criadaEm.localeCompare(atual) <= 0;

  for (const pasta of pastas) {
    const sql = semComentarios(readFileSync(join(MIGRATIONS_DIR, pasta, "migration.sql"), "utf8"));
    const referencias: Referencia[] = [];
    const registrarColuna = (tabela: string, coluna: string) => {
      if (!objetos.colunas.has(tabela)) objetos.colunas.set(tabela, new Map());
      objetos.colunas.get(tabela)!.set(coluna, pasta);
    };
    // Só tipo entre aspas conta: o Prisma sempre gera enum como "NomeDoTipo";
    // palavra sem aspas é tipo nativo ou palavra-chave (TEXT, IS NULL…).
    const usaTipo = (tipo: string | undefined) => {
      if (tipo !== undefined && !TIPOS_NATIVOS.has(tipo.toUpperCase())) {
        referencias.push({ migration: pasta, tipo: "tipo", alvo: tipo });
      }
    };

    for (const bruto of sql.split(";")) {
      const st = bruto.trim();
      if (!st) continue;

      let m = st.match(/^CREATE TABLE\s+"?(\w+)"?\s*\(([\s\S]*)\)\s*$/i);
      if (m) {
        const [, tabela, corpo] = m;
        objetos.tabelas.set(tabela!, pasta);
        for (const linha of corpo!.split("\n")) {
          const col = linha.match(/^\s*"(\w+)"\s+(?:"(\w+)"|\w+)/);
          if (col && !/^\s*(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE)/i.test(linha)) {
            registrarColuna(tabela!, col[1]!);
            usaTipo(col[2]);
          }
        }
        for (const fk of corpo!.matchAll(/REFERENCES\s+"?(\w+)"?/gi)) {
          referencias.push({ migration: pasta, tipo: "tabela", alvo: fk[1]! });
        }
        continue;
      }
      m = st.match(/^CREATE TYPE\s+"?(\w+)"?\s+AS ENUM/i);
      if (m) {
        objetos.tipos.set(m[1]!, pasta);
        continue;
      }
      m = st.match(/^CREATE (?:UNIQUE )?INDEX\s+(?:IF NOT EXISTS\s+)?"?\w+"?\s+ON\s+"?(\w+)"?\s*\(([^)]*)\)/i);
      if (m) {
        referencias.push({ migration: pasta, tipo: "tabela", alvo: m[1]! });
        for (const col of m[2]!.matchAll(/"(\w+)"/g)) {
          referencias.push({ migration: pasta, tipo: "coluna", alvo: `${m[1]}.${col[1]}` });
        }
        continue;
      }
      m = st.match(/^ALTER TABLE\s+(?:ONLY\s+)?"?(\w+)"?\s*([\s\S]*)$/i);
      if (m) {
        const [, tabela, corpo] = m;
        referencias.push({ migration: pasta, tipo: "tabela", alvo: tabela! });
        for (const add of corpo!.matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"(\w+)"\s+(?:"(\w+)"|\w+)/gi)) {
          registrarColuna(tabela!, add[1]!);
          usaTipo(add[2]);
        }
        for (const col of corpo!.matchAll(/(?:ALTER|DROP|RENAME) COLUMN\s+"(\w+)"/gi)) {
          referencias.push({ migration: pasta, tipo: "coluna", alvo: `${tabela}.${col[1]}` });
        }
        for (const fk of corpo!.matchAll(/REFERENCES\s+"?(\w+)"?\s*\("?(\w+)"?\)/gi)) {
          referencias.push({ migration: pasta, tipo: "tabela", alvo: fk[1]! });
          referencias.push({ migration: pasta, tipo: "coluna", alvo: `${fk[1]}.${fk[2]}` });
        }
        for (const fk of corpo!.matchAll(/FOREIGN KEY\s*\("(\w+)"\)/gi)) {
          referencias.push({ migration: pasta, tipo: "coluna", alvo: `${tabela}.${fk[1]}` });
        }
        for (const tipo of corpo!.matchAll(/\bTYPE\s+"(\w+)"/g)) usaTipo(tipo[1]!);
        continue;
      }
      m = st.match(/^ALTER TYPE\s+"?(\w+)"?/i);
      if (m) {
        referencias.push({ migration: pasta, tipo: "tipo", alvo: m[1]! });
        continue;
      }
      m = st.match(/^(?:UPDATE|DELETE FROM|INSERT INTO)\s+"?(\w+)"?/i);
      if (m) {
        referencias.push({ migration: pasta, tipo: "tabela", alvo: m[1]! });
        continue;
      }
      // Blocos DO $$ com guarda de existência, DROP IF EXISTS, sequences e
      // funções não criam dependência de ordem que este teste precise vigiar.
    }

    for (const ref of referencias) {
      let criadaEm: string | undefined;
      if (ref.tipo === "tabela") criadaEm = objetos.tabelas.get(ref.alvo);
      else if (ref.tipo === "tipo") criadaEm = objetos.tipos.get(ref.alvo);
      else {
        const [tabela, coluna] = ref.alvo.split(".");
        criadaEm = objetos.colunas.get(tabela!)?.get(coluna!);
      }
      if (!existe(criadaEm, pasta)) {
        fora.push(`${pasta} usa ${ref.tipo} ${ref.alvo} — criado em ${criadaEm ?? "lugar nenhum"}`);
      }
    }
  }
  return { pastas, fora: [...new Set(fora)] };
}

describe("ordem das migrations", () => {
  it("toda migration só usa tabela, tipo e coluna criados numa migration de nome menor ou igual", () => {
    const { pastas, fora } = auditar();
    expect(pastas.length).toBeGreaterThan(40);
    expect(fora).toEqual([]);
  });

  it("os nomes seguem o padrão de carimbo de 14 dígitos", () => {
    const pastas = readdirSync(MIGRATIONS_DIR).filter((nome) => nome !== "migration_lock.toml");
    const foraDoPadrao = pastas.filter((nome) => !/^\d{14}_[a-z0-9_]+$/.test(nome));
    expect(foraDoPadrao).toEqual([]);
  });
});
