import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getPrisma } from "../db/prisma.js";
import { createAuthenticatedUser } from "./authenticated-app.js";
import {
  PREFIXO_DO_USUARIO_DE_TESTE,
  descartarUsuarios,
  listarUsuariosDeRodadaInterrompida,
} from "./usuarios-de-teste.js";

/**
 * Usuário e sessão do `buildTestApp` saem do banco (TEST-SUPPORT-ISOLATION-WAVE-01).
 *
 * O que dá para provar de dentro de um arquivo: a exclusão em si, o usuário
 * que uma fixture ainda segura e a varredura que não mexe em rodada viva. O
 * gancho de fim de arquivo (`ciclo-do-arquivo-de-teste.ts`) só é observável de
 * fora — contagem de `users`/`user_sessions` antes e depois de rodar arquivos,
 * registrada em `docs/TEST_COVERAGE_MAP.md`.
 */

describe("descartarUsuarios", () => {
  it("tira o usuário e a sessão; o mesmo perfil pedido de novo nasce outro usuário", async () => {
    const prisma = getPrisma();
    const { user } = await createAuthenticatedUser("VIEWER");
    expect(user.code.startsWith(PREFIXO_DO_USUARIO_DE_TESTE)).toBe(true);
    expect(await prisma.userSession.count({ where: { userId: user.id } })).toBe(1);

    expect(await descartarUsuarios(prisma, [user.id])).toEqual({ removidos: 1, mantidos: 0 });

    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
    expect(await prisma.userSession.count({ where: { userId: user.id } })).toBe(0);
    const { user: outro } = await createAuthenticatedUser("VIEWER");
    expect(outro.id).not.toBe(user.id);
  });

  it("usuário que uma fixture ainda referencia (RESTRICT) fica, sem sessão — e o outro sai mesmo assim", async () => {
    const prisma = getPrisma();
    const { user: seguro } = await createAuthenticatedUser("QUALITY");
    const { user: livre } = await createAuthenticatedUser("PURCHASING");
    // Anexo tem exatamente um dono (`attachments_single_owner_check`): um Produto só do teste.
    const produto = await prisma.product.create({
      data: { code: `PRD-USUARIOS-DE-TESTE-${seguro.id}`, name: "Produto do teste de usuários" },
    });
    const anexo = await prisma.attachment.create({
      data: {
        productId: produto.id,
        documentType: "OTHER",
        originalFileName: "usuarios-de-teste.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        sha256: "0".repeat(64),
        storageKey: `usuarios-de-teste/${seguro.id}`,
        uploadedByUserId: seguro.id,
        uploadedByNameSnapshot: seguro.name,
      },
    });
    try {
      expect(await descartarUsuarios(prisma, [seguro.id, livre.id])).toEqual({ removidos: 1, mantidos: 1 });
      expect(await prisma.user.count({ where: { id: seguro.id } })).toBe(1);
      expect(await prisma.userSession.count({ where: { userId: seguro.id } })).toBe(0);
      expect(await prisma.user.count({ where: { id: livre.id } })).toBe(0);
    } finally {
      await prisma.attachment.delete({ where: { id: anexo.id } });
      await prisma.product.delete({ where: { id: produto.id } });
    }
    // Sem a fixture, sai.
    expect(await descartarUsuarios(prisma, [seguro.id])).toEqual({ removidos: 1, mantidos: 0 });
  });
});

describe("varredura de rodada interrompida", () => {
  it("com outra conexão aberta no banco de teste — uma rodada viva —, não lista ninguém", async () => {
    // A conexão deste worker fica aberta no pool, com um usuário de teste em uso.
    const { user } = await createAuthenticatedUser("VIEWER");
    expect(await getPrisma().user.count({ where: { id: user.id } })).toBe(1);

    const url = new URL(process.env["DATABASE_URL"]!);
    url.searchParams.set("connection_limit", "1");
    const varredura = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    try {
      expect(await listarUsuariosDeRodadaInterrompida(varredura)).toBeNull();
    } finally {
      await varredura.$disconnect();
    }
  });
});
