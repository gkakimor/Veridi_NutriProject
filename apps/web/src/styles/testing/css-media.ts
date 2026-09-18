/**
 * O que um seletor recebe dentro de `@media (<condição>)` — só para guarda de
 * teste de CSS.
 *
 * A mesma condição se repete em vários blocos do `components.css`, um por
 * componente, e a ordem entre eles não diz nada. Guarda que lia só o ÚLTIMO
 * bloco de 640px quebrou quando a consulta de CNPJ acrescentou o dela no fim do
 * arquivo (FILTER-CSS-640-GUARD-01). Aqui entram todos os blocos com a
 * condição, e só eles: a regra do mesmo seletor fora do `@media` não conta, nem
 * `@media (<condição>) and (…)`, que é tela mais específica.
 *
 * Devolve as declarações de toda regra desses blocos cuja lista de seletores
 * tem `seletor` exato, uma regra por linha; vazio quando nenhuma tem.
 */
export function declaracoesEmMedia(folha: string, condicao: string, seletor: string): string {
  // Comentário pode citar `@media` ou ter chave; fora antes de contar chaves.
  const texto = folha.replace(/\/\*[\s\S]*?\*\//g, "");
  const abertura = `@media (${condicao})`;
  const declaracoes: string[] = [];
  for (let de = texto.indexOf(abertura); de >= 0; de = texto.indexOf(abertura, de + abertura.length)) {
    const chave = texto.indexOf("{", de);
    if (chave < 0 || texto.slice(de + abertura.length, chave).trim() !== "") continue;
    let nivel = 0;
    let fim = texto.length;
    for (let i = chave; i < texto.length; i += 1) {
      if (texto[i] === "{") nivel += 1;
      if (texto[i] === "}") {
        nivel -= 1;
        if (nivel === 0) {
          fim = i;
          break;
        }
      }
    }
    for (const [, seletores = "", corpo = ""] of texto.slice(chave + 1, fim).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (seletores.split(",").some((s) => s.trim() === seletor)) declaracoes.push(corpo.trim());
    }
  }
  return declaracoes.join("\n");
}
