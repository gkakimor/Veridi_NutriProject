/**
 * Configuração do armazenamento de objetos — LABEL-ATTACHMENTS-01.
 *
 * Lida do ambiente uma vez, na subida da API. Configuração pela metade
 * derruba a subida com a lista do que falta: uma API que sobe "funcionando" e
 * só descobre na hora do primeiro envio que o bucket não está configurado
 * deixaria a operação sem arquivo sem ninguém saber por quê.
 *
 * As mensagens citam só o NOME da variável — nunca o valor. Nada daqui vai
 * para log, banco ou navegador.
 */

export type StorageProviderName = "LOCAL_FS" | "R2";

export interface R2Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface StorageConfig {
  /** Onde o arquivo NOVO é gravado. */
  provider: StorageProviderName;
  /**
   * Presente quando as variáveis do R2 estão completas — inclusive com o
   * provedor em `LOCAL_FS`, para ler versões que nasceram no R2 antes da troca.
   */
  r2: R2Config | null;
}

export interface StorageEnvironment {
  VERIDI_STORAGE_PROVIDER: StorageProviderName;
  VERIDI_R2_ENDPOINT?: string | undefined;
  VERIDI_R2_BUCKET?: string | undefined;
  VERIDI_R2_REGION?: string | undefined;
  VERIDI_R2_ACCESS_KEY_ID?: string | undefined;
  VERIDI_R2_SECRET_ACCESS_KEY?: string | undefined;
}

/** As variáveis sem as quais o R2 não funciona. A região tem padrão (`auto`). */
export const R2_REQUIRED_VARIABLES = [
  "VERIDI_R2_ENDPOINT",
  "VERIDI_R2_BUCKET",
  "VERIDI_R2_ACCESS_KEY_ID",
  "VERIDI_R2_SECRET_ACCESS_KEY",
] as const;

/** Nome de bucket do R2: minúsculas, dígitos e hífen, de 3 a 63 caracteres. */
const BUCKET_VALIDO = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

export type StorageConfigResult =
  | { ok: true; config: StorageConfig }
  | { ok: false; problems: string[] };

function preenchida(valor: string | undefined): valor is string {
  return valor !== undefined && valor.trim() !== "";
}

export function resolveStorageConfig(vars: StorageEnvironment): StorageConfigResult {
  const algumaDoR2 = R2_REQUIRED_VARIABLES.some((nome) => preenchida(vars[nome]));
  const querR2 = vars.VERIDI_STORAGE_PROVIDER === "R2";

  if (!querR2 && !algumaDoR2) {
    return { ok: true, config: { provider: vars.VERIDI_STORAGE_PROVIDER, r2: null } };
  }

  const problems: string[] = [];
  for (const nome of R2_REQUIRED_VARIABLES) {
    if (!preenchida(vars[nome])) {
      problems.push(
        querR2
          ? `${nome}: obrigatória com VERIDI_STORAGE_PROVIDER=R2`
          : `${nome}: as variáveis do R2 estão pela metade — preencha todas ou nenhuma`,
      );
    }
  }

  const endpoint = vars.VERIDI_R2_ENDPOINT?.trim() ?? "";
  if (preenchida(endpoint)) {
    let url: URL | null = null;
    try {
      url = new URL(endpoint);
    } catch {
      problems.push("VERIDI_R2_ENDPOINT: não é um endereço válido");
    }
    if (url) {
      if (url.protocol !== "https:") {
        problems.push("VERIDI_R2_ENDPOINT: precisa começar com https://");
      }
      if (url.username || url.password || url.search || url.hash) {
        problems.push("VERIDI_R2_ENDPOINT: sem usuário, senha, consulta ou âncora no endereço");
      }
      // O painel da Cloudflare mostra o endereço COM o bucket no caminho; o SDK
      // montaria as chaves embaixo dele e nenhum objeto seria encontrado.
      if (url.pathname !== "/" && url.pathname !== "") {
        problems.push(
          "VERIDI_R2_ENDPOINT: só o endereço da conta, sem o nome do bucket no caminho — o bucket vai em VERIDI_R2_BUCKET",
        );
      }
    }
  }

  const bucket = vars.VERIDI_R2_BUCKET?.trim() ?? "";
  if (preenchida(bucket) && !BUCKET_VALIDO.test(bucket)) {
    problems.push("VERIDI_R2_BUCKET: nome inválido (minúsculas, dígitos e hífen, de 3 a 63 caracteres)");
  }

  if (problems.length > 0) return { ok: false, problems };

  const origem = new URL(endpoint);
  return {
    ok: true,
    config: {
      provider: vars.VERIDI_STORAGE_PROVIDER,
      r2: {
        endpoint: origem.origin,
        bucket,
        region: preenchida(vars.VERIDI_R2_REGION) ? vars.VERIDI_R2_REGION.trim() : "auto",
        accessKeyId: vars.VERIDI_R2_ACCESS_KEY_ID!.trim(),
        secretAccessKey: vars.VERIDI_R2_SECRET_ACCESS_KEY!.trim(),
      },
    },
  };
}
