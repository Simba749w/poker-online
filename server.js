const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));
app.use(express.static(__dirname + '/public'));

const salas = {};

// ==========================================
// FUNCIÓN CLAVE: Verificar si todos están listos
// ==========================================
function verificarTodosListos(sala, codigoSala) {
    // Filtramos solo a los jugadores que siguen en la mano (no foldearon)
    const jugadoresActivos = sala.jugadores.filter(j => j.activo);
    
    // Verificamos si TODOS los activos están listos
    const todosListos = jugadoresActivos.length > 0 && jugadoresActivos.every(j => j.listo);
    
    // Le mandamos a todos la actualización de quién falta
    io.to(codigoSala).emit('estadoListosActualizado', { jugadores: sala.jugadores });

    if (todosListos) {
        // Reseteamos el estado de "listo" para la siguiente fase
        sala.jugadores.forEach(j => j.listo = false);
        
        // Le avisamos a todos los clientes que salten la fase automáticamente
        io.to(codigoSala).emit('todosListosAvanzarFase');
    }
}

io.on('connection', (socket) => {
    console.log('Jugador conectado:', socket.id);

    // 1. Crear Sala
    socket.on('crearSala', (datos) => {
        const codigoSala = Math.random().toString(36).substring(2, 6).toUpperCase();
        salas[codigoSala] = {
            anfitrion: socket.id,
            jugadores: [{ id: socket.id, nombre: datos.nombre, fichas: 10000, listo: false, puntajeGlobal: 0, activo: true }],
            estadoJuego: 'esperando',
            dealerIndex: 0
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

    // 4. Avanzar Calle Manual (Por si el Host quiere forzarlo)
    socket.on('avanzarCalleHost', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.anfitrion === socket.id) {
            sala.jugadores.forEach(j => j.listo = false);
            io.to(codigo).emit('avanzarSiguienteRonda'); // Avanza Flop, Turn, River
        }
    });

    // 4.b Iniciar NUEVA Mano (Acá rota el Dealer)
    socket.on('siguienteManoOnline', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.anfitrion === socket.id) {
            sala.dealerIndex = (sala.dealerIndex + 1) % sala.jugadores.length; // ROTACIÓN CORRECTA
            sala.jugadores.forEach(j => { j.listo = false; j.activo = true; });
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

    // 6. Marcar Listo / Fold (Acciones de toma de decisión)
    socket.on('jugadorListo', (datos) => {
        const sala = salas[datos.codigo];
        if (sala) {
            let jugador = sala.jugadores.find(j => j.id === socket.id);
            if (jugador) {
                jugador.listo = true;
                if(datos.accion === 'fold') jugador.activo = false; // Se tira, no estorba más en la mano
            }
            verificarTodosListos(sala, datos.codigo);
        }
    });

    // 7. Saltear Fase de Revisión (NUEVO)
    socket.on('jugadorListoFase', (datos) => {
        const sala = salas[datos.codigo];
        if (sala) {
            let jugador = sala.jugadores.find(j => j.id === socket.id);
            if (jugador) {
                jugador.listo = true;
            }
            verificarTodosListos(sala, datos.codigo);
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
