const { exec } = require("child_process");

function handleRun(data, socket) {
    console.log("RUN:", data);

    const code = data.code;

    // ví dụ chạy Python
    exec(`python -c "${code}"`, (err, stdout, stderr) => {
        if (err) {
            socket.write("Error: " + stderr + "\n");
            return;
        }

        socket.write("Output:\n" + stdout + "\n");
    });
}

module.exports = handleRun;