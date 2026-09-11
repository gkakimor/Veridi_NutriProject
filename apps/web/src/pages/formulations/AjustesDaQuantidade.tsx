import { useState } from "react";
import type { ReactNode } from "react";
import type { FormulationComponentQuantityMode } from "@veridi/shared";
import {
  FORMULATION_QUANTITY_MODE_DESCRIPTIONS,
  FORMULATION_QUANTITY_MODE_LABELS,
} from "@veridi/shared";
import { mensagemDecimalInvalido, parseDecimalInput } from "../../lib/decimal-input";
import { formatQuantity } from "../../lib/quantity";

/**
 * Ajustes da quantidade de um componente — a MESMA configuração na Formulação
 * e no Modelo de Formulação (§52, FORMULATION-ADJUSTMENTS-UX-01).
 *
 * O painel edita um RASCUNHO local da linha: mexer no modo, na pureza, no
 * overage e nas marcas não muda a linha até "Aplicar ajustes", e "Cancelar"
 * descarta o que foi mexido desde que o painel abriu. Antes, cada clique já
 * era a linha: não havia como concluir a edição de um ajuste — nem como
 * desistir dela sem desfazer campo por campo.
 *
 * A conta da quantidade física NÃO mora aqui: quem chama monta a prévia com o
 * motor canônico (`calcularQuantidadeDoComponente`) e a entrega como filho.
 */

export interface AjustesDaQuantidade {
  quantityMode: FormulationComponentQuantityMode;
  /** Texto do campo; vazio = não informado — nunca 0% nem 100% implícito. */
  purityPercentApplied: string;
  overagePercent: string;
  applyPurityAdjustment: boolean;
  applyOverageAdjustment: boolean;
}

export type CampoDeAjuste = "purityPercentApplied" | "overagePercent";

const MODOS: readonly FormulationComponentQuantityMode[] = [
  "PHYSICAL_DIRECT",
  "THEORETICAL_WITH_ADJUSTMENTS",
];

/**
 * Sair do modo teórico desliga as marcas — na tela e no servidor (§52). Marca
 * ligada sob física direta é registro que mente: o cálculo a ignora, e voltar
 * o modo depois religaria a correção sem ninguém ter marcado nada.
 */
export function normalizarAjustes(ajustes: AjustesDaQuantidade): AjustesDaQuantidade {
  return ajustes.quantityMode === "THEORETICAL_WITH_ADJUSTMENTS"
    ? ajustes
    : { ...ajustes, applyPurityAdjustment: false, applyOverageAdjustment: false };
}

/** Mesma configuração? Compara o que a linha GRAVARIA, não o texto cru. */
export function ajustesIguais(a: AjustesDaQuantidade, b: AjustesDaQuantidade): boolean {
  const x = normalizarAjustes(a);
  const y = normalizarAjustes(b);
  return (
    x.quantityMode === y.quantityMode &&
    x.purityPercentApplied.trim() === y.purityPercentApplied.trim() &&
    x.overagePercent.trim() === y.overagePercent.trim() &&
    x.applyPurityAdjustment === y.applyPurityAdjustment &&
    x.applyOverageAdjustment === y.applyOverageAdjustment
  );
}

/**
 * As regras da Formulação real, ditas antes de aplicar: pureza 0 < x ≤ 100,
 * overage ≥ 0, vazio = não informado. A mensagem nomeia o componente, porque
 * numa receita de doze linhas "Pureza inválida" não diz onde procurar.
 */
export function errosDosAjustes(
  ajustes: AjustesDaQuantidade,
  nome: string,
): Partial<Record<CampoDeAjuste, string>> {
  const erros: Partial<Record<CampoDeAjuste, string>> = {};
  if (ajustes.purityPercentApplied.trim() !== "") {
    const pureza = parseDecimalInput(ajustes.purityPercentApplied);
    if (pureza === null) erros.purityPercentApplied = `${nome} — ${mensagemDecimalInvalido("Pureza %")}`;
    else if (Number(pureza) <= 0 || Number(pureza) > 100) {
      erros.purityPercentApplied = `${nome} — Pureza % deve ser maior que zero e no máximo 100.`;
    }
  }
  if (ajustes.overagePercent.trim() !== "") {
    const overage = parseDecimalInput(ajustes.overagePercent);
    if (overage === null) erros.overagePercent = `${nome} — ${mensagemDecimalInvalido("Overage %")}`;
    else if (Number(overage) < 0) erros.overagePercent = `${nome} — Overage % não pode ser negativo.`;
  }
  return erros;
}

function percentual(texto: string): string {
  const valor = parseDecimalInput(texto);
  return valor === null ? texto.trim() : formatQuantity(valor);
}

/**
 * O que fica na linha depois de aplicar: "Calculada · Pureza 98% · Overage 2%",
 * ou "Física informada · Pureza 98% · Overage 2% · só registro".
 *
 * Diz o estado REAL. Percentual registrado e não autorizado aparece como tal,
 * e modo teórico sem nada marcado não se apresenta como correção — "Calculada"
 * sozinho afirmaria um ajuste que não está ligado.
 */
export function resumoDosAjustes(ajustes: AjustesDaQuantidade): string {
  const a = normalizarAjustes(ajustes);
  const temPureza = a.purityPercentApplied.trim() !== "";
  const temOverage = a.overagePercent.trim() !== "";
  const pureza = `Pureza ${percentual(a.purityPercentApplied)}%`;
  const overage = `Overage ${percentual(a.overagePercent)}%`;

  if (a.quantityMode === "PHYSICAL_DIRECT") {
    const registrados = [temPureza ? pureza : null, temOverage ? overage : null].filter(
      (parte): parte is string => parte !== null,
    );
    return registrados.length > 0
      ? `Física informada · ${registrados.join(" · ")} · só registro`
      : "Física informada";
  }

  const partes: string[] = [];
  if (a.applyPurityAdjustment) partes.push(temPureza ? pureza : "Pureza não informada");
  if (a.applyOverageAdjustment) partes.push(temOverage ? overage : "Overage não informado");
  if (partes.length === 0) partes.push("nenhum ajuste marcado");
  if (!a.applyPurityAdjustment && temPureza) partes.push(`${pureza} não aplicada`);
  if (!a.applyOverageAdjustment && temOverage) partes.push(`${overage} não aplicado`);
  return `Calculada · ${partes.join(" · ")}`;
}

/**
 * Estado dos painéis de uma tabela: quais estão abertos, o rascunho de cada
 * um e onde alguém tentou sair com alteração por aplicar.
 *
 * O botão da linha abre e fecha — mas não fecha por cima de alteração aberta:
 * descartar em silêncio o que a pessoa acabou de configurar é o defeito que o
 * rascunho existe para evitar. O painel fica e diz o que falta.
 */
export function useAjustesEmEdicao() {
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});
  const [rascunhos, setRascunhos] = useState<Record<string, AjustesDaQuantidade>>({});
  const [avisos, setAvisos] = useState<Record<string, boolean>>({});

  const aberto = (chave: string) => abertos[chave] === true;
  const rascunhoDe = (chave: string): AjustesDaQuantidade | undefined => rascunhos[chave];

  function abrir(chave: string, atual: AjustesDaQuantidade) {
    setRascunhos((prev) => ({ ...prev, [chave]: prev[chave] ?? atual }));
    setAbertos((prev) => ({ ...prev, [chave]: true }));
  }

  function fechar(chave: string) {
    setAbertos((prev) => ({ ...prev, [chave]: false }));
    setRascunhos(({ [chave]: _descartado, ...resto }) => resto);
    setAvisos(({ [chave]: _aviso, ...resto }) => resto);
  }

  function mudar(chave: string, proximo: AjustesDaQuantidade) {
    setRascunhos((prev) => ({ ...prev, [chave]: proximo }));
  }

  function alterado(chave: string, atual: AjustesDaQuantidade): boolean {
    const rascunho = rascunhos[chave];
    return abertos[chave] === true && rascunho !== undefined && !ajustesIguais(rascunho, atual);
  }

  function alternar(chave: string, atual: AjustesDaQuantidade) {
    if (!aberto(chave)) {
      abrir(chave, atual);
      return;
    }
    if (alterado(chave, atual)) {
      avisar(chave);
      return;
    }
    fechar(chave);
  }

  function avisar(chave: string) {
    setAvisos((prev) => ({ ...prev, [chave]: true }));
  }

  /** Volta de outra tela: os painéis que estavam em edição reabrem com o rascunho. */
  function restaurar(salvos: Record<string, AjustesDaQuantidade>) {
    setRascunhos(salvos);
    setAbertos(Object.fromEntries(Object.keys(salvos).map((chave) => [chave, true])));
  }

  return {
    aberto,
    rascunhoDe,
    abrir,
    fechar,
    mudar,
    alterado,
    alternar,
    avisar,
    aviso: (chave: string) => avisos[chave] === true,
    rascunhos,
    restaurar,
  };
}

interface PainelDeAjustesProps {
  /** Chave da linha: nome dos rádios, ids das descrições e do botão de aplicar. */
  idBase: string;
  /** Id de cada campo de percentual — a tela foca por ele depois de uma recusa. */
  idDoCampo: (campo: CampoDeAjuste) => string;
  nomeDoItem: string;
  rascunho: AjustesDaQuantidade;
  /** O que a linha tem hoje: é contra isto que "alterado" é medido. */
  confirmado: AjustesDaQuantidade;
  onChange: (proximo: AjustesDaQuantidade) => void;
  onAplicar: () => void;
  onCancelar: () => void;
  /** Onde a regra vai valer: a frase do cálculo muda entre Formulação e Modelo. */
  contexto?: "FORMULACAO" | "MODELO" | undefined;
  /** Recusa que veio de fora (servidor, salvar) para um campo desta linha. */
  errosExternos?: Partial<Record<CampoDeAjuste, string>> | undefined;
  /** Alguém tentou fechar, salvar ou ativar com esta alteração aberta. */
  avisoDePendencia?: boolean | undefined;
  /** Prévia e explicação da conta, montadas por quem chama com o motor canônico. */
  children?: ReactNode;
}

/** Id do botão "Aplicar ajustes" de uma linha — a tela leva o foco até ele. */
export function idDoBotaoAplicar(idBase: string): string {
  return `${idBase}-aplicar`;
}

export function PainelDeAjustes(props: PainelDeAjustesProps) {
  const { rascunho } = props;
  const teorico = rascunho.quantityMode === "THEORETICAL_WITH_ADJUSTMENTS";
  const erros = errosDosAjustes(rascunho, props.nomeDoItem);
  const invalido = Object.keys(erros).length > 0;
  const alterado = !ajustesIguais(rascunho, props.confirmado);

  const mensagem = (campo: CampoDeAjuste) => erros[campo] ?? props.errosExternos?.[campo];
  const idDaMensagem = (campo: CampoDeAjuste) => `${props.idDoCampo(campo)}-error`;
  const marcaDeErro = (campo: CampoDeAjuste) =>
    mensagem(campo)
      ? { "aria-invalid": true as const, "aria-describedby": idDaMensagem(campo) }
      : {};

  const mudar = <K extends keyof AjustesDaQuantidade>(campo: K, valor: AjustesDaQuantidade[K]) =>
    props.onChange({ ...rascunho, [campo]: valor });

  const fraseDoCalculo =
    props.contexto === "MODELO"
      ? "Aplicado o Modelo, a Formulação calcula a quantidade física com os ajustes marcados."
      : "O sistema calcula a quantidade física usada em novas Ordens de Produção e no CMV desta versão.";

  return (
    <div className="ajuste-quantidade__corpo">
      <fieldset className="ajuste-quantidade__modos">
        <legend>O que a quantidade informada significa</legend>
        {MODOS.map((modo) => (
          <label key={modo} className="ajuste-quantidade__modo">
            <input
              type="radio"
              name={`modo-${props.idBase}`}
              /* O nome acessível é só o rótulo; a descrição vem por
                 `aria-describedby`. */
              aria-label={FORMULATION_QUANTITY_MODE_LABELS[modo]}
              aria-describedby={`modo-${props.idBase}-${modo}-descricao`}
              checked={rascunho.quantityMode === modo}
              onChange={() => props.onChange(normalizarAjustes({ ...rascunho, quantityMode: modo }))}
            />
            <span className="ajuste-quantidade__modo-texto">
              <strong>{FORMULATION_QUANTITY_MODE_LABELS[modo]}</strong>
              <span
                className="ajuste-quantidade__descricao"
                id={`modo-${props.idBase}-${modo}-descricao`}
              >
                {FORMULATION_QUANTITY_MODE_DESCRIPTIONS[modo]}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {teorico ? (
        /*
          Trocar o modo não liga ajuste nenhum — de propósito: marcar é a
          autorização. A frase diz o estado REAL: com nada marcado, nada é
          corrigido.
        */
        <>
          <p className="field__hint">
            {rascunho.applyPurityAdjustment || rascunho.applyOverageAdjustment
              ? fraseDoCalculo
              : "Nenhum ajuste marcado. Marque abaixo o que deve ser corrigido: enquanto nada estiver marcado, a quantidade física continua igual à informada."}
          </p>
          <p className="field__hint ajuste-quantidade__aviso">
            Não marque a correção se a quantidade informada já estiver corrigida — ela seria
            aplicada duas vezes.
          </p>
        </>
      ) : (
        /*
          Em física informada, pureza e overage aparecem SEM caixa de marcar. A
          frase precisa estar onde a pessoa digita: é a regra central do modo.
        */
        <p className="field__hint">
          Pureza e overage aqui são registro de auditoria: preencher não aplica correção nenhuma.
          A quantidade informada continua sendo a física.
        </p>
      )}

      <div className="ajuste-quantidade__campos">
        <label>
          {teorico && (
            <input
              type="checkbox"
              aria-label="Corrigir pela pureza"
              checked={rascunho.applyPurityAdjustment}
              onChange={(event) => mudar("applyPurityAdjustment", event.target.checked)}
            />
          )}
          <span>Pureza %</span>
          <input
            id={props.idDoCampo("purityPercentApplied")}
            type="text"
            inputMode="decimal"
            aria-label="Pureza aplicada"
            placeholder="—"
            value={rascunho.purityPercentApplied}
            onChange={(event) => mudar("purityPercentApplied", event.target.value)}
            {...marcaDeErro("purityPercentApplied")}
          />
        </label>
        {mensagem("purityPercentApplied") && (
          <p className="field__error" id={idDaMensagem("purityPercentApplied")}>
            {mensagem("purityPercentApplied")}
          </p>
        )}

        <label>
          {teorico && (
            <input
              type="checkbox"
              aria-label="Aplicar overage"
              checked={rascunho.applyOverageAdjustment}
              onChange={(event) => mudar("applyOverageAdjustment", event.target.checked)}
            />
          )}
          <span>Overage %</span>
          <input
            id={props.idDoCampo("overagePercent")}
            type="text"
            inputMode="decimal"
            aria-label="Overage do componente"
            placeholder="—"
            value={rascunho.overagePercent}
            onChange={(event) => mudar("overagePercent", event.target.value)}
            {...marcaDeErro("overagePercent")}
          />
        </label>
        {mensagem("overagePercent") && (
          <p className="field__error" id={idDaMensagem("overagePercent")}>
            {mensagem("overagePercent")}
          </p>
        )}
      </div>

      {props.children}

      {props.avisoDePendencia && alterado && (
        <p className="field__hint ajuste-quantidade__aviso" role="status">
          Há ajustes não aplicados nesta linha. Aplique ou cancele antes de continuar.
        </p>
      )}

      <div className="ajuste-quantidade__acoes">
        {/* "Aplicar", não "Salvar": confirma a linha; gravar a versão é outro botão. */}
        <button
          type="button"
          id={idDoBotaoAplicar(props.idBase)}
          className="btn btn--accent btn--sm"
          disabled={!alterado || invalido}
          onClick={props.onAplicar}
        >
          Aplicar ajustes
        </button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={props.onCancelar}>
          Cancelar
        </button>
        {!alterado && <span className="field__hint">Nenhuma alteração para aplicar.</span>}
      </div>
    </div>
  );
}
