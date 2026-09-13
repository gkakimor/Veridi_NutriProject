/**
 * Roteiro mínimo para ordens de E2E — PRODUCTION-ROUTE-ASSIGNMENT-01.
 *
 * Desde essa capability a Ordem de Produção sem roteiro não planeja nem
 * libera. Caminhos de E2E cujo assunto não é o roteiro (golden path, busca de
 * produto) precisam de uma ordem que siga adiante: esta função cria um roteiro
 * de uma etapa na unidade da própria ordem, ativa a V1 e a aplica na ordem —
 * pela MESMA rota que a tela usa, com a sessão do navegador.
 *
 * @param {(caminho: string, init?: RequestInit) => Promise<{ status: number, corpo: any }>} api
 * @param {string} productionOrderId
 * @param {{ unidade: string, nome: string }} opcoes
 */
export async function aplicarRoteiroNaOrdem(api, productionOrderId, { unidade, nome }) {
  const exigir = (resposta, descricao) => {
    if (resposta.status >= 400) throw new Error(`${descricao} → ${resposta.status}`);
    return resposta.corpo;
  };

  const perfil = exigir(
    await api("/production-profiles", {
      method: "POST",
      body: JSON.stringify({ name: nome, referenceQuantity: "1", referenceUomCode: unidade }),
    }),
    "POST /production-profiles",
  );
  const versaoId = perfil.draftVersion.id;

  exigir(
    await api(`/production-profile-versions/${versaoId}`, {
      method: "PATCH",
      body: JSON.stringify({
        steps: [
          {
            name: "Produção",
            setupDurationMinutes: 0,
            runDurationMinutes: 1,
            scalingMode: "PROPORTIONAL",
            resources: [],
          },
        ],
      }),
    }),
    "PATCH /production-profile-versions/:id",
  );
  exigir(
    await api(`/production-profile-versions/${versaoId}/activate`, { method: "POST" }),
    "POST /production-profile-versions/:id/activate",
  );

  return exigir(
    await api(`/production-orders/${productionOrderId}/production-profile`, {
      method: "POST",
      body: JSON.stringify({ productionProfileVersionId: versaoId }),
    }),
    "POST /production-orders/:id/production-profile",
  );
}
