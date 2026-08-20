import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zh from "./locales/zh.json";
import ja from "./locales/ja.json";

// Initialize language from localStorage or navigator language
const getInitialLanguage = (): string => {
  try {
    const saved = localStorage.getItem("language");
    if (saved === "zh" || saved === "ja" || saved === "en") {
      return saved;
    }
  } catch (e) {
    // Ignore localStorage errors (e.g. in environments where it's disabled)
  }

  // Try browser language fallback
  const browserLang = navigator.language || "";
  if (browserLang.toLowerCase().includes("zh")) {
    return "zh";
  }
  if (browserLang.toLowerCase().startsWith("ja")) {
    return "ja";
  }
  return "en";
};

void i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
      ja: { translation: ja },
    },
    lng: getInitialLanguage(),
    fallbackLng: "en",
    interpolation: {
      escapeValue: false, // React already protects against XSS
    },
  });

export default i18n;
