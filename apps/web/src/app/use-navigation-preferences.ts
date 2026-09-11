import { useCallback, useEffect, useRef, useState } from "react";
import { defaultNavigationPreferences } from "@veridi/shared";
import type { NavigationPreferencesDTO } from "@veridi/shared";
import { fetchUserPreferences, updateUserPreferences } from "../lib/user-preferences-api";

/** Recolher o menu e abrir três grupos em sequência vira UMA gravação. */
const SAVE_DELAY_MS = 600;

const cacheKey = (userId: string) => `veridi:navegacao:${userId}`;

function onlyStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/**
 * Última preferência conhecida NESTE navegador — só para o primeiro desenho.
 *
 * A fonte da verdade é a API: a preferência é do usuário, não do navegador.
 * Sem este espelho, quem usa o menu compacto veria o menu expandido piscar a
 * cada carregamento até a resposta chegar. Falha de storage (modo privado,
 * cota) só desliga o espelho.
 */
function readCache(userId: string | null): NavigationPreferencesDTO | null {
  if (!userId) return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      compact: parsed["compact"] === true,
      openGroups: onlyStrings(parsed["openGroups"]),
      favorites: onlyStrings(parsed["favorites"]),
    };
  } catch {
    return null;
  }
}

function writeCache(userId: string, prefs: NavigationPreferencesDTO): void {
  try {
    window.localStorage.setItem(cacheKey(userId), JSON.stringify(prefs));
  } catch {
    /* espelho é opcional */
  }
}

export type NavigationPreferencesUpdate = (
  change: (current: NavigationPreferencesDTO) => NavigationPreferencesDTO,
) => void;

/**
 * Preferência de navegação do usuário da sessão.
 *
 * Grava sozinha, sem botão "Salvar": cada mudança vai para a API depois de
 * uma pausa curta, e mudanças seguidas saem numa gravação só. Falha ao ler ou
 * gravar nunca bloqueia a navegação — o menu segue com o que está na tela.
 */
export function useNavigationPreferences(userId: string | null): {
  prefs: NavigationPreferencesDTO;
  update: NavigationPreferencesUpdate;
} {
  const [prefs, setPrefs] = useState<NavigationPreferencesDTO>(
    () => readCache(userId) ?? defaultNavigationPreferences(),
  );
  const prefsRef = useRef(prefs);
  const changedLocally = useRef(false);
  const pending = useRef<NavigationPreferencesDTO | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void (async () => {
      try {
        const { navigation } = await fetchUserPreferences();
        // Clique feito antes de a resposta chegar ganha da resposta.
        if (!active || changedLocally.current) return;
        prefsRef.current = navigation;
        setPrefs(navigation);
        writeCache(userId, navigation);
      } catch {
        /* sem resposta da API: fica o padrão, ou o espelho local */
      }
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  const flush = useCallback((keepalive: boolean) => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const navigation = pending.current;
    if (!navigation) return;
    pending.current = null;
    void (async () => {
      try {
        await updateUserPreferences({ navigation }, { keepalive });
      } catch {
        /* gravação perdida não impede navegar; a próxima mudança tenta de novo */
      }
    })();
  }, []);

  useEffect(() => {
    const onPageHide = () => flush(true);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      flush(true);
    };
  }, [flush]);

  const update = useCallback<NavigationPreferencesUpdate>(
    (change) => {
      const next = change(prefsRef.current);
      changedLocally.current = true;
      prefsRef.current = next;
      setPrefs(next);
      if (!userId) return;
      writeCache(userId, next);
      pending.current = next;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(false), SAVE_DELAY_MS);
    },
    [userId, flush],
  );

  return { prefs, update };
}
