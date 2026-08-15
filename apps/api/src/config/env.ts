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
  API_HOST: z.string().min(1).default("127.0.0.1"),
  /** Origem do frontend aceita por CORS quando NODE_ENV=production. */
  WEB_ORIGIN: z.string().min(1).default("http://127.0.0.1:5173"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Configuracao de ambiente invalida:\n${issues}`);
}

export const env = parsed.data;
