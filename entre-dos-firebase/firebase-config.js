// Configuración de Entre Dos. Reemplazá los valores que empiezan con TU_ (ver LEEME.md, pasos 1 y 2).
// Estos datos no son secretos: Firebase los usa para saber a qué proyecto conectarse.
// La seguridad la dan las reglas de Firestore y la lista "Quién puede entrar".

// 1) Firebase → Configuración del proyecto → Tus apps → app web → "Config"
self.FIREBASE_CONFIG = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.firebasestorage.app",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID"
};

// 2) Firebase → Configuración del proyecto → Cloud Messaging → Certificados push web → "Par de claves"
self.VAPID_KEY = "TU_CLAVE_VAPID";

// 3) Usuario de tu bot de Telegram, sin la @ (por ejemplo: EntreDosCasaBot)
self.TELEGRAM_BOT = "TU_BOT";
