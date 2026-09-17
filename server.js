const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));
app.use(express.static(__dirname + '/public'));

const salas = {};

function generarMazo() {
    const palos = ['♥', '♦', '♣', '♠'];
    const valores = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
    let mazo = [];
    for (let p of palos) {
        for (let v of valores) {
            let valNum = v === 'T' ? 10 : v === 'J' ? 11 : v === 'Q' ? 12 : v === 'K' ? 13 : v === 'A' ? 14 : parseInt(v);
            mazo.push({ v: v, val: valNum, p: p, c: (p === '♥' || p === '♦') ? 'red' : 'black' });
        }
    }
    return mazo.sort(() => Math.random() - 0.5);
}

io.on('connection', (socket) => {
    console.log('Jugador conectado:', socket.id);

    // Crear Sala
    socket.on('crearSala', (datos) => {
        const codigoSala = Math.random().toString(36).substring(2, 6).toUpperCase();
        
        salas[codigoSala] = {
            anfitrion: socket.id,
            jugadores: [
                { id: socket.id, nombre: datos.nombre, fichas: 10000, listo: false, puntaje: 0 }
            ],
            mazo: [],
            mesa: [],
            street: 0, // 0: Pre-flop, 1: Flop, 2: Turn, 3: River
            estadoJuego: 'esperando'
        };

        socket.join(codigoSala);
        socket.emit('actualizarSalaOnline', {
            codigoSala: codigoSala,
            jugadores: salas[codigoSala].jugadores,
            esAnfitrion: true
        });
    });

    // Unirse a Sala
    socket.on('unirseSala', (datos) => {
        const sala = salas[datos.codigo];
        if (!sala) return socket.emit('errorSala', 'La sala no existe.');
        if (sala.estadoJuego === 'jugando') return socket.emit('errorSala', 'La partida ya comenzó.');
        if (sala.jugadores.length >= 6) return socket.emit('errorSala', 'La mesa está llena.');

        sala.jugadores.push({
            id: socket.id,
            nombre: datos.nombre,
            fichas: 10000,
            listo: false,
            puntaje: 0
        });

        socket.join(datos.codigo);
        io.to(datos.codigo).emit('actualizarSalaOnline', {
            codigoSala: datos.codigo,
            jugadores: sala.jugadores,
            esAnfitrion: false
        });
    });

    // Iniciar Partida / Siguiente Mano (Solo Anfitrión)
    socket.on('iniciarPartidaOnline', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.anfitrion === socket.id) {
            sala.estadoJuego = 'jugando';
            sala.mazo = generarMazo();
            sala.mesa = [sala.mazo.pop(), sala.mazo.pop(), sala.mazo.pop(), sala.mazo.pop(), sala.mazo.pop()]; // Flop, Turn, River
            sala.street = 1; // Arranca en Flop para calcular
            sala.jugadores.forEach(j => j.listo = false);

            io.to(codigo).emit('sincronizarMano', {
                mesaCompleta: sala.mesa,
                street: sala.street,
                jugadores: sala.jugadores
            });
        }
    });

    // Avanzar de Calle (Flop -> Turn -> River) por el Anfitrión
    socket.on('avanzarCalleHost', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.anfitrion === socket.id) {
            sala.street++;
            io.to(codigo).emit('sincronizarCalle', { street: sala.street });
        }
    });

    // Recibir cálculos, calificar puntaje (+100 / -50) y difundir al ranking
    socket.on('enviarCalculoOnline', (datos) => {
        const sala = salas[datos.codigo];
        if (sala) {
            let jugador = sala.jugadores.find(j => j.id === socket.id);
            if (jugador) {
                // Calcular puntos según aciertos
                let puntosGanados = 0;
                if (datos.aciertaOuts) puntosGanados += 100; else puntosGanados -= 50;
                if (datos.aciertaProb) puntosGanados += 100; else puntosGanados -= 50;
                if (datos.aciertaOdds) puntosGanados += 100; else puntosGanados -= 50;
                
                jugador.puntaje += puntosGanados;

                io.to(datos.codigo).emit('actualizarRankingGlobal', {
                    nombre: datos.nombre,
                    outs: datos.outs,
                    porcentaje: datos.porcentaje,
                    potOdds: datos.potOdds,
                    tiempoSegundos: datos.tiempoSegundos,
                    puntosNuevos: puntosGanados,
                    puntajeTotal: jugador.puntaje
                });
            }
        }
    });

    // Marcar Listo para avanzar de ronda
    socket.on('jugadorListo', (datos) => {
        const sala = salas[datos.codigo];
        if (sala) {
            let jugador = sala.jugadores.find(j => j.id === socket.id);
            if (jugador) jugador.listo = true;

            // Enviar lista actualizada de quiénes están listos al anfitrión
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
