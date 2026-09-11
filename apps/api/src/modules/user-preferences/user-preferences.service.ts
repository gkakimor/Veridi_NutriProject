import type { Prisma } from "@prisma/client";
import {
  NAVIGATION_PREFERENCE_ID_MAX_LENGTH,
  NAVIGATION_PREFERENCE_ID_PATTERN,
  NAVIGATION_PREFERENCE_LIST_MAX,
  defaultNavigationPreferences,
} from "@veridi/shared";
import type { NavigationPreferencesDTO, UserPreferencesDTO } from "@veridi/shared";
import { getPrisma } from "../../db/prisma.js";
import type { UpdateUserPreferencesBody } from "./user-preferences.schemas.js";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function readIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter(
    (id): id is string =>
      typeof id === "string" &&
      id.length <= NAVIGATION_PREFERENCE_ID_MAX_LENGTH &&
      NAVIGATION_PREFERENCE_ID_PATTERN.test(id),
  );
  return [...new Set(ids)].slice(0, NAVIGATION_PREFERENCE_LIST_MAX);
}

/**
 * Leitura TOLERANTE do que está gravado.
 *
 * O JSON é flexível de propósito, então a leitura não confia nele: campo com
 * tipo errado vira o padrão e id fora do formato é descartado. Preferência
 * torta nunca pode derrubar o menu — no pior caso a pessoa vê o menu padrão.
 */
function readNavigation(ui: JsonObject): NavigationPreferencesDTO {
  const stored = asObject(ui["navigation"]);
  const defaults = defaultNavigationPreferences();
  return {
    compact: typeof stored["compact"] === "boolean" ? stored["compact"] : defaults.compact,
    openGroups: readIdList(stored["openGroups"]),
    favorites: readIdList(stored["favorites"]),
  };
}

export async function getUserPreferences(userId: string): Promise<UserPreferencesDTO> {
  const row = await getPrisma().userPreference.findUnique({ where: { userId } });
  return { navigation: readNavigation(asObject(row?.ui)) };
}

/**
 * Mescla campo a campo e grava o JSON inteiro. Seção que esta versão não
 * conhece — gravada por uma versão mais nova — é preservada como veio.
 */
export async function updateUserPreferences(
  userId: string,
  input: UpdateUserPreferencesBody,
): Promise<UserPreferencesDTO> {
  const prisma = getPrisma();
  const row = await prisma.userPreference.findUnique({ where: { userId } });
  const ui = asObject(row?.ui);

  const current = readNavigation(ui);
  const patch = input.navigation ?? {};
  const navigation: NavigationPreferencesDTO = {
    compact: patch.compact ?? current.compact,
    openGroups: patch.openGroups ?? current.openGroups,
    favorites: patch.favorites ?? current.favorites,
  };

  const next: Prisma.InputJsonObject = {
    ...(ui as Prisma.InputJsonObject),
    navigation: {
      compact: navigation.compact,
      openGroups: navigation.openGroups,
      favorites: navigation.favorites,
    },
  };
  await prisma.userPreference.upsert({
    where: { userId },
    create: { userId, ui: next },
    update: { ui: next },
  });
  return { navigation };
}
