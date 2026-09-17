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
            street: 0,
            estadoJuego: 'esperando'
        };

        socket.join(codigoSala);
        
        // Enviamos la lista de jugadores indicando explícitamente quién es anfitrión
        io.to(codigoSala).emit('actualizarSalaOnline', {
            codigoSala: codigoSala,
            jugadores: salas[codigoSala].jugadores.map(j => ({
                ...j,
                esAnfitrion: (j.id === salas[codigoSala].anfitrion)
            })),
            esAnfitrion: true
        });
    });

    // Unirse a Sala (Máximo 9 jugadores)
    socket.on('unirseSala', (datos) => {
        const sala = salas[datos.codigo];
        if (!sala) return socket.emit('errorSala', 'La sala no existe.');
        if (sala.estadoJuego === 'jugando') return socket.emit('errorSala', 'La partida ya comenzó.');
        if (sala.jugadores.length >= 9) return socket.emit('errorSala', 'La mesa está llena (máximo 9 jugadores).');

        sala.jugadores.push({
            id: socket.id,
            nombre: datos.nombre,
            fichas: 10000,
            listo: false,
            puntaje: 0
        });

        socket.join(datos.codigo);
        
        // Actualizamos a todos en la sala enviando correctamente el rol de anfitrión (👑)
        io.to(datos.codigo).emit('actualizarSalaOnline', {
            codigoSala: datos.codigo,
            jugadores: sala.jugadores.map(j => ({
                ...j,
                esAnfitrion: (j.id === sala.anfitrion)
            })),
            esAnfitrion: (socket.id === sala.anfitrion)
        });
    });

    // Iniciar Partida Online (Solo Anfitrión)
    socket.on('iniciarPartidaOnline', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.anfitrion === socket.id) {
            sala.estadoJuego = 'jugando';
            sala.jugadores.forEach(j => j.listo = false);

            // Emitimos a todos que la partida comenzó para que cambien de vista
            io.to(codigo).emit('partidaIniciadaOnline');
        }
    });

    // Avanzar de Calle (Flop -> Turn -> River) por el Anfitrión
    socket.on('avanzarCalleHost', (codigo) => {
        const sala = salas[codigo];
        if (sala && sala.anfitrion === socket.id) {
            io.to(codigo).emit('avanzarSiguienteRonda');
        }
    });

    // Recibir cálculos y difundir al ranking
    socket.on('enviarCalculoOnline', (datos) => {
        const sala = salas[datos.codigo];
        if (sala) {
            let jugador = sala.jugadores.find(j => j.id === socket.id);
            if (jugador) {
                io.to(datos.codigo).emit('resultadoRankingJugador', {
                    nombre: datos.nombre,
                    outs: datos.outs,
                    porcentaje: datos.porcentaje,
                    tiempoSegundos: datos.tiempoSegundos,
                    acierto: datos.acierto
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
