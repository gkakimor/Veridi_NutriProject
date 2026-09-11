import { z } from "zod";
import {
  NAVIGATION_PREFERENCE_ID_MAX_LENGTH,
  NAVIGATION_PREFERENCE_ID_PATTERN,
  NAVIGATION_PREFERENCE_LIST_MAX,
} from "@veridi/shared";

/**
 * O formato do id é tudo o que a API confere. Quais ids existem quem sabe é o
 * menu — e um id que deixou de existir numa versão futura é ignorado pela
 * tela, não recusado aqui. O formato fechado impede que texto arbitrário
 * (markup, frase, lixo de qualquer tamanho) vire preferência gravada.
 */
const navigationIdSchema = z
  .string()
  .max(NAVIGATION_PREFERENCE_ID_MAX_LENGTH, "Identificador de navegação longo demais")
  .regex(NAVIGATION_PREFERENCE_ID_PATTERN, "Identificador de navegação inválido");

/** Repetição não é erro — só não faz sentido guardar duas vezes. */
const navigationIdListSchema = z
  .array(navigationIdSchema)
  .max(NAVIGATION_PREFERENCE_LIST_MAX, "Lista de navegação longa demais")
  .transform((ids) => [...new Set(ids)]);

/**
 * PATCH parcial, por seção e por campo. `.strict()` nos dois níveis: chave
 * desconhecida é erro de quem chamou, não algo a gravar calado no JSON.
 */
export const updateUserPreferencesSchema = z
  .object({
    navigation: z
      .object({
        compact: z.boolean().optional(),
        openGroups: navigationIdListSchema.optional(),
        favorites: navigationIdListSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type UpdateUserPreferencesBody = z.infer<typeof updateUserPreferencesSchema>;
