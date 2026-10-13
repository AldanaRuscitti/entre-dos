# Entre Dos: cómo dejarla andando (gratis)

Son unos 30–40 minutos una sola vez. No hace falta saber programar: todo se hace desde el navegador.
Vas a usar tres servicios gratis: **Firebase** (guarda los datos y maneja el inicio de sesión), **GitHub** (publica la app y manda los avisos cada 15 minutos) y **Telegram** (el bot que te escribe).

> Antes de empezar: en la versión vieja (la de Claude) entrá a **Ajustes → Bajar una copia → Copia completa de todo** y guardá el archivo. Pedile a tu pareja que haga lo mismo (así trae lo suyo privado).

---

## 1. Firebase (datos y login)

1. Entrá a <https://console.firebase.google.com> con tu cuenta de Google → **Crear un proyecto** → nombre `entre-dos` → podés desactivar Google Analytics → **Crear**.
2. **Inicio de sesión**: menú **Compilación → Authentication → Comenzar → Google → Habilitar** → elegí tu mail de asistencia → **Guardar**.
3. **Base de datos**: **Compilación → Firestore Database → Crear base de datos** → ubicación `southamerica-east1 (São Paulo)` → **modo de producción** → **Crear**.
4. **Reglas**: en Firestore, pestaña **Reglas** → borrá todo, pegá el contenido del archivo `firestore.rules` → **Publicar**.
5. **Quién puede entrar** (el primer acceso lo creás a mano): en Firestore, pestaña **Datos** → **Iniciar colección** → ID de colección `access` → ID del documento: **tu mail de Google en minúsculas** → agregá un campo cualquiera (por ejemplo `nota` = `admin`) → **Guardar**. A tu pareja la sumás después desde la app.
6. **Datos de la app web**: ⚙️ **Configuración del proyecto → General → Tus apps → `</>` (Web)** → apodo `Entre Dos` → **Registrar app**. Te muestra un bloque `firebaseConfig = { apiKey: ..., ... }`. Copiá esos valores en `firebase-config.js` (reemplazando los `TU_...`).
7. **Notificaciones del celu**: ⚙️ **Configuración del proyecto → Cloud Messaging → Certificados push web → Generar par de claves**. Copiá la clave en `firebase-config.js`, en `VAPID_KEY`.
8. **Llave para los avisos automáticos**: ⚙️ **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada**. Se baja un archivo `.json`. **Esto sí es secreto**: no lo mandes por chat ni lo subas a ningún lado salvo al paso 3.4. Cuando termines, borralo de tu compu.

## 2. Telegram (el bot que te avisa)

1. En Telegram buscá **@BotFather** → escribile `/newbot`.
2. Nombre: `Entre Dos` (o el que quieras). Usuario: algo que termine en `bot`, por ejemplo `EntreDosCasaBot`.
3. Te devuelve un **token** (algo como `123456:ABC-...`). **Es secreto**: guardalo para el paso 3.4.
4. Poné el usuario del bot (sin @) en `firebase-config.js`, en `TELEGRAM_BOT`.

## 3. GitHub (publicar la app y los avisos)

1. Creá una cuenta en <https://github.com> si no tenés.
2. **New repository** → nombre `entre-dos` → **Public** (así las automatizaciones son gratis e ilimitadas; tus datos no están ahí, solo el código) → **Create repository**.
3. **Subir los archivos**: en el repo, **Add file → Upload files** → arrastrá **todo el contenido** de esta carpeta (incluida la carpeta `.github`; en Mac apretá `Cmd+Shift+.` en el Finder para ver las carpetas que empiezan con punto) → **Commit changes**.
   - Si la carpeta `.github` no se sube arrastrando: **Add file → Create new file**, nombre `.github/workflows/avisos.yml`, pegá el contenido de ese archivo y guardá.
4. **Secretos**: **Settings → Secrets and variables → Actions**:
   - Pestaña **Secrets → New repository secret**: `FIREBASE_SERVICE_ACCOUNT` = todo el contenido del `.json` del paso 1.8 (abrilo con un editor de texto y copiá todo).
   - **New repository secret**: `TELEGRAM_BOT_TOKEN` = el token del paso 2.3.
   - Pestaña **Variables → New repository variable**: `APP_URL` = la dirección de tu app (la ves en el paso 5, algo como `https://TU_USUARIO.github.io/entre-dos/`).
5. **Publicar la app**: **Settings → Pages** → Source: **Deploy from a branch** → Branch `main` / carpeta `/ (root)` → **Save**. En un par de minutos aparece arriba la dirección `https://TU_USUARIO.github.io/entre-dos/`.
6. **Permitir el login en esa dirección**: en Firebase → **Authentication → Configuración → Dominios autorizados → Agregar dominio** → `TU_USUARIO.github.io`.
7. **Prender los avisos**: en GitHub, pestaña **Actions** → si pregunta, **I understand… enable** → elegí **Avisos** → **Run workflow** para probarlo ya. Tiene que terminar en verde ✅. Después corre solo cada 15 minutos.

## 4. Primer uso

1. Abrí `https://TU_USUARIO.github.io/entre-dos/` en el celu → **Entrar con Google**.
2. En la bienvenida tocá **Importar copia** y elegí el archivo que bajaste de la versión vieja. Se carga todo y te reconoce sola.
3. **Agregala al inicio del celu**:
   - **iPhone** (Safari): Compartir → **Agregar a inicio**. Abrila siempre desde ese ícono (en iPhone las notificaciones solo funcionan así, con iOS 16.4 o más nuevo).
   - **Android** (Chrome): menú ⋮ → **Instalar app** o **Agregar a la pantalla principal**.
4. **Ajustes → Avisos**:
   - **Telegram → Conectar** → tocá el link → **Iniciar**. En menos de 15 minutos el bot te confirma.
   - **Notificaciones en este dispositivo → Activar acá** → Permitir.
   - Elegí la hora del resumen y tocá **Mandarme un aviso de prueba**.
5. **Sumar a tu pareja**: **Ajustes → Quién puede entrar** → su mail de Google → **Dar acceso** → **Copiar mensaje para tu pareja** y mandáselo. Cuando entre, toca **Soy yo** sobre su nombre, importa su copia (solo se suma lo suyo privado) y conecta sus avisos.

## Qué avisa

- **Resumen del día** (a la hora que elijas): tus tareas de hoy y las atrasadas, la agenda, vencimientos y cumpleaños (con aviso de regalo), gastos fijos del día, votaciones pendientes y los "gracias" nuevos.
- **Lo de mañana** (opcional, a la noche).
- **Una hora antes** de tus eventos con horario.
- Por Telegram podés escribirle al bot `/hoy` o `/manana` cuando quieras.

## Bueno saber

- **Todo gratis** dentro de los límites de Firebase (de sobra para dos personas) y de GitHub (repositorio público).
- Los avisos pueden llegar **unos minutos tarde**: GitHub los revisa cada 15 minutos y a veces se demora un poco.
- **Privacidad**: lo "Solo yo" queda protegido por las reglas (ni tu pareja lo puede leer). Pero quien administra el proyecto de Firebase (vos) y el proceso de avisos técnicamente pueden ver todos los datos. No compartas el acceso a la consola de Firebase ni los secretos.
- **Si el login no funciona en iPhone desde el ícono**: abrila en Safari, iniciá sesión ahí y después volvé a agregarla al inicio. Si sigue fallando, la alternativa es publicar en Firebase Hosting (misma dirección que el login); pedime ayuda y lo armamos.
- **Para cambiar algo de la app**: editá el archivo en GitHub (ícono del lápiz) y guardá; en un minuto se actualiza.
- **Pruebas** (opcional, si tenés Node instalado): `sh pruebas/run.sh` y `cd notifier && npm install && npm test`.
