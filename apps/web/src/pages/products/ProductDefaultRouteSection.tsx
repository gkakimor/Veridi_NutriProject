import { useEffect, useState } from "react";
import type { ProductProductionProfileDTO } from "@veridi/shared";
import { TEMPLATE_VERSION_STATUS_LABELS } from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";
import { FormSection } from "../../components/FormSection";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { apiErrorMessage } from "../../lib/api-errors";
import {
  getProductProductionProfile,
  listProductionProfiles,
  setProductProductionProfile,
} from "../../lib/production-profiles-api";
import { formatQuantity } from "../../lib/quantity";
import "../planning/planning.css";

/**
 * ROTEIRO PADRÃO DE PRODUÇÃO no cadastro do Produto — PRODUCTION-ROUTE-ASSIGNMENT-01.
 *
 * Mesmo ponteiro e mesma rota do lado do Roteiro (`PUT
 * /products/:productId/production-profile`): nenhum segundo caminho. A escolha
 * é pelo roteiro e grava a versão ativa dele; servir para a unidade do produto
 * quem decide é o servidor.
 *
 * Grava sozinho, com resposta própria, e fica fora da guarda de alterações do
 * formulário: escolher no campo ainda não é gravar, e "Salvar alterações" do
 * produto não mexe no roteiro.
 */

function opcao(profile: {
  code: string;
  name: string;
  activeVersionId: string | null;
  activeVersionNumber: number | null;
  referenceQuantity: string | null;
  referenceUomCode: string | null;
}): EntityOption | null {
  if (!profile.activeVersionId) return null;
  return {
    id: profile.activeVersionId,
    code: `${profile.code} · V${profile.activeVersionNumber}`,
    name: profile.name,
    ...(profile.referenceQuantity && profile.referenceUomCode
      ? { hint: `Referência: ${formatQuantity(profile.referenceQuantity)} ${profile.referenceUomCode}` }
      : {}),
  };
}

export function ProductDefaultRouteSection({ productId }: { productId: string }) {
  const sessao = useOptionalAuth();
  /* Fora do AuthProvider (teste de tela isolado) não há sessão para julgar. */
  const canEdit =
    sessao === null || sessao.user?.role === "ADMIN" || sessao.user?.role === "PRODUCTION";

  const [padrao, setPadrao] = useState<ProductProductionProfileDTO | null>(null);
  const [opcoes, setOpcoes] = useState<EntityOption[]>([]);
  const [escolhida, setEscolhida] = useState("");
  const [acao, setAcao] = useState<"definir" | "remover" | null>(null);
  const [feito, setFeito] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    getProductProductionProfile(productId)
      .then(setPadrao)
      .catch((err: unknown) => setErro(apiErrorMessage(err, "Não foi possível carregar o roteiro padrão.")));
  }, [productId]);

  useEffect(() => {
    if (!canEdit) return;
    listProductionProfiles({ activeOnly: true, pageSize: 20 })
      .then((resposta) => setOpcoes(resposta.profiles.map(opcao).filter((o): o is EntityOption => o !== null)))
      .catch(() => setOpcoes([]));
  }, [canEdit]);

  const buscar = async (termo: string) => {
    const resposta = await listProductionProfiles({ activeOnly: true, search: termo, pageSize: 20 });
    const achadas = resposta.profiles.map(opcao).filter((o): o is EntityOption => o !== null);
    setOpcoes((atuais) => {
      const porId = new Map(atuais.map((o) => [o.id, o]));
      for (const o of achadas) porId.set(o.id, o);
      return [...porId.values()];
    });
    return achadas;
  };

  async function gravar(versionId: string | null) {
    setAcao(versionId === null ? "remover" : "definir");
    setErro(null);
    setFeito(null);
    try {
      const atualizado = await setProductProductionProfile(productId, versionId);
      setPadrao(atualizado);
      setEscolhida("");
      setFeito(versionId === null ? "Roteiro padrão removido." : "Roteiro padrão atualizado.");
    } catch (err) {
      setErro(apiErrorMessage(err, "Não foi possível gravar o roteiro padrão."));
    } finally {
      setAcao(null);
    }
  }

  const versao = padrao?.version ?? null;

  return (
    <FormSection
      title="Roteiro padrão de produção"
      subtitle="O roteiro padrão é aplicado automaticamente às novas ordens de produção. Ordens existentes não são alteradas."
    >
      {erro && (
        <p className="form-alert" role="alert">
          {erro}
        </p>
      )}

      {padrao && !versao && <p className="field__hint">Nenhum roteiro padrão definido.</p>}

      {versao && (
        <dl className="profile-summary" role="group" aria-label="Roteiro padrão do produto">
          <div>
            <dt>Nome do roteiro</dt>
            <dd>
              {versao.profileName} <span className="field__hint">{versao.profileCode}</span>
            </dd>
          </div>
          <div>
            <dt>Versão ativa</dt>
            <dd>
              V{versao.versionNumber}
              {versao.status !== "ACTIVE" ? ` · ${TEMPLATE_VERSION_STATUS_LABELS[versao.status]}` : ""}
            </dd>
          </div>
          <div>
            <dt>Quantidade de referência</dt>
            <dd>{formatQuantity(versao.referenceQuantity)}</dd>
          </div>
          <div>
            <dt>Unidade</dt>
            <dd>{versao.referenceUomCode}</dd>
          </div>
        </dl>
      )}

      {canEdit && padrao && (
        <div className="planning-product-picker">
          <div className="field">
            <label htmlFor="product-default-route">{versao ? "Trocar por" : "Roteiro"}</label>
            <SearchableEntitySelect
              id="product-default-route"
              options={opcoes}
              value={escolhida}
              onChange={setEscolhida}
              onSearch={buscar}
              placeholder="Digite o código ou o nome do roteiro…"
              noOptionsMessage="Nenhum roteiro com versão ativa encontrado."
            />
            {padrao.productUomCode && (
              <p className="field__hint">
                A quantidade de referência precisa converter para a unidade do produto ({padrao.productUomCode}).
              </p>
            )}
          </div>
          <div className="route-block__actions">
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={!escolhida || acao !== null}
              onClick={() => void gravar(escolhida)}
            >
              {acao === "definir" ? "Salvando…" : versao ? "Trocar roteiro padrão" : "Definir roteiro padrão"}
            </button>
            {versao && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={acao !== null}
                onClick={() => void gravar(null)}
              >
                {acao === "remover" ? "Removendo…" : "Remover roteiro padrão"}
              </button>
            )}
          </div>
        </div>
      )}

      {feito && (
        <p className="form-status" role="status">
          {feito}
        </p>
      )}
    </FormSection>
  );
}
