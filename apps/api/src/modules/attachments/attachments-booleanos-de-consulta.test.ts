import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createAuthenticatedUser } from "../../test-support/authenticated-app.js";
import { getPrisma } from "../../db/prisma.js";

/**
 * QUERY-BOOLEAN-PERMISSIVE-REMAINING-01 — `includeArchived` dos anexos é
 * `"true"` ou `"false"`, exatos.
 *
 * A rota lia `request.query` cru e comparava com `"true"` à mão: todo outro
 * texto virava `false`, calado — `?includeArchived=1` escondia o anexo
 * arquivado. Agora lê `listAttachmentsQuerySchema` (`attachments.schemas.ts`,
 * sobre `booleanoDeConsultaSchema`); o resto é 400. Ausente continua só com
 * os ativos.
 */

type App = ReturnType<typeof buildTestApp>;
type Resposta = { statusCode: number; body: string };

/** Nada disto é booleano de URL — nem o `1` que parecia "sim". */
const RECUSADOS = ["0", "1", "yes", "no", "on", "off", "abc", "", " ", "TRUE", " true", "false "];

const ATIVO = "ativo";
const ARQUIVADO = "arquivado";

let app: App;
const criados = { item: "", lote: "" };
/** id do anexo → rótulo legível na falha. */
const rotulos = new Map<string, string>();

/** Espaço vai como `%20`, nunca `+`. */
function url(query: Record<string, string>): string {
  const pares = Object.entries(query).map(([chave, valor]) => `${chave}=${encodeURIComponent(valor)}`);
  return `/lots/${criados.lote}/attachments${pares.length > 0 ? `?${pares.join("&")}` : ""}`;
}

function anexosDe(corpo: string): string[] {
  return (JSON.parse(corpo) as { attachments: { id: string }[] }).attachments
    .map((anexo) => rotulos.get(anexo.id) ?? anexo.id)
    .sort();
}

async function lista(query: Record<string, string>): Promise<string[]> {
  const resposta = await app.inject({ method: "GET", url: url(query) });
  expect(resposta.statusCode, resposta.body.slice(0, 300)).toBe(200);
  return anexosDe(resposta.body);
}

/** O que a rota fez com o valor: o status e, com 200, os anexos devolvidos. É o que a falha mostra. */
function desfecho(resposta: Resposta): string {
  if (resposta.statusCode !== 200) return String(resposta.statusCode);
  return `200 com ${anexosDe(resposta.body).join(" e ") || "nenhum anexo"}`;
}

beforeAll(async () => {
  const prisma = getPrisma();
  await prisma.unitOfMeasure.upsert({
    where: { code: "kg" },
    update: {},
    create: { code: "kg", label: "Quilograma", dimension: "MASS", toBaseFactor: "1000" },
  });

  const m = `QB${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  const item = await prisma.item.create({
    data: {
      type: "RAW_MATERIAL",
      code: `MP-${m}`,
      name: `Material com anexo ${m}`,
      unitCode: "kg",
      controlsLot: true,
      controlsExpiry: false,
      requiresQualityRelease: false,
      active: true,
    },
  });
  criados.item = item.id;
  const lote = await prisma.lot.create({
    data: {
      code: `LT-${m}`,
      origin: "RECEIPT",
      itemId: item.id,
      initialReceivedQuantity: "10",
      status: "AVAILABLE",
    },
  });
  criados.lote = lote.id;

  // O mesmo usuário que o `buildTestApp` usa na sessão: sai no fim do arquivo, depois dos anexos.
  const { user } = await createAuthenticatedUser("ADMIN");
  for (const [rotulo, arquivado] of [
    [ATIVO, false],
    [ARQUIVADO, true],
  ] as const) {
    // Só o registro: a lista não lê o arquivo.
    const anexo = await prisma.attachment.create({
      data: {
        documentType: "COA",
        lotId: lote.id,
        originalFileName: `laudo-${rotulo}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 3,
        sha256: "0".repeat(64),
        storageKey: `booleano-${m}-${rotulo}`,
        uploadedByUserId: user.id,
        uploadedByNameSnapshot: user.name,
        ...(arquivado
          ? { archivedAt: new Date(), archivedByUserId: user.id, archivedByNameSnapshot: user.name }
          : {}),
      },
    });
    rotulos.set(anexo.id, rotulo);
  }

  app = buildTestApp();
  await app.ready();
});

afterAll(async () => {
  const prisma = getPrisma();
  if (criados.lote) {
    // Attachment.lotId é RESTRICT — sai antes do Lot.
    await prisma.attachment.deleteMany({ where: { lotId: criados.lote } });
    await prisma.lot.deleteMany({ where: { id: criados.lote } });
  }
  if (criados.item) await prisma.item.deleteMany({ where: { id: criados.item } });
  await app?.close();
});

describe("Anexos do lote pela rota — includeArchived", () => {
  it("true: o ativo e o arquivado", async () => {
    expect(await lista({ includeArchived: "true" })).toEqual([ARQUIVADO, ATIVO]);
  });

  it("false: só o ativo", async () => {
    expect(await lista({ includeArchived: "false" })).toEqual([ATIVO]);
  });

  it("ausente: só o ativo", async () => {
    expect(await lista({})).toEqual([ATIVO]);
  });

  it("texto fora de true/false é 400, nunca lista", async () => {
    const obtidos: [string, string][] = [];
    for (const valor of RECUSADOS) {
      const resposta = await app.inject({ method: "GET", url: url({ includeArchived: valor }) });
      obtidos.push([valor, desfecho(resposta)]);
      if (resposta.statusCode === 400) {
        expect(resposta.json()).toMatchObject({ error: "validation_error", issues: [{ path: "includeArchived" }] });
      }
    }
    expect(obtidos, "/lots/:id/attachments?includeArchived").toEqual(RECUSADOS.map((valor) => [valor, "400"]));
  });
});
