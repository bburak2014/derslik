import "react-native-url-polyfill/auto";
// Must run before the Supabase client is created: it decides at import time
// whether PKCE can use S256 or has to fall back to the plain challenge.
import "./src/crypto-polyfill";
// Uygulama dil değiştirebilir: bütün katalogları baştan kaydet.
import "@derslik/contracts/i18n/all";
import { registerRootComponent } from "expo";
import App from "./src/App";
registerRootComponent(App);
