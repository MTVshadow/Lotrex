/*
 * Worker process for libloot on non-Windows platforms.
 *
 * Mirrors node-loot's async.js: the parent owns one end of a socket, this process holds the
 * actual libloot handle, and they exchange JSON messages delimited by ￿. node-loot uses a
 * Windows named pipe; the same net API works over a unix domain socket, so the protocol and
 * framing here are deliberately identical to keep the two implementations comparable.
 *
 * Running libloot out-of-process matters for the same reason it does on Windows: its calls are
 * synchronous and sorting a large load order takes long enough to freeze the UI if done in the
 * renderer.
 */
const net = require("net");
const path = require("path");

const binding = require(path.resolve(__dirname, "libloot-nodejs.js"));

process.on("uncaughtException", (error) => {
  console.error(error.message);
  process.exit(1);
});

const CHUNK_SIZE = 32 * 1024;
const DELIMITER = "￿";

// libloot splits its API across the game handle and its database; the parent addresses both
// through one flat set of method names, so record which object owns each.
const DATABASE_METHODS = new Set([
  "loadMasterlist",
  "loadMasterlistWithPrelude",
  "loadUserlist",
  "writeUserMetadata",
  "clearConditionCache",
  "generalMessages",
  "groups",
  "userGroups",
  "setUserGroups",
  "pluginMetadata",
  "pluginUserMetadata",
  "setPluginUserMetadata",
  "discardPluginUserMetadata",
  "discardAllUserMetadata",
]);

const client = net.connect(process.argv[2], () => {
  let game;
  let database;
  let dataBuffer = "";

  function send(args) {
    const message = JSON.stringify(args) + DELIMITER;
    for (let i = 0; i < message.length; i += CHUNK_SIZE) {
      client.write(message.slice(i, i + CHUNK_SIZE));
    }
  }

  function serializeFile(f) {
    if (!f) return null;
    return {
      name: typeof f.name?.asStr === "function" ? f.name.asStr() : f.name || "",
      displayName: f.displayName || "",
    };
  }

  function serializeMessage(m) {
    if (!m) return null;
    return {
      type: m.messageType,
      content: (m.content || []).map((c) => ({
        text: c.text,
        language: c.language,
      })),
      condition: m.condition || "",
    };
  }

  function serializeTag(t) {
    if (!t) return null;
    return {
      name: t.name,
      isAddition: t.isAddition,
      condition: t.condition || "",
    };
  }

  function serializeCleaningData(c) {
    if (!c) return null;
    return {
      crc: c.crc,
      CRC: c.crc,
      itmCount: c.itmCount,
      deletedReferenceCount: c.deletedReferenceCount,
      deletedNavmeshCount: c.deletedNavmeshCount,
      cleaningUtility: c.cleaningUtility,
      condition: c.condition,
      detail: (c.detail || []).map((d) => ({
        text: d.text,
        language: d.language,
      })),
      info: (c.detail || []).map((d) => ({
        text: d.text,
        language: d.language,
      })),
    };
  }

  function serializePluginMetadata(m) {
    if (!m) return null;
    return {
      name: m.name,
      group: m.group || "",
      messages: (m.messages || []).map(serializeMessage),
      tags: (m.tags || []).map(serializeTag),
      cleanInfo: (m.cleanInfo || []).map(serializeCleaningData),
      dirtyInfo: (m.dirtyInfo || []).map(serializeCleaningData),
      incompatibilities: (m.incompatibilities || []).map(serializeFile),
      requirements: (m.requirements || []).map(serializeFile),
      loadAfterFiles: (m.loadAfterFiles || []).map(serializeFile),
    };
  }

  function serializeGroup(g) {
    if (!g) return null;
    return {
      name: g.name,
      description: g.description || "",
      afterGroups: g.afterGroups || [],
    };
  }

  function serializePlugin(p) {
    if (!p) return null;
    return {
      name: p.name(),
      version: p.version() || "",
      masters: p.masters() || [],
      bashTags: p.bashTags() || [],
      crc: p.crc(),
      isMaster: p.isMaster(),
      isLightPlugin: p.isLightPlugin(),
      isValidAsLightPlugin: p.isValidAsLightPlugin(),
      isMediumPlugin: p.isMediumPlugin(),
      isValidAsMediumPlugin: p.isValidAsMediumPlugin(),
      isUpdatePlugin: p.isUpdatePlugin(),
      isValidAsUpdatePlugin: p.isValidAsUpdatePlugin(),
      isEmpty: p.isEmpty(),
      loadsArchive: p.loadsArchive(),
    };
  }

  function handleEvent(event) {
    let result;
    try {
      if (event.type === "init") {
        const [gameType, gamePath, localPath] = event.args;
        game = new binding.Game(gameType, gamePath, localPath);
        database = game.database();
      } else if (event.type === "terminate") {
        send({});
        process.exit(0);
      } else if (event.type === "plugin") {
        result = serializePlugin(game.plugin(...event.args));
      } else if (event.type === "pluginMetadata") {
        result = serializePluginMetadata(database.pluginMetadata(...event.args));
      } else if (event.type === "pluginUserMetadata") {
        result = serializePluginMetadata(database.pluginUserMetadata(...event.args));
      } else if (event.type === "generalMessages") {
        result = (database.generalMessages(...event.args) || []).map(serializeMessage);
      } else if (event.type === "groups") {
        result = (database.groups(...event.args) || []).map(serializeGroup);
      } else if (event.type === "userGroups") {
        result = (database.userGroups(...event.args) || []).map(serializeGroup);
      } else if (DATABASE_METHODS.has(event.type)) {
        result = database[event.type](...event.args);
      } else {
        result = game[event.type](...event.args);
      }
      send({ result });
    } catch (error) {
      send({ error: error.message });
    }
  }

  client.on("data", (buffer) => {
    dataBuffer += buffer.toString();
    const messages = dataBuffer.split(DELIMITER);
    if (!dataBuffer.endsWith(DELIMITER)) {
      dataBuffer = messages.pop();
    } else {
      dataBuffer = "";
    }
    for (const msg of messages) {
      if (msg.length > 0) {
        handleEvent(JSON.parse(msg));
      }
    }
  });

  // signal readiness, exactly as node-loot's worker does
  send({ result: null });
});
