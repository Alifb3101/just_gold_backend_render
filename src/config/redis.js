let clientPromise = null;
let clientInstance = null;
let initializationFailed = false;
let errorLogged = false;

const connect = async () => {
  if (clientPromise || initializationFailed) return clientPromise;

  try {
    const { createClient } = require("redis");
    const client = createClient({
      url: process.env.REDIS_URL || "redis://localhost:6379",
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: false,  // Don't reconnect, just fail fast
      },
    });

    client.on("error", (err) => {
      initializationFailed = true;
      if (!errorLogged) {
        console.warn("[REDIS] Connection failed, caching disabled");
        errorLogged = true;
      }
    });

    clientPromise = Promise.race([
      client.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis timeout')), 1500)
      )
    ]).then(() => {
      clientInstance = client;
      console.log("[REDIS] ✅ Connected");
      return clientInstance;
    }).catch(err => {
      initializationFailed = true;
      if (!errorLogged) {
        console.warn("[REDIS] Connection failed:", err.message);
        errorLogged = true;
      }
      return null;
    });
  } catch (err) {
    initializationFailed = true;
    if (!errorLogged) {
      console.warn("[REDIS] Initialization failed:", err.message);
      errorLogged = true;
    }
    clientPromise = Promise.resolve(null);
  }

  return clientPromise;
};

const getRedisClient = async () => {
  if (clientInstance) return clientInstance;
  if (initializationFailed) return null;
  return connect();
};

module.exports = { getRedisClient };
