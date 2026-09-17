const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

// Servir archivos estáticos desde la carpeta actual o public
app.use(express.static(__dirname));
app.use(express.static(__dirname + '/public'));

io.on('connection', (socket) => {
    console.log('Un jugador se conectó:', socket.id);

    socket.on('crearSala', (datos) => {
        const codigoSala = Math.random().toString(36).substring(2, 6).toUpperCase();
        socket.join(codigoSala);
        console.log(`Sala creada: ${codigoSala} por ${datos.nombre}`);
        socket.emit('salaCreada', { codigoSala: codigoSala, nombre: datos.nombre });
    });

    socket.on('unirseSala', (datos) => {
        socket.join(datos.codigo);
        console.log(`${datos.nombre} se unió a la sala ${datos.codigo}`);
        socket.emit('salaUnidaExito', { codigoSala: datos.codigo });
        socket.to(datos.codigo).emit('jugadorUnido', { nombre: datos.nombre });
    });

    socket.on('disconnect', () => {
        console.log('Un jugador se desconectó.');
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
