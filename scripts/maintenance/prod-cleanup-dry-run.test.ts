import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  OPCAO_SOMENTE_LEITURA,
  SQL_CONFERIR_SOMENTE_LEITURA,
  urlSomenteLeitura,
} from "./prod-cleanup-somente-leitura.mjs";

/**
 * PROD-CLEANUP-MODEL-CLASSIFICATION-01 — o dry-run não escreve.
 *
 * Sem `--apply`, `prod-cleanup.mjs` conecta com a sessão somente leitura e
 * confere `transaction_read_only` antes de ler qualquer coisa. Aqui o script
 * de verdade roda contra o banco de TESTE da suíte (migrado pelo
 * `globalSetup`, a mesma cadeia de produção): chegar ao fim do dry-run com
 * todas as conferências do catálogo — models, tabelas, sequences, FKs e
 * CASCADE documentado — prova as consultas reais, e a sessão prova que
 * nenhuma escrita teria passado.
 */

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const URL_DO_TESTE = process.env.DATABASE_URL!;

function rodarCleanup(argumentos: string[]): Promise<{ codigo: number | null; saida: string }> {
  // Só o banco de teste: a URL pública (a de produção pelo Railway) venceria a `DATABASE_URL`.
  const { DATABASE_PUBLIC_URL: _publica, ...ambiente } = process.env;
  return new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, ["scripts/maintenance/prod-cleanup.mjs", ...argumentos], {
      cwd: RAIZ,
      env: { ...ambiente, DATABASE_URL: URL_DO_TESTE },
    });
    let saida = "";
    filho.stdout.on("data", (d) => (saida += d));
    filho.stderr.on("data", (d) => (saida += d));
    filho.on("error", reject);
    filho.on("close", (codigo) => resolve({ codigo, saida }));
  });
}

describe("dry-run do prod-cleanup não escreve", () => {
  const somenteLeitura = new PrismaClient({ datasources: { db: { url: urlSomenteLeitura(URL_DO_TESTE) } } });
  afterAll(() => somenteLeitura.$disconnect());

  it("a URL do dry-run mantém os parâmetros e acrescenta a sessão somente leitura por último", () => {
    const url = new URL(urlSomenteLeitura("postgresql://u:s@localhost:5432/veridi?schema=public&options=-c%20search_path%3Dpublic"));
    expect(url.pathname).toBe("/veridi");
    expect(url.searchParams.get("schema")).toBe("public");
    expect(url.searchParams.get("options")).toBe(`-c search_path=public ${OPCAO_SOMENTE_LEITURA}`);
  });

  it("a sessão somente leitura é recusada pelo banco em DELETE e UPDATE", async () => {
    const [sessao] = await somenteLeitura.$queryRawUnsafe<Array<{ somenteLeitura: string }>>(SQL_CONFERIR_SOMENTE_LEITURA);
    expect(sessao?.somenteLeitura).toBe("on");
    // `WHERE false`: mesmo que a sessão falhasse, nada seria alterado.
    await expect(somenteLeitura.$executeRawUnsafe(`DELETE FROM "stock_count_entries" WHERE false`)).rejects.toThrow(
      /read-only transaction/,
    );
    await expect(somenteLeitura.$executeRawUnsafe(`UPDATE "items" SET "name" = "name" WHERE false`)).rejects.toThrow(
      /read-only transaction/,
    );
  });

  it("o script chega ao fim do dry-run em sessão somente leitura, com todas as conferências", async () => {
    // `--reset-sequences`: o plano mais largo — contador incluído, sequences de negócio marcadas para reiniciar.
    const { codigo, saida } = await rodarCleanup(["--reset-sequences"]);
    expect(saida).not.toContain("FALHOU");
    expect(codigo).toBe(0);
    expect(saida).toContain("Sessão: SOMENTE LEITURA (default_transaction_read_only=on)");
    expect(saida).toContain("CONFERÊNCIAS (fail closed");
    expect(saida).toContain("CASCADE em ciclo, documentado, não ordena: stock_count_entries.stock_count_entries_positionId_fkey");
    expect(saida).toMatch(/ItemLabelFileVersion\s+\d+ versão\(ões\).*o objeto no R2 \(ou no disco local\) NÃO é apagado/);
    expect(saida).toContain("Dry run. Nada foi apagado.");
    expect(saida).not.toContain("=== EXECUTANDO");
  });
});
