import { formatQuantity } from "../../lib/quantity";
import { useEffect, useMemo, useState } from "react";
import type { CostTemplateDTO, CostTemplateSummaryDTO } from "@veridi/shared";
import {
  ENERGY_CALCULATION_MODE_LABELS,
  INDUSTRIAL_COST_BASIS_LABELS,
  INDUSTRIAL_RATE_UOM_LABELS,
  INDUSTRIAL_USAGE_BASIS_LABELS,
} from "@veridi/shared";
import { getCostTemplate, listCostTemplates } from "../../lib/cost-pricing-templates-api";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";

/**
 * Escolher um template de estrutura, direto da tela de custos do produto.
 *
 * A prévia mostra configuração e só configuração: quantas horas de cada
 * recurso, qual modo de energia, quais premissas. Nenhuma tarifa aparece —
 * mostrar "R$ 88/h" aqui daria a impressão de que o número faz parte do
 * template, e ele muda com o cadastro do recurso e com a data.
 */

interface Props {
  onCancel: () => void;
  onApply: (costTemplateVersionId: string) => void;
  saving: boolean;
}

export function UseCostTemplateDialog({ onCancel, onApply, saving }: Props) {
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [templates, setTemplates] = useState<CostTemplateSummaryDTO[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<CostTemplateDTO | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setTermo(busca), 300);
    return () => clearTimeout(handle);
  }, [busca]);

  useEffect(() => {
    setCarregando(true);
    listCostTemplates(termo ? { search: termo, pageSize: 30 } : { pageSize: 30 })
      .then((result) => setTemplates(result.templates))
      .catch((err: unknown) =>
        setErro(err instanceof Error ? err.message : "Falha ao carregar a biblioteca"),
      )
      .finally(() => setCarregando(false));
  }, [termo]);

  // Só matriz revisada entra num produto: rascunho é trabalho em curso.
  const disponiveis = useMemo(
    () => templates.filter((template) => template.activeVersionId !== null),
    [templates],
  );
  const versao = selecionado?.activeVersion ?? null;

  return (
    <FullWorkspaceModal
      open
      onClose={onCancel}
      crumb="Gestão / Templates de Estrutura de Custos"
      crumbActive="Usar template"
      title="Usar template de estrutura"
      footer={
        <>
          {selecionado && (
            <button type="button" className="btn btn--ghost" onClick={() => setSelecionado(null)}>
              ← Escolher outro
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancelar
          </button>
          {selecionado && versao && (
            <button
              type="button"
              className="btn btn--accent"
              disabled={saving}
              onClick={() => onApply(versao.id)}
            >
              Usar este template
            </button>
          )}
        </>
      }
    >
      <div>
        {erro && <p className="form-alert" role="alert">{erro}</p>}

        {!selecionado ? (
          <>
            <div className="field">
              <label htmlFor="tec-busca">Buscar template</label>
              <input
                id="tec-busca"
                type="search"
                autoFocus
                placeholder="Código TEC, nome ou recurso…"
                value={busca}
                onChange={(event) => setBusca(event.target.value)}
              />
              <p className="field__hint">A busca também encontra pelo recurso configurado.</p>
            </div>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Nome</th>
                    <th>Versão</th>
                    <th className="is-numeric">Base</th>
                    <th className="is-numeric">Recursos</th>
                    <th aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {disponiveis.map((template) => (
                    <tr key={template.id}>
                      <td>
                        <code>{template.code}</code>
                      </td>
                      <td>{template.name}</td>
                      <td>V{template.activeVersionNumber}</td>
                      <td className="is-numeric">
                        {formatQuantity(template.referenceOutputQuantity)} {template.referenceOutputUomCode}
                      </td>
                      <td className="is-numeric">{template.resourceCount}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() =>
                            void getCostTemplate(template.id)
                              .then(setSelecionado)
                              .catch((err: unknown) =>
                                setErro(err instanceof Error ? err.message : "Falha ao abrir"),
                              )
                          }
                        >
                          Revisar
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!carregando && disponiveis.length === 0 && (
                    <tr>
                      <td colSpan={6} className="table__empty">
                        {termo
                          ? "Nenhum template ativo encontrado para esta busca."
                          : "A biblioteca ainda não tem nenhum template ativo."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : versao ? (
          <>
            <dl className="definition-list">
              <dt>Template</dt>
              <dd>
                <code>{selecionado.code}</code> · {versao.versionLabel}
              </dd>
              <dt>Nome</dt>
              <dd>{selecionado.name}</dd>
              <dt>Base de produção do template</dt>
              <dd>
                {formatQuantity(versao.referenceOutputQuantity)} {versao.referenceOutputUomCode}
              </dd>
              <dt>Energia</dt>
              <dd>
                {ENERGY_CALCULATION_MODE_LABELS[versao.energyCalculationMode]}
                {versao.energyResourceName ? ` — ${versao.energyResourceName}` : ""}
              </dd>
            </dl>

            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Recurso</th>
                    <th className="is-numeric">Uso</th>
                    <th>Unidade</th>
                    <th>Modo</th>
                  </tr>
                </thead>
                <tbody>
                  {versao.resourceUsages.map((usage) => (
                    <tr key={usage.id}>
                      <td>
                        {usage.resourceCode} — {usage.resourceName}
                      </td>
                      <td className="is-numeric">{formatQuantity(usage.usageQuantity)}</td>
                      <td>{INDUSTRIAL_RATE_UOM_LABELS[usage.usageUom]}</td>
                      <td>{INDUSTRIAL_USAGE_BASIS_LABELS[usage.usageBasis]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {versao.additionalCosts.length > 0 && (
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Premissa</th>
                      <th>Base de cálculo</th>
                      <th className="is-numeric">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versao.additionalCosts.map((cost) => (
                      <tr key={cost.id}>
                        <td>{cost.description}</td>
                        <td>{INDUSTRIAL_COST_BASIS_LABELS[cost.calculationBasis]}</td>
                        <td className="is-numeric">{cost.rateValue ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="field__hint">
              O template define o uso dos recursos. As tarifas — valor da hora, da energia — vêm do
              cadastro na data de cada cálculo, e não são copiadas para cá.
            </p>
            {/* A tela de custos oferece um campo de base de produção que este
                fluxo não usa: quem aplicava um template com 300 digitado
                recebia a estrutura com a base 150 do template e não entendia
                por quê. A regra continua a mesma — o template manda —, o que
                muda é dizê-la antes. */}
            <p className="field__hint">
              A estrutura será criada com a base do template ({formatQuantity(versao.referenceOutputQuantity)}{" "}
              {versao.referenceOutputUomCode}). Você pode ajustá-la no rascunho antes de ativar.
            </p>
          </>
        ) : (
          <p className="field__hint">Este template não tem versão ativa.</p>
        )}
      </div>
    </FullWorkspaceModal>
  );
}
