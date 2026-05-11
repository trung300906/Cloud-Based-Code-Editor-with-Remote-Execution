const users = require("../users");
const { joinRoom } = require("../roomManager");

function handleAuth(data, socket) {
    const { username, password } = data;

    // ❌ thiếu dữ liệu
    if (!username || !password) {
        socket.write("❌ Missing username or password\n");
        return;
    }

    // 🔍 tìm user
    const user = users.find(
        (u) => u.username === username && u.password === password
    );

    // ❌ sai tài khoản
    if (!user) {
        socket.write("❌ Invalid credentials\n");
        return;
    }

    // ✅ login thành công
    socket.user = {
        username: user.username
    };

    // join room
    joinRoom("room1", socket);

    socket.write("✅ AUTH SUCCESS\n");
}

module.exports = handleAuth;

