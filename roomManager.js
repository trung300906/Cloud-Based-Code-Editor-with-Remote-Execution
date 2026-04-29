const rooms = {};

function joinRoom(roomId, socket) {
    if (!rooms[roomId]) rooms[roomId] = [];

    rooms[roomId].push(socket);
    socket.roomId = roomId;

    console.log("JOIN ROOM:", roomId, rooms[roomId].length);
}

function broadcast(roomId, data, sender) {
    const clients = rooms[roomId] || [];

    console.log("BROADCAST TO:", clients.length);
    console.log("ROOM:", roomId);
    console.log("CLIENTS:", clients.length);

    clients.forEach((client) => {
        console.log("SEND TO:", index);
        
        if (client !== sender) {
            client.write(data);
        }
    });
}

module.exports = { joinRoom, broadcast };