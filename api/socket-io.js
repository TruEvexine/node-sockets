const { createChatServer } = require("../server");

const { server } = createChatServer({
    serveStatic: false,
    socketPath: "/api/socket-io/socket.io"
});

module.exports = server;
