const Docker = require('dockerode');
const tar = require('tar-stream');
const { Readable } = require('stream');
const { Demuxer } = require('docker-modem/lib/modem');

class DockerRunner {
  constructor(options = {}) {
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    
    this.image = options.image || 'node:22-alpine';
    this.timeout = options.timeout || 10000;
    this.memoryLimit = options.memoryLimit || '100m';
    this.cpuLimit = options.cpuLimit || 0.5;
    this.tmpfsSize = options.tmpfsSize || '32m';

    // Đảm bảo image đã được pull trước khi dùng
    this._ensureImage();
  }

  /**
   * Kiểm tra và pull image nếu chưa có local
   * @private
   */
  async _ensureImage() {
    try {
      await this.docker.getImage(this.image).inspect();
      console.log(`Image ${this.image} already exists locally.`);
    } catch (err) {
      if (err.statusCode === 404) {
        console.log(`Image ${this.image} not found. Pulling...`);
        await this._pullImage();
      } else {
        throw err;
      }
    }
  }

  async _pullImage() {
    return new Promise((resolve, reject) => {
      this.docker.pull(this.image, (err, stream) => {
        if (err) return reject(err);
        this.docker.modem.followProgress(stream, (err, output) => {
          if (err) return reject(err);
          console.log(`Image ${this.image} pulled successfully.`);
          resolve();
        });
      });
    });
  }

  async run(code, language = 'javascript') {
    // Đảm bảo image đã sẵn sàng trước khi chạy
    await this._ensureImage();

    let cmd;
    if (language === 'python') {
      cmd = ['python3', '/workspace/main.py'];
      // Nếu image mặc định không phải Python, cần thay đổi image cho phù hợp
      if (this.image === 'node:22-alpine') {
        this.image = 'python:3.12-alpine';
        await this._ensureImage();
      }
    } else {
      cmd = ['node', '/workspace/main.js'];
    }

    const container = await this.docker.createContainer({
      Image: this.image,
      Cmd: cmd,
      WorkingDir: '/workspace',
      AttachStdout: true,
      AttachStderr: true,
      OpenStdin: false,
      Tty: false,
      HostConfig: {
        Memory: this.memoryLimit ? parseInt(this.memoryLimit) * 1024 * 1024 : 0,
        NanoCpus: this.cpuLimit * 1e9,
        ReadonlyRootfs: true,
        Tmpfs: {
          '/workspace': `rw,noexec,nosuid,size=${this.tmpfsSize}`
        },
        AutoRemove: true,
        NetworkMode: 'none'
      }
    });

    const tarStream = this._createTarStream(code, language);
    await container.putArchive(tarStream, { path: '/workspace' });

    await container.start();

    const stream = await container.attach({
      stream: true,
      stdout: true,
      stderr: true
    });

    const timeoutId = setTimeout(async () => {
      try {
        await container.kill();
      } catch (e) {}
    }, this.timeout);

    container.wait().then(() => clearTimeout(timeoutId)).catch(() => {});

    return this._createLineStream(stream);
  }

  _createTarStream(code, language) {
    const pack = tar.pack();
    const filename = (language === 'python') ? 'main.py' : 'main.js';
    pack.entry({ name: filename }, code, (err) => {
      if (err) throw err;
      pack.finalize();
    });
    return pack;
  }

  _createLineStream(dockerStream) {
    const lineStream = new Readable({ read() {} });
    const demuxer = new Demuxer();
    
    dockerStream.pipe(demuxer);
    
    demuxer.on('stdout', (data) => {
      this._pushLines(lineStream, data.toString());
    });
    demuxer.on('stderr', (data) => {
      this._pushLines(lineStream, data.toString());
    });
    
    dockerStream.on('end', () => {
      lineStream.push(null);
    });
    
    dockerStream.on('error', (err) => {
      lineStream.destroy(err);
    });

    return lineStream;
  }

  _pushLines(lineStream, text) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] !== '') lineStream.push(lines[i]);
    }
  }
}

module.exports = DockerRunner;