/**
 * Smoke controlado do Cloudflare R2 — LABEL-ATTACHMENTS-01.
 *
 *   pnpm storage:r2:smoke
 *
 * Prova, contra o bucket de verdade, o mesmo adaptador que a API usa: grava um
 * objeto pequeno em `_smoke/`, confere cabeçalho e bytes, confirma que a mesma
 * chave não é sobrescrita e apaga o objeto no fim. Nenhum dado da Veridi entra:
 * o conteúdo é um texto aleatório gerado aqui.
 *
 * Credencial NUNCA vai para o Git. O script lê as variáveis `VERIDI_R2_*` do
 * ambiente (inclusive da `.env` da raiz, que é ignorada pelo Git) e, se não
 * estiverem lá, do arquivo fora do repositório:
 *
 *   ../.local-data/veridi/r2-homologacao.env      (ou VERIDI_R2_ENV_FILE)
 *
 * Imprime só o nome do bucket, a chave de smoke, tamanhos e o resultado de cada
 * passo. Endereço da conta, chave de acesso e segredo não aparecem na saída.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { R2_REQUIRED_VARIABLES, resolveStorageConfig } from "../apps/api/src/config/storage-config.js";
import { criarAdaptadorR2 } from "../apps/api/src/lib/storage/r2-storage.js";
import {
  StorageObjectAlreadyExistsError,
  StorageUnavailableError,
} from "../apps/api/src/lib/storage/storage-adapter.js";

const NOMES = [...R2_REQUIRED_VARIABLES, "VERIDI_R2_REGION"] as const;

/** Lê `CHAVE=valor` do arquivo, só das variáveis do R2, sem sobrescrever o ambiente. */
function carregarArquivoDeAmbiente(caminho: string): number {
  let carregadas = 0;
  for (const linha of readFileSync(caminho, "utf8").split(/\r?\n/)) {
    const achado = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(linha);
    if (!achado) continue;
    const [, nome, bruto] = achado;
    if (!nome || !(NOMES as readonly string[]).includes(nome)) continue;
    if (process.env[nome]?.trim()) continue;
    process.env[nome] = (bruto ?? "").replace(/^(["'])(.*)\1$/, "$2");
    carregadas += 1;
  }
  return carregadas;
}

async function lerTudo(corpo: Readable): Promise<Buffer> {
  const pedacos: Buffer[] = [];
  for await (const pedaco of corpo) pedacos.push(Buffer.from(pedaco as Buffer));
  return Buffer.concat(pedacos);
}

function sha256(conteudo: Buffer): string {
  return createHash("sha256").update(conteudo).digest("hex");
}

function descrever(erro: unknown): string {
  if (erro instanceof StorageUnavailableError) return `${erro.name} (${erro.detail})`;
  return erro instanceof Error ? erro.name : "erro";
}

async function main(): Promise<void> {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const faltando = R2_REQUIRED_VARIABLES.filter((nome) => !process.env[nome]?.trim());
  if (faltando.length > 0) {
    const arquivo =
      process.env["VERIDI_R2_ENV_FILE"] ?? path.resolve(raiz, "..", ".local-data", "veridi", "r2-homologacao.env");
    if (existsSync(arquivo)) {
      console.log(`variáveis do R2 lidas de fora do repositório: ${carregarArquivoDeAmbiente(arquivo)}`);
    }
  }

  const resultado = resolveStorageConfig({
    VERIDI_STORAGE_PROVIDER: "R2",
    VERIDI_R2_ENDPOINT: process.env["VERIDI_R2_ENDPOINT"],
    VERIDI_R2_BUCKET: process.env["VERIDI_R2_BUCKET"],
    VERIDI_R2_REGION: process.env["VERIDI_R2_REGION"],
    VERIDI_R2_ACCESS_KEY_ID: process.env["VERIDI_R2_ACCESS_KEY_ID"],
    VERIDI_R2_SECRET_ACCESS_KEY: process.env["VERIDI_R2_SECRET_ACCESS_KEY"],
  });
  if (!resultado.ok || !resultado.config.r2) {
    console.error("R2 NÃO CONFIGURADO — nada foi enviado:");
    for (const problema of resultado.ok ? [] : resultado.problems) console.error(`  - ${problema}`);
    process.exitCode = 1;
    return;
  }

  const r2 = resultado.config.r2;
  const storage = criarAdaptadorR2(r2);
  const key = `_smoke/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.txt`;
  const conteudo = Buffer.from(`veridi r2 smoke ${randomUUID()}\n`, "utf8");
  const hash = sha256(conteudo);

  console.log(`bucket: ${r2.bucket}`);
  console.log(`chave de smoke: ${key} (${conteudo.byteLength} bytes)`);

  let gravado = false;
  let falhou = false;
  try {
    await storage.putObject({ key, content: conteudo, contentType: "text/plain", sha256Hex: hash });
    gravado = true;
    console.log("ok   upload (If-None-Match: *, SHA-256 conferido pelo R2)");

    const cabecalho = await storage.headObject(key);
    if (cabecalho?.contentLength !== conteudo.byteLength) {
      throw new Error(`head devolveu ${cabecalho?.contentLength ?? "nada"} bytes`);
    }
    console.log(`ok   head (${cabecalho.contentLength} bytes)`);

    const objeto = await storage.getObject(key);
    const baixado = await lerTudo(objeto.body);
    if (!baixado.equals(conteudo) || sha256(baixado) !== hash) {
      throw new Error("download não bate com o que foi enviado");
    }
    console.log("ok   download (bytes e SHA-256 iguais)");

    try {
      await storage.putObject({ key, content: Buffer.from("sobrescrita"), contentType: "text/plain", sha256Hex: sha256(Buffer.from("sobrescrita")) });
      throw new Error("a mesma chave aceitou segunda gravação — sobrescrita não foi barrada");
    } catch (erro) {
      if (!(erro instanceof StorageObjectAlreadyExistsError)) throw erro;
      console.log("ok   sobrescrita recusada (412)");
    }
  } catch (erro) {
    falhou = true;
    console.error(`FALHOU: ${erro instanceof Error && !(erro instanceof StorageUnavailableError) ? erro.message : descrever(erro)}`);
  } finally {
    if (gravado) {
      try {
        await storage.deleteObject(key);
        const depois = await storage.headObject(key);
        if (depois !== null) throw new Error("objeto continua no bucket depois do delete");
        console.log("ok   delete do objeto de smoke (head confirma ausência)");
      } catch (erro) {
        falhou = true;
        console.error(`FALHOU a limpeza — apague à mão a chave ${key}: ${descrever(erro)}`);
      }
    }
  }

  if (falhou) {
    process.exitCode = 1;
    return;
  }
  console.log("\nSMOKE R2 OK");
}

main().catch((erro: unknown) => {
  console.error(`FALHOU: ${descrever(erro)}`);
  process.exitCode = 1;
});
