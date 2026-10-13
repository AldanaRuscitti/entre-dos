// Configuración de Entre Dos. Reemplazá los valores que empiezan con TU_ (ver LEEME.md, pasos 1 y 2).
// Estos datos no son secretos: Firebase los usa para saber a qué proyecto conectarse.
// La seguridad la dan las reglas de Firestore y la lista "Quién puede entrar".

// 1) Firebase → Configuración del proyecto → Tus apps → app web → "Config"
self.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAIoj1WJ8pJ_hByNmRIzFpyjigfrUMAOvI",
  authDomain: "entre-dos-cd6de.firebaseapp.com",
  projectId: "entre-dos-cd6de",
  storageBucket: "entre-dos-cd6de.firebasestorage.app",
  messagingSenderId: "986535059890",
  appId: "1:986535059890:web:57bc3ebafed7c57546c4ab"
};

// 2) Firebase → Configuración del proyecto → Cloud Messaging → Certificados push web → "Par de claves"
self.VAPID_KEY = "BL7OOTYVqwmS-XX67JX0Fl1x3EDKittMqVQn3dbrqSTvd66zQ5iEU82f-A_QnfdkteqVQaOzANdV0dDd8csHU-s";

// 3) Usuario de tu bot de Telegram, sin la @ (por ejemplo: EntreDosCasaBot)
self.TELEGRAM_BOT = "EntreDosBot";
