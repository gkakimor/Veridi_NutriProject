/**
 * O banco em que a suíte da API escreve — e a prova de que ele é de teste.
 *
 * Os testes da API escrevem de verdade: apagam o Calendário de Produção,
 * regravam a jornada da semana, criam usuário e sessão em todo arquivo. Até
 * TEST-SUPPORT-ISOLATION-WAVE-01 eles rodavam no banco da `DATABASE_URL` do
 * `.env` — no DEV, o `veridi_dev` de quem usa o sistema —, e a faixa serial
 * dependia de guardar e devolver o que encontrava. Um kill antes do
 * `afterAll` desfazia essa promessa.
 *
 * Agora o banco da suíte NUNCA é o da `DATABASE_URL`:
 *
 * 1. `TEST_DATABASE_URL`, quando definida (ambiente ou `.env`), é o banco de
 *    teste — o caminho de CI, que entrega o banco pronto;
 * 2. sem ela, é o mesmo servidor e a mesma credencial da `DATABASE_URL`, com o
 *    nome `<banco>_test`: `veridi_dev` → `veridi_dev_test`. Worktree com banco
 *    próprio ganha banco de teste próprio, sem configurar nada.
 *
 * E a suíte só roda se o destino se declarar de teste — fail closed, o mesmo
 * espírito do `scripts/local-db-guard.mjs`: não basta não parecer produção, é
 * preciso provar que é de teste.
 *
 * - o nome do banco tem a palavra `test` separada (`veridi_dev_test`,
 *   `veridi_test`, `test_4821`, `app-test-2`) — é um padrão, não um nome fixo,
 *   então CI com banco de nome dinâmico cabe;
 * - o nome não tem marca de produção e o host não é de banco gerenciado;
 * - `TEST_DATABASE_URL` nunca aponta para o banco da `DATABASE_URL`;
 * - sessão com credencial de produção no ambiente não roda a suíte.
 *
 * Módulo puro — sem Prisma e sem Vitest — porque o `vitest.config.ts` o
 * importa para montar o ambiente dos workers.
 */

type Ambiente = Readonly<Record<string, string | undefined>>;

export interface DestinoDeTeste {
  readonly url: string;
  /** `host:porta/banco`, sem credencial — o único formato que vai para mensagem. */
  readonly alvo: string;
  readonly banco: string;
}

export interface BancoDeTeste extends DestinoDeTeste {
  readonly origem: "TEST_DATABASE_URL" | "DATABASE_URL";
}

export class BancoDeTesteRecusadoError extends Error {
  constructor(motivo: string) {
    super(
      `RECUSADO: a suíte da API só escreve em banco de TESTE.\n` +
        `Motivo: ${motivo}\n` +
        `Nenhum teste rodou. Contrato: TEST_DATABASE_URL com a palavra "test" no nome do banco,\n` +
        `ou nada — e a suíte usa <banco da DATABASE_URL>_test no mesmo servidor.`,
    );
    this.name = "BancoDeTesteRecusadoError";
  }
}

/** A palavra `test` inteira: `veridi_test` e `test_42` sim; `latest` e `contest` não. */
const PALAVRA_TEST = /(^|[^a-z0-9])test([^a-z0-9]|$)/i;

/** Palavras de produção no nome do banco (mesma lista do `local-db-guard.mjs`). */
const PALAVRAS_DE_PRODUCAO = new Set(["prod", "production", "producao", "live", "railway"]);

/** Marcas de banco gerenciado no host — a produção da Veridi mora no Railway. */
const HOSTS_GERENCIADOS = [
  "railway",
  "rlwy.net",
  "neon.tech",
  "supabase",
  "amazonaws.com",
  "azure.com",
  "gcp",
  "render.com",
  "heroku",
  "planetscale",
  "digitalocean",
];

/** Variáveis que só existem numa sessão com acesso à produção. */
const CREDENCIAIS_DE_PRODUCAO = ["DATABASE_PUBLIC_URL", "RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID"];

const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function lerUrl(url: string, variavel: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new BancoDeTesteRecusadoError(`${variavel} não é uma URL válida.`);
  }
  if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") {
    throw new BancoDeTesteRecusadoError(`${variavel} não é uma URL de PostgreSQL.`);
  }
  return u;
}

const nomeDoBanco = (u: URL) => decodeURIComponent(u.pathname.replace(/^\//, ""));

/** Descreve o destino sem credencial. */
export function descreverDestino(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}/${nomeDoBanco(u)}`;
  } catch {
    return "<URL ilegível>";
  }
}

/** A mesma URL — servidor, credencial e parâmetros —, com outro banco. */
export function comBanco(url: string, banco: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(banco)}`;
  return u.toString();
}

/** `localhost` e `127.0.0.1` são o mesmo servidor. */
function mesmoBanco(a: URL, b: URL): boolean {
  const host = (u: URL) => (HOSTS_LOCAIS.has(u.hostname.toLowerCase()) ? "local" : u.hostname.toLowerCase());
  return (
    host(a) === host(b) &&
    (a.port || "5432") === (b.port || "5432") &&
    nomeDoBanco(a).toLowerCase() === nomeDoBanco(b).toLowerCase()
  );
}

/**
 * Lança se `url` não for, comprovadamente, um banco de teste. Chamado ao
 * montar o ambiente, no `globalSetup` e em cada arquivo de teste: quem chegar
 * ao banco por qualquer caminho passa pela mesma regra.
 */
export function exigirBancoDeTeste(url: string | undefined, ambiente: Ambiente = {}): DestinoDeTeste {
  if (!url) throw new BancoDeTesteRecusadoError("nenhum banco definido para a suíte (DATABASE_URL vazia).");
  const u = lerUrl(url, "o banco de teste");
  const banco = nomeDoBanco(u);
  const alvo = descreverDestino(url);

  for (const chave of CREDENCIAIS_DE_PRODUCAO) {
    if (ambiente[chave]) {
      throw new BancoDeTesteRecusadoError(`a variável ${chave} está no ambiente — sessão com acesso à produção não roda a suíte.`);
    }
  }
  if (!PALAVRA_TEST.test(banco)) {
    throw new BancoDeTesteRecusadoError(`o nome do banco não tem a palavra "test" (${alvo}).`);
  }
  const palavra = banco
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .find((p) => PALAVRAS_DE_PRODUCAO.has(p));
  if (palavra || banco.toLowerCase().includes("railway")) {
    throw new BancoDeTesteRecusadoError(`o nome do banco tem marca de produção "${palavra ?? "railway"}" (${alvo}).`);
  }
  const host = u.hostname.toLowerCase();
  const gerenciado = HOSTS_GERENCIADOS.find((marca) => host.includes(marca));
  if (gerenciado) {
    throw new BancoDeTesteRecusadoError(`o host tem marca de banco gerenciado "${gerenciado}" (${alvo}).`);
  }
  return { url, alvo, banco };
}

/** Qual é o banco de teste deste ambiente — ou por que não há um. */
export function resolverBancoDeTeste(ambiente: Ambiente): BancoDeTeste {
  const explicito = ambiente["TEST_DATABASE_URL"]?.trim();
  const desenvolvimento = ambiente["DATABASE_URL"]?.trim();

  if (explicito) {
    const teste = exigirBancoDeTeste(explicito, ambiente);
    if (desenvolvimento && mesmoBanco(lerUrl(explicito, "TEST_DATABASE_URL"), lerUrl(desenvolvimento, "DATABASE_URL"))) {
      throw new BancoDeTesteRecusadoError(
        `TEST_DATABASE_URL aponta para o mesmo banco da DATABASE_URL (${teste.alvo}) — o banco de quem usa o sistema.`,
      );
    }
    return { ...teste, origem: "TEST_DATABASE_URL" };
  }

  if (!desenvolvimento) {
    throw new BancoDeTesteRecusadoError("nem TEST_DATABASE_URL nem DATABASE_URL estão definidas.");
  }
  const u = lerUrl(desenvolvimento, "DATABASE_URL");
  const derivado = comBanco(desenvolvimento, `${nomeDoBanco(u)}_test`);
  return { ...exigirBancoDeTeste(derivado, ambiente), origem: "DATABASE_URL" };
}

/**
 * O ambiente dos workers com a `DATABASE_URL` trocada pela do banco de teste.
 * É o que os `vitest*.config.ts` entregam em `test.env`: dali em diante, todo
 * `getPrisma()` e todo `new PrismaClient()` da suíte nasce apontando para ele.
 */
export function ambienteComBancoDeTeste(ambiente: Record<string, string>): Record<string, string> {
  const { url } = resolverBancoDeTeste(ambiente);
  return { ...ambiente, DATABASE_URL: url };
}
