/**
 * Componente inativo não inicia compromisso novo de Produção —
 * PRODUCTION-INACTIVE-COMPONENT-GATE-01, `PRODUCT_RULES.md` §116.
 *
 * A formulação ativa foi gravada com o item ATIVO, e o item foi inativado
 * depois. A formulação não muda por causa disso: ela segue ACTIVE, consultável,
 * com os mesmos componentes (§107 já diz que inativar o Item não o tira do
 * físico, e a ativação de receita nova é outra guarda). O que para é a Produção
 * assumir um compromisso NOVO com essa composição — planejar e liberar.
 *
 * Ordem já liberada ou em execução nunca passa por aqui: o compromisso foi
 * assumido antes, e separação, consumo e conclusão seguem. Reativar o item
 * destrava o mesmo passo, sem refazer nada.
 *
 * A recusa nomeia TODOS os componentes inativos de uma vez — a receita com três
 * itens inativados não obriga a descobrir o segundo só depois de regularizar o
 * primeiro.
 */

/** O componente lido no momento da ação — código e nome vêm do cadastro do Item. */
export interface ComponenteDaReceita {
  itemCode: string;
  itemName: string;
  active: boolean;
}

/** De qual receita a recusa está falando, do jeito que a tela a identifica. */
export interface ReceitaDaOrdem {
  productCode: string;
  /** `null` na ordem que ainda não congelou a versão — a frase omite o "V…". */
  versionNumber: number | null;
}

function nomeDaReceita(receita: ReceitaDaOrdem): string {
  return receita.versionNumber === null
    ? `a formulação do produto ${receita.productCode}`
    : `a formulação V${receita.versionNumber} do produto ${receita.productCode}`;
}

/**
 * Um ou mais componentes inativos na composição que a ordem ia assumir. O passo
 * barrado vem de quem chama — planejar e liberar são passos diferentes —, e o
 * singular/plural da orientação acompanha quantos itens a frase nomeou.
 */
export class InactiveComponentError extends Error {
  /** Códigos dos itens inativos, na ordem da receita, sem repetir. */
  readonly itemCodes: readonly string[];

  constructor(
    receita: ReceitaDaOrdem,
    componentes: readonly ComponenteDaReceita[],
    /** O passo que esta recusa barra, no infinitivo: "liberar a ordem". */
    passo: string,
  ) {
    const lista = componentes
      .map((componente) => `${componente.itemCode} — ${componente.itemName}`)
      .join("; ");
    super(
      componentes.length === 1
        ? `${nomeDaReceita(receita)} usa o item ${lista}, que está inativo. Reative o item no cadastro para ${passo}.`
        : `${nomeDaReceita(receita)} usa ${componentes.length} itens inativos: ${lista}. Reative os itens no cadastro para ${passo}.`,
    );
    this.name = "InactiveComponentError";
    this.itemCodes = componentes.map((componente) => componente.itemCode);
  }
}

/**
 * Recusa se algum componente da receita estiver inativo. Item repetido em duas
 * linhas aparece uma vez, na ordem da receita. Receita sem componente inativo
 * não faz nada — e nenhuma outra situação do item (tipo, unidade) é decidida
 * aqui: isso é da ativação da formulação.
 */
export function assertComponentsActive(
  receita: ReceitaDaOrdem,
  componentes: readonly ComponenteDaReceita[],
  /** O passo que esta recusa barra, no infinitivo: "liberar a ordem". */
  passo: string,
): void {
  const vistos = new Set<string>();
  const inativos = componentes.filter((componente) => {
    if (componente.active || vistos.has(componente.itemCode)) return false;
    vistos.add(componente.itemCode);
    return true;
  });
  if (inativos.length > 0) throw new InactiveComponentError(receita, inativos, passo);
}
