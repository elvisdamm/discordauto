# Dispatch — Mensajes de Discord programados

Herramienta personal, estilo Discohook, para componer mensajes de Discord (con embeds completos) y programarlos para que se envíen automáticamente en una fecha/hora futura a través de un **webhook de Discord**.

No necesita bot ni permisos especiales de Discord: solo un webhook, que se crea desde la configuración de cualquier canal.

## ¿Cómo funciona?

- **Frontend** (`public/`): editor de embeds con vista previa en vivo (igual que Discohook) + una cola de despacho con cuenta atrás para cada mensaje programado.
- **Backend** (`server.js`): API REST + base de datos SQLite (`data.sqlite`, se crea sola) donde se guardan los mensajes pendientes.
- **Scheduler** (`scheduler.js`): un `cron` interno que revisa cada 30 segundos si hay mensajes cuya hora ya llegó, y si es así, los envía al webhook y marca el resultado (enviado / fallido).

Importante: el envío programado **solo ocurre mientras el proceso de Node esté corriendo**. Por eso este proyecto necesita alojarse en algo que mantenga el proceso activo 24/7 (no vale un hosting puramente estático).

## Cómo obtener la URL de un webhook de Discord

1. En Discord, entra a **Configuración del canal → Integraciones → Webhooks**.
2. Crea un webhook nuevo, ponle nombre/avatar si quieres.
3. Copia la **URL del webhook** y pégala en el campo "URL del webhook" de la app.

## Ejecutar en local

Requiere Node.js 18 o superior.

```bash
npm install
npm start
```

Abre `http://localhost:3000`.

La base de datos (`data.sqlite`) se crea automáticamente en la carpeta del proyecto la primera vez que arrancas el servidor.

## Desplegarlo para que funcione aunque tu ordenador esté apagado

Necesitas un hosting que mantenga un proceso de Node siempre activo. Recomendado para uso personal, de más a menos sencillo:

### Opción 1: Railway (recomendada)
1. Sube este proyecto a un repo de GitHub (o usa `railway up` desde la CLI sin GitHub).
2. En [railway.app](https://railway.app), crea un proyecto nuevo → "Deploy from GitHub repo".
3. Railway detecta `package.json` y ejecuta `npm start` solo.
4. **Importante**: añade un *Volume* en Railway y móntalo en `/app/data` (o la ruta del proyecto), y cambia en `db.js` la ruta del archivo `data.sqlite` para que apunte ahí — si no, cada redeploy borra la base de datos porque el sistema de archivos no es persistente por defecto.
5. Railway te da una URL pública (`https://tuapp.up.railway.app`) — puedes ponerle contraseña con un pequeño middleware si vas a exponerla (ver sección de seguridad abajo).

### Opción 2: Render
1. "New → Web Service" desde tu repo de GitHub.
2. Build command: `npm install`. Start command: `npm start`.
3. En el plan gratuito, Render "duerme" el servicio tras inactividad, lo que puede retrasar el envío de mensajes programados durante ese tiempo — para uso serio conviene el plan de pago más básico ("Starter"), que mantiene el proceso siempre despierto.
4. Añade un *Persistent Disk* montado donde vive `data.sqlite`, por la misma razón que en Railway.

### Opción 3: Tu propio VPS
1. Instala Node 18+, clona el repo, `npm install`.
2. Usa `pm2` para mantenerlo vivo y que rearranque solo:
   ```bash
   npm install -g pm2
   pm2 start server.js --name dispatch
   pm2 save
   pm2 startup
   ```
3. (Opcional) pon Nginx delante como proxy inverso con HTTPS via Let's Encrypt/Certbot.

## Seguridad — importante si lo publicas en internet

Esta app **no tiene login**. Si la despliegas con una URL pública, cualquiera que la encuentre podría programar mensajes usando tus webhooks guardados o crear los suyos. Como es de uso personal, te recomiendo alguna de estas dos cosas sencillas:

- Ponerla detrás de autenticación básica HTTP (unas pocas líneas con el paquete `express-basic-auth`), o
- Restringir el acceso por IP / VPN si tu hosting lo permite.

Si quieres, puedo añadirte esa capa de autenticación al proyecto.

## Estructura del proyecto

```
discohook-scheduler/
├── server.js        # API REST (crear/editar/cancelar/enviar mensajes)
├── scheduler.js      # Cron interno que despacha mensajes a Discord
├── db.js             # Configuración de SQLite
├── package.json
└── public/
    ├── index.html
    ├── style.css
    └── app.js         # Editor de embeds + preview + cola de despacho
```

## Límites de Discord a tener en cuenta

- Máximo 10 embeds por mensaje.
- Contenido de texto: máx. 2000 caracteres.
- Descripción de embed: máx. 4096 caracteres.
- Máx. 25 campos por embed.
- Los webhooks tienen un rate limit propio de Discord; si programas muchísimos mensajes para el mismo instante exacto, algunos podrían fallar por 429 (demasiadas peticiones) — en ese caso quedan marcados como "Fallido" y puedes reprogramarlos desde la cola.
