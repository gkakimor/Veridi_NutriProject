import { describe, expect, it } from "vitest";
import { resolveStorageConfig } from "./storage-config.js";
import type { StorageEnvironment } from "./storage-config.js";

/**
 * Configuração do armazenamento — LABEL-ATTACHMENTS-01.
 *
 * Pela metade derruba a subida, e a recusa cita só NOMES de variável: o valor
 * da credencial nunca aparece em mensagem.
 */

const SEGREDO = "segredo-que-nunca-aparece-0123456789";
const CHAVE = "chave-que-nunca-aparece-abcdef";

const completo: StorageEnvironment = {
  VERIDI_STORAGE_PROVIDER: "R2",
  VERIDI_R2_ENDPOINT: "https://conta-exemplo.r2.cloudflarestorage.com",
  VERIDI_R2_BUCKET: "veridi-homologacao",
  VERIDI_R2_ACCESS_KEY_ID: CHAVE,
  VERIDI_R2_SECRET_ACCESS_KEY: SEGREDO,
};

function problemas(vars: StorageEnvironment): string[] {
  const resultado = resolveStorageConfig(vars);
  if (resultado.ok) throw new Error("esperava recusa");
  return resultado.problems;
}

describe("resolveStorageConfig", () => {
  it("sem nada do R2, LOCAL_FS é o padrão e o R2 fica indisponível", () => {
    expect(resolveStorageConfig({ VERIDI_STORAGE_PROVIDER: "LOCAL_FS" })).toEqual({
      ok: true,
      config: { provider: "LOCAL_FS", r2: null },
    });
  });

  it("região só (sem as obrigatórias) não liga o R2", () => {
    expect(
      resolveStorageConfig({ VERIDI_STORAGE_PROVIDER: "LOCAL_FS", VERIDI_R2_REGION: "auto" }),
    ).toEqual({ ok: true, config: { provider: "LOCAL_FS", r2: null } });
  });

  it("R2 completo: região vazia vira auto e o endereço fica só com a origem", () => {
    const resultado = resolveStorageConfig({
      ...completo,
      VERIDI_R2_ENDPOINT: "https://conta-exemplo.r2.cloudflarestorage.com/",
      VERIDI_R2_REGION: "  ",
    });
    expect(resultado).toEqual({
      ok: true,
      config: {
        provider: "R2",
        r2: {
          endpoint: "https://conta-exemplo.r2.cloudflarestorage.com",
          bucket: "veridi-homologacao",
          region: "auto",
          accessKeyId: CHAVE,
          secretAccessKey: SEGREDO,
        },
      },
    });
  });

  it("R2 completo com provedor LOCAL_FS: arquivo novo no disco, R2 disponível para ler o que nasceu lá", () => {
    const resultado = resolveStorageConfig({ ...completo, VERIDI_STORAGE_PROVIDER: "LOCAL_FS" });
    expect(resultado.ok && resultado.config.provider).toBe("LOCAL_FS");
    expect(resultado.ok && resultado.config.r2?.bucket).toBe("veridi-homologacao");
  });

  it("provedor R2 sem as variáveis lista cada uma pelo nome", () => {
    expect(problemas({ VERIDI_STORAGE_PROVIDER: "R2" })).toEqual([
      "VERIDI_R2_ENDPOINT: obrigatória com VERIDI_STORAGE_PROVIDER=R2",
      "VERIDI_R2_BUCKET: obrigatória com VERIDI_STORAGE_PROVIDER=R2",
      "VERIDI_R2_ACCESS_KEY_ID: obrigatória com VERIDI_STORAGE_PROVIDER=R2",
      "VERIDI_R2_SECRET_ACCESS_KEY: obrigatória com VERIDI_STORAGE_PROVIDER=R2",
    ]);
  });

  it("variáveis do R2 pela metade recusam mesmo com LOCAL_FS — sem citar o valor", () => {
    const lista = problemas({
      VERIDI_STORAGE_PROVIDER: "LOCAL_FS",
      VERIDI_R2_SECRET_ACCESS_KEY: SEGREDO,
    });
    expect(lista).toHaveLength(3);
    expect(lista.every((linha) => linha.includes("pela metade"))).toBe(true);
    expect(lista.join("\n")).not.toContain(SEGREDO);
  });

  it.each([
    ["http://conta-exemplo.r2.cloudflarestorage.com", "precisa começar com https://"],
    ["https://conta-exemplo.r2.cloudflarestorage.com/veridi-homologacao", "sem o nome do bucket no caminho"],
    ["conta-exemplo.r2.cloudflarestorage.com", "não é um endereço válido"],
    ["https://usuario:senha@conta-exemplo.r2.cloudflarestorage.com", "sem usuário, senha"],
  ])("endereço %s recusa: %s", (endpoint, trecho) => {
    const lista = problemas({ ...completo, VERIDI_R2_ENDPOINT: endpoint });
    expect(lista.join("\n"), `endpoint ${endpoint}`).toContain(trecho);
    expect(lista.join("\n")).not.toContain(SEGREDO);
    expect(lista.join("\n")).not.toContain(CHAVE);
    expect(lista.join("\n")).not.toContain("senha@");
  });

  it("bucket com nome fora da regra do R2 recusa", () => {
    expect(problemas({ ...completo, VERIDI_R2_BUCKET: "Veridi_Homologacao" })).toEqual([
      "VERIDI_R2_BUCKET: nome inválido (minúsculas, dígitos e hífen, de 3 a 63 caracteres)",
    ]);
  });
});
