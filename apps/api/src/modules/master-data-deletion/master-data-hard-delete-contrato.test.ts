import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RouteOptions } from "fastify";
import { MasterDataEntityType as TipoNoBanco } from "@prisma/client";
import { MASTER_DATA_DELETION_PATHS, MASTER_DATA_ENTITY_TYPES } from "@veridi/shared";
import { buildApp } from "../../app.js";
import { getPrisma } from "../../db/prisma.js";
import { AGREGADOS } from "./catalogo-de-exclusao.js";
import { REGRAS_DA_V1 } from "./filhos-tecnicos.js";
import { conferirCatalogo, lerChavesReais, lerColunasReais } from "./master-data-deletion.service.js";
import type { ChaveReal, ColunaReal } from "./master-data-deletion.service.js";
import { CAMPOS_DA_RAIZ, CAMPOS_DA_V1 } from "./retrato-da-exclusao.js";

/**
 * Contrato da exclusão física de cadastro mestre (MASTER-DATA-HARD-DELETE-01 e
 * -02).
 *
 *  - as ÚNICAS rotas de exclusão física de cadastro mestre são as do módulo
 *    `master-data-deletion`, com a guarda — Item, Produto e Recurso industrial
 *    entraram na Fatia 2 pela mesma porta; Usuário nunca;
 *  - o catálogo explícito bate com o banco REAL (o `_test`, com a cadeia de
 *    migrations inteira): migration que acrescentar chave estrangeira para um
 *    agregado sem catalogá-la derruba este teste antes de chegar à tela;
 *  - a regra da V1 classifica TODA coluna das tabelas de versão;
 *  - o rastro é append-only: nenhum código fora de teste o altera ou apaga.
 */

let rotas: RouteOptions[] = [];
let chaves: ChaveReal[] = [];
let colunas: ColunaReal[] = [];
const app = buildApp();

beforeAll(async () => {
  app.addHook("onRoute", (rota) => {
    rotas.push(rota);
  });
  await app.ready();
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    chaves = await lerChavesReais(tx);
    colunas = await lerColunasReais(tx);
  });
});

afterAll(async () => {
  rotas = [];
  await app.close();
});

const metodos = (rota: RouteOptions): string[] => (Array.isArray(rota.method) ? rota.method : [rota.method]);

describe("rotas", () => {
  it("toda rota DELETE da API está na lista conhecida — as de cadastro mestre são só as nove guardadas", () => {
    const deletes = rotas
      .filter((rota) => metodos(rota).includes("DELETE"))
      .map((rota) => rota.url)
      .sort();
    const guardadas = MASTER_DATA_ENTITY_TYPES.map((tipo) => `${MASTER_DATA_DELETION_PATHS[tipo]}/:id`);
    // Linhas de rascunho e configuração (discovery, seção 5) — nenhuma é cadastro mestre.
    const deRascunho = [
      "/industrial-cost-calculations/:id",
      "/industrial-cost-lines/:id",
      "/industrial-cost-resource-usages/:id",
      "/pricing-tiers/:id",
      "/production-calendar/exceptions/:id",
      "/production-orders/:id/schedule",
      "/project-products/:id",
      "/quote-lines/:id",
    ];
    expect(deletes).toEqual([...guardadas, ...deRascunho].sort());
  });

  it("o enum do rastro é exatamente a lista dos nove — a Fatia 2 usou os valores reservados, sem migration", () => {
    expect(Object.values(TipoNoBanco)).toEqual([...MASTER_DATA_ENTITY_TYPES]);
    expect(MASTER_DATA_ENTITY_TYPES.slice(-3)).toEqual(["ITEM", "PRODUCT", "INDUSTRIAL_RESOURCE"]);
  });

  it("Usuário nunca tem exclusão física", () => {
    const deletes = new Set(rotas.filter((rota) => metodos(rota).includes("DELETE")).map((rota) => rota.url));
    expect(deletes.has("/users/:id")).toBe(false);
  });

  it("cada cadastro tem prévia e exclusão — Item, Produto e Recurso industrial inclusive", () => {
    for (const tipo of MASTER_DATA_ENTITY_TYPES) {
      const base = MASTER_DATA_DELETION_PATHS[tipo];
      expect(app.hasRoute({ method: "GET", url: `${base}/:id/deletion-check` }), tipo).toBe(true);
      expect(app.hasRoute({ method: "DELETE", url: `${base}/:id` }), tipo).toBe(true);
    }
    expect(MASTER_DATA_DELETION_PATHS.ITEM).toBe("/items");
    expect(MASTER_DATA_DELETION_PATHS.PRODUCT).toBe("/products");
    expect(MASTER_DATA_DELETION_PATHS.INDUSTRIAL_RESOURCE).toBe("/industrial-resources");
  });

  it("o rastro não tem rota — nem de leitura, nem de alteração, nem de restauração", () => {
    // Tudo que fala de exclusão na API é a prévia dos nove — e só GET.
    const daExclusao = rotas
      .filter((rota) => /deletion|master-data/i.test(rota.url))
      .flatMap((rota) => metodos(rota).map((metodo) => `${metodo} ${rota.url}`))
      .filter((rota) => !rota.startsWith("HEAD "))
      .sort();
    expect(daExclusao).toEqual(
      MASTER_DATA_ENTITY_TYPES.map((tipo) => `GET ${MASTER_DATA_DELETION_PATHS[tipo]}/:id/deletion-check`).sort(),
    );
  });
});

describe("catálogo × banco real", () => {
  it.each(MASTER_DATA_ENTITY_TYPES)("%s: o catálogo bate com o pg_constraint e com as colunas", (tipo) => {
    expect(conferirCatalogo(AGREGADOS[tipo], chaves, colunas)).toEqual([]);
  });

  it("o Produto leva o Item de produto acabado como vinculado — pela chave 1:1 real, SET NULL, julgado pelo catálogo do Item", () => {
    expect(AGREGADOS.PRODUCT.vinculados).toEqual([
      expect.objectContaining({ coluna: "finishedProductItemId", tipo: "ITEM", tabela: AGREGADOS.ITEM.tabela, acao: "n" }),
    ]);
    expect(chaves).toContainEqual({ tabela: "products", coluna: "finishedProductItemId", alvo: "items", acao: "n" });
    // A mesma chave é USO para o Item sozinho: o PA nunca sai pela tela de Itens.
    expect(AGREGADOS.ITEM.referencias).toContainEqual(
      expect.objectContaining({ tipo: "fk", tabela: "products", coluna: "finishedProductItemId", alvo: "items" }),
    );
    // Nenhum outro agregado tem vinculado.
    for (const tipo of MASTER_DATA_ENTITY_TYPES.filter((t) => t !== "PRODUCT")) {
      expect(AGREGADOS[tipo].vinculados ?? [], tipo).toEqual([]);
    }
  });
  it("toda chave estrangeira que chega a uma tabela de agregado está no catálogo dele", () => {
    const deAgregado = new Map<string, string>();
    for (const tipo of MASTER_DATA_ENTITY_TYPES) {
      const agregado = AGREGADOS[tipo];
      deAgregado.set(agregado.tabela, tipo);
      for (const interna of agregado.internas) deAgregado.set(interna.tabela, tipo);
    }
    const chegando = chaves.filter((chave) => deAgregado.has(chave.alvo));
    expect(chegando.length).toBeGreaterThan(20);
    for (const chave of chegando) {
      const agregado = AGREGADOS[deAgregado.get(chave.alvo) as keyof typeof AGREGADOS];
      const conhecida =
        agregado.internas.some((i) => i.tabela === chave.tabela && i.coluna === chave.coluna && i.pai === chave.alvo) ||
        agregado.chavesInternas.some((c) => c.tabela === chave.tabela && c.coluna === chave.coluna && c.alvo === chave.alvo) ||
        agregado.referencias.some(
          (r) => r.tipo === "fk" && r.tabela === chave.tabela && r.coluna === chave.coluna && r.alvo === chave.alvo,
        );
      expect(conhecida, `${chave.tabela}.${chave.coluna} → ${chave.alvo}`).toBe(true);
    }
  });

  it.each(Object.entries(REGRAS_DA_V1))("%s: a regra da V1 classifica toda coluna da tabela de versões", (_tipo, regra) => {
    const reais = colunas.filter((coluna) => coluna.tabela === regra!.tabelaDeVersoes).map((coluna) => coluna.coluna);
    const classificadas = [...regra!.livres, ...Object.keys(regra!.padroes)];
    expect([...reais].sort()).toEqual([...new Set(classificadas)].sort());
  });

  it.each(MASTER_DATA_ENTITY_TYPES)("%s: o retrato só cita colunas que existem", (tipo) => {
    const agregado = AGREGADOS[tipo];
    const daRaiz = new Set(colunas.filter((c) => c.tabela === agregado.tabela).map((c) => c.coluna));
    for (const campo of CAMPOS_DA_RAIZ[tipo]) expect(daRaiz.has(campo), `${agregado.tabela}.${campo}`).toBe(true);
    const regra = REGRAS_DA_V1[tipo];
    if (regra) {
      const daVersao = new Set(colunas.filter((c) => c.tabela === regra.tabelaDeVersoes).map((c) => c.coluna));
      for (const campo of CAMPOS_DA_V1[tipo] ?? []) expect(daVersao.has(campo), `${regra.tabelaDeVersoes}.${campo}`).toBe(true);
    }
  });

  it("as regras da raiz (PA nunca sozinho, Produto nascido de Projeto) leem colunas que existem", () => {
    const existe = (tabela: string, coluna: string) => colunas.some((c) => c.tabela === tabela && c.coluna === coluna);
    expect(existe("items", "type")).toBe(true);
    expect(existe("products", "originProjectId")).toBe(true);
    expect(existe("products", "finishedProductItemId")).toBe(true);
  });

  it("o retrato nunca leva contato, endereço, observação nem descrição", () => {
    const proibidos = ["email", "phone", "street", "number", "complement", "district", "zipCode", "city", "state", "notes", "description"];
    for (const tipo of MASTER_DATA_ENTITY_TYPES) {
      for (const campo of [...CAMPOS_DA_RAIZ[tipo], ...(CAMPOS_DA_V1[tipo] ?? [])]) {
        expect(proibidos, `${tipo}.${campo}`).not.toContain(campo);
      }
    }
  });
});

describe("rastro append-only", () => {
  const RAIZ = fileURLToPath(new URL("../../../../../", import.meta.url));

  function arquivos(pasta: string): string[] {
    return readdirSync(pasta).flatMap((nome) => {
      if (nome === "node_modules" || nome === "dist") return [];
      const caminho = join(pasta, nome);
      if (statSync(caminho).isDirectory()) return arquivos(caminho);
      return /\.(ts|tsx|mjs|js)$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
    });
  }

  it("nenhum código fora de teste altera ou apaga uma linha do rastro", () => {
    const alterar = /masterDataDeletionHistory\s*\.\s*(update|updateMany|upsert|delete|deleteMany)\b/;
    const sql = /(UPDATE|DELETE\s+FROM|TRUNCATE)\s+"?master_data_deletion_history/i;
    const fontes = [...arquivos(join(RAIZ, "apps", "api", "src")), ...arquivos(join(RAIZ, "scripts"))];
    expect(fontes.length).toBeGreaterThan(100);
    const culpados = fontes.filter((arquivo) => {
      const texto = readFileSync(arquivo, "utf8");
      return alterar.test(texto) || sql.test(texto);
    });
    expect(culpados).toEqual([]);
  });

  it("o serviço só cria linha no rastro", () => {
    const servico = readFileSync(
      fileURLToPath(new URL("./master-data-deletion.service.ts", import.meta.url)),
      "utf8",
    );
    const usos = [...servico.matchAll(/masterDataDeletionHistory\s*\.\s*(\w+)/g)].map((uso) => uso[1]);
    expect(usos).toEqual(["create"]);
  });
});
