/**
 * Identidade do documento PDF oficial — página, cor, tipo e espaço.
 *
 * O PDF não lê CSS. A paleta abaixo espelha `styles/tokens.css` (os mesmos
 * valores da marca Veridi) e é a única fonte visual dos documentos: nenhum
 * documento declara cor, fonte ou margem própria — pede aqui. Mudar o papel
 * é mudar este arquivo.
 *
 * Unidade: ponto PDF (1 pt = 1/72 pol ≈ 0,353 mm).
 */

export const PDF_PAGE = {
  size: "A4",
  /** ≈ 17 mm. Nas páginas 2+ a faixa recebe o cabeçalho corrido. */
  marginTop: 48,
  /** ≈ 22,5 mm. Faixa do rodapé, presente em toda página. */
  marginBottom: 64,
  /** ≈ 15 mm. */
  marginX: 42,
  /** Cabeçalho corrido e rodapé, medidos da borda da folha. */
  runningHeaderTop: 20,
  footerBottom: 22,
} as const;

export const PDF_COLOR = {
  /** --v-green-700: régua do cabeçalho e títulos de seção. */
  brand: "#1b5e43",
  /** --v-green-800: título do documento. */
  brandDeep: "#124534",
  ink: "#17251e",
  ink2: "#5d6c63",
  ink3: "#65726b",
  line: "#e3e9e2",
  lineStrong: "#cfd8cf",
  /** --canvas: faixa do cabeçalho de tabela e dos avisos. */
  band: "#f6f8f5",
  /** --warn-fg: marca de rascunho. */
  warn: "#8a6a12",
  paper: "#ffffff",
} as const;

export const PDF_FONT = {
  /**
   * Fonte padrão do PDF (Base 14): o leitor já tem, o arquivo não embute
   * nada e a métrica é a mesma em qualquer máquina — layout determinístico.
   * Cobre o português inteiro (WinAnsi); o que ficar fora passa por
   * `pdfSafe` antes de chegar ao papel.
   */
  family: "Helvetica",
  size: {
    micro: 6.5,
    xs: 7,
    sm: 8,
    base: 8.5,
    md: 9.5,
    lg: 10.5,
    title: 15,
  },
  lineHeight: 1.3,
} as const;

export const PDF_SPACE = {
  hair: 1.5,
  xs: 3,
  sm: 5,
  md: 8,
  lg: 12,
  xl: 16,
} as const;
