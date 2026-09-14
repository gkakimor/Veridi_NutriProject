import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { z, type ZodTypeAny } from "zod";
import { booleanoDeConsultaSchema } from "./boolean-schema.js";
import { inteiroDeConsultaSchema } from "./integer-schema.js";

/**
 * Guarda de API-STRICT-SCALAR-CONTRACT-WAVE-01, QUERY-BOOLEAN-STRICTNESS-WAVE-02 e
 * QUERY-BOOLEAN-PERMISSIVE-REMAINING-01.
 *
 * - inteiro não volta a ler `z.coerce.number().int()` — `Number()` aceita
 *   `"1e1"`, `"0x10"`, `"+1"` e `true`; a leitura é `inteiroDecimalSchema`;
 * - booleano não volta a ler `z.coerce.boolean()` — `Boolean("false")` é
 *   `true`; a leitura de query é `booleanoDeConsultaSchema`;
 * - booleano de URL aceita `"true"`/`"false"` e nada mais. A guarda não
 *   procura o jeito de escrever o parser: pergunta a cada campo de cada schema
 *   exportado o que ele aceita. Fora dos schemas, ninguém compara texto com
 *   `"true"` à mão.
 *
 * Comentário não conta: vários fontes citam o nome antigo para explicar por
 * que ele saiu.
 */

const RAIZ = join(import.meta.dirname, "..");

/**
 * Único uso legítimo: porta lida da variável de ambiente no boot. Não é
 * entrada HTTP e não é gravada.
 */
const PERMITIDOS = new Map([["config/env.ts", 2]]);

const COERCAO_BOOLEANA = /\bz\s*\.\s*coerce\s*\.\s*boolean\s*\(/g;
/** `z.coerce.number()` e a cadeia de chamadas que vem colada nele, em uma ou várias linhas. */
const COERCAO_NUMERICA = /\bz\s*\.\s*coerce\s*\.\s*number\s*\(\s*\)((?:\s*\.\s*\w+\s*\((?:[^()]|\([^()]*\))*\))*)/g;

function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\"'`])\/\/.*$/gm, "$1");
}

function inteirosPorCoercao(fonte: string): number {
  return [...semComentarios(fonte).matchAll(COERCAO_NUMERICA)].filter((achado) =>
    /\.\s*int\s*\(/.test(achado[1] ?? ""),
  ).length;
}

function booleanosPorCoercao(fonte: string): number {
  return semComentarios(fonte).match(COERCAO_BOOLEANA)?.length ?? 0;
}

function fontesDeProducao(diretorio: string): string[] {
  return readdirSync(diretorio, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(diretorio, entrada.name);
    if (entrada.isDirectory()) return fontesDeProducao(caminho);
    return entrada.name.endsWith(".ts") && !entrada.name.includes(".test.") ? [caminho] : [];
  });
}

const nomeDe = (arquivo: string) => relative(RAIZ, arquivo).replace(/\\/g, "/");

/* ── Booleano de URL ── */

/** Textos que chegam pela URL. Só os dois primeiros são booleano. */
const TEXTOS_DE_URL = ["true", "false", "1", "0", "yes", "no", "on", "off", "abc", "", " ", "TRUE", "False", " true", "false "];

type Classe = "STRICT_OK" | "LEGACY_EXPLICIT" | "PERMISSIVE_BUG";

/**
 * `null` quando nenhum texto de URL vira booleano no campo — `z.boolean()` de
 * corpo, texto, número. Senão, pelo que o campo aceita: só `"true"`/`"false"`
 * é STRICT_OK; `"1"`/`"0"` a mais é LEGACY_EXPLICIT; qualquer outro texto
 * aceito é PERMISSIVE_BUG.
 */
function classificar(campo: ZodTypeAny): Classe | null {
  const lidos = TEXTOS_DE_URL.map((texto) => ({ texto, resultado: campo.safeParse(texto) }));
  if (!lidos.some(({ resultado }) => resultado.success && typeof resultado.data === "boolean")) return null;
  const aceitos = lidos.filter(({ resultado }) => resultado.success).map(({ texto }) => texto);
  if (aceitos.every((texto) => texto === "true" || texto === "false")) return "STRICT_OK";
  if (aceitos.every((texto) => ["true", "false", "1", "0"].includes(texto))) return "LEGACY_EXPLICIT";
  return "PERMISSIVE_BUG";
}

/** Objeto de consulta exportado, com ou sem `superRefine`/`preprocess` por fora. */
function objetoDe(valor: unknown): z.AnyZodObject | null {
  let atual = valor;
  while (atual instanceof z.ZodEffects) atual = atual.innerType();
  return atual instanceof z.ZodObject ? atual : null;
}

type Achado = { id: string; classe: Classe };

/** Todo campo booleano de URL dos schemas exportados, com a classe — `arquivo#schema.campo`. */
async function booleanosDeUrl(arquivos: string[]): Promise<Achado[]> {
  const achados: Achado[] = [];
  for (const arquivo of arquivos) {
    const modulo = (await import(pathToFileURL(arquivo).href)) as Record<string, unknown>;
    for (const [exportado, valor] of Object.entries(modulo)) {
      const objeto = objetoDe(valor);
      if (!objeto) continue;
      for (const [campo, schema] of Object.entries(objeto.shape as Record<string, ZodTypeAny>)) {
        const classe = classificar(schema);
        if (classe) achados.push({ id: `${nomeDe(arquivo)}#${exportado}.${campo}`, classe });
      }
    }
  }
  return achados;
}

/** Aceitam `"1"`/`"0"` de propósito, com o contrato escrito no schema. */
const LEGADO_EXPLICITO = new Map([
  [
    "modules/production-orders/production-orders.schemas.ts#listProductionOrdersQuerySchema.semRoteiro",
    "`?semRoteiro=1` é o link do Dashboard e do Quadro; a lista de OPs manda 1/0",
  ],
  [
    "modules/production-profiles/production-profiles.schemas.ts#listProductionProfilesQuerySchema.activeOnly",
    "`true`/`1` escritos no schema; a tela manda `true`",
  ],
]);

/*
 * Sem lista de dívida permissiva: QUERY-BOOLEAN-PERMISSIVE-REMAINING-01 fechou
 * a última. Campo que aceite texto fora de `"true"`/`"false"` (e do `1`/`0`
 * declarado acima) reprova, sem lugar para escondê-lo.
 */

/**
 * Liam todo texto fora de `"true"` como `false`, calados, até
 * QUERY-BOOLEAN-PERMISSIVE-REMAINING-01. `includeArchived` nem tinha schema:
 * a rota comparava `request.query` com `"true"` à mão.
 */
const CORRIGIDOS = [
  "modules/quality/quality.schemas.ts#listQualityQueueQuerySchema.onlyPending",
  "modules/quality/quality.schemas.ts#listQualityQueueQuerySchema.onlyWithBalance",
  "modules/users/users.schemas.ts#listUsersQuerySchema.active",
  "modules/cost-templates/cost-templates.schemas.ts#listTemplatesQuerySchema.archived",
  // Herda o `archived` acima por `.extend` — a busca por texto não o achava.
  "modules/cost-templates/cost-templates.schemas.ts#listPricingPoliciesQuerySchema.archived",
  "modules/formulation-templates/formulation-templates.schemas.ts#listFormulationTemplatesQuerySchema.archived",
  "modules/attachments/attachments.schemas.ts#listAttachmentsQuerySchema.includeArchived",
];

/** `x === "true"`, `"false" !== x` — texto de URL comparado à mão. */
const COMPARACAO_COM_TEXTO_BOOLEANO = /[!=]==?\s*(["'`])(?:true|false)\1|(["'`])(?:true|false)\2\s*[!=]==?/g;
/** `["false", "0", …].includes(x)` — a lista de falsos do antigo `booleanFlag`. */
const LISTA_DE_TEXTO_BOOLEANO = /\[[^\]]*(["'`])(?:true|false)\1[^\]]*\]\s*\.\s*includes\s*\(/g;

function leiturasCruasDeBooleano(fonte: string): number {
  const codigo = semComentarios(fonte);
  return (
    (codigo.match(COMPARACAO_COM_TEXTO_BOOLEANO)?.length ?? 0) + (codigo.match(LISTA_DE_TEXTO_BOOLEANO)?.length ?? 0)
  );
}

/** Fora dos `*.schemas.ts`, que a varredura interroga campo a campo, só estes comparam texto booleano. */
const LEITURA_CRUA_PERMITIDA = new Map([
  // O próprio contrato — e mais ninguém.
  ["lib/boolean-schema.ts", 2],
]);

describe("a guarda pega a coerção e só ela", () => {
  it("inteiro por coerção, em uma linha ou em cadeia quebrada", () => {
    expect(inteirosPorCoercao("const a = z.coerce.number().int();")).toBe(1);
    expect(inteirosPorCoercao('x: z.coerce.number().min(1, "a, b").int("Inteiro").max(9),')).toBe(1);
    expect(inteirosPorCoercao('const a = z.coerce\n  .number()\n  .int("Informe")\n  .min(0);')).toBe(1);
  });

  it("não pega o que não é inteiro por coerção", () => {
    expect(inteirosPorCoercao('const a = inteiroDecimalSchema("x").pipe(z.number().int().min(1));')).toBe(0);
    expect(inteirosPorCoercao("const a = z.number().int();")).toBe(0);
    expect(inteirosPorCoercao("const a = z.coerce.number().min(0);\nconst b = z.number().int();")).toBe(0);
    expect(inteirosPorCoercao("/** Substituto de `z.coerce.number().int()` */\nconst a = 1;")).toBe(0);
    expect(inteirosPorCoercao("// antes: z.coerce.number().int()\nconst a = 1;")).toBe(0);
  });

  it("booleano por coerção", () => {
    expect(booleanosPorCoercao("onlyWithStock: z.coerce.boolean().optional(),")).toBe(1);
    expect(booleanosPorCoercao("a: z.coerce\n  .boolean(),")).toBe(1);
    expect(booleanosPorCoercao("onlyWithStock: booleanoDeConsultaSchema().optional(),")).toBe(0);
    expect(booleanosPorCoercao("active: z.boolean().optional(),")).toBe(0);
    expect(booleanosPorCoercao("/** `z.coerce.boolean()` não serve aqui */")).toBe(0);
  });
});

describe("booleano de URL — a guarda classifica pelo que o campo aceita", () => {
  const CASOS: [string, ZodTypeAny, Classe][] = [
    ["booleanoDeConsultaSchema", booleanoDeConsultaSchema(), "STRICT_OK"],
    ["booleanoDeConsultaSchema com padrão", booleanoDeConsultaSchema().default(true), "STRICT_OK"],
    [
      'z.enum(["true", "false"])',
      z.enum(["true", "false"]).optional().transform((valor) => valor === "true"),
      "STRICT_OK",
    ],
    [
      "enum com 1/0, como semRoteiro",
      z.enum(["1", "0", "true", "false"]).optional().transform((valor) => valor === "1" || valor === "true"),
      "LEGACY_EXPLICIT",
    ],
    ["z.coerce.boolean()", z.coerce.boolean(), "PERMISSIVE_BUG"],
    [
      "lista de falsos do antigo booleanFlag",
      z
        .union([z.boolean(), z.string()])
        .default(false)
        .transform((valor) =>
          typeof valor === "boolean" ? valor : !["false", "0", "no", ""].includes(valor.trim().toLowerCase()),
        ),
      "PERMISSIVE_BUG",
    ],
    [
      '=== "true" sem enum',
      z
        .union([z.string(), z.boolean()])
        .optional()
        .transform((valor) => (typeof valor === "string" ? valor === "true" : (valor ?? false))),
      "PERMISSIVE_BUG",
    ],
  ];

  it.each(CASOS)("%s é %s", (_nome, campo, classe) => {
    expect(classificar(campo)).toBe(classe);
  });

  it("não é booleano de URL: z.boolean() de corpo, texto e inteiro de consulta", () => {
    expect(classificar(z.boolean().optional())).toBeNull();
    expect(classificar(z.string().trim().min(1).optional())).toBeNull();
    expect(classificar(inteiroDeConsultaSchema({ minimo: 1, padrao: 1 }))).toBeNull();
  });

  it("leitura crua de texto booleano, e só ela", () => {
    expect(leiturasCruasDeBooleano('{ includeArchived: includeArchived === "true" }')).toBe(1);
    expect(leiturasCruasDeBooleano("if ('false' !== valor) return;")).toBe(1);
    expect(leiturasCruasDeBooleano('const ligado = !["false", "0", "no", ""].includes(valor);')).toBe(1);
    expect(leiturasCruasDeBooleano('const rotulo = { label: "true" };')).toBe(0);
    expect(leiturasCruasDeBooleano("const ligado = valor === true;")).toBe(0);
    expect(leiturasCruasDeBooleano('// antes: valor === "true"\nconst a = 1;')).toBe(0);
  });
});

describe("fontes de produção da API", () => {
  const arquivos = fontesDeProducao(RAIZ);
  const fontes = arquivos.map((arquivo) => ({ nome: nomeDe(arquivo), texto: readFileSync(arquivo, "utf8") }));

  it("nenhum inteiro lê z.coerce.number().int() fora da lista de permitidos", () => {
    const achados = fontes
      .map(({ nome, texto }) => ({ nome, total: inteirosPorCoercao(texto) }))
      .filter(({ nome, total }) => total > 0 && total !== PERMITIDOS.get(nome));
    expect(achados).toEqual([]);
  });

  it("a lista de permitidos não envelhece", () => {
    for (const [nome, total] of PERMITIDOS) {
      const fonte = fontes.find((arquivo) => arquivo.nome === nome);
      expect(fonte, nome).toBeDefined();
      expect(inteirosPorCoercao(fonte!.texto), nome).toBe(total);
    }
  });

  it("nenhum booleano lê z.coerce.boolean()", () => {
    const achados = fontes.filter(({ texto }) => booleanosPorCoercao(texto) > 0).map(({ nome }) => nome);
    expect(achados).toEqual([]);
  });

  describe("booleano de URL", () => {
    let achados: Achado[] = [];

    beforeAll(async () => {
      achados = await booleanosDeUrl(arquivos.filter((arquivo) => arquivo.endsWith(".schemas.ts")));
    });

    it("a varredura lê os schemas de verdade: os booleanos conhecidos estão nela", () => {
      expect(achados.map(({ id }) => id)).toEqual(
        expect.arrayContaining([
          "modules/inventory/inventory.schemas.ts#listInventoryQuerySchema.onlyWithStock",
          "modules/inventory/inventory.schemas.ts#listCustomerMaterialsQuerySchema.onlyWithBalance",
          "modules/reports/reports.schemas.ts#inventoryPositionQuerySchema.onlyWithBalance",
          "modules/reports/reports.schemas.ts#inventoryPositionQuerySchema.all",
          "modules/reports/reports.schemas.ts#expiryQuerySchema.onlyWithBalance",
          "modules/reports/reports.schemas.ts#requirementsQuerySchema.onlyShortage",
          "modules/reports/reports.schemas.ts#plannedActualQuerySchema.includeCost",
          "modules/items/items.schemas.ts#listItemsQuerySchema.active",
        ]),
      );
    });

    it("nenhum booleano de URL aceita texto arbitrário — não há dívida permissiva", () => {
      expect(achados.filter(({ classe }) => classe === "PERMISSIVE_BUG")).toEqual([]);
    });

    it('todo booleano de URL é "true"/"false" exato; `1`/`0` só no legado explícito', () => {
      const fora = achados.filter(
        ({ id, classe }) => classe !== "STRICT_OK" && !(classe === "LEGACY_EXPLICIT" && LEGADO_EXPLICITO.has(id)),
      );
      expect(fora).toEqual([]);
    });

    it("o legado explícito não envelhece", () => {
      const classeDe = new Map(achados.map(({ id, classe }) => [id, classe]));
      for (const id of LEGADO_EXPLICITO.keys()) expect(classeDe.get(id), id).toBe("LEGACY_EXPLICIT");
    });

    it("os corrigidos em QUERY-BOOLEAN-PERMISSIVE-REMAINING-01 estão na varredura, estritos", () => {
      const classeDe = new Map(achados.map(({ id, classe }) => [id, classe]));
      for (const id of CORRIGIDOS) expect(classeDe.get(id), id).toBe("STRICT_OK");
    });
  });

  it("fora dos schemas, ninguém compara texto booleano à mão além dos permitidos", () => {
    const leituras = fontes
      .filter(({ nome }) => !nome.endsWith(".schemas.ts"))
      .map(({ nome, texto }) => ({ nome, total: leiturasCruasDeBooleano(texto) }));
    expect(leituras.filter(({ nome, total }) => total > 0 && total !== LEITURA_CRUA_PERMITIDA.get(nome))).toEqual([]);
    for (const [nome, total] of LEITURA_CRUA_PERMITIDA) {
      expect(leituras.find((leitura) => leitura.nome === nome)?.total, nome).toBe(total);
    }
  });
});
