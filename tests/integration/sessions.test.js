/**
 * Smoke: session revocation — logout, password change/reset, refresh token rotation and reuse.
 */
const { startServer, client, createUser, connectSocket, PASSWORD } = require("./helpers");
const notificationService = require("../../src/services/notificationService");

let server;
let api;

beforeAll(async () => {
  server = await startServer();
  api = client(server.url);
});
afterAll(() => server.close());

const signIn = async (email, password = PASSWORD) => (await api.post("/auth/login", { email, password })).body;
const me = (token) => api.get("/users/me", { token });

test("logout revokes the session's access and refresh tokens immediately", async () => {
  const user = await createUser();
  const { accessToken, refreshToken } = await signIn(user.email);
  expect((await me(accessToken)).status).toBe(200);

  expect((await api.post("/auth/logout", undefined, { token: accessToken })).status).toBe(200);

  expect((await me(accessToken)).status).toBe(401);
  expect((await api.post("/auth/refresh", { refreshToken })).status).toBe(401);
});

test("logout only affects the device that logged out", async () => {
  const user = await createUser();
  const phone = await signIn(user.email);
  const laptop = await signIn(user.email);

  await api.post("/auth/logout", undefined, { token: phone.accessToken });
  expect((await me(laptop.accessToken)).status).toBe(200);
});

test("changing password signs out other devices but keeps this one", async () => {
  const user = await createUser();
  const current = await signIn(user.email);
  const other = await signIn(user.email);

  const res = await api.post("/auth/change-password", { currentPassword: PASSWORD, newPassword: "Changed123" }, { token: current.accessToken });
  expect(res.status).toBe(200);

  expect((await me(current.accessToken)).status).toBe(200);
  expect((await api.post("/auth/refresh", { refreshToken: current.refreshToken })).status).toBe(200);
  expect((await me(other.accessToken)).status).toBe(401);
  expect((await api.post("/auth/refresh", { refreshToken: other.refreshToken })).status).toBe(401);
});

test("password reset signs out every device", async () => {
  const user = await createUser();
  const session = await signIn(user.email);
  const spy = jest.spyOn(notificationService, "sendAccountEmail");

  await api.post("/auth/password-reset/request", { email: user.email });
  const token = new URL(spy.mock.calls.at(-1)[1].actionUrl).searchParams.get("token");
  expect((await api.post("/auth/password-reset", { token, newPassword: "ResetPass9" })).status).toBe(200);

  expect((await me(session.accessToken)).status).toBe(401);
  expect((await api.post("/auth/refresh", { refreshToken: session.refreshToken })).status).toBe(401);
  spy.mockRestore();
});

test("refresh tokens rotate, and reusing an old one revokes the session", async () => {
  const user = await createUser();
  const first = await signIn(user.email);

  const second = (await api.post("/auth/refresh", { refreshToken: first.refreshToken })).body;
  expect(second.refreshToken).not.toBe(first.refreshToken);
  expect((await me(second.accessToken)).status).toBe(200);

  // Replaying the used token (e.g. a stolen copy) kills the whole session
  expect((await api.post("/auth/refresh", { refreshToken: first.refreshToken })).status).toBe(401);
  expect((await me(second.accessToken)).status).toBe(401);
  expect((await api.post("/auth/refresh", { refreshToken: second.refreshToken })).status).toBe(401);
});

test("sockets reject access tokens from a revoked session", async () => {
  const { accessToken } = await signIn("player3@test.com");
  const socket = await connectSocket(server.url, accessToken);
  socket.close();

  await api.post("/auth/logout", undefined, { token: accessToken });
  await expect(connectSocket(server.url, accessToken)).rejects.toThrow();
});
