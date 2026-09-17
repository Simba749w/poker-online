const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));
app.use(express.static(__dirname + '/public'));

const salas = {};

io.on('connection', (socket) => {
    console.log('Jugador conectado:', socket.id);

    socket.on('crearSala', (datos) => {
        const codigoSala = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        salas[codigoSala] = {
            anfitrion: socket.id,
            jugadores: [
                { id: socket.id, nombre: datos.nombre, fichas: 10000, asiento: 1, estado: 'activo' }
            ],
            ciegaChica: 100,
            ciegaGrande: 200,
            pozo: 300, // SB + BB inicial
            fase: 'flop', // flop, turn, river
            estadoJuego: 'esperando'
        };

        socket.join(codigoSala);
        socket.emit('actualizarSala', {
            codigoSala: codigoSala,
            jugadores: salas[codigoSala].jugadores,
            esAnfitrion: true,
            ciegaChica: 100,
            ciegaGrande: 200,
            pozo: 300
        });
    });

    socket.on('unirseSala', (datos) => {
        const sala = salas[datos.codigo];
        if (!sala) return socket.emit('errorSala', 'La sala no existe.');
        if (sala.estadoJuego === 'jugando') return socket.emit('errorSala', 'La partida ya comenzó.');
        if (sala.jugadores.length >= 5) return socket.emit('errorSala', 'La mesa está llena (máximo 5 oponentes).');

        const nuevoAsiento = sala.jugadores.length + 1;
        sala.jugadores.push({
            id: socket.id,
            nombre: datos.nombre,
            fichas: 10000,
            asiento: nuevoAsiento,
            estado: 'activo'
        });

        socket.join(datos.codigo);
        io.to(datos.codigo).emit('actualizarSala', {
            codigoSala: datos.codigo,
            jugadores: sala.jugadores,
            esAnfitrion: false,
            ciegaChica: sala.ciegaChica,
            ciegaGrande: sala.ciegaGrande,
            pozo: sala.pozo
        });
    });

    socket.on('iniciarPartida', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.anfitrion === socket.id) {
            sala.estadoJuego = 'jugando';
            io.to(codigo).emit('partidaIniciada');
        }
    });

    // Enviar jugada o cálculo realizado para comparar puntajes
    socket.on('enviarCalculo', (datos) => {
        io.to(datos.codigo).emit('resultadoCalculoJugador', {
            nombre: datos.nombre,
            outs: datos.outs,
            porcentaje: datos.porcentaje,
            potOdds: datos.potOdds,
            tiempoSegundos: datos.tiempoSegundos
        });
    });

    socket.on('disconnect', () => {
        console.log('Jugador desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Servidor activo en puerto ${PORT}`);
});
