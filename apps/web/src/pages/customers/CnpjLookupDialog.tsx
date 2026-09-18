import { useId, useState } from "react";
import type { CnpjLookupProvider, CnpjLookupResult, CnpjRegistrationField } from "@veridi/shared";
import {
  CNPJ_LOOKUP_DISCLAIMER,
  CNPJ_LOOKUP_PROVIDERS,
  CNPJ_LOOKUP_PROVIDER_LABELS,
  DEFAULT_CNPJ_LOOKUP_PROVIDER,
  formatCnpj,
} from "@veridi/shared";
import { FullWorkspaceModal } from "../../components/FullWorkspaceModal";
import { formatDateTime } from "../../lib/dates";
import { lookupCnpj } from "../../lib/cnpj-lookup-api";
import {
  VERBO_DA_ESCOLHA,
  compararComOCadastro,
  compararDadosDoCnpj,
  dadosDoCnpjParaAplicar,
  linhaSelecionavel,
  selecaoInicial,
  valoresParaAplicar,
} from "./cnpj-lookup-fields";
import type {
  AplicacaoDaConsultaDeCnpj,
  CampoDaConsultaDeCnpj,
  LinhaDaComparacao,
  LinhaDosDadosDoCnpj,
  ValoresDoFormulario,
  ValoresDosDadosDoCnpj,
} from "./cnpj-lookup-fields";

/**
 * Consultar CNPJ — §111 e §122 (CUSTOMER-CNPJ-LOOKUP-01,
 * CUSTOMER-CNPJ-EDITABLE-HISTORY-01).
 *
 * Duas etapas dentro do mesmo diálogo:
 *
 * 1. **Fonte** — qual base consultar, e o botão que consulta. A fonte fica
 *    explícita mesmo havendo uma só: o conceito de provedor é do produto, e
 *    quando o SERPRO existir ele entra nesta lista sem que a tela mude.
 * 2. **Comparação** — Atual × Retornado, campo a campo: primeiro os campos do
 *    cadastro, depois os dados cadastrais do CNPJ. A consulta é ADITIVA: só o
 *    que completa um campo vazio nasce marcado; trocar o que já existe é
 *    "Substituir", e o equivalente pode ser marcado para "Confirmar".
 *
 * Nada é gravado: "Aplicar consulta ao cadastro" mexe no estado do formulário
 * — os campos marcados e a data desta consulta, mesmo sem nada marcado — e o
 * cadastro continua exigindo "Salvar". Cancelar, ✕ e Escape saem sem tocar em
 * nada, nem na data.
 */

type Etapa = "fonte" | "resultado";

type Situacao =
  | { tipo: "parado" }
  | { tipo: "consultando" }
  /** CNPJ não encontrado ou fonte indisponível — o cadastro manual segue de pé. */
  | { tipo: "recado"; texto: string };

type Linha = LinhaDaComparacao | LinhaDosDadosDoCnpj;

/** O que aparece embaixo do valor da fonte, quando há o que dizer. */
function recadoDaLinha(linha: Linha): string | null {
  switch (linha.situacao) {
    case "sem_valor":
      return "Não informado pela fonte";
    case "confirmar":
      return "Igual ao atual";
    case "nao_aplicavel":
      return "motivo" in linha ? (linha.motivo ?? null) : null;
    default:
      return null;
  }
}

/** Uma linha Atual × Retornado — a mesma para os dois grupos. */
function LinhaDaTabela({
  linha,
  marcada,
  onAlternar,
}: {
  linha: Linha;
  marcada: boolean;
  onAlternar: () => void;
}) {
  const recado = recadoDaLinha(linha);
  return (
    <tr>
      <td className="col-flex" data-label="Campo">
        {linha.rotulo}
      </td>
      <td className="col-flex" data-label="Atual">
        {linha.atual.trim() === "" ? "—" : linha.atual}
      </td>
      <td className="col-flex" data-label="Retornado">
        {/* O valor SEMPRE aparece quando a fonte informou — inclusive quando
            não dá para aplicar: esconder o que a fonte disse deixaria a
            pessoa sem saber o que está deixando de usar. */}
        <div>{linha.retornado.trim() === "" ? "—" : linha.retornado}</div>
        {recado && <div className="cell-sub">{recado}</div>}
      </td>
      <td className="col-flex cnpj-lookup__acao" data-label="Ação">
        {linhaSelecionavel(linha.situacao) ? (
          <label className="cnpj-lookup__escolha">
            <input
              type="checkbox"
              aria-label={`${VERBO_DA_ESCOLHA[linha.situacao]} ${linha.rotulo}`}
              checked={marcada}
              onChange={onAlternar}
            />
            <span aria-hidden="true">{VERBO_DA_ESCOLHA[linha.situacao]}</span>
          </label>
        ) : (
          <span className="sr-only">{`${linha.rotulo}: nada a aplicar`}</span>
        )}
      </td>
    </tr>
  );
}

/** Cabeçalho das duas tabelas: a coluna do retorno leva o nome da fonte. */
function CabecalhoDaComparacao({ fonte }: { fonte: string }) {
  return (
    <thead>
      <tr>
        <th className="col-flex">Campo</th>
        <th className="col-flex">Atual</th>
        <th className="col-flex">{fonte}</th>
        <th className="col-flex">Ação</th>
      </tr>
    </thead>
  );
}

function alternar<T>(campo: T) {
  return (atual: ReadonlySet<T>) => {
    const proximo = new Set(atual);
    if (proximo.has(campo)) proximo.delete(campo);
    else proximo.add(campo);
    return proximo;
  };
}

export function CnpjLookupDialog({
  cnpj,
  valoresAtuais,
  dadosDoCnpjAtuais,
  onClose,
  onApply,
}: {
  /** O CNPJ do formulário, já validado por quem abriu o diálogo. */
  cnpj: string;
  /** Os campos do cadastro como estão no FORMULÁRIO agora — não o registro salvo. */
  valoresAtuais: ValoresDoFormulario;
  /** Os dados cadastrais do CNPJ como estão no formulário agora. */
  dadosDoCnpjAtuais: ValoresDosDadosDoCnpj;
  onClose: () => void;
  /** Recebe o que foi marcado e a data da consulta. Quem hospeda escreve no formulário. */
  onApply: (aplicacao: AplicacaoDaConsultaDeCnpj) => void;
}) {
  const idBase = useId();
  const [provider, setProvider] = useState<CnpjLookupProvider>(DEFAULT_CNPJ_LOOKUP_PROVIDER);
  const [etapa, setEtapa] = useState<Etapa>("fonte");
  const [situacao, setSituacao] = useState<Situacao>({ tipo: "parado" });
  const [resultado, setResultado] = useState<CnpjLookupResult | null>(null);
  const [linhas, setLinhas] = useState<LinhaDaComparacao[]>([]);
  const [marcados, setMarcados] = useState<ReadonlySet<CampoDaConsultaDeCnpj>>(() => new Set());
  const [linhasDosDados, setLinhasDosDados] = useState<LinhaDosDadosDoCnpj[]>([]);
  const [dadosMarcados, setDadosMarcados] = useState<ReadonlySet<CnpjRegistrationField>>(
    () => new Set(),
  );

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
    const comparacaoDosDados = compararDadosDoCnpj(dadosDoCnpjAtuais, desfecho.result.company);
    setResultado(desfecho.result);
    setLinhas(comparacao);
    setMarcados(selecaoInicial(comparacao));
    setLinhasDosDados(comparacaoDosDados);
    setDadosMarcados(selecaoInicial(comparacaoDosDados));
    setSituacao({ tipo: "parado" });
    setEtapa("resultado");
  }

  function aplicar() {
    if (!resultado) return;
    onApply({
      valores: valoresParaAplicar(linhas, marcados),
      dadosDoCnpj: dadosDoCnpjParaAplicar(linhasDosDados, dadosMarcados, resultado.company),
      consultedAt: resultado.consultedAt,
      cnpj: resultado.cnpj,
    });
  }

  const todas: Linha[] = [...linhas, ...linhasDosDados];
  const oferecidas = todas.filter((linha) => linha.situacao === "preencher" || linha.situacao === "substituir");
  const totalMarcado = marcados.size + dadosMarcados.size;

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
          {totalMarcado === 0
            ? "Nada marcado: aplicar registra só a data desta consulta. Depois, salve o cadastro."
            : `${totalMarcado} ${totalMarcado === 1 ? "campo marcado" : "campos marcados"}. Depois de aplicar, salve o cadastro.`}
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          {/* Sempre disponível no resultado: aplicar sem nada marcado ainda
              registra que os dados foram conferidos nesta data. */}
          <button type="button" className="btn btn--accent" onClick={aplicar}>
            Aplicar consulta ao cadastro
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
                Base pública de dados empresariais. A consulta sugere: só completa o que
                estiver vazio, e troca o que já existe apenas se você marcar.
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

            {oferecidas.length === 0 ? (
              <p className="field__hint" role="status">
                A fonte não trouxe nada que complete ou mude o formulário.
              </p>
            ) : null}

            <div className="table-container">
              <table className="table table--cnpj-lookup">
                <CabecalhoDaComparacao fonte={CNPJ_LOOKUP_PROVIDER_LABELS[resultado.provider]} />
                <tbody>
                  {linhas.map((linha) => (
                    <LinhaDaTabela
                      key={linha.campo}
                      linha={linha}
                      marcada={marcados.has(linha.campo)}
                      onAlternar={() => setMarcados(alternar(linha.campo))}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Os dados cadastrais do CNPJ (§119, §122): mesmas regras — e
                nenhum deles define o perfil tributário (§83). */}
            <section className="cnpj-lookup__complemento">
              <h3 className="cnpj-lookup__complemento-titulo">Dados cadastrais do CNPJ</h3>
              <div className="table-container">
                <table className="table table--cnpj-lookup">
                  <CabecalhoDaComparacao fonte={CNPJ_LOOKUP_PROVIDER_LABELS[resultado.provider]} />
                  <tbody>
                    {linhasDosDados.map((linha) => (
                      <LinhaDaTabela
                        key={linha.campo}
                        linha={linha}
                        marcada={dadosMarcados.has(linha.campo)}
                        onAlternar={() => setDadosMarcados(alternar(linha.campo))}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="field__hint">
                Aplicados, ficam no formulário e só são registrados — no cadastro e no
                histórico — quando você salvar. Não definem o perfil tributário.
              </p>
            </section>
          </>
        )}
      </div>
    </FullWorkspaceModal>
  );
}
