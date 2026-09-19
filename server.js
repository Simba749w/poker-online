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
            jugadores: [{ id: socket.id, nombre: datos.nombre, fichas: 10000, listo: false, puntajeGlobal: 0, activo: true, turno: false }],
            estadoJuego: 'esperando',
            dealerIndex: 0,
            turnoIndex: 0,
            pot: 0,
            apuestaActual: 0,
            fase: 'preflop', // preflop, flop, turn, river, showdown
            timer: null
        };

        socket.join(codigoSala);
        io.to(codigoSala).emit('actualizarSalaOnline', {
            codigoSala: codigoSala,
            anfitrion: socket.id,
            jugadores: salas[codigoSala].jugadores.map(j => ({ ...j, esAnfitrion: (j.id === salas[codigoSala].anfitrion) }))
        });
    });

    // 2. Unirse a Sala
    socket.on('unirseSala', (datos) => {
        const sala = salas[datos.codigo];
        if (!sala) return socket.emit('errorSala', 'La sala no existe.');
        if (sala.estadoJuego === 'jugando') return socket.emit('errorSala', 'La partida ya comenzó.');
        if (sala.jugadores.length >= 9) return socket.emit('errorSala', 'La mesa está llena (máximo 9).');

        sala.jugadores.push({ id: socket.id, nombre: datos.nombre, fichas: 10000, listo: false, puntajeGlobal: 0, activo: true, turno: false });
        socket.join(datos.codigo);
        
        io.to(datos.codigo).emit('actualizarSalaOnline', {
            codigoSala: datos.codigo,
            anfitrion: sala.anfitrion,
            jugadores: sala.jugadores.map(j => ({ ...j, esAnfitrion: (j.id === sala.anfitrion) }))
        });
    });

    // 3. Iniciar Partida Online / Nueva Mano
    socket.on('iniciarPartidaOnline', (codigo) => {
        iniciarManoEnServidor(codigo);
    });

    socket.on('siguienteManoOnline', (codigo) => {
        const sala = salas[codigo];
        if (sala) {
            sala.dealerIndex = (sala.dealerIndex + 1) % sala.jugadores.length;
            iniciarManoEnServidor(codigo);
        }
    });

    function iniciarManoEnServidor(codigo) {
        const sala = salas[codigo];
        if (!sala) return;
        
        sala.estadoJuego = 'jugando';
        sala.fase = 'preflop';
        sala.pot = 300; // SB + BB inicial
        sala.apuestaActual = 200; // BB inicial

        // Eliminar jugadores sin fichas y resetear activos
        sala.jugadores.forEach(j => {
            if(j.fichas <= 0) j.activo = false;
            else { j.activo = true; j.listo = false; j.turno = false; }
        });

        // Cobrar ciegas
        let sbIdx = (sala.dealerIndex + 1) % sala.jugadores.length;
        let bbIdx = (sala.dealerIndex + 2) % sala.jugadores.length;
        if(sala.jugadores[sbIdx]) sala.jugadores[sbIdx].fichas -= 100;
        if(sala.jugadores[bbIdx]) sala.jugadores[bbIdx].fichas -= 200;

        // Turno empieza a la izquierda de la BB (UTG)
        sala.turnoIndex = (sala.dealerIndex + 3) % sala.jugadores.length;
        avanzarTurnoPreFlop(codigo);

        io.to(codigo).emit('partidaIniciadaOnline', { 
            dealerIndex: sala.dealerIndex, 
            pot: sala.pot, 
            jugadores: sala.jugadores 
        });
    }

    // Lógica de Pre-Flop: Avanzar Turnos
    function avanzarTurnoPreFlop(codigo) {
        const sala = salas[codigo];
        if(!sala) return;
        clearTimeout(sala.timer);

        // Buscar siguiente jugador activo
        let intentos = 0;
        while (!sala.jugadores[sala.turnoIndex].activo && intentos < sala.jugadores.length) {
            sala.turnoIndex = (sala.turnoIndex + 1) % sala.jugadores.length;
            intentos++;
        }

        // Si ya todos jugaron pre-flop, pasamos a Flop
        let activosSinJugar = sala.jugadores.filter(j => j.activo && !j.listo).length;
        if (activosSinJugar === 0 || intentos >= sala.jugadores.length) {
            return avanzarCalleServidor(codigo, 'flop');
        }

        sala.jugadores.forEach((j, i) => j.turno = (i === sala.turnoIndex));
        
        io.to(codigo).emit('actualizarTurnoPreFlop', {
            jugadores: sala.jugadores,
            turnoDe: sala.jugadores[sala.turnoIndex].id,
            apuestaActual: sala.apuestaActual,
            pot: sala.pot
        });

        // Timer de 10s para pre-flop (Auto-fold)
        sala.timer = setTimeout(() => {
            procesarAccion(codigo, sala.jugadores[sala.turnoIndex].id, 'fold', 0);
        }, 11000); // 11s para dar margen a la red
    }

    // Recibir acción del jugador en Pre-Flop
    socket.on('accionPreFlop', (datos) => {
        procesarAccion(datos.codigo, socket.id, datos.accion, datos.monto);
    });

    function procesarAccion(codigo, idJugador, accion, monto = 0) {
        const sala = salas[codigo];
        if (!sala || sala.fase !== 'preflop') return;
        
        let jugador = sala.jugadores.find(j => j.id === idJugador);
        if(!jugador || !jugador.turno) return;

        jugador.listo = true;
        jugador.turno = false;

        if (accion === 'fold') {
            jugador.activo = false;
        } else if (accion === 'call') {
            let costo = sala.apuestaActual;
            jugador.fichas -= costo;
            sala.pot += costo;
        } else if (accion === 'raise') {
            sala.apuestaActual += monto;
            jugador.fichas -= sala.apuestaActual;
            sala.pot += sala.apuestaActual;
            // Al hacer raise, los demás deben volver a hablar
            sala.jugadores.forEach(j => { if(j.id !== idJugador && j.activo) j.listo = false; });
        }

        sala.turnoIndex = (sala.turnoIndex + 1) % sala.jugadores.length;
        avanzarTurnoPreFlop(codigo);
    }

    // Avanzar calles (Flop, Turn, River) con timers de 20s + 20s
    function avanzarCalleServidor(codigo, faseDestino) {
        const sala = salas[codigo];
        if(!sala) return;
        
        sala.fase = faseDestino;
        sala.jugadores.forEach(j => { if(j.activo) j.listo = false; });
        sala.apuestaActual = 200; // Apuesta estandar post-flop para cálculos

        io.to(codigo).emit('iniciarFaseCalculo', { fase: sala.fase, pot: sala.pot });

        // Timer 1: 20s para calcular
        clearTimeout(sala.timer);
        sala.timer = setTimeout(() => {
            io.to(codigo).emit('iniciarFaseRevision');
            
            // Timer 2: 20s para revisión (Freeze), luego avanza
            sala.timer = setTimeout(() => {
                if(sala.fase === 'flop') avanzarCalleServidor(codigo, 'turn');
                else if(sala.fase === 'turn') avanzarCalleServidor(codigo, 'river');
                else if(sala.fase === 'river') {
                    sala.fase = 'showdown';
                    io.to(codigo).emit('irAShowdown');
                }
            }, 20000);
        }, 20000);
    }

    // Recepción de cálculos (Igual que antes)
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

    // Actualizar pozo tras showdown
    socket.on('repartirPozo', (datos) => {
        const sala = salas[datos.codigo];
        if (sala && sala.anfitrion === socket.id) { // Solo el host manda esta orden
            let ganador = sala.jugadores.find(j => j.id === datos.idGanador);
            if(ganador) ganador.fichas += sala.pot;
            sala.pot = 0;
            io.to(datos.codigo).emit('actualizarStacks', { jugadores: sala.jugadores });
        }
    });

    socket.on('disconnect', () => {
        console.log('Jugador desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Servidor de Poker en puerto ${PORT}`);
});
