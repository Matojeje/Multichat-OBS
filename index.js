require("dotenv").config()

const
_ = require("lodash"),
xss = require("xss"),
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
  server: {
    port: 1151,
    autoconnect: false,
  },
}

const settings = new FSDB("./settings.json", false)
// settings.backup("./settings-backup.json")
settings.set("version", settingsVersion)

const history = new FSDB("./history.json", true)
history.set("version", settingsVersion)
if (!history.has("msg")) history.set("msg", [])

const userCache = new FSDB("./userCache.json", true)

// State management

/**
 * @typedef {"youtube"|"twitch"|"picarto"|"discord"} Platform
 * @enum {number} ConnState
 */
const ConnStates = {
  "disconnected":   0,
  "connecting":     1,
  "connected":      2,
  "disconnecting":  3,
}

/** @typedef {object}
 * @property {number} youtube
 * @property {number} twitch
 * @property {number} picarto
 * @property {number} discord
 */
let connectState = {
  youtube: ConnStates.disconnected,
  twitch:  ConnStates.disconnected,
  picarto: ConnStates.disconnected,
  discord: ConnStates.disconnected
}

/* ======== Websockets (talking to the browser) ======== */

websock.on("connection", (socket) => {
    debug(`A web client connected     (${++clients} clients active)`)
  socket.on("disconnect", () => {
    debug(`A web client disconnected  (${--clients} clients active)`)
  })

  socket.emit("connectChange", connectState) // Hacky!

  socket.on("getSettings", () => {
    const currentSettings = _.defaultsDeep(dbAsObject(settings), defaults)
    // debug(currentSettings)
    socket.emit("settings", currentSettings)
  })

  socket.on("saveSettings", newSett => {
    try {
      settings.set("version", settingsVersion)
      if (newSett?.platforms) settings.set("platforms", newSett.platforms)
      if (newSett?.server) settings.set("server", newSett.server)
      if (newSett?.chat) settings.set("chat", newSett.chat)
      websock.emit("saveSuccessful")
    } catch (err) { error(err) }
  })

  socket.on("getThemes", () => socket.emit("themeList", getThemes()))

  socket.on("themeChange", newTheme => {
    websock.emit("themeChange", newTheme)
    settings.set("chat.theme", newTheme)
  })

  socket.on("pleaseConnect", ({platform, channel}) => {
    debug(`Trying to connect to ${platform} channel ${channel}`)

    const key = `platforms.${platform}.channel`
    const savedChannel = settings.get(key)
    const state = connectState[platform]

    if (channel != settings.get(key)) {
      warn("Input channel different from saved, saving the new channel")
      settings.set(key, channel)
    }

    /*
    if (state === ConnStates.connected) {
      debug("Already connected, disconnecting from " + savedChannel)
      switch (platform) {
        case "youtube":
          youtube.disconnect(savedChannel)
          break
      
        default:
          warn("Unknown platform " + platform)
          break
      }
    }
    */

    changeConnectState(platform, ConnStates.connecting)
    connectChat(platform, channel)
  })

  socket.on("pleaseDisconnect", async ({platform, channel}) => {
    debug(`Trying to disconnect from ${platform} channel ${channel}`)
    changeConnectState(platform, ConnStates.disconnecting)
    disconnectChat(platform, channel)
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


/** @param {"chat"|"settings"|"both"} destination */
function sendAlert(destination, message="") {
  websock.emit("alert", { message, destination })
  warn(message)
}

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
  const port = await getPort(settings.get("server.port") ?? defaults.server.port)
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
 *  platform: Platform,
 *  timestamp: Date,
 *  contents: string,
 *  author: ChatPerson,
 * }} ChatMessage
 */

/** @param {ChatMessage} message  */
function addMessage(message) {

  // Send to chat window
  websock.emit("newMessage", message)

  // Add to message history
  history.push("msg", message)

  // Trim message history
  // TODO: Inspect possible race conditions here
  /** @type {ChatMessage[]} */
  const newHist = history.get("msg")
  const maxSize = settings.get("chat.historySize") ?? defaults.chat.historySize
  if (newHist.length > maxSize) {
    history.set("msg", _.tail(newHist))
  }

  // User caching
  cacheUser(message)
}

/** @param {ChatMessage} message  */
function cacheUser(message) {
  const user = message.author
  const id = user.id ?? user.nickname
  userCache.set(`${message.platform}.${id}`, user)
  return user
}

/* ======== Generic platform functions ======== */

/** @param {Platform} platform @param {string} channel  */
async function connectChat(platform, channel) {
  switch (platform.toLowerCase()) {

    case "youtube":
      youtube.connect(channel)

      const videoId = await waitFor(() => {
        const tmp = youtube.channelList()
        const ch = tmp.find(ch => ch.user == channel)

        if (ch == undefined) return null
        return ch?.videoId
      }, /* Timeout: */ 20_000, /* Polling interval: */ 900)

      if (videoId) {
        changeConnectState(platform, ConnStates.connected)
        return videoId
      }
      
      else {
        sendAlert("settings", `${properCase(platform)} user ${channel} isn't livestreaming right now!`)
        changeConnectState(platform, ConnStates.disconnected)
        return false
      }

    case "twitch":
      twitch.join(channel)

      .then(data => {
        info(`[Twitch] Connected to ${data}`)
        changeConnectState(platform, ConnStates.connected)
        return data
      })

      .catch(err => {
        sendAlert(err)
        changeConnectState(platform, ConnStates.disconnected)
        return false
      })

      break
  
    default:
      sendAlert("settings", `Unknown platform "${platform}"`)
      changeConnectState(platform, ConnStates.disconnected)
      return false
  }
}

/** @param {Platform} platform @param {string?} channel  */
async function disconnectChat(platform, channel="") {
  switch (platform.toLowerCase()) {

    case "youtube":
      if (channel) youtube.disconnect(channel)
      else {
        const currentChannels = youtube.channelList()
        currentChannels.forEach(ch => youtube.disconnect(ch.user))
      }

      changeConnectState(platform, ConnStates.disconnected)
      break

    case "twitch":
      if (channel) await twitch.part(channel)
      else {
        const currentChannels = twitch.getChannels()
        await Promise.all(currentChannels.map( ch => twitch.part(ch) ))
      }

      changeConnectState(platform, ConnStates.disconnected)
      break
  
    default:
      warn(`Unknown platform "${platform}"`)
      break
  }
}

/* ======== YouTube ======== */

const youtube = new (require("tubechat")).TubeChat()

youtube.on("chat_connected", (channel, videoId) => {
  info(`[YouTube] Connected to ${channel}, video ${videoId}`)
  // console.log("X", youtube.channelList())
})

youtube.on("chat_disconnected", (channel, videoId) => {
  info(`[YouTube] Disconnected from ${channel}, video ${videoId}`)
})

youtube.on("message", (msg) => {

  // console.log(msg.message.map(chunk => Object.keys(chunk)))
  // console.log(msg.message)

  const contents = msg.message.map(chunk => {
    let serializedChunk = ""
    // @ts-ignore
    if (chunk.text) serializedChunk += xss(chunk.text) 
    if (chunk.emoji) serializedChunk += `<img src="${chunk.emoji}" class="emoji">`
    if (chunk.textEmoji) {
      warn("YouTube sent a TextEmoji chunk! I didn't encounter this in my testing yet. \
      Please send me so I know what it looks like and can implement support for it:")
      debug("`"+JSON.stringify(chunk.textEmoji)+"`")
    }
    return serializedChunk
  }).join("")

  addMessage({
    platform: "youtube",
    id: msg.id,
    contents,
    timestamp: new Date(msg.timestamp),
    author: {
      nickname: msg.name,
      avatarURL: msg.thumbnail.url,
      id: msg.channelId,
      color: msg.color == "#bcbcbc" ? undefined : msg.color,
      statusFlags: {
        moderator: msg.badges.moderator == 1,
        owner: msg.badges.owner == 1,
        subscribed: msg.badges.subscriber == 1,
        verified: msg.badges.verified == 1,
      }
    }
  })

})

/* ======== Twitch ======== */

const twitch = new (require("tmi.js")).Client({
  channels: [],
  connection: { reconnect: true, secure: true },
  // options: { debug: true },
  // logger: { error, info, warn },
})

twitch.on("chat", (channel, us, message, self) => {
  // My goodness, Twitch's userstate is messy
  // /* if (us.username == "fossabot") */ console.debug({channel, us, message, self})
  if (self) return

  addMessage({
    platform: "twitch",
    id: us.id ?? crypto.randomUUID(),
    contents: formatTwitchEmotes(message, us.emotes),
    timestamp: new Date(Number(us?.["tmi-sent-ts"] ?? Date.now())),
    author: {
      nickname: us["display-name"] ?? us.username ?? "Anon",
      // API key needed for avatar URL (blegh)
      id: us["user-id"],
      color: us.color,
      statusFlags: {
        moderator: us.mod || !!us.badges?.moderator || !!us.badges?.global_mod || !!us.badges?.admin,
        owner: !!us.badges?.broadcaster || ("#"+_.lowerCase(us.username) == channel),
        subscribed: us.subscriber || !!us.badges?.subscriber,
        verified: !!us.badges?.partner,
      }
    }
  })
})

twitch.connect()

/* ======== Graceful exit ======== */

require("gracy").onExit(async function() {
  if (connectState.youtube) disconnectChat("youtube")
  if (connectState.twitch) disconnectChat("twitch")
  server.close(() => debug("Closing server"))
}, {logLevel: "error"})

/* ======== Helper functions ======== */

function info(message="") { console.info(clc.whiteBright(message)) }
function warn(message="") { console.warn(clc.yellow(message)) }
function error(message="") { console.error(clc.red(message)) }
function debug(message="") { console.debug(clc.blackBright(message)) }


/** @param {Platform} platform  */
function properCase(platform) {
  return {
    youtube: "YouTube",
    twitch:  "Twitch",
    picarto: "Picarto",
    discord: "Discord",
  }[platform]
}

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

/** @param {Platform} platform @param {ConnStates} newState */
function changeConnectState(platform, newState) {
  connectState[platform] = newState
  websock.emit("connectChange", connectState)
}

function getThemes() {
  // I'm sure we could get fancier with Object.groupBy()
  // but it's really not needed here, it's simple stuff!
  try {
    const files = require("fs").readdirSync("./themes")

    const styles = files.filter(filename => filename.toLowerCase().endsWith(".css"))
      .map(stripFileExt)

    const templates = files.filter(filename => filename.match(/\.html?$/i))
      .map(stripFileExt)

    return _.intersection(styles, templates)

  } catch (err) { error(err) }

  // Fallback to included theme
  return ["Plain"]
}

/**
 * Waits for the test function to return a truthy value
 * @link https://stackoverflow.com/a/58296791
 * @param {function} test Function to check for a truthy return value
 * @example let el = await waitFor( () => document.querySelector("#el_id")) )
 */
async function waitFor(test, timeout_ms=20_000, frequency=200) {
    function sleep(ms=frequency) { return new Promise(resolve => setTimeout(resolve, ms))}
    const endTime = Date.now() + timeout_ms
    const isNotTruthy = (/** @type {string | boolean | any[] | null | undefined} */ x) => x === undefined || x === false || x === null || x.length === 0
    let result = test()
    // console.log("A", result)

    while (isNotTruthy(result)) {
      // console.log("B", result)
      if (Date.now() > endTime) return false
      await sleep(frequency)
      result = test()
    }
    // console.log("C", result)
    return result
}

/** @link https://github.com/tmijs/tmi.js/issues/11#issuecomment-116459845 */
function formatTwitchEmotes(text, emotes) {
  let splitText = text.split("")
  for (let i in emotes) {
    const e = emotes[i]
    for (let j in e) {
      let mote = e[j]
      if (typeof mote == "string") {
        mote = mote.split("-").map(Number)
        const length = mote[1] - mote[0]
        const empty = new Array(length + 1).fill("")
        splitText = [
          ...splitText.slice(0, mote[0]),
          ...empty,
          ...splitText.slice(mote[1] + 1)
        ]
        splitText[mote[0]] = `<img class="emoji" src="http://static-cdn.jtvnw.net/emoticons/v1/${i}/3.0">`
      }
    }
  }
  return splitText.join("")
}
