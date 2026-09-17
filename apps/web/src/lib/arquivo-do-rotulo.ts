import type { UserRole } from "@veridi/shared";
import {
  ITEM_LABEL_FILE_MAX_SIZE_BYTES,
  ITEM_LABEL_FILE_RESTORE_ROLES,
  ITEM_LABEL_FILE_UPLOAD_ROLES,
  ITEM_LABEL_FILE_VOID_ROLES,
  itemLabelFileMimeTypeByExtension,
} from "@veridi/shared";
import { useOptionalAuth } from "../app/AuthProvider";
import { perfilPermite } from "./perfis";

/**
 * O que a tela decide sozinha sobre o arquivo do Item Rótulo —
 * LABEL-ATTACHMENTS-01.
 *
 * Duas telas usam: a seção "Arquivo do rótulo" do Item gravado e o cadastro
 * do Item novo, que guarda o arquivo escolhido até o Item existir
 * (ITEM-FORM-BY-TYPE-01). Uma regra só, para a criação não aceitar o que a
 * seção recusaria.
 */

export const LIMITE_DO_ARQUIVO_DO_ROTULO_EM_MB = Math.round(ITEM_LABEL_FILE_MAX_SIZE_BYTES / (1024 * 1024));

/** Recusa na tela antes de mandar: o que a API recusaria pelo nome ou pelo tamanho. */
export function problemaDoArquivoDoRotulo(arquivo: File): string | null {
  if (!itemLabelFileMimeTypeByExtension(arquivo.name)) {
    return "Tipo de arquivo não aceito. Envie PDF, PNG ou JPEG.";
  }
  if (arquivo.size === 0) return "O arquivo escolhido está vazio.";
  if (arquivo.size > ITEM_LABEL_FILE_MAX_SIZE_BYTES) {
    return `Arquivo acima do limite de ${LIMITE_DO_ARQUIVO_DO_ROTULO_EM_MB} MB.`;
  }
  return null;
}

export interface AutoridadeNoArquivoDoRotulo {
  enviar: boolean;
  restaurar: boolean;
  anular: boolean;
}

/**
 * A MESMA lista que a API aplica decide o que a tela oferece. Fora do
 * `AuthProvider` (teste de tela isolado) não há sessão para julgar, e a tela
 * oferece tudo — o mesmo acordo do cadastro do Item; a recusa, se vier, é da API.
 */
export function useAutoridadeNoArquivoDoRotulo(): AutoridadeNoArquivoDoRotulo {
  const sessao = useOptionalAuth();
  if (sessao === null) return { enviar: true, restaurar: true, anular: true };
  const role: UserRole | undefined = sessao.user?.role;
  return {
    enviar: perfilPermite(ITEM_LABEL_FILE_UPLOAD_ROLES, role),
    restaurar: perfilPermite(ITEM_LABEL_FILE_RESTORE_ROLES, role),
    anular: perfilPermite(ITEM_LABEL_FILE_VOID_ROLES, role),
  };
}
