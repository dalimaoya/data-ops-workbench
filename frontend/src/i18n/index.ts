import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './zh.json';
import en from './en.json';

const savedLang = localStorage.getItem('i18n-lang') || 'zh';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
    },
    lng: savedLang,
    fallbackLng: 'zh',
    interpolation: {
      escapeValue: false,
    },
  });

// Sync language changes to localStorage
i18n.on('languageChanged', (lng) => {
  localStorage.setItem('i18n-lang', lng);
});

export default i18n;
