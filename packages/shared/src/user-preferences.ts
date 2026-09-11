/**
 * Preferências de interface do usuário, consumidas por `apps/api` e
 * `apps/web`.
 *
 * Pertencem ao USUÁRIO, não ao navegador: quem compacta o menu no escritório
 * encontra o menu compacto no computador da produção. Um JSON por seção,
 * associado 1:1 ao usuário — preferência visual nova entra como chave nova,
 * nunca como coluna nova em `User`.
 */

/** Sidebar do ERP (NAVIGATION-SIDEBAR-01). */
export interface NavigationPreferencesDTO {
  /** Sidebar desktop compacta — só ícones. No celular não se aplica. */
  compact: boolean;
  /** Grupos que a pessoa deixou abertos, por id estável do menu. */
  openGroups: string[];
  /** Telas favoritas, por id estável do menu, na ordem em que foram marcadas. */
  favorites: string[];
}

export interface UserPreferencesDTO {
  navigation: NavigationPreferencesDTO;
}

/** PATCH parcial: campo ausente fica como está. */
export interface UpdateUserPreferencesInput {
  navigation?: Partial<NavigationPreferencesDTO>;
}

/**
 * Id estável de item ou grupo do menu (`customer-view`, `stock-position`).
 *
 * A preferência grava o id, nunca o rótulo: renomear a tela não pode apagar o
 * favorito de ninguém. A API valida só o FORMATO — quem sabe quais ids existem
 * é o menu, e id que deixou de existir é ignorado na leitura, sem erro.
 */
export const NAVIGATION_PREFERENCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const NAVIGATION_PREFERENCE_ID_MAX_LENGTH = 64;
/** Teto de ids por lista — o menu inteiro tem menos de quarenta telas. */
export const NAVIGATION_PREFERENCE_LIST_MAX = 100;

/** Usuário sem preferência gravada: menu expandido, nenhum grupo, nenhum favorito. */
export function defaultNavigationPreferences(): NavigationPreferencesDTO {
  return { compact: false, openGroups: [], favorites: [] };
}
