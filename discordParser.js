// Inspired by https://github.com/ItzDerock/discord-html-transcripts/blob/0c42383591520bd3ee0b5d0c47dd1ea50e9aaf68/src/generator/renderers/content.tsx

const xss = require("xss")
const Eris = require("eris")
const emoji = require("universal-emoji-parser")
const parser = require("discord-markdown-parser")

/** @param {Eris.Message<Eris.PossiblyUncachedTextableChannel>} msg */
function discordFormatHTML(msg) {
  const stickerHTML = renderStickers(msg)
  return clean(process(msg.content, msg)) + stickerHTML
}

/**
 * @param {string} [input=""]
 * @param {Eris.Message<Eris.PossiblyUncachedTextableChannel>} [msg] */
function process(input="", msg) {
  const parsed = parser.parse(input, "normal")
  // console.debug(parsed)

  try {
    return parsed.map(magic).join("")
  } catch (err) {
    console.error(err)
    try {
      return parsed.map(fallback).join("") + ` <small>(see server console)</small>`
    } catch (error) {
      console.error(error)
      return "<i>Discord message parsing error</i>"
    }
  }

  /** @param {SimpleMarkdown.SingleASTNode} node */
  function fallback(node) { return node.content ?? "\uFFFD" }

  /** @param {SimpleMarkdown.SingleASTNode} node */
  function magic(node) {

    const nest = x => x.map(magic).join("")

    function testNest(node) {
      if (Array.isArray(node.content)) return nest(node.content)
      else if (Array.isArray(node)) return nest(node)
      else return magic(node)
    }

    switch (node.type) {
                                                     // @ts-ignore
    case "text"          : return                 xss(node.content) 
    case "inlineCode"    : return   `<code>${testNest(node.content)}</code>`
    case "em"            : return     `<em>${testNest(node.content)}</em>`
    case "strong"        : return `<strong>${testNest(node.content)}</strong>`
    case "underline"     : return      `<u>${testNest(node.content)}</u>`
    case "strikethrough" : return      `<s>${testNest(node.content)}</s>`

    case "url":
    case "link":
    case "autolink":
      
      if (
        node.target.startsWith("https://cdn.discordapp.com/emojis/") ||
        node.target.startsWith("https://media.discordapp.net/stickers/")
      ) {
        // FakeNitro stuff
        const isSticker = node.target.startsWith("https://media.discordapp.net/stickers/")
        const type = isSticker ? "sticker" : "emoji"
        const name = new URL(node.target).searchParams.get("name") ?? type
        return `<img src="${node.target}" alt="${name}" class="${type}">`
      }
      return `<a href="${node.target}">${testNest(node.content)}</a>`

    case "br":
    case "newline":
      return `<br>`

    case "blockQuote":
      return testNest(node)

    case "channel": {
      let name = "channel"
      if (msg) { // sourcery skip
        const channels = msg.member?.guild.channels
        const channel = channels?.find(ch => ch.id == node.id)
        if (channel) name = channel.name
      } return `<a href="#">#${name}</a>` }
    
    case "role": {
      let name = "role", color = "inherit"
      if (msg) { // sourcery skip
        const roles = msg.member?.guild.roles
        const role = roles?.find(r => r.id == node.id)
        if (role) {
          name = role.name
          color = decimalColorAsHex(role.color)
        }
      } return `<a href="#" style="color: ${color}">@${name}</a>` }

    // Yeah screw it I'm not rewriting this whole thing to be async just for this

    case "user": {
      let name = "user"
      /* if (msg) { 
        const users = await msg.member?.guild.fetchMembers({userIDs: [node.id]})
        const user = users?.find(c => c.id == node.id)
        if (user) name = user.name
      } */
      return `<a href="#">@${name}</a>` }

    case "here":
    case "everyone":
      return `<a href="#">@${node.type}</a>`

    case "codeBlock": {
      const lang = node.lang ? `class="language-${node.lang}"` : ""
      return `<pre><code ${lang}>${node.content}</code></pre>` }

    case "spoiler":
      return `<span class="spoiler" style="background: currentColor">`
           + `<span style="opacity: 0%">${testNest(node.content)}</span></span>`

    case "twemoji": // @ts-ignore
      try { return emoji.parse(node.name) }
      catch (error) { console.error(error) }
      return node.name

    case "emoji": {
      const src = `https://cdn.discordapp.com/emojis/${node.id}.${node.animated ? "gif" : "webp"}?size=128&quality=lossless`
      return `<img class="emoji" alt="${node.name}" src="${src}">` }

    // Oh boy

    case "timestamp": {
      const time = new Date(node.timestamp * 1000)
      switch (node.format) {
        case "R": return require("date-fns/intlFormatDistance").intlFormatDistance(time, new Date())
        case "t": return time.toLocaleTimeString([], {timeStyle: "short"})
        case "T": return time.toLocaleTimeString([], {timeStyle: "medium"})
        case "d": return time.toLocaleDateString([], {dateStyle: "short"})
        case "D": return time.toLocaleDateString([], {dateStyle: "long"})
        case "F": return time.toLocaleString([], {dateStyle: "long", timeStyle: "short"})
        default:  return time.toLocaleString([], {dateStyle: "medium", timeStyle: "short"})
      }
    }

    default:
      console.debug(`Unknown Discord formatting "${node.type}":`, node)
      return "\uFFFD"
  }}

}

/** @param {Eris.Message<Eris.PossiblyUncachedTextableChannel>} msg */
function renderStickers(msg) {
  if (msg?.stickerItems == undefined) return ""
  return msg.stickerItems.map(sticker => {

    const formats = { 1: "png", 2: "png", 3: "json", 4: "gif" }
    const stickerURL = `https://cdn.discordapp.com/stickers/${sticker.id}.${formats[sticker.format_type] ?? "png"}`

    if (sticker.format_type == 3) { // Lottie sticker
      return `<lottie-player class="sticker" src="https://corsproxy.io/?${stickerURL}" alt="${sticker.name}" background="transparent" loop autoplay></lottie-player>`
    } else {
      return `<img class="sticker" src="${stickerURL}" alt="${sticker.name}">`
    }
  })
}

function clean(text="") {
  return text
  .replace(/^#{1,6} /gm, "") // Strip Markdown headings
  .replace(/(?:<|&lt;)\/[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}(?: [-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}){0,2}:\d+(?:&gt;|>)/gu, "<a><kbd>/command</kbd></a>") // Replace slash commands
}

function decimalColorAsHex(color=16777215) {
  return '#' + color.toString(16).padStart(6, "0")
}

/* const bwah = "*paw* **time**! 🐾 <t:1717030680:R> <:OxySob:1168271892164124773>"
console.log("")
console.log(process(bwah))
console.log("") */

exports.discordFormatHTML = discordFormatHTML
exports.discordParser = parser.parse
