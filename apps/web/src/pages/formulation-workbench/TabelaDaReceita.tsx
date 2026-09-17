import { useState } from "react";
import type { ReactNode } from "react";
import type {
  ResumoDaDose,
  SecaoDaFormula,
  SupplyResponsibility,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import { UNIDADE_DE_MASSA_DA_DOSE } from "@veridi/shared";
import { formatQuantity } from "../../lib/quantity";
import { formatIntegerPtBr } from "../../lib/numeric-ptbr";
import { FormSection } from "../../components/FormSection";
import { TableEmptyRow } from "../../components/TableEmptyRow";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { ItemConsultationDialog } from "../items/ItemConsultationDialog";
import { Dica } from "./dicas";
import type { HelpHintId } from "../../help/help-content";
import { LinhaDaBancada } from "./LinhaDaBancada";
import type { ItemDaBancada } from "./catalogo-de-itens";
import { itemDaBancada, tipoDaSecao } from "./catalogo-de-itens";
import type { LinhaDaReceita } from "./linha-da-receita";

/**
 * A TABELA DE UMA SEÇÃO DA RECEITA — composição ou embalagem, a mesma nas duas
 * telas.
 *
 * A seção sai do TIPO REAL do Item, nunca do nome: "cápsula" é matéria-prima
 * num produto e embalagem em outro, e quem responde isso é o cadastro. Quem
 * chama já separou as linhas; aqui se desenha a grade que as duas bancadas
 * compartilham, com as MESMAS colunas, larguras e rótulos.
 */
export interface TabelaDaReceitaProps {
  secao: SecaoDaFormula;
  /** Só as linhas DESTA seção, na ordem em que a receita as lista. */
  linhas: LinhaDaReceita[];
  editavel: boolean;
  mostrarPorCapsula: boolean;
  unidadesDaLinha: (linha: LinhaDaReceita) => UnitOfMeasureDTO[];
  opcoesDeItem: (linha: LinhaDaReceita) => EntityOption[];
  onBuscarItem: (linha: LinhaDaReceita, termo: string) => Promise<EntityOption[]>;
  onCriarItem?: ((linha: LinhaDaReceita) => void) | undefined;
  /**
   * CONSULTA ASSISTIDA do Item da linha (ASSISTED-ENTITY-SELECTOR-FOUNDATION-01).
   *
   * Ausente = só o autocomplete. Presente, o seletor oferece "Consultar itens",
   * e a consulta abre por cima da tela com o MESMO recorte do seletor: o tipo
   * da seção, só ativos e fora o que outra linha já usa. "+ Novo item de
   * estoque" dentro dela é `onCriarItem` — a criação no contexto de sempre.
   */
  consultaDeItem?:
    | {
        /** A tela de origem, para a trilha da consulta: "Formulação". */
        origem: string;
        /** O item escolhido na consulta — a página o põe no catálogo e na linha. */
        onEscolher: (linha: LinhaDaReceita, item: ItemDaBancada) => void;
      }
    | undefined;
  /** O que falta no Item da linha, quando a tela prende o salvar por isso. */
  erroDoItem?: ((linha: LinhaDaReceita) => string | undefined) | undefined;
  valoresDaLinha: (linha: LinhaDaReceita) => {
    fisicoExibido: string | null;
    equivalenteExibido: string | null;
    dose: { teorica: string; fisica: string; porCapsula: string | null } | null;
  };
  explicacaoDoFisico: (linha: LinhaDaReceita, fisico: string | null) => ReactNode;
  erros: Record<string, string>;
  onCampo: <K extends keyof LinhaDaReceita>(
    key: string,
    campo: K,
    valor: LinhaDaReceita[K],
  ) => void;
  onFornecimento: (key: string, responsabilidade: SupplyResponsibility) => void;
  onItem: (key: string, itemId: string) => void;
  onMover: (key: string, direcao: -1 | 1) => void;
  onRemover: (key: string) => void;
  onAdicionar: (secao: SecaoDaFormula) => void;
  /**
   * Os totais técnicos da dose, somados pelo mesmo motor das linhas.
   *
   * Vão no RODAPÉ da composição, cada um sob a coluna que ele soma: o alvo sob
   * "Alvo por dose", a massa física sob "Física por dose" e a massa por cápsula
   * sob "Por cápsula". Conferir a receita é conferir a soma, e ter de procurar
   * esses três números num cartão de resumo mais abaixo é conferir de memória.
   *
   * A embalagem não recebe: pote e tampa não somam massa de dose.
   */
  totaisDaDose?: ResumoDaDose | undefined;
  /**
   * Qual ⓘ explica a coluna de fornecimento.
   *
   * A regra é a mesma — Veridi ou cliente —, mas o que ela SIGNIFICA muda com o
   * documento: na Formulação é a decisão da versão; no Modelo é sugestão, e a
   * cópia leva o valor como ponto de partida. Texto que diverge vira propriedade
   * explícita, nunca um `ehModelo` dentro do componente.
   */
  dicaDoFornecimento?: HelpHintId | undefined;
}

/**
 * Quantas colunas a tabela da seção tem — só a linha de vazio precisa saber.
 *
 * Composição: ingrediente, fonte, pureza, alvo, física por dose, fornecimento,
 * reserva e por embalagem — mais "por cápsula" quando a forma é cápsula.
 * Embalagem: item, quantidade, fornecimento, por embalagem. A coluna de ações
 * só existe quando a receita é editável.
 */
export function colunasDaSecao(
  daComposicao: boolean,
  mostrarPorCapsula: boolean,
  editavel: boolean,
): number {
  const fixas = daComposicao ? 8 + (mostrarPorCapsula ? 1 : 0) : 4;
  return fixas + (editavel ? 1 : 0);
}

export function TabelaDaReceita({
  secao,
  linhas,
  editavel,
  mostrarPorCapsula,
  unidadesDaLinha,
  opcoesDeItem,
  onBuscarItem,
  onCriarItem,
  consultaDeItem,
  erroDoItem,
  valoresDaLinha,
  explicacaoDoFisico,
  erros,
  onCampo,
  onFornecimento,
  onItem,
  onMover,
  onRemover,
  onAdicionar,
  totaisDaDose,
  dicaDoFornecimento = "formulacao.fornecimento",
}: TabelaDaReceitaProps) {
  const daComposicao = secao === "COMPOSICAO";
  /** A consulta aberta: qual linha pediu e o que estava digitado no seletor dela. */
  const [consulta, setConsulta] = useState<{ chave: string; termo: string } | null>(null);
  const linhaConsultada =
    consulta === null ? null : (linhas.find((linha) => linha.key === consulta.chave) ?? null);

  /*
   * O que outra linha já usa, como o seletor: aparece na consulta, mas não se
   * escolhe. Some da lista sem aviso seria o mesmo "não existe" que leva a
   * cadastrar de novo. As linhas desta seção bastam — a seção sai do tipo do
   * Item, e um item deste tipo não mora na outra.
   */
  function usadoPorOutraLinha(linha: LinhaDaReceita, itemId: string): boolean {
    return linhas.some((outra) => outra.key !== linha.key && outra.itemId === itemId);
  }
  return (
    <FormSection
      title={daComposicao ? "Composição — matérias-primas" : "Embalagem"}
      subtitle={
        daComposicao
          ? "Busque por código ou nome — digitar procura no catálogo inteiro. A quantidade é o alvo ATIVO por dose."
          : "Itens do tipo Material de embalagem, pela classificação do cadastro. A quantidade é por embalagem acabada: 120 cápsulas, 1 pote, 1 tampa."
      }
    >
      <div className="table-container">
        {/*
          A largura de cada coluna é DECLARADA no CSS, e a declaração depende
          de três coisas que só a tela sabe: qual seção é, se a forma tem
          coluna "Por cápsula" e se a linha tem a coluna de ações. São as três
          variantes da proporção — no pó, os 96px da coluna que não existe vão
          para o Ingrediente, e fora do rascunho a sobra elástica é maior.
        */}
        <table
          className={[
            "table",
            "table--sticky-actions",
            "table--formulacao",
            daComposicao ? "table--formulacao-composicao" : "table--formulacao-embalagem",
            daComposicao && mostrarPorCapsula ? "table--com-capsula" : "",
            editavel ? "" : "table--sem-acoes",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <thead>
            <tr>
              <th className="col-item">{daComposicao ? "Ingrediente" : "Item"}</th>
              {daComposicao && <th className="col-fonte">Fonte / Função</th>}
              {daComposicao && (
                <th className="col-pureza is-numeric">
                  Pureza (%) <Dica id="formulacao.pureza" />
                </th>
              )}
              <th className="col-quantidade is-numeric">
                {/* A unidade tem controle próprio na segunda linha da célula;
                    repeti-la no cabeçalho gastava três linhas de altura. */}
                {daComposicao ? "Alvo por dose" : "Quantidade"}
              </th>
              {daComposicao && <th className="col-dose is-numeric">Física por dose</th>}
              {daComposicao && mostrarPorCapsula && (
                <th className="col-capsula is-numeric">Por cápsula</th>
              )}
              <th className="col-regras">
                Fornecimento <Dica id={dicaDoFornecimento} />
              </th>
              {daComposicao && (
                <th className="col-reserva is-numeric">
                  Reserva % <Dica id="formulacao.overage" />
                </th>
              )}
              <th className="col-fisico is-numeric">
                Por embalagem <Dica id="formulacao.equivalenteEstoque" />
              </th>
              {editavel && <th className="col-acoes" aria-hidden="true" />}
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha, posicao) => {
              const valores = valoresDaLinha(linha);
              return (
                <LinhaDaBancada
                  key={linha.key}
                  linha={linha}
                  secao={secao}
                  editavel={editavel}
                  mostrarPorCapsula={mostrarPorCapsula}
                  unidades={unidadesDaLinha(linha)}
                  opcoesDeItem={opcoesDeItem(linha)}
                  onBuscarItem={(termo) => onBuscarItem(linha, termo)}
                  onCriarItem={onCriarItem ? () => onCriarItem(linha) : undefined}
                  onConsultarItem={
                    consultaDeItem
                      ? (termo) => setConsulta({ chave: linha.key, termo })
                      : undefined
                  }
                  erroDoItem={erroDoItem ? erroDoItem(linha) : undefined}
                  fisicoExibido={valores.fisicoExibido}
                  equivalenteExibido={valores.equivalenteExibido}
                  dose={valores.dose}
                  explicacaoDoFisico={explicacaoDoFisico(linha, valores.fisicoExibido)}
                  podeSubir={posicao > 0}
                  podeDescer={posicao < linhas.length - 1}
                  erros={erros}
                  onCampo={(campo, valor) => onCampo(linha.key, campo, valor)}
                  onFornecimento={(responsabilidade) =>
                    onFornecimento(linha.key, responsabilidade)
                  }
                  onItem={(itemId) => onItem(linha.key, itemId)}
                  onMover={(direcao) => onMover(linha.key, direcao)}
                  onRemover={() => onRemover(linha.key)}
                />
              );
            })}
            {linhas.length === 0 && (
              <TableEmptyRow colSpan={colunasDaSecao(daComposicao, mostrarPorCapsula, editavel)}>
                {daComposicao
                  ? "Nenhuma matéria-prima adicionada."
                  : "Nenhum item de embalagem adicionado."}
              </TableEmptyRow>
            )}
          </tbody>
          {/*
            O TOTAL FICA SOB A COLUNA QUE ELE SOMA.
            Cada número no pé da sua coluna: o alvo sob "Alvo por dose", a massa
            física sob "Física por dose", a massa por cápsula sob "Por cápsula".
            Sem linha somável o valor é travessão — zero afirmaria que a dose não
            pesa nada —, e quando alguma linha por dose ficou de fora por não ser
            massa, o rodapé DIZ, em vez de apresentar um total que parece
            completo.
          */}
          {daComposicao && totaisDaDose && linhas.length > 0 && (
            <tfoot className="table--formulacao__totais">
              <tr>
                <td colSpan={3} data-label="Total">
                  Total por dose
                  {totaisDaDose.foraDaSoma > 0 && (
                    <span className="cell-sub">
                      {formatIntegerPtBr(totaisDaDose.foraDaSoma)} linha(s) fora da soma: a unidade
                      não é de massa.
                    </span>
                  )}
                </td>
                <td className="col-quantidade is-numeric" data-label="Alvo total por dose">
                  <span className="estoque-valor__numero">
                    {totaisDaDose.somadas === 0
                      ? "—"
                      : `${formatQuantity(totaisDaDose.teoricaTotal.toFixed())} ${UNIDADE_DE_MASSA_DA_DOSE}`}
                  </span>
                </td>
                <td className="col-dose is-numeric" data-label="Massa total por dose">
                  <span className="estoque-valor__numero">
                    {totaisDaDose.somadas === 0
                      ? "—"
                      : `${formatQuantity(totaisDaDose.fisicaTotal.toFixed())} ${UNIDADE_DE_MASSA_DA_DOSE}`}
                  </span>
                </td>
                {mostrarPorCapsula && (
                  <td className="col-capsula is-numeric" data-label="Massa por cápsula">
                    <span className="estoque-valor__numero">
                      {totaisDaDose.somadas > 0 && totaisDaDose.porCapsulaTotal
                        ? `${formatQuantity(totaisDaDose.porCapsulaTotal.toFixed())} ${UNIDADE_DE_MASSA_DA_DOSE}`
                        : "—"}
                    </span>
                  </td>
                )}
                <td colSpan={3 + (editavel ? 1 : 0)} aria-hidden="true" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {editavel && (
        <div className="line-actions">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => onAdicionar(secao)}
          >
            {daComposicao ? "+ Adicionar matéria-prima" : "+ Adicionar embalagem"}
          </button>
        </div>
      )}

      {/*
        A consulta mora AQUI, dentro da tela — nunca num portal no `body`: o
        modal de workspace acompanha a largura da sidebar por uma variável que
        só existe dentro do `.shell`, e fora dele a consulta cobriria a sidebar
        recolhida e sairia deslocada no celular.
      */}
      {consultaDeItem && linhaConsultada && consulta && (
        <ItemConsultationDialog
          type={tipoDaSecao(secao)}
          initialTerm={consulta.termo}
          crumb={consultaDeItem.origem}
          unavailableReason={(item) =>
            usadoPorOutraLinha(linhaConsultada, item.id)
              ? "Já está em outra linha desta receita."
              : null
          }
          onSelect={(item) => {
            setConsulta(null);
            /*
             * O mesmo item de volta não é troca: reescolher reaplicaria a
             * pureza do cadastro por cima da que a linha declarou.
             */
            if (item.id === linhaConsultada.itemId) return;
            consultaDeItem.onEscolher(linhaConsultada, itemDaBancada(item));
          }}
          onClose={() => setConsulta(null)}
          create={
            onCriarItem
              ? {
                  label: "Novo item de estoque",
                  onCreate: () => {
                    setConsulta(null);
                    onCriarItem(linhaConsultada);
                  },
                }
              : undefined
          }
          footerNote={
            daComposicao
              ? "Selecionar põe a matéria-prima nesta linha da receita."
              : "Selecionar põe a embalagem nesta linha da receita."
          }
        />
      )}
    </FormSection>
  );
}
