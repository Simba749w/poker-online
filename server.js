const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));
app.use(express.static(__dirname + '/public'));

const salas = {};

io.on('connection', (socket) => {
    console.log('Jugador conectado:', socket.id);

    // Crear Sala Privada
    socket.on('crearSala', (datos) => {
        const codigoSala = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        salas[codigoSala] = {
            anfitrion: socket.id,
            jugadores: [
                { id: socket.id, nombre: datos.nombre, fichas: 10000, listo: false }
            ],
            ciegaChica: 100,
            ciegaGrande: 200,
            pozo: 300,
            estadoJuego: 'esperando'
        };

        socket.join(codigoSala);
        socket.emit('actualizarSalaOnline', {
            codigoSala: codigoSala,
            jugadores: salas[codigoSala].jugadores,
            esAnfitrion: true
        });
    });

    // Unirse a Sala Existente
    socket.on('unirseSala', (datos) => {
        const sala = salas[datos.codigo];
        if (!sala) return socket.emit('errorSala', 'La sala no existe.');
        if (sala.estadoJuego === 'jugando') return socket.emit('errorSala', 'La partida ya comenzó.');
        if (sala.jugadores.length >= 6) return socket.emit('errorSala', 'La mesa está llena.');

        sala.jugadores.push({
            id: socket.id,
            nombre: datos.nombre,
            fichas: 10000,
            listo: false
        });

        socket.join(datos.codigo);
        io.to(datos.codigo).emit('actualizarSalaOnline', {
            codigoSala: datos.codigo,
            jugadores: sala.jugadores,
            esAnfitrion: false
        });
    });

    // Iniciar Partida (Anfitrión)
    socket.on('iniciarPartidaOnline', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.anfitrion === socket.id) {
            sala.estadoJuego = 'jugando';
            io.to(codigo).emit('partidaIniciadaOnline');
        }
    });

    // Recibir cálculos y puntajes de cada jugador en la ronda
    socket.on('enviarCalculoOnline', (datos) => {
        io.to(datos.codigo).emit('resultadoRankingJugador', {
            nombre: datos.nombre,
            outs: datos.outs,
            porcentaje: datos.porcentaje,
            potOdds: datos.potOdds,
            tiempoSegundos: datos.tiempoSegundos,
            acierto: datos.acierto
        });
    });

    // Botón Estoy Listo para avanzar de ronda
    socket.on('jugadorListo', (datos) => {
        const sala = salas[datos.codigo];
        if (sala) {
            let jugador = sala.jugadores.find(j => j.id === socket.id);
            if (jugador) jugador.listo = true;

            // Verificar si todos están listos
            let todosListos = sala.jugadores.every(j => j.listo);
            if (todosListos) {
                sala.jugadores.forEach(j => j.listo = false); // Reiniciar estado
                io.to(datos.codigo).emit('avanzarSiguienteRonda');
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Jugador desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
