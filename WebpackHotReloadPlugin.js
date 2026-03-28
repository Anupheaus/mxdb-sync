const InjectPlugin = require('webpack-inject-plugin').default;
// const { writeFileSync } = require('fs');
const { createServer } = require('http');
// const { Cert } = require('selfsigned-ca');
// const path = require('path');
const ws = require('ws');

module.exports = class HotReloadPlugin {
  constructor(config) {
    const envPort = Number(process.env.HOT_RELOAD_PORT);
    this.#config = { port: Number.isFinite(envPort) && envPort > 0 ? envPort : 3090, ...config };
    this.#clearLog();
    this.#clients = new Set();
    this.#startListener();
  }

  #config = null;
  #clients = null;

  /** @type WebSocket */
  #socket = null;

  #createClientCode() {
    const { port } = this.#config;
    return () => `
      let connectToHotReloadPluginTimerId;
      function connectToHotReloadPlugin() {
        const ws=new WebSocket('ws://localhost:${port}');
        ws.onerror = () => ws.close();
        ws.onmessage = () => setTimeout(() => location.reload(), 1000);
        ws.onclose = () => { connectToHotReloadPluginTimerId = setTimeout(connectToHotReloadPlugin, 10000); };
        ws.onopen = () => clearInterval(connectToHotReloadPluginTimerId);
      }
      connectToHotReloadPlugin();
    `;
  }

  async #startListener() {
    try {

      const basePort = this.#config.port;
      // const certsPath = path.resolve(__dirname, './certs/server').replace(/\\/g, '/');
      this.#log('Starting listener', { port: basePort });
      // const serverCert = new Cert(certsPath);
      // this.#log('Loading SSL certificate...', { certsPath });
      // await serverCert.load();
      // this.#log('Loaded SSL certificate, creating server...');
      const server = createServer({
        // key: serverCert.key,
        // cert: serverCert.cert,
        // ca: serverCert.caCert,
        rejectUnauthorized: false,
        requestCert: false,
      });

      const listen = (port) => new Promise((resolve, reject) => {
        const onError = (err) => {
          server.off('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port);
      });

      let chosenPort = basePort;
      for (let p = basePort; p < basePort + 25; p++) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await listen(p);
          chosenPort = p;
          break;
        } catch (err) {
          if (err?.code === 'EADDRINUSE') continue;
          throw err;
        }
      }

      this.#config.port = chosenPort;
      this.#log('Server started, starting websocket...');
      this.#socket = new ws.Server({ host: 'localhost', path: '/', server });
      this.#log('Websocket started, adding event handlers...');
      this.#socket.on('connection', client => {
        this.#log('Client connected');
        this.#clients.add(client);
        client.on('close', () => {
          this.#log('Client disconnected');
          this.#clients.delete(client);
        });
      });
      this.#log('Event handlers added, all done.');
    } catch (e) {
      this.#log('Error occurred!', { error: e });
    }
  }

  #clearLog() {
    // writeFileSync(path.resolve(__dirname, './WebpackHotReloadPlugin.log'), '', { flag: 'w' });
  }

  #log(message, data) {
    if (data != null) message = `${message}\n${JSON.stringify(data, null, 2)}`;
    // writeFileSync(path.resolve(__dirname, './WebpackHotReloadPlugin.log'), `${message}\n`, { flag: 'a' });
  }

  apply(compiler) {
    new InjectPlugin(this.#createClientCode()).apply(compiler);
    compiler.hooks.afterEmit.tap('HotReloadPlugin', () => {
      this.#clients.forEach(client => client.send('reload'));
    });
  }

};
