import { formatQuantity } from "../../lib/quantity";
import { useEffect, useMemo, useState } from "react";
import type {
  FormulationTemplateDTO,
  FormulationTemplateSummaryDTO,
  FormulationTemplateVersionDTO,
} from "@veridi/shared";
import {
  FORMULATION_CALCULATION_MODE_LABELS,
  SUPPLY_RESPONSIBILITY_LABELS,
} from "@veridi/shared";
import {
  getFormulationTemplate,
  listFormulationTemplates,
} from "../../lib/formulation-templates-api";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";

/**
 * Escolher um template da biblioteca, direto da tela do produto.
 *
 * Quem já usou uma fórmula parecida para outro cliente precisa reaproveitá-la
 * onde está trabalhando — obrigar a passar pela Biblioteca primeiro faria a
 * pessoa perder o contexto do produto no meio do caminho.
 *
 * A revisão antes de aplicar não é cerimônia: aplicar copia a matriz inteira
 * para dentro do produto, e é mais barato conferir a composição agora do que
 * descobrir a troca depois de calcular custo em cima dela.
 */

interface Props {
  onCancel: () => void;
  onApply: (templateVersionId: string) => void;
  saving: boolean;
}

export function UseTemplateDialog({ onCancel, onApply, saving }: Props) {
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [templates, setTemplates] = useState<FormulationTemplateSummaryDTO[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<FormulationTemplateDTO | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => setTermo(busca), 300);
    return () => clearTimeout(handle);
  }, [busca]);

  useEffect(() => {
    setCarregando(true);
    listFormulationTemplates(termo ? { search: termo, pageSize: 30 } : { pageSize: 30 })
      .then((result) => setTemplates(result.templates))
      .catch((err: unknown) =>
        setErro(err instanceof Error ? err.message : "Falha ao carregar a biblioteca"),
      )
      .finally(() => setCarregando(false));
  }, [termo]);

  /*
   * Só matriz com versão ATIVA aparece para uso. Um template que só tem
   * rascunho ainda não foi revisado por ninguém — oferecê-lo aqui deixaria a
   * pessoa copiar trabalho em andamento sem saber.
   */
  const disponiveis = useMemo(
    () => templates.filter((template) => template.activeVersionId !== null),
    [templates],
  );

  const versaoAtiva: FormulationTemplateVersionDTO | null = selecionado?.activeVersion ?? null;

  return (
    <FullWorkspaceModal
      open
      onClose={onCancel}
      crumb="Produção / Templates de Formulação"
      crumbActive="Usar template"
      title="Usar template da biblioteca"
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
          {selecionado && versaoAtiva && (
            <button
              type="button"
              className="btn btn--accent"
              disabled={saving}
              onClick={() => onApply(versaoAtiva.id)}
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
                <label htmlFor="template-busca">Buscar template</label>
                <input
                  id="template-busca"
                  type="search"
                  autoFocus
                  placeholder="Código FT, nome ou componente…"
                  value={busca}
                  onChange={(event) => setBusca(event.target.value)}
                />
                <p className="field__hint">
                  A busca também encontra pelo item que compõe a fórmula.
                </p>
              </div>

              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Nome</th>
                      <th>Versão</th>
                      <th className="is-numeric">Componentes</th>
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
                        <td className="is-numeric">{template.componentCount}</td>
                        <td>
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() =>
                              void getFormulationTemplate(template.id)
                                .then(setSelecionado)
                                .catch((err: unknown) =>
                                  setErro(
                                    err instanceof Error ? err.message : "Falha ao abrir",
                                  ),
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
                        <td colSpan={5} className="table__empty">
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
          ) : versaoAtiva ? (
            <>
              <dl className="definition-list">
                <dt>Template</dt>
                <dd>
                  <code>{selecionado.code}</code> · {versaoAtiva.versionLabel}
                </dd>
                <dt>Nome</dt>
                <dd>{selecionado.name}</dd>
                {selecionado.description && (
                  <>
                    <dt>Descrição</dt>
                    <dd>{selecionado.description}</dd>
                  </>
                )}
                <dt>Base</dt>
                <dd>
                  {formatQuantity(versaoAtiva.basisQuantity)} {versaoAtiva.outputUnitCode}
                </dd>
                <dt>Modo de cálculo</dt>
                <dd>{FORMULATION_CALCULATION_MODE_LABELS[versaoAtiva.calculationMode]}</dd>
                {versaoAtiva.dosesPerPackage !== null && (
                  <>
                    <dt>Doses por embalagem</dt>
                    <dd>{versaoAtiva.dosesPerPackage}</dd>
                  </>
                )}
                <dt>Componentes</dt>
                <dd>{versaoAtiva.components.length}</dd>
              </dl>

              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="is-numeric">Quantidade</th>
                      <th>Unidade</th>
                      <th>Fornecimento padrão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versaoAtiva.components.map((component) => (
                      <tr key={component.id}>
                        <td>
                          {component.itemCode} — {component.itemName}
                        </td>
                        <td className="is-numeric">{formatQuantity(component.quantity)}</td>
                        <td>{component.unitCode}</td>
                        <td>{SUPPLY_RESPONSIBILITY_LABELS[component.supplyResponsibility]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="field__hint">
                O fornecimento padrão é uma sugestão do template: depois de aplicado, você pode
                mudar item a item neste produto sem alterar a biblioteca.
              </p>
            </>
          ) : (
            <p className="field__hint">Este template não tem versão ativa.</p>
          )}
      </div>
    </FullWorkspaceModal>
  );
}
