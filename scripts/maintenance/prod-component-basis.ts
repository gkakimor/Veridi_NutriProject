import { createRequire } from "node:module";
import type { PrismaClient as Cliente } from "@prisma/client";
import { baseDoComponente } from "../../packages/shared/src/formulations.js";

/**
 * Conferência SOMENTE LEITURA da base do componente contra a regra (§106).
 *
 *   railway run -s Postgres -- pnpm exec tsx scripts/maintenance/prod-component-basis.ts
 *
 * Gate da release que publicar FORMULATION-COMPONENT-BASIS-AUTOMATION-01. Até
 * ela, a Formulação e o Modelo publicados deixam escolher a Base linha a linha,
 * então o banco pode ter linha fora da regra criada à mão. Depois dela:
 *
 *  - rascunho fora da regra é realinhado ao gravar — a Formulação avisa antes,
 *    o Modelo não;
 *  - versão ativa, inativa ou arquivada não muda, mas nova versão, aplicar
 *    Modelo e salvar como Modelo DERIVAM a base na cópia: a quantidade de uma
 *    linha gravada fora da regra passaria a significar outra coisa.
 *
 * Por isso a conferência cobre as duas receitas em TODOS os status, e qualquer
 * divergência é decisão do PO antes de mover `release/prod`. Sai com código 3
 * quando encontra alguma.
 *
 * `.ts` rodado pelo tsx, e não `.mjs` como os vizinhos, para comparar com a
 * função da regra (`baseDoComponente`) pelo fonte do shared — `@veridi/shared`
 * não resolve fora do workspace da API, e um CASE em SQL seria uma segunda
 * implementação dela. O client Prisma é o da API, como nos outros scripts.
 */

type Premissas = Parameters<typeof baseDoComponente>[1];

export interface LinhaGravada extends Premissas {
  receita: "Formulação" | "Modelo";
  /** Código do Produto ou do Modelo, com o número da versão. */
  documento: string;
  status: string;
  itemCode: string;
  itemType: Parameters<typeof baseDoComponente>[0];
  basis: ReturnType<typeof baseDoComponente>;
}

/** As linhas cuja base gravada não é a que a regra dá, com a base da regra. */
export function foraDaRegra(linhas: readonly LinhaGravada[]) {
  return linhas.flatMap((linha) => {
    const regra = baseDoComponente(linha.itemType, linha);
    return regra === linha.basis ? [] : [{ ...linha, regra }];
  });
}

async function lerLinhas(tx: Parameters<Parameters<Cliente["$transaction"]>[0]>[0]) {
  const daFormulacao = await tx.formulationComponent.findMany({
    select: {
      basis: true,
      item: { select: { code: true, type: true } },
      formulationVersion: {
        select: {
          status: true,
          versionNumber: true,
          calculationMode: true,
          dosageForm: true,
          product: { select: { code: true } },
        },
      },
    },
  });
  const doModelo = await tx.formulationTemplateComponent.findMany({
    select: {
      basis: true,
      item: { select: { code: true, type: true } },
      formulationTemplateVersion: {
        select: {
          status: true,
          versionNumber: true,
          calculationMode: true,
          dosageForm: true,
          formulationTemplate: { select: { code: true } },
        },
      },
    },
  });
  return [
    ...daFormulacao.map(({ basis, item, formulationVersion: versao }): LinhaGravada => ({
      receita: "Formulação",
      documento: `${versao.product.code} V${versao.versionNumber}`,
      status: versao.status,
      itemCode: item.code,
      itemType: item.type,
      basis,
      calculationMode: versao.calculationMode,
      dosageForm: versao.dosageForm,
    })),
    ...doModelo.map(({ basis, item, formulationTemplateVersion: versao }): LinhaGravada => ({
      receita: "Modelo",
      documento: `${versao.formulationTemplate.code} V${versao.versionNumber}`,
      status: versao.status,
      itemCode: item.code,
      itemType: item.type,
      basis,
      calculationMode: versao.calculationMode,
      dosageForm: versao.dosageForm,
    })),
  ];
}

async function main() {
  const require = createRequire(process.cwd() + "/apps/api/package.json");
  const { PrismaClient } = require("@prisma/client") as {
    PrismaClient: new (options?: object) => Cliente;
  };
  const url = process.env["DATABASE_PUBLIC_URL"] ?? process.env["DATABASE_URL"];
  if (!url) throw new Error("Sem DATABASE_URL/DATABASE_PUBLIC_URL no ambiente");
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    // Transação READ ONLY: o banco recusa qualquer escrita que escape daqui.
    const linhas = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        return lerLinhas(tx);
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    const divergentes = foraDaRegra(linhas);

    console.log("=== Base do componente × regra (§106) — somente leitura ===");
    const grupos = new Map<string, { linhas: number; fora: number }>();
    for (const linha of linhas) {
      const chave = `${linha.receita.padEnd(11)} ${linha.status.padEnd(9)}`;
      const grupo = grupos.get(chave) ?? { linhas: 0, fora: 0 };
      grupo.linhas += 1;
      grupos.set(chave, grupo);
    }
    for (const linha of divergentes) {
      grupos.get(`${linha.receita.padEnd(11)} ${linha.status.padEnd(9)}`)!.fora += 1;
    }
    // Receita sem linha nenhuma também é dita: silêncio pareceria "não conferida".
    for (const receita of ["Formulação", "Modelo"] as const) {
      if (!linhas.some((linha) => linha.receita === receita)) {
        console.log(`${receita.padEnd(11)} nenhuma linha`);
      }
    }
    for (const [chave, grupo] of [...grupos].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(
        `${chave} ${String(grupo.linhas).padStart(6)} linhas ` +
          `${String(grupo.fora).padStart(5)} fora da regra`,
      );
    }

    if (divergentes.length > 0) {
      console.log("\n=== Fora da regra ===");
      for (const linha of divergentes) {
        console.log(
          `${linha.receita} ${linha.documento} (${linha.status}) · ${linha.itemCode}: ` +
            `gravada ${linha.basis}, regra ${linha.regra}`,
        );
      }
    }
    console.log(`\nFORA DA REGRA: ${divergentes.length}`);
    process.exitCode = divergentes.length > 0 ? 3 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

// Importado (pela conferência da função, por exemplo) não conecta em nada.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/maintenance/prod-component-basis.ts")) {
  main().catch((erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exitCode = 1;
  });
}
