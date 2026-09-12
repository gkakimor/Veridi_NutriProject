import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Pacote de revisão devolvido pela Veridi — a autoridade da migração.
 *
 * O corpus legado é a fonte histórica. O pacote devolvido e aprovado é quem
 * decide **o que entra** e **com quais valores**, para todo campo que o
 * workbook expõe. Quando há pacote informado, não existe fallback silencioso
 * para o valor bruto do CSV: ou o dado vem do workbook, ou a etapa falha.
 *
 * O Excel não é lido aqui. Quem abre os .xlsx é o tooling do pacote
 * (`scripts/veridi-migration-pack/validar_pacote.py --exportar`), que já é dono
 * do contrato das colunas e só exporta quando a validação passa sem erro. Este
 * módulo consome a leitura normalizada em JSON, indexada por workbook e
 * CHAVE_MIGRACAO. Uma única porta de entrada para o Excel, e ela fica fora do
 * pipeline.
 */

/** Formato do JSON exportado. Subir isto quebra de propósito. */
const FORMATO_SUPORTADO = 1;

/** As quatro decisões do fluxo de revisão humana. */
export const DECISOES_REVISAO = ["REVISAR", "OK", "PENDENTE", "NAO_IMPORTAR"] as const;
export type DecisaoRevisao = (typeof DECISOES_REVISAO)[number];

/** Decisões que impedem a carga: o registro ainda não foi revisado. */
export const DECISOES_INCOMPLETAS: readonly DecisaoRevisao[] = ["REVISAR", "PENDENTE"];

export type ValorRevisado = string | number | boolean | null;

export interface RegistroRevisado {
  /** CHAVE_MIGRACAO — a identidade do registro em toda a migração. */
  chave: string;
  /** Valor bruto da coluna de status do workbook. */
  status: string;
  campos: Record<string, ValorRevisado>;
}

export interface WorkbookRevisado {
  nome: string;
  colunaStatus: string;
  statusPermitidos: readonly string[];
  /**
   * `true` quando o workbook usa exatamente REVISAR/OK/PENDENTE/NAO_IMPORTAR.
   * O 06 (referência de mercado) usa ACEITA/REJEITADA e tem fluxo próprio:
   * fica de fora do portão genérico de revisão, de propósito.
   */
  usaDecisoesDeRevisao: boolean;
  colunas: readonly string[];
  obrigatorias: readonly string[];
  porChave: Map<string, RegistroRevisado>;
  contagem: Record<string, number>;
}

export interface ArquivoDoPacote {
  nome: string;
  sha256: string;
  bytes: number;
  modificadoEm: string;
  registros: number;
}

export interface PacoteRevisao {
  /** Caminho do JSON lido. */
  origemJson: string;
  /** Pasta dos .xlsx de onde o JSON foi exportado. */
  pasta: string;
  /** SHA-256 sobre os SHA-256 dos workbooks: identidade do pacote. */
  identidade: string;
  /** Pasta do pacote anterior conferida na exportação, quando houve. */
  referencia: string | null;
  exportadoEm: string;
  /** `true` quando a exportação passou por `--devolucao`. */
  devolucao: boolean;
  arquivos: readonly ArquivoDoPacote[];
  workbooks: Map<string, WorkbookRevisado>;
}

/** Erro de carga do pacote: sempre fatal, nunca degradado em aviso. */
export class ReviewPackageError extends Error {}

function exigir(condicao: unknown, mensagem: string): asserts condicao {
  if (!condicao) throw new ReviewPackageError(`ABORTADO: ${mensagem}`);
}

function texto(valor: unknown, onde: string): string {
  exigir(typeof valor === "string" && valor.trim().length > 0, `${onde} ausente ou vazio no pacote.`);
  return (valor as string).trim();
}

/**
 * Lê o pacote exportado e valida a estrutura inteira antes de devolver.
 *
 * Falha fechado: chave vazia, chave repetida, status fora da lista do próprio
 * workbook ou formato desconhecido abortam a carga. Um pacote meio lido é pior
 * que nenhum — ele parece que funcionou.
 */
export function loadReviewPackage(jsonPath: string): PacoteRevisao {
  const caminho = path.resolve(jsonPath);
  exigir(
    fs.existsSync(caminho),
    `pacote de revisão não encontrado em ${caminho}.\n` +
      "  Gere com: python scripts/veridi-migration-pack/validar_pacote.py <pasta do pacote> " +
      "--devolucao --exportar <arquivo.json>",
  );

  let bruto: unknown;
  try {
    bruto = JSON.parse(fs.readFileSync(caminho, "utf8"));
  } catch (erro) {
    throw new ReviewPackageError(
      `ABORTADO: pacote de revisão ilegível (${caminho}): ${erro instanceof Error ? erro.message : erro}`,
    );
  }

  const raiz = bruto as Record<string, unknown>;
  exigir(
    raiz["formato"] === FORMATO_SUPORTADO,
    `pacote de revisão no formato ${String(raiz["formato"])}; este pipeline lê o formato ${FORMATO_SUPORTADO}. ` +
      "Reexporte com o tooling atual.",
  );

  const cabecalho = raiz["pacote"] as Record<string, unknown> | undefined;
  exigir(cabecalho, "pacote de revisão sem a seção de identificação.");
  const validacao = (raiz["validacao"] ?? {}) as Record<string, unknown>;

  const arquivos = (cabecalho["arquivos"] as ArquivoDoPacote[] | undefined) ?? [];
  exigir(arquivos.length > 0, "pacote de revisão sem nenhum workbook.");

  const workbooksBrutos = raiz["workbooks"] as Record<string, Record<string, unknown>> | undefined;
  exigir(workbooksBrutos, "pacote de revisão sem workbooks.");

  const workbooks = new Map<string, WorkbookRevisado>();
  for (const [nome, dados] of Object.entries(workbooksBrutos)) {
    const colunaStatus = texto(dados["colunaStatus"], `${nome}: coluna de status`);
    const statusPermitidos = (dados["statusPermitidos"] as string[] | undefined) ?? [];
    exigir(statusPermitidos.length > 0, `${nome}: pacote não diz quais status são aceitos.`);

    const porChave = new Map<string, RegistroRevisado>();
    const registros = (dados["registros"] as Record<string, unknown>[] | undefined) ?? [];
    for (const registro of registros) {
      const chave = texto(registro["chave"], `${nome}: CHAVE_MIGRACAO`);
      exigir(!porChave.has(chave), `${nome}: CHAVE_MIGRACAO repetida no pacote (${chave}).`);
      const status = texto(registro["status"], `${nome}: status de ${chave}`);
      exigir(
        statusPermitidos.includes(status),
        `${nome}: ${chave} com status "${status}", que não está entre ${statusPermitidos.join(", ")}.`,
      );
      porChave.set(chave, {
        chave,
        status,
        campos: (registro["campos"] as Record<string, ValorRevisado> | undefined) ?? {},
      });
    }

    const usaDecisoesDeRevisao =
      statusPermitidos.length === DECISOES_REVISAO.length &&
      DECISOES_REVISAO.every((decisao) => statusPermitidos.includes(decisao));

    workbooks.set(nome, {
      nome,
      colunaStatus,
      statusPermitidos,
      usaDecisoesDeRevisao,
      colunas: (dados["colunas"] as string[] | undefined) ?? [],
      obrigatorias: (dados["obrigatorias"] as string[] | undefined) ?? [],
      porChave,
      contagem: (dados["contagem"] as Record<string, number> | undefined) ?? {},
    });
  }

  return {
    origemJson: caminho,
    pasta: texto(cabecalho["caminho"], "caminho do pacote"),
    identidade: texto(cabecalho["identidade"], "identidade do pacote"),
    referencia: (cabecalho["referencia"] as string | null) ?? null,
    exportadoEm: texto(raiz["geradoEm"], "data de exportação"),
    devolucao: validacao["devolucao"] === true,
    arquivos,
    workbooks,
  };
}

export function workbookObrigatorio(pacote: PacoteRevisao, nome: string): WorkbookRevisado {
  const workbook = pacote.workbooks.get(nome);
  exigir(workbook, `pacote de revisão sem o workbook ${nome} — sem ele a migração não tem autoridade sobre esse domínio.`);
  return workbook;
}

/** Registros aprovados: os únicos elegíveis para a carga. */
export function aprovados(workbook: WorkbookRevisado): RegistroRevisado[] {
  return [...workbook.porChave.values()].filter((registro) => registro.status === "OK");
}

/** Registros que a Veridi decidiu deixar de fora. Nunca criar, nunca atualizar. */
export function naoImportar(workbook: WorkbookRevisado): Set<string> {
  return new Set(
    [...workbook.porChave.values()]
      .filter((registro) => registro.status === "NAO_IMPORTAR")
      .map((registro) => registro.chave),
  );
}

/** Registros que ainda não foram revisados — é o que trava o PLAN de carga. */
export function naoRevisados(workbook: WorkbookRevisado): RegistroRevisado[] {
  if (!workbook.usaDecisoesDeRevisao) return [];
  return [...workbook.porChave.values()].filter((registro) =>
    (DECISOES_INCOMPLETAS as readonly string[]).includes(registro.status),
  );
}

/** Texto de um campo revisado; vazio vira `null`, como o domínio espera. */
export function campo(registro: RegistroRevisado, coluna: string): string | null {
  const valor = registro.campos[coluna];
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  return texto.length > 0 ? texto : null;
}

/**
 * Motivos para recusar a carga. Vazio = pacote pronto.
 *
 * Todo registro do escopo precisa estar decidido: REVISAR e PENDENTE não são
 * "quase OK", são "ainda não olhei". Transformar um no outro seria decidir no
 * lugar da Veridi.
 */
export function bloqueiosDaRevisao(
  pacote: PacoteRevisao,
  workbooksDoEscopo: readonly string[],
): string[] {
  const bloqueios: string[] = [];
  for (const nome of workbooksDoEscopo) {
    const workbook = pacote.workbooks.get(nome);
    if (!workbook) {
      bloqueios.push(`${nome}: workbook ausente no pacote de revisão.`);
      continue;
    }
    if (!workbook.usaDecisoesDeRevisao) continue;
    const pendentes = naoRevisados(workbook);
    if (pendentes.length === 0) continue;
    const revisar = pendentes.filter((registro) => registro.status === "REVISAR").length;
    const pendente = pendentes.filter((registro) => registro.status === "PENDENTE").length;
    bloqueios.push(
      `${nome}: ${pendentes.length} de ${workbook.porChave.size} registro(s) pendente(s) de revisão ` +
        `(${revisar} em REVISAR, ${pendente} em PENDENTE).`,
    );
  }
  return bloqueios;
}

export interface CarimboDoPacote {
  identidade: string;
  pasta: string;
  origemJson: string;
  exportadoEm: string;
  devolucao: boolean;
  referencia: string | null;
  /** SHA-256 do próprio JSON normalizado, além do dos .xlsx. */
  sha256Json: string;
  arquivos: readonly ArquivoDoPacote[];
}

/**
 * Identidade do pacote para gravar no PLAN.
 *
 * Guarda os dois hashes: o dos .xlsx (identidade) e o do JSON lido. O APPLY
 * compara os dois — se qualquer um mudar entre PLAN e APPLY, alguém trocou o
 * pacote no meio do caminho.
 */
export function carimboDoPacote(pacote: PacoteRevisao): CarimboDoPacote {
  return {
    identidade: pacote.identidade,
    pasta: pacote.pasta,
    origemJson: pacote.origemJson,
    exportadoEm: pacote.exportadoEm,
    devolucao: pacote.devolucao,
    referencia: pacote.referencia,
    sha256Json: createHash("sha256").update(fs.readFileSync(pacote.origemJson)).digest("hex"),
    arquivos: pacote.arquivos,
  };
}

/** Diferenças entre o pacote aprovado no PLAN e o informado agora. Vazio = o mesmo. */
export function diferencasDoPacote(
  planejado: CarimboDoPacote | null | undefined,
  atual: CarimboDoPacote,
): string[] {
  if (!planejado) return ["o PLAN não registrou pacote de revisão nenhum"];
  const diferencas: string[] = [];
  if (planejado.identidade !== atual.identidade) {
    diferencas.push("a identidade do pacote (SHA-256 dos workbooks) mudou desde o PLAN");
  }
  if (planejado.sha256Json !== atual.sha256Json) {
    diferencas.push("o conteúdo exportado do pacote mudou desde o PLAN");
  }
  const porNome = new Map(atual.arquivos.map((arquivo) => [arquivo.nome, arquivo]));
  for (const arquivo of planejado.arquivos) {
    const agora = porNome.get(arquivo.nome);
    if (!agora) {
      diferencas.push(`${arquivo.nome}: ausente no pacote atual`);
      continue;
    }
    if (agora.sha256 !== arquivo.sha256) diferencas.push(`${arquivo.nome}: conteúdo mudou desde o PLAN`);
  }
  return diferencas;
}

/** `--devolucao=<caminho>`: o pacote é sempre explícito, nunca "a última pasta". */
export function devolucaoArgumento(argv: readonly string[] = process.argv): string | null {
  const comIgual = argv.find((argumento) => argumento.startsWith("--devolucao="));
  if (comIgual) {
    const valor = comIgual.slice("--devolucao=".length).trim();
    return valor.length > 0 ? valor : null;
  }
  const indice = argv.indexOf("--devolucao");
  if (indice >= 0) {
    const valor = argv[indice + 1];
    if (valor && !valor.startsWith("--")) return valor;
    throw new ReviewPackageError(
      "ABORTADO: --devolucao precisa do caminho do pacote exportado.\n" +
        "  Exemplo: pnpm veridi:import:plan -- --devolucao=.local-data/veridi/out/pacote-revisao.json",
    );
  }
  return null;
}
