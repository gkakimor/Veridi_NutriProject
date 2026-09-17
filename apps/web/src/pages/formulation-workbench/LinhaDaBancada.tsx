import type { ReactNode } from "react";
import type { SecaoDaFormula, SupplyResponsibility, UnitOfMeasureDTO } from "@veridi/shared";
import {
  ITEM_FAMILY_LABELS,
  PACKAGING_SUBTYPE_LABELS,
  SUPPLY_RESPONSIBILITIES,
  SUPPLY_RESPONSIBILITY_LABELS,
} from "@veridi/shared";
import { CalcHint } from "../../components/help/CalcHint";
import { DecimalField, PercentField } from "../../components/NumericField";
import { EntityLink } from "../../components/EntityLink";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { SearchableEntitySelect } from "../../components/SearchableEntitySelect";
import { SELETOR_DE_ITEM_SEM_CADASTRO } from "../items/item-permissions";
import { CONSULTAR_ITENS } from "../items/ItemConsultationDialog";
import { decimalLegivel } from "../../lib/decimal-field";
import { decimalDaApiComparavel } from "../../lib/dirty-fields";
import { formatPercentPtBr } from "../../lib/numeric-ptbr";
import {
  CASAS_PERCENTUAL_TECNICO,
  CASAS_QUANTIDADE,
  OPCOES_PERCENTUAL_TECNICO,
  OPCOES_QUANTIDADE,
} from "../../lib/numeric-scales";
import { formatQuantity, formatQuantityWithUnit } from "../../lib/quantity";
import type { CampoDoComponente, LinhaDaReceita } from "./linha-da-receita";
import {
  CAMPOS_DO_COMPONENTE,
  chaveDeErro,
  idDoCampo,
  purezaRegistradaSemAplicar,
  unidadeLegadaDaLinha,
} from "./linha-da-receita";
import { operandosDaDose } from "./previa-do-calculo";

/**
 * Uma linha da receita, na bancada — a MESMA nas duas telas.
 *
 * O componente recebe DADOS e CALLBACKS. Ele não sabe se está numa Formulação
 * de produto ou num Modelo, e não deve saber: no dia em que souber, metade das
 * suas regras passa a depender de um booleano e a bancada volta a ser duas.
 * O que difere entre as telas chega como propriedade explícita — o que a linha
 * pode editar, quais colunas a forma tem, o que a prévia já calculou.
 */
export interface LinhaDaBancadaProps {
  linha: LinhaDaReceita;
  secao: SecaoDaFormula;
  /** Rascunho edita; documento fechado só se lê. */
  editavel: boolean;
  /** A forma tem cápsula: a coluna "Por cápsula" existe. */
  mostrarPorCapsula: boolean;
  /** Unidades compatíveis com o Item desta linha. */
  unidades: UnitOfMeasureDTO[];
  /** O que o seletor de item oferece agora — sem os itens de outras linhas. */
  opcoesDeItem: EntityOption[];
  onBuscarItem: (termo: string) => Promise<EntityOption[]>;
  /** Ausente = a tela não oferece cadastrar item daqui. */
  onCriarItem?: (() => void) | undefined;
  /**
   * "Consultar itens" no seletor, com o que já foi digitado
   * (ASSISTED-ENTITY-SELECTOR-FOUNDATION-01). Ausente = só o autocomplete.
   */
  onConsultarItem?: ((termo: string) => void) | undefined;
  /**
   * O que falta no ITEM desta linha, quando a tela prende o salvar por isso.
   * Ausente = nada a dizer; a coluna não inventa recusa.
   */
  erroDoItem?: string | undefined;
  /** Grandezas exibidas: prévia enquanto se edita, servidor no que está gravado. */
  fisicoExibido: string | null;
  equivalenteExibido: string | null;
  dose: { teorica: string; fisica: string; porCapsula: string | null } | null;
  /** A conta do físico por embalagem, ao lado do número que ela produz. */
  explicacaoDoFisico: ReactNode;
  /** Onde a linha está na seção — decide se ela ainda sobe ou desce. */
  podeSubir: boolean;
  podeDescer: boolean;
  erros: Record<string, string>;
  onCampo: <K extends keyof LinhaDaReceita>(campo: K, valor: LinhaDaReceita[K]) => void;
  onFornecimento: (responsabilidade: SupplyResponsibility) => void;
  onItem: (itemId: string) => void;
  onMover: (direcao: -1 | 1) => void;
  onRemover: () => void;
}

export function LinhaDaBancada({
  linha,
  secao,
  editavel,
  mostrarPorCapsula,
  unidades,
  opcoesDeItem,
  onBuscarItem,
  onCriarItem,
  onConsultarItem,
  erroDoItem,
  fisicoExibido,
  equivalenteExibido,
  dose,
  explicacaoDoFisico,
  podeSubir,
  podeDescer,
  erros,
  onCampo,
  onFornecimento,
  onItem,
  onMover,
  onRemover,
}: LinhaDaBancadaProps) {
  const daComposicao = secao === "COMPOSICAO";
  const nomeDoItem = linha.itemCode || "componente";
  /*
    Uma unidade compatível só: o Item decide, e não há o que perguntar. Vale
    apenas com Item escolhido — linha em branco ainda não tem cadastro que
    responda, e ali o seletor continua sendo a pergunta certa.
  */
  const unidadeUnica = linha.itemId !== "" && unidades.length === 1 && linha.unitCode !== "";
  const erroDe = (campo: CampoDoComponente) => erros[chaveDeErro(linha.key, campo)];
  const marcaDeErro = (campo: CampoDoComponente) =>
    erroDe(campo)
      ? {
          "aria-invalid": true as const,
          "aria-describedby": `${idDoCampo(linha.key, campo)}-error`,
        }
      : {};
  const mensagemDeErro = (campo: CampoDoComponente) =>
    erroDe(campo) ? (
      <p className="field__error" id={`${idDoCampo(linha.key, campo)}-error`}>
        {erroDe(campo)}
      </p>
    ) : null;
  /* Pureza do cadastro de HOJE ao lado da aplicada, quando as duas divergem:
     é o que explica uma versão histórica não bater com o item de agora. */
  const purezaDaLinha = decimalLegivel(linha.purityPercentApplied, OPCOES_PERCENTUAL_TECNICO);
  const idDoErroDoItem = `comp-${linha.key}-item-error`;
  /* Unidade gravada que a lista não oferece — legado, dito onde acontece. */
  const unidadeLegada = unidadeLegadaDaLinha(linha, unidades);
  const idDoErroDaUnidade = `comp-${linha.key}-unidade-legada`;
  const cadastroDiferente =
    linha.itemDefaultPurityPercent !== null &&
    decimalDaApiComparavel(linha.itemDefaultPurityPercent) !== decimalDaApiComparavel(purezaDaLinha);

  return (
    <tr className={CAMPOS_DO_COMPONENTE.some((campo) => erroDe(campo)) ? "is-invalid" : undefined}>
      <td className="col-item">
        {editavel ? (
          <SearchableEntitySelect
            id={`componente-${linha.key}`}
            value={linha.itemId}
            onChange={onItem}
            placeholder={
              daComposicao
                ? "Buscar matéria-prima por código ou nome…"
                : "Buscar embalagem por código ou nome…"
            }
            options={opcoesDeItem}
            onSearch={onBuscarItem}
            canCreate={Boolean(onCriarItem)}
            /* Sem cadastro daqui, a busca vazia diz a quem pedir o item. */
            {...(onCriarItem ? {} : SELETOR_DE_ITEM_SEM_CADASTRO)}
            createLabel="Novo item de estoque"
            /* Sair para cadastrar o item NÃO é descartar: o rascunho vai
               junto e volta aplicado na linha. */
            onCreateNew={onCriarItem ?? (() => undefined)}
            /* A consulta assistida por cima da bancada: o autocomplete segue
               sendo o caminho rápido, e esta é a ação a mais. */
            {...(onConsultarItem
              ? { consultLabel: CONSULTAR_ITENS, onConsult: onConsultarItem }
              : {})}
            {...(erroDoItem
              ? { "aria-invalid": true as const, "aria-describedby": idDoErroDoItem }
              : {})}
          />
        ) : (
          <EntityLink kind="item" id={linha.itemId} code={linha.itemCode} name={linha.itemName} />
        )}
        {erroDoItem && (
          <p className="field__error" id={idDoErroDoItem}>
            {erroDoItem}
          </p>
        )}
        {/*
          O CÓDIGO LEGADO ao lado da unidade de estoque, e só quando existe.
          Quem confere a receita contra a planilha antiga procura por ele, e
          sair para o cadastro do Item a cada linha era o que essa conferência
          custava. Item sem legado não ganha rótulo vazio nem travessão: a
          linha simplesmente não o menciona.
        */}
        <span className="cell-sub">
          {/* O item que a receita já referencia continua à vista mesmo inativo
              — é o que permite ler e corrigir uma matriz antiga —, e diz que
              está inativo onde a pessoa olha, não só na lista do seletor. */}
          {!linha.itemActive && linha.itemId !== "" && (
            <>
              <span className="badge badge--inactive">Inativo</span>{" "}
            </>
          )}
          {linha.stockUnitCode ? `Estoque em ${linha.stockUnitCode}` : "Estoque: —"}
          {linha.itemExternalCode ? ` · Código legado: ${linha.itemExternalCode}` : ""}
          {linha.itemPackagingSubtype
            ? ` · ${PACKAGING_SUBTYPE_LABELS[linha.itemPackagingSubtype]}`
            : ""}
          {!linha.itemActive && linha.itemId !== "" && " · mantido pelo histórico"}
        </span>
      </td>

      {daComposicao && (
        <td className="col-fonte" data-label="Fonte / Função">
          {linha.itemSourceName ?? "—"}
          {(linha.itemFamily || linha.itemDeclaredNutrient) && (
            <span className="cell-sub">
              {[
                linha.itemFamily ? ITEM_FAMILY_LABELS[linha.itemFamily] : null,
                linha.itemDeclaredNutrient,
              ]
                .filter((parte): parte is string => Boolean(parte))
                .join(" · ")}
            </span>
          )}
        </td>
      )}

      {daComposicao && (
        <td className="col-pureza is-numeric" data-label="Pureza (%)">
          {editavel ? (
            <>
              <PercentField
                id={idDoCampo(linha.key, "purityPercentApplied")}
                scale={CASAS_PERCENTUAL_TECNICO}
                aria-label={`Pureza de ${nomeDoItem}`}
                placeholder="—"
                /* A seta para onde a validação pararia: pureza é 0 < x ≤ 100. */
                stepper={{ min: "0", max: "100" }}
                value={linha.purityPercentApplied}
                onChangeValue={(valor) => onCampo("purityPercentApplied", valor)}
                {...marcaDeErro("purityPercentApplied")}
              />
              {mensagemDeErro("purityPercentApplied")}
            </>
          ) : (
            <span>
              {linha.purityPercentApplied
                ? formatPercentPtBr(purezaDaLinha, OPCOES_PERCENTUAL_TECNICO)
                : "—"}
            </span>
          )}
          {/*
            A referência do cadastro de HOJE, discreta, só quando diverge do
            que esta versão usa: é o que explica uma versão histórica não
            bater com o Item de agora, sem transformar a coluna num debate.
          */}
          {cadastroDiferente && (
            <span className="cell-sub">
              Cadastro:{" "}
              {formatPercentPtBr(linha.itemDefaultPurityPercent, OPCOES_PERCENTUAL_TECNICO)}
            </span>
          )}
          {/* Versão gravada sob o contrato antigo: a pureza está ali e não
              corrigiu nada. Calar seria deixar a coluna mentir. */}
          {purezaRegistradaSemAplicar(linha) && (
            <span className="cell-sub">registrada, não aplicada</span>
          )}
        </td>
      )}

      <td
        className="col-quantidade is-numeric"
        data-label={daComposicao ? "Alvo por dose" : "Quantidade"}
      >
        {editavel ? (
          <>
            <div
              className={
                unidadeUnica ? "quantidade-unidade quantidade-unidade--fixa" : "quantidade-unidade"
              }
            >
              <DecimalField
                id={idDoCampo(linha.key, "quantity")}
                scale={CASAS_QUANTIDADE}
                placeholder="0"
                aria-label={`Quantidade de ${nomeDoItem}`}
                value={linha.quantity}
                onChangeValue={(valor) => onCampo("quantity", valor)}
                {...marcaDeErro("quantity")}
              />
              {/*
                ESCOLHER ENTRE UMA OPÇÃO NÃO É ESCOLHA.
                A unidade da linha só vira campo quando o cadastro oferece
                mais de uma unidade compatível com o Item. Embalagem é o caso
                claro: a dimensão do pote é contagem, e `un` é a única unidade
                cadastrada nela — o seletor gastava a largura da coluna para
                repetir o que o cadastro já diz, e o número, que é o que se
                digita ali, ficava espremido ao lado dele. A unidade continua
                viajando no payload; ela passa a ser lida do Item em vez de
                redigitada. Matéria-prima em massa segue com o seletor: mg, g
                e kg são três escolhas reais.
              */}
              {unidadeUnica ? (
                <span className="quantidade-unidade__unidade">{linha.unitCode}</span>
              ) : (
                <select
                  id={idDoCampo(linha.key, "unitCode")}
                  aria-label={`Unidade de ${nomeDoItem}`}
                  value={linha.unitCode}
                  onChange={(event) => onCampo("unitCode", event.target.value)}
                  {...marcaDeErro("unitCode")}
                  {...(unidadeLegada
                    ? { "aria-invalid": true as const, "aria-describedby": idDoErroDaUnidade }
                    : {})}
                >
                  <option value="">—</option>
                  {/* A unidade GRAVADA continua à vista mesmo fora da lista:
                      tirá-la faria o seletor cair no vazio e apagar, no
                      primeiro salvamento, o que a receita declarou. */}
                  {linha.unitCode && unidadeLegada && (
                    <option value={linha.unitCode} disabled={linha.itemId !== ""}>
                      {linha.unitCode}
                    </option>
                  )}
                  {unidades.map((unit) => (
                    <option key={unit.code} value={unit.code}>
                      {unit.code}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {mensagemDeErro("quantity")}
            {mensagemDeErro("unitCode")}
            {unidadeLegada && (
              <p className="field__error" id={idDoErroDaUnidade}>
                {unidadeLegada}
              </p>
            )}
          </>
        ) : (
          `${formatQuantity(decimalLegivel(linha.quantity, OPCOES_QUANTIDADE) ?? linha.quantity)} ${linha.unitCode}`
        )}
      </td>

      {daComposicao && (
        <td className="col-dose is-numeric" data-label="Física por dose">
          <span className="estoque-valor__numero estoque-valor--dose">
            {formatQuantityWithUnit(dose?.fisica ?? null, linha.unitCode)}
          </span>
          {dose && (
            <CalcHint
              label="Física por dose"
              operandos={operandosDaDose(linha)}
              resultado={`${formatQuantity(dose.fisica)} ${linha.unitCode}`}
              nota="Mesmo motor da Ordem de Produção e do CMV — a pureza corrige a quantidade física do ingrediente."
            />
          )}
        </td>
      )}

      {daComposicao && mostrarPorCapsula && (
        <td className="col-capsula is-numeric" data-label="Por cápsula">
          <span className="estoque-valor__numero estoque-valor--capsula">
            {formatQuantityWithUnit(dose?.porCapsula ?? null, linha.unitCode)}
          </span>
        </td>
      )}

      {/*
        FORNECIMENTO — a decisão da linha que continua sendo de quem formula.

        A BASE saiu daqui (FORMULATION-COMPONENT-BASIS-AUTOMATION-01): ela é
        consequência da seção e do modo da receita, o sistema a define e a
        grava, e um seletor — ou um texto fixo repetindo o que ninguém decide —
        só ocupava a linha. Quem precisa conferir a base de uma versão antiga a
        encontra na ajuda do cálculo do "Por embalagem".
      */}
      <td className="col-regras" data-label="Fornecimento">
        {editavel ? (
          <select
            aria-label="Responsabilidade de fornecimento"
            value={linha.supplyResponsibility}
            onChange={(event) => onFornecimento(event.target.value as SupplyResponsibility)}
          >
            {SUPPLY_RESPONSIBILITIES.map((responsibility) => (
              <option key={responsibility} value={responsibility}>
                {SUPPLY_RESPONSIBILITY_LABELS[responsibility]}
              </option>
            ))}
          </select>
        ) : (
          SUPPLY_RESPONSIBILITY_LABELS[linha.supplyResponsibility]
        )}
      </td>

      {/*
        RESERVA DE PRODUÇÃO — coluna, como a pureza, e pelo mesmo motivo: o
        número da planilha (10% no Ácido Fólico, 2% no Beef) tem de estar
        à vista e editável na linha. Ela NÃO entra na dose: o campo ao lado
        continua igual depois de digitar aqui.
      */}
      {daComposicao && (
        <td className="col-reserva is-numeric" data-label="Reserva %">
          {editavel ? (
            <>
              <PercentField
                id={idDoCampo(linha.key, "overagePercent")}
                scale={CASAS_PERCENTUAL_TECNICO}
                aria-label={`Reserva % de ${nomeDoItem}`}
                placeholder="—"
                /* Sem teto: o domínio nunca declarou um para a reserva. */
                stepper={{ min: "0" }}
                value={linha.overagePercent}
                onChangeValue={(valor) => onCampo("overagePercent", valor)}
                {...marcaDeErro("overagePercent")}
              />
              {mensagemDeErro("overagePercent")}
            </>
          ) : (
            <span>
              {linha.overagePercent
                ? formatPercentPtBr(
                    decimalLegivel(linha.overagePercent, OPCOES_PERCENTUAL_TECNICO),
                    OPCOES_PERCENTUAL_TECNICO,
                  )
                : "—"}
            </span>
          )}
        </td>
      )}

      <td className="col-fisico is-numeric" data-label="Por embalagem">
        <span className="estoque-valor__numero estoque-valor--fisico">
          {formatQuantityWithUnit(fisicoExibido, linha.stockUnitCode)}
        </span>
        <span className="cell-sub">
          equivalente{" "}
          <span className="estoque-valor__numero estoque-valor--equivalente">
            {formatQuantityWithUnit(equivalenteExibido, linha.stockUnitCode)}
          </span>
        </span>
        {explicacaoDoFisico}
      </td>

      {editavel && (
        <td className="col-acoes">
          <div className="col-acoes__grupo">
            {/* Subir e descer, e o remover em vermelho — apagar uma linha da
                receita não se parece com reordená-la. */}
            <span className="col-acoes__ordem">
              <button
                type="button"
                className="btn btn--ghost btn--icone"
                aria-label={`Subir ${nomeDoItem}`}
                disabled={!podeSubir}
                onClick={() => onMover(-1)}
              >
                <svg viewBox="0 0 10 6" aria-hidden="true" focusable="false">
                  <path d="M5 0 10 6H0z" fill="currentColor" />
                </svg>
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--icone"
                aria-label={`Descer ${nomeDoItem}`}
                disabled={!podeDescer}
                onClick={() => onMover(1)}
              >
                <svg viewBox="0 0 10 6" aria-hidden="true" focusable="false">
                  <path d="M5 6 0 0h10z" fill="currentColor" />
                </svg>
              </button>
            </span>
            <button
              type="button"
              className="btn btn--ghost-danger btn--sm"
              aria-label={`Remover ${nomeDoItem}`}
              onClick={onRemover}
            >
              ✕
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}
