import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  InternalConsumptionAvailabilityDTO,
  InternalConsumptionDTO,
  InternalConsumptionReversalDTO,
  ItemDTO,
} from "@veridi/shared";
import {
  COST_SOURCE_LABELS,
  INTERNAL_CONSUMPTION_REVERSAL_STATUS_LABELS,
  hojeComercial,
} from "@veridi/shared";
import { FormSection } from "../../components/FormSection";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { EntityLink } from "../../components/EntityLink";
import { ListStatusRow } from "../../components/ListStatusRow";
import { DecimalField } from "../../components/NumericField";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { apiErrorMessage } from "../../lib/api-errors";
import { formatDate, formatDateTime } from "../../lib/dates";
import {
  createInternalConsumption,
  getInternalConsumptionAvailability,
  listInternalConsumptions,
} from "../../lib/internal-consumption-api";
import { listItems } from "../../lib/items-api";
import { useListQuery } from "../../lib/list-query";
import { mensagemNumeroVazio } from "../../lib/decimal-field";
import { formatMoneyPtBr, numericInvalidMessage, parsePtBrNumber } from "../../lib/numeric-ptbr";
import { CASAS_QUANTIDADE, OPCOES_QUANTIDADE } from "../../lib/numeric-scales";
import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { formatQuantity, formatQuantityWithUnit } from "../../lib/quantity";
import { EstornarConsumoDialog } from "./EstornarConsumoDialog";
import { LinhaDeMarcacao } from "./inventario-seletores";
import {
  QUEM_ESTORNA_CONSUMO_INTERNO,
  QUEM_REGISTRA_CONSUMO_INTERNO,
  usePodeEstornarConsumo,
  usePodeRegistrarConsumo,
} from "./internal-consumption-permissions";

const PRIMEIRA_PAGINA = 50;
const PAGE_SIZE = 20;

/**
 * Estoque → Uso e consumo — INTERNAL-CONSUMPTION-01 (Fatia 2).
 *
 * Saída física real de material que a própria empresa usa: papelaria, higiene,
 * limpeza, administrativo. Não é ajuste — ajuste corrige um saldo errado, e
 * aqui o saldo estava certo e a empresa gastou o material.
 *
 * O saldo mostrado é o MESMO que o servidor confere ao gravar
 * (`/internal-consumptions/availability/:itemId`): uma segunda leitura faria a
 * tela prometer o que o confirmar recusa.
 *
 * Custo desconhecido aparece como "Custo não disponível", nunca R$ 0,00 —
 * zero é custo real zero, e a diferença entre os dois é a diferença entre uma
 * despesa que houve e uma que não houve.
 */
export function InternalConsumptionPage() {
  const podeRegistrar = usePodeRegistrarConsumo();
  const podeEstornar = usePodeEstornarConsumo();
  /* O consumo aberto no diálogo de estorno, e o último estorno confirmado. */
  const [estornando, setEstornando] = useState<InternalConsumptionDTO | null>(null);
  const [estornado, setEstornado] = useState<InternalConsumptionReversalDTO | null>(null);

  const [itens, setItens] = useState<ItemDTO[]>([]);
  const [itemId, setItemId] = useState("");
  const [lotId, setLotId] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [dia, setDia] = useState(() => hojeComercial());
  const [destino, setDestino] = useState("");
  const [observacao, setObservacao] = useState("");

  const [saldo, setSaldo] = useState<InternalConsumptionAvailabilityDTO | null>(null);
  const [carregandoSaldo, setCarregandoSaldo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [registrado, setRegistrado] = useState<InternalConsumptionDTO | null>(null);
  /* Recarrega o histórico depois de cada registro, sem sair da tela. */
  const [recarga, setRecarga] = useState(0);

  /*
   * A busca pede o tipo ao servidor. Filtrar no navegador ofereceria matéria-
   * prima na lista para a API recusar depois — a regra de quem pode sair por
   * consumo interno é do servidor, e a tela mostra só o que ele aceita.
   */
  const buscarItens = useCallback(async (termo: string): Promise<EntityOption[]> => {
    const resposta = await listItems({
      type: "INTERNAL_CONSUMABLE",
      ...(termo ? { search: termo } : {}),
      pageSize: PRIMEIRA_PAGINA,
    });
    setItens((atuais) => {
      const conhecidos = new Set(atuais.map((item) => item.id));
      const novos = resposta.items.filter((item) => !conhecidos.has(item.id));
      return novos.length === 0 ? atuais : [...atuais, ...novos];
    });
    return resposta.items.map(opcaoDoItem);
  }, []);

  useEffect(() => {
    listItems({ type: "INTERNAL_CONSUMABLE", active: true, pageSize: PRIMEIRA_PAGINA })
      .then((resposta) => setItens(resposta.items))
      .catch(() => setItens([]));
  }, []);

  /*
   * Trocar de item recomeça a escolha. A recarga do saldo NÃO passa por aqui
   * de propósito: depois de confirmar, o painel do consumo recém-registrado
   * — quantidade, custo e origem — é o que a pessoa precisa ler, e limpá-lo
   * junto com o saldo apagaria a única resposta da operação.
   */
  useEffect(() => {
    setLotId("");
    setErro(null);
    setRegistrado(null);
  }, [itemId]);

  /* O saldo: do item escolhido, e relido depois de cada consumo gravado. */
  useEffect(() => {
    setSaldo(null);
    if (!itemId) return;

    let vivo = true;
    setCarregandoSaldo(true);
    getInternalConsumptionAvailability(itemId)
      .then((resposta) => {
        if (vivo) setSaldo(resposta);
      })
      .catch((falha: unknown) => {
        if (vivo) setErro(apiErrorMessage(falha, "Falha ao carregar o saldo do item"));
      })
      .finally(() => {
        if (vivo) setCarregandoSaldo(false);
      });
    return () => {
      vivo = false;
    };
  }, [itemId, recarga]);

  const leitura = parsePtBrNumber(quantidade, OPCOES_QUANTIDADE);
  const quantidadeCanonica = leitura.tipo === "valido" ? leitura.valor : null;
  const erroDaQuantidade =
    leitura.tipo === "invalido"
      ? numericInvalidMessage("Quantidade", leitura.motivo, OPCOES_QUANTIDADE)
      : null;

  const controlaLote = saldo?.controlsLot ?? false;
  const lotes = saldo?.lots ?? [];
  const disponivelNoEscopo = controlaLote
    ? (lotes.find((lote) => lote.lotId === lotId)?.available ?? null)
    : (saldo?.available ?? null);

  const podeConfirmar =
    podeRegistrar &&
    Boolean(itemId) &&
    quantidadeCanonica !== null &&
    (!controlaLote || Boolean(lotId)) &&
    !salvando;

  const [pagina, setPagina] = useState(1);
  const consulta = useListQuery(
    listInternalConsumptions,
    { page: pagina, pageSize: PAGE_SIZE },
    { fallbackError: "Falha ao carregar os consumos" },
  );
  const consumos = consulta.data?.consumptions ?? [];
  const total = consulta.data?.total ?? 0;
  const totalDePaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function confirmar() {
    if (!itemId) return;
    if (quantidadeCanonica === null) {
      setErro(erroDaQuantidade ?? mensagemNumeroVazio("Quantidade"));
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const consumo = await createInternalConsumption({
        itemId,
        ...(controlaLote ? { lotId } : {}),
        quantity: quantidadeCanonica,
        occurredOn: dia,
        ...(destino.trim() ? { purpose: destino.trim() } : {}),
        ...(observacao.trim() ? { notes: observacao.trim() } : {}),
      });
      setRegistrado(consumo);
      setQuantidade("");
      setDestino("");
      setObservacao("");
      // O saldo mudou: reler é o que impede um segundo consumo sobre o número velho.
      setRecarga((atual) => atual + 1);
      consulta.reload();
    } catch (falha) {
      setErro(apiErrorMessage(falha, "Falha ao registrar o consumo"));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <div className="page__header">
        <div>
          <h1 className="page__title">Uso e consumo</h1>
          <p className="page__subtitle">
            Saída de material que a própria empresa usa — papelaria, higiene, limpeza,
            administrativo. Não é ajuste de estoque: o saldo estava certo e o material foi usado.
          </p>
        </div>
        {/* O histórico daqui rastreia; quem precisa gerir (valor por item, destino e
            período) vai ao relatório. */}
        <div className="table__actions">
          <Link className="btn btn--secondary btn--sm" to="/relatorios/estoque/uso-e-consumo">
            Relatório gerencial (R-21)
          </Link>
        </div>
      </div>

      {/* "Não é ajuste" no subtítulo diz o QUE; quem procura como corrigir
          um consumo errado precisa saber que o caminho é o estorno. */}
      <ContextHelp topic={helpTopics["estoque.usoEConsumo"]} />

      {!podeRegistrar && (
        <p className="callout" role="status">
          Seu perfil consulta o histórico, mas não registra consumo. Quem registra:{" "}
          {QUEM_REGISTRA_CONSUMO_INTERNO}.
        </p>
      )}

      {podeRegistrar && (
        <FormSection title="Registrar consumo">
          <div className="field-grid-2">
            <div className="field">
              <label htmlFor="consumo-item">
                Item de uso e consumo <span className="req">*</span>
              </label>
              <SearchableEntitySelect
                id="consumo-item"
                value={itemId}
                onChange={(escolhido) => setItemId(escolhido)}
                placeholder="Digite código ou nome do item…"
                options={itens.map(opcaoDoItem)}
                onSearch={buscarItens}
              />
              <span className="field__hint">
                Só item de uso e consumo sai por aqui. Matéria-prima e embalagem saem pela produção;
                produto acabado, pela expedição.
              </span>
            </div>

            <div className="field">
              <label>Disponível</label>
              <div className="field-readonly-value">
                {carregandoSaldo
                  ? "Carregando…"
                  : disponivelNoEscopo === null
                    ? "—"
                    : formatQuantityWithUnit(disponivelNoEscopo, saldo?.unitCode)}
              </div>
              {saldo && !saldo.itemActive && (
                <span className="field__hint">
                  Item inativo: o saldo que restou continua podendo ser usado até acabar.
                </span>
              )}
            </div>

            {controlaLote && (
              <fieldset className="field field--full">
                <legend>
                  Lote <span className="req">*</span>
                </legend>
                <div className="selection-group" role="group" aria-label="Lotes disponíveis">
                  {lotes.map((lote) => (
                    <LinhaDeMarcacao
                      key={lote.lotId}
                      tipo="radio"
                      nome="consumo-lote"
                      valor={lote.lotId}
                      marcado={lotId === lote.lotId}
                      aoMudar={() => setLotId(lote.lotId)}
                    >
                      {lote.lotCode} · validade {formatDate(lote.expiryDate)} · disponível{" "}
                      {formatQuantityWithUnit(lote.available, saldo?.unitCode)}
                    </LinhaDeMarcacao>
                  ))}
                </div>
                {lotes.length === 0 && !carregandoSaldo && (
                  <span className="field__hint">Nenhum lote disponível para este item.</span>
                )}
              </fieldset>
            )}

            <div className="field">
              <label htmlFor="consumo-quantidade">
                Quantidade <span className="req">*</span>
              </label>
              <DecimalField
                id="consumo-quantidade"
                scale={CASAS_QUANTIDADE}
                placeholder="0"
                value={quantidade}
                onChangeValue={setQuantidade}
                aria-invalid={erroDaQuantidade !== null || undefined}
              />
              {erroDaQuantidade && <p className="field__error">{erroDaQuantidade}</p>}
            </div>

            <div className="field">
              <label htmlFor="consumo-data">
                Data <span className="req">*</span>
              </label>
              <input
                id="consumo-data"
                type="date"
                value={dia}
                max={hojeComercial()}
                onChange={(evento) => setDia(evento.target.value)}
              />
              <span className="field__hint">
                Consumo é registro do que já aconteceu — data futura não é aceita.
              </span>
            </div>

            <div className="field">
              <label htmlFor="consumo-destino">Destino/uso</label>
              <input
                id="consumo-destino"
                type="text"
                maxLength={120}
                placeholder="Escritório, Limpeza, Produção, Expedição…"
                value={destino}
                onChange={(evento) => setDestino(evento.target.value)}
              />
              <span className="field__hint">Texto livre, opcional.</span>
            </div>

            <div className="field field--full">
              <label htmlFor="consumo-observacao">Observação</label>
              <textarea
                id="consumo-observacao"
                rows={2}
                maxLength={500}
                value={observacao}
                onChange={(evento) => setObservacao(evento.target.value)}
              />
            </div>
          </div>

          {erro && (
            <p className="form-alert" role="alert">
              {erro}
            </p>
          )}

          <div className="table__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={!podeConfirmar}
              onClick={confirmar}
            >
              {salvando ? "Registrando…" : "Confirmar consumo"}
            </button>
          </div>

          {registrado && <ConsumoRegistrado consumo={registrado} />}
        </FormSection>
      )}

      <FormSection title="Consumos registrados">
        {/* Consumo lançado errado se ESTORNA — nunca se edita nem se apaga.
            Quem estorna é lista própria: registrar não dá direito a desfazer. */}
        {!podeEstornar && (
          <p className="field__hint">
            Consumo lançado errado é estornado por {QUEM_ESTORNA_CONSUMO_INTERNO}, com motivo.
          </p>
        )}
        {estornado && <EstornoRegistrado estorno={estornado} />}
        <div className="table-container" aria-busy={consulta.loading || undefined}>
          <table className="table">
            <thead>
              <tr>
                <th className="col-tight">Data</th>
                <th className="col-tight">Consumo</th>
                <th className="col-flex">Item</th>
                <th className="col-tight">Lote</th>
                <th className="col-tight is-numeric">Quantidade</th>
                <th className="col-tight is-numeric">Estornado</th>
                <th className="col-tight">Situação</th>
                <th className="col-flex">Destino/uso</th>
                <th className="col-tight is-numeric">Custo unitário</th>
                <th className="col-tight is-numeric">Custo total</th>
                <th className="col-tight">Origem do custo</th>
                <th className="col-flex">Usuário</th>
                {podeEstornar && <th className="col-actions" aria-hidden="true" />}
              </tr>
            </thead>
            <tbody>
              {consumos.map((consumo) => (
                <tr key={consumo.id}>
                  <td className="col-tight">{formatDateTime(consumo.occurredAt)}</td>
                  <td className="col-tight is-code">{consumo.code}</td>
                  <td className="col-flex">
                    <EntityLink
                      kind="item"
                      id={consumo.itemId}
                      code={consumo.itemCode}
                      name={consumo.itemName}
                    />
                  </td>
                  <td className="col-tight is-code">
                    {consumo.lotId ? (
                      <EntityLink kind="lot" id={consumo.lotId} code={consumo.lotCode} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="col-tight is-numeric">
                    {formatQuantity(consumo.quantity)} {consumo.uomCode}
                  </td>
                  <td className="col-tight is-numeric">
                    {consumo.reversalStatus === "NOT_REVERSED"
                      ? "—"
                      : `${formatQuantity(consumo.reversedQuantity)} ${consumo.uomCode}`}
                  </td>
                  <td className="col-tight">{INTERNAL_CONSUMPTION_REVERSAL_STATUS_LABELS[consumo.reversalStatus]}</td>
                  <td className="col-flex">{consumo.purpose ?? "—"}</td>
                  <td className="col-tight is-numeric">{custoNaLinha(consumo.unitCost)}</td>
                  <td className="col-tight is-numeric">{custoNaLinha(consumo.totalCost)}</td>
                  <td className="col-tight">{COST_SOURCE_LABELS[consumo.costSource]}</td>
                  <td className="col-flex">{consumo.registeredByName}</td>
                  {podeEstornar && (
                    <td className="col-actions">
                      {/* Sem saldo estornável não há o que estornar: a ação some. */}
                      {consumo.reversalStatus !== "REVERSED" && (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => {
                            setEstornado(null);
                            setEstornando(consumo);
                          }}
                        >
                          Estornar
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}

              <ListStatusRow colSpan={podeEstornar ? 13 : 12} query={consulta} rowCount={consumos.length}>
                Nenhum consumo registrado.
              </ListStatusRow>
            </tbody>
          </table>
          {consulta.data && (
            <div className="table-foot">
              {formatIntegerPtBr(total)} {total === 1 ? "consumo" : "consumos"}
            </div>
          )}
        </div>

        {consulta.data && totalDePaginas > 1 && (
          <div className="pagination">
            <span>
              Página {pagina} de {totalDePaginas}
            </span>
            <div className="table__actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={pagina <= 1}
                onClick={() => setPagina(pagina - 1)}
              >
                Anterior
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={pagina >= totalDePaginas}
                onClick={() => setPagina(pagina + 1)}
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </FormSection>

      {estornando && (
        <EstornarConsumoDialog
          consumoId={estornando.id}
          consumoCode={estornando.code}
          onClose={() => setEstornando(null)}
          onEstornado={(estorno) => {
            setEstornando(null);
            setEstornado(estorno);
            // O saldo do item e a situação da linha mudaram: relê os dois.
            setRecarga((atual) => atual + 1);
            consulta.reload();
          }}
        />
      )}
    </>
  );
}

/** O estorno confirmado: código, quantidade devolvida e o custo que ele levou. */
function EstornoRegistrado({ estorno }: { estorno: InternalConsumptionReversalDTO }) {
  return (
    <div className="callout" role="status">
      <p>
        <strong>{estorno.code}</strong> registrado: {formatQuantity(estorno.quantity)} {estorno.uomCode} devolvidos ao
        estoque (estorno de {estorno.originalConsumptionCode}).
      </p>
      <p>
        {estorno.totalCost === null
          ? "Custo não disponível — o consumo original não tinha custo."
          : `Custo estornado ${formatMoneyPtBr(estorno.totalCost, { scale: 2 })}, copiado do consumo original.`}
      </p>
    </div>
  );
}

/** A marca de inativo vem do `active` do servidor (§107). */
function opcaoDoItem(item: ItemDTO): EntityOption {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    hint: item.active ? item.unitCode : `${item.unitCode} · Item inativo`,
  };
}

/**
 * Custo numa coluna: `null` é "não disponível", nunca R$ 0,00.
 *
 * O traço sozinho diria "vazio" e deixaria a leitura por conta de quem olha;
 * aqui a ausência é declarada, porque ela É a informação — a despesa existe e
 * o sistema não sabe quanto ela custou.
 */
function custoNaLinha(valor: string | null): string {
  return valor === null ? "Não disponível" : formatMoneyPtBr(valor, { scale: 4 });
}

/** O que foi gravado, logo abaixo do formulário: quantidade, custo e origem. */
function ConsumoRegistrado({ consumo }: { consumo: InternalConsumptionDTO }) {
  const semCusto = consumo.unitCost === null;
  return (
    <div className="callout" role="status">
      <p>
        <strong>{consumo.code}</strong> registrado: {formatQuantity(consumo.quantity)}{" "}
        {consumo.uomCode} de {consumo.itemCode} — {consumo.itemName}
        {consumo.lotCode ? ` (lote ${consumo.lotCode})` : ""}.
      </p>
      {semCusto ? (
        /* A frase, não o número: R$ 0,00 aqui viraria uma despesa real de zero
           na cabeça de quem lê, e o sistema não sabe quanto custou. */
        <p>
          <strong>Custo não disponível.</strong> Nenhuma compra com custo real deste item até a data
          do consumo.
        </p>
      ) : (
        <p>
          Custo unitário {formatMoneyPtBr(consumo.unitCost, { scale: 4 })} · custo total{" "}
          {formatMoneyPtBr(consumo.totalCost, { scale: 2 })} · origem{" "}
          {COST_SOURCE_LABELS[consumo.costSource]}
          {consumo.costDetails ? ` — ${consumo.costDetails}` : ""}
        </p>
      )}
    </div>
  );
}
