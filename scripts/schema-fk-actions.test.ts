import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O `schema.prisma` precisa declarar a MESMA acao de ON DELETE que as
 * migrations escreveram no banco.
 *
 * Foi o BACKLOG #14. Vinte e sete relacoes opcionais nao declaravam
 * `onDelete:`; o Prisma assume `SetNull` nesse caso, e as migrations tinham
 * escrito `ON DELETE RESTRICT`. Nenhuma barreira via: `migrate deploy` aplica
 * o que falta e `migrate status` compara o ledger — nenhum dos dois compara a
 * ESTRUTURA com o modelo. O drift so aparecia em `prisma migrate diff`, que
 * ninguem rodava, e a proxima migration gerada pelo Prisma o carregaria junto,
 * trocando RESTRICT por SET NULL em chaves de rastreabilidade (`billing_lines
 * .lotId`, `shipment_lines.lotId`, `production_consumptions.lotId`) sem
 * ninguem ter decidido isso.
 *
 * A prova completa e `pnpm validate:migrations:fresh`, que reconstroi um banco
 * do zero e exige `migrate diff` vazio contra o modelo. Este teste e a versao
 * estatica e barata dela para a classe que produziu o #14: le o SQL das
 * migrations, apura a acao final de cada chave estrangeira e cobra do
 * `schema.prisma` a declaracao correspondente. Nao roda banco nenhum.
 *
 * Ele NAO decide qual acao e a certa. Trocar RESTRICT por SET NULL em alguma
 * relacao continua sendo decisao de dominio — mas passa a exigir a migration
 * que faca a troca no banco, em vez de acontecer por omissao no modelo.
 */

const RAIZ = process.cwd();
const MIGRATIONS_DIR = join(RAIZ, "apps", "api", "prisma", "migrations");
const SCHEMA = join(RAIZ, "apps", "api", "prisma", "schema.prisma");

/** Acao de ON DELETE no SQL -> nome no DSL do Prisma. */
const ACAO_PRISMA: Record<string, string> = {
  "NO ACTION": "NoAction",
  RESTRICT: "Restrict",
  CASCADE: "Cascade",
  "SET NULL": "SetNull",
  "SET DEFAULT": "SetDefault",
};

interface Fk {
  tabela: string;
  colunas: string[];
  acao: string;
  migration: string;
}

const chave = (tabela: string, colunas: string[]) => `${tabela}(${colunas.join(",")})`;
const listaColunas = (bruto: string) =>
  bruto.split(",").map((c) => c.trim().replace(/^"|"$/g, "")).filter(Boolean);

/**
 * Percorre as migrations em ordem de nome e devolve a acao FINAL de cada FK.
 * Um `DROP CONSTRAINT` remove; um `ADD CONSTRAINT` posterior sobrescreve.
 */
function chavesFinais(): Map<string, Fk> {
  const porChave = new Map<string, Fk>();
  const nomeParaChave = new Map<string, string>();

  const pastas = readdirSync(MIGRATIONS_DIR)
    .filter((p) => statSync(join(MIGRATIONS_DIR, p)).isDirectory())
    .sort();

  for (const pasta of pastas) {
    const sql = readFileSync(join(MIGRATIONS_DIR, pasta, "migration.sql"), "utf8");

    // Statement por statement: metade dos `ADD CONSTRAINT` do repositorio
    // ocupa quatro linhas. Nenhuma migration usa bloco `$$`, entao o `;`
    // separa com seguranca.
    const statements = sql
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);

    for (const linha of statements) {
      const drop = linha.match(/^ALTER TABLE\s+"([^"]+)"\s+DROP CONSTRAINT\s+(?:IF EXISTS\s+)?"([^"]+)"/i);
      if (drop) {
        const alvo = nomeParaChave.get(drop[2]);
        if (alvo) {
          porChave.delete(alvo);
          nomeParaChave.delete(drop[2]);
        }
        continue;
      }

      const add = linha.match(
        /^ALTER TABLE\s+"([^"]+)"\s+ADD CONSTRAINT\s+"([^"]+)"\s+FOREIGN KEY\s*\(([^)]*)\)[\s\S]*?ON DELETE\s+(NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)/i,
      );
      if (add) {
        const [, tabela, nome, colunasBrutas, acao] = add;
        const colunas = listaColunas(colunasBrutas);
        const k = chave(tabela, colunas);
        porChave.set(k, { tabela, colunas, acao: acao.toUpperCase(), migration: pasta });
        nomeParaChave.set(nome, k);
      }
    }
  }

  return porChave;
}

interface Relacao {
  modelo: string;
  tabela: string;
  colunas: string[];
  acaoDeclarada: string | null;
  opcional: boolean;
  linha: number;
}

/** Le o `schema.prisma` e devolve uma entrada por relacao que carrega a FK. */
function relacoesDoModelo(): Relacao[] {
  const linhas = readFileSync(SCHEMA, "utf8").split(/\r?\n/);
  const saida: Relacao[] = [];

  let modelo: string | null = null;
  let inicio = 0;

  for (let i = 0; i < linhas.length; i++) {
    const abre = linhas[i].match(/^model\s+(\w+)\s*\{/);
    if (abre) {
      modelo = abre[1];
      inicio = i;
      continue;
    }
    if (!modelo) continue;

    if (linhas[i].startsWith("}")) {
      // A tabela sai do `@@map`; sem ele, o nome do modelo e o da tabela.
      const bloco = linhas.slice(inicio, i + 1);
      const mapa = bloco.map((l) => l.match(/@@map\("([^"]+)"\)/)).find(Boolean);
      const tabela = mapa ? mapa[1] : modelo;

      for (let j = 0; j < bloco.length; j++) {
        const rel = bloco[j].match(/@relation\(([^\n]*)\)/);
        if (!rel) continue;
        const campos = rel[1].match(/fields:\s*\[([^\]]*)\]/);
        if (!campos) continue;

        const colunas = listaColunas(campos[1]);
        const acao = rel[1].match(/onDelete:\s*(\w+)/);

        // Opcionalidade: o Prisma decide a acao implicita pelo campo escalar.
        const escalar = bloco.find((l) => new RegExp(`^\\s*${colunas[0]}\\s+\\w+`).test(l));
        const opcional = Boolean(escalar && /^\s*\w+\s+\w+\?/.test(escalar));

        saida.push({
          modelo,
          tabela,
          colunas,
          acaoDeclarada: acao ? acao[1] : null,
          opcional,
          linha: inicio + j + 1,
        });
      }
      modelo = null;
    }
  }

  return saida;
}

describe("acoes de ON DELETE: migrations x schema.prisma (BACKLOG #14)", () => {
  const migrations = chavesFinais();
  const relacoes = relacoesDoModelo();

  it("le as duas fontes", () => {
    expect(migrations.size).toBeGreaterThan(150);
    expect(relacoes.length).toBe(migrations.size);
  });

  it("toda FK do banco tem relacao correspondente no modelo", () => {
    const noModelo = new Set(relacoes.map((r) => chave(r.tabela, r.colunas)));
    const orfas = [...migrations.keys()].filter((k) => !noModelo.has(k));
    expect(orfas).toEqual([]);
  });

  it("nenhuma relacao declara acao diferente da que a migration escreveu", () => {
    const divergentes: string[] = [];

    for (const r of relacoes) {
      const fk = migrations.get(chave(r.tabela, r.colunas));
      if (!fk) continue;

      const esperada = ACAO_PRISMA[fk.acao];
      // Sem `onDelete:` o Prisma assume SetNull para relacao opcional e
      // Restrict para obrigatoria. Foi exatamente essa suposicao que criou
      // o #14 — por isso a implicita so passa quando coincide com o banco.
      const efetiva = r.acaoDeclarada ?? (r.opcional ? "SetNull" : "Restrict");

      if (efetiva !== esperada) {
        divergentes.push(
          `${r.modelo}.${r.colunas.join(",")} (schema.prisma:${r.linha}) declara ${efetiva}; ` +
            `${fk.migration} escreveu ON DELETE ${fk.acao}`,
        );
      }
    }

    expect(divergentes).toEqual([]);
  });
});
