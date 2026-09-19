import { z } from "zod";
import { resolveStorageConfig } from "./storage-config.js";

/**
 * Configuracao da API.
 *
 * As variaveis vem do `.env` na raiz do monorepo (carregado por `dotenv-cli`
 * nos scripts `dev`/`start`). Segredos nunca vao para o Git — ver `.env.example`.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL e obrigatoria (ver .env.example)"),
  API_PORT: z.coerce.number().int().positive().default(3333),
  API_HOST: z.string().min(1).optional(),
  /**
   * Injetada pelo provedor de hospedagem (Railway, Render...). Quando existe,
   * manda: a porta é escolhida por quem hospeda, não pelo `.env`.
   */
  PORT: z.coerce.number().int().positive().optional(),
  /** Origem do frontend aceita por CORS quando NODE_ENV=production. */
  WEB_ORIGIN: z.string().min(1).default("http://127.0.0.1:5173"),
  /**
   * Onde os anexos são gravados. Fora do repositório e fora de qualquer
   * diretório servido publicamente — o download passa sempre pela API
   * autenticada.
   */
  VERIDI_UPLOAD_DIR: z.string().min(1).default("../../.local-data/uploads"),
  /**
   * Onde nasce o arquivo NOVO do Item Rótulo (LABEL-ATTACHMENTS-01): `LOCAL_FS`
   * grava dentro de `VERIDI_UPLOAD_DIR`; `R2` grava no bucket privado da
   * Cloudflare pela API compatível com S3. Cada versão guarda o provedor em que
   * nasceu, então trocar esta variável não move nem esconde o que já foi gravado.
   *
   * Os anexos genéricos (`Attachment`) continuam em `VERIDI_UPLOAD_DIR`.
   */
  VERIDI_STORAGE_PROVIDER: z
    .enum(["LOCAL_FS", "R2"], {
      errorMap: () => ({ message: "use LOCAL_FS ou R2" }),
    })
    .default("LOCAL_FS"),
  /**
   * Cloudflare R2 — `https://<conta>.r2.cloudflarestorage.com`. Credencial
   * nunca vai para o Git, para o banco, para log nem para o navegador: o
   * download passa pela API autenticada.
   */
  VERIDI_R2_ENDPOINT: z.string().trim().optional(),
  VERIDI_R2_BUCKET: z.string().trim().optional(),
  /** O R2 ignora a região; o SDK exige uma. Vazia = `auto`. */
  VERIDI_R2_REGION: z.string().trim().optional(),
  VERIDI_R2_ACCESS_KEY_ID: z.string().trim().optional(),
  VERIDI_R2_SECRET_ACCESS_KEY: z.string().trim().optional(),
  /**
   * Build do frontend servido pela própria API (implantação de origem única).
   * Vazio = não serve nada: em desenvolvimento o Vite continua na porta dele.
   *
   * Origem única existe porque a sessão vive em cookie `SameSite=Lax`: com
   * front e API em sites diferentes o navegador não envia o cookie, e o
   * login "funciona" mas a próxima requisição volta 401.
   */
  VERIDI_WEB_DIST: z.string().default(""),
  /**
   * Injetadas pelo Railway em todo deploy, com o nome do ambiente e o commit
   * publicado. `GET /meta` as lê (VERIDI-SYSTEM-VERSIONING-01); fora do
   * Railway não existem, e o ambiente passa a ser o `NODE_ENV`.
   */
  RAILWAY_ENVIRONMENT_NAME: z.string().trim().optional(),
  RAILWAY_GIT_COMMIT_SHA: z.string().trim().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Configuracao de ambiente invalida:\n${issues}`);
}

const data = parsed.data;

const storage = resolveStorageConfig(data);
if (!storage.ok) {
  // Só nomes de variável: valor de credencial nunca chega a mensagem nem a log.
  throw new Error(
    `Configuracao de ambiente invalida:\n${storage.problems.map((problem) => `  - ${problem}`).join("\n")}`,
  );
}

/**
 * Endereço efetivo de escuta.
 *
 * Em produção o processo roda dentro de um container: precisa escutar em
 * todas as interfaces, senão nem o balanceador nem o health check chegam
 * nele. Em desenvolvimento o padrão continua sendo o loopback `127.0.0.1`
 * — de propósito: o cookie de sessão é first-party por host, e alternar
 * entre `localhost` e `127.0.0.1` derruba o login.
 */
const host = data.API_HOST ?? (data.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

export const env = {
  ...data,
  API_PORT: data.PORT ?? data.API_PORT,
  API_HOST: host,
  /** Provedor do arquivo novo e, quando completo, o acesso ao R2. */
  storage: storage.config,
};
