/**
 * Helpers for API smoke tests: an in-process HTTP + Socket.io server and a small fetch client.
 */
const http = require("http");
const bcrypt = require("bcryptjs");
const { io: ioClient } = require("socket.io-client");

const app = require("../../src/app");
const prisma = require("../../src/config/database");
const { initSocketServer } = require("../../src/config/socketServer");

const PASSWORD = "TestPass1";

async function startServer() {
  const httpServer = http.createServer(app);
  const io = initSocketServer(httpServer);
  app.set("io", io);
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${httpServer.address().port}`;

  return {
    url,
    close: () => new Promise((resolve) => {
      io.close();
      httpServer.closeAllConnections();
      httpServer.close(() => resolve());
    }),
  };
}

/** Minimal JSON client: returns { status, body } and never throws on HTTP errors. */
function client(baseUrl) {
  async function request(method, path, { body, token, headers = {} } = {}) {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: res.status, body: parsed };
  }

  const api = {
    get: (path, opts) => request("GET", path, opts),
    post: (path, body, opts = {}) => request("POST", path, { ...opts, body }),
    patch: (path, body, opts = {}) => request("PATCH", path, { ...opts, body }),
    delete: (path, opts) => request("DELETE", path, opts),

    async login(email, password = PASSWORD) {
      const res = await api.post("/auth/login", { email, password });
      if (res.status !== 200) throw new Error(`login ${email} → ${res.status} ${JSON.stringify(res.body)}`);
      return res.body.accessToken;
    },
  };
  return api;
}

let counter = 0;
/** Create a user directly in the database (unique email), defaulting to a fully verified free user. */
async function createUser({ emailVerified = true, ageVerified = true, tier = "FREE", name } = {}) {
  counter += 1;
  const email = `smoke${Date.now()}${counter}@test.com`;
  const user = await prisma.user.create({
    data: {
      email,
      displayName: name || `Smoke ${counter}`,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      authProvider: "EMAIL",
      emailVerified,
      emailVerifiedAt: emailVerified ? new Date() : null,
      ageVerified,
      ageVerifiedAt: ageVerified ? new Date() : null,
      subscriptionTier: tier,
    },
  });
  return { ...user, password: PASSWORD };
}

/** Connect an authenticated socket and wait for the handshake. */
function connectSocket(url, token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, { auth: { token }, transports: ["websocket"], reconnection: false });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

/** Emit with an ack, rejecting on { success: false }. */
function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(10000).emit(event, payload, (err, res) => {
      if (err) reject(err);
      else if (res?.success === false) reject(new Error(res.error));
      else resolve(res);
    });
  });
}

/** Resolve with the next event matching the predicate. */
function nextEvent(socket, event, predicate = () => true, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    function handler(data) {
      if (!predicate(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    }
    socket.on(event, handler);
  });
}

module.exports = { startServer, client, createUser, connectSocket, emitAck, nextEvent, prisma, PASSWORD };
