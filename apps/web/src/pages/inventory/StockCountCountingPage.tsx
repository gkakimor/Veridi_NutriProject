import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { StockCountDetailDTO, StockCountPositionDTO, UomDimension } from "@veridi/shared";
import {
  STOCK_COUNT_MODE_LABELS,
  STOCK_COUNT_POSITION_SITUATION_LABELS,
  STOCK_COUNT_STATUS_LABELS,
} from "@veridi/shared";
import { useOptionalAuth } from "../../app/AuthProvider";
import { useMediaQuery } from "../../app/use-media-query";
import { useTituloDaTela } from "../../app/titulo-da-tela";
import { useUnsavedChangesGuard } from "../../app/use-unsaved-changes-guard";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { DecimalField, IntegerField } from "../../components/NumericField";
import { PageBreadcrumbs } from "../../components/PageBreadcrumbs";
import { TableEmptyRow } from "../../components/TableEmptyRow";
import { ContextHelp } from "../../components/help";
import { helpTopics } from "../../help/help-content";
import { NotFoundApiError, apiErrorMessage } from "../../lib/api-errors";
import { decimalDaApiComparavel } from "../../lib/dirty-fields";
import { formatDate, formatDateTime } from "../../lib/dates";
import { novoIdDeEnvio } from "../../lib/id-de-envio";
import { formatIntegerPtBr, numericInvalidMessage, parsePtBrNumber, toPtBrEditText } from "../../lib/numeric-ptbr";
import { CASAS_QUANTIDADE } from "../../lib/numeric-scales";
import { formatQuantityWithUnit } from "../../lib/quantity";
import {
  StockCountSendFailedError,
  getStockCount,
  isStockCountApiError,
  registerStockCountEntry,
} from "../../lib/stock-counts-api";
import { listUnits } from "../../lib/units-api";
import type { EnvioDeContagem } from "./fila-de-contagem";
import { guardarEnvio, lerFila, tirarEnvio } from "./fila-de-contagem";
import { AdicionarPosicaoDialog, RegistrarOcorrenciaDialog } from "./inventario-dialogos";
import {
  ROTA_DOS_INVENTARIOS,
  aguardaContagem,
  casaComBusca,
  donoDaPosicao,
  rotaDoInventario,
  statusBadgeClass,
} from "./stock-count-display";
import { QUEM_OPERA_INVENTARIO, usePodeOperarInventario } from "./stock-count-permissions";
import "./inventario-fisico.css";

type Recorte = "pendentes" | "contadas" | "todas";

const RECORTES: { chave: Recorte; rotulo: string }[] = [
  { chave: "pendentes", rotulo: "Pendentes" },
  { chave: "contadas", rotulo: "Contadas" },
  { chave: "todas", rotulo: "Todas" },
];

type EstadoDaLinha =
  | { tipo: "salvando" }
  | { tipo: "salvo" }
  | { tipo: "nao-enviado"; mensagem: string }
  | { tipo: "conflito"; atual: StockCountPositionDTO }
  | { tipo: "recusado"; mensagem: string };

/** Recusas que dizem que o inventário (ou a posição) já não está como a tela o leu. */
const ESTADO_MUDOU = new Set(["invalid_stock_count_status", "entry_not_allowed", "position_not_found", "not_found"]);

/** Abaixo de 640px a grade vira cartão sequencial (DU-1). */
const CELULAR = "(max-width: 639px)";

function noRecorte(posicao: StockCountPositionDTO, recorte: Recorte): boolean {
  if (recorte === "todas") return true;
  if (posicao.situation === "REMOVED") return false;
  return recorte === "pendentes" ? aguardaContagem(posicao) : !aguardaContagem(posicao);
}

function contagemQueVale(posicao: StockCountPositionDTO): string | null {
  const valido = posicao.entries.find((registro) => registro.id === posicao.validEntryId);
  return valido && valido.round === posicao.currentRound ? valido.countedQuantity : null;
}

function registroQueVale(posicao: StockCountPositionDTO) {
  const valido = posicao.entries.find((registro) => registro.id === posicao.validEntryId);
  return valido && valido.round === posicao.currentRound ? valido : null;
}

function mesmoNumero(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = decimalDaApiComparavel(a);
  return x !== null && x === decimalDaApiComparavel(b);
}

/**
 * Estoque → Inventário Físico → Contagem (INVENTORY-PHYSICAL-COUNT-01, Fatia 2A).
 *
 * A tela de quem CONTA. Lê sempre a leitura `counting`: numa contagem cega o
 * servidor não manda saldo, esperado, diferença nem "confere" — e a tela, se
 * um dia recebesse, também não mostraria. Antes da revelação não há
 * diferença ao vivo (DU-4), nem dica de cálculo, nem número de exemplo no campo.
 *
 * Contar é digitar e seguir: Enter grava e vai para a próxima pendente, sair do
 * campo grava, Esc descarta a edição da linha. Vazio não grava; 0 é contagem.
 *
 * Toda contagem entra na fila local antes de ser enviada (`fila-de-contagem.ts`)
 * e só sai quando o servidor a confirma. Rede caída deixa a linha "Não enviado",
 * e reenviar usa o MESMO identificador. Outro operador que contou antes gera
 * conflito explícito — manter o que está gravado ou usar a sua contagem, nunca
 * sobrescrever sozinho.
 */
export function StockCountCountingPage() {
  const { id = "" } = useParams();
  const sessao = useOptionalAuth();
  const userId = sessao?.user?.id ?? null;
  const podeOperar = usePodeOperarInventario();
  const celular = useMediaQuery(CELULAR);

  const [inventario, setInventario] = useState<StockCountDetailDTO | null>(null);
  const [versao, setVersao] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [naoEncontrado, setNaoEncontrado] = useState(false);
  const [erroDeCarga, setErroDeCarga] = useState<string | null>(null);
  const [dimensoes, setDimensoes] = useState<Map<string, UomDimension>>(new Map());

  const [rascunhos, setRascunhos] = useState<Record<string, string>>({});
  const [estados, setEstados] = useState<Record<string, EstadoDaLinha>>({});
  const [fila, setFila] = useState<EnvioDeContagem[]>([]);
  const [estadoMudou, setEstadoMudou] = useState<string | null>(null);
  const [recorte, setRecorte] = useState<Recorte>("pendentes");
  const [busca, setBusca] = useState("");
  const [indice, setIndice] = useState(0);
  const [confirmarDescarte, setConfirmarDescarte] = useState(false);
  const [dialogo, setDialogo] = useState<"adicionar" | "ocorrencia" | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  /* Fonte da verdade síncrona para o que acontece entre um evento e o render seguinte (Enter → blur). */
  const filaRef = useRef<EnvioDeContagem[]>([]);
  const inventarioRef = useRef<StockCountDetailDTO | null>(null);
  const emVoo = useRef(new Map<string, string>());
  const campos = useRef(new Map<string, HTMLInputElement>());
  const focarDepois = useRef<string | null>(null);

  useTituloDaTela(inventario ? `Contagem · ${inventario.code}` : null);

  const mudarFila = useCallback((proxima: EnvioDeContagem[]) => {
    filaRef.current = proxima;
    setFila(proxima);
  }, []);

  const carregar = useCallback(
    async (inicial: boolean) => {
      setErroDeCarga(null);
      try {
        const detalhe = await getStockCount(id, "counting");
        inventarioRef.current = detalhe;
        setInventario(detalhe);
        setVersao((atual) => atual + 1);
        setNaoEncontrado(false);
        setEstadoMudou(null);
        if (inicial) {
          const guardada = userId ? lerFila(userId, id) : filaRef.current;
          mudarFila(guardada);
          if (guardada.length > 0) {
            setRascunhos((atuais) => ({
              ...atuais,
              ...Object.fromEntries(
                guardada.map((envio) => [envio.positionId, toPtBrEditText(envio.countedQuantity, { scale: CASAS_QUANTIDADE })]),
              ),
            }));
            setEstados((atuais) => ({
              ...atuais,
              ...Object.fromEntries(
                guardada.map((envio) => [
                  envio.positionId,
                  { tipo: "nao-enviado", mensagem: "Não enviado" } satisfies EstadoDaLinha,
                ]),
              ),
            }));
          }
        }
      } catch (falha) {
        if (falha instanceof NotFoundApiError || isStockCountApiError(falha, "not_found")) setNaoEncontrado(true);
        else setErroDeCarga(apiErrorMessage(falha, "Falha ao carregar o inventário"));
      } finally {
        setCarregando(false);
      }
    },
    [id, userId, mudarFila],
  );

  useEffect(() => {
    setCarregando(true);
    void carregar(true);
  }, [carregar]);

  useEffect(() => {
    let vivo = true;
    listUnits()
      .then((unidades) => {
        if (vivo) setDimensoes(new Map(unidades.map((unidade) => [unidade.code, unidade.dimension])));
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  /* O recorte congela a lista quando é escolhido: a linha recém-contada não some debaixo do dedo. */
  const chaveDoRecorte = `${recorte}|${busca}|${versao}`;
  const [instantaneo, setInstantaneo] = useState<{ chave: string; ids: string[] }>({ chave: "", ids: [] });
  if (inventario && instantaneo.chave !== chaveDoRecorte) {
    setInstantaneo({
      chave: chaveDoRecorte,
      ids: inventario.positions
        .filter((posicao) => noRecorte(posicao, recorte) && casaComBusca(posicao, busca))
        .map((posicao) => posicao.id),
    });
  }

  const rascunhoPendente = Object.entries(rascunhos).some(([positionId, texto]) => {
    const posicao = inventario?.positions.find((candidata) => candidata.id === positionId);
    if (!posicao || texto.trim() === "") return false;
    const leitura = parsePtBrNumber(texto, { scale: CASAS_QUANTIDADE });
    return leitura.tipo !== "valido" || !mesmoNumero(contagemQueVale(posicao), leitura.valor);
  });
  useUnsavedChangesGuard({ isDirty: fila.length > 0 || rascunhoPendente, substantivo: "contagem", genero: "a" });

  const podeContarNoEstado = inventario?.status === "IN_PROGRESS" || inventario?.status === "IN_REVIEW";

  function editavel(posicao: StockCountPositionDTO): boolean {
    if (!podeOperar || !inventario || !podeContarNoEstado) return false;
    if (posicao.situation === "REMOVED") return false;
    // Em revisão, só conta quem ainda espera contagem: a primeira contagem já fechou.
    return inventario.status === "IN_PROGRESS" || aguardaContagem(posicao);
  }

  function escalaDe(posicao: StockCountPositionDTO): number {
    return dimensoes.get(posicao.unitCode) === "COUNT" ? 0 : CASAS_QUANTIDADE;
  }

  function marcar(positionId: string, estado: EstadoDaLinha | null) {
    setEstados((atuais) => {
      const proximos = { ...atuais };
      if (estado) proximos[positionId] = estado;
      else delete proximos[positionId];
      return proximos;
    });
  }

  function trocarPosicao(posicao: StockCountPositionDTO) {
    const atual = inventarioRef.current;
    if (!atual) return;
    const proximo = { ...atual, positions: atual.positions.map((p) => (p.id === posicao.id ? posicao : p)) };
    inventarioRef.current = proximo;
    setInventario(proximo);
  }

  function esquecerRascunho(positionId: string, seIgualA?: string) {
    setRascunhos((atuais) => {
      const texto = atuais[positionId];
      if (texto === undefined) return atuais;
      if (seIgualA !== undefined) {
        const leitura = parsePtBrNumber(texto, { scale: CASAS_QUANTIDADE });
        if (leitura.tipo !== "valido" || !mesmoNumero(leitura.valor, seIgualA)) return atuais;
      }
      const proximos = { ...atuais };
      delete proximos[positionId];
      return proximos;
    });
  }

  function guardar(envio: EnvioDeContagem) {
    mudarFila(
      userId
        ? guardarEnvio(userId, id, envio)
        : [...filaRef.current.filter((item) => item.positionId !== envio.positionId), envio],
    );
  }

  function tirar(clientRequestId: string) {
    mudarFila(
      userId ? tirarEnvio(userId, id, clientRequestId) : filaRef.current.filter((item) => item.clientRequestId !== clientRequestId),
    );
  }

  async function enviar(envio: EnvioDeContagem) {
    emVoo.current.set(envio.positionId, envio.clientRequestId);
    marcar(envio.positionId, { tipo: "salvando" });
    try {
      const resultado = await registerStockCountEntry(id, envio.positionId, {
        round: envio.round,
        expectedLastEntryId: envio.expectedLastEntryId,
        countedQuantity: envio.countedQuantity,
        clientRequestId: envio.clientRequestId,
        ...(envio.note ? { note: envio.note } : {}),
      });
      tirar(envio.clientRequestId);
      if (emVoo.current.get(envio.positionId) !== envio.clientRequestId) return;
      emVoo.current.delete(envio.positionId);
      trocarPosicao(resultado.position);
      esquecerRascunho(envio.positionId, envio.countedQuantity);
      marcar(envio.positionId, { tipo: "salvo" });
    } catch (falha) {
      if (emVoo.current.get(envio.positionId) !== envio.clientRequestId) return;
      emVoo.current.delete(envio.positionId);
      if (falha instanceof StockCountSendFailedError || isStockCountApiError(falha, "concurrent_write")) {
        marcar(envio.positionId, { tipo: "nao-enviado", mensagem: falha.message });
      } else if (isStockCountApiError(falha, "stock_count_entry_conflict") && falha.body.position) {
        marcar(envio.positionId, { tipo: "conflito", atual: falha.body.position });
      } else if (isStockCountApiError(falha) && ESTADO_MUDOU.has(falha.code)) {
        marcar(envio.positionId, { tipo: "recusado", mensagem: falha.message });
        setEstadoMudou(falha.message);
      } else {
        marcar(envio.positionId, { tipo: "recusado", mensagem: apiErrorMessage(falha, "Falha ao gravar a contagem") });
      }
    }
  }

  function gravar(daTela: StockCountPositionDTO) {
    /*
     * A posição como está AGORA, e não a do render que criou o handler: sair do
     * campo e clicar em "Gravar e ir para a próxima" são dois eventos, e a
     * resposta do primeiro pode chegar antes do segundo.
     */
    const posicao = inventarioRef.current?.positions.find((candidata) => candidata.id === daTela.id) ?? daTela;
    if (!editavel(posicao)) return;
    const texto = rascunhos[posicao.id];
    if (texto === undefined) return;
    const escala = escalaDe(posicao);
    const leitura = parsePtBrNumber(texto, { scale: escala });
    // Vazio não grava: só um número é contagem — inclusive 0.
    if (leitura.tipo === "vazio") return;
    if (leitura.tipo === "invalido") {
      marcar(posicao.id, { tipo: "recusado", mensagem: numericInvalidMessage("Contagem", leitura.motivo, { scale: escala }) });
      return;
    }
    const pendente = filaRef.current.find((envio) => envio.positionId === posicao.id);
    if (!pendente && mesmoNumero(contagemQueVale(posicao), leitura.valor)) {
      esquecerRascunho(posicao.id);
      return;
    }
    if (pendente && mesmoNumero(pendente.countedQuantity, leitura.valor)) {
      // O mesmo número já está a caminho: não sai de novo. Parado (rede caiu), sai com o MESMO id.
      if (emVoo.current.get(posicao.id) === pendente.clientRequestId) return;
      void enviar(pendente);
      return;
    }
    const envio: EnvioDeContagem = {
      positionId: posicao.id,
      round: posicao.currentRound,
      expectedLastEntryId: posicao.lastEntryId,
      countedQuantity: leitura.valor,
      clientRequestId: novoIdDeEnvio(),
    };
    guardar(envio);
    void enviar(envio);
  }

  function descartarEdicao(posicao: StockCountPositionDTO) {
    const pendente = filaRef.current.find((envio) => envio.positionId === posicao.id);
    if (pendente) {
      setRascunhos((atuais) => ({
        ...atuais,
        [posicao.id]: toPtBrEditText(pendente.countedQuantity, { scale: CASAS_QUANTIDADE }),
      }));
    } else {
      esquecerRascunho(posicao.id);
      if (estados[posicao.id]?.tipo === "recusado") marcar(posicao.id, null);
    }
  }

  function manterRegistrada(positionId: string) {
    const estado = estados[positionId];
    if (estado?.tipo !== "conflito") return;
    trocarPosicao(estado.atual);
    const pendente = filaRef.current.find((envio) => envio.positionId === positionId);
    if (pendente) tirar(pendente.clientRequestId);
    esquecerRascunho(positionId);
    marcar(positionId, null);
  }

  function usarMinha(positionId: string) {
    const estado = estados[positionId];
    if (estado?.tipo !== "conflito") return;
    const pendente = filaRef.current.find((envio) => envio.positionId === positionId);
    if (!pendente) return;
    trocarPosicao(estado.atual);
    // Decisão explícita sobre o registro que está lá: trava nova, envio novo.
    const envio: EnvioDeContagem = {
      positionId,
      round: estado.atual.currentRound,
      expectedLastEntryId: estado.atual.lastEntryId,
      countedQuantity: pendente.countedQuantity,
      clientRequestId: novoIdDeEnvio(),
      ...(pendente.note ? { note: pendente.note } : {}),
    };
    guardar(envio);
    void enviar(envio);
  }

  function reenviarTudo() {
    for (const envio of filaRef.current) {
      if (emVoo.current.get(envio.positionId) === envio.clientRequestId) continue;
      if (estados[envio.positionId]?.tipo === "conflito") continue;
      void enviar(envio);
    }
  }

  function descartarFila() {
    for (const envio of filaRef.current) {
      if (emVoo.current.get(envio.positionId) === envio.clientRequestId) continue;
      tirar(envio.clientRequestId);
      esquecerRascunho(envio.positionId);
      marcar(envio.positionId, null);
    }
    setConfirmarDescarte(false);
  }

  const porId = new Map((inventario?.positions ?? []).map((posicao) => [posicao.id, posicao]));
  const visiveis = (instantaneo.chave === chaveDoRecorte ? instantaneo.ids : [])
    .map((positionId) => porId.get(positionId))
    .filter((posicao): posicao is StockCountPositionDTO => posicao !== undefined);

  function aindaPendente(posicao: StockCountPositionDTO): boolean {
    return (
      editavel(posicao) &&
      aguardaContagem(posicao) &&
      !filaRef.current.some((envio) => envio.positionId === posicao.id)
    );
  }

  /** A próxima pendente depois desta, na ordem da lista; dá a volta. */
  function proximaPendente(depoisDe: string): StockCountPositionDTO | null {
    const inicio = visiveis.findIndex((posicao) => posicao.id === depoisDe);
    const ordem = [...visiveis.slice(inicio + 1), ...visiveis.slice(0, Math.max(inicio, 0))];
    return ordem.find((posicao) => posicao.id !== depoisDe && aindaPendente(posicao)) ?? null;
  }

  function aoTeclar(evento: KeyboardEvent<HTMLInputElement>, posicao: StockCountPositionDTO) {
    if (evento.key === "Enter") {
      evento.preventDefault();
      gravar(posicao);
      const proxima = proximaPendente(posicao.id);
      if (proxima) {
        if (celular) {
          setIndice(Math.max(0, visiveis.findIndex((candidata) => candidata.id === proxima.id)));
          focarDepois.current = proxima.id;
        } else {
          campos.current.get(proxima.id)?.focus();
        }
      }
    } else if (evento.key === "Escape") {
      evento.preventDefault();
      descartarEdicao(posicao);
    }
  }

  useEffect(() => {
    const alvo = focarDepois.current;
    if (!alvo) return;
    focarDepois.current = null;
    campos.current.get(alvo)?.focus();
  });

  if (carregando && !inventario) {
    return (
      <div className="page__header">
        <div>
          <h1 className="page__title">Contagem</h1>
          <p className="page__subtitle">Carregando…</p>
        </div>
      </div>
    );
  }

  if (naoEncontrado || !inventario) {
    return (
      <>
        <div className="page__header">
          <div>
            <h1 className="page__title">{naoEncontrado ? "Inventário não encontrado" : "Contagem"}</h1>
          </div>
        </div>
        {erroDeCarga && (
          <p className="form-alert" role="alert">
            {erroDeCarga}{" "}
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void carregar(true)}>
              Tentar novamente
            </button>
          </p>
        )}
        <Link className="btn btn--ghost" to={ROTA_DOS_INVENTARIOS}>
          ← Voltar para Inventário Físico
        </Link>
      </>
    );
  }

  /*
   * Cega: nada que revele saldo aparece aqui, venha o que vier na resposta. A
   * leitura `counting` já não traz; esta checagem é a segunda barreira.
   */
  const cega = inventario.mode === "BLIND";
  const mostrarSaldo = !cega && !inventario.balancesHidden;
  const ativas = inventario.positions.filter((posicao) => posicao.situation !== "REMOVED");
  const contadas = ativas.filter((posicao) => !aguardaContagem(posicao)).length;
  const pendentesAgora = ativas.length - contadas;
  /* Em conflito a contagem tem decisão própria na linha: "Reenviar" não a resolve e não a conta. */
  const naoEnviadas = fila.filter(
    (envio) =>
      emVoo.current.get(envio.positionId) !== envio.clientRequestId && estados[envio.positionId]?.tipo !== "conflito",
  );

  function rotuloDaSituacao(posicao: StockCountPositionDTO): string {
    if (cega && (posicao.situation === "MATCHES" || posicao.situation === "DIVERGENT" || posicao.situation === "DECIDED")) {
      return STOCK_COUNT_POSITION_SITUATION_LABELS.COUNTED;
    }
    return STOCK_COUNT_POSITION_SITUATION_LABELS[posicao.situation];
  }

  function estadoDaLinha(posicao: StockCountPositionDTO) {
    const estado = estados[posicao.id];
    if (!estado) return <span className="inv-estado">{rotuloDaSituacao(posicao)}</span>;
    if (estado.tipo === "salvando") return <span className="inv-estado">Salvando…</span>;
    if (estado.tipo === "salvo") return <span className="inv-estado inv-estado--salvo">Salvo</span>;
    if (estado.tipo === "nao-enviado") return <span className="inv-estado inv-estado--nao-enviado">Não enviado</span>;
    if (estado.tipo === "conflito") return <span className="inv-estado inv-estado--erro">Conflito</span>;
    return (
      <span className="inv-estado inv-estado--erro" role="alert">
        {estado.mensagem}
      </span>
    );
  }

  function conflitoDaLinha(posicao: StockCountPositionDTO) {
    const estado = estados[posicao.id];
    if (estado?.tipo !== "conflito") return null;
    const registrado = registroQueVale(estado.atual);
    const pendente = fila.find((envio) => envio.positionId === posicao.id);
    return (
      <div className="inv-conflito" role="alert">
        {registrado ? (
          <p>
            <strong>{registrado.countedByName}</strong> registrou{" "}
            <strong>{formatQuantityWithUnit(registrado.countedQuantity, posicao.unitCode)}</strong> às{" "}
            {formatDateTime(registrado.countedAt)}, antes da sua contagem
            {pendente ? ` (${formatQuantityWithUnit(pendente.countedQuantity, posicao.unitCode)})` : ""}.
          </p>
        ) : (
          <p>A posição mudou desde que você a abriu: a rodada de contagem é outra.</p>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => manterRegistrada(posicao.id)}>
            Manter a registrada
          </button>
          {pendente && (
            <button type="button" className="btn btn--accent btn--sm" onClick={() => usarMinha(posicao.id)}>
              Usar a minha contagem
            </button>
          )}
        </div>
      </div>
    );
  }

  function campoDaContagem(posicao: StockCountPositionDTO, grande = false) {
    const idDoCampo = `${grande ? "inv-cartao" : "inv-contagem"}-${posicao.id}`;
    const valor = rascunhos[posicao.id] ?? toPtBrEditText(contagemQueVale(posicao), { scale: CASAS_QUANTIDADE });
    const props = {
      id: idDoCampo,
      value: valor,
      className: grande ? undefined : "inv-campo-contagem",
      "aria-label": `Contagem da posição ${formatIntegerPtBr(posicao.sequence)} — ${posicao.itemCode}${posicao.lotCode ? ` lote ${posicao.lotCode}` : ""} (${posicao.unitCode})`,
      ref: (no: HTMLInputElement | null) => {
        if (no) campos.current.set(posicao.id, no);
        else campos.current.delete(posicao.id);
      },
      onChangeValue: (texto: string) => {
        setRascunhos((atuais) => ({ ...atuais, [posicao.id]: texto }));
        if (estados[posicao.id]?.tipo === "recusado" || estados[posicao.id]?.tipo === "salvo") marcar(posicao.id, null);
      },
      onKeyDown: (evento: KeyboardEvent<HTMLInputElement>) => aoTeclar(evento, posicao),
      onBlur: () => gravar(posicao),
    };
    return escalaDe(posicao) === 0 ? <IntegerField {...props} /> : <DecimalField {...props} scale={CASAS_QUANTIDADE} />;
  }

  const trilha = (
    <PageBreadcrumbs
      items={[
        { label: "Inventário Físico", href: ROTA_DOS_INVENTARIOS },
        { label: inventario.code, href: rotaDoInventario(inventario.id) },
        { label: "Contagem" },
      ]}
    />
  );

  const cartao = celular ? visiveis[Math.min(indice, Math.max(visiveis.length - 1, 0))] : undefined;

  return (
    <>
      <div className="doc-header inv-cabecalho-da-contagem">
        <div>
          {trilha}
          <div className="doc-title">
            <h1>
              Contagem · <span className="inv-codigo-inteiro">{inventario.code}</span>
            </h1>
            <span className={statusBadgeClass(inventario.status)}>{STOCK_COUNT_STATUS_LABELS[inventario.status]}</span>
            <span className="badge badge--neutral">{STOCK_COUNT_MODE_LABELS[inventario.mode]}</span>
          </div>
          <p className="page__subtitle">
            {inventario.description ? `${inventario.description} · ` : ""}
            {formatIntegerPtBr(contadas)} de {formatIntegerPtBr(ativas.length)} contadas ·{" "}
            {formatIntegerPtBr(pendentesAgora)} {pendentesAgora === 1 ? "pendente" : "pendentes"}
          </p>
        </div>
        <div className="table__actions">
          {/* No celular a trilha já leva ao inventário: o espaço fica para a contagem. */}
          {!celular && (
            <Link className="btn btn--ghost" to={rotaDoInventario(inventario.id)}>
              Ver inventário
            </Link>
          )}
          {podeOperar && inventario.status === "IN_PROGRESS" && (
            <button
              type="button"
              className={celular ? "btn btn--secondary btn--sm" : "btn btn--secondary"}
              onClick={() => setDialogo("adicionar")}
            >
              + Adicionar posição
            </button>
          )}
          {podeOperar && podeContarNoEstado && (
            <button
              type="button"
              className={celular ? "btn btn--secondary btn--sm" : "btn btn--secondary"}
              onClick={() => setDialogo("ocorrencia")}
            >
              Registrar ocorrência
            </button>
          )}
        </div>
      </div>

      <ContextHelp topic={helpTopics["estoque.inventarioFisico"]} />

      {!podeOperar && (
        <p className="callout" role="status">
          Seu perfil consulta este inventário, mas não registra contagem. Quem conta: {QUEM_OPERA_INVENTARIO}.
        </p>
      )}
      {podeOperar && !podeContarNoEstado && (
        <p className="callout" role="status">
          Este inventário está {STOCK_COUNT_STATUS_LABELS[inventario.status].toLocaleLowerCase("pt-BR")} e não recebe
          contagem. <Link to={rotaDoInventario(inventario.id)}>Ver o inventário</Link>
        </p>
      )}
      {inventario.status === "IN_REVIEW" && podeOperar && (
        <p className="callout" role="status">
          A primeira contagem já foi concluída: aqui só se contam as posições que ainda esperam contagem.
        </p>
      )}

      {estadoMudou && (
        <div className="form-alert" role="alert">
          O inventário mudou enquanto você contava: {estadoMudou}{" "}
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void carregar(false)}>
            Recarregar
          </button>
        </div>
      )}

      {naoEnviadas.length > 0 && (
        <div className="callout" role="alert">
          <p>
            <strong>
              {formatIntegerPtBr(naoEnviadas.length)}{" "}
              {naoEnviadas.length === 1 ? "contagem não enviada" : "contagens não enviadas"}
            </strong>{" "}
            neste navegador. Elas ainda não estão gravadas no sistema.
          </p>
          <div className="form-actions">
            <button type="button" className="btn btn--accent btn--sm" onClick={reenviarTudo}>
              Reenviar
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmarDescarte(true)}>
              Descartar
            </button>
          </div>
        </div>
      )}

      {aviso && (
        <p className="callout" role="status">
          {aviso}
        </p>
      )}

      <div className="toolbar inv-barra-da-contagem">
        <div className="toolbar__search">
          <label className="sr-only" htmlFor="inv-contagem-busca">
            Buscar posição
          </label>
          <input
            id="inv-contagem-busca"
            type="search"
            placeholder="Item, código, lote ou LOT:<código>"
            value={busca}
            onChange={(evento) => {
              setBusca(evento.target.value);
              setIndice(0);
            }}
          />
        </div>
        <div className="inv-chips" role="group" aria-label="Recorte da contagem">
          {RECORTES.map((opcao) => (
            <button
              key={opcao.chave}
              type="button"
              className="inv-chip"
              aria-pressed={recorte === opcao.chave}
              onClick={() => {
                setRecorte(opcao.chave);
                setIndice(0);
              }}
            >
              {opcao.rotulo}
            </button>
          ))}
        </div>
      </div>

      {celular ? (
        <section aria-label="Posição em contagem">
          {cartao ? (
            <div className="inv-cartao">
              <span className="inv-cartao__numero">
                Posição {formatIntegerPtBr(cartao.sequence)} · {estadoDaLinha(cartao)}
              </span>
              <p className="inv-cartao__item">
                {cartao.itemCode} · {cartao.itemName}
              </p>
              <dl className="inv-cartao__dados">
                <dt>Lote</dt>
                <dd>{cartao.lotCode ?? "—"}</dd>
                <dt>Proprietário</dt>
                <dd>{donoDaPosicao(cartao)}</dd>
                <dt>Validade</dt>
                <dd>{formatDate(cartao.expiryDateAtReference)}</dd>
                <dt>Local</dt>
                <dd>{cartao.locationAtReference ?? "—"}</dd>
                <dt>Unidade</dt>
                <dd>{cartao.unitCode}</dd>
                {mostrarSaldo && (
                  <>
                    <dt>Saldo de referência</dt>
                    <dd>{formatQuantityWithUnit(cartao.referenceQuantity, cartao.unitCode)}</dd>
                  </>
                )}
              </dl>
              {editavel(cartao) ? (
                <>
                  <div className="inv-cartao__campo">
                    <label htmlFor={`inv-cartao-${cartao.id}`}>Contagem ({cartao.unitCode})</label>
                    {campoDaContagem(cartao, true)}
                  </div>
                  {conflitoDaLinha(cartao)}
                  <button
                    type="button"
                    className="btn btn--accent"
                    onClick={() => {
                      gravar(cartao);
                      const proxima = proximaPendente(cartao.id);
                      if (proxima) {
                        setIndice(Math.max(0, visiveis.findIndex((candidata) => candidata.id === proxima.id)));
                        focarDepois.current = proxima.id;
                      }
                    }}
                  >
                    Gravar e ir para a próxima
                  </button>
                </>
              ) : (
                <p className="field__hint">
                  Contagem: {formatQuantityWithUnit(contagemQueVale(cartao), cartao.unitCode)}
                </p>
              )}
            </div>
          ) : (
            <p className="callout">Nenhuma posição neste recorte.</p>
          )}
          <nav className="inv-barra-inferior" aria-label="Navegar entre posições">
            <button
              type="button"
              className="btn btn--secondary"
              disabled={indice <= 0 || visiveis.length === 0}
              onClick={() => setIndice((atual) => Math.max(0, atual - 1))}
            >
              Anterior
            </button>
            <span className="inv-barra-inferior__progresso">
              {visiveis.length === 0
                ? "0 de 0"
                : `${formatIntegerPtBr(Math.min(indice, visiveis.length - 1) + 1)} de ${formatIntegerPtBr(visiveis.length)}`}
            </span>
            <button
              type="button"
              className="btn btn--secondary"
              disabled={indice >= visiveis.length - 1}
              onClick={() => setIndice((atual) => Math.min(visiveis.length - 1, atual + 1))}
            >
              Próxima
            </button>
          </nav>
        </section>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th className="is-numeric col-tight">Nº</th>
                <th className="col-flex">Item</th>
                <th className="col-tight">Lote · validade</th>
                <th className="col-label">Local</th>
                <th className="col-label">Proprietário</th>
                {mostrarSaldo && <th className="is-numeric col-tight">Saldo de referência</th>}
                <th className="is-numeric col-tight">Contagem</th>
                <th className="col-flex">Situação</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((posicao) => {
                const registrado = registroQueVale(posicao);
                const colunas = mostrarSaldo ? 8 : 7;
                return (
                  <Fragment key={posicao.id}>
                    <tr>
                      <td className="is-numeric col-tight">{formatIntegerPtBr(posicao.sequence)}</td>
                      <td className="col-flex">
                        <span className="inv-celula-empilhada">
                          <span className="is-code inv-codigo-inteiro">{posicao.itemCode}</span>
                          <small>{posicao.itemName}</small>
                        </span>
                      </td>
                      <td className="col-tight">
                        <span className="inv-celula-empilhada">
                          <span className="inv-codigo-inteiro">{posicao.lotCode ?? "—"}</span>
                          {posicao.lotCode && <small>val. {formatDate(posicao.expiryDateAtReference)}</small>}
                        </span>
                      </td>
                      <td className="col-label">{posicao.locationAtReference ?? "—"}</td>
                      <td className="col-label">{donoDaPosicao(posicao)}</td>
                      {mostrarSaldo && (
                        <td className="is-numeric col-tight">
                          {formatQuantityWithUnit(posicao.referenceQuantity, posicao.unitCode)}
                        </td>
                      )}
                      <td className="is-numeric col-tight">
                        {editavel(posicao) ? (
                          <span className="inv-contagem-com-unidade">
                            {campoDaContagem(posicao)}
                            <span className="muted">{posicao.unitCode}</span>
                          </span>
                        ) : (
                          formatQuantityWithUnit(contagemQueVale(posicao), posicao.unitCode)
                        )}
                      </td>
                      <td className="col-flex">
                        {estadoDaLinha(posicao)}
                        {registrado && (
                          <span className="inv-estado">
                            {registrado.countedByName} · {formatDateTime(registrado.countedAt)}
                          </span>
                        )}
                      </td>
                    </tr>
                    {estados[posicao.id]?.tipo === "conflito" && (
                      <tr className="inv-linha-do-conflito">
                        <td colSpan={colunas}>{conflitoDaLinha(posicao)}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {visiveis.length === 0 && (
                <TableEmptyRow colSpan={mostrarSaldo ? 8 : 7}>Nenhuma posição neste recorte.</TableEmptyRow>
              )}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirmarDescarte}
        title="Descartar as contagens não enviadas?"
        message="Elas não chegaram ao sistema e saem deste navegador. As posições voltam ao que está gravado."
        confirmLabel="Descartar"
        cancelLabel="Voltar"
        onConfirm={descartarFila}
        onCancel={() => setConfirmarDescarte(false)}
      />

      {dialogo === "adicionar" && (
        <AdicionarPosicaoDialog
          inventario={inventario}
          aoFechar={() => setDialogo(null)}
          aoAdicionar={(posicao) => {
            setDialogo(null);
            setAviso(
              `Posição ${formatIntegerPtBr(posicao.sequence)} adicionada: ${posicao.itemCode}${posicao.lotCode ? ` · ${posicao.lotCode}` : ""}.`,
            );
            void carregar(false);
          }}
        />
      )}
      {dialogo === "ocorrencia" && (
        <RegistrarOcorrenciaDialog
          inventario={inventario}
          aoFechar={() => setDialogo(null)}
          aoRegistrar={() => {
            setDialogo(null);
            setAviso("Ocorrência registrada.");
          }}
        />
      )}
    </>
  );
}

