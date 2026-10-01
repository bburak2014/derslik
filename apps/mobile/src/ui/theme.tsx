import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useColorScheme, View } from "react-native";
import { deleteItemAsync, getItemAsync, setItemAsync } from "expo-secure-store";
import { useFonts } from "expo-font";
import {
  lightColors,
  type Palette,
  darkColors,
  type Typography,
  fontFiles,
  brandType,
  systemType,
} from "./tokens";
import { makeStyles, makeSection } from "./styles";

/* ------------------------------------------------------------------ */
/* Tema: sağlayıcı ve useTheme                                         */
/* ------------------------------------------------------------------ */

const THEME_KEY = "derslik.theme";

function build(colors: Palette, type: Typography) {
  return {
    colors,
    type,
    styles: makeStyles(colors, type),
    section: makeSection(colors, type),
  };
}
const themes = {
  brand: {
    light: build(lightColors, brandType),
    dark: build(darkColors, brandType),
  },
  system: {
    light: build(lightColors, systemType),
    dark: build(darkColors, systemType),
  },
};

export type ThemeMode = "light" | "dark" | "system";
type ThemeValue = ReturnType<typeof build> & {
  scheme: "light" | "dark";
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeValue>({
  ...themes.system.light,
  scheme: "light",
  mode: "system",
  setMode: () => {},
});

/**
 * Tema sağlayıcı. `mode` üç değerli: cihazı izle (system) ya da sabitle.
 * Seçim cihazda saklanır; web'deki tema düğmesiyle aynı davranış. Yazı
 * tipleri de burada yüklenir; yüklenene kadar yalnızca tuval çizilir.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const device = useColorScheme();
  const [fontsReady, fontError] = useFonts(fontFiles);
  const [mode, setModeState] = useState<ThemeMode>("system");
  useEffect(() => {
    let alive = true;
    void getItemAsync(THEME_KEY)
      .then((stored) => {
        if (alive && (stored === "light" || stored === "dark"))
          setModeState(stored);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void (next === "system"
      ? deleteItemAsync(THEME_KEY).catch(() => {})
      : setItemAsync(THEME_KEY, next).catch(() => {}));
  }, []);
  const scheme: "light" | "dark" =
    mode === "system" ? (device === "dark" ? "dark" : "light") : mode;
  const family = fontsReady ? "brand" : "system";
  const value = useMemo(
    () => ({ ...themes[family][scheme], scheme, mode, setMode }),
    [family, scheme, mode, setMode],
  );
  if (!fontsReady && !fontError)
    return <View style={{ flex: 1, backgroundColor: value.colors.canvas }} />;
  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/** Bileşenler bunu `const { colors, styles } = useTheme()` diye kullanır. */
export function useTheme() {
  return useContext(ThemeContext);
}
