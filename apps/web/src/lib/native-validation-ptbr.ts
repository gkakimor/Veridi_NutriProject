/**
 * Mensagem de campo obrigatório em português.
 *
 * `required` no HTML dá validação de graça, e junto vem a mensagem do
 * navegador — no idioma DELE. Num sistema inteiro em pt-BR, um único
 * formulário respondendo "Please select an item in the list." quebra a
 * localização e o padrão visual de erro ao mesmo tempo.
 *
 * Em vez de trocar `required` por validação própria em cada formulário (e
 * ter que lembrar disso em todo formulário futuro), a mensagem é traduzida
 * uma vez, no documento: o handler roda na captura, só age quando o motivo é
 * campo vazio, e usa o próprio `<label>` do campo para dizer o que falta.
 * Qualquer outra validação nativa (formato, faixa) segue como está.
 *
 * A mensagem é limpa a cada digitação — sem isso o campo continuaria inválido
 * depois de preenchido.
 */

type Validavel = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function ehValidavel(alvo: EventTarget | null): alvo is Validavel {
  return (
    alvo instanceof HTMLInputElement ||
    alvo instanceof HTMLSelectElement ||
    alvo instanceof HTMLTextAreaElement
  );
}

/** Texto do rótulo do campo, sem o asterisco de obrigatório. */
function rotuloDe(campo: Validavel): string | null {
  if (!campo.id) return null;
  const label = document.querySelector(`label[for="${CSS.escape(campo.id)}"]`);
  const texto = label?.textContent?.replace(/\*/g, "").trim();
  return texto ? texto : null;
}

function mensagemDe(campo: Validavel): string {
  const verbo = campo instanceof HTMLSelectElement ? "Selecione" : "Preencha";
  const rotulo = rotuloDe(campo);
  return rotulo ? `${verbo} ${rotulo.toLowerCase()}.` : `${verbo} este campo.`;
}

export function instalarMensagensObrigatorias(): () => void {
  function aoInvalidar(event: Event) {
    const campo = event.target;
    if (!ehValidavel(campo)) return;
    // Só campo vazio: formato e faixa têm mensagem própria do navegador.
    if (!campo.validity.valueMissing) return;
    campo.setCustomValidity(mensagemDe(campo));
    // O balão lê a mensagem no momento em que aparece; reapresentar aqui
    // garante o texto certo já na primeira tentativa.
    campo.reportValidity();
  }

  function aoEditar(event: Event) {
    const campo = event.target;
    if (ehValidavel(campo)) campo.setCustomValidity("");
  }

  document.addEventListener("invalid", aoInvalidar, true);
  document.addEventListener("input", aoEditar, true);
  document.addEventListener("change", aoEditar, true);

  return () => {
    document.removeEventListener("invalid", aoInvalidar, true);
    document.removeEventListener("input", aoEditar, true);
    document.removeEventListener("change", aoEditar, true);
  };
}
