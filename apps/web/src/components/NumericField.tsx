import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  ChangeEvent,
  ClipboardEvent,
  ComponentPropsWithRef,
  FocusEvent,
  PointerEvent,
} from "react";
import { comSimboloReal, formatarDecimalTexto } from "../lib/decimal-format";
import { formatDecimalInput } from "../lib/decimal-input";
import {
  isPtBrNumberDraft,
  normalizePastedNumber,
  parsePtBrNumber,
} from "../lib/numeric-ptbr";
import type { NumericOptions, PasteOptions } from "../lib/numeric-ptbr";

/**
 * Campos numéricos em português — PTBR-NUMERIC-INPUT-FOUNDATION-01.
 *
 * `IntegerField`, `DecimalField`, `MoneyField` e `PercentField` são o mesmo
 * campo com contrato diferente. Regra de uso (quando usar, quando NÃO usar):
 * `docs/UI_BRAND.md`, "Campos numéricos e valores pt-BR".
 *
 * **Não é `type="number"`.** O campo nativo de número decide ponto e vírgula
 * pelo idioma do navegador e do sistema, e cada combinação lê `1,5` de um
 * jeito. Aqui é `type="text"` com `inputMode` — o teclado certo no celular — e
 * a leitura é a de `lib/numeric-ptbr.ts`, igual em qualquer máquina.
 *
 * **`value` é o texto digitado, em português** (`"1234,5"`), e `""` é vazio —
 * nunca zero. O formulário guarda esse texto e converte na borda com
 * `parsePtBrNumber`; para carregar um valor da API, `toPtBrEditText`. O campo
 * não decide obrigatoriedade nem regra de domínio.
 *
 * Três estados na tela, o padrão de `NUMERIC_PRECISION_AUDIT.md` §11.5:
 *
 * - **fora do foco** — o número formatado, `1.234,56`; o símbolo (`R$`, `%`)
 *   fica no rótulo, como já é nas telas ("Comissão (%)"), e só aparece dentro
 *   do campo quando ele é somente leitura (`R$ 1.234,56`, `12,50%`);
 * - **em foco** — o texto como está guardado, sem milhar (`1234,56`), para
 *   editar sem tropeçar no ponto;
 * - **na saída** — o texto é normalizado uma vez (`1.500,00` e `1500.00` viram
 *   `1500,00`). Nada é reescrito a cada tecla, então o cursor não pula.
 *
 * Tecla que não cabe (letra, segunda vírgula, casa além do `scale`, sinal onde
 * não pode) simplesmente não entra, e o cursor fica onde estava. Apagar,
 * selecionar, copiar, colar, setas e Tab seguem nativos.
 *
 * Texto que não vira número ao sair (o ambíguo `1.234`, por exemplo) fica como
 * foi escrito e o campo ganha `aria-invalid` e `is-invalid`. A mensagem é da
 * tela — `numericInvalidMessage` diz o que escrever.
 */

type NativeInputProps = Omit<
  ComponentPropsWithRef<"input">,
  "type" | "value" | "defaultValue" | "onChange" | "children" | "min" | "max" | "step" | "pattern"
>;

interface NumericFieldBaseProps extends NativeInputProps {
  /** Texto do campo em português. `""` é vazio, e vazio não é zero. */
  value: string;
  /** O texto novo: a cada edição aceita e, na saída do campo, a forma normalizada. */
  onChangeValue: (value: string) => void;
  /** Aceita sinal de menos. Padrão `false`. */
  allowNegative?: boolean;
}

export type IntegerFieldProps = NumericFieldBaseProps;

export interface DecimalFieldProps extends NumericFieldBaseProps {
  /** Casas decimais aceitas. Sem padrão: é decisão do domínio de cada campo. */
  scale: number;
  /** Casas que aparecem mesmo zeradas, fora do foco. */
  minFractionDigits?: number;
}

interface NumericInputProps extends NumericFieldBaseProps {
  scale: number;
  minFractionDigits: number;
  inputModePadrao: "numeric" | "decimal";
  simbolo?: "moeda" | "percentual";
}

/** `true` quando `proposto` é `anterior` com um trecho contíguo apagado. */
function ehRemocao(anterior: string, proposto: string): boolean {
  if (proposto.length >= anterior.length) return false;
  let prefixo = 0;
  while (prefixo < proposto.length && proposto[prefixo] === anterior[prefixo]) prefixo += 1;
  return anterior.endsWith(proposto.slice(prefixo));
}

function NumericInput({
  value,
  onChangeValue,
  scale,
  allowNegative = false,
  minFractionDigits,
  inputModePadrao,
  simbolo,
  inputMode,
  className,
  readOnly,
  disabled,
  autoComplete = "off",
  spellCheck = false,
  onFocus,
  onBlur,
  onPaste,
  onPointerDown,
  ref,
  "aria-invalid": ariaInvalid,
  ...rest
}: NumericInputProps) {
  const elemento = useRef<HTMLInputElement | null>(null);
  const [focado, setFocado] = useState(false);
  const focoPorPonteiro = useRef(false);
  const selecaoPendente = useRef<readonly [number, number] | null>(null);

  const opcoes: PasteOptions = simbolo ? { scale, allowNegative, simbolo } : { scale, allowNegative };
  const opcoesAtuais = useRef<NumericOptions>(opcoes);
  useLayoutEffect(() => {
    opcoesAtuais.current = opcoes;
  });

  const editavel = !readOnly && !disabled;
  const editando = focado && editavel;
  const leitura = parsePtBrNumber(value, opcoes);

  let exibido = value;
  if (!editando && leitura.tipo === "valido") {
    const corpo =
      formatarDecimalTexto(leitura.valor, {
        minimo: Math.min(minFractionDigits, scale),
        maximo: scale,
      }) ?? value;
    // Símbolo só na apresentação: campo somente leitura. Desabilitado segue o
    // editável, para o texto não mudar de forma quando o campo é liberado.
    if (!readOnly || !simbolo) exibido = corpo;
    else exibido = simbolo === "moeda" ? comSimboloReal(corpo) : `${corpo}%`;
  }
  const invalido = !editando && leitura.tipo === "invalido";

  const conectar = useCallback(
    (no: HTMLInputElement | null) => {
      elemento.current = no;
      if (typeof ref === "function") ref(no);
      else if (ref) ref.current = no;
    },
    [ref],
  );

  // Seleção decidida num evento e aplicada depois que o React escreveu o texto.
  useLayoutEffect(() => {
    const alvo = selecaoPendente.current;
    const campo = elemento.current;
    if (!alvo || !campo) return;
    selecaoPendente.current = null;
    if (campo.ownerDocument.activeElement === campo) campo.setSelectionRange(alvo[0], alvo[1]);
  });

  /*
   * Tecla recusada ANTES de entrar: o navegador nem altera o texto, então a
   * seleção e o cursor ficam exatamente onde estavam. O `onChange` abaixo é a
   * segunda linha, para o que não passa por `beforeinput` (arrastar, preencher
   * automático, composição de teclado).
   */
  useEffect(() => {
    const campo = elemento.current;
    if (!campo) return;
    function antesDeInserir(evento: InputEvent) {
      if (!campo || evento.inputType !== "insertText") return;
      const inicio = campo.selectionStart ?? campo.value.length;
      const fim = campo.selectionEnd ?? inicio;
      const proposto = campo.value.slice(0, inicio) + (evento.data ?? "") + campo.value.slice(fim);
      if (!isPtBrNumberDraft(proposto, opcoesAtuais.current)) evento.preventDefault();
    }
    campo.addEventListener("beforeinput", antesDeInserir);
    return () => campo.removeEventListener("beforeinput", antesDeInserir);
  }, []);

  function aoMudar(evento: ChangeEvent<HTMLInputElement>) {
    const campo = evento.currentTarget;
    const proposto = campo.value;
    // Apagar nunca é bloqueado: Backspace e Delete funcionam em qualquer estado.
    if (ehRemocao(exibido, proposto) || isPtBrNumberDraft(proposto, opcoes)) {
      onChangeValue(proposto);
      return;
    }
    // Recusa: o texto volta, e o cursor fica antes do trecho que não mudou.
    const depoisDoCursor = proposto.length - (campo.selectionStart ?? proposto.length);
    const cursor = Math.max(0, exibido.length - depoisDoCursor);
    campo.value = exibido;
    campo.setSelectionRange(cursor, cursor);
  }

  function aoColar(evento: ClipboardEvent<HTMLInputElement>) {
    onPaste?.(evento);
    if (evento.defaultPrevented || !editavel) return;
    evento.preventDefault();
    const campo = evento.currentTarget;
    const inicio = campo.selectionStart ?? campo.value.length;
    const fim = campo.selectionEnd ?? inicio;
    const trecho = normalizePastedNumber(evento.clipboardData.getData("text/plain"), opcoes);
    const proposto = campo.value.slice(0, inicio) + trecho + campo.value.slice(fim);
    if (proposto === campo.value || !isPtBrNumberDraft(proposto, opcoes)) return;
    selecaoPendente.current = [inicio + trecho.length, inicio + trecho.length];
    onChangeValue(proposto);
  }

  function aoApontar(evento: PointerEvent<HTMLInputElement>) {
    focoPorPonteiro.current = true;
    onPointerDown?.(evento);
  }

  function aoFocar(evento: FocusEvent<HTMLInputElement>) {
    const porPonteiro = focoPorPonteiro.current;
    focoPorPonteiro.current = false;
    if (editavel) {
      setFocado(true);
      /* Pelo teclado o navegador seleciona o texto todo, e trocar o formatado
         pelo editável desfaz essa seleção — ela é refeita. Pelo clique, o
         cursor é posto pelo próprio navegador, sobre o texto já trocado. */
      if (!porPonteiro && exibido !== value) {
        selecaoPendente.current = [0, value.length];
      }
    }
    onFocus?.(evento);
  }

  function aoSair(evento: FocusEvent<HTMLInputElement>) {
    focoPorPonteiro.current = false;
    setFocado(false);
    if (editavel && leitura.tipo === "valido") {
      const normalizado = formatDecimalInput(leitura.valor);
      if (normalizado !== value) onChangeValue(normalizado);
    }
    onBlur?.(evento);
  }

  // Quem usa o campo e passa `aria-invalid` decide; sem isso, vale a leitura.
  const acusado = ariaInvalid === undefined ? invalido : ariaInvalid !== false && ariaInvalid !== "false";
  const classes = [className, acusado && !className?.split(" ").includes("is-invalid") ? "is-invalid" : null]
    .filter(Boolean)
    .join(" ");

  return (
    <input
      {...rest}
      ref={conectar}
      type="text"
      inputMode={inputMode ?? inputModePadrao}
      autoComplete={autoComplete}
      spellCheck={spellCheck}
      readOnly={readOnly}
      disabled={disabled}
      className={classes || undefined}
      aria-invalid={ariaInvalid ?? (invalido ? true : undefined)}
      value={exibido}
      onChange={aoMudar}
      onPaste={aoColar}
      onPointerDown={aoApontar}
      onFocus={aoFocar}
      onBlur={aoSair}
    />
  );
}

/** Número inteiro — contagem, prazo, parcelas. Só dígitos; `1234` aparece `1.234`. */
export function IntegerField(props: IntegerFieldProps) {
  return <NumericInput {...props} scale={0} minFractionDigits={0} inputModePadrao="numeric" />;
}

/** Decimal com `scale` do domínio — quantidade, fator, valor técnico. */
export function DecimalField({ minFractionDigits = 0, ...props }: DecimalFieldProps) {
  return <NumericInput {...props} minFractionDigits={minFractionDigits} inputModePadrao="decimal" />;
}

/**
 * Dinheiro — total (`scale={2}`) ou preço unitário (`scale={4}`, ou o da
 * coluna). Mínimo de 2 casas fora do foco. `R$` não é digitado nem enviado.
 */
export function MoneyField({ minFractionDigits = 2, ...props }: DecimalFieldProps) {
  return (
    <NumericInput
      {...props}
      minFractionDigits={minFractionDigits}
      inputModePadrao="decimal"
      simbolo="moeda"
    />
  );
}

/**
 * Percentual em pontos percentuais — o número que a pessoa vê: `12,5` é 12,5%.
 * O campo não multiplica nem divide; contrato em fração converte na borda.
 */
export function PercentField({ minFractionDigits = 0, ...props }: DecimalFieldProps) {
  return (
    <NumericInput
      {...props}
      minFractionDigits={minFractionDigits}
      inputModePadrao="decimal"
      simbolo="percentual"
    />
  );
}
