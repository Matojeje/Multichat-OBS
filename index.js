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
    theme: "Plain",
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

  /** @type {string|undefined} */ //@ts-ignore
  const page = socket.handshake.query?.page
  const pageName = _.capitalize(page ? page + " page" : "a web client")

    debug(`${pageName} connected`   .padEnd(27) + `(${++clients} clients active)`)
  socket.on("disconnect", () => {
    debug(`${pageName} disconnected`.padEnd(27) + `(${--clients} clients active)`)
  })

  if (page) socket.join(page)

  socket.emit("connectChange", connectState) // Hacky!

  socket.on("getSettings", () => {
    const currentSettings = _.defaultsDeep(dbAsObject(settings), defaults)
    // debug(currentSettings)
    socket.emit("settings", currentSettings)
  })

  socket.on("saveSettings", newSett => {
    try {
      settings.set("version", settingsVersion)
      if (newSett?.platforms) {
        trySet("platforms.youtube", newSett.platforms.youtube)
        trySet("platforms.twitch",  newSett.platforms.twitch )
        trySet("platforms.picarto", newSett.platforms.picarto)
        trySet("platforms.discord", newSett.platforms.discord)
      }
      if (newSett?.server) settings.set("server", newSett.server)
      if (newSett?.chat) settings.set("chat", newSett.chat)
      websock.emit("saveSuccessful")
    } catch (err) { error(err) }

    function trySet(key, value) {
      const badValues = [".", "undefined", "[object Object]", "null"]
      if (badValues.includes(value)) {
        debug(`Skip saving "${value}" into ${key}`)
      } else {
        settings.set(key, value)
      }
    }
  })

  socket.on("getThemes", async () => socket.emit("themeList", await getThemes()))

  socket.on("themeChange", newTheme => {
    websock.emit("themeChange", newTheme)
    settings.set("chat.theme", newTheme)
    debug("Changed theme to " + newTheme)
  })

  socket.on("getDiscordChannels", () => updateDiscordChannels())

  socket.on("pleaseConnect", ({platform, channel}) => {
    debug(`Trying to connect to ${properCase(platform)} channel ${channel == "." ? "" : channel}`)

    const key = `platforms.${platform}.channel`
    const savedChannel = settings.get(key)
    const state = connectState[platform]

    if (channel != settings.get(key) && channel.length > 1) {
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
    debug(`Trying to disconnect from ${properCase(platform)} channel ${channel}`)
    changeConnectState(platform, ConnStates.disconnecting)
    disconnectChat(platform, channel)
  })

})


/** @param {"chat"|"settings"|"both"} destination */
function sendAlert(destination, message="") {
  if (destination == "both")
    websock                .emit("alert", message)
  else
    websock.to(destination).emit("alert", message)
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
  express.static( join(__dirname, route.path) ),
  require("serve-index")(route.path, {icons: true, hidden: false})
))

async function startServer() {
  const port = await getPort(settings.get("server.port") ?? defaults.server.port)
  server.listen(port, () => {
    console.log(clc.cyanBright("Server is running on " + clc.underline(`http://127.0.0.1:${port}`)))
    try {
      const ip = getLocalInterface()?.address ?? "127.0.0.1"
      qrCode(`http://${ip}:${port}/`)
    } catch (err) {
      error("Error while fetching local IP: " + err)
    }
  })
}

/* ======== Startup flow ======== */

startServer().then(() => {

  // Autoconnect
  setTimeout(() => { try {
  if (settings.get("server.autoconnect") === true) {
    const platforms = settings.get("platforms")
    for (const p in platforms) {
      const {channel} = platforms[p]
      if (_.isString(channel)) { if (channel.length > 1) {     // @ts-ignore
        changeConnectState(p, ConnStates.connecting)           // @ts-ignore
        connectChat(p, channel)                                // @ts-ignore
        fancy("autoconnect", p == "discord"
          ? `Discord channel ${discordChannelTag(channel)}`    // @ts-ignore
          : `${properCase(p)} channel ${channel}`, "debug"
        )
      }} else {
        warn("Unexpected settings entry: " + p)
      }
    }
  }} catch (err) { error("Autoconnect error: " + err) }}, 1000)

})

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
  websock.to("chat").emit("newMessage", message)

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
        sendAlert("settings", `${properCase(platform)} user ${channel} isn't livestreaming right now!\nIs the stream publicly visible on this channel?`)
        changeConnectState(platform, ConnStates.disconnected)
        fancy("youtube", "Giving up on connecting")
        return false
      }

    case "twitch":
      twitch.join(channel)

      .then(data => {
        fancy("twitch", `Connected to ${data}`)
        changeConnectState(platform, ConnStates.connected)
        return data
      })

      .catch(err => {
        sendAlert(err)
        changeConnectState(platform, ConnStates.disconnected)
        return false
      })

      break

    case "picarto":
      picarto = new pmi.client({
        identity: {
          username: channel,
          password: process.env.PICARTO
        }
      })

      picartoSetup(picarto)
      picarto.connect()
      // Connection state changes handled in picartoSetup()
      break

    case "discord":
      discord.connect()
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
    
    case "picarto":
      if (picarto) picarto.close()
      changeConnectState(platform, ConnStates.disconnected)
      break

    case "discord":
      discord.disconnect({ reconnect: true })
      break

    default:
      warn(`Unknown platform "${platform}"`)
      break
  }
}

/* ======== YouTube ======== */

const youtube = new (require("tubechat")).TubeChat()

youtube.on("chat_connected", (channel, videoId) => {
  fancy("youtube", `Connected to ${channel}, video ${videoId}`)
  // console.log("X", youtube.channelList())
})

youtube.on("chat_disconnected", (channel, videoId) => {
  fancy("youtube", `Disconnected from ${channel}, video ${videoId}`)
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
  logger: {
    error: msg => fancy("twitch", clc.red(msg), "error"),
    info: msg => fancy("twitch", msg, "info"),
    warn: msg => fancy("twitch", clc.yellow(msg), "warn")
  },
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

/* ======== Picarto ======== */

const pmi = require("pmi.js")
let picarto

/** @param {import("pmi.js/lib/client")} client */
function picartoSetup(client) {

  // @ts-ignore
  client.on("message", (target, context, msg, self) => {
    // console.debug({target, context, message: msg, self})
    if (self) return
    const ctx = context[0]

    // Picarto's message structuring was the most cryptic by far...
    // Thanks for helping me decypher it, Dreeda! <3

    addMessage({
      platform: "picarto",
      id: ctx.id,
      contents: msg,
      timestamp: new Date(ctx.d),
      author: {
        nickname: ctx.n,
        id: ctx.u,
        color: ctx.k ? ("#" + ctx.k) : undefined,
        avatarURL: ctx.i ? ("https://images.picarto.tv/" + ctx.i) : undefined,
        statusFlags: {
          owner: ctx.c == ctx.u, // Streamer ID == Sender ID
          subscribed: ctx?.s,
          verified: ctx?.z
        }
      }
    })

  })

  // @ts-ignore
  client.on("connected", (addr, port) => {
    fancy("picarto", `Connected to ${addr??0}:${port??0}`)
    changeConnectState("picarto", ConnStates.connected)
  })
  // @ts-ignore
  client.on("closed", picartoDisconnectLog)
  // @ts-ignore
  client.on("disconnected", picartoDisconnectLog)
  
  // @ts-ignore
  client.on("unauthenticated", () => {
    changeConnectState("picarto", ConnStates.disconnected)
    sendAlert("settings", "Picarto authentication error! Please make sure you have the token for this channel.")
    fancy("picarto", "Giving up on connecting")
  })

  function picartoDisconnectLog() {
    fancy("picarto", "Disconnected")
    changeConnectState("picarto", ConnStates.disconnected)
  }

}

/* ======== Discord ======== */

const Eris = require("eris")
const { discordFormatHTML } = require("./discordParser")

const discord = new Eris.Client(prefixToken(process.env.DISCORD), {
  intents: ["allNonPrivileged", "messageContent"],
  defaultImageFormat: "webp"
})

discord.on("ready", () => {
  fancy("discord", "Bot connected and ready")
  changeConnectState("discord", ConnStates.connected)
  updateDiscordChannels()
})

discord.on("disconnect", () => {
  fancy("discord", "Bot disconnected")
  changeConnectState("discord", ConnStates.disconnected)
  websock.to("settings").emit("discordChannelList", {raw: [], html: ""})
})

discord.on("messageCreate", msg => {
  // Test settings format
  const pattern = /^(\d+)_(\d+)$/
  const guild_channel = settings.get("platforms.discord.channel")
  if (!pattern.test(guild_channel)) return

  // Filter out messages from other channels
  const targetChannel = pattern.exec(guild_channel)?.[2] ?? "0"

  if (BigInt(msg.channel.id) != BigInt(targetChannel)) return

  // Ignore system messages and webhooks
  if (msg.webhookID || msg.member?.user.system) return

  // Ignore non-text messages like joins and server boosts
  const T = Eris.Constants.MessageTypes // @ts-ignore
  const validType = [T.DEFAULT, T.REPLY, T.THREAD_STARTER_MESSAGE].includes(msg.type)
  if (!validType) return


  const P = Eris.Constants.Permissions
  const modPerms = [P.kickMembers, P.banMembers, P.administrator]

  const mem = msg.member, auth = msg.author
  const userID = mem?.id || mem?.user.id || auth.id
  const guild = discord.guilds.find(g => g.id == msg.guildID)

  const color = mem ? decimalColorAsHex(highestColoredRole(mem)?.color) : undefined

  addMessage({
    platform: "discord",
    id: msg.id,
    contents: discordFormatHTML(msg),
    timestamp: new Date(msg.timestamp),
    author: {
      nickname: mem?.nick || auth.globalName || mem?.user.globalName || mem?.username || auth.username,
      id: userID,
      color: color?.toLowerCase() == "#badbad" ? undefined : color,
      avatarURL: mem?.avatarURL || mem?.staticAvatarURL || mem?.defaultAvatarURL,
      statusFlags: {
        owner: BigInt(guild?.ownerID??0) == BigInt(userID),
        subscribed: !!mem?.premiumSince,
        new: (msg.timestamp - (mem?.joinedAt??0)) < 7*24*60*60*1000,
        verified: mem?.bot || mem?.user.bot || auth.bot,
        moderator: modPerms.some(perm => mem?.permissions.has(perm))
      }
    }
  })
})

;["channelCreate", "channelDelete", "channelUpdate",
  "guildAvailable", "guildCreate", "guildDelete",
  "guildUnavailable", "guildUpdate", "threadListSync",
  "threadUpdate", "unavailableGuildCreate"
].forEach(event => discord.on(event, updateDiscordChannels))

function getDiscordChannelList(htmlMode=true) {
  const T = Eris.Constants.ChannelTypes
  const channelFilter = channel => [
    T.GUILD_TEXT,
    T.GUILD_NEWS,
    T.GUILD_NEWS_THREAD,
    T.GUILD_PUBLIC_THREAD,
    T.GUILD_PRIVATE_THREAD,
  ].includes(channel.type)
  
  const prefix = (name) => /^\p{L}/u.test(name) ? `#${name}` : name

  function formatGuildChannels(guild) {
    const channels = guild.channels.filter(channelFilter)
    const html = channels.map(ch => `<option value="${guild.id}_${ch.id}">${prefix(ch.name)}</option>`)
    return `<optgroup label="${guild.name}"> ${html.join(" ")} </optgroup>`
  }

  if (htmlMode) return discord.guilds.map(formatGuildChannels).join("\n")
  else return discord.guilds.map(g => g.channels.filter(channelFilter))
}

function updateDiscordChannels() {
  websock.to("settings").emit("discordChannelList", {
    raw: getDiscordChannelList(false),
    html: getDiscordChannelList(true),
  })
}

/* ======== Graceful exit ======== */

require("gracy").onExit(async function() {
  if (connectState.youtube) disconnectChat("youtube")
  if (connectState.twitch)  disconnectChat("twitch")
  if (connectState.picarto) disconnectChat("picarto")
  if (connectState.discord) disconnectChat("discord")
  server.close(() => debug("Closing server"))
}, {logLevel: "error"})

/* ======== Helper functions ======== */

function info(message="") { console.info(clc.whiteBright(message)) }
function warn(message="") { console.warn(clc.yellow(message)) }
function error(message="") { console.error(clc.red(message)) }
function debug(message="") { console.debug(clc.blackBright(message)) }

function fancy(source="", message="", type="info") {
  let prefix = ""
  switch (source) {
    case "youtube": prefix = clc.redBright("[YouTube]"); break
    case "twitch": prefix = clc.magentaBright("[Twitch]"); break
    case "picarto": prefix = clc.greenBright("[Picarto]"); break
    case "discord": prefix = clc.blueBright("[Discord]"); break
    case "autoconnect": prefix = clc.cyanBright("[Autoconnect]"); break
    default: prefix = clc.cyanBright("[i]"); break
  }
  console[type](`${prefix} ${type == "debug" ? clc.blackBright(message) : message}`)
}


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

async function getThemes() {
  const { readdir, access } = require("fs").promises
  try {

    const subfolders = await readdir("./themes", { withFileTypes: true })

    const validFolders = await Promise.all(subfolders
      .filter(dir => dir.isDirectory())
      .map(async (dir) => {
        try {
          await access(join("./themes", dir.name, "index.html"))
          return dir.name
        } catch {
          warn(`Theme ${dir.name}: Can't access index.html`)
          return null
        }
      }
    ))

    if (!validFolders.includes(defaults.chat.theme))
      warn(`Can't find the default "${defaults.chat.theme}" theme - `+
           `that might cause problems since it's used as a fallback.`)

    return validFolders.filter(f => f != null)

  } catch (err) { error(err) }

  // Fallback to included theme
  return [defaults.chat.theme]
}

/** @param {string|undefined} token */
function prefixToken(token="") {
  if (!token) return ""
  return token.startsWith("Bot ") ? token : `Bot ${token}`
}

function discordChannelTag(guild_channel) {
  const pattern = /^(\d+)_(\d+)$/
  if (!pattern.test(guild_channel)) return "<?>"
  return `<#${pattern.exec(guild_channel)?.[2] ?? "0"}>`
}

function qrCode(text="") {
  const qr = require("qrcode-terminal")
  qr.setErrorLevel("L")
  qr.generate(text, { small:true }, qrString => {
    const lines = qrString.split("\n")
    const coloredLines = [
      /* clc.black(lines[0]), */ "",
      ..._.tail(lines).map(l => clc.inverse(l))
    ]
    console.log(coloredLines.join("\n"))
  })
}

/* ======== Helper functions by other people ======== */

/**
 * Waits for the test function to return a truthy value
 * @link https://stackoverflow.com/a/58296791
 * @param {function} test Function to check for a truthy return value
 * @example let el = await waitFor( () => document.querySelector("#el_id")) )
 */
async function waitFor(test, timeout_ms=20_000, frequency=200) {
    function sleep(ms=frequency) { return new Promise(resolve => setTimeout(resolve, ms))}
    const endTime = Date.now() + timeout_ms // @ts-ignore
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

// Discord role utilities by https://gist.github.com/nirewen/507b4ff8ad93d138068a6e514849dda9

/** @param {Eris.Member} member */
const sortedRoles = (member) => member.roles
  .map(r => member.guild.roles.get(r)) //@ts-ignore
  .sort((a, b) => b.position - a.position)

/** @param {Eris.Member} member */
function highestColoredRole(member) {
  const sorted = sortedRoles(member)
  return sorted.length > 0 ? sorted.find(r => r?.color !== 0) : null
}

function decimalColorAsHex(color=12245933) {
  return '#' + color.toString(16).padStart(6, "0")
}
