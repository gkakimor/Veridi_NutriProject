import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type {
  ItemDTO,
  StockCountDetailDTO,
  StockCountFindingDTO,
  StockCountFindingKind,
  StockCountPositionDTO,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import { STOCK_COUNT_FINDING_KIND_LABELS, STOCK_COUNT_FINDING_KINDS } from "@veridi/shared";
import { EntityLink } from "../../components/EntityLink";
import { ModalDialog } from "../../components/ModalDialog";
import { DecimalField, IntegerField } from "../../components/NumericField";
import { apiErrorMessage } from "../../lib/api-errors";
import { exigirDecimalOpcional } from "../../lib/decimal-field";
import { formatDate } from "../../lib/dates";
import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { CASAS_QUANTIDADE, OPCOES_QUANTIDADE } from "../../lib/numeric-scales";
import {
  addStockCountPosition,
  cancelStockCount,
  closeStockCountFirstRound,
  createStockCountFinding,
  isStockCountApiError,
  removeStockCountPosition,
} from "../../lib/stock-counts-api";
import { listUnits } from "../../lib/units-api";
import { LinhaDeMarcacao, SeletorDeItem, useCatalogoDeItens, usePosicoesDoItem } from "./inventario-seletores";
import { donoDaPosicao } from "./stock-count-display";

/**
 * Diálogos do Inventário Físico — INVENTORY-PHYSICAL-COUNT-01, Fatia 2A.
 *
 * Cada um grava uma coisa só e responde com o que o servidor devolveu. Nenhum
 * mostra saldo numa contagem cega: o que precisa de lote sai da prévia no modo
 * do inventário, que o servidor devolve sem saldo.
 */

const MOTIVO_MINIMO = 3;

function motivoValido(motivo: string): boolean {
  return motivo.trim().length >= MOTIVO_MINIMO;
}

function CampoDeMotivo({
  id,
  valor,
  aoMudar,
  rotulo = "Motivo",
}: {
  id: string;
  valor: string;
  aoMudar: (valor: string) => void;
  rotulo?: string;
}) {
  return (
    <div className="field field--full">
      <label htmlFor={id}>
        {rotulo} <span className="req">*</span>
      </label>
      <textarea id={id} rows={3} maxLength={500} value={valor} onChange={(evento) => aoMudar(evento.target.value)} />
      <span className="field__hint">Mínimo de {MOTIVO_MINIMO} caracteres.</span>
    </div>
  );
}

function Acoes({
  formulario,
  gravando,
  podeGravar,
  rotulo,
  rotuloGravando,
  tom = "accent",
  aoFechar,
}: {
  formulario: string;
  gravando: boolean;
  podeGravar: boolean;
  rotulo: string;
  rotuloGravando: string;
  tom?: "accent" | "danger";
  aoFechar: () => void;
}) {
  return (
    <div className="confirm-dialog__actions">
      <button type="button" className="btn btn--ghost" onClick={aoFechar} disabled={gravando}>
        Voltar
      </button>
      <button
        type="submit"
        form={formulario}
        className={tom === "danger" ? "btn btn--danger" : "btn btn--accent"}
        disabled={!podeGravar || gravando}
      >
        {gravando ? rotuloGravando : rotulo}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function AdicionarPosicaoDialog({
  inventario,
  aoFechar,
  aoAdicionar,
}: {
  inventario: Pick<StockCountDetailDTO, "id" | "code" | "mode" | "positions">;
  aoFechar: () => void;
  aoAdicionar: (posicao: StockCountPositionDTO) => void;
}) {
  const catalogo = useCatalogoDeItens();
  const [item, setItem] = useState<ItemDTO | null>(null);
  const [loteId, setLoteId] = useState("");
  const [motivo, setMotivo] = useState("");
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const lotes = usePosicoesDoItem(item?.controlsLot ? item.id : null, inventario.mode);

  const chavesDoInventario = new Set(inventario.positions.map((posicao) => posicao.positionKey));
  const chaveEscolhida = item ? (item.controlsLot ? (loteId ? `${item.id}:${loteId}` : "") : item.id) : "";
  const jaNoInventario = chaveEscolhida !== "" && chavesDoInventario.has(chaveEscolhida);
  const podeGravar = chaveEscolhida !== "" && !jaNoInventario && motivoValido(motivo);

  async function gravar(evento: FormEvent) {
    evento.preventDefault();
    if (!item || !podeGravar) return;
    setGravando(true);
    setErro(null);
    try {
      const posicao = await addStockCountPosition(inventario.id, {
        itemId: item.id,
        ...(item.controlsLot ? { lotId: loteId } : {}),
        reason: motivo.trim(),
      });
      aoAdicionar(posicao);
    } catch (falha) {
      setErro(apiErrorMessage(falha, "Falha ao adicionar a posição"));
    } finally {
      setGravando(false);
    }
  }

  return (
    <ModalDialog labelledBy="inv-adicionar-titulo" onClose={aoFechar}>
      <h2 id="inv-adicionar-titulo">Adicionar posição ao {inventario.code}</h2>
      <p>
        Só item e lote que já existem no ERP. Material sem cadastro é uma ocorrência — o inventário não cria item nem
        lote.
      </p>
      <form id="inv-adicionar-form" className="field-grid-2" onSubmit={(evento) => void gravar(evento)}>
        <div className="field field--full">
          <label htmlFor="inv-adicionar-item">
            Item <span className="req">*</span>
          </label>
          <SeletorDeItem
            id="inv-adicionar-item"
            valor={item?.id ?? ""}
            catalogo={catalogo}
            aoEscolher={(escolhido) => {
              setItem(escolhido);
              setLoteId("");
            }}
          />
        </div>

        {item?.controlsLot && (
          <fieldset className="field field--full">
            <legend>
              Lote <span className="req">*</span>
            </legend>
            {lotes.carregando && <span className="field__hint">Carregando lotes…</span>}
            {lotes.erro && <p className="form-alert form-alert--inline">{lotes.erro}</p>}
            {!lotes.carregando && !lotes.erro && (
              <div className="selection-group">
                {lotes.posicoes.length === 0 && lotes.retidas.length === 0 && (
                  <span className="field__hint">Nenhum lote deste item.</span>
                )}
                {lotes.posicoes.map((posicao) => {
                  const noInventario = chavesDoInventario.has(posicao.positionKey);
                  return (
                    <LinhaDeMarcacao
                      key={posicao.positionKey}
                      tipo="radio"
                      nome="inv-adicionar-lote"
                      valor={posicao.lotId ?? ""}
                      marcado={loteId === posicao.lotId}
                      desabilitado={noInventario}
                      aoMudar={() => setLoteId(posicao.lotId ?? "")}
                    >
                      {posicao.lotCode} · validade {formatDate(posicao.expiryDate)} · {donoDaPosicao(posicao)}
                      {noInventario && " · já faz parte deste inventário"}
                    </LinhaDeMarcacao>
                  );
                })}
                {lotes.retidas.map((retida) =>
                  retida.stockCountId === inventario.id ? (
                    <span key={retida.positionKey} className="field__hint">
                      {retida.lotCode} já está neste inventário.
                    </span>
                  ) : (
                    <span key={retida.positionKey} className="field__hint">
                      {retida.lotCode} está no{" "}
                      <EntityLink kind="stockCount" id={retida.stockCountId} code={retida.stockCountCode} />.
                    </span>
                  ),
                )}
              </div>
            )}
          </fieldset>
        )}

        {jaNoInventario && (
          <p className="form-alert form-alert--inline field--full">Esta posição já faz parte do inventário.</p>
        )}

        <CampoDeMotivo id="inv-adicionar-motivo" valor={motivo} aoMudar={setMotivo} />
      </form>
      {erro && (
        <p className="form-alert" role="alert">
          {erro}
        </p>
      )}
      <Acoes
        formulario="inv-adicionar-form"
        gravando={gravando}
        podeGravar={podeGravar}
        rotulo="Adicionar posição"
        rotuloGravando="Adicionando…"
        aoFechar={aoFechar}
      />
    </ModalDialog>
  );
}

/* ------------------------------------------------------------------ */

export function RetirarPosicaoDialog({
  inventarioId,
  posicao,
  aoFechar,
  aoRetirar,
}: {
  inventarioId: string;
  posicao: Pick<StockCountPositionDTO, "id" | "sequence" | "itemCode" | "itemName" | "lotCode">;
  aoFechar: () => void;
  aoRetirar: (posicao: StockCountPositionDTO) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function gravar(evento: FormEvent) {
    evento.preventDefault();
    if (!motivoValido(motivo)) return;
    setGravando(true);
    setErro(null);
    try {
      aoRetirar(await removeStockCountPosition(inventarioId, posicao.id, { reason: motivo.trim() }));
    } catch (falha) {
      setErro(apiErrorMessage(falha, "Falha ao retirar a posição"));
    } finally {
      setGravando(false);
    }
  }

  return (
    <ModalDialog labelledBy="inv-retirar-titulo" onClose={aoFechar}>
      <h2 id="inv-retirar-titulo">Retirar a posição {formatIntegerPtBr(posicao.sequence)}</h2>
      <p>
        {posicao.itemCode} · {posicao.itemName}
        {posicao.lotCode ? ` · lote ${posicao.lotCode}` : ""}
      </p>
      <p className="callout">
        <strong>A retirada é definitiva neste inventário.</strong> A posição não volta a ser contada aqui, e os registros
        que ela já tinha continuam no histórico. Ela fica livre para outro inventário.
      </p>
      <form id="inv-retirar-form" onSubmit={(evento) => void gravar(evento)}>
        <CampoDeMotivo id="inv-retirar-motivo" valor={motivo} aoMudar={setMotivo} />
      </form>
      {erro && (
        <p className="form-alert" role="alert">
          {erro}
        </p>
      )}
      <Acoes
        formulario="inv-retirar-form"
        gravando={gravando}
        podeGravar={motivoValido(motivo)}
        rotulo="Retirar posição"
        rotuloGravando="Retirando…"
        tom="danger"
        aoFechar={aoFechar}
      />
    </ModalDialog>
  );
}

/* ------------------------------------------------------------------ */

export function RegistrarOcorrenciaDialog({
  inventario,
  aoFechar,
  aoRegistrar,
}: {
  inventario: Pick<StockCountDetailDTO, "id" | "code">;
  aoFechar: () => void;
  aoRegistrar: (ocorrencia: StockCountFindingDTO) => void;
}) {
  const catalogo = useCatalogoDeItens();
  const [tipo, setTipo] = useState<StockCountFindingKind>("UNREGISTERED_LOT");
  const [item, setItem] = useState<ItemDTO | null>(null);
  const [identificacao, setIdentificacao] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [unidades, setUnidades] = useState<UnitOfMeasureDTO[]>([]);
  const [unidade, setUnidade] = useState("");
  const [observacao, setObservacao] = useState("");
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    listUnits()
      .then((lista) => {
        if (vivo) setUnidades(lista);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  const pedeItem = tipo !== "UNREGISTERED_ITEM";
  const itemObrigatorio = tipo === "UNREGISTERED_LOT";
  const unidadeDaQuantidade = pedeItem && item ? item.unitCode : unidade;
  const contaUnidades = unidades.find((opcao) => opcao.code === unidadeDaQuantidade)?.dimension === "COUNT";
  const podeGravar =
    identificacao.trim().length > 0 &&
    (!itemObrigatorio || item !== null) &&
    (quantidade.trim() === "" || unidadeDaQuantidade !== "");

  async function gravar(evento: FormEvent) {
    evento.preventDefault();
    if (!podeGravar) return;
    setGravando(true);
    setErro(null);
    try {
      const quantidadeCanonica = exigirDecimalOpcional(quantidade, "Quantidade encontrada", OPCOES_QUANTIDADE);
      const ocorrencia = await createStockCountFinding(inventario.id, {
        kind: tipo,
        identification: identificacao.trim(),
        ...(pedeItem && item ? { itemId: item.id } : {}),
        ...(quantidadeCanonica ? { quantity: quantidadeCanonica, unitCode: unidadeDaQuantidade } : {}),
        ...(observacao.trim() ? { note: observacao.trim() } : {}),
      });
      aoRegistrar(ocorrencia);
    } catch (falha) {
      setErro(apiErrorMessage(falha, "Falha ao registrar a ocorrência"));
    } finally {
      setGravando(false);
    }
  }

  return (
    <ModalDialog labelledBy="inv-ocorrencia-titulo" onClose={aoFechar}>
      <h2 id="inv-ocorrencia-titulo">Registrar ocorrência no {inventario.code}</h2>
      <p>
        Material que não cabe numa posição do inventário. A ocorrência fica registrada com autor e data — não cria item
        nem lote, não mexe no estoque e não impede o encerramento.
      </p>
      <form id="inv-ocorrencia-form" className="field-grid-2" onSubmit={(evento) => void gravar(evento)}>
        <fieldset className="field field--full">
          <legend>
            Tipo <span className="req">*</span>
          </legend>
          <div className="selection-group">
            {STOCK_COUNT_FINDING_KINDS.map((opcao) => (
              <LinhaDeMarcacao
                key={opcao}
                tipo="radio"
                nome="inv-ocorrencia-tipo"
                valor={opcao}
                marcado={tipo === opcao}
                aoMudar={() => {
                  setTipo(opcao);
                  if (opcao === "UNREGISTERED_ITEM") setItem(null);
                }}
              >
                {STOCK_COUNT_FINDING_KIND_LABELS[opcao]}
              </LinhaDeMarcacao>
            ))}
          </div>
        </fieldset>

        {pedeItem && (
          <div className="field field--full">
            <label htmlFor="inv-ocorrencia-item">
              Item do ERP {itemObrigatorio ? <span className="req">*</span> : "(opcional)"}
            </label>
            <SeletorDeItem id="inv-ocorrencia-item" valor={item?.id ?? ""} catalogo={catalogo} aoEscolher={setItem} />
            {itemObrigatorio && (
              <span className="field__hint">O item existe; o lote encontrado é que não tem cadastro.</span>
            )}
          </div>
        )}

        <div className="field field--full">
          <label htmlFor="inv-ocorrencia-identificacao">
            Identificação <span className="req">*</span>
          </label>
          <input
            id="inv-ocorrencia-identificacao"
            type="text"
            maxLength={200}
            value={identificacao}
            placeholder="Ex.: lote do fabricante na etiqueta, descrição da caixa"
            onChange={(evento) => setIdentificacao(evento.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="inv-ocorrencia-quantidade">Quantidade encontrada (opcional)</label>
          {contaUnidades ? (
            <IntegerField id="inv-ocorrencia-quantidade" value={quantidade} onChangeValue={setQuantidade} />
          ) : (
            <DecimalField
              id="inv-ocorrencia-quantidade"
              scale={CASAS_QUANTIDADE}
              value={quantidade}
              onChangeValue={setQuantidade}
            />
          )}
        </div>

        <div className="field">
          {pedeItem && item ? (
            <>
              <span className="field__label-static">Unidade</span>
              <div className="field-readonly-value">{item.unitCode}</div>
            </>
          ) : (
            <>
              <label htmlFor="inv-ocorrencia-unidade">Unidade</label>
              <select id="inv-ocorrencia-unidade" value={unidade} onChange={(evento) => setUnidade(evento.target.value)}>
                <option value="">Selecione…</option>
                {unidades.map((opcao) => (
                  <option key={opcao.code} value={opcao.code}>
                    {opcao.code} — {opcao.label}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        <div className="field field--full">
          <label htmlFor="inv-ocorrencia-observacao">Observação (opcional)</label>
          <textarea
            id="inv-ocorrencia-observacao"
            rows={2}
            maxLength={500}
            value={observacao}
            onChange={(evento) => setObservacao(evento.target.value)}
          />
        </div>
      </form>
      {erro && (
        <p className="form-alert" role="alert">
          {erro}
        </p>
      )}
      <Acoes
        formulario="inv-ocorrencia-form"
        gravando={gravando}
        podeGravar={podeGravar}
        rotulo="Registrar ocorrência"
        rotuloGravando="Registrando…"
        aoFechar={aoFechar}
      />
    </ModalDialog>
  );
}

/* ------------------------------------------------------------------ */

export function CancelarInventarioDialog({
  inventario,
  aoFechar,
  aoCancelar,
}: {
  inventario: Pick<StockCountDetailDTO, "id" | "code">;
  aoFechar: () => void;
  aoCancelar: (detalhe: StockCountDetailDTO) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function gravar(evento: FormEvent) {
    evento.preventDefault();
    if (!motivoValido(motivo)) return;
    setGravando(true);
    setErro(null);
    try {
      aoCancelar(await cancelStockCount(inventario.id, { reason: motivo.trim() }));
    } catch (falha) {
      setErro(apiErrorMessage(falha, "Falha ao cancelar o inventário"));
    } finally {
      setGravando(false);
    }
  }

  return (
    <ModalDialog labelledBy="inv-cancelar-titulo" onClose={aoFechar}>
      <h2 id="inv-cancelar-titulo">Cancelar o {inventario.code}?</h2>
      <ul className="inv-lista-simples">
        <li>Nada é apagado: posições, contagens e ocorrências continuam no histórico.</li>
        <li>Nenhuma movimentação de estoque é criada.</li>
        <li>As posições ficam livres para outro inventário.</li>
        <li>Inventário cancelado não reabre.</li>
      </ul>
      <form id="inv-cancelar-form" onSubmit={(evento) => void gravar(evento)}>
        <CampoDeMotivo id="inv-cancelar-motivo" valor={motivo} aoMudar={setMotivo} rotulo="Motivo do cancelamento" />
      </form>
      {erro && (
        <p className="form-alert" role="alert">
          {erro}
        </p>
      )}
      <Acoes
        formulario="inv-cancelar-form"
        gravando={gravando}
        podeGravar={motivoValido(motivo)}
        rotulo="Cancelar inventário"
        rotuloGravando="Cancelando…"
        tom="danger"
        aoFechar={aoFechar}
      />
    </ModalDialog>
  );
}

/* ------------------------------------------------------------------ */

export function ConcluirPrimeiraContagemDialog({
  inventario,
  aoFechar,
  aoConcluir,
  aoIrParaPendentes,
}: {
  inventario: Pick<StockCountDetailDTO, "id" | "code" | "mode">;
  aoFechar: () => void;
  aoConcluir: (detalhe: StockCountDetailDTO) => void;
  aoIrParaPendentes: () => void;
}) {
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /* A quantidade é a do SERVIDOR: a tela pode estar atrás de quem conta ao lado. */
  const [pendentes, setPendentes] = useState<number | null>(null);

  async function concluir() {
    setGravando(true);
    setErro(null);
    try {
      aoConcluir(await closeStockCountFirstRound(inventario.id));
    } catch (falha) {
      if (isStockCountApiError(falha, "first_round_incomplete")) {
        setPendentes(falha.body.pendingCount ?? null);
        setErro(falha.message);
      } else {
        setErro(apiErrorMessage(falha, "Falha ao concluir a primeira contagem"));
      }
    } finally {
      setGravando(false);
    }
  }

  return (
    <ModalDialog labelledBy="inv-concluir-titulo" onClose={aoFechar}>
      <h2 id="inv-concluir-titulo">Concluir a primeira contagem do {inventario.code}?</h2>
      <ul className="inv-lista-simples">
        <li>Toda posição precisa estar contada ou retirada com motivo.</li>
        <li>O inventário passa para Em revisão, e a primeira contagem não recebe mais registros.</li>
        {inventario.mode === "BLIND" && (
          <li>
            É neste momento que a contagem cega se revela: saldo, esperado e diferença passam a aparecer no detalhe
            do inventário.
          </li>
        )}
        <li>Nenhum ajuste de estoque é feito agora.</li>
      </ul>
      {erro && (
        <p className="form-alert" role="alert">
          {pendentes !== null && pendentes > 0
            ? `${pendentes === 1 ? "Falta" : "Faltam"} ${formatIntegerPtBr(pendentes)} ${pendentes === 1 ? "posição" : "posições"} sem contagem nem retirada.`
            : erro}
        </p>
      )}
      <div className="confirm-dialog__actions">
        <button type="button" className="btn btn--ghost" onClick={aoFechar} disabled={gravando}>
          Voltar
        </button>
        {pendentes !== null && pendentes > 0 ? (
          <button type="button" className="btn btn--accent" onClick={aoIrParaPendentes}>
            Contar pendentes
          </button>
        ) : (
          <button type="button" className="btn btn--accent" onClick={() => void concluir()} disabled={gravando}>
            {gravando ? "Concluindo…" : "Concluir primeira contagem"}
          </button>
        )}
      </div>
    </ModalDialog>
  );
}
