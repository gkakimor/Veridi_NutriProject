import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  ItemDTO,
  ItemType,
  LotStatus,
  PreviewStockCountInput,
  StockCountBalanceFilter,
  StockCountExpiryFilter,
  StockCountHeldPositionDTO,
  StockCountMode,
  StockCountOwnerFilter,
  StockCountPreviewDTO,
  StockCountPreviewExcludedPositionDTO,
  StockCountScopeInput,
} from "@veridi/shared";
import {
  Decimal,
  ITEM_TYPE_LABELS,
  ITEM_TYPES,
  LOT_STATUSES,
  LOT_STATUS_LABELS,
  STOCK_COUNT_EXPIRY_FILTERS,
  STOCK_COUNT_EXPIRY_FILTER_LABELS,
  STOCK_COUNT_MODE_LABELS,
} from "@veridi/shared";
import { IntegerField } from "../../components/NumericField";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
import { EntityLink } from "../../components/EntityLink";
import { FormSection } from "../../components/FormSection";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { TableEmptyRow } from "../../components/TableEmptyRow";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { apiErrorMessage } from "../../lib/api-errors";
import { formatDate } from "../../lib/dates";
import { clienteFilterSource } from "../../lib/filter-sources";
import { formatIntegerPtBr, parsePtBrNumber } from "../../lib/numeric-ptbr";
import { formatQuantity } from "../../lib/quantity";
import { isStockCountApiError, previewStockCount, startStockCount } from "../../lib/stock-counts-api";
import { LinhaDeMarcacao, SeletorDeItem, useCatalogoDeItens, usePosicoesDoItem } from "./inventario-seletores";
import { donoDaPosicao, rotaDoInventario, ROTA_DOS_INVENTARIOS, situacaoDoLote } from "./stock-count-display";
import { QUEM_OPERA_INVENTARIO, usePodeOperarInventario } from "./stock-count-permissions";
import "./inventario-fisico.css";

type Selecao = "filtro" | "itens" | "lotes";

interface LoteEscolhido {
  lotId: string;
  lotCode: string;
  itemCode: string;
  itemName: string;
}

/** Uma escolha de radio numa linha inteira clicável (`.selection-row`). */
function Opcao<T extends string>({
  nome,
  valor,
  atual,
  rotulo,
  dica,
  aoEscolher,
}: {
  nome: string;
  valor: T;
  atual: T;
  rotulo: string;
  dica?: string;
  aoEscolher: (valor: T) => void;
}) {
  const escolhido = atual === valor;
  const idDaDica = dica ? `${nome}-${valor}-dica` : undefined;
  return (
    <div className={escolhido ? "selection-row selection-row--selected" : "selection-row"}>
      <label className="selection-row__label selection-row__label--full">
        <input
          type="radio"
          name={nome}
          value={valor}
          checked={escolhido}
          aria-describedby={idDaDica}
          onChange={() => aoEscolher(valor)}
        />
        {rotulo}
      </label>
      {dica && (
        <span id={idDaDica} className="selection-row__hint">
          {dica}
        </span>
      )}
    </div>
  );
}

/** "MP-000431 · Vitamina C · lote LT-…" — a posição como a pessoa a reconhece. */
function rotuloDaPosicao(posicao: { itemCode: string; itemName: string; lotCode: string | null }): string {
  return `${posicao.itemCode} · ${posicao.itemName}${posicao.lotCode ? ` · lote ${posicao.lotCode}` : ""}`;
}

/** As retidas agrupadas pelo inventário que as segura. */
function agruparRetidas(retidas: StockCountHeldPositionDTO[]) {
  const grupos = new Map<string, { id: string; code: string; quantidade: number }>();
  for (const retida of retidas) {
    const grupo = grupos.get(retida.stockCountId) ?? { id: retida.stockCountId, code: retida.stockCountCode, quantidade: 0 };
    grupo.quantidade += 1;
    grupos.set(retida.stockCountId, grupo);
  }
  return [...grupos.values()];
}

const LINHAS_POR_VEZ = 100;

interface Previa {
  chave: string;
  dados: StockCountPreviewDTO | null;
  erro: string | null;
}

interface EscopoQueMudou {
  entraram: string[];
  sairam: string[];
  anterior: StockCountPreviewDTO;
}

/**
 * Estoque → Inventário Físico → Novo inventário (INVENTORY-PHYSICAL-COUNT-01, Fatia 2A).
 *
 * O escopo é montado por filtros, e a PRÉVIA do servidor diz exatamente o que
 * será contado: posição por posição, com as que ficam fora por já estarem em
 * outro inventário aberto. A prévia se atualiza sozinha (pausa de 300 ms) e só
 * a última resposta pedida vale. Contagem cega é o padrão (DU-3), e nela a
 * prévia não mostra saldo — o servidor nem o envia.
 *
 * Iniciar manda as posições que a pessoa viu: se o escopo mudou desde a
 * prévia, o servidor recusa com o que entrou e o que saiu, e a tela pede nova
 * confirmação — o que foi visto é o que se conta.
 */
export function NewStockCountPage() {
  const navigate = useNavigate();
  const podeOperar = usePodeOperarInventario();

  const [descricao, setDescricao] = useState("");
  const [modo, setModo] = useState<StockCountMode>("BLIND");
  const [tipos, setTipos] = useState<ItemType[]>([]);
  const [saldo, setSaldo] = useState<StockCountBalanceFilter>("WITH_BALANCE");
  const [dono, setDono] = useState<StockCountOwnerFilter>("ALL");
  const [clienteId, setClienteId] = useState("");
  const [clientes, setClientes] = useState<EntityOption[]>([]);
  const [selecao, setSelecao] = useState<Selecao>("filtro");
  const [itensEscolhidos, setItensEscolhidos] = useState<ItemDTO[]>([]);
  const [lotesEscolhidos, setLotesEscolhidos] = useState<LoteEscolhido[]>([]);
  const [itemDosLotes, setItemDosLotes] = useState<ItemDTO | null>(null);
  const [retiradas, setRetiradas] = useState<string[]>([]);
  const [limite, setLimite] = useState(LINHAS_POR_VEZ);
  // Filtros de lote (Fatia 2B): local, situação e validade.
  const [local, setLocal] = useState("");
  const [situacoes, setSituacoes] = useState<LotStatus[]>([]);
  const [validade, setValidade] = useState<StockCountExpiryFilter>("ANY");
  const [dias, setDias] = useState("30");

  const catalogo = useCatalogoDeItens();
  const lotesDoItem = usePosicoesDoItem(selecao === "lotes" && itemDosLotes?.controlsLot ? itemDosLotes.id : null, modo);

  useEffect(() => {
    if (dono !== "CUSTOMER") return;
    let vivo = true;
    clienteFilterSource
      .inicial()
      .then((iniciais) => {
        if (vivo) setClientes(iniciais);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [dono]);

  // Leitura pela foundation pt-BR, como todo campo numérico; inteiro de 1 a 3.650.
  const leituraDosDias = parsePtBrNumber(dias, { scale: 0 });
  const diasDaValidade = leituraDosDias.tipo === "valido" ? new Decimal(leituraDosDias.valor).toNumber() : null;
  const diasValidos =
    diasDaValidade !== null && Number.isInteger(diasDaValidade) && diasDaValidade >= 1 && diasDaValidade <= 3650;

  const escopo = useMemo<StockCountScopeInput>(() => {
    const montado: StockCountScopeInput = { balance: saldo, owner: dono };
    if (dono === "CUSTOMER" && clienteId) montado.customerId = clienteId;
    if (selecao === "filtro" && tipos.length > 0) montado.itemTypes = tipos;
    if (selecao === "itens") montado.itemIds = itensEscolhidos.map((item) => item.id);
    if (selecao === "lotes") montado.lotIds = lotesEscolhidos.map((lote) => lote.lotId);
    if (local.trim()) montado.locationContains = local.trim();
    if (situacoes.length > 0) montado.lotStatuses = situacoes;
    if (validade !== "ANY") montado.expiry = validade;
    if (validade === "EXPIRING" && diasDaValidade !== null) montado.expiringWithinDays = diasDaValidade;
    return montado;
  }, [saldo, dono, clienteId, selecao, tipos, itensEscolhidos, lotesEscolhidos, local, situacoes, validade, diasDaValidade]);

  const filtroDeLote = local.trim() !== "" || situacoes.length > 0 || validade !== "ANY";
  const selecaoIncompleta =
    (selecao === "itens" && itensEscolhidos.length === 0) ||
    (selecao === "lotes" && lotesEscolhidos.length === 0) ||
    (validade === "EXPIRING" && !diasValidos);

  const pedido = useMemo<PreviewStockCountInput>(
    () => ({ mode: modo, scope: escopo, ...(retiradas.length > 0 ? { excludedPositionKeys: retiradas } : {}) }),
    [modo, escopo, retiradas],
  );

  /* A chave inclui a recarga: depois de "o escopo mudou", só a prévia NOVA libera o início. */
  const [recarga, setRecarga] = useState(0);
  const pedidoJson = JSON.stringify(pedido);
  const chave = `${pedidoJson}#${recarga}`;
  const ultimoPedido = useRef(0);
  const [previa, setPrevia] = useState<Previa | null>(null);

  useEffect(() => {
    if (!podeOperar || selecaoIncompleta) return;
    const numero = ++ultimoPedido.current;
    const espera = setTimeout(() => {
      previewStockCount(JSON.parse(pedidoJson) as PreviewStockCountInput)
        .then((dados) => {
          if (numero === ultimoPedido.current) setPrevia({ chave, dados, erro: null });
        })
        .catch((erro: unknown) => {
          if (numero === ultimoPedido.current) {
            setPrevia({ chave, dados: null, erro: apiErrorMessage(erro, "Falha ao montar a prévia") });
          }
        });
    }, 300);
    return () => clearTimeout(espera);
    // A chave carrega o pedido e a recarga; `pedidoJson` é parte dela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, podeOperar, selecaoIncompleta]);

  const previaAtual = previa !== null && previa.chave === chave;
  const atualizando = !selecaoIncompleta && !previaAtual;
  const dados = previa?.dados ?? null;

  const [iniciando, setIniciando] = useState(false);
  const [erroAoIniciar, setErroAoIniciar] = useState<string | null>(null);
  const [mudanca, setMudanca] = useState<EscopoQueMudou | null>(null);
  /* Escopo trocado pela pessoa: o aviso de "mudou desde a prévia" era sobre o escopo de antes. */
  useEffect(() => {
    setMudanca(null);
  }, [pedidoJson]);

  const assinaturaPadrao = useRef<string | null>(null);
  const assinatura = JSON.stringify({ descricao: descricao.trim(), modo, escopo, retiradas });
  if (assinaturaPadrao.current === null) assinaturaPadrao.current = assinatura;
  const { liberarGuarda } = useUnsavedChangesGuard({
    isDirty: podeOperar && assinatura !== assinaturaPadrao.current,
    substantivo: "inventário",
  });

  function trocarSelecao(proxima: Selecao) {
    setSelecao(proxima);
    setRetiradas([]);
    setMudanca(null);
  }

  function alternarTipo(tipo: ItemType) {
    setTipos((atuais) => (atuais.includes(tipo) ? atuais.filter((atual) => atual !== tipo) : [...atuais, tipo]));
  }

  function alternarSituacao(situacao: LotStatus) {
    setSituacoes((atuais) =>
      atuais.includes(situacao) ? atuais.filter((atual) => atual !== situacao) : [...atuais, situacao],
    );
  }

  function escolherItem(item: ItemDTO | null) {
    if (!item || itensEscolhidos.some((escolhido) => escolhido.id === item.id)) return;
    setItensEscolhidos((atuais) => [...atuais, item]);
  }

  function alternarLote(posicao: { lotId: string | null; lotCode: string | null; itemCode: string; itemName: string }) {
    if (!posicao.lotId || !posicao.lotCode) return;
    const { lotId, lotCode } = posicao;
    setLotesEscolhidos((atuais) =>
      atuais.some((lote) => lote.lotId === lotId)
        ? atuais.filter((lote) => lote.lotId !== lotId)
        : [...atuais, { lotId, lotCode, itemCode: posicao.itemCode, itemName: posicao.itemName }],
    );
  }

  async function iniciar() {
    if (!dados || !previaAtual || dados.positions.length === 0) return;
    setIniciando(true);
    setErroAoIniciar(null);
    try {
      const inventario = await startStockCount({
        ...pedido,
        ...(descricao.trim() ? { description: descricao.trim() } : {}),
        expectedPositionKeys: dados.positions.map((posicao) => posicao.positionKey),
      });
      liberarGuarda(() => navigate(rotaDoInventario(inventario.id)));
    } catch (erro) {
      if (isStockCountApiError(erro, "scope_changed")) {
        setMudanca({ entraram: erro.body.added ?? [], sairam: erro.body.removed ?? [], anterior: dados });
        setRecarga((atual) => atual + 1);
      } else if (isStockCountApiError(erro, "position_in_open_count")) {
        setErroAoIniciar(erro.message);
        setRecarga((atual) => atual + 1);
      } else {
        setErroAoIniciar(apiErrorMessage(erro, "Falha ao iniciar o inventário"));
      }
    } finally {
      setIniciando(false);
    }
  }

  const trilha = (
    <PageBreadcrumbs
      items={[{ label: "Inventário Físico", href: ROTA_DOS_INVENTARIOS }, { label: "Novo inventário" }]}
    />
  );

  if (!podeOperar) {
    return (
      <>
        <div className="page__header">
          <div>
            {trilha}
            <h1 className="page__title">Novo inventário</h1>
          </div>
        </div>
        <p className="callout" role="status">
          Seu perfil consulta os inventários, mas não inicia. Quem inicia: {QUEM_OPERA_INVENTARIO}.{" "}
          <Link to={ROTA_DOS_INVENTARIOS}>Voltar para Inventário Físico</Link>
        </p>
      </>
    );
  }

  const retidasAgrupadas = agruparRetidas(dados?.heldByOpenCounts ?? []);
  const posicoesDaPrevia = dados?.positions ?? [];
  const mostrarSaldo = modo === "ASSISTED";
  const colunas = mostrarSaldo ? 10 : 9;
  const porChaveAnterior = new Map(mudanca?.anterior.positions.map((posicao) => [posicao.positionKey, posicao]) ?? []);
  const porChaveAtual = new Map(posicoesDaPrevia.map((posicao) => [posicao.positionKey, posicao]));

  return (
    <>
      <div className="page__header">
        <div>
          {trilha}
          <h1 className="page__title">Novo inventário</h1>
          <p className="page__subtitle">
            Escolha o que contar. Nada é gravado até iniciar — e a prévia mostra exatamente as posições que entram.
          </p>
        </div>
      </div>

      <ContextHelp topic={helpTopics["estoque.inventarioFisico"]} />

      <FormSection title="Identificação">
        <div className="field-grid-2">
          <div className="field">
            <label htmlFor="novo-inventario-descricao">Descrição (opcional)</label>
            <input
              id="novo-inventario-descricao"
              type="text"
              maxLength={200}
              value={descricao}
              placeholder="Ex.: Matérias-primas — setembro"
              onChange={(evento) => setDescricao(evento.target.value)}
            />
          </div>
          <fieldset className="field">
            <legend>Modo</legend>
            <div className="selection-group">
              <Opcao
                nome="novo-inventario-modo"
                valor="BLIND"
                atual={modo}
                rotulo={STOCK_COUNT_MODE_LABELS.BLIND}
                dica="Quem conta não vê saldo, esperado nem diferença até a primeira contagem terminar."
                aoEscolher={setModo}
              />
              <Opcao
                nome="novo-inventario-modo"
                valor="ASSISTED"
                atual={modo}
                rotulo={STOCK_COUNT_MODE_LABELS.ASSISTED}
                dica="O saldo do sistema aparece para quem conta."
                aoEscolher={setModo}
              />
            </div>
          </fieldset>
        </div>
      </FormSection>

      <FormSection title="Escopo">
        <div className="field-grid-2">
          <fieldset className="field">
            <legend>Seleção</legend>
            <div className="selection-group">
              <Opcao nome="novo-inventario-selecao" valor="filtro" atual={selecao} rotulo="Tudo o que o filtro alcança" aoEscolher={trocarSelecao} />
              <Opcao nome="novo-inventario-selecao" valor="itens" atual={selecao} rotulo="Itens escolhidos" aoEscolher={trocarSelecao} />
              <Opcao nome="novo-inventario-selecao" valor="lotes" atual={selecao} rotulo="Lotes escolhidos" aoEscolher={trocarSelecao} />
            </div>
          </fieldset>

          {selecao === "filtro" && (
            <fieldset className="field">
              <legend>Tipo de item</legend>
              <div className="selection-group">
                {ITEM_TYPES.map((tipo) => (
                  <LinhaDeMarcacao key={tipo} tipo="checkbox" marcado={tipos.includes(tipo)} aoMudar={() => alternarTipo(tipo)}>
                    {ITEM_TYPE_LABELS[tipo]}
                  </LinhaDeMarcacao>
                ))}
                <span className="field__hint">Nenhum marcado: todos os tipos.</span>
              </div>
            </fieldset>
          )}

          {selecao === "itens" && (
            <div className="field">
              <label htmlFor="novo-inventario-item">Adicionar item</label>
              <SeletorDeItem id="novo-inventario-item" valor="" aoEscolher={escolherItem} catalogo={catalogo} />
              {itensEscolhidos.length === 0 ? (
                <span className="field__hint">Escolha ao menos um item.</span>
              ) : (
                <ul className="inv-lista-simples" aria-label="Itens escolhidos">
                  {itensEscolhidos.map((item) => (
                    <li key={item.id}>
                      {item.code} · {item.name}{" "}
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        aria-label={`Tirar ${item.code}`}
                        onClick={() => setItensEscolhidos((atuais) => atuais.filter((atual) => atual.id !== item.id))}
                      >
                        Tirar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {selecao === "lotes" && (
            <div className="field">
              <label htmlFor="novo-inventario-item-dos-lotes">Item dos lotes</label>
              <SeletorDeItem
                id="novo-inventario-item-dos-lotes"
                valor={itemDosLotes?.id ?? ""}
                aoEscolher={setItemDosLotes}
                catalogo={catalogo}
              />
              {itemDosLotes && !itemDosLotes.controlsLot && (
                <span className="field__hint">Este item não controla lote: escolha-o em "Itens escolhidos".</span>
              )}
              {lotesDoItem.carregando && <span className="field__hint">Carregando lotes…</span>}
              {lotesDoItem.erro && <p className="form-alert form-alert--inline">{lotesDoItem.erro}</p>}
              {itemDosLotes?.controlsLot && !lotesDoItem.carregando && !lotesDoItem.erro && (
                <div className="selection-group" aria-label={`Lotes de ${itemDosLotes.code}`}>
                  {lotesDoItem.posicoes.length === 0 && lotesDoItem.retidas.length === 0 && (
                    <span className="field__hint">Nenhum lote deste item.</span>
                  )}
                  {lotesDoItem.posicoes.map((posicao) => (
                    <LinhaDeMarcacao
                      key={posicao.positionKey}
                      tipo="checkbox"
                      marcado={lotesEscolhidos.some((lote) => lote.lotId === posicao.lotId)}
                      aoMudar={() => alternarLote(posicao)}
                    >
                      {posicao.lotCode} · validade {formatDate(posicao.expiryDate)} · {donoDaPosicao(posicao)}
                    </LinhaDeMarcacao>
                  ))}
                  {lotesDoItem.retidas.map((retida) => (
                    <span key={retida.positionKey} className="field__hint">
                      {retida.lotCode ?? retida.itemCode} está no{" "}
                      <EntityLink kind="stockCount" id={retida.stockCountId} code={retida.stockCountCode} />.
                    </span>
                  ))}
                </div>
              )}
              {lotesEscolhidos.length === 0 ? (
                <span className="field__hint">Escolha ao menos um lote.</span>
              ) : (
                <ul className="inv-lista-simples" aria-label="Lotes escolhidos">
                  {lotesEscolhidos.map((lote) => (
                    <li key={lote.lotId}>
                      {lote.lotCode} · {lote.itemCode}{" "}
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        aria-label={`Tirar ${lote.lotCode}`}
                        onClick={() => setLotesEscolhidos((atuais) => atuais.filter((atual) => atual.lotId !== lote.lotId))}
                      >
                        Tirar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <fieldset className="field">
            <legend>Saldo</legend>
            <div className="selection-group">
              <Opcao nome="novo-inventario-saldo" valor="WITH_BALANCE" atual={saldo} rotulo="Somente com saldo" aoEscolher={setSaldo} />
              <Opcao
                nome="novo-inventario-saldo"
                valor="ANY"
                atual={saldo}
                rotulo="Com ou sem saldo"
                dica="Inclui os lotes zerados de itens ativos — confira o volume na prévia."
                aoEscolher={setSaldo}
              />
            </div>
          </fieldset>

          <fieldset className="field">
            <legend>Propriedade</legend>
            <div className="selection-group">
              <Opcao nome="novo-inventario-dono" valor="ALL" atual={dono} rotulo="Todas" aoEscolher={setDono} />
              <Opcao nome="novo-inventario-dono" valor="VERIDI" atual={dono} rotulo="Veridi" aoEscolher={setDono} />
              <Opcao nome="novo-inventario-dono" valor="CUSTOMER" atual={dono} rotulo="Material de cliente" aoEscolher={setDono} />
            </div>
            {dono === "CUSTOMER" && (
              <div className="field">
                <label htmlFor="novo-inventario-cliente">Cliente (opcional)</label>
                <SearchableEntitySelect
                  id="novo-inventario-cliente"
                  value={clienteId}
                  options={clientes}
                  placeholder="Todos os clientes"
                  onChange={setClienteId}
                  onSearch={async (termo) => {
                    const encontrados = await clienteFilterSource.buscar(termo);
                    setClientes((atuais) => {
                      const ids = new Set(atuais.map((opcao) => opcao.id));
                      return [...atuais, ...encontrados.filter((opcao) => !ids.has(opcao.id))];
                    });
                    return encontrados;
                  }}
                />
              </div>
            )}
          </fieldset>
        </div>
        {selecao !== "filtro" && (
          <p className="field__hint">
            Itens e lotes escolhidos também respeitam os filtros de saldo, de propriedade e de lote.
          </p>
        )}
      </FormSection>

      <FormSection title="Filtros de lote">
        <p className="field__hint">
          Local, situação e validade são do lote: com qualquer um deles, item sem controle de lote fica fora.
        </p>
        <div className="field-grid-2">
          <div className="field">
            <label htmlFor="novo-inventario-local">Local contém</label>
            <input
              id="novo-inventario-local"
              type="text"
              maxLength={100}
              value={local}
              placeholder="Ex.: A-03, Câmara fria"
              onChange={(evento) => setLocal(evento.target.value)}
            />
          </div>
          <fieldset className="field">
            <legend>Situação do lote</legend>
            <div className="selection-group">
              {LOT_STATUSES.map((situacao) => (
                <LinhaDeMarcacao
                  key={situacao}
                  tipo="checkbox"
                  marcado={situacoes.includes(situacao)}
                  aoMudar={() => alternarSituacao(situacao)}
                >
                  {LOT_STATUS_LABELS[situacao]}
                </LinhaDeMarcacao>
              ))}
              <span className="field__hint">Nenhuma marcada: todas as situações.</span>
            </div>
          </fieldset>
          <fieldset className="field">
            <legend>Validade</legend>
            <div className="selection-group">
              {STOCK_COUNT_EXPIRY_FILTERS.map((opcao) => (
                <Opcao
                  key={opcao}
                  nome="novo-inventario-validade"
                  valor={opcao}
                  atual={validade}
                  rotulo={STOCK_COUNT_EXPIRY_FILTER_LABELS[opcao]}
                  aoEscolher={setValidade}
                />
              ))}
            </div>
            {validade === "EXPIRING" && (
              <div className="field">
                <label htmlFor="novo-inventario-dias">Dias até vencer</label>
                <IntegerField id="novo-inventario-dias" value={dias} onChangeValue={setDias} />
                {!diasValidos && <span className="field__error">Informe de 1 a 3.650 dias.</span>}
                {diasValidos && (
                  <span className="field__hint">Lotes não vencidos que vencem em até {formatIntegerPtBr(diasDaValidade ?? 0)} dias, contando hoje.</span>
                )}
              </div>
            )}
          </fieldset>
        </div>
        {filtroDeLote && selecao === "itens" && (
          <p className="field__hint">Item sem controle de lote escolhido acima não entra enquanto houver filtro de lote.</p>
        )}
      </FormSection>

      <FormSection title="Prévia">
        <div aria-live="polite" aria-busy={atualizando || undefined}>
          {selecaoIncompleta ? (
            <p className="field__hint">
              {validade === "EXPIRING" && !diasValidos
                ? "A prévia aparece quando os dias até vencer estiverem preenchidos."
                : "A prévia aparece quando a seleção tiver ao menos um item ou lote."}
            </p>
          ) : atualizando && !dados && !previa?.erro ? (
            <p className="field__hint">Montando a prévia…</p>
          ) : null}

          {previa?.erro && previaAtual && (
            <p className="form-alert" role="alert">
              {previa.erro}
            </p>
          )}

          {dados && !selecaoIncompleta && (
            <>
              <p>
                <strong>
                  {formatIntegerPtBr(dados.positions.length)} {dados.positions.length === 1 ? "posição" : "posições"}
                </strong>{" "}
                · {formatIntegerPtBr(dados.itemCount)} {dados.itemCount === 1 ? "item" : "itens"} · máximo por inventário:{" "}
                {formatIntegerPtBr(dados.maxPositions)}
                {atualizando && <span className="field__hint"> · atualizando…</span>}
              </p>

              {retidasAgrupadas.length > 0 && (
                <div className="callout" role="note">
                  {retidasAgrupadas.map((grupo) => (
                    <p key={grupo.id}>
                      {formatIntegerPtBr(grupo.quantidade)} {grupo.quantidade === 1 ? "posição está" : "posições estão"} no{" "}
                      <EntityLink kind="stockCount" id={grupo.id} code={grupo.code} /> e {grupo.quantidade === 1 ? "fica" : "ficam"} fora.
                    </p>
                  ))}
                </div>
              )}

              {mudanca && (
                <div className="callout" role="alert">
                  <p>
                    <strong>O escopo mudou desde a prévia.</strong> Entraram {formatIntegerPtBr(mudanca.entraram.length)} e
                    saíram {formatIntegerPtBr(mudanca.sairam.length)} {mudanca.sairam.length === 1 ? "posição" : "posições"}.
                    Confira a prévia nova e inicie de novo.
                  </p>
                  {mudanca.entraram.length > 0 && (
                    <ul className="inv-lista-simples" aria-label="Posições que entraram">
                      {mudanca.entraram.map((chaveDaPosicao) => {
                        const posicao = porChaveAtual.get(chaveDaPosicao);
                        return <li key={chaveDaPosicao}>Entrou: {posicao ? rotuloDaPosicao(posicao) : "posição nova"}</li>;
                      })}
                    </ul>
                  )}
                  {mudanca.sairam.length > 0 && (
                    <ul className="inv-lista-simples" aria-label="Posições que saíram">
                      {mudanca.sairam.map((chaveDaPosicao) => {
                        const posicao = porChaveAnterior.get(chaveDaPosicao);
                        return <li key={chaveDaPosicao}>Saiu: {posicao ? rotuloDaPosicao(posicao) : "posição"}</li>;
                      })}
                    </ul>
                  )}
                </div>
              )}

              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="is-numeric col-tight">Nº</th>
                      <th className="col-tight">Código</th>
                      <th className="col-flex">Item</th>
                      <th className="col-tight">Lote</th>
                      <th className="col-label">Proprietário</th>
                      <th className="col-label">Local</th>
                      <th className="col-tight">Validade</th>
                      <th className="col-label">Situação do lote</th>
                      {mostrarSaldo && <th className="is-numeric col-tight">Saldo</th>}
                      <th aria-label="Ações" />
                    </tr>
                  </thead>
                  <tbody>
                    {posicoesDaPrevia.slice(0, limite).map((posicao) => (
                      <tr key={posicao.positionKey}>
                        <td className="is-numeric col-tight">{formatIntegerPtBr(posicao.sequence)}</td>
                        <td className="is-code col-tight">{posicao.itemCode}</td>
                        <td className="col-flex">{posicao.itemName}</td>
                        <td className="col-tight">{posicao.lotCode ?? "—"}</td>
                        <td className="col-label">{donoDaPosicao(posicao)}</td>
                        <td className="col-label">{posicao.location ?? "—"}</td>
                        <td className="col-tight">{formatDate(posicao.expiryDate)}</td>
                        <td className="col-label">{situacaoDoLote(posicao.lotStatus, posicao.isExpired)}</td>
                        {mostrarSaldo && <td className="is-numeric col-tight">{formatQuantity(posicao.balance)}</td>}
                        <td>
                          <div className="table__actions">
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              aria-label={`Retirar da prévia ${rotuloDaPosicao(posicao)}`}
                              onClick={() => setRetiradas((atuais) => [...atuais, posicao.positionKey])}
                            >
                              Retirar
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {posicoesDaPrevia.length === 0 && (
                      <TableEmptyRow colSpan={colunas}>Nenhuma posição no escopo escolhido.</TableEmptyRow>
                    )}
                  </tbody>
                </table>
              </div>
              {posicoesDaPrevia.length > limite && (
                <div className="line-actions">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLimite((atual) => atual + LINHAS_POR_VEZ)}>
                    Mostrar mais {formatIntegerPtBr(Math.min(LINHAS_POR_VEZ, posicoesDaPrevia.length - limite))}
                  </button>
                </div>
              )}

              {dados.excludedPositions.length > 0 && (
                <RetiradasDaPrevia
                  retiradas={dados.excludedPositions}
                  mostrarSaldo={mostrarSaldo}
                  aoRecolocar={(chaveDaPosicao) => setRetiradas((atuais) => atuais.filter((atual) => atual !== chaveDaPosicao))}
                />
              )}
            </>
          )}
        </div>

        {erroAoIniciar && (
          <p className="form-alert" role="alert">
            {erroAoIniciar}
          </p>
        )}

        <div className="form-actions form-actions--split">
          <div className="form-actions__group">
            <Link className="btn btn--ghost" to={ROTA_DOS_INVENTARIOS}>
              Cancelar
            </Link>
          </div>
          <div className="form-actions__group">
            <button
              type="button"
              className="btn btn--accent"
              disabled={iniciando || !previaAtual || !dados || dados.positions.length === 0}
              onClick={() => void iniciar()}
            >
              {iniciando ? "Iniciando…" : "Iniciar inventário"}
            </button>
          </div>
        </div>
      </FormSection>
    </>
  );
}

function RetiradasDaPrevia({
  retiradas,
  mostrarSaldo,
  aoRecolocar,
}: {
  retiradas: StockCountPreviewExcludedPositionDTO[];
  mostrarSaldo: boolean;
  aoRecolocar: (positionKey: string) => void;
}) {
  return (
    <section aria-label="Retiradas da prévia">
      <h4>
        Retiradas da prévia ({formatIntegerPtBr(retiradas.length)})
      </h4>
      <ul className="inv-lista-simples">
        {retiradas.map((posicao) => (
          <li key={posicao.positionKey}>
            {rotuloDaPosicao(posicao)}
            {mostrarSaldo && ` · saldo ${formatQuantity(posicao.balance)}`}{" "}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              aria-label={`Recolocar ${rotuloDaPosicao(posicao)}`}
              onClick={() => aoRecolocar(posicao.positionKey)}
            >
              Recolocar
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
