import { z } from "zod";

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
   * Build do frontend servido pela própria API (implantação de origem única).
   * Vazio = não serve nada: em desenvolvimento o Vite continua na porta dele.
   *
   * Origem única existe porque a sessão vive em cookie `SameSite=Lax`: com
   * front e API em sites diferentes o navegador não envia o cookie, e o
   * login "funciona" mas a próxima requisição volta 401.
   */
  VERIDI_WEB_DIST: z.string().default(""),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Configuracao de ambiente invalida:\n${issues}`);
}

const data = parsed.data;

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
};
