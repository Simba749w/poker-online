const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));
app.use(express.static(__dirname + '/public'));

const salas = {};

io.on('connection', (socket) => {
    console.log('Jugador conectado:', socket.id);

    // 1. Crear Sala (Solución al Anfitrión)
    socket.on('crearSala', (datos) => {
        const codigoSala = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        salas[codigoSala] = {
            anfitrion: socket.id,
            jugadores: [
                { id: socket.id, nombre: datos.nombre, fichas: 10000, listo: false, puntajeGlobal: 0, activo: true }
            ],
            estadoJuego: 'esperando',
            dealerIndex: 0
        };

        socket.join(codigoSala);
        
        io.to(codigoSala).emit('actualizarSalaOnline', {
            codigoSala: codigoSala,
            jugadores: salas[codigoSala].jugadores.map(j => ({
                ...j,
                esAnfitrion: (j.id === salas[codigoSala].anfitrion)
            })),
            esAnfitrion: true 
        });
    });

    // 2. Unirse a Sala (Máximo 9)
    socket.on('unirseSala', (datos) => {
        const sala = salas[datos.codigo];
        if (!sala) return socket.emit('errorSala', 'La sala no existe.');
        if (sala.estadoJuego === 'jugando') return socket.emit('errorSala', 'La partida ya comenzó.');
        if (sala.jugadores.length >= 9) return socket.emit('errorSala', 'Mesa llena (máx 9).');

        sala.jugadores.push({
            id: socket.id, nombre: datos.nombre, fichas: 10000, listo: false, puntajeGlobal: 0, activo: true
        });

        socket.join(datos.codigo);
        
        io.to(datos.codigo).emit('actualizarSalaOnline', {
            codigoSala: datos.codigo,
            jugadores: sala.jugadores.map(j => ({
                ...j,
                esAnfitrion: (j.id === sala.anfitrion)
            })),
            esAnfitrion: (socket.id === sala.anfitrion)
        });
    });

    // 3. Iniciar Partida (Solo el líder puede accionar esto)
    socket.on('iniciarPartidaOnline', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.anfitrion === socket.id) {
            sala.estadoJuego = 'jugando';
            sala.jugadores.forEach(j => { j.listo = false; j.activo = true; });
            io.to(codigo).emit('partidaIniciadaOnline', { dealerIndex: sala.dealerIndex });
        }
    });

    // 4. Avanzar de Calle
    socket.on('avanzarCalleHost', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.anfitrion === socket.id) {
            sala.jugadores.forEach(j => j.listo = false);
            io.to(codigo).emit('avanzarSiguienteRonda');
        }
    });

    // 5. Recibir Cálculos, Puntajes y Velocidad
    socket.on('enviarCalculoOnline', (datos) => {
        const sala = salas[datos.codigo];
        if (sala) {
            let jugador = sala.jugadores.find(j => j.id === socket.id);
            if (jugador) {
                // Lógica de puntaje base por aciertos/errores (+100 / -50)
                let puntosRonda = 0;
                puntosRonda += datos.outsCorrecto ? 100 : -50;
                puntosRonda += datos.probCorrecto ? 100 : -50;
                puntosRonda += datos.oddsCorrecto ? 100 : -50;
                
                // El bonus de velocidad se suma de forma dinámica
                jugador.puntajeGlobal += puntosRonda + (datos.bonusVelocidad || 0);

                io.to(datos.codigo).emit('resultadoRankingJugador', {
                    id: socket.id,
                    nombre: datos.nombre,
                    outs: datos.outs, outsOk: datos.outsCorrecto,
                    porcentaje: datos.porcentaje, probOk: datos.probCorrecto,
                    potOdds: datos.potOdds, oddsOk: datos.oddsCorrecto,
                    tiempoSegundos: datos.tiempoSegundos,
                    puntosGanados: puntosRonda + (datos.bonusVelocidad || 0),
                    puntajeTotal: jugador.puntajeGlobal
                });
            }
        }
    });

    // 6. Marcar Listo y estado de Fold
    socket.on('jugadorListo', (datos) => {
        const sala = salas[datos.codigo];
        if (sala) {
            let jugador = sala.jugadores.find(j => j.id === socket.id);
            if (jugador) {
                jugador.listo = true;
                if(datos.accion === 'fold') jugador.activo = false; // Se marca en rojo para el Showdown
            }

            io.to(datos.codigo).emit('estadoListosActualizado', {
                jugadores: sala.jugadores
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('Jugador desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Servidor en puerto ${PORT}`);
});
