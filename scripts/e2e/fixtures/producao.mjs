import { exigir } from "./api.mjs";
import { carimbar } from "./run.mjs";

/**
 * Produção por API — pré-condição de suíte cujo assunto não é o roteiro nem a
 * Ordem de Produção.
 *
 * Desde PRODUCTION-ROUTE-ASSIGNMENT-01 a OP sem roteiro não planeja nem libera.
 * Caminho de E2E que só precisa de uma ordem que siga adiante cria um roteiro
 * de uma etapa na unidade da própria ordem, ativa a V1 e o aplica na ordem —
 * pelas MESMAS rotas que a tela usa.
 */

/** OP em rascunho do produto, com a formulação ATIVA atual e o carimbo nas observações. */
export async function criarOrdemDeProducao(api, run, { produto, quantidade = "100" } = {}) {
  if (!run?.carimbo) throw new Error("fixture sem execução: passe o run de criarRun()");
  if (!produto?.id) throw new Error("criarOrdemDeProducao exige o produto desta execução");
  const ordem = await exigir(api, "POST", "/production-orders", {
    productId: produto.id,
    plannedQuantity: String(quantidade),
    notes: `Massa E2E ${run.carimbo}`,
  });
  return { id: ordem.id, codigo: ordem.code, status: ordem.status, formulacaoId: ordem.formulationVersionId };
}

async function montarRoteiroAtivo(api, { unidade, nome }) {
  const perfil = await exigir(api, "POST", "/production-profiles", {
    name: nome,
    referenceQuantity: "1",
    referenceUomCode: unidade,
  });
  const versaoId = perfil.draftVersion?.id;
  if (!versaoId) throw new Error(`roteiro ${perfil.code} nasceu sem rascunho`);
  await exigir(api, "PATCH", `/production-profile-versions/${versaoId}`, {
    steps: [
      {
        name: "Produção",
        setupDurationMinutes: 0,
        runDurationMinutes: 1,
        scalingMode: "PROPORTIONAL",
        resources: [],
      },
    ],
  });
  await exigir(api, "POST", `/production-profile-versions/${versaoId}/activate`);
  const ativo = await exigir(api, "GET", `/production-profiles/${perfil.id}`);
  if (ativo.activeVersion?.id !== versaoId) throw new Error(`roteiro ${perfil.code}: a V1 não ficou ativa`);
  return { id: perfil.id, codigo: perfil.code, versaoId };
}

/** Roteiro de uma etapa, V1 ATIVA, com o nome carimbado pela execução. */
export async function criarRoteiroAtivo(api, run, { unidade, nome } = {}) {
  if (!run?.carimbo) throw new Error("fixture sem execução: passe o run de criarRun()");
  if (!unidade) throw new Error("criarRoteiroAtivo exige a unidade da ordem");
  const final = nome ?? carimbar(run, "Roteiro");
  if (!final.includes(run.carimbo)) throw new Error(`fixture: "${final}" não traz o carimbo ${run.carimbo}`);
  return montarRoteiroAtivo(api, { unidade, nome: final });
}

/** Aplica a versão de roteiro à ordem — devolve a ordem como o servidor a devolveu. */
export async function aplicarRoteiro(api, ordemId, versaoId) {
  return exigir(api, "POST", `/production-orders/${ordemId}/production-profile`, {
    productionProfileVersionId: versaoId,
  });
}

/** Planeja a ordem — devolve a ordem planejada. */
export async function planejarOrdem(api, ordemId) {
  return exigir(api, "POST", `/production-orders/${ordemId}/plan`);
}

/**
 * Compatibilidade de `lib/roteiro.mjs` (golden path e OP fora da primeira
 * página): cria o roteiro com o nome que a suíte já carimbou e aplica.
 *
 * @param {(caminho: string, init?: RequestInit) => Promise<{ status: number, corpo: any }>} api
 * @param {string} productionOrderId
 * @param {{ unidade: string, nome: string }} opcoes
 */
export async function aplicarRoteiroNaOrdem(api, productionOrderId, { unidade, nome }) {
  const { versaoId } = await montarRoteiroAtivo(api, { unidade, nome });
  return aplicarRoteiro(api, productionOrderId, versaoId);
}
