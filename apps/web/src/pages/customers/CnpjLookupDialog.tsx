import { Fragment, useId, useState } from "react";
import type { CnpjLookupProvider, CnpjLookupResult } from "@veridi/shared";
import {
  CNPJ_LOOKUP_DISCLAIMER,
  CNPJ_LOOKUP_PROVIDERS,
  CNPJ_LOOKUP_PROVIDER_LABELS,
  DEFAULT_CNPJ_LOOKUP_PROVIDER,
  formatCnpj,
} from "@veridi/shared";
import { BulkSelectionCheckbox } from "../../components/BulkSelection";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { formatDateTime } from "../../lib/dates";
import { lookupCnpj } from "../../lib/cnpj-lookup-api";
import {
  compararComOCadastro,
  selecaoInicial,
  valoresParaAplicar,
} from "./cnpj-lookup-fields";
import type {
  CampoDaConsultaDeCnpj,
  LinhaDaComparacao,
  ValoresDoFormulario,
} from "./cnpj-lookup-fields";

/**
 * Consultar CNPJ — CUSTOMER-CNPJ-LOOKUP-01.
 *
 * Duas etapas dentro do mesmo diálogo:
 *
 * 1. **Fonte** — qual base consultar, e o botão que consulta. A fonte fica
 *    explícita mesmo havendo uma só: o conceito de provedor é do produto, não
 *    um detalhe de implementação, e quando o SERPRO existir ele entra nesta
 *    lista sem que a tela mude de forma. Fonte que ainda não responde não
 *    aparece aqui, nem desabilitada.
 * 2. **Comparação** — Atual × Retornado, campo a campo, com a caixa de aplicar
 *    em cada diferença.
 *
 * Nada é aplicado sozinho, e NADA é gravado: "Aplicar selecionados" mexe no
 * estado do formulário, e o cadastro continua exigindo "Salvar". Cancelar,
 * fechar no ✕ e Escape saem sem tocar em campo nenhum.
 */

type Etapa = "fonte" | "resultado";

type Situacao =
  | { tipo: "parado" }
  | { tipo: "consultando" }
  /** CNPJ não encontrado ou fonte indisponível — o cadastro manual segue de pé. */
  | { tipo: "recado"; texto: string };

/** A linha informativa que a fonte trouxe e o Cliente NÃO guarda. */
function informacaoComplementar(resultado: CnpjLookupResult): [string, string][] {
  const { company } = resultado;
  const cnae = [company.mainCnaeCode, company.mainCnaeDescription].filter(Boolean).join(" — ");
  return (
    [
      ["Situação cadastral na fonte", company.registrationStatus],
      ["Início de atividade", company.openedAt],
      ["CNAE principal", cnae || null],
      ["Natureza jurídica", company.legalNature],
      ["Porte", company.companySize],
    ] as [string, string | null][]
  )
    .filter((par): par is [string, string] => par[1] !== null && par[1] !== "")
    .map(([rotulo, valor]) => [rotulo, valor]);
}

/** O que a coluna "OpenCNPJ" mostra quando não há o que aplicar. */
function recadoDaLinha(linha: LinhaDaComparacao): string {
  if (linha.situacao === "sem_valor") return "Não informado pela fonte";
  if (linha.situacao === "igual") return "Sem alteração";
  return linha.motivo ?? "";
}

export function CnpjLookupDialog({
  cnpj,
  valoresAtuais,
  onClose,
  onApply,
}: {
  /** O CNPJ do formulário, já validado por quem abriu o diálogo. */
  cnpj: string;
  /** O estado do FORMULÁRIO agora — não o registro salvo (§8 do handoff). */
  valoresAtuais: ValoresDoFormulario;
  onClose: () => void;
  /** Recebe só os campos marcados. Quem hospeda escreve no formulário. */
  onApply: (valores: Partial<ValoresDoFormulario>) => void;
}) {
  const idBase = useId();
  const [provider, setProvider] = useState<CnpjLookupProvider>(DEFAULT_CNPJ_LOOKUP_PROVIDER);
  const [etapa, setEtapa] = useState<Etapa>("fonte");
  const [situacao, setSituacao] = useState<Situacao>({ tipo: "parado" });
  const [resultado, setResultado] = useState<CnpjLookupResult | null>(null);
  const [linhas, setLinhas] = useState<LinhaDaComparacao[]>([]);
  const [marcados, setMarcados] = useState<ReadonlySet<CampoDaConsultaDeCnpj>>(() => new Set());

  const consultando = situacao.tipo === "consultando";
  const fonte = CNPJ_LOOKUP_PROVIDER_LABELS[provider];

  async function consultar() {
    // Clique duplo não dispara duas consultas ao serviço público.
    if (consultando) return;
    setSituacao({ tipo: "consultando" });

    const desfecho = await lookupCnpj(cnpj, provider);

    if (desfecho.status !== "found") {
      // A consulta falhou e o formulário continua exatamente como estava:
      // preenchimento assistido nunca pode impedir o cadastro manual.
      setSituacao({ tipo: "recado", texto: desfecho.message });
      return;
    }

    const comparacao = compararComOCadastro(valoresAtuais, desfecho.result.company);
    setResultado(desfecho.result);
    setLinhas(comparacao);
    setMarcados(selecaoInicial(comparacao));
    setSituacao({ tipo: "parado" });
    setEtapa("resultado");
  }

  function alternar(campo: CampoDaConsultaDeCnpj) {
    setMarcados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(campo)) proximo.delete(campo);
      else proximo.add(campo);
      return proximo;
    });
  }

  function aplicar() {
    onApply(valoresParaAplicar(linhas, marcados));
  }

  const aplicaveis = linhas.filter((linha) => linha.situacao === "aplicavel");
  const nenhumaDiferenca = etapa === "resultado" && aplicaveis.length === 0;
  const idDoMotivo = (campo: string) => `${idBase}-motivo-${campo}`;

  const rodape =
    etapa === "fonte" ? (
      <>
        <span className="modal-fullscreen__foot-meta">
          Consultar não altera o cadastro. Você escolhe o que aplicar.
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--accent"
            onClick={() => void consultar()}
            disabled={consultando}
          >
            {consultando ? "Consultando…" : "Consultar"}
          </button>
        </div>
      </>
    ) : (
      <>
        <span className="modal-fullscreen__foot-meta">
          {nenhumaDiferenca
            ? "Nada a aplicar."
            : `${marcados.size} de ${aplicaveis.length} ${aplicaveis.length === 1 ? "diferença marcada" : "diferenças marcadas"}. Depois de aplicar, salve o cadastro.`}
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--accent"
            onClick={aplicar}
            disabled={marcados.size === 0}
          >
            Aplicar selecionados
          </button>
        </div>
      </>
    );

  return (
    <FullWorkspaceModal
      open
      onClose={onClose}
      crumb="Cadastros / Clientes"
      crumbActive="Consultar CNPJ"
      title="Consultar CNPJ"
      codeChip={formatCnpj(cnpj)}
      closeHint="Fecha sem alterar o cadastro"
      footer={rodape}
    >
      <div className="cnpj-lookup">
        {/* A frase de proveniência aparece nas DUAS etapas: antes, para dizer o
            que se vai buscar; depois, para dizer o que se está lendo. */}
        <p className="cnpj-lookup__aviso">{CNPJ_LOOKUP_DISCLAIMER}</p>

        {etapa === "fonte" && (
          <>
            <div className="field field--narrow">
              <label htmlFor={`${idBase}-provider`}>Fonte da consulta</label>
              <select
                id={`${idBase}-provider`}
                value={provider}
                disabled={consultando}
                onChange={(event) => setProvider(event.target.value as CnpjLookupProvider)}
              >
                {CNPJ_LOOKUP_PROVIDERS.map((opcao) => (
                  <option key={opcao} value={opcao}>
                    {CNPJ_LOOKUP_PROVIDER_LABELS[opcao]}
                  </option>
                ))}
              </select>
              <p className="field__hint">
                Base pública de dados empresariais. A consulta não valida a empresa
                juridicamente e não classifica o perfil tributário.
              </p>
            </div>

            {situacao.tipo === "consultando" && (
              <p className="field__hint" role="status">
                Consultando {fonte}…
              </p>
            )}

            {situacao.tipo === "recado" && (
              <p className="form-alert" role="alert">
                {situacao.texto}
              </p>
            )}
          </>
        )}

        {etapa === "resultado" && resultado && (
          <>
            <p className="cnpj-lookup__proveniencia">
              <span>
                Fonte: <b>{CNPJ_LOOKUP_PROVIDER_LABELS[resultado.provider]}</b>
              </span>
              <span>Consultado em: {formatDateTime(resultado.consultedAt)}</span>
            </p>

            {nenhumaDiferenca ? (
              <p className="field__hint" role="status">
                A fonte não trouxe nenhum dado diferente do que já está no formulário.
              </p>
            ) : null}

            <div className="table-container">
              <table className="table table--cnpj-lookup">
                <thead>
                  <tr>
                    <th className="table__select table__select--bulk">
                      <span className="sr-only">Aplicar</span>
                    </th>
                    <th className="col-flex">Campo</th>
                    <th className="col-flex">Atual</th>
                    <th className="col-flex">
                      {CNPJ_LOOKUP_PROVIDER_LABELS[resultado.provider]}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((linha) => {
                    const aplicavel = linha.situacao === "aplicavel";
                    const recado = recadoDaLinha(linha);
                    return (
                      <tr key={linha.campo}>
                        <td className="table__select table__select--bulk">
                          {aplicavel ? (
                            <BulkSelectionCheckbox
                              label={`Aplicar ${linha.rotulo}`}
                              checked={marcados.has(linha.campo)}
                              onChange={() => alternar(linha.campo)}
                            />
                          ) : (
                            <span className="sr-only">
                              {`${linha.rotulo}: ${recado}`}
                            </span>
                          )}
                        </td>
                        <td className="col-flex" data-label="Campo">
                          {linha.rotulo}
                        </td>
                        <td className="col-flex" data-label="Atual">
                          {linha.atual.trim() === "" ? "—" : linha.atual}
                        </td>
                        <td className="col-flex" data-label="Retornado">
                          {/* O valor SEMPRE aparece quando a fonte informou —
                              inclusive quando não dá para aplicar. Esconder o
                              que a fonte disse deixaria a pessoa sem saber o
                              que ela está deixando de usar. */}
                          {linha.situacao === "sem_valor" ? (
                            <span className="cell-sub">{recado}</span>
                          ) : (
                            <>
                              <div>{linha.retornado}</div>
                              {!aplicavel && (
                                <div className="cell-sub" id={idDoMotivo(linha.campo)}>
                                  {recado}
                                </div>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {informacaoComplementar(resultado).length > 0 && (
              <section className="cnpj-lookup__complemento">
                <h3 className="cnpj-lookup__complemento-titulo">
                  Outras informações da fonte
                </h3>
                {/* Não viram campo do Cliente: o perfil tributário continua
                    sendo classificação informada pela Veridi, nunca deduzida
                    do CNAE, do porte ou da natureza jurídica. */}
                {/* `dt`/`dd` são filhos DIRETOS: a `.definition-list` é um grid
                    de duas colunas sobre eles, e um `<div>` no meio desmonta
                    o alinhamento rótulo × valor. */}
                <dl className="definition-list">
                  {informacaoComplementar(resultado).map(([rotulo, valor]) => (
                    <Fragment key={rotulo}>
                      <dt>{rotulo}</dt>
                      <dd>{valor}</dd>
                    </Fragment>
                  ))}
                </dl>
                <p className="field__hint">
                  Informativo. Estes dados não preenchem campos do cadastro e não definem
                  o perfil tributário.
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </FullWorkspaceModal>
  );
}
