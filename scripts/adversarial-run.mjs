import fs from "node:fs";
import path from "node:path";

/**
 * Identidade de EXECUÇÃO das suítes adversariais.
 *
 * As suítes criavam massa com nome fixo — "ADV Carbonato de calcio" — e, ao
 * reencontrá-la, buscavam por esse mesmo nome. Numa base que já tinha a massa
 * da execução anterior isso produzia três defeitos de laboratório, nenhum do
 * produto:
 *
 *   * contagem somando lote novo com lote retido ("14 lotes onde afirma 6");
 *   * Produto reaproveitado que já vinha com Formulação ativa, e o botão de
 *     criar formulação em branco deixava de existir;
 *   * Precificação reaproveitada já em R$ 9,99 — valor que a execução
 *     anterior tinha ativado de propósito para provar preço histórico.
 *
 * `--reset` limpava só o arquivo de estado do script, nunca o banco. O
 * laboratório dependia de base limpa, que é exatamente o que um E2E não pode
 * exigir para ser confiável.
 *
 * A saída é identidade, não limpeza: cada execução carimba um token curto nos
 * campos de NEGÓCIO que ela mesma preenche — nome de fornecedor, de item, de
 * produto, de cliente. Códigos oficiais continuam nascendo da sequência do
 * domínio. Buscar pelo nome carimbado reencontra só o que esta execução criou,
 * e a base pode estar cheia de massa legítima sem interferir.
 *
 * O token vive em `handoff/adversarial-run.json`, compartilhado pelas quatro
 * suítes: a de produção precisa achar os itens que a de estoque criou, e a de
 * rastreabilidade precisa achar a ordem que a de produção concluiu — antes
 * isso era código cravado no script, de uma execução específica.
 */

const ARQUIVO = path.resolve("handoff/adversarial-run.json");

function ler() {
  if (!fs.existsSync(ARQUIVO)) return null;
  try {
    return JSON.parse(fs.readFileSync(ARQUIVO, "utf8"));
  } catch {
    return null;
  }
}

function gravar(dados) {
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  fs.writeFileSync(ARQUIVO, JSON.stringify(dados, null, 2));
}

/** Token curto, legível e ordenável: `MMDD` + 3 caracteres aleatórios. */
function novoToken() {
  const agora = new Date();
  const dia = `${String(agora.getMonth() + 1).padStart(2, "0")}${String(agora.getDate()).padStart(2, "0")}`;
  const aleatorio = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${dia}${aleatorio}`;
}

/**
 * Identidade desta execução.
 *
 * `novo: true` (o `--reset` das suítes) começa uma execução nova, com token
 * novo e registro vazio. Sem ele, continua a execução corrente — é o que faz a
 * retomada reencontrar os registros do PRÓPRIO run, e não os de outro.
 *
 * A primeira suíte da cadeia é quem cria; as seguintes herdam.
 */
export function obterRun({ novo = false, dono = "" } = {}) {
  const atual = ler();
  if (!novo && atual?.runId) return atual;

  const run = {
    runId: novoToken(),
    criadoEm: new Date().toISOString(),
    criadoPor: dono,
    registro: {},
  };
  gravar(run);
  return run;
}

/**
 * Publica um valor para as suítes seguintes da cadeia.
 *
 * A suíte de rastreabilidade cravava `OP-000659` e `LT-20260903-000803` —
 * códigos de uma execução específica, que deixam de existir no instante em que
 * a base é recriada. Cada suíte agora publica o que produziu, e a seguinte lê.
 */
export function publicar(chave, valor) {
  const run = ler() ?? obterRun();
  run.registro = { ...(run.registro ?? {}), [chave]: valor };
  gravar(run);
  return run;
}

/** Lê o que uma suíte anterior publicou; `undefined` quando não houve. */
export function consultar(chave) {
  return ler()?.registro?.[chave];
}

/**
 * CNPJ sintético com dígitos verificadores válidos, derivado do token.
 *
 * O fornecedor da massa tinha CNPJ fixo. Numa base que já contém a execução
 * anterior, criar o segundo esbarra na unicidade do cadastro — e a suíte caía
 * num erro de laboratório que parecia recusa de domínio. Os oito primeiros
 * dígitos vêm do token, então o número é estável dentro da execução e
 * diferente entre execuções.
 */
export function cnpjDoRun(runId, sequencia = 0) {
  const semente = `${[...runId].reduce((soma, c) => soma * 31 + c.charCodeAt(0), 7)}`;
  const base = `${semente}${sequencia}`.replace(/\D/g, "").padStart(8, "9").slice(-8);
  const raiz = `${base}0001`;

  const digito = (numeros) => {
    const pesos =
      numeros.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = numeros
      .split("")
      .reduce((total, n, i) => total + Number(n) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const d1 = digito(raiz);
  const d2 = digito(`${raiz}${d1}`);
  const completo = `${raiz}${d1}${d2}`;
  return `${completo.slice(0, 2)}.${completo.slice(2, 5)}.${completo.slice(5, 8)}/${completo.slice(8, 12)}-${completo.slice(12)}`;
}

/** Caminho do arquivo, para as suítes registrarem no relatório. */
export const ARQUIVO_RUN = ARQUIVO;
