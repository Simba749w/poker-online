const express = require('express');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Forzamos la ruta absoluta a la carpeta "public"
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log('¡Un jugador se conectó!');
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`¡Servidor multijugador activo en el puerto ${PORT}!`);
});