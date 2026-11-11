# NosotrosPlaticamos

Chat en tiempo real con sala general y grupos, nickname sin cuenta, avatar opcional, filtro de lenguaje, paletas de color y acceso rápido a emojis. Incluye conversaciones privadas en burbujas flotantes con contador de mensajes pendientes, notificaciones del navegador opcionales, moderación de grupos, controles anti-spam y un historial reciente configurable. El avatar aleatorio se genera una sola vez en la vista previa y se conserva al entrar al chat; incluye variantes distinguibles de gato y pibble con accesorios.

La estructura visual está separada: el marcado está en `public/index.html`, los estilos en `public/styles.css` y el comportamiento en `public/app.js`.

## Ejecutar en local

```sh
npm install
npm start
```

Abre <http://localhost:3000>. Los mensajes y grupos se guardan en la memoria del servidor, por separado para cada sala, y se comparten con quienes entren a ella. El historial dura mientras el proceso del servidor siga activo; al reiniciarlo se borra. No se usa una base de datos ni se guarda el historial en el navegador.

En una publicación, este almacenamiento en memoria sirve para una prueba pequeña mientras la instancia esté activa. No conserva los mensajes después de reinicios o despliegues, y las instancias independientes no comparten usuarios, grupos ni mensajes. Para probar con pocas personas no es obligatorio contratar una base de datos; sí hay que aceptar que las sesiones pueden no encontrarse entre sí y que se puede perder el historial. Para un chat público fiable, con varias instancias o historial persistente, hace falta almacenamiento compartido y un adaptador de Socket.IO compatible. Los avatares predeterminados de gatos y pibbles se generan localmente; también se pueden indicar imágenes por URL.

## Privacidad y grupos

Los grupos nuevos son privados y solo se entra con invitación aceptada. El creador puede hacerlos públicos, desactivar invitaciones o cambiar la moderación desde **Ajustes**. Cada usuario puede desactivar los mensajes directos y bloquear o desbloquear a otros. Como no hay cuentas, el identificador de privacidad vive en el navegador: sirve para pruebas, pero se puede restablecer borrando los datos del sitio o suplantar desde otro cliente. No se debe tratar como control de acceso para datos sensibles.

Los mensajes directos e invitaciones se envían a usuarios conectados y se mantienen en la memoria del servidor durante la sesión. Las conversaciones se pueden abrir desde las burbujas flotantes; el aviso aparece en la página y, si se habilita y el navegador da permiso, como notificación del sistema mientras la página siga abierta (no es una notificación push cuando el navegador está cerrado). Los reportes, moderadores, silencios y límites de historial tampoco son persistentes. Los reportes de la sala general aparecen en los logs del servidor; los de un grupo los pueden revisar su propietario y moderadores.

Los grupos permiten asignar moderadores entre sus miembros conectados. El propietario conserva los ajustes de privacidad, invitaciones, retención y roles; los moderadores pueden ajustar el filtro, revisar reportes y retirar mensajes. Cualquier usuario puede editar o eliminar sus propios mensajes. Hay límites anti-spam por conexión (6 mensajes de sala o 8 privados cada 5 segundos; 4 reportes por minuto), pero no sustituyen autenticación, protección distribuida ni moderación humana. Como los perfiles no tienen cuenta y sus identificadores viven en el navegador, propietario y moderadores son controles de conveniencia para pruebas, no una frontera de seguridad.

## Publicar en Vercel

Después de subir el commit a GitHub, desde la raíz del proyecto:

```sh
npx vercel login
npx vercel link
npx vercel deploy --prod
```

`vercel link` permite seleccionar la cuenta/equipo y asociar el proyecto. El despliegue usa la copia local actual. También se puede importar el repositorio desde el panel de Vercel para que los siguientes pushes desplieguen automáticamente.

## Moderación

La sala general siempre censura términos de una lista editable en `server.js`. Los grupos nuevos también activan el filtro de forma predeterminada; sus participantes pueden desactivarlo desde el control **Filtro** de esa sala. La lista es una ayuda básica, no sustituye moderación humana ni contempla todas las variantes.
