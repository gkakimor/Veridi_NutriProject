import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ItemDTO, StockCountHeldPositionDTO, StockCountResultDTO } from "@veridi/shared";
import { Decimal, textoDecimal } from "@veridi/shared";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
import { assinaturaDoDocumento, decimalComparavel, textoComparavel } from "../../lib/dirty-fields";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { EntityLink } from "../../components/EntityLink";
import { listItems } from "../../lib/items-api";
import { apiErrorMessage } from "../../lib/api-errors";
import { createQuickStockCount, isStockCountApiError } from "../../lib/stock-counts-api";
import { FormSection } from "../../components/FormSection";
import { mensagemNumeroVazio } from "../../lib/decimal-field";
import { formatDate } from "../../lib/dates";
import { numericInvalidMessage, parsePtBrNumber } from "../../lib/numeric-ptbr";
import { CASAS_QUANTIDADE, OPCOES_QUANTIDADE } from "../../lib/numeric-scales";
import { DecimalField } from "../../components/NumericField";
import { formatQuantityWithUnit } from "../../lib/quantity";
import { ContextHelp, InfoHint } from "../../components/help";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { helpHints, helpTopics } from "../../help/help-content";
import type { HelpHintId } from "../../help/help-content";
import { LinhaDeMarcacao, usePosicoesDoItem } from "./inventario-seletores";
import { diferencaComSinal, donoDaPosicao, situacaoDoLote } from "./stock-count-display";
import { QUEM_OPERA_INVENTARIO, usePodeOperarInventario } from "./stock-count-permissions";
import "./inventario-fisico.css";

/** ⓘ de um campo, lido do registro central — o texto nunca mora no JSX. */
function DicaDoCampo({ id }: { id: HelpHintId }) {
  const dica = helpHints[id];
  return <InfoHint label={dica.label}>{dica.text}</InfoHint>;
}

/**
 * Primeira página do catálogo — o que a lista mostra antes de digitar.
 *
 * Era 1000, e nem assim dava: o catálogo tem 2.729 itens ativos, então
 * 1.729 existiam e não apareciam na busca, sem aviso nenhum. Quem busca
 * agora pergunta ao servidor (`buscarItens`), que conhece o catálogo
 * inteiro — carregar mil registros só para filtrar no navegador deixou de
 * ter propósito.
 */
const PRIMEIRA_PAGINA = 50;

/**
 * Um formato só de rótulo: o da lista inicial e o da busca não podem divergir.
 * A marca de inativo vem do `active` que o servidor devolveu (§107).
 */
function opcaoDoItem(item: ItemDTO): EntityOption {
  return { id: item.id, code: item.code, name: item.name, ...(item.active ? {} : { hint: "Item inativo" }) };
}

/** "LT-000118 está no INV-000014" — a posição retida, sem saldo nenhum. */
function AvisoDeRetencao({ retida, rotulo }: { retida: StockCountHeldPositionDTO; rotulo: string }) {
  return (
    <p className="callout" role="note">
      <strong>{rotulo} está em contagem no </strong>
      <EntityLink kind="stockCount" id={retida.stockCountId} code={retida.stockCountCode} />
      <strong>.</strong> Registre a contagem lá: uma posição em inventário aberto não é contada por fora, e o saldo não é
      mostrado aqui.
    </p>
  );
}

type Recusa =
  | { tipo: "saldo-mudou"; mensagem: string }
  | { tipo: "retida"; mensagem: string; retida: StockCountHeldPositionDTO | null }
  | { tipo: "outra"; mensagem: string };

/**
 * Estoque → Inventário Físico → Contagem rápida. Nunca altera o saldo
 * diretamente — ao confirmar, grava o documento INV- QUICK e cria (no máximo)
 * um ajuste pela diferença.
 *
 * Desde a Fatia 2A do Inventário Físico mora em
 * `/estoque/inventario/contagem-rapida`, como ação da lista de inventários
 * (DU-2), e só quem opera inventário vê o formulário.
 *
 * Fatia 2B: as posições do item saem da PRÉVIA do inventário no modo com saldo,
 * que já separa a posição retida num inventário aberto — e a devolve sem saldo.
 * A tela sabe da retenção antes de mostrar qualquer saldo. O confirmar leva o
 * saldo que a tela mostrou (`expectedSystemQuantity`): se mudou, o servidor
 * recusa e nada é ajustado. A diferença é conta de `Decimal`, nunca `Number`.
 */
export function StockCountPage() {
  const navigate = useNavigate();
  const podeOperar = usePodeOperarInventario();

  const [items, setItems] = useState<ItemDTO[]>([]);
  const [itemId, setItemId] = useState("");
  /*
   * Derivado, não guardado em estado.
   *
   * O catálogo desta tela cresce durante o uso — cada busca no servidor traz
   * itens novos. Enquanto isto era um `useState` sincronizado por efeito com
   * `[itemId, items]`, uma busca feita DEPOIS de escolher o item disparava o
   * mesmo efeito e zerava lote, saldo e resultado de uma contagem já em
   * andamento. Lendo direto de `items`, só trocar de item reinicia a
   * contagem — que é a única coisa que deveria.
   */
  const selectedItem = items.find((item) => item.id === itemId) ?? null;

  const [lotId, setLotId] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [countedQuantity, setCountedQuantity] = useState("");
  const [reason, setReason] = useState("");

  const [saving, setSaving] = useState(false);
  const [recusa, setRecusa] = useState<Recusa | null>(null);
  const [result, setResult] = useState<StockCountResultDTO | null>(null);

  const posicoes = usePosicoesDoItem(podeOperar && itemId ? itemId : null, "ASSISTED", recarga);

  useEffect(() => {
    listItems({ active: true, pageSize: PRIMEIRA_PAGINA })
      .then((response) => setItems(response.items))
      .catch(() => setItems([]));
  }, []);

  /**
   * Busca no servidor, ativos e inativos (§107). Item inativo com saldo é
   * contável, como no Inventário Físico, e a busca que pedia `active: true`
   * o escondia embora a API aceitasse a contagem. Quem é elegível não se
   * decide aqui: é a prévia do item escolhido, que só traz posição de inativo
   * com saldo — a mesma regra do escopo de um inventário.
   *
   * A carga inicial segue só com ativos: é a lista antes de digitar, e o
   * inativo aparece quando procurado, marcado.
   *
   * O resultado entra no catálogo da tela porque tudo o que vem depois da
   * escolha é lido daqui: o rótulo do campo, `controlsLot` (que decide se a
   * tela pede lote) e a unidade mostrada ao lado do saldo. Sem a mesclagem,
   * escolher um item de fora da primeira página deixaria a tela sem saber o
   * que fazer com ele.
   */
  async function buscarItens(termo: string): Promise<EntityOption[]> {
    const resposta = await listItems({ search: termo, pageSize: PRIMEIRA_PAGINA });
    setItems((atual) => {
      const conhecidos = new Set(atual.map((item) => item.id));
      const novos = resposta.items.filter((item) => !conhecidos.has(item.id));
      return novos.length === 0 ? atual : [...atual, ...novos];
    });
    return resposta.items.map(opcaoDoItem);
  }

  useEffect(() => {
    setLotId("");
    setResult(null);
    setRecusa(null);
  }, [itemId]);

  const controlaLote = selectedItem?.controlsLot ?? false;
  const unidade = selectedItem?.unitCode ?? null;
  // Item sem lote: a posição é o item. Retida num inventário aberto, a prévia não a lista e não traz saldo.
  const retidaDoItem = !controlaLote ? (posicoes.retidas.find((retida) => retida.positionKey === itemId) ?? null) : null;
  const posicao = controlaLote
    ? (posicoes.posicoes.find((candidata) => candidata.lotId === lotId) ?? null)
    : (posicoes.posicoes.find((candidata) => candidata.lotId === null) ?? null);
  const systemQuantity = posicao?.balance ?? null;

  /*
   * A contagem passa pelo parser antes de virar conta.
   *
   * `Number("12,5")` é `NaN`, e numa tela cujo trabalho é achar divergência
   * de estoque isso era pior do que falhar: a "Diferença" aparecia como
   * `NaN`, `hasDifference` virava falso, e o campo Motivo — obrigatório
   * justamente quando há divergência — nem chegava a existir. A contagem
   * seguia como se batesse com o sistema.
   */
  const leituraDaContagem = parsePtBrNumber(countedQuantity, OPCOES_QUANTIDADE);
  const contagem = leituraDaContagem.tipo === "valido" ? leituraDaContagem.valor : null;
  const erroDaContagem =
    leituraDaContagem.tipo === "invalido"
      ? numericInvalidMessage("Contagem física", leituraDaContagem.motivo, OPCOES_QUANTIDADE)
      : null;
  const contagemIlegivel = erroDaContagem !== null;
  // Decimal do shared: a diferença é a mesma conta que o servidor faz.
  const difference =
    systemQuantity !== null && contagem !== null
      ? textoDecimal(new Decimal(contagem).minus(new Decimal(systemQuantity)))
      : null;
  const hasDifference = difference !== null && !new Decimal(difference).isZero();

  /**
   * A contagem como ela está na tela, em forma comparável.
   *
   * É o que a pessoa DIGITA: a contagem física e o motivo da divergência.
   *
   * Item e lote ficam de fora porque são ESCOPO, não trabalho — escolhê-los
   * custa um clique e não produz nada que se perca. Diferença, saldo do
   * sistema e "há divergência" também: os três são calculados a partir do que
   * já está aqui, e contá-los faria a mesma digitação pesar duas vezes.
   */
  const assinaturaAtual = assinaturaDoDocumento({
    countedQuantity: decimalComparavel(countedQuantity),
    reason: textoComparavel(reason),
  });

  const baseline = useRef<string | null>(null);
  if (baseline.current === null) baseline.current = assinaturaAtual;
  useUnsavedChangesGuard({
    isDirty: baseline.current !== assinaturaAtual,
    substantivo: "contagem",
    genero: "a",
  });

  async function handleConfirm() {
    if (!itemId || !posicao || systemQuantity === null) return;
    if (contagem === null) {
      setRecusa({ tipo: "outra", mensagem: erroDaContagem ?? mensagemNumeroVazio("Contagem física") });
      return;
    }
    setSaving(true);
    setRecusa(null);
    try {
      const response = await createQuickStockCount({
        itemId,
        ...(controlaLote ? { lotId } : {}),
        countedQuantity: contagem,
        ...(hasDifference ? { reason: reason.trim() } : {}),
        // O saldo que a tela mostrou: se mudou até aqui, o servidor recusa em vez de ajustar outra diferença.
        expectedSystemQuantity: systemQuantity,
      });
      /*
       * Confirmou: a contagem virou documento e, havendo divergência, ajuste
       * de estoque. O que está na tela passou a ser o que está gravado — sair
       * daqui não perde mais nada.
       */
      setResult(response);
      baseline.current = assinaturaAtual;
    } catch (err) {
      if (isStockCountApiError(err, "system_quantity_changed")) {
        setRecusa({ tipo: "saldo-mudou", mensagem: err.message });
      } else if (isStockCountApiError(err, "position_in_open_count")) {
        setRecusa({ tipo: "retida", mensagem: err.message, retida: err.body.held?.[0] ?? null });
        setRecarga((atual) => atual + 1);
      } else {
        setRecusa({ tipo: "outra", mensagem: apiErrorMessage(err, "Falha ao confirmar contagem") });
      }
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setItemId("");
    setCountedQuantity("");
    setReason("");
    setResult(null);
    setRecusa(null);
    // Nova contagem começa do zero: o ponto de partida é a tela limpa.
    baseline.current = null;
  }

  const canConfirm =
    itemId &&
    posicao !== null &&
    systemQuantity !== null &&
    contagem !== null &&
    recusa?.tipo !== "saldo-mudou" &&
    (!hasDifference || reason.trim().length >= 3);

  const lotesLivres = controlaLote ? posicoes.posicoes : [];
  const lotesRetidos = controlaLote ? posicoes.retidas : [];
  const semPosicao =
    Boolean(itemId) && !posicoes.carregando && !posicoes.erro && posicoes.posicoes.length === 0 && posicoes.retidas.length === 0;

  return (
    <>
      <div className="page__header">
        <div>
          <PageBreadcrumbs
            items={[{ label: "Inventário Físico", href: "/estoque/inventario" }, { label: "Contagem rápida" }]}
          />
          <h1 className="page__title">Contagem rápida</h1>
          <p className="page__subtitle">
            Uma posição, contada e confirmada na hora: a diferença vira ajuste rastreável — nunca sobrescreve o saldo.
          </p>
        </div>
        {/* FO-01: o operador leva o papel para o estoque e volta para
            registrar a contagem aqui. */}
        <div className="table__actions">
          <button
            type="button"
            className="btn btn--secondary"
            /* A folha de contagem é IMPRESSÃO do que está no sistema, e sair
               para ela é sair da tela: com contagem digitada, a guarda
               pergunta, como em qualquer outra saída. */
            onClick={() => navigate("/print/contagem-fisica")}
          >
            Folha de contagem (FO-01)
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => navigate("/print/contagem-fisica?cega=1")}
          >
            Contagem cega
          </button>
        </div>
      </div>

      {/* Contagem não é o mesmo que ajuste: quem conta espera "acertar o
          saldo", e o que acontece é um lançamento novo pela diferença. */}
      <ContextHelp topic={helpTopics["estoque.inventario"]} />

      {!podeOperar && (
        <p className="callout" role="status">
          Seu perfil consulta o estoque, mas não registra contagem. Quem conta: {QUEM_OPERA_INVENTARIO}.
        </p>
      )}

      {podeOperar && (
      <FormSection title="Contagem">
        <div className="field-grid-2">
          <div className="field">
            <label htmlFor="count-item">
              Item <span className="req">*</span>
            </label>
            <SearchableEntitySelect
              id="count-item"
              value={itemId}
              onChange={(selectedId) => setItemId(selectedId)}
              placeholder="Digite código ou nome do item…"
              options={items.map(opcaoDoItem)}
              onSearch={buscarItens}
            />
            {selectedItem && !selectedItem.active && (
              <span className="field__hint">Item inativo: entra na contagem só a posição com saldo.</span>
            )}
          </div>

          {controlaLote && (
            <fieldset className="field field--full">
              <legend>
                Lote <span className="req">*</span>
              </legend>
              {posicoes.carregando && <span className="field__hint">Carregando lotes…</span>}
              {!posicoes.carregando && !posicoes.erro && (
                <div className="selection-group" role="group" aria-label="Lotes do item">
                  {lotesLivres.map((lote) => (
                    <LinhaDeMarcacao
                      key={lote.positionKey}
                      tipo="radio"
                      nome="count-lot"
                      valor={lote.lotId ?? ""}
                      marcado={lotId === lote.lotId}
                      aoMudar={() => {
                        setLotId(lote.lotId ?? "");
                        setRecusa(null);
                      }}
                    >
                      {lote.lotCode} · {donoDaPosicao(lote)} · {situacaoDoLote(lote.lotStatus, lote.isExpired)} · validade{" "}
                      {formatDate(lote.expiryDate)}
                      {lote.location ? ` · ${lote.location}` : ""} · saldo {formatQuantityWithUnit(lote.balance, lote.unitCode)}
                    </LinhaDeMarcacao>
                  ))}
                  {lotesRetidos.map((retida) => (
                    <span key={retida.positionKey} className="field__hint">
                      {retida.lotCode} está em contagem no{" "}
                      <EntityLink kind="stockCount" id={retida.stockCountId} code={retida.stockCountCode} /> — registre lá.
                    </span>
                  ))}
                </div>
              )}
            </fieldset>
          )}

          {posicoes.erro && <p className="form-alert field--full">{posicoes.erro}</p>}
          {retidaDoItem && (
            <div className="field--full">
              <AvisoDeRetencao retida={retidaDoItem} rotulo={`${retidaDoItem.itemCode}`} />
            </div>
          )}
          {semPosicao && (
            <p className="field__hint field--full">
              {selectedItem && !selectedItem.active
                ? "Item inativo sem saldo: nenhuma posição para contar."
                : "Nenhuma posição deste item para contar."}
            </p>
          )}

          {!retidaDoItem && (
            <>
              <div className="field">
                <label>
                  Saldo sistema
                  <DicaDoCampo id="estoque.saldoSistema" />
                </label>
                <div className="field-readonly-value">
                  {itemId && posicoes.carregando
                    ? "Carregando…"
                    : systemQuantity !== null
                      ? formatQuantityWithUnit(systemQuantity, unidade)
                      : "—"}
                </div>
              </div>

              <div className="field">
                <label htmlFor="count-quantity">
                  Contagem física <span className="req">*</span>
                </label>
                <DecimalField
                  id="count-quantity"
                  scale={CASAS_QUANTIDADE}
                  placeholder="0"
                  value={countedQuantity}
                  onChangeValue={setCountedQuantity}
                  disabled={systemQuantity === null}
                  aria-invalid={contagemIlegivel || undefined}
                />
                {erroDaContagem && <p className="field__error">{erroDaContagem}</p>}
              </div>

              <div className="field">
                <label>
                  Diferença
                  <DicaDoCampo id="estoque.diferenca" />
                </label>
                <div className="field-readonly-value">
                  {difference === null ? "—" : `${diferencaComSinal(difference)}${unidade ? ` ${unidade}` : ""}`}
                </div>
              </div>

              {hasDifference && (
                <div className="field field--full">
                  <label htmlFor="count-reason">
                    Motivo <span className="req">*</span>
                  </label>
                  <textarea
                    id="count-reason"
                    rows={3}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {recusa?.tipo === "saldo-mudou" && (
          <div className="form-alert" role="alert">
            <p>{recusa.mensagem} Nada foi ajustado.</p>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => {
                setRecusa(null);
                setRecarga((atual) => atual + 1);
              }}
            >
              Atualizar o saldo
            </button>
          </div>
        )}
        {recusa?.tipo === "retida" && (
          <div className="form-alert" role="alert">
            <p>
              {recusa.mensagem}
              {recusa.retida && (
                <>
                  {" "}
                  <EntityLink kind="stockCount" id={recusa.retida.stockCountId} code={recusa.retida.stockCountCode} />
                </>
              )}{" "}
              Nada foi ajustado.
            </p>
          </div>
        )}
        {recusa?.tipo === "outra" && (
          <p className="form-alert" role="alert">
            {recusa.mensagem}
          </p>
        )}

        <div className="line-actions">
          <button
            type="button"
            className="btn btn--accent btn--sm"
            disabled={!canConfirm || saving}
            onClick={handleConfirm}
          >
            {saving ? "Confirmando…" : "Confirmar contagem"}
          </button>
        </div>
      </FormSection>
      )}

      {result && (
        <FormSection title="Resultado">
          <dl className="definition-list">
            <dt>Documento</dt>
            <dd>
              <EntityLink kind="stockCount" id={result.stockCountId} code={result.stockCountCode} />
            </dd>
            <dt>Saldo sistema</dt>
            <dd>{formatQuantityWithUnit(result.systemQuantity, unidade)}</dd>
            <dt>Contagem física</dt>
            <dd>{formatQuantityWithUnit(result.countedQuantity, unidade)}</dd>
            <dt>Diferença</dt>
            <dd>
              {diferencaComSinal(result.difference)}
              {unidade ? ` ${unidade}` : ""}
            </dd>
            <dt>Ajuste gerado</dt>
            <dd>
              {result.movementCreated
                ? `${result.movementCreated.type === "ADJUSTMENT_IN" ? "Ajuste de entrada" : "Ajuste de saída"} — ${formatQuantityWithUnit(result.movementCreated.quantity, unidade)}`
                : "Nenhum — contagem confere com o sistema"}
            </dd>
          </dl>
          <div className="table__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={handleReset}>
              Nova contagem
            </button>
            <Link
              className="btn btn--primary btn--sm"
              to={`/estoque/${itemId}`}
            >
              Ver item
            </Link>
          </div>
        </FormSection>
      )}
    </>
  );
}
