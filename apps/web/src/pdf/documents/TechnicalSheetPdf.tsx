import {
  PdfDataGrid,
  PdfDocument,
  PdfNote,
  PdfNotice,
  PdfSection,
  PdfSubheading,
  PdfTable,
  PdfTd,
  PdfText,
  PdfTr,
  type PdfColumn,
  type PdfField,
} from "../components";
import {
  OPCOES_PERCENTUAL_TECNICO,
  formatIntegerPtBr,
  formatPdfDateTime,
  formatPercentPtBr,
  formatQuantity,
  formatQuantityWithUnit,
  pdfFileName,
} from "../format";
import {
  UNIDADE_DO_RESUMO,
  type CampoDaFicha,
  type FichaTecnica,
  type FichaTecnicaGrandeza,
  type FichaTecnicaLinha,
} from "./technical-sheet-model";

/**
 * FICHA TÉCNICA — o documento técnico de uma versão de receita.
 *
 * Não é a tela impressa — é um A4 com a identidade da casa, cabeçalho de
 * tabela que se repete a cada página e linha de ingrediente que nunca se parte
 * no meio. O MESMO documento serve à Ficha Técnica do Produto (Formulação) e à
 * do Modelo de Formulação: o que muda entre as duas — título, cabeçalho,
 * identificação, avisos, rodapé e nome do arquivo — chega pronto na MOLDURA do
 * read model (`technical-sheet-model`), decidida pelo adaptador de cada fonte.
 * Este arquivo não escreve "produto" nem "modelo" por conta própria.
 *
 * TÉCNICA quer dizer sem economia: nenhum custo, CMV, R$/kg, preço, margem,
 * markup, frete, valor de fornecedor ou preço de venda entra aqui — esses têm
 * os seus próprios documentos, e misturá-los faria a ficha circular onde o
 * preço não deve circular.
 *
 * Desenha o que o read model entregou e nada mais: nenhuma conta nasce neste
 * arquivo.
 */

/**
 * Colunas da composição, em A4 RETRATO.
 *
 * A largura não é a da tela: lá a tabela tem 1900 px e a coluna de ações. Aqui
 * são 511 pt, e cada número técnico ocupa o que o seu maior valor real pede —
 * o resto da folha vai para o ingrediente e para a fonte, que são texto. Corpo
 * denso pelo mesmo motivo do relatório largo: coluna cortada é dado perdido.
 *
 * "Por cápsula" só existe na forma cápsula — num pó ela não é grandeza de
 * nada, e a coluna vazia devolveria a largura a ninguém.
 */
function colunasDaComposicao(porCapsula: boolean): PdfColumn[] {
  return [
    { header: "Código", width: 42 },
    { header: "Ingrediente", flex: 3 },
    { header: "Fonte / Função", flex: 2 },
    /*
     * A pureza é a coluna mais larga entre as numéricas porque é a única com
     * ressalva embaixo do número ("não aplicada", "hoje 88,7%"): estreita, a
     * ressalva se partia em três linhas e triplicava a altura da linha.
     */
    { header: "Pureza (%)", width: 52, align: "right" },
    { header: "Alvo por dose", width: 48, align: "right" },
    { header: "Física por dose", width: 48, align: "right" },
    ...(porCapsula ? [{ header: "Por cápsula", width: 46, align: "right" as const }] : []),
    { header: "Un.", width: 26, align: "center" },
    { header: "Reserva (%)", width: 32, align: "right" },
    { header: "Por embalagem", width: 60, align: "right" },
  ];
}

/**
 * Colunas da embalagem.
 *
 * Embalagem não tem pureza nem reserva de matéria-prima: não são campos vazios
 * a preencher, são perguntas que não se fazem a um pote. A quantidade é por
 * embalagem acabada — 120 cápsulas, 1 pote, 1 tampa.
 */
const COLUNAS_DA_EMBALAGEM: PdfColumn[] = [
  { header: "Código", width: 56 },
  { header: "Item", flex: 1 },
  { header: "Quantidade", width: 66, align: "right" },
  { header: "Un.", width: 36, align: "center" },
  { header: "Por embalagem", width: 84, align: "right" },
];

/**
 * Nome do arquivo, do CÓDIGO da fonte e da versão — nunca do nome longo:
 * "ficha-tecnica-PROD-000174-v1.pdf", "ficha-tecnica-modelo-FT-000001-v1.pdf".
 */
export function technicalSheetPdfFileName(
  ficha: Pick<FichaTecnica, "moldura" | "versaoNumero">,
): string {
  return pdfFileName(
    ficha.moldura.prefixoDoArquivo,
    ficha.moldura.codigo,
    `v${ficha.versaoNumero}`,
  );
}

/** O campo que a fonte decidiu, no formato da grade do papel. */
function campoDoPapel(campo: CampoDaFicha): PdfField {
  return {
    label: campo.rotulo,
    value: campo.valor,
    span: campo.largura,
    ...(campo.opcional ? { optional: true } : {}),
  };
}

function grandeza(valor: FichaTecnicaGrandeza | null): string | null {
  return valor === null ? null : formatQuantityWithUnit(valor.quantidade, valor.unidade);
}

function percentualTecnico(valor: string | null): string {
  return valor === null ? "—" : formatPercentPtBr(valor, OPCOES_PERCENTUAL_TECNICO);
}

/** Massa somada pelo motor, sempre na unidade em que ele soma. */
function massa(valor: string | null): string {
  return valor === null ? "—" : formatQuantityWithUnit(valor, UNIDADE_DO_RESUMO);
}

/**
 * A célula do ingrediente: nome, e sob ele o que a linha precisa confessar.
 *
 * Item inativado depois de a versão ter sido escrita continua na receita — a
 * versão é um documento fechado — e o papel diz que ele está inativo. Material
 * do cliente aparece porque é propriedade do material, informação técnica de
 * quem planeja o lote; NÃO é fornecedor, e nada comercial dele entra aqui.
 */
function CelulaDoIngrediente({ linha }: { linha: FichaTecnicaLinha }) {
  const avisos = [
    linha.materialFornecidoPor === "Cliente" ? "Material do cliente" : null,
    linha.itemInativo ? "Item inativo no cadastro" : null,
  ].filter((aviso): aviso is string => aviso !== null);
  return (
    <>
      <PdfText>{linha.nome}</PdfText>
      {avisos.length > 0 ? <PdfNote>{avisos.join(" · ")}</PdfNote> : null}
    </>
  );
}

/**
 * A célula da pureza — a da VERSÃO, sempre.
 *
 * Quando o cadastro do Item mudou desde então, o número de hoje sai como nota
 * AO LADO, nunca no lugar: é ele que explica por que uma receita antiga não
 * bate com o item atual, e substituir o histórico por ele apagaria a versão
 * que o documento existe para representar.
 */
function CelulaDaPureza({ linha }: { linha: FichaTecnicaLinha }) {
  return (
    <>
      <PdfText>{percentualTecnico(linha.purezaPercent)}</PdfText>
      {linha.purezaNaoAplicada ? <PdfNote>não aplicada</PdfNote> : null}
      {linha.purezaDoCadastroHoje !== null ? (
        <PdfNote>hoje {percentualTecnico(linha.purezaDoCadastroHoje)}</PdfNote>
      ) : null}
    </>
  );
}

/** A fonte do ingrediente; quando ela repete o nome, só o detalhe técnico. */
function CelulaDaFonte({ linha }: { linha: FichaTecnicaLinha }) {
  const fonte = linha.fonte !== null && linha.fonte !== linha.nome ? linha.fonte : null;
  if (fonte === null && linha.fonteDetalhe === null) return <PdfText>—</PdfText>;
  return (
    <>
      <PdfText>{fonte ?? linha.fonteDetalhe}</PdfText>
      {fonte !== null && linha.fonteDetalhe !== null ? (
        <PdfNote>{linha.fonteDetalhe}</PdfNote>
      ) : null}
    </>
  );
}

export function TechnicalSheetPdf({
  ficha,
  generatedAt,
}: {
  ficha: FichaTecnica;
  generatedAt: Date;
}) {
  const { moldura } = ficha;
  const formaOmitida = ficha.camposDaForma === "omitida";

  /*
   * A APRESENTAÇÃO POR FORMA — cápsula e pó respondem perguntas diferentes.
   *
   * O pó não tem cápsula por dose, e a cápsula não tem dose em gramas nem
   * conteúdo da embalagem: mostrar o campo da outra forma, vazio, convidaria a
   * preencher o que aquele produto não tem. Forma não informada (Modelo
   * legado) diz isso uma vez e não mostra nada que dependa dela.
   */
  const apresentacao: (PdfField | false)[] = [
    {
      label: "Forma do produto",
      value: formaOmitida ? "Não informada" : ficha.formaLabel,
      span: 3,
    },
    {
      label: "Apresentação comercial",
      value: ficha.apresentacaoLabel,
      span: 3,
      ...(formaOmitida ? { optional: true } : {}),
    },
    ficha.camposDaForma === "capsula" && {
      label: "Cápsulas por dose",
      value: ficha.capsulasPorDose === null ? null : formatIntegerPtBr(ficha.capsulasPorDose),
      span: 2,
    },
    ficha.camposDaForma === "capsula" && {
      label: "Cápsulas por embalagem",
      value:
        ficha.capsulasPorEmbalagem === null ? null : formatIntegerPtBr(ficha.capsulasPorEmbalagem),
      span: 2,
    },
    ficha.camposDaForma === "po" && { label: "Dose", value: grandeza(ficha.dose), span: 2 },
    ficha.camposDaForma === "po" && {
      label: "Conteúdo da embalagem",
      value: grandeza(ficha.conteudoDaEmbalagem),
      span: 3,
    },
    {
      label: "Doses por embalagem",
      value: ficha.dosesPorEmbalagem === null ? null : formatIntegerPtBr(ficha.dosesPorEmbalagem),
      span: 2,
      ...(formaOmitida ? { optional: true } : {}),
    },
    ...moldura.apresentacaoExtra.map(campoDoPapel),
  ];

  return (
    <PdfDocument
      title={moldura.titulo}
      code={`${moldura.codigo} · ${ficha.versaoLabel}`}
      status={ficha.statusLabel}
      isDraft={ficha.isDraft}
      headerLines={[
        ...moldura.linhasDoCabecalho,
        `Ficha gerada em ${formatPdfDateTime(generatedAt)}`,
      ]}
      footerNote={moldura.rodape}
      generatedAt={generatedAt}
    >
      {/*
        O aviso não é só um carimbo no canto: quem recebe a folha solta precisa
        ler, em uma frase, o que ela significa — rascunho que ainda muda,
        versão que já não vale. A marca do cabeçalho continua lá.
      */}
      {moldura.avisos.map((aviso) => (
        <PdfNotice key={aviso.destaque}>
          <PdfText bold>{aviso.destaque}</PdfText> {aviso.texto}
        </PdfNotice>
      ))}

      <PdfSection title="Identificação">
        <PdfDataGrid fields={moldura.identificacao.map(campoDoPapel)} />
      </PdfSection>

      <PdfSection title="Forma e apresentação">
        <PdfDataGrid fields={apresentacao} />
      </PdfSection>

      <PdfSection title="Premissas de produção">
        <PdfDataGrid
          fields={[
            {
              label: "Perda prevista de produção (%)",
              value: percentualTecnico(ficha.perdaPrevistaPercent),
              span: 4,
            },
            {
              label: "Rendimento esperado (%)",
              value: percentualTecnico(ficha.rendimentoEsperadoPercent),
              span: 4,
            },
          ]}
        />

        {/*
          O que NÃO é da versão — no Produto, lote mínimo e caixa de embarque,
          do cadastro — sai separado, com o subtítulo que diz de onde vem.
          Escrevê-lo na mesma lista das premissas congeladas faria o papel
          prometer historicidade que ele não tem.
        */}
        {moldura.foraDaVersao ? (
          <>
            <PdfSubheading title={moldura.foraDaVersao.titulo} />
            <PdfDataGrid fields={moldura.foraDaVersao.campos.map(campoDoPapel)} />
          </>
        ) : null}
      </PdfSection>

      <PdfSection title="Composição — matérias-primas">
        <PdfTable
          columns={colunasDaComposicao(ficha.porCapsula)}
          dense
          isEmpty={ficha.composicao.length === 0}
          emptyMessage="Nenhuma matéria-prima registrada nesta versão."
        >
          {ficha.composicao.map((linha) => (
            <PdfTr key={linha.key}>
              <PdfTd>{linha.codigo}</PdfTd>
              <PdfTd>
                <CelulaDoIngrediente linha={linha} />
              </PdfTd>
              <PdfTd>
                <CelulaDaFonte linha={linha} />
              </PdfTd>
              <PdfTd>
                <CelulaDaPureza linha={linha} />
              </PdfTd>
              <PdfTd>{formatQuantity(linha.alvoPorDose)}</PdfTd>
              <PdfTd>{formatQuantity(linha.fisicaPorDose)}</PdfTd>
              {/* `false` some na contagem de colunas; Fragment consumiria uma. */}
              {ficha.porCapsula ? <PdfTd>{formatQuantity(linha.porCapsula)}</PdfTd> : false}
              <PdfTd>{linha.unidade}</PdfTd>
              <PdfTd>{percentualTecnico(linha.reservaPercent)}</PdfTd>
              <PdfTd>{formatQuantityWithUnit(linha.porEmbalagem, linha.unidadeDeEstoque)}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      <PdfSection title="Embalagem">
        <PdfTable
          columns={COLUNAS_DA_EMBALAGEM}
          dense
          isEmpty={ficha.embalagem.length === 0}
          emptyMessage="Nenhum item de embalagem registrado nesta versão."
        >
          {ficha.embalagem.map((linha) => (
            <PdfTr key={linha.key}>
              <PdfTd>{linha.codigo}</PdfTd>
              <PdfTd>
                <CelulaDoIngrediente linha={linha} />
              </PdfTd>
              <PdfTd>{formatQuantity(linha.quantidade)}</PdfTd>
              <PdfTd>{linha.unidade}</PdfTd>
              <PdfTd>{formatQuantityWithUnit(linha.porEmbalagem, linha.unidadeDeEstoque)}</PdfTd>
            </PdfTr>
          ))}
        </PdfTable>
      </PdfSection>

      <PdfSection title="Resumo técnico">
        <PdfDataGrid
          fields={[
            /*
             * "TOTAL" no rótulo, e não só "por dose": a coluna da tabela já se
             * chama "Alvo por dose" e é de UMA linha. Sem a palavra, o resumo
             * parecia repetir a última linha da composição.
             */
            { label: "Massa total por dose", value: massa(ficha.massaPorDose), span: 3 },
            { label: "Alvo total por dose", value: massa(ficha.alvoPorDose), span: 3 },
            ficha.porCapsula && {
              label: "Massa por cápsula",
              value: massa(ficha.massaPorCapsula),
              span: 3,
            },
            {
              label: "Linhas",
              value: `${formatIntegerPtBr(ficha.composicao.length)} na composição · ${formatIntegerPtBr(
                ficha.embalagem.length,
              )} na embalagem`,
              span: 3,
            },
          ]}
        />

        {/*
          Total que omite linha em silêncio parece completo e não é: a soma é em
          massa, e o que não é massa ("2 un" numa dose) não entra nela.
        */}
        {ficha.linhasForaDaSoma > 0 ? (
          <PdfNote>
            {formatIntegerPtBr(ficha.linhasForaDaSoma)} linha(s) por dose ficaram fora da soma
            porque a unidade não é de massa.
          </PdfNote>
        ) : null}
      </PdfSection>

    </PdfDocument>
  );
}
