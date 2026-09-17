import { formatIntegerPtBr, formatPercentPtBr } from "../../lib/numeric-ptbr";
import { OPCOES_PERCENTUAL_TECNICO } from "../../lib/numeric-scales";
import { formatQuantity } from "../../lib/quantity";
import { useEffect, useMemo, useState } from "react";
import type {
  FormulationComponentIssueDTO,
  FormulationTemplateComponentDTO,
  FormulationTemplateDTO,
  FormulationTemplateSummaryDTO,
  FormulationTemplateVersionDTO,
} from "@veridi/shared";
import {
  DOSAGE_FORM_LABELS,
  FORMULATION_CALCULATION_MODE_LABELS,
  PRESENTATION_TYPE_LABELS,
  SECAO_DA_FORMULA_LABELS,
  SUPPLY_RESPONSIBILITY_LABELS,
  secaoDoItem,
} from "@veridi/shared";
import {
  getFormulationTemplate,
  listFormulationTemplates,
} from "../../lib/formulation-templates-api";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { TableEmptyRow } from "../../components/TableEmptyRow";

/**
 * Escolher um modelo da biblioteca, direto da tela do produto.
 *
 * Quem já usou uma fórmula parecida para outro cliente precisa reaproveitá-la
 * onde está trabalhando — obrigar a passar pela Biblioteca primeiro faria a
 * pessoa perder o contexto do produto no meio do caminho.
 *
 * A revisão antes de aplicar não é cerimônia: aplicar copia a matriz inteira
 * para dentro do produto, e é mais barato conferir a composição agora do que
 * descobrir a troca depois de calcular custo em cima dela.
 *
 * PRÉ-CHECAGEM (FORMULATION-TEMPLATE-WORKBENCH-01, fatia 3, decisão D-6): o que
 * o cadastro do Item invalidou na versão ativa aparece AQUI, com cada item
 * nomeado, antes do clique. Aplicar continua possível — o rascunho da
 * Formulação é o lugar de corrigir uma matriz antiga —, e a ativação dela
 * continua fechada até a correção.
 */

interface Props {
  onCancel: () => void;
  onApply: (templateVersionId: string) => void;
  saving: boolean;
}

/** O motivo de cada pendência, curto, para a marca da linha. */
const MARCA_DO_PROBLEMA: Record<FormulationComponentIssueDTO["code"], string> = {
  ITEM_INACTIVE: "Inativo",
  ITEM_IS_FINISHED_PRODUCT: "Produto acabado",
  ITEM_TYPE_NOT_COMPONENT: "Tipo fora da receita",
  UOM_INCOMPATIBLE: "Unidade incompatível",
  INVALID_QUANTITY: "Quantidade inválida",
};

const ID_DO_AVISO = "usar-modelo-pendencias";

/** Composição antes da embalagem — a mesma ordem da bancada. */
function emOrdemDaBancada(
  componentes: readonly FormulationTemplateComponentDTO[],
): FormulationTemplateComponentDTO[] {
  const daComposicao = componentes.filter((c) => secaoDoItem(c.itemType) === "COMPOSICAO");
  const daEmbalagem = componentes.filter((c) => secaoDoItem(c.itemType) === "EMBALAGEM");
  return [...daComposicao, ...daEmbalagem];
}

function percentual(valor: string | null): string {
  return valor === null ? "—" : formatPercentPtBr(valor, OPCOES_PERCENTUAL_TECNICO);
}

/** As premissas que viajam com a receita — só as que a matriz declarou. */
function PremissasDaVersao({ versao }: { versao: FormulationTemplateVersionDTO }) {
  return (
    <>
      <dt>Forma do produto</dt>
      <dd>{versao.dosageForm ? DOSAGE_FORM_LABELS[versao.dosageForm] : "Não informada"}</dd>
      {versao.presentationType && (
        <>
          <dt>Apresentação comercial</dt>
          <dd>{PRESENTATION_TYPE_LABELS[versao.presentationType]}</dd>
        </>
      )}
      {versao.capsulesPerDose !== null && (
        <>
          <dt>Cápsulas por dose</dt>
          <dd>{formatIntegerPtBr(versao.capsulesPerDose)}</dd>
        </>
      )}
      {versao.doseAmount !== null && (
        <>
          <dt>Dose</dt>
          <dd>
            {formatQuantity(versao.doseAmount)} {versao.doseUomCode ?? ""}
          </dd>
        </>
      )}
      {versao.packageContentAmount !== null && (
        <>
          <dt>Conteúdo da embalagem</dt>
          <dd>
            {formatQuantity(versao.packageContentAmount)} {versao.packageContentUomCode ?? ""}
          </dd>
        </>
      )}
      {versao.dosesPerPackage !== null && (
        <>
          <dt>Doses por embalagem</dt>
          <dd>{formatIntegerPtBr(versao.dosesPerPackage)}</dd>
        </>
      )}
      <dt>Perda prevista de produção</dt>
      <dd>
        {versao.expectedLossPercent === null ? "Não informada" : percentual(versao.expectedLossPercent)}
      </dd>
    </>
  );
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
   * Só matriz com versão ATIVA aparece para uso. Um modelo que só tem
   * rascunho ainda não foi revisado por ninguém — oferecê-lo aqui deixaria a
   * pessoa copiar trabalho em andamento sem saber.
   */
  const disponiveis = useMemo(
    () => templates.filter((template) => template.activeVersionId !== null),
    [templates],
  );

  const versaoAtiva: FormulationTemplateVersionDTO | null = selecionado?.activeVersion ?? null;
  const pendencias = versaoAtiva?.componentIssues ?? [];
  const pendenciasPorItem = new Map<string, FormulationComponentIssueDTO[]>();
  for (const pendencia of pendencias) {
    pendenciasPorItem.set(pendencia.itemId, [
      ...(pendenciasPorItem.get(pendencia.itemId) ?? []),
      pendencia,
    ]);
  }

  return (
    <FullWorkspaceModal
      open
      onClose={onCancel}
      crumb="Cadastros e Configurações / Modelos de Formulação"
      crumbActive="Usar modelo"
      title="Usar modelo da biblioteca"
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
              /* Com pendência o gesto continua o mesmo, e diz o que faz: o
                 aviso fica ligado ao botão para quem navega por leitor. */
              {...(pendencias.length > 0 ? { "aria-describedby": ID_DO_AVISO } : {})}
              onClick={() => onApply(versaoAtiva.id)}
            >
              {pendencias.length > 0 ? "Usar mesmo assim" : "Usar este modelo"}
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
                <label htmlFor="template-busca">Buscar modelo</label>
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
                        <td className="is-numeric">{formatIntegerPtBr(template.componentCount)}</td>
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
                      <TableEmptyRow colSpan={5}>
                        {termo
                          ? "Nenhum modelo ativo encontrado para esta busca."
                          : "A biblioteca ainda não tem nenhum modelo ativo."}
                      </TableEmptyRow>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : versaoAtiva ? (
            <>
              {/* ANTES da composição e antes do botão: quem vai copiar a matriz
                  precisa saber o que dela o cadastro já não aceita. */}
              {pendencias.length > 0 && (
                <div className="pendency-panel" id={ID_DO_AVISO} role="alert">
                  <h4 className="pendency-panel__title">
                    {pendencias.length === 1
                      ? "1 item deste modelo precisa de revisão"
                      : `${pendencias.length} itens deste modelo precisam de revisão`}
                  </h4>
                  <p className="pendency-panel__sub">
                    A formulação nasce em rascunho com a receita como está no modelo. Ela só poderá
                    ser ativada depois que estes itens forem corrigidos no rascunho.
                  </p>
                  <ul className="pendency-panel__list">
                    {pendencias.map((pendencia) => (
                      <li key={`${pendencia.code}-${pendencia.itemId}`}>
                        {pendencia.description} ({pendencia.itemName})
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <dl className="definition-list">
                <dt>Modelo</dt>
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
                <PremissasDaVersao versao={versaoAtiva} />
                <dt>Base</dt>
                <dd>
                  {formatQuantity(versaoAtiva.basisQuantity)} {versaoAtiva.outputUnitCode}
                </dd>
                <dt>Modo de cálculo</dt>
                <dd>{FORMULATION_CALCULATION_MODE_LABELS[versaoAtiva.calculationMode]}</dd>
                <dt>Componentes</dt>
                <dd>{versaoAtiva.components.length}</dd>
              </dl>

              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Seção</th>
                      <th className="is-numeric">Quantidade</th>
                      <th className="is-numeric">Pureza (%)</th>
                      <th className="is-numeric">Reserva (%)</th>
                      <th>Fornecimento padrão</th>
                    </tr>
                  </thead>
                  <tbody>
                    {emOrdemDaBancada(versaoAtiva.components).map((component) => {
                      const secao = secaoDoItem(component.itemType);
                      const daLinha = pendenciasPorItem.get(component.itemId) ?? [];
                      return (
                        <tr key={component.id}>
                          <td>
                            <span>
                              {component.itemCode} — {component.itemName}
                            </span>
                            {daLinha.map((pendencia) => (
                              <span key={pendencia.code}>
                                {" "}
                                <span className="badge badge--warn">
                                  {MARCA_DO_PROBLEMA[pendencia.code]}
                                </span>
                              </span>
                            ))}
                          </td>
                          <td>{SECAO_DA_FORMULA_LABELS[secao]}</td>
                          <td className="is-numeric">
                            {formatQuantity(component.quantity)} {component.unitCode}
                          </td>
                          {/* Embalagem não tem pureza nem reserva. */}
                          <td className="is-numeric">
                            {secao === "COMPOSICAO" ? percentual(component.purityPercentApplied) : "—"}
                          </td>
                          <td className="is-numeric">
                            {secao === "COMPOSICAO" ? percentual(component.overagePercent) : "—"}
                          </td>
                          <td>{SUPPLY_RESPONSIBILITY_LABELS[component.supplyResponsibility]}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="field__hint">
                O fornecimento padrão é uma sugestão do modelo: depois de aplicado, você pode mudar
                item a item neste produto sem alterar a biblioteca. Pureza, reserva e premissas
                chegam como estão no modelo e seguem editáveis enquanto a formulação for rascunho.
              </p>
            </>
          ) : (
            <p className="field__hint">Este modelo não tem versão ativa.</p>
          )}
      </div>
    </FullWorkspaceModal>
  );
}
