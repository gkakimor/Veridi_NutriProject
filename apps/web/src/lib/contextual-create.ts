/**
 * Criar uma entidade sem perder o formulário em que se estava.
 *
 * O caso: alguém monta um Produto, chega no campo Cliente e descobre que o
 * cliente ainda não existe. Sai para a TELA OFICIAL de cadastro de Cliente,
 * salva, e volta exatamente ao ponto de origem — com o rascunho intacto e o
 * cliente novo já selecionado.
 *
 * ## Por que não `navigate(-1)`
 *
 * Voltar pelo histórico parece resolver e não resolve: quem atualiza a
 * página de criação, entra por link direto ou navega para outro lugar no
 * meio do caminho perde a pilha, e o "voltar" leva para qualquer lugar. O
 * contexto precisa ser explícito e sobreviver a recarga — por isso ele é um
 * registro endereçado por token, e o token viaja na URL.
 *
 * ## Por que `sessionStorage`
 *
 * O rascunho precisa sobreviver a navegação e a refresh, e precisa morrer
 * junto com a aba. `localStorage` transformaria rascunho em dado
 * persistente: o produto pela metade de três semanas atrás voltaria sozinho.
 * Banco está fora de questão — isto é estado de navegação, não informação do
 * domínio.
 *
 * `sessionStorage` já é isolado por aba, então duas abas não se atrapalham
 * nem com chave repetida. O token existe pelo motivo seguinte: dentro da
 * MESMA aba pode haver mais de uma criação contextual, e uma chave global
 * (`productDraft`) faria a segunda apagar a primeira.
 */

const PREFIXO = "contextual-create:";

/**
 * Ponteiro para a criação contextual em andamento nesta aba.
 *
 * Existe por causa do botão Voltar do navegador: quem volta sem usar
 * "Cancelar" chega à rota de origem SEM o parâmetro de retomada, e sem este
 * ponteiro o rascunho ficaria órfão no armazenamento enquanto o formulário
 * aparecia vazio na tela.
 */
const CHAVE_ATIVO = `${PREFIXO}ativo`;

/**
 * Formato do registro.
 *
 * Versionado porque o rascunho atravessa um refresh: a aba pode ter guardado
 * o registro com o código antigo e carregado a página com o novo. Formato
 * desconhecido é descartado, nunca interpretado a esmo.
 */
const VERSAO = 1;

/** Rascunho mais velho que isto é lixo de aba longa, não contexto. */
const VALIDADE_MS = 6 * 60 * 60 * 1000;

/** O que a tela de origem guarda ao sair para criar. */
export interface ContextualCreateRequest {
  version: number;
  token: string;
  /** `pathname` + `search` de onde se saiu. Sempre interno. */
  originRoute: string;
  /** Qual campo pediu a criação — é ele que recebe a seleção na volta. */
  fieldKey: string;
  /** `customer`, `product`, `supplier`, `item`… Guarda contra volta trocada. */
  entityType: string;
  /** Estado serializável do formulário de origem. Nada de autenticação. */
  draft: Record<string, unknown>;
  /** Contexto extra da origem: a linha da tabela, o tipo exigido pelo campo. */
  context?: Record<string, unknown>;
  createdAt: number;
}

/** O que a tela de criação devolve depois de salvar. */
export interface ContextualCreateResult {
  entityType: string;
  /** Sempre o id. Casar por nome selecionaria o registro errado. */
  entityId: string;
  /** Só para exibir enquanto a entidade real não foi carregada. */
  label: string;
}

export interface ContextualCreateRecord extends ContextualCreateRequest {
  result?: ContextualCreateResult;
}

/** Parâmetro que leva o token À tela de criação. */
export const PARAM_ORIGEM = "origem";
/** Parâmetro que traz o token DE VOLTA à tela de origem. */
export const PARAM_RETOMAR = "retomar";

/*
 * `sessionStorage` lança em contexto sem armazenamento (janela anônima com
 * site data bloqueado, alguns embeds). Falhar o fluxo inteiro por causa disso
 * seria pior que perder o rascunho: sem armazenamento a criação contextual
 * simplesmente não guarda nada e a navegação continua funcionando.
 */
function armazenamento(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function chave(token: string) {
  return `${PREFIXO}${token}`;
}

/**
 * Só rota interna volta.
 *
 * `originRoute` sai do estado da aba, mas o token viaja na URL e a URL é
 * editável. Sem esta guarda, `?origem=` apontando para um registro forjado
 * transformaria o botão "Voltar" num redirecionamento para fora do sistema —
 * a forma clássica de fazer uma tela confiável entregar o usuário a outra.
 *
 * Aceita só caminho absoluto de uma barra. `//host` é protocol-relative e sai
 * do site; `\` é normalizado para `/` por alguns navegadores e serve para o
 * mesmo truque.
 */
export function isRotaInterna(rota: unknown): rota is string {
  if (typeof rota !== "string" || rota.length === 0) return false;
  if (!rota.startsWith("/")) return false;
  if (rota.startsWith("//") || rota.startsWith("/\\")) return false;
  if (rota.includes("\\")) return false;
  // `javascript:`, `data:` e afins nunca começam com `/`, mas um caminho com
  // `:` antes da primeira barra seria lido como esquema por alguns parsers.
  const primeiroSegmento = rota.slice(1).split(/[/?#]/)[0] ?? "";
  return !primeiroSegmento.includes(":");
}

function valido(registro: unknown, agora: number): registro is ContextualCreateRecord {
  if (!registro || typeof registro !== "object") return false;
  const r = registro as Partial<ContextualCreateRecord>;
  if (r.version !== VERSAO) return false;
  if (!r.token || !r.fieldKey || !r.entityType) return false;
  if (!isRotaInterna(r.originRoute)) return false;
  if (typeof r.createdAt !== "number") return false;
  if (agora - r.createdAt > VALIDADE_MS) return false;
  return true;
}

function ler(token: string, agora = Date.now()): ContextualCreateRecord | null {
  const store = armazenamento();
  if (!store) return null;
  try {
    const bruto = store.getItem(chave(token));
    if (!bruto) return null;
    const registro = JSON.parse(bruto) as unknown;
    if (!valido(registro, agora)) {
      // Vencido, forjado ou de formato antigo: sai do armazenamento em vez de
      // ficar esperando uma leitura futura que também vai rejeitá-lo.
      store.removeItem(chave(token));
      return null;
    }
    return registro;
  } catch {
    return null;
  }
}

function gravar(registro: ContextualCreateRecord) {
  const store = armazenamento();
  if (!store) return;
  try {
    store.setItem(chave(registro.token), JSON.stringify(registro));
  } catch {
    // Cota estourada: o rascunho se perde, a navegação não.
  }
}

function apagar(token: string) {
  const store = armazenamento();
  if (!store) return;
  try {
    store.removeItem(chave(token));
    if (store.getItem(CHAVE_ATIVO) === token) store.removeItem(CHAVE_ATIVO);
  } catch {
    // sem armazenamento
  }
}

function novoToken(): string {
  const cripto = globalThis.crypto;
  if (cripto?.randomUUID) return cripto.randomUUID();
  // Ambientes sem `randomUUID` (jsdom antigo): a colisão aqui só afetaria
  // duas criações contextuais simultâneas na mesma aba.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Varre rascunhos vencidos.
 *
 * A limpeza normal acontece no retorno. Este é o caso da aba que ficou aberta
 * a semana inteira e acumulou saídas que nunca voltaram.
 */
export function pruneContextualCreates(agora = Date.now()) {
  const store = armazenamento();
  if (!store) return;
  try {
    const vencidos: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (!k?.startsWith(PREFIXO) || k === CHAVE_ATIVO) continue;
      try {
        if (!valido(JSON.parse(store.getItem(k) ?? "") as unknown, agora)) vencidos.push(k);
      } catch {
        vencidos.push(k);
      }
    }
    for (const k of vencidos) store.removeItem(k);
    const ativo = store.getItem(CHAVE_ATIVO);
    if (ativo && vencidos.includes(chave(ativo))) store.removeItem(CHAVE_ATIVO);
  } catch {
    // Sem armazenamento não há o que limpar.
  }
}

/** A tela de origem sai para criar. Devolve o token a pôr na URL de destino. */
export function startContextualCreate(pedido: {
  originRoute: string;
  fieldKey: string;
  entityType: string;
  draft: Record<string, unknown>;
  context?: Record<string, unknown>;
}): string | null {
  // Origem que não é rota interna não vira contexto: o retorno seria uma
  // navegação para fora do sistema.
  if (!isRotaInterna(pedido.originRoute)) return null;

  pruneContextualCreates();
  const token = novoToken();
  gravar({ ...pedido, version: VERSAO, token, createdAt: Date.now() });
  try {
    armazenamento()?.setItem(CHAVE_ATIVO, token);
  } catch {
    // O ponteiro é conveniência para o botão Voltar; sem ele o fluxo pela
    // URL continua inteiro.
  }
  return token;
}

/** A tela de criação lê o contexto — sem consumir, porque pode haver refresh. */
export function readContextualCreate(
  token: string | null | undefined,
): ContextualCreateRecord | null {
  return token ? ler(token) : null;
}

/**
 * O token da criação em andamento cuja origem é esta rota.
 *
 * Serve ao botão Voltar do navegador, que chega à origem sem o parâmetro de
 * retomada. Confere a rota para não restaurar na tela errada o rascunho de
 * outro formulário.
 */
export function findPendingForRoute(pathname: string): string | null {
  const store = armazenamento();
  if (!store) return null;
  try {
    const token = store.getItem(CHAVE_ATIVO);
    if (!token) return null;
    const registro = ler(token);
    if (!registro) return null;
    return registro.originRoute.split("?")[0] === pathname ? token : null;
  } catch {
    return null;
  }
}

/**
 * A tela de criação salvou. Registra o resultado para a origem selecionar.
 *
 * Não navega: quem decide para onde voltar é `originRoute`, e quem navega é a
 * tela de criação, que sabe se o salvamento realmente terminou.
 */
export function finishContextualCreate(token: string, result: ContextualCreateResult) {
  const registro = ler(token);
  if (!registro) return;
  gravar({ ...registro, result });
}

/**
 * A tela de origem retomou.
 *
 * Devolve o registro e o `commit` que apaga o contexto. A remoção é separada
 * de propósito: só depois de o formulário ter restaurado o rascunho de fato é
 * que o contexto pode sumir — apagar antes perderia o rascunho se a
 * restauração falhasse no meio.
 */
export function takeContextualCreate(token: string | null | undefined): {
  record: ContextualCreateRecord;
  commit: () => void;
} | null {
  if (!token) return null;
  const record = ler(token);
  if (!record) return null;
  return { record, commit: () => apagar(token) };
}

/** Cancelamento ou abandono: some com o contexto sem produzir resultado. */
export function discardContextualCreate(token: string | null | undefined) {
  if (token) apagar(token);
}

/** A URL da tela de criação, já com o token. */
export function createRouteWithContext(rota: string, token: string): string {
  const separador = rota.includes("?") ? "&" : "?";
  return `${rota}${separador}${PARAM_ORIGEM}=${encodeURIComponent(token)}`;
}

/** A URL de volta para a origem, já com o token. */
export function originRouteWithReturn(registro: ContextualCreateRequest): string {
  const separador = registro.originRoute.includes("?") ? "&" : "?";
  return `${registro.originRoute}${separador}${PARAM_RETOMAR}=${encodeURIComponent(registro.token)}`;
}
