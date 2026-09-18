import { useId, useState } from "react";
import type {
  CnpjLookupProvider,
  CnpjLookupResult,
  CnpjRegistrationField,
  CustomerCnpjRegistration,
} from "@veridi/shared";
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
  compararDadosDoCnpj,
  dadosDoCnpjParaAplicar,
  selecaoInicial,
  selecaoInicialDosDadosDoCnpj,
  valoresParaAplicar,
} from "./cnpj-lookup-fields";
import type {
  AplicacaoDaConsultaDeCnpj,
  CampoDaConsultaDeCnpj,
  LinhaDaComparacao,
  LinhaDosDadosDoCnpj,
  ValoresDoFormulario,
} from "./cnpj-lookup-fields";

/**
 * Consultar CNPJ — CUSTOMER-CNPJ-LOOKUP-01, com os dados cadastrais de
 * CUSTOMER-CNPJ-PERSISTED-DATA-01 (§119).
 *
 * Duas etapas dentro do mesmo diálogo:
 *
 * 1. **Fonte** — qual base consultar, e o botão que consulta. A fonte fica
 *    explícita mesmo havendo uma só: o conceito de provedor é do produto, não
 *    um detalhe de implementação, e quando o SERPRO existir ele entra nesta
 *    lista sem que a tela mude de forma. Fonte que ainda não responde não
 *    aparece aqui, nem desabilitada.
 * 2. **Comparação** — Atual × Retornado, campo a campo, com a caixa de aplicar
 *    em cada diferença: primeiro os campos do cadastro, depois os dados
 *    cadastrais do CNPJ (CNAE, porte, Simples, MEI, situação…).
 *
 * Nada é aplicado sozinho, e NADA é gravado: "Aplicar consulta ao cadastro"
 * mexe no estado do formulário — os campos marcados e o bloco dos dados
 * cadastrais com a data desta consulta, mesmo quando nada mudou — e o
 * cadastro continua exigindo "Salvar". Cancelar, fechar no ✕ e Escape saem
 * sem tocar em campo nenhum nem na data da consulta.
 */

type Etapa = "fonte" | "resultado";

type Situacao =
  | { tipo: "parado" }
  | { tipo: "consultando" }
  /** CNPJ não encontrado ou fonte indisponível — o cadastro manual segue de pé. */
  | { tipo: "recado"; texto: string };

/** O que a coluna "OpenCNPJ" mostra quando não há o que aplicar. */
function recadoDaLinha(linha: LinhaDaComparacao | LinhaDosDadosDoCnpj): string {
  if (linha.situacao === "sem_valor") return "Não informado pela fonte";
  if (linha.situacao === "igual") return "Sem alteração";
  return "motivo" in linha ? (linha.motivo ?? "") : "";
}

/** Uma linha da tabela Atual × Retornado — a mesma para os dois grupos. */
function LinhaDaTabela({
  linha,
  marcada,
  onAlternar,
  idDoMotivo,
}: {
  linha: LinhaDaComparacao | LinhaDosDadosDoCnpj;
  marcada: boolean;
  onAlternar: () => void;
  idDoMotivo: string;
}) {
  const aplicavel = linha.situacao === "aplicavel";
  const recado = recadoDaLinha(linha);
  return (
    <tr>
      <td className="table__select table__select--bulk">
        {aplicavel ? (
          <BulkSelectionCheckbox
            label={`Aplicar ${linha.rotulo}`}
            checked={marcada}
            onChange={onAlternar}
          />
        ) : (
          <span className="sr-only">{`${linha.rotulo}: ${recado}`}</span>
        )}
      </td>
      <td className="col-flex" data-label="Campo">
        {linha.rotulo}
      </td>
      <td className="col-flex" data-label="Atual">
        {linha.atual.trim() === "" ? "—" : linha.atual}
      </td>
      <td className="col-flex" data-label="Retornado">
        {/* O valor SEMPRE aparece quando a fonte informou — inclusive quando
            não dá para aplicar. Esconder o que a fonte disse deixaria a pessoa
            sem saber o que ela está deixando de usar. */}
        {linha.situacao === "sem_valor" ? (
          <span className="cell-sub">{recado}</span>
        ) : (
          <>
            <div>{linha.retornado}</div>
            {!aplicavel && (
              <div className="cell-sub" id={idDoMotivo}>
                {recado}
              </div>
            )}
          </>
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
        <th className="table__select table__select--bulk">
          <span className="sr-only">Aplicar</span>
        </th>
        <th className="col-flex">Campo</th>
        <th className="col-flex">Atual</th>
        <th className="col-flex">{fonte}</th>
      </tr>
    </thead>
  );
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
  /** O estado do FORMULÁRIO agora — não o registro salvo (§8 do handoff). */
  valoresAtuais: ValoresDoFormulario;
  /**
   * Os dados cadastrais que o formulário tem para ESTE CNPJ — `null` quando
   * não há, ou quando os que havia eram do CNPJ anterior e foram descartados.
   */
  dadosDoCnpjAtuais: CustomerCnpjRegistration | null;
  onClose: () => void;
  /** Recebe os campos marcados e o bloco dos dados cadastrais. Quem hospeda escreve no formulário. */
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
    setDadosMarcados(selecaoInicialDosDadosDoCnpj(comparacaoDosDados));
    setSituacao({ tipo: "parado" });
    setEtapa("resultado");
  }

  function alternar<T>(campo: T) {
    return (atual: ReadonlySet<T>) => {
      const proximo = new Set(atual);
      if (proximo.has(campo)) proximo.delete(campo);
      else proximo.add(campo);
      return proximo;
    };
  }

  function aplicar() {
    if (!resultado) return;
    onApply({
      valores: valoresParaAplicar(linhas, marcados),
      dadosDoCnpj: dadosDoCnpjParaAplicar(
        dadosDoCnpjAtuais,
        resultado,
        linhasDosDados,
        dadosMarcados,
      ),
      cnpj: resultado.cnpj,
    });
  }

  const aplicaveis =
    linhas.filter((linha) => linha.situacao === "aplicavel").length +
    linhasDosDados.filter((linha) => linha.situacao === "aplicavel").length;
  const totalMarcado = marcados.size + dadosMarcados.size;
  const nenhumaDiferenca = etapa === "resultado" && aplicaveis === 0;
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
            ? "Nenhuma diferença. Aplicar registra a data desta consulta; depois, salve o cadastro."
            : `${totalMarcado} de ${aplicaveis} ${aplicaveis === 1 ? "diferença marcada" : "diferenças marcadas"}. Depois de aplicar, salve o cadastro.`}
        </span>
        <div className="modal-fullscreen__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancelar
          </button>
          {/* Sempre disponível no resultado: aplicar sem diferença nenhuma
              ainda registra que os dados foram revistos nesta data. */}
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
                <CabecalhoDaComparacao fonte={CNPJ_LOOKUP_PROVIDER_LABELS[resultado.provider]} />
                <tbody>
                  {linhas.map((linha) => (
                    <LinhaDaTabela
                      key={linha.campo}
                      linha={linha}
                      marcada={marcados.has(linha.campo)}
                      onAlternar={() => setMarcados(alternar(linha.campo))}
                      idDoMotivo={idDoMotivo(linha.campo)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Os dados cadastrais do CNPJ (§119) ficam guardados no Cliente
                ao salvar, com a data desta consulta. Mesmas regras da tabela
                de cima — e nenhum deles define o perfil tributário (§83). */}
            <section className="cnpj-lookup__complemento">
              <h3 className="cnpj-lookup__complemento-titulo">Dados cadastrais do CNPJ</h3>
              <div className="table-container">
                <table className="table table--cnpj-lookup">
                  <CabecalhoDaComparacao
                    fonte={CNPJ_LOOKUP_PROVIDER_LABELS[resultado.provider]}
                  />
                  <tbody>
                    {linhasDosDados.map((linha) => (
                      <LinhaDaTabela
                        key={linha.campo}
                        linha={linha}
                        marcada={dadosMarcados.has(linha.campo)}
                        onAlternar={() => setDadosMarcados(alternar(linha.campo))}
                        idDoMotivo={idDoMotivo(linha.campo)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="field__hint">
                Ficam registrados no cadastro, com a data desta consulta, quando você salvar.
                Não definem o perfil tributário.
              </p>
            </section>
          </>
        )}
      </div>
    </FullWorkspaceModal>
  );
}
