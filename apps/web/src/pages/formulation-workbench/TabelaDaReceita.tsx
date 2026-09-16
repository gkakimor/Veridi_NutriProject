import type { ReactNode } from "react";
import type {
  FormulationComponentBasis,
  SecaoDaFormula,
  SupplyResponsibility,
  UnitOfMeasureDTO,
} from "@veridi/shared";
import { FormSection } from "../../components/FormSection";
import { TableEmptyRow } from "../../components/TableEmptyRow";
import type { EntityOption } from "../../components/SearchableEntitySelect";
import { Dica } from "./dicas";
import { LinhaDaBancada } from "./LinhaDaBancada";
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
  /** A base multiplica material nesta receita? Decide o peso visual da coluna. */
  baseMultiplicaMaterial: boolean;
  /** Base canônica da seção — linha fora dela continua com o seletor à vista. */
  baseDaSecao: FormulationComponentBasis;
  unidadesDaLinha: (linha: LinhaDaReceita) => UnitOfMeasureDTO[];
  opcoesDeItem: (linha: LinhaDaReceita) => EntityOption[];
  onBuscarItem: (linha: LinhaDaReceita, termo: string) => Promise<EntityOption[]>;
  onCriarItem?: ((linha: LinhaDaReceita) => void) | undefined;
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
  onBase: (key: string, basis: FormulationComponentBasis) => void;
  onFornecimento: (key: string, responsabilidade: SupplyResponsibility) => void;
  onItem: (key: string, itemId: string) => void;
  onMover: (key: string, direcao: -1 | 1) => void;
  onRemover: (key: string) => void;
  onAdicionar: (secao: SecaoDaFormula) => void;
}

/**
 * Quantas colunas a tabela da seção tem — só a linha de vazio precisa saber.
 *
 * Composição: ingrediente, fonte, pureza, alvo, física por dose, base,
 * reserva e por embalagem — mais "por cápsula" quando a forma é cápsula.
 * Embalagem: item, quantidade, base, por embalagem. A coluna de ações só
 * existe quando a receita é editável.
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
  baseMultiplicaMaterial,
  baseDaSecao,
  unidadesDaLinha,
  opcoesDeItem,
  onBuscarItem,
  onCriarItem,
  valoresDaLinha,
  explicacaoDoFisico,
  erros,
  onCampo,
  onBase,
  onFornecimento,
  onItem,
  onMover,
  onRemover,
  onAdicionar,
}: TabelaDaReceitaProps) {
  const daComposicao = secao === "COMPOSICAO";
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
                {baseMultiplicaMaterial ? "Base · Fornecimento" : "Fornecimento"}{" "}
                <Dica id="formulacao.fornecimento" />
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
                  baseEditavelNaLinha={baseMultiplicaMaterial || linha.basis !== baseDaSecao}
                  unidades={unidadesDaLinha(linha)}
                  opcoesDeItem={opcoesDeItem(linha)}
                  onBuscarItem={(termo) => onBuscarItem(linha, termo)}
                  onCriarItem={onCriarItem ? () => onCriarItem(linha) : undefined}
                  fisicoExibido={valores.fisicoExibido}
                  equivalenteExibido={valores.equivalenteExibido}
                  dose={valores.dose}
                  explicacaoDoFisico={explicacaoDoFisico(linha, valores.fisicoExibido)}
                  podeSubir={posicao > 0}
                  podeDescer={posicao < linhas.length - 1}
                  erros={erros}
                  onCampo={(campo, valor) => onCampo(linha.key, campo, valor)}
                  onBase={(basis) => onBase(linha.key, basis)}
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
    </FormSection>
  );
}
