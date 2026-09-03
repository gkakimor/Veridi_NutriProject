/**
 * Guarda de segurança: este banco é LOCAL?
 *
 * Existe para uma coisa só: impedir que um comando destrutivo escrito para o
 * ambiente de desenvolvimento chegue à base de produção. O erro que ela
 * previne não é hipotético — é a linha de comando com a variável errada
 * exportada, e o custo dele é a operação do cliente.
 *
 * A regra é INVERSA à intuição: não basta parecer produção para recusar; é
 * preciso PROVAR que é local para permitir. Qualquer dúvida recusa.
 *
 * `NODE_ENV` não entra na decisão. Ele é uma convenção de aplicação, não uma
 * propriedade do banco, e continua valendo `development` numa máquina que
 * acabou de exportar a URL de produção.
 *
 *   import { exigirBancoLocal } from "./local-db-guard.mjs";
 *   const url = exigirBancoLocal();   // lança se não for local
 */

import { hostname } from "node:os";

/** Hosts que são a própria máquina. Nada além disto é local. */
const HOSTS_LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/**
 * Marcas de banco gerenciado. Não é a checagem principal — a lista branca de
 * hosts já recusaria todos —, é a segunda barreira, para o dia em que alguém
 * apontar um `/etc/hosts` de `localhost` para um túnel.
 */
const MARCAS_REMOTAS = [
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

/** Nomes de banco que ninguém deve limpar por engano. */
const NOMES_PROIBIDOS = ["prod", "production", "producao", "railway", "live"];

export class BancoNaoLocalError extends Error {
  constructor(motivo) {
    super(
      `RECUSADO: este comando só roda contra banco LOCAL.\n` +
        `Motivo: ${motivo}\n` +
        `Nenhuma alteração foi feita.`,
    );
    this.name = "BancoNaoLocalError";
  }
}

/**
 * Descreve o destino sem revelar credencial.
 *
 * Toda mensagem de erro deste módulo passa por aqui: um guarda que imprime a
 * senha ao recusar troca um risco por outro.
 */
export function descreverDestino(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}/${(u.pathname || "").replace(/^\//, "")}`;
  } catch {
    return "<URL ilegível>";
  }
}

/**
 * Devolve a `DATABASE_URL` se — e somente se — ela apontar para um banco
 * local. Caso contrário lança.
 */
export function exigirBancoLocal(env = process.env) {
  const url = env["DATABASE_URL"];
  if (!url) throw new BancoNaoLocalError("DATABASE_URL não está definida.");

  // Uma URL que nem parseia não pode ser julgada local.
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new BancoNaoLocalError("DATABASE_URL não é uma URL válida.");
  }

  const alvo = descreverDestino(url);
  const host = (u.hostname || "").toLowerCase();

  if (!HOSTS_LOCAIS.has(host)) {
    throw new BancoNaoLocalError(`host "${host}" não é local (${alvo}).`);
  }

  const inteira = url.toLowerCase();
  const marca = MARCAS_REMOTAS.find((m) => inteira.includes(m));
  if (marca) {
    throw new BancoNaoLocalError(`a URL contém "${marca}", marca de banco gerenciado (${alvo}).`);
  }

  const banco = (u.pathname || "").replace(/^\//, "").toLowerCase();
  const proibido = NOMES_PROIBIDOS.find((n) => banco.includes(n));
  if (proibido) {
    throw new BancoNaoLocalError(`o nome do banco contém "${proibido}" (${alvo}).`);
  }

  /*
   * A presença de credencial de produção no ambiente é suspeita por si só,
   * mesmo com a `DATABASE_URL` apontando para localhost: significa que a
   * sessão tem as duas à mão, e é assim que a errada acaba sendo usada.
   */
  for (const chave of ["DATABASE_PUBLIC_URL", "RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID"]) {
    if (env[chave]) {
      throw new BancoNaoLocalError(
        `a variável ${chave} está no ambiente — sessão com acesso a produção não executa reset local.`,
      );
    }
  }

  return { url, alvo, host, banco };
}

// Rodando direto: diz o veredito e sai com código, para servir de porteiro
// em qualquer script de shell.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  try {
    const { alvo } = exigirBancoLocal();
    console.log(`ok  banco local: ${alvo}`);
  } catch (erro) {
    console.error(erro.message);
    process.exitCode = 1;
  }
}
