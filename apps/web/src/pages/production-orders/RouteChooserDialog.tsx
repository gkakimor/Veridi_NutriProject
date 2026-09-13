import { useEffect, useMemo, useState } from "react";
import type {
  ProductionOrderDTO,
  ProductionProfileVersionDTO,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import {
  PRODUCTION_ORDER_STATUS_LABELS,
  PRODUCTION_STEP_SCALING_MODE_LABELS,
  compatibilidadeDoRoteiro,
} from "@veridi/shared";
import { ModalDialog } from "../../components/ModalDialog";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { applyProductionProfile } from "../../lib/production-orders-api";
import {
  getProductionProfileVersion,
  listProductionProfiles,
} from "../../lib/production-profiles-api";
import { listUnits } from "../../lib/units-api";
import { apiErrorMessage } from "../../lib/api-errors";
import { formatMinutes } from "../../lib/duration";
import { formatQuantity } from "../../lib/quantity";

/**
 * ESCOLHER O ROTEIRO de uma Ordem de Produção — PRODUCTION-ROUTE-ASSIGNMENT-01.
 *
 * Um diálogo para as três situações, com a mesma ordem sempre: escolher o
 * roteiro, VER o resumo (versão, quantidade de referência, unidade, etapas) e
 * só então aplicar. A escolha é pelo roteiro; o que se grava é a versão ativa
 * dele. Buscar é no servidor, e compatível ou não quem decide é a mesma regra
 * do servidor (`compatibilidadeDoRoteiro`) — aqui ela só adianta a recusa.
 *
 * - primeira aplicação em rascunho: motivo opcional;
 * - troca em rascunho: motivo obrigatório;
 * - regularização de ordem planejada ou liberada: confirmação e motivo.
 *
 * Programação existente sai junto, e isso é dito e confirmado antes.
 */

export type RouteChooserMode = "primeira" | "troca" | "regularizacao";

const TITULOS: Record<RouteChooserMode, string> = {
  primeira: "Escolher roteiro para esta OP",
  troca: "Alterar roteiro",
  regularizacao: "Regularizar o roteiro desta ordem",
};

const SUCESSO: Record<RouteChooserMode, string> = {
  primeira: "Roteiro aplicado.",
  troca: "Roteiro atualizado.",
  regularizacao: "Roteiro aplicado à ordem.",
};

interface Props {
  order: ProductionOrderDTO;
  mode: RouteChooserMode;
  /** Versão já escolhida ao abrir — o padrão do Produto, quando faz sentido. */
  initialVersionId?: string | null;
  hasSchedule: boolean;
  onClose: () => void;
  onApplied: (order: ProductionOrderDTO, message: string) => void;
}

function opcaoDeRoteiro(profile: {
  code: string;
  name: string;
  activeVersionId: string | null;
  activeVersionNumber: number | null;
  referenceQuantity: string | null;
  referenceUomCode: string | null;
}): EntityOption | null {
  if (!profile.activeVersionId) return null;
  return {
    id: profile.activeVersionId,
    code: `${profile.code} · V${profile.activeVersionNumber}`,
    name: profile.name,
    ...(profile.referenceQuantity && profile.referenceUomCode
      ? { hint: `Referência: ${formatQuantity(profile.referenceQuantity)} ${profile.referenceUomCode}` }
      : {}),
  };
}

export function RouteChooserDialog({
  order,
  mode,
  initialVersionId = null,
  hasSchedule,
  onClose,
  onApplied,
}: Props) {
  const [opcoes, setOpcoes] = useState<EntityOption[]>([]);
  const [versionId, setVersionId] = useState(initialVersionId ?? "");
  const [versao, setVersao] = useState<ProductionProfileVersionDTO | null>(null);
  const [carregandoVersao, setCarregandoVersao] = useState(false);
  const [unidades, setUnidades] = useState<UnitOfMeasureDTO[]>([]);
  const [motivo, setMotivo] = useState("");
  const [confirmaProgramacao, setConfirmaProgramacao] = useState(false);
  const [confirmaRegularizacao, setConfirmaRegularizacao] = useState(false);
  const [acao, setAcao] = useState<"somente" | "padrao" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const motivoObrigatorio = mode !== "primeira";

  useEffect(() => {
    listProductionProfiles({ activeOnly: true, pageSize: 20 })
      .then((resposta) =>
        setOpcoes(resposta.profiles.map(opcaoDeRoteiro).filter((o): o is EntityOption => o !== null)),
      )
      .catch(() => setOpcoes([]));
    listUnits()
      .then(setUnidades)
      .catch(() => setUnidades([]));
  }, []);

  useEffect(() => {
    if (!versionId) {
      setVersao(null);
      return;
    }
    let vivo = true;
    setCarregandoVersao(true);
    getProductionProfileVersion(versionId)
      .then((dto) => {
        if (vivo) setVersao(dto);
      })
      .catch((err: unknown) => {
        if (vivo) setErro(apiErrorMessage(err, "Não foi possível carregar o roteiro escolhido."));
      })
      .finally(() => {
        if (vivo) setCarregandoVersao(false);
      });
    return () => {
      vivo = false;
    };
  }, [versionId]);

  const buscar = async (termo: string) => {
    const resposta = await listProductionProfiles({ activeOnly: true, search: termo, pageSize: 20 });
    const achadas = resposta.profiles
      .map(opcaoDeRoteiro)
      .filter((o): o is EntityOption => o !== null);
    setOpcoes((atuais) => {
      const porId = new Map(atuais.map((o) => [o.id, o]));
      for (const o of achadas) porId.set(o.id, o);
      return [...porId.values()];
    });
    return achadas;
  };

  // A mesma regra do servidor, adiantada: unidade que não converte não chega a ser enviada.
  const bloqueio = useMemo(() => {
    if (!versao || unidades.length === 0) return null;
    return compatibilidadeDoRoteiro(versao, order.outputUnitCode, unidades);
  }, [versao, unidades, order.outputUnitCode]);

  const mesmaVersao = versao !== null && versao.id === order.planning.snapshot?.sourceVersionId;
  const pronto =
    versao !== null &&
    !carregandoVersao &&
    bloqueio === null &&
    !mesmaVersao &&
    (!motivoObrigatorio || motivo.trim().length > 0) &&
    (!hasSchedule || confirmaProgramacao) &&
    (mode !== "regularizacao" || confirmaRegularizacao);

  async function aplicar(definirPadrao: boolean) {
    if (!versao) return;
    setAcao(definirPadrao ? "padrao" : "somente");
    setErro(null);
    try {
      const atualizada = await applyProductionProfile(order.id, {
        productionProfileVersionId: versao.id,
        ...(definirPadrao ? { setAsProductDefault: true } : {}),
        ...(motivo.trim() ? { reason: motivo.trim() } : {}),
        ...(hasSchedule ? { confirmScheduleRemoval: true } : {}),
        ...(mode === "regularizacao" ? { confirmLegacyRepair: true } : {}),
        expectedSourceVersionId: order.planning.snapshot?.sourceVersionId ?? null,
      });
      onApplied(atualizada, SUCESSO[mode]);
    } catch (err) {
      setErro(apiErrorMessage(err, "Não foi possível aplicar o roteiro."));
    } finally {
      setAcao(null);
    }
  }

  const rotuloEmCurso = mode === "troca" ? "Alterando…" : "Aplicando…";

  return (
    <ModalDialog labelledBy="route-chooser-title" onClose={onClose} role="dialog">
      <h3 id="route-chooser-title">
        {TITULOS[mode]}
      </h3>
      <div className="route-chooser">
        <p className="field__hint">
          {order.code} · {order.productCode} {order.productName} ·{" "}
          {formatQuantity(order.plannedQuantity)} {order.outputUnitCode}
        </p>

        <div className="field">
          <label htmlFor="route-chooser-roteiro">Roteiro</label>
          <SearchableEntitySelect
            id="route-chooser-roteiro"
            options={opcoes}
            value={versionId}
            onChange={(id) => {
              setErro(null);
              setVersionId(id);
            }}
            onSearch={buscar}
            placeholder="Digite o código ou o nome do roteiro…"
            noOptionsMessage="Nenhum roteiro com versão ativa encontrado."
          />
          <p className="field__hint">Só aparecem roteiros com versão ativa. Grava-se a versão ativa do roteiro escolhido.</p>
        </div>

        {carregandoVersao && <p className="field__hint">Carregando roteiro…</p>}

        {versao && !carregandoVersao && (
          <div className="route-chooser__summary" aria-label="Resumo do roteiro escolhido" role="group">
            <dl className="profile-summary">
              <div>
                <dt>Roteiro</dt>
                <dd>
                  {versao.profileCode} — {versao.profileName}
                </dd>
              </div>
              <div>
                <dt>Versão</dt>
                <dd>{versao.versionLabel}</dd>
              </div>
              <div>
                <dt>Quantidade de referência</dt>
                <dd>{formatQuantity(versao.referenceQuantity)}</dd>
              </div>
              <div>
                <dt>Unidade</dt>
                <dd>{versao.referenceUomCode}</dd>
              </div>
            </dl>
            <h4 className="profile-subtitle">Etapas</h4>
            <ol className="route-chooser__steps">
              {versao.steps.map((passo) => (
                <li key={passo.id}>
                  {passo.name}{" "}
                  <span className="field__hint">
                    {PRODUCTION_STEP_SCALING_MODE_LABELS[passo.scalingMode]} · preparação{" "}
                    {formatMinutes(passo.setupDurationMinutes)} · execução {formatMinutes(passo.runDurationMinutes)}
                  </span>
                </li>
              ))}
            </ol>
            {bloqueio !== null && (
              <p className="form-alert" role="alert">
                A quantidade de referência deste roteiro está em {versao.referenceUomCode}, e esta ordem está em{" "}
                {order.outputUnitCode}: as unidades não se convertem. Escolha outro roteiro.
              </p>
            )}
            {mesmaVersao && (
              <p className="field__hint" role="status">
                Esta já é a versão aplicada nesta ordem.
              </p>
            )}
          </div>
        )}

        {mode === "regularizacao" && (
          <div className="callout">
            <p>
              Esta ordem já está {PRODUCTION_ORDER_STATUS_LABELS[order.status].toLowerCase()} e não tem roteiro.
              Aplicar agora é regularização: fica registrada com o seu motivo, e o roteiro não poderá ser
              trocado depois.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={confirmaRegularizacao}
                onChange={(event) => setConfirmaRegularizacao(event.target.checked)}
              />{" "}
              Confirmo a regularização desta ordem
            </label>
          </div>
        )}

        {hasSchedule && (
          <div className="callout">
            <p>
              Alterar o roteiro removerá a programação atual desta ordem, pois tempos e recursos podem mudar.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={confirmaProgramacao}
                onChange={(event) => setConfirmaProgramacao(event.target.checked)}
              />{" "}
              Remover a programação atual
            </label>
          </div>
        )}

        <div className="field">
          <label htmlFor="route-chooser-motivo">
            Motivo {motivoObrigatorio ? "(obrigatório)" : "(opcional)"}
          </label>
          <textarea
            id="route-chooser-motivo"
            rows={2}
            maxLength={500}
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
            {...(motivoObrigatorio ? { "aria-required": true } : {})}
          />
        </div>

        {erro && (
          <p className="form-alert" role="alert">
            {erro}
          </p>
        )}
      </div>

      <div className="confirm-dialog__actions route-chooser__actions">
        <button type="button" className="btn btn--ghost" onClick={onClose} disabled={acao !== null}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={!pronto || acao !== null}
          onClick={() => void aplicar(true)}
        >
          {acao === "padrao" ? rotuloEmCurso : "Definir como padrão do produto e aplicar"}
        </button>
        <button
          type="button"
          className="btn btn--accent"
          disabled={!pronto || acao !== null}
          onClick={() => void aplicar(false)}
        >
          {acao === "somente" ? rotuloEmCurso : "Aplicar somente nesta OP"}
        </button>
      </div>
    </ModalDialog>
  );
}
