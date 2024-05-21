require("dotenv").config()

const
_ = require("lodash"),
http = require("http"),
{ join, basename } = require("path"),
{ Server } = require("socket.io"),
{ FSDB } = require("file-system-db"),
{ onExit } = require("gracy"),
express = require("express"),
clc = require("cli-color")

let clients = 0
const app = express()
const server = require("http").createServer(app)
const websock = new (require("socket.io")).Server(server)

// Prepare JSON file handlers for settings and such

const settingsVersion = 1
const defaults = {
  version: settingsVersion,
  chat: {
    historySize: 50,
    theme: "Plain.css",
  },
  platforms: {
    youtube: {channel: ""},
    twitch: {channel: ""},
    picarto: {channel: "", tokenAdded: !!process.env.picarto},
    discord: {channel: "", tokenAdded: !!process.env.discord},
  },
  port: 1151
}

const settings = new FSDB("./settings.json", false)
// settings.backup("./settings-backup.json")
settings.set("version", settingsVersion)

const history = new FSDB("./history.json", true)
const userCache = new FSDB("./userCache.json", true)

/* let darkMode = false // Default to light mode */


/* ======== Websockets (talking to the browser) ======== */

websock.on("connection", (socket) => {
    debug(`A web client connected     (${++clients} clients active)`)
  socket.on("disconnect", () => {
    debug(`A web client disconnected  (${--clients} clients active)`)
  })

  socket.on("getSettings", () => {
    const currentSettings = _.defaultsDeep(dbAsObject(settings), defaults)
    // debug(currentSettings)
    socket.emit("settings", currentSettings)
  })

  socket.on("saveSettings", newSett => {
    try {
      settings.set("version", settingsVersion)
      if (newSett?.platforms) settings.set("platforms", newSett.platforms)
      if (newSett?.chat) settings.set("chat", newSett.chat)
    } catch (err) { error(err) }
  })

  socket.on("getThemes", () => socket.emit("themeList", getThemes()))

  socket.on("themeChange", newTheme => {
    websock.emit("themeChange", newTheme)
    settings.set("chat.theme", newTheme)
  })

  /* // Send current time every second
  setInterval(() => {
    socket.emit("time", new Date().toLocaleTimeString())
  }, 1000)

  // Handle dark mode setting changes
  socket.on("darkModeChange", (newMode) => {
    darkMode = newMode
    socket.emit("darkModeChanged", darkMode)
  })

  // Send initial dark mode setting
  socket.emit("darkModeChanged", darkMode) */
})

/* ======== Web server stuff ======== */

/** @type {{endpoint: string, path: string}[]} */

const routes = [
  { endpoint: "/themes", path: "./themes/" },
  { endpoint: "/pico", path: "./node_modules/@picocss/pico/css/" },
  { endpoint: "/sort", path: "./node_modules/sortablejs/" },
  { endpoint: "/",     path: "./html" },
]

routes.forEach(route => app.use(route.endpoint,
  express.static( require("path").join(__dirname, route.path) ),
  require("serve-index")(route.path, {icons: true, hidden: false})
))

startServer()
async function startServer() {
  const port = await getPort(settings.get("port") ?? defaults.port)
  server.listen(port, () => {
    const ip = getLocalInterface()?.address ?? "127.0.0.1"
    info("Server is running on " + clc.underline(`http://${ip}:${port}`))
  })
}

/* ======== Generic message handling ======== */

/**
 * @typedef {{
 *  owner?: boolean,
 *  moderator?: boolean,
 *  member?: boolean,
 *  subscribed?: boolean,
 *  verified?: boolean,
 *  new?: boolean,
 * }} ChatStatus
 * 
 * @typedef {{
 *  nickname: string,
 *  avatarURL?: string,
 *  color?: string,
 *  id?: string,
 *  statusFlags?: ChatStatus
 * }} ChatPerson
 * 
 * @typedef {{
 *  id: string,
 *  platform: "youtube"|"twitch"|"picarto"|"discord"
 *  timestamp: Date,
 *  contents: string,
 *  author: ChatPerson,
 * }} ChatMessage
 */

/** @param {ChatMessage} message  */
function sendMessage(message) {
  websock.emit("newMessage", message)
}

/** @param {ChatMessage} message  */
function cacheUser(message) {
  const user = message.author
  const id = user.id ?? (message.platform + "-" + user.nickname)
  userCache.set(id, user)
  return user
}

/* ======== YouTube ======== */



/* ======== Graceful exit ======== */

require("gracy").onExit(async function() {
  server.close(() => debug("Closing server"))
}, {logLevel: "error"})

/* ======== Helper functions ======== */

function info(message="") { console.info(clc.whiteBright(message)) }
function warn(message="") { console.warn(clc.yellow(message)) }
function error(message="") { console.error(clc.red(message)) }
function debug(message="") { console.debug(clc.blackBright(message)) }


async function getPort(portNumber=3000) {
  const port = await (await import("get-port")).default({port: _.range(portNumber, portNumber+99)})
  if (port != portNumber) warn(`Port ${portNumber} is blocked, using next free port (${port})`)
  return port
}

/** @param {FSDB} db  */
function dbAsObject(db) {
  return Object.fromEntries( db.getAll(false).map(x => [x.key, x.value]) )
}

// https://stackoverflow.com/a/31003950/11933690
function getLocalInterface() {
  const interfaces = require("os").networkInterfaces()
  return _.find(_.flatMap(interfaces), {family: 'IPv4', internal: false})
}

/** @param {string} input */
function stripFileExt(input) { return input.substring(0, input.lastIndexOf('.')) || input }

function getThemes() {
  // I'm sure we could get fancier with Object.groupBy()
  // but it's really not needed here, it's simple stuff!
  try {
    const files = require("fs").readdirSync("./themes")

    const styles = files.filter(filename => filename.toLowerCase().endsWith(".css"))
      .map(filename => stripFileExt(filename))

    const templates = files.filter(filename => filename.match(/\.html?$/i))
      .map(filename => stripFileExt(filename))

    return _.intersection(styles, templates)

  } catch (err) { error(err) }

  // Fallback to included theme
  return ["Plain"]
}
