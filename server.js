const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));
app.use(express.static(__dirname + '/public'));

const salas = {};

io.on('connection', (socket) => {
    console.log('Jugador conectado:', socket.id);

    // 1. Crear Sala
    socket.on('crearSala', (datos) => {
        const codigoSala = Math.random().toString(36).substring(2, 6).toUpperCase();
        salas[codigoSala] = {
            anfitrion: socket.id,
            jugadores: [{ id: socket.id, nombre: datos.nombre, fichas: 10000, listo: false, puntajeGlobal: 0, activo: true }],
            estadoJuego: 'esperando',
            dealerIndex: 0,
            // NUEVAS VARIABLES AÑADIDAS PARA GESTIÓN REAL DE MESA
            potTotal: 0,
            apuestaActual: 200,
            turnoActual: 0,
            street: 0
        };

        socket.join(codigoSala);
        io.to(codigoSala).emit('actualizarSalaOnline', {
            codigoSala: codigoSala,
            anfitrion: socket.id, 
            jugadores: salas[codigoSala].jugadores.map(j => ({ ...j, esAnfitrion: (j.id === salas[codigoSala].anfitrion) }))
        });
    });

    // 2. Unirse a Sala (2 a 9 jugadores)
    socket.on('unirseSala', (datos) => {
        const sala = salas[datos.codigo];
        if (!sala) return socket.emit('errorSala', 'La sala no existe.');
        if (sala.estadoJuego === 'jugando') return socket.emit('errorSala', 'La partida ya comenzó.');
        if (sala.jugadores.length >= 9) return socket.emit('errorSala', 'La mesa está llena (máximo 9).');

        sala.jugadores.push({ id: socket.id, nombre: datos.nombre, fichas: 10000, listo: false, puntajeGlobal: 0, activo: true });
        socket.join(datos.codigo);
        
        io.to(datos.codigo).emit('actualizarSalaOnline', {
            codigoSala: datos.codigo,
            anfitrion: sala.anfitrion, 
            jugadores: sala.jugadores.map(j => ({ ...j, esAnfitrion: (j.id === sala.anfitrion) }))
        });
    });

    // 3. Iniciar Partida Online
    socket.on('iniciarPartidaOnline', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.anfitrion === socket.id) {
            sala.estadoJuego = 'jugando';
            sala.jugadores.forEach(j => { j.listo = false; j.activo = true; });
            io.to(codigo).emit('partidaIniciadaOnline', { dealerIndex: sala.dealerIndex });
        }
    });

    // 4. Avanzar Calle (Misma Mano)
    socket.on('avanzarCalleHost', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.anfitrion === socket.id) {
            sala.jugadores.forEach(j => j.listo = false);
            sala.street++; // ACTUALIZADO: Registramos el progreso de calle en el server
            io.to(codigo).emit('avanzarSiguienteRonda'); // Avanza Flop, Turn, River
        }
    });

    // 4.b Iniciar NUEVA Mano (Acá rota el Dealer)
    socket.on('siguienteManoOnline', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.anfitrion === socket.id) {
            sala.dealerIndex = (sala.dealerIndex + 1) % sala.jugadores.length; // ROTACIÓN CORRECTA
            sala.jugadores.forEach(j => { j.listo = false; j.activo = (j.fichas > 0); }); // ACTUALIZADO: Solo activos si tienen fichas
            io.to(codigo).emit('nuevaManoOnline', { dealerIndex: sala.dealerIndex });
        }
    });

    // 5. Cálculos y Ranking
    socket.on('enviarCalculoOnline', (datos) => {
        const sala = salas[datos.codigo];
        if (sala) {
            let jugador = sala.jugadores.find(j => j.id === socket.id);
            if (jugador) {
                let puntosRonda = 0;
                puntosRonda += datos.outsCorrecto ? 100 : -50;
                puntosRonda += datos.probCorrecto ? 100 : -50;
                puntosRonda += datos.oddsCorrecto ? 100 : -50;
                
                jugador.puntajeGlobal += puntosRonda + (datos.bonusVelocidad || 0);

                io.to(datos.codigo).emit('resultadoRankingJugador', {
                    id: socket.id, nombre: datos.nombre,
                    outs: datos.outs, outsOk: datos.outsCorrecto,
                    porcentaje: datos.porcentaje, probOk: datos.probCorrecto,
                    potOdds: datos.potOdds, oddsOk: datos.oddsCorrecto,
                    tiempoSegundos: datos.tiempoSegundos, puntajeTotal: jugador.puntajeGlobal
                });
            }
        }
    });

    // 6. Marcar Listo / Fold (Mantenido por retrocompatibilidad)
    socket.on('jugadorListo', (datos) => {
        const sala = salas[datos.codigo];
        if (sala) {
            let jugador = sala.jugadores.find(j => j.id === socket.id);
            if (jugador) {
                jugador.listo = true;
                if(datos.accion === 'fold') jugador.activo = false;
            }
            io.to(datos.codigo).emit('estadoListosActualizado', { jugadores: sala.jugadores });
        }
    });

    // ==========================================
    // NUEVAS FUNCIONES DE LÓGICA DE JUEGO AÑADIDAS 
    // ==========================================

    // 7. Gestión de Apuestas y Turnos Online
    socket.on('accionJugador', (datos) => {
        const sala = salas[datos.codigo];
        if(sala) {
            let jugador = sala.jugadores.find(j => j.id === socket.id);
            if(jugador) {
                if(datos.accion === 'fold') {
                    jugador.activo = false;
                } else {
                    let costo = datos.monto || 0;
                    jugador.fichas -= costo;
                    sala.potTotal += costo;
                    if(datos.accion === 'raise' && datos.monto > sala.apuestaActual) {
                        sala.apuestaActual = datos.monto;
                    }
                }
            }
            // Sincronizar el estado monetario con el resto de la mesa
            io.to(datos.codigo).emit('actualizarMesa', {
                jugadores: sala.jugadores,
                potTotal: sala.potTotal,
                apuestaActual: sala.apuestaActual,
                turnoActual: datos.siguienteTurno
            });
        }
    });

    // 8. Sincronización Inicial de Ciegas y Stacks
    socket.on('iniciarRondaOnline', (datos) => {
        const sala = salas[datos.codigo];
        if(sala && sala.anfitrion === socket.id) {
            sala.potTotal = datos.potInicial;
            sala.apuestaActual = datos.apuestaInicial;
            sala.street = 0;
            datos.jugadores.forEach(jd => {
                let j = sala.jugadores.find(x => x.nombre === jd.nombre || x.id === jd.id);
                if(j) {
                    j.fichas = jd.fichas;
                    j.activo = (jd.fichas > 0);
                }
            });
            io.to(datos.codigo).emit('actualizarMesa', {
                jugadores: sala.jugadores,
                potTotal: sala.potTotal,
                apuestaActual: sala.apuestaActual,
                turnoActual: datos.turnoActual
            });
        }
    });

    // 9. Sincronizador de Fases 40s (Calculo -> Review -> Avanzar)
    socket.on('sincronizarFase', (datos) => {
        io.to(datos.codigo).emit('cambioFase', datos);
    });

    socket.on('disconnect', () => {
        console.log('Jugador desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Servidor de Poker en puerto ${PORT}`);
});
